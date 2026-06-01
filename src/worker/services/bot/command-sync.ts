import type { Env } from "../../../shared/env";
import { resolveRole } from "../auth/resolve-role";
import { readGroupSettings } from "../settings/group-settings";
import { setTelegramBotCommands } from "../telegram/api";
import { fetchTelegramChatMember, isActiveTelegramChatMember } from "../telegram/fetch-chat-member";
import { privateBotCommandsForAccess, type PrivateBotCommandAccess } from "./command-registry";

type D1DatabaseLike = Pick<D1Database, "prepare">;

const ACTIVE_AUDIT_STATUSES = new Set(["administrator", "creator", "member"]);

export function emptyPrivateBotCommandAccess(): PrivateBotCommandAccess {
  return {
    auditMember: false,
    staff: false,
    superadmin: false,
  };
}

async function hasActiveSuperadminRole(db: D1DatabaseLike, userId: number): Promise<boolean> {
  const row = await db.prepare(`
      SELECT user_id
      FROM auth_roles
      WHERE user_id = ?
        AND role = 'superadmin'
        AND is_active = 1
      LIMIT 1
    `)
    .bind(userId)
    .first<{ user_id: number }>();

  return row !== null;
}

async function hasActiveCaaRole(db: D1DatabaseLike, userId: number): Promise<boolean> {
  const row = await db.prepare(`
      SELECT user_id
      FROM auth_roles
      WHERE user_id = ?
        AND role = 'caa_member'
        AND is_active = 1
      LIMIT 1
    `)
    .bind(userId)
    .first<{ user_id: number }>();

  return row !== null;
}

async function hasStoredAuditAccess(db: D1DatabaseLike, userId: number): Promise<boolean> {
  const row = await db.prepare(`
      SELECT last_membership_status
      FROM users
      WHERE user_id = ?
      LIMIT 1
    `)
    .bind(userId)
    .first<{ last_membership_status: string | null }>();

  return row?.last_membership_status ? ACTIVE_AUDIT_STATUSES.has(row.last_membership_status) : false;
}

export async function resolveLivePrivateBotCommandAccess(
  env: Env,
  userId: number,
): Promise<PrivateBotCommandAccess> {
  const groups = await readGroupSettings(env);
  const [role, auditMember] = await Promise.all([
    resolveRole(env, userId),
    fetchTelegramChatMember(env, groups.auditChatId, userId),
  ]);

  return {
    auditMember: isActiveTelegramChatMember(auditMember),
    staff: role === "caa_member" || role === "superadmin",
    superadmin: role === "superadmin",
  };
}

export async function resolveStoredPrivateBotCommandAccess(
  env: Env,
  userId: number,
  overrides: Partial<Pick<PrivateBotCommandAccess, "auditMember" | "staff">> = {},
): Promise<PrivateBotCommandAccess> {
  const [storedAuditMember, storedStaff, superadmin] = await Promise.all([
    overrides.auditMember === undefined ? hasStoredAuditAccess(env.DB, userId) : Promise.resolve(overrides.auditMember),
    overrides.staff === undefined ? hasActiveCaaRole(env.DB, userId) : Promise.resolve(overrides.staff),
    hasActiveSuperadminRole(env.DB, userId),
  ]);

  return {
    auditMember: storedAuditMember,
    staff: storedStaff || superadmin,
    superadmin,
  };
}

export async function syncPrivateBotCommandsForAccess(
  env: Env,
  userId: number,
  access: PrivateBotCommandAccess,
): Promise<boolean> {
  try {
    return await setTelegramBotCommands(env, privateBotCommandsForAccess(access), {
      type: "chat",
      chat_id: userId,
    });
  } catch {
    return false;
  }
}

export async function syncPrivateBotCommandsForStoredAccess(
  env: Env,
  userId: number,
  overrides: Partial<Pick<PrivateBotCommandAccess, "auditMember" | "staff">> = {},
): Promise<boolean> {
  const access = await resolveStoredPrivateBotCommandAccess(env, userId, overrides);
  return syncPrivateBotCommandsForAccess(env, userId, access);
}
