import type { Env } from "../../shared/env";
import { bootstrapSuperadmin } from "../services/auth/bootstrap-superadmin";
import { createDevAccessSession } from "../services/auth/dev-access";
import { readDashboardSessionFromRequest } from "../services/auth/request-session";
import { resolveSessionRole } from "../services/auth/resolve-session-role";
import { clearSessionCookie, createSessionCookie } from "../services/auth/session";
import { refreshSingleCaaMemberRole } from "../services/auth/sync-caa-roles";
import { resolveRole } from "../services/auth/resolve-role";
import { verifyTelegramLoginPayload } from "../services/auth/verify-telegram-login";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    ...init,
  });
}

async function upsertLoginUser(
  env: Env,
  user: {
    userId: number;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  },
): Promise<void> {
  const observedAt = new Date().toISOString();
  const nickname = [user.firstName, user.lastName].filter(Boolean).join(" ") || null;

  await env.DB.prepare(`
      INSERT INTO users (
        user_id,
        username,
        first_name,
        last_name,
        nickname,
        is_bot,
        first_seen_at,
        last_seen_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        first_name = COALESCE(excluded.first_name, users.first_name),
        last_name = COALESCE(excluded.last_name, users.last_name),
        nickname = COALESCE(excluded.nickname, users.nickname),
        first_seen_at = COALESCE(users.first_seen_at, excluded.first_seen_at),
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `)
    .bind(
      user.userId,
      user.username,
      user.firstName,
      user.lastName,
      nickname,
      observedAt,
      observedAt,
      observedAt,
    )
    .run();
}

export async function handleTelegramAuth(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<Record<string, unknown>>();
  const verifiedUser = await verifyTelegramLoginPayload(env, payload);

  if (!verifiedUser) {
    return jsonResponse({ ok: false, message: "invalid telegram login payload" }, { status: 401 });
  }

  await upsertLoginUser(env, verifiedUser);
  const refreshedCaaMember = await refreshSingleCaaMemberRole(env, verifiedUser.userId).catch(() => false);

  const isSuperadmin = await bootstrapSuperadmin(env, verifiedUser.userId);
  const resolvedRole = isSuperadmin
    ? "superadmin"
    : refreshedCaaMember
      ? "caa_member"
      : await resolveRole(env, verifiedUser.userId);

  if (!resolvedRole) {
    return jsonResponse({ ok: false, message: "user is not authorized" }, { status: 403 });
  }

  const role = resolvedRole;

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  const session = {
    userId: verifiedUser.userId,
    username: verifiedUser.username,
    role,
  } as const;
  headers.append("set-cookie", await createSessionCookie(env, session));

  return new Response(JSON.stringify({
    ok: true,
    role,
    session,
    user: {
      id: verifiedUser.userId,
      username: verifiedUser.username,
    },
  }), {
    status: 200,
    headers,
  });
}

export async function handleDevAccessAuth(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));
  const key = String(payload.key ?? "");
  const session = await createDevAccessSession(env, key);

  if (!session) {
    return jsonResponse({ ok: false, message: "invalid or expired dev access key" }, { status: 401 });
  }

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  headers.append("set-cookie", await createSessionCookie(env, session));
  const publicSession = {
    userId: session.userId,
    username: session.username,
    role: session.role,
  } as const;

  return new Response(JSON.stringify({
    ok: true,
    role: session.role,
    session: publicSession,
    user: {
      id: session.userId,
      username: session.username,
    },
  }), {
    status: 200,
    headers,
  });
}

export async function handleSessionRequest(request: Request, env: Env): Promise<Response> {
  const session = await readDashboardSessionFromRequest(env, request);

  if (!session) {
    return jsonResponse({ ok: false, message: "missing or invalid session" }, { status: 401 });
  }

  const currentRole = await resolveSessionRole(env, session);
  if (!currentRole) {
    return jsonResponse({ ok: false, message: "user is not authorized" }, { status: 403 });
  }

  return jsonResponse({
    ok: true,
    session: {
      userId: session.userId,
      username: session.username,
      role: currentRole,
    },
  });
}

export function handleLogout(): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  headers.append("set-cookie", clearSessionCookie());

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}
