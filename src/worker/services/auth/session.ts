import type { Env } from "../../../shared/env";

export type SessionPayload = {
  userId: number;
  username: string | null;
  role: "superadmin" | "caa_member";
  issuedAt?: number;
  source?: "telegram" | "dev";
  devAccessHash?: string;
};

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  return atob(normalized);
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

async function signValue(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function parseBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function parseCookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }

  const parts = header.split(";").map((part) => part.trim());

  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key === name) {
      return rest.join("=");
    }
  }

  return null;
}

export async function createSessionCookie(
  env: Env,
  payload: SessionPayload,
): Promise<string> {
  const value = await createSessionToken(env, payload);
  return `kornibot_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
}

export async function createSessionToken(
  env: Env,
  payload: SessionPayload,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ ...payload, issuedAt });
  const encodedPayload = base64UrlEncode(body);
  const encodedSignature = await signValue(env.SESSION_SECRET, encodedPayload);
  return `${encodedPayload}.${encodedSignature}`;
}

export function clearSessionCookie(): string {
  return "kornibot_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export async function readSessionFromRequest(
  env: Env,
  request: Request,
): Promise<SessionPayload | null> {
  const rawCookie = parseBearerToken(request) ?? parseCookieValue(request, "kornibot_session");

  if (!rawCookie) {
    return null;
  }

  const [encodedPayload, encodedSignature] = rawCookie.split(".");

  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const expectedSignature = await signValue(env.SESSION_SECRET, encodedPayload);
  if (!timingSafeEqual(expectedSignature, encodedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;

    if (
      typeof payload.userId !== "number"
      || (payload.username !== null && typeof payload.username !== "string")
      || (payload.role !== "superadmin" && payload.role !== "caa_member")
      || typeof payload.issuedAt !== "number"
      || (payload.source !== undefined && payload.source !== "telegram" && payload.source !== "dev")
      || (payload.devAccessHash !== undefined && typeof payload.devAccessHash !== "string")
    ) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds - payload.issuedAt > 24 * 60 * 60) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
