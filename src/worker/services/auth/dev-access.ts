import type { Env } from "../../../shared/env";
import type { SessionPayload } from "./session";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type DevAccessSettingRow = {
  value_json: string;
};

type DevAccessSetting = {
  enabled?: boolean;
  tokenHash?: string;
  createdAt?: string;
  expiresAt?: string;
};

const DEV_ACCESS_SETTING_KEY = "auth.dev_access";
export const DEV_ACCESS_KEY_HEADER = "x-kornibot-dev-access-key";

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

export async function hashDevAccessKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function parseBootstrapUserId(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function readDevAccessSetting(db: D1DatabaseLike): Promise<DevAccessSetting | null> {
  const row = await db.prepare(`
      SELECT value_json
      FROM settings
      WHERE key = ?
    `)
    .bind(DEV_ACCESS_SETTING_KEY)
    .first<DevAccessSettingRow>();

  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.value_json) as DevAccessSetting;
  } catch {
    return null;
  }
}

function isActiveSetting(setting: DevAccessSetting | null, now = new Date()): setting is Required<Pick<DevAccessSetting, "enabled" | "tokenHash" | "expiresAt">> {
  if (!setting?.enabled || !setting.tokenHash || !setting.expiresAt) {
    return false;
  }

  const expiresAt = Date.parse(setting.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

export async function createDevAccessSession(
  env: Env,
  key: string,
): Promise<SessionPayload | null> {
  const setting = await readDevAccessSetting(env.DB);
  if (!isActiveSetting(setting)) {
    return null;
  }

  const tokenHash = await hashDevAccessKey(key);
  if (!timingSafeEqual(setting.tokenHash, tokenHash)) {
    return null;
  }

  return {
    userId: parseBootstrapUserId(env.BOOTSTRAP_SUPERADMIN_USER_ID),
    username: "dev-access",
    role: "superadmin",
    source: "dev",
    devAccessHash: setting.tokenHash,
  };
}

export async function readDevAccessSessionFromRequest(
  env: Env,
  request: Request,
): Promise<SessionPayload | null> {
  const key = request.headers.get(DEV_ACCESS_KEY_HEADER)?.trim();
  if (!key) {
    return null;
  }

  return createDevAccessSession(env, key);
}

export async function isDevAccessSessionActive(
  env: Env,
  session: SessionPayload,
): Promise<boolean> {
  if (session.source !== "dev" || !session.devAccessHash) {
    return false;
  }

  const setting = await readDevAccessSetting(env.DB);
  return isActiveSetting(setting) && timingSafeEqual(setting.tokenHash, session.devAccessHash);
}
