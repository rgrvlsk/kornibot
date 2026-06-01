import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeD1Databases, createExecutionContext, SqliteD1Database } from "../helpers/worker-test-env";
import worker from "../../src/worker/index";
import type { Env } from "../../src/shared/env";
import { DEV_ACCESS_KEY_HEADER, hashDevAccessKey } from "../../src/worker/services/auth/dev-access";
import { createSessionToken } from "../../src/worker/services/auth/session";

const contexts: SqliteD1Database[] = [];
const originalFetch = globalThis.fetch;

function createEnv() {
  const db = new SqliteD1Database();
  contexts.push(db);

  const env: Env = {
    DB: db as unknown as D1Database,
    MEDIA_BUCKET: {} as R2Bucket,
    BOT_TOKEN: "123456:telegram-bot-token",
    TELEGRAM_WEBHOOK_SECRET: "super-secret",
    SESSION_SECRET: "session-secret",
    CORS_ALLOWED_ORIGINS: "",
    BOOTSTRAP_SUPERADMIN_USER_ID: "1001",
    INITIAL_AUDIT_CHAT_ID: "-1002829359850",
  };

  return { db, env };
}

type TelegramLoginPayloadInput = {
  id: number;
  first_name: string;
  username?: string;
  auth_date?: number;
};

function signTelegramLoginPayload(env: Env, input: TelegramLoginPayloadInput): Record<string, string> {
  const payload = {
    id: String(input.id),
    first_name: input.first_name,
    username: input.username,
    auth_date: String(input.auth_date ?? Math.floor(Date.now() / 1000)),
  };

  const dataCheckString = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHash("sha256")
    .update(env.BOT_TOKEN)
    .digest();

  const hash = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  return {
    ...Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    ),
    hash,
  };
}

async function sendTelegramAuth(env: Env, payload: Record<string, unknown>): Promise<Response> {
  const request = new Request("https://example.com/auth/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return worker.fetch(request, env, createExecutionContext());
}

async function sendAuthRequest(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(`https://example.com${path}`, init);
  return worker.fetch(request, env, createExecutionContext());
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  closeD1Databases(contexts);
});

describe("telegram auth", () => {
  it("bootstraps the configured numeric superadmin before CAA setup exists", async () => {
    const { env } = createEnv();

    const payload = signTelegramLoginPayload(env, {
      id: 1001,
      first_name: "Roger",
      username: "agt_ksg",
    });

    const response = await sendTelegramAuth(env, payload);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("kornibot_session=");
    expect(await response.json()).toEqual({
      ok: true,
      role: "superadmin",
      session: {
        role: "superadmin",
        userId: 1001,
        username: "agt_ksg",
      },
      user: {
        id: 1001,
        username: "agt_ksg",
      },
    });
  });

  it("creates a caa_member session for a valid selected CAA group member", async () => {
    const { db, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);
    db.sqlite.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES ('groups.caa_chat_id', ?)
    `).run(JSON.stringify(-5555));

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("chat_id")).toBe("-5555");
      return new Response(JSON.stringify({
        ok: true,
        result: {
          user: {
            id: 1221,
            is_bot: false,
            first_name: "Marta",
            username: "marta",
          },
          status: "member",
        },
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    const payload = signTelegramLoginPayload(env, {
      id: 1221,
      first_name: "Marta",
      username: "marta",
    });

    const response = await sendTelegramAuth(env, payload);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      role: "caa_member",
      session: {
        role: "caa_member",
        userId: 1221,
        username: "marta",
      },
      user: {
        id: 1221,
        username: "marta",
      },
    });
  });

  it("rejects an invalid Telegram Login signature", async () => {
    const { db, env } = createEnv();

    const response = await sendTelegramAuth(env, {
      id: "1002",
      first_name: "Eve",
      username: "eve",
      auth_date: String(Math.floor(Date.now() / 1000)),
      hash: "not-valid",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      message: "invalid telegram login payload",
    });
  });

  it("bootstraps only the configured numeric superadmin id", async () => {
    const { db, env } = createEnv();

    const firstResponse = await sendTelegramAuth(env, signTelegramLoginPayload(env, {
      id: 1001,
      first_name: "Roger",
      username: "agt_ksg",
    }));

    const secondResponse = await sendTelegramAuth(env, signTelegramLoginPayload(env, {
      id: 1002,
      first_name: "Roger",
      username: "agt_ksg",
    }));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(403);
    expect(
      db.sqlite.prepare("SELECT user_id, role FROM auth_roles WHERE role = 'superadmin' AND is_active = 1").all(),
    ).toEqual([
      { user_id: 1001, role: "superadmin" },
    ]);
  });

  it("does not bootstrap a username match when the configured user id differs", async () => {
    const { db, env } = createEnv();

    const response = await sendTelegramAuth(env, signTelegramLoginPayload(env, {
      id: 9999,
      first_name: "Roger",
      username: "agt_ksg",
    }));

    expect(response.status).toBe(403);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM auth_roles WHERE role = 'superadmin' AND is_active = 1").get(),
    ).toEqual({ count: 0 });
  });

  it("accepts a persisted superadmin without requiring CAA membership", async () => {
    const { db, env } = createEnv();

    db.sqlite.exec("INSERT INTO auth_roles (user_id, role, granted_via, is_active) VALUES (1001, 'superadmin', 'bootstrap', 1)");

    const response = await sendTelegramAuth(env, signTelegramLoginPayload(env, {
      id: 1001,
      first_name: "Roger",
      username: "agt_ksg",
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).role).toBe("superadmin");
  });

  it("does not authorize Policornis-only users when they are not in CAA", async () => {
    const { db, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);
    db.sqlite.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES ('groups.caa_chat_id', ?), ('groups.audit_chat_id', ?)
    `).run(JSON.stringify(-5555), JSON.stringify(-1002829359850));

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("chat_id")).toBe("-5555");
      return new Response(JSON.stringify({
        ok: true,
        result: {
          user: { id: 3003, is_bot: false, first_name: "Lin", username: "lin" },
          status: "left",
        },
      }), { headers: { "content-type": "application/json" } });
    });

    const response = await sendTelegramAuth(env, signTelegramLoginPayload(env, {
      id: 3003,
      first_name: "Lin",
      username: "lin",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      message: "user is not authorized",
    });
  });

  it("accepts numeric id and auth_date values in the Telegram Login JSON payload", async () => {
    const { db, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);
    const signedPayload = signTelegramLoginPayload(env, {
      id: 6006,
      first_name: "Jo",
      username: "jo",
    });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: {
        user: {
          id: 6006,
          is_bot: false,
          first_name: "Jo",
          username: "jo",
        },
        status: "member",
      },
    }), {
      headers: { "content-type": "application/json" },
    }));
    db.sqlite.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES ('groups.caa_chat_id', ?)
    `).run(JSON.stringify(-5555));

    const response = await sendTelegramAuth(env, {
      ...signedPayload,
      id: Number(signedPayload.id),
      auth_date: Number(signedPayload.auth_date),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).role).toBe("caa_member");
  });

  it("returns the current session from the signed session cookie", async () => {
    const { db, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);
    const cookie = await createSessionToken(env, {
      userId: 4004,
      username: "nia",
      role: "caa_member",
    });
    db.sqlite.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES ('groups.caa_chat_id', ?)
    `).run(JSON.stringify(-5555));

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: {
        user: {
          id: 4004,
          is_bot: false,
          first_name: "Nia",
          username: "nia",
        },
        status: "member",
      },
    }), {
      headers: { "content-type": "application/json" },
    }));

    const response = await sendAuthRequest(env, "/auth/session", {
      method: "GET",
      headers: {
        cookie: `kornibot_session=${cookie}`,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      session: {
        role: "caa_member",
        userId: 4004,
        username: "nia",
      },
    });
  });

  it("rejects signed session tokens sent through bearer auth", async () => {
    const { env } = createEnv();
    const token = await createSessionToken(env, {
      userId: 4004,
      username: "nia",
      role: "caa_member",
    });

    const response = await sendAuthRequest(env, "/auth/session", {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      message: "missing or invalid session",
    });
  });

  it("creates revocable superadmin sessions from active dev access keys", async () => {
    const { db, env } = createEnv();
    const key = "dev-key";
    const setting = {
      enabled: true,
      tokenHash: await hashDevAccessKey(key),
      createdAt: "2026-05-06T08:00:00.000Z",
      expiresAt: "2099-05-06T08:00:00.000Z",
    };
    db.sqlite.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES ('auth.dev_access', ?)
    `).run(JSON.stringify(setting));

    const authResponse = await sendAuthRequest(env, "/auth/dev-access", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ key }),
    });
    const cookie = authResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

    const sessionResponse = await sendAuthRequest(env, "/auth/session", {
      method: "GET",
      headers: {
        cookie,
      },
    });

    db.sqlite.prepare(`
      UPDATE settings
      SET value_json = ?
      WHERE key = 'auth.dev_access'
    `).run(JSON.stringify({
      enabled: false,
      tokenHash: null,
      expiresAt: "2026-05-06T08:00:00.000Z",
    }));

    const revokedResponse = await sendAuthRequest(env, "/auth/session", {
      method: "GET",
      headers: {
        cookie,
      },
    });

    expect(authResponse.status).toBe(200);
    expect(await authResponse.json()).toEqual({
      ok: true,
      role: "superadmin",
      session: {
        role: "superadmin",
        userId: 1001,
        username: "dev-access",
      },
      user: {
        id: 1001,
        username: "dev-access",
      },
    });
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toEqual({
      ok: true,
      session: {
        role: "superadmin",
        userId: 1001,
        username: "dev-access",
      },
    });
    expect(revokedResponse.status).toBe(403);
  });

  it("accepts active dev access keys through a request header", async () => {
    const { db, env } = createEnv();
    const key = "dev-header-key";
    const setting = {
      enabled: true,
      tokenHash: await hashDevAccessKey(key),
      createdAt: "2026-05-06T08:00:00.000Z",
      expiresAt: "2099-05-06T08:00:00.000Z",
    };
    db.sqlite.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES ('auth.dev_access', ?)
    `).run(JSON.stringify(setting));

    const response = await sendAuthRequest(env, "/auth/session", {
      method: "GET",
      headers: {
        [DEV_ACCESS_KEY_HEADER]: key,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      session: {
        role: "superadmin",
        userId: 1001,
        username: "dev-access",
      },
    });
  });

  it("clears the session cookie on logout", async () => {
    const { env } = createEnv();

    const response = await sendAuthRequest(env, "/auth/logout", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.json()).toEqual({
      ok: true,
    });
  });
});
