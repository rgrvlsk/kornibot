import { afterEach, describe, expect, it, vi } from "vitest";

import { closeD1Databases, createExecutionContext, FakeR2Bucket, SqliteD1Database } from "../helpers/worker-test-env";
import type { Env } from "../../src/shared/env";
import { createSessionCookie } from "../../src/worker/services/auth/session";
import { ensureUpcomingBirthdayWindows } from "../../src/worker/services/birthday/birthday-service";
import worker from "../../src/worker/index";

const contexts: SqliteD1Database[] = [];

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

function seedFixture(db: SqliteD1Database): void {
  db.sqlite.exec(`
    INSERT INTO users (user_id, username, first_name, last_membership_status, updated_at)
    VALUES
      (100, 'ada', 'Ada', 'member', '2026-05-01T00:00:00.000Z'),
      (200, 'lin', 'Lin', 'member', '2026-05-01T00:00:00.000Z');

    INSERT INTO settings (key, value_json)
    VALUES
      ('groups.audit_chat_id', '-1002829359850'),
      ('groups.caa_chat_id', '-5555');

    INSERT INTO auth_roles (user_id, role, granted_via, is_active)
    VALUES (999, 'superadmin', 'bootstrap', 1);
  `);
}

async function sendApiRequest(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("cookie", await createSessionCookie(env, {
    userId: 999,
    username: "staff",
    role: "superadmin",
  }));

  return worker.fetch(new Request(`https://example.com${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  }), env, createExecutionContext());
}

afterEach(() => {
  vi.useRealTimers();
  closeD1Databases(contexts);
});

describe("birthday api", () => {
  it("lets staff save and hard-delete a member birthday preference from the profile API", async () => {
    const { db, env } = createEnv();
    seedFixture(db);

    const saveResponse = await sendApiRequest(env, "/api/users/100/birthday", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: 4,
        day: 23,
        year: 1990,
        wantsAiCard: true,
        promptIdeas: ["books", "hiking"],
      }),
    });
    const profileResponse = await sendApiRequest(env, "/api/users/100");

    expect(saveResponse.status).toBe(200);
    expect(await profileResponse.json()).toMatchObject({
      ok: true,
      birthday: {
        month: 4,
        day: 23,
        year: 1990,
        wantsAiCard: true,
        promptIdeas: ["books", "hiking"],
      },
    });

    const deleteResponse = await sendApiRequest(env, "/api/users/100/birthday", { method: "DELETE" });

    expect(deleteResponse.status).toBe(204);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM birthday_preferences").get()).toEqual({ count: 0 });
  });

  it("normalizes two-digit birthday years and rejects unrealistic ages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    const { db, env } = createEnv();
    seedFixture(db);

    const saveResponse = await sendApiRequest(env, "/api/users/100/birthday", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: 4,
        day: 23,
        year: 90,
        wantsAiCard: false,
        promptIdeas: [],
      }),
    });
    const tooYoungResponse = await sendApiRequest(env, "/api/users/100/birthday", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: 4,
        day: 23,
        year: 2015,
        wantsAiCard: false,
        promptIdeas: [],
      }),
    });
    const tooOldResponse = await sendApiRequest(env, "/api/users/100/birthday", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: 4,
        day: 23,
        year: 1940,
        wantsAiCard: false,
        promptIdeas: [],
      }),
    });

    expect(saveResponse.status).toBe(200);
    expect(tooYoungResponse.status).toBe(400);
    expect(tooOldResponse.status).toBe(400);
    expect(db.sqlite.prepare("SELECT year FROM birthday_preferences WHERE user_id = 100").get()).toEqual({
      year: 1990,
    });
  });

  it("manages windows, uploads cards, serves card images, and reports almanac demand warnings", async () => {
    const { db, bucket, env } = createEnv();
    seedFixture(db);
    db.sqlite.exec(`
      INSERT INTO birthday_preferences (user_id, month, day, year, wants_ai_card, prompt_ideas_json)
      VALUES
        (100, 5, 31, NULL, 1, '[]'),
        (200, 5, 31, NULL, 1, '[]');
    `);

    const windowResponse = await sendApiRequest(env, "/api/birthday/windows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Sant Joan",
        startsOn: "2026-05-30",
        endsOn: "2026-06-24",
        color: "#ffad2f",
        presetKey: "sant_joan",
        enabled: true,
      }),
    });
    const windowPayload = await windowResponse.json() as { window: { id: number } };

    const uploadForm = new FormData();
    uploadForm.set("scopeType", "window");
    uploadForm.set("windowId", String(windowPayload.window.id));
    uploadForm.set("file", new Blob(["image-one"], { type: "image/png" }), "joan.png");
    const cardResponse = await sendApiRequest(env, "/api/birthday/cards", {
      method: "POST",
      body: uploadForm,
    });
    const cardPayload = await cardResponse.json() as { card: { id: number; r2Key: string } };

    const imageResponse = await sendApiRequest(env, `/api/birthday/cards/${cardPayload.card.id}/image`);
    const cardsResponse = await sendApiRequest(env, "/api/birthday/cards");
    const almanacResponse = await sendApiRequest(env, "/api/birthday/almanac?months=1&from=2026-05-01");

    expect(windowResponse.status).toBe(200);
    expect(cardResponse.status).toBe(200);
    expect(bucket.puts).toEqual([
      expect.objectContaining({
        key: cardPayload.card.r2Key,
        body: "image-one",
        httpMetadata: { contentType: "image/png" },
      }),
    ]);
    expect(imageResponse.status).toBe(200);
    expect(await imageResponse.text()).toBe("image-one");
    expect(await cardsResponse.json()).toMatchObject({
      ok: true,
      cards: [
        {
          id: cardPayload.card.id,
          scopeType: "window",
          state: "available",
        },
      ],
    });
    expect(await almanacResponse.json()).toMatchObject({
      ok: true,
      warnings: [
        {
          date: "2026-05-31",
          neededGenericCards: 2,
          availableGenericCards: 1,
        },
      ],
    });
  });

  it("tracks generic card usage across future birthday dates", async () => {
    const { db, env } = createEnv();
    seedFixture(db);
    db.sqlite.exec(`
      INSERT INTO birthday_preferences (user_id, month, day, year, wants_ai_card, prompt_ideas_json)
      VALUES
        (100, 5, 31, NULL, 1, '[]'),
        (200, 6, 1, NULL, 1, '[]');

      INSERT INTO birthday_cards (
        id, scope_type, state, r2_key, file_name, mime_type, size_bytes, uploaded_by_user_id
      )
      VALUES
        (1, 'global', 'available', 'birthday/cards/global-one', 'global.png', 'image/png', 8, 999);
    `);

    const response = await sendApiRequest(env, "/api/birthday/almanac?months=1&from=2026-05-31");

    expect(await response.json()).toMatchObject({
      ok: true,
      warnings: [
        {
          date: "2026-06-01",
          neededGenericCards: 1,
          availableGenericCards: 0,
        },
      ],
    });
  });

  it("rejects invalid birthday almanac query dates", async () => {
    const { db, env } = createEnv();
    seedFixture(db);

    const response = await sendApiRequest(env, "/api/birthday/almanac?months=1&from=bogus");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      message: "from must use YYYY-MM-DD",
    });
  });

  it("rejects invalid birthday window patches", async () => {
    const { db, env } = createEnv();
    seedFixture(db);

    const createResponse = await sendApiRequest(env, "/api/birthday/windows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Sant Joan",
        startsOn: "2026-06-18",
        endsOn: "2026-06-25",
        color: "#ffad2f",
        enabled: true,
      }),
    });
    const createPayload = await createResponse.json() as { window: { id: number } };

    const reversedResponse = await sendApiRequest(env, `/api/birthday/windows/${createPayload.window.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startsOn: "2026-06-30",
        endsOn: "2026-06-18",
      }),
    });
    const malformedResponse = await sendApiRequest(env, `/api/birthday/windows/${createPayload.window.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "",
        startsOn: "not-a-date",
      }),
    });

    expect(reversedResponse.status).toBe(400);
    expect(malformedResponse.status).toBe(400);
    expect(db.sqlite.prepare("SELECT label, starts_on, ends_on FROM birthday_windows WHERE id = ?").get(createPayload.window.id)).toEqual({
      label: "Sant Joan",
      starts_on: "2026-06-18",
      ends_on: "2026-06-25",
    });
  });

  it("lets staff delete birthday windows", async () => {
    const { db, env } = createEnv();
    seedFixture(db);

    const createResponse = await sendApiRequest(env, "/api/birthday/windows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Nadal llarg",
        startsOn: "2026-12-20",
        endsOn: "2027-01-10",
        color: "#7ab7ff",
        enabled: true,
      }),
    });
    const createPayload = await createResponse.json() as { window: { id: number } };

    const deleteResponse = await sendApiRequest(env, `/api/birthday/windows/${createPayload.window.id}`, {
      method: "DELETE",
    });
    const missingResponse = await sendApiRequest(env, `/api/birthday/windows/${createPayload.window.id}`, {
      method: "DELETE",
    });

    expect(deleteResponse.status).toBe(204);
    expect(missingResponse.status).toBe(404);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM birthday_windows WHERE id = ?").get(createPayload.window.id)).toEqual({
      count: 0,
    });
  });

  it("fills missing preset windows without duplicating existing preset dates", async () => {
    const { db } = createEnv();

    db.sqlite.exec(`
      INSERT INTO birthday_windows (
        preset_key,
        label,
        starts_on,
        ends_on,
        color,
        enabled,
        updated_at
      )
      VALUES ('sant_joan', 'Sant Joan', '2026-06-18', '2026-06-25', '#ffad2f', 1, '2026-05-31T00:00:00.000Z');
    `);

    await ensureUpcomingBirthdayWindows(db as unknown as D1Database, new Date("2026-05-31T00:00:00.000Z"));

    const duplicateInsert = db.sqlite.prepare(`
      INSERT OR IGNORE INTO birthday_windows (
        preset_key,
        label,
        starts_on,
        ends_on,
        color,
        enabled,
        updated_at
      )
      VALUES ('sant_joan', 'Sant Joan', '2026-06-18', '2026-06-25', '#ffad2f', 1, '2026-05-31T00:00:00.000Z')
    `).run();

    expect(Number(duplicateInsert.changes)).toBe(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM birthday_windows").get()).toEqual({ count: 42 });
    expect(db.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT preset_key, starts_on
        FROM birthday_windows
        WHERE preset_key IS NOT NULL
        GROUP BY preset_key, starts_on
        HAVING COUNT(*) > 1
      )
    `).get()).toEqual({ count: 0 });
  });

  it("rejects invalid birthday card states", async () => {
    const { db, env } = createEnv();
    seedFixture(db);
    db.sqlite.exec(`
      INSERT INTO birthday_cards (
        id, scope_type, state, r2_key, file_name, mime_type, size_bytes, uploaded_by_user_id
      )
      VALUES (1, 'global', 'available', 'birthday/cards/global-one', 'global.png', 'image/png', 8, 999);
    `);

    const response = await sendApiRequest(env, "/api/birthday/cards/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "bogus" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      message: "invalid birthday card state",
    });
    expect(db.sqlite.prepare("SELECT state FROM birthday_cards WHERE id = 1").get()).toEqual({
      state: "available",
    });
  });

  it("paginates birthday card listings", async () => {
    const { db, env } = createEnv();
    seedFixture(db);
    db.sqlite.exec(`
      INSERT INTO birthday_cards (
        id, scope_type, state, r2_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_at
      )
      VALUES
        (1, 'global', 'available', 'birthday/cards/one', 'one.png', 'image/png', 8, 999, '2026-05-01T00:00:00.000Z'),
        (2, 'global', 'available', 'birthday/cards/two', 'two.png', 'image/png', 8, 999, '2026-05-02T00:00:00.000Z'),
        (3, 'global', 'available', 'birthday/cards/three', 'three.png', 'image/png', 8, 999, '2026-05-03T00:00:00.000Z');
    `);

    const firstResponse = await sendApiRequest(env, "/api/birthday/cards?limit=2");
    const secondResponse = await sendApiRequest(env, "/api/birthday/cards?limit=2&cursor=2");

    expect(await firstResponse.json()).toMatchObject({
      ok: true,
      cards: [
        { id: 3 },
        { id: 2 },
      ],
      nextCursor: 2,
    });
    expect(await secondResponse.json()).toMatchObject({
      ok: true,
      cards: [
        { id: 1 },
      ],
      nextCursor: null,
    });
  });

  it("seeds preset birthday windows only once", async () => {
    const { db } = createEnv();

    await ensureUpcomingBirthdayWindows(db as unknown as D1Database, new Date("2026-05-31T00:00:00.000Z"));
    const firstWindow = db.sqlite.prepare(`
      SELECT id, starts_on
      FROM birthday_windows
      WHERE preset_key = 'sant_joan'
      ORDER BY starts_on ASC
      LIMIT 1
    `).get() as { id: number; starts_on: string };
    db.sqlite.prepare("UPDATE birthday_windows SET starts_on = ? WHERE id = ?")
      .run("2026-06-19", firstWindow.id);

    await ensureUpcomingBirthdayWindows(db as unknown as D1Database, new Date("2026-05-31T00:00:00.000Z"));

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM birthday_windows").get()).toEqual({ count: 42 });
    expect(db.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM birthday_windows
      WHERE preset_key = 'sant_joan'
        AND starts_on = ?
    `).get(firstWindow.starts_on)).toEqual({ count: 0 });
  });
});
