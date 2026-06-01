import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeD1Databases, createExecutionContext, FakeR2Bucket, SqliteD1Database } from "../helpers/worker-test-env";
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
    TELEGRAM_BOT_USERNAME: "kornibot_bot",
  };

  return { db, env };
}

function seedSettings(db: SqliteD1Database): void {
  db.sqlite.exec(`
    INSERT INTO settings (key, value_json)
    VALUES
      ('groups.audit_chat_id', '-1002829359850'),
      ('groups.caa_chat_id', '-5555');
    INSERT INTO auth_roles (user_id, role, granted_via, is_active)
    VALUES (100, 'caa_member', 'telegram_caa', 1);
  `);
}

async function sendWebhookUpdate(env: Env, payload: unknown): Promise<Response> {
  return worker.fetch(new Request("https://example.com/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "super-secret",
    },
    body: JSON.stringify(payload),
  }), env, createExecutionContext());
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/getChatMember")) {
      return new Response(JSON.stringify({ ok: true, result: { status: "member" } }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/sendMessage") || url.pathname.endsWith("/answerCallbackQuery") || url.pathname.endsWith("/setMyCommands")) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`unexpected Telegram call: ${url.pathname}`);
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  closeD1Databases(contexts);
});

describe("birthday bot flows", () => {
  it("starts /aniversari in private chat without writing private messages to raw_events", async () => {
    const { db, env } = createEnv();
    seedSettings(db);

    const response = await sendWebhookUpdate(env, {
      update_id: 501,
      message: {
        message_id: 10,
        date: 1_778_000_000,
        chat: { id: 100, type: "private" },
        from: { id: 100, is_bot: false, first_name: "Ada", username: "ada" },
        text: "/aniversari",
      },
    });

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT user_id, flow, step FROM bot_flow_states").all()).toEqual([
      { user_id: 100, flow: "birthday", step: "month" },
    ]);
  });

  it("replies to group /aniversari with a deep link and still audits the command message", async () => {
    const { db, env } = createEnv();
    seedSettings(db);

    const response = await sendWebhookUpdate(env, {
      update_id: 502,
      message: {
        message_id: 11,
        date: 1_778_000_001,
        chat: { id: -1002829359850, type: "supergroup", title: "Policornis" },
        from: { id: 100, is_bot: false, first_name: "Ada", username: "ada" },
        text: "/aniversari",
      },
    });

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare("SELECT update_id, event_kind FROM raw_events").all()).toEqual([
      { update_id: 502, event_kind: "message" },
    ]);
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => String(input).includes("/sendMessage"))).toBe(true);
    const sendMessageCall = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).includes("/sendMessage"));
    const body = JSON.parse(String(sendMessageCall?.[1]?.body ?? "{}")) as { reply_markup?: { inline_keyboard?: Array<Array<{ url?: string }>> } };
    expect(body.reply_markup?.inline_keyboard?.[0]?.[0]?.url).toBe("https://t.me/kornibot_bot?start=aniversari");
  });

  it("starts /start aniversari deep links in private chat", async () => {
    const { db, env } = createEnv();
    seedSettings(db);

    const response = await sendWebhookUpdate(env, {
      update_id: 503,
      message: {
        message_id: 12,
        date: 1_778_000_002,
        chat: { id: 100, type: "private" },
        from: { id: 100, is_bot: false, first_name: "Ada", username: "ada" },
        text: "/start aniversari",
      },
    });

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare("SELECT user_id, flow, step FROM bot_flow_states").all()).toEqual([
      { user_id: 100, flow: "birthday", step: "month" },
    ]);
  });

  it("shows an empty menu to private users without command access", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/getChatMember")) {
        return new Response(JSON.stringify({ ok: true, result: { status: "left" } }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/sendMessage") || url.pathname.endsWith("/answerCallbackQuery") || url.pathname.endsWith("/setMyCommands")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`unexpected Telegram call: ${url.pathname}`);
    });
    const { db, env } = createEnv();
    seedSettings(db);

    const response = await sendWebhookUpdate(env, {
      update_id: 508,
      message: {
        message_id: 17,
        date: 1_778_000_007,
        chat: { id: 900, type: "private" },
        from: { id: 900, is_bot: false, first_name: "Noa", username: "noa" },
        text: "/menu",
      },
    });
    const sendBody = vi.mocked(globalThis.fetch).mock.calls
      .filter(([input]) => String(input).includes("/sendMessage"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as { text?: string })
      .at(-1);

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 0 });
    expect(sendBody?.text).toBe("Comandes disponibles:");
  });

  it("shows birthday commands to active audit members", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/getChatMember")) {
        const chatId = url.searchParams.get("chat_id");
        return new Response(JSON.stringify({
          ok: true,
          result: { status: chatId === "-1002829359850" ? "member" : "left" },
        }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/sendMessage") || url.pathname.endsWith("/answerCallbackQuery") || url.pathname.endsWith("/setMyCommands")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`unexpected Telegram call: ${url.pathname}`);
    });
    const { db, env } = createEnv();
    seedSettings(db);

    const response = await sendWebhookUpdate(env, {
      update_id: 509,
      message: {
        message_id: 18,
        date: 1_778_000_008,
        chat: { id: 200, type: "private" },
        from: { id: 200, is_bot: false, first_name: "Pau", username: "pau" },
        text: "/menu",
      },
    });
    const sendBody = vi.mocked(globalThis.fetch).mock.calls
      .filter(([input]) => String(input).includes("/sendMessage"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as { text?: string })
      .at(-1);

    expect(response.status).toBe(200);
    expect(sendBody?.text).toContain("/aniversari");
    expect(sendBody?.text).not.toContain("/felicitacions");
  });

  it("shows staff card commands to CAA members", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/getChatMember")) {
        const chatId = url.searchParams.get("chat_id");
        return new Response(JSON.stringify({
          ok: true,
          result: { status: chatId === "-5555" ? "member" : "left" },
        }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/sendMessage") || url.pathname.endsWith("/answerCallbackQuery") || url.pathname.endsWith("/setMyCommands")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`unexpected Telegram call: ${url.pathname}`);
    });
    const { db, env } = createEnv();
    seedSettings(db);

    const response = await sendWebhookUpdate(env, {
      update_id: 510,
      message: {
        message_id: 19,
        date: 1_778_000_009,
        chat: { id: 300, type: "private" },
        from: { id: 300, is_bot: false, first_name: "Riu", username: "riu" },
        text: "/menu",
      },
    });
    const sendBody = vi.mocked(globalThis.fetch).mock.calls
      .filter(([input]) => String(input).includes("/sendMessage"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as { text?: string })
      .at(-1);

    expect(response.status).toBe(200);
    expect(sendBody?.text).not.toContain("/aniversari");
    expect(sendBody?.text).toContain("/felicitacions");
  });

  it("snarks on unrealistic years and accepts a realistic two-digit year", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    const { db, env } = createEnv();
    seedSettings(db);
    db.sqlite.exec(`
      INSERT INTO bot_flow_states (user_id, flow, step, state_json, expires_at)
      VALUES (100, 'birthday', 'year', '{"month":4,"day":23}', '2099-01-01T00:00:00.000Z');
    `);

    const badResponse = await sendWebhookUpdate(env, {
      update_id: 505,
      message: {
        message_id: 14,
        date: 1_778_000_004,
        chat: { id: 100, type: "private" },
        from: { id: 100, is_bot: false, first_name: "Ada", username: "ada" },
        text: "15",
      },
    });
    const badSend = vi.mocked(globalThis.fetch).mock.calls
      .filter(([input]) => String(input).includes("/sendMessage"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as { text?: string })
      .at(-1);

    expect(badResponse.status).toBe(200);
    expect(badSend?.text).toContain("No cola");
    expect(db.sqlite.prepare("SELECT step FROM bot_flow_states WHERE user_id = 100 AND flow = 'birthday'").get()).toEqual({
      step: "year",
    });

    const goodResponse = await sendWebhookUpdate(env, {
      update_id: 506,
      message: {
        message_id: 15,
        date: 1_778_000_005,
        chat: { id: 100, type: "private" },
        from: { id: 100, is_bot: false, first_name: "Ada", username: "ada" },
        text: "90",
      },
    });

    expect(goodResponse.status).toBe(200);
    expect(db.sqlite.prepare("SELECT step, state_json FROM bot_flow_states WHERE user_id = 100 AND flow = 'birthday'").get()).toEqual({
      step: "ai",
      state_json: JSON.stringify({ month: 4, day: 23, year: 1990 }),
    });
  });

  it("keeps card window selection on the selection step when the window does not exist", async () => {
    const { db, env } = createEnv();
    seedSettings(db);
    db.sqlite.exec(`
      INSERT INTO bot_flow_states (user_id, flow, step, state_json, expires_at)
      VALUES (100, 'cards', 'scope', '{"awaiting":"window"}', '2099-01-01T00:00:00.000Z');
    `);

    const response = await sendWebhookUpdate(env, {
      update_id: 507,
      message: {
        message_id: 16,
        date: 1_778_000_006,
        chat: { id: 100, type: "private" },
        from: { id: 100, is_bot: false, first_name: "Ada", username: "ada" },
        text: "999",
      },
    });
    const sendBody = vi.mocked(globalThis.fetch).mock.calls
      .filter(([input]) => String(input).includes("/sendMessage"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as { text?: string })
      .at(-1);

    expect(response.status).toBe(200);
    expect(sendBody?.text).toContain("Finestra no trobada");
    expect(db.sqlite.prepare("SELECT step, state_json FROM bot_flow_states WHERE user_id = 100 AND flow = 'cards'").get()).toEqual({
      step: "scope",
      state_json: JSON.stringify({ awaiting: "window" }),
    });
  });

  it("falls back to the real Kornibot username when the Worker var is missing", async () => {
    const { db, env } = createEnv();
    seedSettings(db);
    delete env.TELEGRAM_BOT_USERNAME;

    const response = await sendWebhookUpdate(env, {
      update_id: 504,
      message: {
        message_id: 13,
        date: 1_778_000_003,
        chat: { id: -1002829359850, type: "supergroup", title: "Policornis" },
        from: { id: 100, is_bot: false, first_name: "Ada", username: "ada" },
        text: "/felicitacions",
      },
    });

    expect(response.status).toBe(200);
    const sendMessageCall = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).includes("/sendMessage"));
    const body = JSON.parse(String(sendMessageCall?.[1]?.body ?? "{}")) as { reply_markup?: { inline_keyboard?: Array<Array<{ url?: string }>> } };
    expect(body.reply_markup?.inline_keyboard?.[0]?.[0]?.url).toBe("https://t.me/kornibot_bot?start=felicitacions");
  });
});
