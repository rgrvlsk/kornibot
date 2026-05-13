import type { Env } from "../../../shared/env";

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export type VerifiedTelegramLoginUser = {
  userId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
};

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

async function hmacSha256(secret: ArrayBuffer, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

function extractString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function normalizeScalarValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function normalizeTelegramLoginPayload(payload: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(payload)) {
    const normalizedValue = normalizeScalarValue(value);

    if (normalizedValue !== null) {
      normalized[key] = normalizedValue;
    }
  }

  return normalized;
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

export async function verifyTelegramLoginPayload(
  env: Env,
  payload: Record<string, unknown>,
): Promise<VerifiedTelegramLoginUser | null> {
  const normalizedPayload = normalizeTelegramLoginPayload(payload);
  const hash = extractString(normalizedPayload, "hash");
  const id = extractString(normalizedPayload, "id");
  const authDate = extractString(normalizedPayload, "auth_date");

  if (!hash || !id || !authDate) {
    return null;
  }

  const authDateNumber = Number(authDate);
  const userId = Number(id);

  if (!Number.isFinite(authDateNumber) || !Number.isFinite(userId)) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - authDateNumber) > MAX_AUTH_AGE_SECONDS) {
    return null;
  }

  const dataCheckString = Object.entries(normalizedPayload)
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = await sha256(env.BOT_TOKEN);
  const expectedHash = toHex(await hmacSha256(secret, dataCheckString));

  if (!timingSafeEqual(expectedHash, hash)) {
    return null;
  }

  return {
    userId,
    username: extractString(normalizedPayload, "username"),
    firstName: extractString(normalizedPayload, "first_name"),
    lastName: extractString(normalizedPayload, "last_name"),
  };
}
