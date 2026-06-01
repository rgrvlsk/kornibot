import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeD1Databases, createExecutionContext, FakeR2Bucket, SqliteD1Database } from "../helpers/worker-test-env";
import type { Env } from "../../src/shared/env";
import { DEV_ACCESS_KEY_HEADER, hashDevAccessKey } from "../../src/worker/services/auth/dev-access";
import { createSessionCookie, createSessionToken } from "../../src/worker/services/auth/session";
import worker from "../../src/worker/index";

const contexts: SqliteD1Database[] = [];
const originalFetch = globalThis.fetch;

function createEnv() {
  const db = new SqliteD1Database();
  const bucket = new FakeR2Bucket();
  contexts.push(db);

  const env: Env = {
    DB: db as unknown as D1Database,
    MEDIA_BUCKET: bucket as unknown as R2Bucket,
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "super-secret",
    SESSION_SECRET: "session-secret",
    CORS_ALLOWED_ORIGINS: "",
    BOOTSTRAP_SUPERADMIN_USER_ID: "999",
    INITIAL_AUDIT_CHAT_ID: "-1002829359850",
  };

  return { db, bucket, env };
}

function seedDashboardFixture(db: SqliteD1Database): void {
  db.sqlite.exec(`
    INSERT INTO users (user_id, username, first_name, updated_at)
    VALUES
      (100, 'ada', 'Ada', '2024-03-09T12:00:00.000Z'),
      (200, 'lin', 'Lin', '2024-03-09T12:00:00.000Z');

    INSERT INTO raw_events (id, update_id, received_at, event_kind, chat_id, message_id, actor_user_id, payload_json, projected_at)
    VALUES
      (1, 1001, '2024-03-09T12:00:00.000Z', 'message', -1002829359850, 10, 100, '{}', '2024-03-09T12:00:01.000Z'),
      (2, 1002, '2024-03-09T12:01:00.000Z', 'message', -1002829359850, 11, 200, '{}', '2024-03-09T12:01:01.000Z'),
      (3, 1003, '2024-03-09T12:05:00.000Z', 'edited_message', -1002829359850, 10, 100, '{}', '2024-03-09T12:05:01.000Z'),
      (4, 1004, '2024-03-09T12:06:00.000Z', 'message_reaction', -1002829359850, 10, 200, '{}', '2024-03-09T12:06:01.000Z');

    INSERT INTO messages (
      chat_id, message_id, from_user_id, sent_at, message_type, reply_to_message_id,
      thread_root_message_id, current_text, current_caption, has_media, is_currently_visible,
      last_known_edit_at, last_event_id
    )
    VALUES
      (-1002829359850, 10, 100, '2024-03-09T12:00:00.000Z', 'text', NULL, NULL, 'Hello edited', NULL, 0, 1, '2024-03-09T12:05:00.000Z', 3),
      (-1002829359850, 11, 200, '2024-03-09T12:01:00.000Z', 'text', 10, 10, 'Reply body', NULL, 0, 1, NULL, 2);

    INSERT INTO message_versions (chat_id, message_id, version_no, text, caption, edited_at, source_raw_event_id)
    VALUES
      (-1002829359850, 10, 1, 'Hello original', NULL, '2024-03-09T12:00:00.000Z', 1),
      (-1002829359850, 10, 3, 'Hello edited', NULL, '2024-03-09T12:05:00.000Z', 3),
      (-1002829359850, 11, 2, 'Reply body', NULL, '2024-03-09T12:01:00.000Z', 2);

    INSERT INTO message_replies (chat_id, message_id, parent_message_id, root_message_id, replied_at, source_raw_event_id)
    VALUES (-1002829359850, 11, 10, 10, '2024-03-09T12:01:00.000Z', 2);

    INSERT INTO reaction_events (chat_id, message_id, reactor_user_id, reaction_key, is_active, observed_at, source_raw_event_id)
    VALUES (-1002829359850, 10, 200, 'emoji:🔥', 1, '2024-03-09T12:06:00.000Z', 4);

    INSERT INTO message_reactions (chat_id, message_id, reactor_user_id, reaction_key, first_seen_at, last_changed_at, is_active)
    VALUES (-1002829359850, 10, 200, 'emoji:🔥', '2024-03-09T12:06:00.000Z', '2024-03-09T12:06:00.000Z', 1);

    INSERT INTO hourly_user_metrics (
      bucket_hour, user_id, messages_sent, replies_sent, edits_made, reactions_emitted, reactions_received, media_sent, active_minutes
    )
    VALUES
      ('2024-03-09T12:00:00.000Z', 100, 1, 0, 1, 0, 1, 0, 10),
      ('2024-03-09T12:00:00.000Z', 200, 1, 1, 0, 1, 0, 0, 8);

    INSERT INTO monthly_user_snapshots (
      month, user_id, messages_sent, replies_sent, edits_made, reactions_emitted, reactions_received, media_sent, average_reactions_per_message
    )
    VALUES
      ('2024-03', 100, 12, 4, 2, 1, 8, 0, 0.67),
      ('2024-03', 200, 7, 6, 0, 9, 2, 0, 0.29);

    INSERT INTO settings (key, value_json)
    VALUES
      ('groups.audit_chat_id', '-1002829359850'),
      ('groups.caa_chat_id', '-5555');

    INSERT INTO telegram_chats (
      chat_id, title, type, first_seen_at, last_activity_at, last_update_id
    )
    VALUES
      (-1002829359850, 'Policornis', 'supergroup', '2024-03-09T12:00:00.000Z', '2024-03-09T12:06:00.000Z', 1004),
      (-5555, 'CAA', 'supergroup', '2024-03-09T12:07:00.000Z', '2024-03-09T12:07:00.000Z', 1005);

    INSERT INTO auth_roles (user_id, role, granted_via, is_active)
    VALUES (999, 'superadmin', 'bootstrap', 1);
  `);
}

async function sendApiRequest(
  env: Env,
  path: string,
  role: "superadmin" | "caa_member" | null = "caa_member",
  userId = 999,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);

  if (role) {
    const cookie = await createSessionCookie(env, {
      userId,
      username: "session-user",
      role,
    });
    headers.set("cookie", cookie);
  }

  const request = new Request(`https://example.com${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  });

  return worker.fetch(request, env, createExecutionContext());
}

async function seedDevAccess(db: SqliteD1Database, key: string): Promise<void> {
  db.sqlite.prepare(`
    INSERT INTO settings (key, value_json)
    VALUES ('auth.dev_access', ?)
  `).run(JSON.stringify({
    enabled: true,
    tokenHash: await hashDevAccessKey(key),
    createdAt: "2026-05-06T08:00:00.000Z",
    expiresAt: "2099-05-06T08:00:00.000Z",
  }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    result: {
      status: "member",
    },
  }), {
    headers: { "content-type": "application/json" },
  })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  closeD1Databases(contexts);
});

describe("dashboard api", () => {
  it("returns a paginated feed timeline", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    const response = await sendApiRequest(env, "/api/feed?limit=2");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      items: [
        {
          rawEventId: 4,
          updateId: 1004,
          eventKind: "message_reaction",
          chatId: -1002829359850,
          messageId: 10,
          actorUserId: 200,
          receivedAt: "2024-03-09T12:06:00.000Z",
          text: "Hello edited",
        },
        {
          rawEventId: 3,
          updateId: 1003,
          eventKind: "edited_message",
          chatId: -1002829359850,
          messageId: 10,
          actorUserId: 100,
          receivedAt: "2024-03-09T12:05:00.000Z",
          text: "Hello edited",
        },
      ],
      nextCursor: "3",
    });
  });

  it("accepts the dev access key header for API reads", async () => {
    const { db, env } = createEnv();
    const key = "local-hmr-dev-key";
    seedDashboardFixture(db);
    await seedDevAccess(db, key);

    const response = await sendApiRequest(env, "/api/feed?limit=1", null, 999, {
      headers: {
        [DEV_ACCESS_KEY_HEADER]: key,
      },
    });

    const payload = await response.json() as { items: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
  });

  it("tracks only the latest dashboard access for each member", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    vi.setSystemTime(new Date("2026-05-06T09:13:00.000Z"));
    const firstResponse = await sendApiRequest(env, "/api/access-analytics/visit", "caa_member", 100, {
      method: "POST",
    });

    vi.setSystemTime(new Date("2026-05-06T09:42:00.000Z"));
    const secondResponse = await sendApiRequest(env, "/api/access-analytics/visit", "caa_member", 100, {
      method: "POST",
    });

    const row = db.sqlite.prepare(`
      SELECT user_id, username, role, last_access_at
      FROM dashboard_access_hourly
    `).get();

    expect(firstResponse.status).toBe(204);
    expect(secondResponse.status).toBe(204);
    expect(row).toEqual({
      user_id: 100,
      username: "session-user",
      role: "caa_member",
      last_access_at: "2026-05-06T09:42:00.000Z",
    });
  });

  it("returns latest console access overview to dashboard members", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      INSERT INTO dashboard_access_hourly (user_id, username, role, last_access_at)
      VALUES
        (100, 'ada', 'caa_member', '2026-05-06T09:05:00.000Z'),
        (200, 'lin', 'caa_member', '2026-05-06T09:11:00.000Z'),
        (999, 'root', 'superadmin', '2026-05-06T07:01:00.000Z');
    `);

    const caaResponse = await sendApiRequest(env, "/api/access-analytics/overview", "caa_member", 100);
    const superadminResponse = await sendApiRequest(env, "/api/access-analytics/overview", "superadmin", 999);

    expect(caaResponse.status).toBe(200);
    expect(await caaResponse.json()).toEqual({
      ok: true,
      items: [
        {
          userId: 200,
          username: "lin",
          role: "caa_member",
          latestAccessAt: "2026-05-06T09:11:00.000Z",
        },
        {
          userId: 100,
          username: "ada",
          role: "caa_member",
          latestAccessAt: "2026-05-06T09:05:00.000Z",
        },
        {
          userId: 999,
          username: "root",
          role: "superadmin",
          latestAccessAt: "2026-05-06T07:01:00.000Z",
        },
      ],
    });
    expect(superadminResponse.status).toBe(200);
    expect(await superadminResponse.json()).toEqual({
      ok: true,
      items: [
        {
          userId: 200,
          username: "lin",
          role: "caa_member",
          latestAccessAt: "2026-05-06T09:11:00.000Z",
        },
        {
          userId: 100,
          username: "ada",
          role: "caa_member",
          latestAccessAt: "2026-05-06T09:05:00.000Z",
        },
        {
          userId: 999,
          username: "root",
          role: "superadmin",
          latestAccessAt: "2026-05-06T07:01:00.000Z",
        },
      ],
    });
  });

  it("allows the dev access header through CORS preflight", async () => {
    const { env } = createEnv();
    env.CORS_ALLOWED_ORIGINS = "http://localhost:5173";

    const response = await worker.fetch(new Request("https://example.com/api/feed", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": DEV_ACCESS_KEY_HEADER,
      },
    }), env, createExecutionContext());

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-headers")).toContain(DEV_ACCESS_KEY_HEADER);
    expect(response.headers.get("access-control-allow-headers")).not.toContain("authorization");
  });

  it("rejects CORS preflight when allowed origins are not configured", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(new Request("https://example.com/api/feed", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
      },
    }), env, createExecutionContext());

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("filters search by user, type, text and date range", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    const response = await sendApiRequest(
      env,
      "/api/search?userId=100&type=edited_message&text=Hello&dateFrom=2024-03-09T12:04:00.000Z&dateTo=2024-03-09T12:06:00.000Z",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      items: [
        {
          rawEventId: 3,
          updateId: 1003,
          eventKind: "edited_message",
          chatId: -1002829359850,
          messageId: 10,
          actorUserId: 100,
          receivedAt: "2024-03-09T12:05:00.000Z",
          text: "Hello edited",
        },
      ],
    });
  });

  it("returns user profile metrics and monthly snapshots", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    const response = await sendApiRequest(env, "/api/users/100");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      user: {
        userId: 100,
        telegramId: 100,
        username: "ada",
        firstName: "Ada",
        lastName: null,
        nickname: null,
        isBot: false,
        languageCode: null,
        profilePhoto: null,
        firstSeenAt: null,
        lastSeenAt: null,
        lastMembershipStatus: null,
        lastJoinedAt: null,
        lastLeftAt: null,
        dashboardRole: null,
        isDashboardSuperadmin: false,
        isCaaMember: false,
      },
      membershipPeriods: [],
      hourlyMetrics: [
        {
          bucketHour: "2024-03-09T12:00:00.000Z",
          messagesSent: 1,
          repliesSent: 0,
          editsMade: 1,
          reactionsEmitted: 0,
          reactionsReceived: 1,
          mediaSent: 0,
          activeMinutes: 10,
        },
      ],
      monthlySnapshots: [
        {
          month: "2024-03",
          messagesSent: 12,
          repliesSent: 4,
          editsMade: 2,
          reactionsEmitted: 1,
          reactionsReceived: 8,
          mediaSent: 0,
          averageReactionsPerMessage: 0.67,
        },
      ],
      peerAverages: {
        reactionsEmitted: 9,
        reactionsReceived: 2,
        averageReactionsPerMessage: 0.29,
      },
    });
  });

  it("returns user profile metrics from archived blips", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      DELETE FROM hourly_user_metrics;
      DELETE FROM monthly_user_snapshots;

      INSERT INTO activity_blips (
        period_grain, period_start, user_id, messages_sent, replies_sent, edits_made,
        reactions_emitted, reactions_received, media_sent, active_minutes, archived_at
      )
      VALUES
        ('day', '2024-03-08', 100, 4, 1, 0, 2, 7, 1, 6, '2024-04-01T00:00:00.000Z'),
        ('hour', '2024-03-09T10:00:00.000Z', 100, 3, 0, 1, 1, 5, 0, 4, '2024-04-01T00:00:00.000Z'),
        ('day', '2024-03-08', 200, 1, 0, 0, 3, 2, 0, 2, '2024-04-01T00:00:00.000Z');
    `);

    const response = await sendApiRequest(env, "/api/users/100");

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      hourlyMetrics: Array<{
        bucketHour: string;
        messagesSent: number;
        repliesSent: number;
        editsMade: number;
        reactionsEmitted: number;
        reactionsReceived: number;
        mediaSent: number;
        activeMinutes: number;
      }>;
      peerAverages: {
        reactionsEmitted: number | null;
        reactionsReceived: number | null;
        averageReactionsPerMessage: number | null;
      } | null;
    };

    expect(payload.hourlyMetrics).toEqual([
      {
        bucketHour: "2024-03-09T10:00:00.000Z",
        messagesSent: 3,
        repliesSent: 0,
        editsMade: 1,
        reactionsEmitted: 1,
        reactionsReceived: 5,
        mediaSent: 0,
        activeMinutes: 4,
      },
      {
        bucketHour: "2024-03-08",
        messagesSent: 4,
        repliesSent: 1,
        editsMade: 0,
        reactionsEmitted: 2,
        reactionsReceived: 7,
        mediaSent: 1,
        activeMinutes: 6,
      },
    ]);
    expect(payload.peerAverages).toEqual({
      reactionsEmitted: 3,
      reactionsReceived: 2,
      averageReactionsPerMessage: 2,
    });
  });

  it("returns member profile list", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes("getChatAdministrators")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              status: "creator",
              user: { id: 100 },
            },
          ],
        }), {
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        result: 2,
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    db.sqlite.exec(`
      UPDATE users
      SET
        nickname = 'Ada Lovelace',
        profile_photo_file_id = 'photo-file',
        profile_photo_file_unique_id = 'photo-unique',
        profile_photo_width = 640,
        profile_photo_height = 640,
        profile_photo_r2_key = 'telegram/users/100/profile-photo',
        profile_photo_mime_type = 'image/jpeg',
        profile_photo_checked_at = '2024-03-09T12:30:00.000Z',
        last_membership_status = 'member',
        last_joined_at = '2024-03-09T12:10:00.000Z',
        last_seen_at = '2024-03-09T12:31:00.000Z'
      WHERE user_id = 100;
    `);

    const response = await sendApiRequest(env, "/api/users?limit=1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      summary: {
        activityDailyAverage: 4,
        activityWindowDays: 1,
        messagesLast24h: 2,
        reactionsGivenLast24h: 1,
        knownUserCount: 2,
        telegramMemberCount: 1,
      },
      items: [
        {
          userId: 100,
          telegramId: 100,
          username: "ada",
          nickname: "Ada Lovelace",
          profilePhoto: {
            fileId: "photo-file",
            fileUniqueId: "photo-unique",
            width: 640,
            height: 640,
            r2Key: "telegram/users/100/profile-photo",
            mimeType: "image/jpeg",
            sizeBytes: null,
            checkedAt: "2024-03-09T12:30:00.000Z",
            url: "/api/users/100/profile-photo",
          },
          activityDailyAverage: 2,
          activityWindowDays: 1,
          messagesLast24h: 1,
          reactionsGivenLast24h: 0,
          dashboardRole: null,
          isDashboardSuperadmin: false,
          isCaaMember: false,
          isAuditGroupOwner: true,
          isAuditGroupAdmin: false,
          lastMembershipStatus: "member",
          lastJoinedAt: "2024-03-09T12:10:00.000Z",
          lastLeftAt: null,
          lastSeenAt: "2024-03-09T12:31:00.000Z",
        },
      ],
    });
  });

  it("returns audit group admin badges separately from owner badges", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes("getChatAdministrators")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              status: "creator",
              user: { id: 100 },
            },
            {
              status: "administrator",
              user: { id: 200 },
            },
          ],
        }), {
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        result: 2,
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    const response = await sendApiRequest(env, "/api/users?limit=2");
    const payload = await response.json() as {
      items: Array<{
        userId: number;
        isAuditGroupOwner: boolean;
        isAuditGroupAdmin: boolean;
      }>;
    };
    const owner = payload.items.find((item) => item.userId === 100);
    const admin = payload.items.find((item) => item.userId === 200);

    expect(response.status).toBe(200);
    expect(owner).toMatchObject({
      isAuditGroupOwner: true,
      isAuditGroupAdmin: false,
    });
    expect(admin).toMatchObject({
      isAuditGroupOwner: false,
      isAuditGroupAdmin: true,
    });
  });

  it("returns independent dashboard role badges", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      INSERT INTO auth_roles (user_id, role, granted_via, is_active)
      VALUES
        (100, 'superadmin', 'test', 1),
        (100, 'caa_member', 'test', 1);
    `);

    const response = await sendApiRequest(env, "/api/users?limit=1", "superadmin", 999);
    const payload = await response.json() as {
      items: Array<{
        dashboardRole: string | null;
        isDashboardSuperadmin: boolean;
        isCaaMember: boolean;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.items[0]).toMatchObject({
      dashboardRole: "superadmin",
      isDashboardSuperadmin: true,
      isCaaMember: true,
    });
  });

  it("returns Telegram human member count separately from observed member profiles", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: 40,
    }), {
      headers: { "content-type": "application/json" },
    }));

    const response = await sendApiRequest(env, "/api/users?limit=1", "superadmin", 999);
    const payload = await response.json() as { summary: { telegramMemberCount: number | null } };

    expect(response.status).toBe(200);
    expect(payload.summary.telegramMemberCount).toBe(39);
  });

  it("serves deploy assets from the R2 deploy prefix without dashboard auth", async () => {
    const { bucket, env } = createEnv();
    bucket.put("deploy-assets/kornibot-judge.gif", "gif-body", {
      httpMetadata: {
        contentType: "image/gif",
      },
    });

    const response = await worker.fetch(new Request("https://example.com/assets/kornibot-judge.gif"), env, createExecutionContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(await response.text()).toBe("gif-body");

    const headResponse = await worker.fetch(new Request("https://example.com/assets/kornibot-judge.gif", {
      method: "HEAD",
    }), env, createExecutionContext());
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("content-type")).toBe("image/gif");
  });

  it("serves member profile photos from R2 behind dashboard auth", async () => {
    const { bucket, db, env } = createEnv();
    seedDashboardFixture(db);
    bucket.put("telegram/users/100/profile-photo", "jpeg-body", {
      httpMetadata: {
        contentType: "image/jpeg",
      },
    });
    db.sqlite.exec(`
      UPDATE users
      SET
        profile_photo_r2_key = 'telegram/users/100/profile-photo',
        profile_photo_mime_type = 'image/jpeg'
      WHERE user_id = 100;
    `);

    const unauthenticatedResponse = await sendApiRequest(env, "/api/users/100/profile-photo", null);
    const response = await sendApiRequest(env, "/api/users/100/profile-photo", "caa_member", 100);

    expect(unauthenticatedResponse.status).toBe(401);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("jpeg-body");
  });

  it("allows only superadmin to refresh known member profile photos in batches", async () => {
    const { bucket, db, env } = createEnv();
    seedDashboardFixture(db);
    const fetchMock = vi.mocked(globalThis.fetch);

    const caaResponse = await sendApiRequest(env, "/api/users/profile-photos/refresh", "caa_member", 100, {
      method: "POST",
      body: JSON.stringify({ limit: 2 }),
    });

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          total_count: 1,
          photos: [[
            {
              file_id: "ada-small",
              file_unique_id: "ada-small-unique",
              width: 160,
              height: 160,
            },
            {
              file_id: "ada-large",
              file_unique_id: "ada-large-unique",
              width: 640,
              height: 640,
              file_size: 4096,
            },
          ]],
        },
      }), {
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          file_path: "profile/ada-large.jpg",
          file_size: 4096,
        },
      }), {
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("ada-photo", {
        headers: { "content-type": "image/jpeg" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          total_count: 0,
          photos: [],
        },
      }), {
        headers: { "content-type": "application/json" },
      }));

    const response = await sendApiRequest(env, "/api/users/profile-photos/refresh", "superadmin", 999, {
      method: "POST",
      body: JSON.stringify({ limit: 2 }),
    });
    const storedPhoto = bucket.objects.get("telegram/users/100/profile-photo");
    const row = db.sqlite.prepare(`
      SELECT
        profile_photo_file_id,
        profile_photo_file_unique_id,
        profile_photo_r2_key,
        profile_photo_mime_type
      FROM users
      WHERE user_id = 100
    `).get();

    expect(caaResponse.status).toBe(403);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: {
        checked: 2,
        updated: 1,
        empty: 1,
        skipped: 0,
        failed: 0,
        notDue: 0,
        nextCursor: null,
        done: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(storedPhoto?.contentType).toBe("image/jpeg");
    expect(await new Response(storedPhoto?.body).text()).toBe("ada-photo");
    expect(row).toEqual({
      profile_photo_file_id: "ada-large",
      profile_photo_file_unique_id: "ada-large-unique",
      profile_photo_r2_key: "telegram/users/100/profile-photo",
      profile_photo_mime_type: "image/jpeg",
    });
  });

  it("refreshes one member audit and CAA status from Telegram", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      INSERT INTO auth_roles (user_id, role, granted_via, is_active)
      VALUES (100, 'caa_member', 'telegram_caa', 1);
    `);

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      const chatId = url.searchParams.get("chat_id");

      if (chatId === "-1002829359850") {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            status: "administrator",
          },
        }), {
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        result: {
          status: "left",
        },
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    const response = await sendApiRequest(env, "/api/users/100/status/refresh", "superadmin", 999, {
      method: "POST",
    });
    const userRow = db.sqlite.prepare(`
      SELECT last_membership_status, last_membership_checked_at
      FROM users
      WHERE user_id = 100
    `).get();
    const roleRow = db.sqlite.prepare(`
      SELECT is_active
      FROM auth_roles
      WHERE user_id = 100
        AND role = 'caa_member'
    `).get();
    const checkRows = db.sqlite.prepare(`
      SELECT audit_status, audit_is_active, caa_status, caa_is_active, checked_by
      FROM member_status_checks
      WHERE user_id = 100
    `).all();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      result: {
        userId: 100,
        auditStatus: "administrator",
        auditActive: true,
        caaStatus: "left",
        caaActive: false,
        isCaaMember: false,
        failed: 0,
      },
    });
    expect(userRow).toMatchObject({
      last_membership_status: "administrator",
    });
    expect(typeof (userRow as { last_membership_checked_at: string }).last_membership_checked_at).toBe("string");
    expect(roleRow).toEqual({ is_active: 0 });
    expect(checkRows).toEqual([
      {
        audit_status: "administrator",
        audit_is_active: 1,
        caa_status: "left",
        caa_is_active: 0,
        checked_by: "manual",
      },
    ]);
  });

  it("returns member dashboard metrics for the current Telegram member", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      INSERT INTO hourly_user_metrics (
        bucket_hour, user_id, messages_sent, replies_sent, edits_made, reactions_emitted, reactions_received, media_sent, active_minutes
      )
      VALUES
        ('2024-03-10T12:00:00.000Z', 100, 3, 1, 0, 1, 5, 0, 14),
        ('2024-03-10T12:00:00.000Z', 200, 2, 0, 0, 2, 3, 0, 12);
    `);
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: {
        status: "member",
      },
    }), {
      headers: { "content-type": "application/json" },
    }));

    const response = await sendApiRequest(env, "/api/member-metrics", "caa_member", 100);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      dailyMessages: [
        {
          date: "2024-03-09",
          messagesSent: 2,
          activeUsers: 2,
        },
        {
          date: "2024-03-10",
          messagesSent: 5,
          activeUsers: 2,
        },
      ],
      mostReactionsReceived: [
        {
          userId: 100,
          username: "ada",
          nickname: null,
          reactionsReceived: 6,
        },
        {
          userId: 200,
          username: "lin",
          nickname: null,
          reactionsReceived: 3,
        },
      ],
      personalHistogram: [
        {
          date: "2024-03-09",
          messagesSent: 1,
        },
        {
          date: "2024-03-10",
          messagesSent: 3,
        },
      ],
      currentUser: {
        userId: 100,
        username: "ada",
        nickname: null,
      },
    });
  });

  it("returns member dashboard metrics from archived blips", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      DELETE FROM hourly_user_metrics;

      INSERT INTO activity_blips (
        period_grain, period_start, user_id, messages_sent, replies_sent, edits_made,
        reactions_emitted, reactions_received, media_sent, active_minutes, archived_at
      )
      VALUES
        ('day', '2024-03-09', 100, 6, 2, 0, 3, 8, 1, 9, '2024-04-01T00:00:00.000Z'),
        ('day', '2024-03-09', 200, 2, 0, 0, 1, 4, 0, 4, '2024-04-01T00:00:00.000Z'),
        ('hour', '2024-03-10T12:00:00.000Z', 100, 1, 0, 0, 1, 2, 0, 1, '2024-04-01T00:00:00.000Z');
    `);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: {
        status: "member",
      },
    }), {
      headers: { "content-type": "application/json" },
    }));

    const response = await sendApiRequest(env, "/api/member-metrics", "caa_member", 100);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      dailyMessages: [
        { date: "2024-03-09", messagesSent: 8, activeUsers: 2 },
        { date: "2024-03-10", messagesSent: 1, activeUsers: 1 },
      ],
      mostReactionsReceived: [
        { userId: 100, reactionsReceived: 10 },
        { userId: 200, reactionsReceived: 4 },
      ],
      personalHistogram: [
        { date: "2024-03-09", messagesSent: 6 },
        { date: "2024-03-10", messagesSent: 1 },
      ],
    });
  });

  it("returns real-data Resum metrics", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      UPDATE users
      SET
        profile_photo_file_id = 'photo-file',
        profile_photo_file_unique_id = 'photo-unique',
        profile_photo_r2_key = 'telegram/users/100/profile-photo'
      WHERE user_id = 100;

      INSERT INTO hourly_group_metrics (
        bucket_hour, messages_sent, active_users, replies_sent, edits_made, reactions_emitted, reactions_received, media_sent
      )
      VALUES
        ('2024-03-09T12:00:00.000Z', 2, 2, 1, 1, 1, 1, 0);
    `);

    const response = await sendApiRequest(env, "/api/resum", "caa_member", 100);
    const payload = await response.json() as {
      ok: boolean;
      anchorHour: string;
      pulse24h: {
        messages: number;
        activeUsers: number;
        replies: number;
        replyRatio: number;
        totalReactions: number;
      };
      daily30d: Array<{ date: string; messages: number; totalReactions: number }>;
      runningAverages30d: Array<{ date: string; messages: number; totalReactions: number }>;
      highlightedMembers: Array<{ userId: number; score: number }>;
      topConversations: Array<{ messageId: number; replies: number; reactions: number }>;
      threadStarters: Array<{ userId: number; threadsStarted: number; replies: number; reactions: number; profilePhoto: { url: string | null } | null }>;
      dailyTopConversations: Array<{ date: string; messageId: number; replies: number; reactions: number }>;
      rhythm30d: Array<{ label: string; cells: number[]; total: number }>;
      memberMovement: { knownUsers: number; daily: Array<{ date: string; knownUsers: number }> };
      auditFreshness: { latestAggregateHour: string | null; unprojectedRawEvents: number };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.anchorHour).toBe("2024-03-09T12:00:00.000Z");
    expect(payload.pulse24h).toMatchObject({
      messages: 2,
      activeUsers: 2,
      replies: 1,
      replyRatio: 0.5,
      totalReactions: 1,
    });
    expect(payload.daily30d).toHaveLength(1);
    expect(payload.daily30d[0]).toMatchObject({ date: "2024-03-09", messages: 2, totalReactions: 1 });
    expect(payload.runningAverages30d).toHaveLength(1);
    expect(payload.runningAverages30d[0]).toMatchObject({ date: "2024-03-09", messages: 2, totalReactions: 1 });
    expect(payload.highlightedMembers[0]).toMatchObject({ userId: 200, score: 3 });
    expect(payload.topConversations[0]).toMatchObject({ messageId: 10, replies: 1, reactions: 1 });
    expect(payload.threadStarters[0]).toMatchObject({ userId: 100, threadsStarted: 1, replies: 1, reactions: 1 });
    expect(payload.threadStarters[0].profilePhoto?.url).toBe("/api/users/100/profile-photo");
    expect(payload.dailyTopConversations[0]).toMatchObject({ date: "2024-03-09", messageId: 10, replies: 1, reactions: 1 });
    expect(payload.rhythm30d).toHaveLength(7);
    expect(payload.rhythm30d[0].cells).toHaveLength(12);
    expect(payload.rhythm30d[6].total).toBe(3);
    expect(payload.memberMovement.knownUsers).toBe(2);
    expect(payload.memberMovement.daily).toEqual([{ date: "2024-03-09", joins: 0, leaves: 0, knownUsers: 2 }]);
    expect(payload.auditFreshness).toMatchObject({
      latestAggregateHour: "2024-03-09T12:00:00.000Z",
      unprojectedRawEvents: 0,
    });
  });

  it("returns Resum aggregate metrics from archived blips", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      DELETE FROM hourly_user_metrics;
      DELETE FROM hourly_group_metrics;

      INSERT INTO activity_blips (
        period_grain, period_start, user_id, messages_sent, replies_sent, edits_made,
        reactions_emitted, reactions_received, media_sent, active_minutes, archived_at
      )
      VALUES
        ('day', '2024-03-09', 100, 6, 2, 1, 3, 8, 1, 9, '2024-04-01T00:00:00.000Z'),
        ('day', '2024-03-09', 200, 2, 0, 0, 1, 4, 0, 4, '2024-04-01T00:00:00.000Z'),
        ('hour', '2024-03-10T12:00:00.000Z', 100, 1, 0, 0, 1, 2, 0, 1, '2024-04-01T00:00:00.000Z');
    `);

    const response = await sendApiRequest(env, "/api/resum", "caa_member", 100);
    const payload = await response.json() as {
      anchorHour: string;
      pulse24h: { messages: number; activeUsers: number; replies: number; totalReactions: number };
      daily30d: Array<{ date: string; messages: number; activeUsers: number; totalReactions: number }>;
      highlightedMembers: Array<{ userId: number; messages: number; reactionsEmitted: number; reactionsReceived: number }>;
      rhythm30d: Array<{ label: string; cells: number[]; total: number }>;
      auditFreshness: { latestAggregateHour: string | null };
    };

    expect(response.status).toBe(200);
    expect(payload.anchorHour).toBe("2024-03-10T12:00:00.000Z");
    expect(payload.pulse24h).toEqual({
      messages: 1,
      activeUsers: 1,
      replies: 0,
      replyRatio: 0,
      totalReactions: 1,
      media: 0,
      deltaMessages: -7,
      deltaReactions: -3,
    });
    expect(payload.daily30d).toEqual([
      { date: "2024-03-09", messages: 8, activeUsers: 2, replies: 2, totalReactions: 4, media: 1 },
      { date: "2024-03-10", messages: 1, activeUsers: 1, replies: 0, totalReactions: 1, media: 0 },
    ]);
    expect(payload.highlightedMembers).toEqual([
      { userId: 100, username: "ada", nickname: null, profilePhoto: { url: null }, score: 22, messages: 7, replies: 2, reactionsEmitted: 4, reactionsReceived: 10 },
      { userId: 200, username: "lin", nickname: null, profilePhoto: { url: null }, score: 6, messages: 2, replies: 0, reactionsEmitted: 1, reactionsReceived: 4 },
    ]);
    expect(payload.rhythm30d[6].total).toBe(12);
    expect(payload.rhythm30d[0].total).toBe(2);
    expect(payload.auditFreshness.latestAggregateHour).toBe("2024-03-10T12:00:00.000Z");
  });

  it("returns thread root, replies, edits and reactions", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    const response = await sendApiRequest(env, "/api/threads/-1002829359850/10");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      root: {
        chatId: -1002829359850,
        messageId: 10,
        fromUserId: 100,
        currentText: "Hello edited",
      },
      replies: [
        {
          messageId: 11,
          fromUserId: 200,
          currentText: "Reply body",
          repliedAt: "2024-03-09T12:01:00.000Z",
        },
      ],
      versions: [
        {
          versionNo: 1,
          text: "Hello original",
          editedAt: "2024-03-09T12:00:00.000Z",
        },
        {
          versionNo: 3,
          text: "Hello edited",
          editedAt: "2024-03-09T12:05:00.000Z",
        },
      ],
      reactions: [
        {
          reactorUserId: 200,
          reactionKey: "emoji:🔥",
          isActive: 1,
          lastChangedAt: "2024-03-09T12:06:00.000Z",
        },
      ],
    });
  });

  it("returns setup status with safe group and env configuration", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    const response = await sendApiRequest(env, "/api/setup/status", "superadmin");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      setup: {
        isComplete: true,
        auditChatId: -1002829359850,
        caaChatId: -5555,
        bootstrapSuperadminConfigured: true,
        safeEnv: {
          initialAuditChatId: -1002829359850,
          defaultLanguage: "ca",
          defaultTimezone: "Europe/Madrid",
          hasCorsAllowedOrigins: false,
        },
      },
    });
  });

  it("lists detected Telegram chats with configured group flags", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    const response = await sendApiRequest(env, "/api/telegram-chats");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      items: [
        {
          chatId: -5555,
          title: "CAA",
          type: "supergroup",
          firstSeenAt: "2024-03-09T12:07:00.000Z",
          lastActivityAt: "2024-03-09T12:07:00.000Z",
          lastUpdateId: 1005,
          isAuditChat: false,
          isCaaChat: true,
        },
        {
          chatId: -1002829359850,
          title: "Policornis",
          type: "supergroup",
          firstSeenAt: "2024-03-09T12:00:00.000Z",
          lastActivityAt: "2024-03-09T12:06:00.000Z",
          lastUpdateId: 1004,
          isAuditChat: true,
          isCaaChat: false,
        },
      ],
    });
  });

  it("returns safe settings to caa members without privileged edit lists", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    const response = await sendApiRequest(env, "/api/settings", "caa_member", 100);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      settings: {
        groups: {
          auditChatId: -1002829359850,
          caaChatId: -5555,
        },
        memberActivityThresholds: {
          goodHours: 24,
          warmHours: 168,
        },
        messageRetention: {
          detailDays: 7,
        },
        canManagePrivilegedSettings: false,
        safeEnv: {
          initialAuditChatId: -1002829359850,
          defaultLanguage: "ca",
          defaultTimezone: "Europe/Madrid",
          hasCorsAllowedOrigins: false,
        },
        auditDataCounts: {
          rawEvents: 4,
          messages: 2,
          users: 2,
          mediaObjects: 0,
          membershipEvents: 0,
          membershipPeriods: 0,
          hourlyGroupMetrics: 0,
          hourlyUserMetrics: 2,
          monthlyUserSnapshots: 2,
          mediaBytes: 0,
        },
        auditUsage: {
          daily: expect.any(Array),
          monthToDate: {
            rawEvents: 0,
            messages: 0,
            mediaObjects: 0,
            mediaBytes: 0,
          },
        },
      },
    });
  });

  it("allows only superadmin to select CAA group", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      INSERT INTO telegram_chats (chat_id, title, type, first_seen_at, last_activity_at, last_update_id)
      VALUES (-7777, 'CAA nova', 'supergroup', '2024-03-09T12:08:00.000Z', '2024-03-09T12:08:00.000Z', 1006);
    `);

    const caaResponse = await sendApiRequest(env, "/api/settings/groups", "caa_member", 100, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auditChatId: -1002829359850,
        caaChatId: -7777,
      }),
    });
    const superadminResponse = await sendApiRequest(env, "/api/settings/groups", "superadmin", 999, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auditChatId: -1002829359850,
        caaChatId: -7777,
      }),
    });

    expect(caaResponse.status).toBe(403);
    expect(await caaResponse.json()).toEqual({
      ok: false,
      message: "superadmin role required",
    });
    expect(superadminResponse.status).toBe(200);
    expect(await superadminResponse.json()).toEqual({
      ok: true,
      settings: {
        groups: {
          auditChatId: -1002829359850,
          caaChatId: -7777,
        },
        memberActivityThresholds: {
          goodHours: 24,
          warmHours: 168,
        },
        messageRetention: {
          detailDays: 7,
        },
        canManagePrivilegedSettings: true,
        safeEnv: {
          initialAuditChatId: -1002829359850,
          defaultLanguage: "ca",
          defaultTimezone: "Europe/Madrid",
          hasCorsAllowedOrigins: false,
        },
        auditDataCounts: {
          rawEvents: 4,
          messages: 2,
          users: 2,
          mediaObjects: 0,
          membershipEvents: 0,
          membershipPeriods: 0,
          hourlyGroupMetrics: 0,
          hourlyUserMetrics: 2,
          monthlyUserSnapshots: 2,
          mediaBytes: 0,
        },
        auditUsage: {
          daily: expect.any(Array),
          monthToDate: {
            rawEvents: 0,
            messages: 0,
            mediaObjects: 0,
            mediaBytes: 0,
          },
        },
      },
    });
    expect(db.sqlite.prepare("SELECT value_json FROM settings WHERE key = 'groups.caa_chat_id'").get()).toEqual({
      value_json: "-7777",
    });
  });

  it("allows only superadmin to update member activity thresholds", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);

    const caaResponse = await sendApiRequest(env, "/api/settings/members/activity-thresholds", "caa_member", 100, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goodHours: 12,
        warmHours: 96,
      }),
    });
    const superadminResponse = await sendApiRequest(env, "/api/settings/members/activity-thresholds", "superadmin", 999, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goodHours: 12,
        warmHours: 96,
      }),
    });

    expect(caaResponse.status).toBe(403);
    expect(superadminResponse.status).toBe(200);
    expect((await superadminResponse.json()).settings.memberActivityThresholds).toEqual({
      goodHours: 12,
      warmHours: 96,
    });
    expect(db.sqlite.prepare("SELECT value_json FROM settings WHERE key = 'members.activity_thresholds'").get()).toEqual({
      value_json: "{\"goodHours\":12,\"warmHours\":96}",
    });
  });

  it("allows caa members to update message retention and announces it to CAA", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockClear();

    const response = await sendApiRequest(env, "/api/settings/privacy/message-retention", "caa_member", 100, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detailDays: 5,
      }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).settings.messageRetention).toEqual({
      detailDays: 5,
    });
    expect(db.sqlite.prepare("SELECT value_json FROM settings WHERE key = 'privacy.message_detail_retention_days'").get()).toEqual({
      value_json: "5",
    });
    const sendMessageCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    expect(JSON.parse(String(sendMessageCall?.[1]?.body))).toEqual({
      chat_id: -5555,
      text: "Kornibot: session-user ha canviat la retencio de missatges a 5 dies. El canvi s'aplicara al proper cron.",
      disable_web_page_preview: true,
    });
  });

  it("requires reset before changing audited group with existing audit data", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      INSERT INTO telegram_chats (chat_id, title, type, first_seen_at, last_activity_at, last_update_id)
      VALUES (-2222, 'Policornis nou', 'supergroup', '2024-03-09T12:08:00.000Z', '2024-03-09T12:08:00.000Z', 1006);
    `);

    const response = await sendApiRequest(env, "/api/settings/groups", "superadmin", 999, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auditChatId: -2222,
        caaChatId: -5555,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      message: "audit group change requires audit reset",
    });
  });

  it("resets audit data when superadmin changes the audited group", async () => {
    const { db, bucket, env } = createEnv();
    seedDashboardFixture(db);
    db.sqlite.exec(`
      INSERT INTO telegram_chats (chat_id, title, type, first_seen_at, last_activity_at, last_update_id)
      VALUES (-2222, 'Policornis nou', 'supergroup', '2024-03-09T12:08:00.000Z', '2024-03-09T12:08:00.000Z', 1006);
      INSERT INTO media_objects (
        chat_id, message_id, telegram_file_id, telegram_file_unique_id, kind, r2_key
      )
      VALUES (-1002829359850, 10, 'file-1', 'unique-file-1', 'document', 'telegram/-1002829359850/10/document-unique-file-1');
      INSERT INTO birthday_cards (
        scope_type, state, r2_key, file_name, mime_type, size_bytes, uploaded_by_user_id
      )
      VALUES ('global', 'available', 'birthday/cards/global-one', 'global.png', 'image/png', 8, 999);
    `);

    const caaResponse = await sendApiRequest(env, "/api/settings/audit-group-reset", "caa_member", 100, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nextAuditChatId: -2222,
        confirmation: "PURGE AUDIT DATA",
      }),
    });
    const superadminResponse = await sendApiRequest(env, "/api/settings/audit-group-reset", "superadmin", 999, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nextAuditChatId: -2222,
        confirmation: "PURGE AUDIT DATA",
      }),
    });

    expect(caaResponse.status).toBe(403);
    expect(await caaResponse.json()).toEqual({
      ok: false,
      message: "superadmin role required",
    });
    expect(superadminResponse.status).toBe(200);
    expect(await superadminResponse.json()).toEqual({
      ok: true,
      reset: {
        previousAuditChatId: -1002829359850,
        nextAuditChatId: -2222,
        deletedMediaObjects: 2,
      },
    });
    expect(bucket.deletedKeys).toEqual([
      "birthday/cards/global-one",
      "telegram/-1002829359850/10/document-unique-file-1",
    ]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM birthday_cards").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT value_json FROM settings WHERE key = 'groups.audit_chat_id'").get()).toEqual({
      value_json: "-2222",
    });
    expect(db.sqlite.prepare("SELECT previous_audit_chat_id, next_audit_chat_id FROM audit_group_resets").get()).toEqual({
      previous_audit_chat_id: -1002829359850,
      next_audit_chat_id: -2222,
    });
  });

  it("rejects bearer sessions for the read api", async () => {
    const { db, env } = createEnv();
    seedDashboardFixture(db);
    const token = await createSessionToken(env, {
      userId: 3003,
      username: "lin",
      role: "caa_member",
    });

    const request = new Request("https://example.com/api/feed?limit=1", {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const response = await worker.fetch(request, env, createExecutionContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      message: "missing or invalid session",
    });
  });
});
