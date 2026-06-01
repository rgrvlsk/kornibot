import type { Env } from "../../../shared/env";
import { syncPrivateBotCommandsForAccess } from "../bot/command-sync";
import { readGroupSettings } from "../settings/group-settings";
import { fetchTelegramChatMember, isActiveTelegramChatMember, type TelegramChatMember } from "../telegram/fetch-chat-member";
import { markCaaRoleActive, markCaaRoleInactive } from "../auth/sync-caa-roles";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type KnownUserRow = {
  user_id: number;
};

type DailyRefreshState = {
  day: string;
  cursor: number;
  done: boolean;
};

export type MemberStatusCheckSource = "manual" | "scheduled";

export type SingleMemberStatusRefreshResult = {
  userId: number;
  auditStatus: string | null;
  auditActive: boolean;
  caaStatus: string | null;
  caaActive: boolean;
  isCaaMember: boolean;
  failed: number;
  checkedAt: string;
};

export type KnownMemberStatusRefreshResult = {
  checked: number;
  auditActive: number;
  auditInactive: number;
  caaActive: number;
  caaDeactivated: number;
  failed: number;
  nextCursor: number | null;
  done: boolean;
};

const DAILY_REFRESH_STATE_KEY = "members.status_refresh.daily";
const SCHEDULED_BATCH_LIMIT = 32;

async function knownUserExists(db: D1DatabaseLike, userId: number): Promise<boolean> {
  const row = await db.prepare("SELECT user_id FROM users WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ user_id: number }>();

  return row !== null;
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

function statusFromMember(member: TelegramChatMember | null): string {
  return member?.status ?? "left";
}

async function checkMember(
  env: Env,
  chatId: number | null,
  userId: number,
): Promise<{
  status: string | null;
  active: boolean;
  failed: boolean;
}> {
  if (chatId === null) {
    return {
      status: null,
      active: false,
      failed: false,
    };
  }

  try {
    const member = await fetchTelegramChatMember(env, chatId, userId);
    return {
      status: statusFromMember(member),
      active: isActiveTelegramChatMember(member),
      failed: false,
    };
  } catch {
    return {
      status: null,
      active: false,
      failed: true,
    };
  }
}

async function updateAuditMembershipProjection(
  env: Env,
  userId: number,
  status: string | null,
  checkedAt: string,
): Promise<void> {
  if (!status) {
    return;
  }

  await env.DB.prepare(`
      UPDATE users
      SET
        last_membership_status = ?,
        last_membership_checked_at = ?
      WHERE user_id = ?
    `)
    .bind(status, checkedAt, userId)
    .run();
}

async function insertStatusCheck(
  env: Env,
  input: {
    userId: number;
    auditChatId: number | null;
    caaChatId: number | null;
    auditStatus: string | null;
    auditActive: boolean;
    caaStatus: string | null;
    caaActive: boolean;
    checkedAt: string;
    checkedBy: MemberStatusCheckSource;
    failed: number;
  },
): Promise<void> {
  await env.DB.prepare(`
      INSERT INTO member_status_checks (
        user_id,
        audit_chat_id,
        caa_chat_id,
        audit_status,
        audit_is_active,
        caa_status,
        caa_is_active,
        checked_at,
        checked_by,
        failed_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      input.userId,
      input.auditChatId,
      input.caaChatId,
      input.auditStatus,
      input.auditActive ? 1 : 0,
      input.caaStatus,
      input.caaActive ? 1 : 0,
      input.checkedAt,
      input.checkedBy,
      input.failed,
    )
    .run();
}

async function updateCaaRole(
  env: Env,
  userId: number,
  isActive: boolean,
  now: Date,
): Promise<{
  isCaaMember: boolean;
  deactivated: number;
}> {
  if (isActive) {
    await markCaaRoleActive(env, userId, now);
    return {
      isCaaMember: true,
      deactivated: 0,
    };
  }

  return {
    isCaaMember: false,
    deactivated: await markCaaRoleInactive(env, userId),
  };
}

export async function refreshSingleMemberStatus(
  env: Env,
  userId: number,
  input: {
    now?: Date;
    checkedBy: MemberStatusCheckSource;
  },
): Promise<SingleMemberStatusRefreshResult | null> {
  if (!await knownUserExists(env.DB, userId)) {
    return null;
  }

  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const groups = await readGroupSettings(env);
  const [auditCheck, caaCheck] = await Promise.all([
    checkMember(env, groups.auditChatId, userId),
    checkMember(env, groups.caaChatId, userId),
  ]);
  const failed = Number(auditCheck.failed) + Number(caaCheck.failed);

  await updateAuditMembershipProjection(env, userId, auditCheck.status, checkedAt);
  const caaRole = await updateCaaRole(env, userId, caaCheck.active, now);
  const isSuperadmin = await hasActiveSuperadminRole(env.DB, userId);
  await syncPrivateBotCommandsForAccess(env, userId, {
    auditMember: auditCheck.active,
    staff: caaRole.isCaaMember || isSuperadmin,
    superadmin: isSuperadmin,
  });
  await insertStatusCheck(env, {
    userId,
    auditChatId: groups.auditChatId,
    caaChatId: groups.caaChatId,
    auditStatus: auditCheck.status,
    auditActive: auditCheck.active,
    caaStatus: caaCheck.status,
    caaActive: caaCheck.active,
    checkedAt,
    checkedBy: input.checkedBy,
    failed,
  });

  return {
    userId,
    auditStatus: auditCheck.status,
    auditActive: auditCheck.active,
    caaStatus: caaCheck.status,
    caaActive: caaCheck.active,
    isCaaMember: caaRole.isCaaMember,
    failed,
    checkedAt,
  };
}

export async function refreshKnownMemberStatuses(
  env: Env,
  input: {
    cursor: number;
    limit: number;
    now?: Date;
    checkedBy: MemberStatusCheckSource;
  },
): Promise<KnownMemberStatusRefreshResult> {
  const limit = Math.max(1, Math.min(input.limit, 64));
  const rowLimit = limit + 1;
  const rows = await env.DB.prepare(`
      SELECT user_id
      FROM users
      WHERE user_id > ?
      ORDER BY user_id ASC
      LIMIT ?
    `)
    .bind(input.cursor, rowLimit)
    .all<KnownUserRow>();

  const batch = rows.results.slice(0, limit);
  const result: KnownMemberStatusRefreshResult = {
    checked: 0,
    auditActive: 0,
    auditInactive: 0,
    caaActive: 0,
    caaDeactivated: 0,
    failed: 0,
    nextCursor: null,
    done: rows.results.length <= limit,
  };

  const now = input.now ?? new Date();
  for (const row of batch) {
    const refreshed = await refreshSingleMemberStatus(env, row.user_id, {
      now,
      checkedBy: input.checkedBy,
    });

    if (!refreshed) {
      continue;
    }

    result.checked += 1;
    result.failed += refreshed.failed;

    if (refreshed.auditActive) {
      result.auditActive += 1;
    } else {
      result.auditInactive += 1;
    }

    if (refreshed.caaActive) {
      result.caaActive += 1;
    } else {
      result.caaDeactivated += 1;
    }
  }

  if (!result.done) {
    result.nextCursor = batch.at(-1)?.user_id ?? input.cursor;
  }

  return result;
}

async function readDailyRefreshState(db: D1DatabaseLike): Promise<DailyRefreshState | null> {
  const row = await db.prepare("SELECT value_json FROM settings WHERE key = ?")
    .bind(DAILY_REFRESH_STATE_KEY)
    .first<{ value_json: string }>();

  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.value_json) as Partial<DailyRefreshState>;
    if (typeof parsed.day === "string" && typeof parsed.cursor === "number" && typeof parsed.done === "boolean") {
      return {
        day: parsed.day,
        cursor: parsed.cursor,
        done: parsed.done,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function writeDailyRefreshState(
  db: D1DatabaseLike,
  state: DailyRefreshState,
): Promise<void> {
  await db.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(DAILY_REFRESH_STATE_KEY, JSON.stringify(state))
    .run();
}

function dayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(now);
}

export async function runDailyKnownMemberStatusRefresh(
  env: Env,
  now = new Date(),
): Promise<KnownMemberStatusRefreshResult> {
  const day = dayKey(now);
  const previousState = await readDailyRefreshState(env.DB);

  if (previousState?.day === day && previousState.done) {
    return {
      checked: 0,
      auditActive: 0,
      auditInactive: 0,
      caaActive: 0,
      caaDeactivated: 0,
      failed: 0,
      nextCursor: null,
      done: true,
    };
  }

  const cursor = previousState?.day === day ? previousState.cursor : 0;
  const result = await refreshKnownMemberStatuses(env, {
    cursor,
    limit: SCHEDULED_BATCH_LIMIT,
    now,
    checkedBy: "scheduled",
  });

  await writeDailyRefreshState(env.DB, {
    day,
    cursor: result.nextCursor ?? 0,
    done: result.done,
  });

  return result;
}
