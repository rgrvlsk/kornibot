import { afterEach, describe, expect, it, vi } from "vitest";

import { closeD1Databases, createExecutionContext, FakeR2Bucket, SqliteD1Database } from "../helpers/worker-test-env";
import worker from "../../src/worker/index";
import type { Env } from "../../src/shared/env";

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
    INITIAL_AUDIT_CHAT_ID: "-1002829359850",
  };

  return { db, bucket, env };
}

async function sendWebhookUpdate(env: Env, payload: unknown, secret = "super-secret"): Promise<Response> {
  const request = new Request("https://example.com/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(payload),
  });

  return worker.fetch(request, env, createExecutionContext());
}

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  closeD1Databases(contexts);
});

describe("telegram webhook", () => {
  it("accepts a valid webhook request", async () => {
    const { db, env } = createEnv();

    const response = await sendWebhookUpdate(env, {
      update_id: 1,
      message: {
        message_id: 11,
        date: 1_710_000_000,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 42, is_bot: false, first_name: "Roger", username: "agt_ksg" },
        text: "hola",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "telegram update processed" });

    const rawEvent = db.sqlite
      .prepare("SELECT update_id, event_kind FROM raw_events WHERE update_id = 1")
      .get() as { update_id: number; event_kind: string } | undefined;

    expect(rawEvent).toEqual({ update_id: 1, event_kind: "message" });
  });

  it("rejects an invalid webhook secret", async () => {
    const { db, env } = createEnv();

    const response = await sendWebhookUpdate(
      env,
      {
        update_id: 2,
        message: {
          message_id: 12,
          date: 1_710_000_001,
          chat: { id: -1002829359850, type: "supergroup" },
          from: { id: 42, is_bot: false, first_name: "Roger" },
          text: "hidden",
        },
      },
      "wrong-secret",
    );

    expect(response.status).toBe(401);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 0 });
  });

  it("records detected chats before ignoring updates outside the audit group", async () => {
    const { db, env } = createEnv();

    const response = await sendWebhookUpdate(env, {
      update_id: 14,
      message: {
        message_id: 90,
        date: 1_710_000_120,
        chat: { id: 12345, type: "supergroup", title: "CAA" },
        from: { id: 900, is_bot: false, first_name: "Vic" },
        text: "wrong group",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "telegram update ignored" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare(`
        SELECT chat_id, title, type, first_seen_at, last_activity_at, last_update_id
        FROM telegram_chats
        WHERE chat_id = 12345
      `).get()).toEqual({
      chat_id: 12345,
      title: "CAA",
      type: "supergroup",
      first_seen_at: "2024-03-09T16:02:00.000Z",
      last_activity_at: "2024-03-09T16:02:00.000Z",
      last_update_id: 14,
    });
  });

  it("uses the configured audit group instead of a hardcoded target", async () => {
    const { db, env } = createEnv();
    db.sqlite.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES ('groups.audit_chat_id', ?)
    `).run(JSON.stringify(-2222));

    const ignoredResponse = await sendWebhookUpdate(env, {
      update_id: 15,
      message: {
        message_id: 91,
        date: 1_710_000_121,
        chat: { id: -1002829359850, type: "supergroup", title: "Policornis antic" },
        from: { id: 901, is_bot: false, first_name: "Nil" },
        text: "old group",
      },
    });
    const processedResponse = await sendWebhookUpdate(env, {
      update_id: 16,
      message: {
        message_id: 92,
        date: 1_710_000_122,
        chat: { id: -2222, type: "supergroup", title: "Policornis" },
        from: { id: 902, is_bot: false, first_name: "Ona" },
        text: "new audit group",
      },
    });

    expect(await ignoredResponse.json()).toEqual({ ok: true, message: "telegram update ignored" });
    expect(await processedResponse.json()).toEqual({ ok: true, message: "telegram update processed" });
    expect(
      db.sqlite.prepare("SELECT update_id, chat_id, message_id FROM raw_events ORDER BY update_id").all(),
    ).toEqual([
      { update_id: 16, chat_id: -2222, message_id: 92 },
    ]);
  });

  it("stores raw events and message projections for message updates", async () => {
    const { db, env } = createEnv();

    await sendWebhookUpdate(env, {
      update_id: 3,
      message: {
        message_id: 20,
        date: 1_710_000_010,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 100, is_bot: false, first_name: "Ada", username: "ada" },
        reply_to_message: { message_id: 10 },
        text: "reply message",
      },
    });

    expect(
      db.sqlite.prepare(
        "SELECT chat_id, message_id, from_user_id, current_text, reply_to_message_id FROM messages WHERE chat_id = ? AND message_id = ?",
      ).get(-1002829359850, 20),
    ).toEqual({
      chat_id: -1002829359850,
      message_id: 20,
      from_user_id: 100,
      current_text: "reply message",
      reply_to_message_id: 10,
    });

    expect(
      db.sqlite.prepare("SELECT root_message_id, parent_message_id FROM message_replies WHERE chat_id = ? AND message_id = ?").get(
        -1002829359850,
        20,
      ),
    ).toEqual({
      root_message_id: 10,
      parent_message_id: 10,
    });
  });

  it("captures forum topic message_thread_id", async () => {
    const { db, env } = createEnv();

    const response = await sendWebhookUpdate(env, {
      update_id: 101,
      message: {
        message_id: 210,
        message_thread_id: 9876,
        date: 1_710_000_220,
        chat: { id: -1002829359850, type: "supergroup", title: "Policornis" },
        from: { id: 301, is_bot: false, first_name: "Laia", username: "laia" },
        text: "topic message",
      },
    });

    expect(response.status).toBe(200);
    expect(
      db.sqlite.prepare("SELECT message_thread_id FROM messages WHERE chat_id = ? AND message_id = ?").get(-1002829359850, 210),
    ).toEqual({ message_thread_id: 9876 });
  });

  it("creates a new message version for edited messages", async () => {
    const { db, env } = createEnv();

    await sendWebhookUpdate(env, {
      update_id: 4,
      message: {
        message_id: 30,
        date: 1_710_000_020,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 200, is_bot: false, first_name: "Lin" },
        text: "before edit",
      },
    });

    await sendWebhookUpdate(env, {
      update_id: 5,
      edited_message: {
        message_id: 30,
        date: 1_710_000_020,
        edit_date: 1_710_000_030,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 200, is_bot: false, first_name: "Lin" },
        text: "after edit",
      },
    });

    expect(
      db.sqlite.prepare(
        "SELECT current_text, last_known_edit_at FROM messages WHERE chat_id = ? AND message_id = ?",
      ).get(-1002829359850, 30),
    ).toEqual({
      current_text: "after edit",
      last_known_edit_at: "2024-03-09T16:00:30.000Z",
    });

    expect(
      db.sqlite.prepare(
        "SELECT version_no, text FROM message_versions WHERE chat_id = ? AND message_id = ? ORDER BY version_no ASC",
      ).all(-1002829359850, 30),
    ).toEqual([
      { version_no: 1, text: "before edit" },
      { version_no: 2, text: "after edit" },
    ]);
  });

  it("treats duplicate update deliveries as idempotent", async () => {
    const { db, env } = createEnv();
    const payload = {
      update_id: 8,
      message: {
        message_id: 50,
        date: 1_710_000_060,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 500, is_bot: false, first_name: "Mara" },
        text: "same delivery twice",
      },
    };

    const firstResponse = await sendWebhookUpdate(env, payload);
    const secondResponse = await sendWebhookUpdate(env, payload);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE update_id = ?").get(8),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM message_versions WHERE chat_id = ? AND message_id = ?").get(-1002829359850, 50),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT projected_at IS NOT NULL AS projected FROM raw_events WHERE update_id = ?").get(8),
    ).toEqual({ projected: 1 });
  });

  it("stores reaction deltas for all changed reaction keys in an update", async () => {
    const { db, env } = createEnv();

    await sendWebhookUpdate(env, {
      update_id: 6,
      message: {
        message_id: 40,
        date: 1_710_000_040,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 300, is_bot: false, first_name: "Nia" },
        text: "react to me",
      },
    });

    await sendWebhookUpdate(env, {
      update_id: 7,
      message_reaction: {
        chat: { id: -1002829359850, type: "supergroup" },
        message_id: 40,
        date: 1_710_000_050,
        user: { id: 400, is_bot: false, first_name: "Kai" },
        old_reaction: [],
        new_reaction: [
          { type: "emoji", emoji: "⭐" },
          { type: "emoji", emoji: "🔥" },
        ],
      },
    });

    expect(
      db.sqlite.prepare(
        "SELECT reaction_key, is_active FROM reaction_events WHERE chat_id = ? AND message_id = ? ORDER BY reaction_key ASC",
      ).all(-1002829359850, 40),
    ).toEqual([
      { reaction_key: "emoji:⭐", is_active: 1 },
      { reaction_key: "emoji:🔥", is_active: 1 },
    ]);

    expect(
      db.sqlite.prepare(
        "SELECT reaction_key, is_active FROM message_reactions WHERE chat_id = ? AND message_id = ? ORDER BY reaction_key ASC",
      ).all(-1002829359850, 40),
    ).toEqual([
      { reaction_key: "emoji:⭐", is_active: 1 },
      { reaction_key: "emoji:🔥", is_active: 1 },
    ]);
  });

  it("tracks service-message joins and leaves with profile photo metadata", async () => {
    const { db, bucket, env } = createEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          total_count: 1,
          photos: [[
            {
              file_id: "small-photo",
              file_unique_id: "photo-unique-small",
              width: 160,
              height: 160,
            },
            {
              file_id: "large-photo",
              file_unique_id: "photo-unique-large",
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
          file_path: "profile/large-photo.jpg",
          file_size: 4096,
        },
      }), {
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("profile-bytes", {
        headers: { "content-type": "image/jpeg" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await sendWebhookUpdate(env, {
      update_id: 15,
      message: {
        message_id: 90,
        date: 1_710_000_120,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 1000, is_bot: false, first_name: "Inviter" },
        new_chat_members: [
          {
            id: 1001,
            is_bot: false,
            first_name: "Ada",
            last_name: "Lovelace",
            username: "ada",
            language_code: "ca",
          },
        ],
      },
    });

    await sendWebhookUpdate(env, {
      update_id: 16,
      message: {
        message_id: 91,
        date: 1_710_000_180,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 1001, is_bot: false, first_name: "Ada", last_name: "Lovelace", username: "ada" },
        left_chat_member: {
          id: 1001,
          is_bot: false,
          first_name: "Ada",
          last_name: "Lovelace",
          username: "ada",
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bucket.puts).toEqual([
      {
        key: "telegram/users/1001/profile-photo",
        body: "profile-bytes",
        httpMetadata: { contentType: "image/jpeg" },
      },
    ]);
    expect(
      db.sqlite.prepare(`
        SELECT
          user_id,
          username,
          first_name,
          last_name,
          nickname,
          language_code,
          profile_photo_file_id,
          profile_photo_file_unique_id,
          profile_photo_width,
          profile_photo_height,
          profile_photo_r2_key,
          profile_photo_mime_type,
          profile_photo_size_bytes,
          last_membership_status,
          last_joined_at,
          last_left_at
        FROM users
        WHERE user_id = ?
      `).get(1001),
    ).toEqual({
      user_id: 1001,
      username: "ada",
      first_name: "Ada",
      last_name: "Lovelace",
      nickname: "Ada Lovelace",
      language_code: "ca",
      profile_photo_file_id: "large-photo",
      profile_photo_file_unique_id: "photo-unique-large",
      profile_photo_width: 640,
      profile_photo_height: 640,
      profile_photo_r2_key: "telegram/users/1001/profile-photo",
      profile_photo_mime_type: "image/jpeg",
      profile_photo_size_bytes: 4096,
      last_membership_status: "left",
      last_joined_at: "2024-03-09T16:02:00.000Z",
      last_left_at: "2024-03-09T16:03:00.000Z",
    });
    expect(
      db.sqlite.prepare(`
        SELECT event_type, message_id, old_status, new_status
        FROM user_membership_events
        WHERE user_id = ?
        ORDER BY observed_at ASC
      `).all(1001),
    ).toEqual([
      {
        event_type: "joined",
        message_id: 90,
        old_status: null,
        new_status: "member",
      },
      {
        event_type: "left",
        message_id: 91,
        old_status: "member",
        new_status: "left",
      },
    ]);
    expect(
      db.sqlite.prepare(`
        SELECT joined_at, left_at
        FROM user_membership_periods
        WHERE user_id = ?
      `).all(1001),
    ).toEqual([
      {
        joined_at: "2024-03-09T16:02:00.000Z",
        left_at: "2024-03-09T16:03:00.000Z",
      },
    ]);
  });

  it("tracks chat_member status transitions across multiple periods", async () => {
    const { db, bucket, env } = createEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        total_count: 0,
        photos: [],
      },
    }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await sendWebhookUpdate(env, {
      update_id: 17,
      chat_member: {
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 2000, is_bot: false, first_name: "Admin" },
        date: 1_710_000_240,
        old_chat_member: {
          status: "left",
          user: { id: 2001, is_bot: false, first_name: "Kai", username: "kai" },
        },
        new_chat_member: {
          status: "member",
          user: { id: 2001, is_bot: false, first_name: "Kai", username: "kai" },
        },
      },
    });

    await sendWebhookUpdate(env, {
      update_id: 18,
      chat_member: {
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 2000, is_bot: false, first_name: "Admin" },
        date: 1_710_000_300,
        old_chat_member: {
          status: "member",
          user: { id: 2001, is_bot: false, first_name: "Kai", username: "kai" },
        },
        new_chat_member: {
          status: "left",
          user: { id: 2001, is_bot: false, first_name: "Kai", username: "kai" },
        },
      },
    });

    await sendWebhookUpdate(env, {
      update_id: 19,
      chat_member: {
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 2000, is_bot: false, first_name: "Admin" },
        date: 1_710_000_360,
        old_chat_member: {
          status: "left",
          user: { id: 2001, is_bot: false, first_name: "Kai", username: "kai" },
        },
        new_chat_member: {
          status: "member",
          user: { id: 2001, is_bot: false, first_name: "Kai", username: "kai" },
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bucket.deletes).toEqual(["telegram/users/2001/profile-photo"]);
    expect(
      db.sqlite.prepare(`
        SELECT event_kind, message_id, actor_user_id
        FROM raw_events
        WHERE update_id = ?
      `).get(17),
    ).toEqual({
      event_kind: "chat_member",
      message_id: null,
      actor_user_id: 2000,
    });
    expect(
      db.sqlite.prepare(`
        SELECT joined_at, left_at
        FROM user_membership_periods
        WHERE user_id = ?
        ORDER BY joined_at ASC
      `).all(2001),
    ).toEqual([
      {
        joined_at: "2024-03-09T16:04:00.000Z",
        left_at: "2024-03-09T16:05:00.000Z",
      },
      {
        joined_at: "2024-03-09T16:06:00.000Z",
        left_at: null,
      },
    ]);
  });

  it("repairs partial membership projection on retry", async () => {
    const { db, env } = createEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        total_count: 0,
        photos: [],
      },
    }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    db.sqlite.exec(`
      CREATE TRIGGER fail_membership_period_once
      BEFORE INSERT ON user_membership_periods
      WHEN NEW.user_id = 3001
      BEGIN
        SELECT RAISE(FAIL, 'forced membership period failure');
      END;
    `);

    const payload = {
      update_id: 20,
      chat_member: {
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 3000, is_bot: false, first_name: "Admin" },
        date: 1_710_000_420,
        old_chat_member: {
          status: "left",
          user: { id: 3001, is_bot: false, first_name: "Mia", username: "mia" },
        },
        new_chat_member: {
          status: "member",
          user: { id: 3001, is_bot: false, first_name: "Mia", username: "mia" },
        },
      },
    };

    await expect(sendWebhookUpdate(env, payload)).rejects.toThrow("forced membership period failure");

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM user_membership_events WHERE user_id = ?").get(3001),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM user_membership_periods WHERE user_id = ?").get(3001),
    ).toEqual({ count: 0 });

    db.sqlite.exec("DROP TRIGGER fail_membership_period_once");

    const retryResponse = await sendWebhookUpdate(env, payload);

    expect(retryResponse.status).toBe(200);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM user_membership_events WHERE user_id = ?").get(3001),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare(`
        SELECT joined_at, left_at
        FROM user_membership_periods
        WHERE user_id = ?
      `).all(3001),
    ).toEqual([
      {
        joined_at: "2024-03-09T16:07:00.000Z",
        left_at: null,
      },
    ]);
    expect(
      db.sqlite.prepare("SELECT projected_at IS NOT NULL AS projected FROM raw_events WHERE update_id = ?").get(20),
    ).toEqual({ projected: 1 });
  });

  it("preserves anonymous reactions without failing projection", async () => {
    const { db, env } = createEnv();

    await sendWebhookUpdate(env, {
      update_id: 9,
      message: {
        message_id: 60,
        date: 1_710_000_070,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 600, is_bot: false, first_name: "Ori" },
        text: "anonymous reaction target",
      },
    });

    const response = await sendWebhookUpdate(env, {
      update_id: 10,
      message_reaction: {
        chat: { id: -1002829359850, type: "supergroup" },
        message_id: 60,
        date: 1_710_000_080,
        old_reaction: [],
        new_reaction: [{ type: "emoji", emoji: "👀" }],
      },
    });

    expect(response.status).toBe(200);
    expect(
      db.sqlite.prepare("SELECT update_id, actor_user_id, event_kind FROM raw_events WHERE update_id = ?").get(10),
    ).toEqual({
      update_id: 10,
      actor_user_id: null,
      event_kind: "message_reaction",
    });
    expect(
      db.sqlite.prepare(
        "SELECT reaction_key, reactor_user_id, is_active FROM reaction_events WHERE chat_id = ? AND message_id = ?",
      ).all(-1002829359850, 60),
    ).toEqual([
      { reaction_key: "emoji:👀", reactor_user_id: null, is_active: 1 },
    ]);
    expect(
      db.sqlite.prepare(
        "SELECT COUNT(*) AS count FROM message_reactions WHERE chat_id = ? AND message_id = ?",
      ).get(-1002829359850, 60),
    ).toEqual({ count: 0 });
  });

  it("retries partial message projection without duplicating derived rows", async () => {
    const { db, env } = createEnv();

    db.sqlite.exec(`
      CREATE TRIGGER fail_message_version_once
      BEFORE INSERT ON message_versions
      WHEN NEW.text = 'retry projection'
      BEGIN
        SELECT RAISE(FAIL, 'forced message projection failure');
      END;
    `);

    const payload = {
      update_id: 11,
      message: {
        message_id: 70,
        date: 1_710_000_090,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 700, is_bot: false, first_name: "Una" },
        text: "retry projection",
      },
    };

    await expect(sendWebhookUpdate(env, payload)).rejects.toThrow("forced message projection failure");

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE update_id = ?").get(11),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT projected_at FROM raw_events WHERE update_id = ?").get(11),
    ).toEqual({ projected_at: null });

    db.sqlite.exec("DROP TRIGGER fail_message_version_once");

    const retryResponse = await sendWebhookUpdate(env, payload);

    expect(retryResponse.status).toBe(200);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM message_versions WHERE chat_id = ? AND message_id = ?").get(-1002829359850, 70),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT projected_at IS NOT NULL AS projected FROM raw_events WHERE update_id = ?").get(11),
    ).toEqual({ projected: 1 });
  });

  it("retries partial reaction projection without duplicating reaction events", async () => {
    const { db, env } = createEnv();

    await sendWebhookUpdate(env, {
      update_id: 12,
      message: {
        message_id: 80,
        date: 1_710_000_100,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 800, is_bot: false, first_name: "Pau" },
        text: "reaction retry target",
      },
    });

    db.sqlite.exec(`
      CREATE TRIGGER fail_reaction_projection_once
      BEFORE INSERT ON reaction_events
      WHEN NEW.reaction_key = 'custom_emoji:omega'
      BEGIN
        SELECT RAISE(FAIL, 'forced reaction projection failure');
      END;
    `);

    const payload = {
      update_id: 13,
      message_reaction: {
        chat: { id: -1002829359850, type: "supergroup" },
        message_id: 80,
        date: 1_710_000_110,
        user: { id: 810, is_bot: false, first_name: "Teo" },
        old_reaction: [],
        new_reaction: [
          { type: "custom_emoji", custom_emoji_id: "alpha" },
          { type: "custom_emoji", custom_emoji_id: "omega" },
        ],
      },
    };

    await expect(sendWebhookUpdate(env, payload)).rejects.toThrow("forced reaction projection failure");

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE update_id = ?").get(13),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare(
        "SELECT reaction_key FROM reaction_events WHERE source_raw_event_id = (SELECT id FROM raw_events WHERE update_id = ?) ORDER BY reaction_key ASC",
      ).all(13),
    ).toEqual([{ reaction_key: "custom_emoji:alpha" }]);

    db.sqlite.exec("DROP TRIGGER fail_reaction_projection_once");

    const retryResponse = await sendWebhookUpdate(env, payload);

    expect(retryResponse.status).toBe(200);
    expect(
      db.sqlite.prepare(
        "SELECT reaction_key FROM reaction_events WHERE source_raw_event_id = (SELECT id FROM raw_events WHERE update_id = ?) ORDER BY reaction_key ASC",
      ).all(13),
    ).toEqual([
      { reaction_key: "custom_emoji:alpha" },
      { reaction_key: "custom_emoji:omega" },
    ]);
    expect(
      db.sqlite.prepare(
        "SELECT COUNT(*) AS count FROM message_reactions WHERE chat_id = ? AND message_id = ?",
      ).get(-1002829359850, 80),
    ).toEqual({ count: 2 });
    expect(
      db.sqlite.prepare("SELECT projected_at IS NOT NULL AS projected FROM raw_events WHERE update_id = ?").get(13),
    ).toEqual({ projected: 1 });
  });
});
