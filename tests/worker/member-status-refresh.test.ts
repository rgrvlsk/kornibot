import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeD1Databases, createExecutionContextWithWaits, FakeR2Bucket, SqliteD1Database } from "../helpers/worker-test-env";
import type { Env } from "../../src/shared/env";
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
    INITIAL_AUDIT_CHAT_ID: "-1002829359850",
  };

  return { db, env };
}

function seedFixture(db: SqliteD1Database): void {
  db.sqlite.exec(`
    INSERT INTO users (user_id, username, first_name, updated_at)
    VALUES
      (100, 'ada', 'Ada', '2026-05-06T12:00:00.000Z'),
      (200, 'lin', 'Lin', '2026-05-06T12:00:00.000Z');

    INSERT INTO settings (key, value_json)
    VALUES
      ('groups.audit_chat_id', '-1002829359850'),
      ('groups.caa_chat_id', '-5555');

    INSERT INTO auth_roles (user_id, role, granted_via, is_active)
    VALUES (100, 'caa_member', 'telegram_caa', 1);
  `);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/setMyCommands")) {
      return new Response(JSON.stringify({
        ok: true,
        result: true,
      }), {
        headers: { "content-type": "application/json" },
      });
    }

    const chatId = url.searchParams.get("chat_id");
    const userId = url.searchParams.get("user_id");
    const status = chatId === "-1002829359850"
      ? (userId === "100" ? "member" : "left")
      : (userId === "200" ? "member" : "left");

    return new Response(JSON.stringify({
      ok: true,
      result: { status },
    }), {
      headers: { "content-type": "application/json" },
    });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  closeD1Databases(contexts);
});

describe("member status refresh", () => {
  it("runs once per day from the scheduled handler and updates known members", async () => {
    const { db, env } = createEnv();
    seedFixture(db);
    const ctx = createExecutionContextWithWaits();

    await worker.scheduled({
      cron: "0 * * * *",
      scheduledTime: Date.parse("2026-05-07T04:00:00.000Z"),
      type: "scheduled",
    } as ScheduledController, env, ctx);
    await Promise.all(ctx.waits);

    expect(
      db.sqlite.prepare(`
        SELECT user_id, last_membership_status, last_membership_checked_at
        FROM users
        ORDER BY user_id
      `).all(),
    ).toEqual([
      {
        user_id: 100,
        last_membership_status: "member",
        last_membership_checked_at: "2026-05-07T04:00:00.000Z",
      },
      {
        user_id: 200,
        last_membership_status: "left",
        last_membership_checked_at: "2026-05-07T04:00:00.000Z",
      },
    ]);
    expect(
      db.sqlite.prepare(`
        SELECT user_id, role, is_active
        FROM auth_roles
        WHERE role = 'caa_member'
        ORDER BY user_id
      `).all(),
    ).toEqual([
      { user_id: 100, role: "caa_member", is_active: 0 },
      { user_id: 200, role: "caa_member", is_active: 1 },
    ]);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM member_status_checks").get(),
    ).toEqual({ count: 2 });
    const commandCalls = vi.mocked(globalThis.fetch).mock.calls
      .filter(([input]) => String(input).includes("/setMyCommands"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as {
        scope?: { type?: string; chat_id?: number };
        commands?: Array<{ command: string }>;
      });
    expect(commandCalls).toEqual([
      {
        scope: { type: "chat", chat_id: 100 },
        commands: [
          { command: "menu", description: "Mostra les comandes disponibles" },
          { command: "aniversari", description: "Guarda el teu aniversari" },
        ],
      },
      {
        scope: { type: "chat", chat_id: 200 },
        commands: [
          { command: "menu", description: "Mostra les comandes disponibles" },
          { command: "felicitacions", description: "Puja imatges de felicitacio" },
        ],
      },
    ]);

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockClear();
    const secondCtx = createExecutionContextWithWaits();
    await worker.scheduled({
      cron: "0 * * * *",
      scheduledTime: Date.parse("2026-05-07T05:00:00.000Z"),
      type: "scheduled",
    } as ScheduledController, env, secondCtx);
    await Promise.all(secondCtx.waits);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
