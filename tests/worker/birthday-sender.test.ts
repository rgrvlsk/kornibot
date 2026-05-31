import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeD1Databases, FakeR2Bucket, SqliteD1Database } from "../helpers/worker-test-env";
import type { Env } from "../../src/shared/env";
import { runBirthdayGreetingSender } from "../../src/worker/services/birthday/birthday-sender";

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

function seedFixture(db: SqliteD1Database): void {
  db.sqlite.exec(`
    INSERT INTO users (user_id, username, first_name, last_membership_status, updated_at)
    VALUES
      (100, 'ada', 'Ada', 'member', '2026-05-01T00:00:00.000Z'),
      (200, 'lin', 'Lin', 'member', '2026-05-01T00:00:00.000Z');

    INSERT INTO settings (key, value_json)
    VALUES ('groups.audit_chat_id', '-1002829359850');

    INSERT INTO birthday_preferences (user_id, month, day, year, wants_ai_card, prompt_ideas_json)
    VALUES
      (100, 5, 31, 1990, 1, '["books"]'),
      (200, 5, 31, NULL, 1, '[]');

    INSERT INTO birthday_cards (
      id, scope_type, state, r2_key, file_name, mime_type, size_bytes, uploaded_by_user_id
    )
    VALUES
      (1, 'global', 'available', 'birthday/cards/global-one', 'global.png', 'image/png', 8, 999);
  `);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/getChatMember")) {
      return new Response(JSON.stringify({ ok: true, result: { status: "member" } }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/sendPhoto") || url.pathname.endsWith("/sendMessage")) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 700 } }), {
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`unexpected Telegram call: ${url.pathname}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  closeD1Databases(contexts);
});

describe("birthday greeting sender", () => {
  it("reserves one generic image once and logs text fallback for the second member", async () => {
    const { db, bucket, env } = createEnv();
    seedFixture(db);
    await bucket.put("birthday/cards/global-one", "image-one", {
      httpMetadata: { contentType: "image/png" },
    });

    const result = await runBirthdayGreetingSender(env, new Date("2026-05-31T06:08:00.000Z"));
    const retry = await runBirthdayGreetingSender(env, new Date("2026-05-31T06:08:30.000Z"));

    expect(result).toEqual({ checked: 2, sent: 2, skipped: 0 });
    expect(retry).toEqual({ checked: 0, sent: 0, skipped: 2 });
    expect(
      db.sqlite.prepare("SELECT id, state, used_for_user_id FROM birthday_cards").all(),
    ).toEqual([{ id: 1, state: "used", used_for_user_id: 100 }]);
    expect(
      db.sqlite.prepare(`
        SELECT user_id, celebration_date, status, birthday_card_id
        FROM birthday_send_log
        ORDER BY user_id
      `).all(),
    ).toEqual([
      { user_id: 100, celebration_date: "2026-05-31", status: "sent", birthday_card_id: 1 },
      { user_id: 200, celebration_date: "2026-05-31", status: "sent", birthday_card_id: null },
    ]);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input).includes("/sendPhoto"))).toHaveLength(1);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input).includes("/sendMessage"))).toHaveLength(1);
  });

  it("retries transient member checks before marking a birthday skipped", async () => {
    const { db, env } = createEnv();
    db.sqlite.exec(`
      INSERT INTO users (user_id, username, first_name, last_membership_status, updated_at)
      VALUES (100, 'ada', 'Ada', 'member', '2026-05-01T00:00:00.000Z');

      INSERT INTO settings (key, value_json)
      VALUES ('groups.audit_chat_id', '-1002829359850');

      INSERT INTO birthday_preferences (user_id, month, day, year, wants_ai_card, prompt_ideas_json)
      VALUES (100, 5, 31, NULL, 0, '[]');
    `);

    let memberChecks = 0;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/getChatMember")) {
        memberChecks += 1;
        if (memberChecks === 1) {
          return new Response(JSON.stringify({ ok: false }), { status: 502 });
        }
        return new Response(JSON.stringify({ ok: true, result: { status: "member" } }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/sendMessage")) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 701 } }), {
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`unexpected Telegram call: ${url.pathname}`);
    }));

    const result = await runBirthdayGreetingSender(env, new Date("2026-05-31T06:08:00.000Z"));

    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0 });
    expect(memberChecks).toBe(2);
    expect(db.sqlite.prepare("SELECT status, telegram_message_id FROM birthday_send_log").get()).toEqual({
      status: "sent",
      telegram_message_id: 701,
    });
  });

  it("keeps failed member checks recoverable for a later sender run", async () => {
    const { db, env } = createEnv();
    db.sqlite.exec(`
      INSERT INTO users (user_id, username, first_name, last_membership_status, updated_at)
      VALUES (100, 'ada', 'Ada', 'member', '2026-05-01T00:00:00.000Z');

      INSERT INTO settings (key, value_json)
      VALUES ('groups.audit_chat_id', '-1002829359850');

      INSERT INTO birthday_preferences (user_id, month, day, year, wants_ai_card, prompt_ideas_json)
      VALUES (100, 5, 31, NULL, 0, '[]');
    `);

    let memberChecksRecover = false;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/getChatMember")) {
        if (!memberChecksRecover) {
          return new Response(JSON.stringify({ ok: false }), { status: 502 });
        }
        return new Response(JSON.stringify({ ok: true, result: { status: "member" } }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/sendMessage")) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 704 } }), {
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`unexpected Telegram call: ${url.pathname}`);
    }));

    const failed = await runBirthdayGreetingSender(env, new Date("2026-05-31T06:08:00.000Z"));

    expect(failed).toEqual({ checked: 1, sent: 0, skipped: 1 });
    expect(db.sqlite.prepare("SELECT status FROM birthday_send_log WHERE user_id = 100").get()).toEqual({
      status: "failed",
    });

    memberChecksRecover = true;
    const recovered = await runBirthdayGreetingSender(env, new Date("2026-05-31T06:08:30.000Z"));

    expect(recovered).toEqual({ checked: 1, sent: 1, skipped: 0 });
    expect(db.sqlite.prepare("SELECT status, telegram_message_id FROM birthday_send_log WHERE user_id = 100").get()).toEqual({
      status: "sent",
      telegram_message_id: 704,
    });
  });

  it("retries transient Telegram send failures before failing the birthday", async () => {
    const { db, bucket, env } = createEnv();
    seedFixture(db);
    await bucket.put("birthday/cards/global-one", "image-one", {
      httpMetadata: { contentType: "image/png" },
    });

    let photoAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/getChatMember")) {
        return new Response(JSON.stringify({ ok: true, result: { status: "member" } }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/sendPhoto")) {
        photoAttempts += 1;
        if (photoAttempts === 1) {
          return new Response(JSON.stringify({ ok: false, description: "temporary" }), { status: 502 });
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 702 } }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/sendMessage")) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 703 } }), {
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`unexpected Telegram call: ${url.pathname}`);
    }));

    const result = await runBirthdayGreetingSender(env, new Date("2026-05-31T06:08:00.000Z"));

    expect(result).toEqual({ checked: 2, sent: 2, skipped: 0 });
    expect(photoAttempts).toBe(2);
    expect(db.sqlite.prepare("SELECT status, birthday_card_id FROM birthday_send_log WHERE user_id = 100").get()).toEqual({
      status: "sent",
      birthday_card_id: 1,
    });
  });
});
