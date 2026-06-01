import type { Env } from "../../../shared/env";
import { syncPrivateBotCommandsForStoredAccess } from "../bot/command-sync";
import { getCaaChatId } from "../settings/group-settings";
import { fetchTelegramChatMember, isActiveTelegramChatMember } from "../telegram/fetch-chat-member";

type UserRoleRefreshRow = {
  user_id: number;
};

export async function markCaaRoleActive(env: Env, userId: number, now: Date): Promise<void> {
  await env.DB.prepare(`
      INSERT INTO auth_roles (user_id, role, granted_via, granted_at, is_active, notes)
      VALUES (?, 'caa_member', 'telegram_caa', ?, 1, NULL)
      ON CONFLICT(user_id, role) DO UPDATE SET
        granted_via = 'telegram_caa',
        granted_at = excluded.granted_at,
        is_active = 1,
        notes = NULL
    `)
    .bind(userId, now.toISOString())
    .run();
}

export async function markCaaRoleInactive(env: Env, userId: number): Promise<number> {
  const result = await env.DB.prepare(`
      UPDATE auth_roles
      SET is_active = 0
      WHERE user_id = ?
        AND role = 'caa_member'
        AND granted_via = 'telegram_caa'
        AND is_active = 1
    `)
    .bind(userId)
    .run();

  return result.meta.changes;
}

export async function refreshSingleCaaMemberRole(
  env: Env,
  userId: number,
  now = new Date(),
): Promise<boolean> {
  const caaChatId = await getCaaChatId(env);
  if (caaChatId === null) {
    return false;
  }

  const member = await fetchTelegramChatMember(env, caaChatId, userId);
  if (isActiveTelegramChatMember(member)) {
    await markCaaRoleActive(env, userId, now);
    await syncPrivateBotCommandsForStoredAccess(env, userId, { staff: true });
    return true;
  }

  await markCaaRoleInactive(env, userId);
  await syncPrivateBotCommandsForStoredAccess(env, userId, { staff: false });
  return false;
}

export async function refreshKnownCaaMemberRoles(
  env: Env,
  input: {
    cursor: number;
    limit: number;
    now?: Date;
  },
): Promise<{
  checked: number;
  active: number;
  deactivated: number;
  failed: number;
  nextCursor: number | null;
  done: boolean;
}> {
  const caaChatId = await getCaaChatId(env);
  const limit = Math.max(1, Math.min(input.limit, 8));
  const rowLimit = limit + 1;
  const rows = await env.DB.prepare(`
      SELECT user_id
      FROM users
      WHERE user_id > ?
      ORDER BY user_id ASC
      LIMIT ?
    `)
    .bind(input.cursor, rowLimit)
    .all<UserRoleRefreshRow>();

  const batch = rows.results.slice(0, limit);
  const result = {
    checked: 0,
    active: 0,
    deactivated: 0,
    failed: 0,
    nextCursor: null as number | null,
    done: rows.results.length <= limit,
  };

  if (caaChatId === null) {
    return { ...result, done: true };
  }

  const now = input.now ?? new Date();
  for (const row of batch) {
    result.checked += 1;

    try {
      const member = await fetchTelegramChatMember(env, caaChatId, row.user_id);
      if (isActiveTelegramChatMember(member)) {
        await markCaaRoleActive(env, row.user_id, now);
        await syncPrivateBotCommandsForStoredAccess(env, row.user_id, { staff: true });
        result.active += 1;
      } else {
        result.deactivated += await markCaaRoleInactive(env, row.user_id);
        await syncPrivateBotCommandsForStoredAccess(env, row.user_id, { staff: false });
      }
    } catch {
      result.failed += 1;
    }
  }

  if (!result.done) {
    result.nextCursor = batch.at(-1)?.user_id ?? input.cursor;
  }

  return result;
}
