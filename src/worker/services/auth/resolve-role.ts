import type { Env } from "../../../shared/env";
import { getCaaChatId } from "../settings/group-settings";
import { fetchTelegramChatMember, isActiveTelegramChatMember } from "../telegram/fetch-chat-member";

export type ResolvedRole = "superadmin" | "caa_member";

type D1DatabaseLike = Pick<D1Database, "prepare">;

async function getExplicitSuperadmin(db: D1DatabaseLike, userId: number): Promise<boolean> {
  const row = await db.prepare(`
      SELECT role
      FROM auth_roles
      WHERE user_id = ? AND role = 'superadmin' AND is_active = 1
      LIMIT 1
    `)
    .bind(userId)
    .first<{ role: string }>();

  return row !== null;
}

export async function resolveRole(
  env: Env,
  userId: number,
): Promise<ResolvedRole | null> {
  if (await getExplicitSuperadmin(env.DB, userId)) {
    return "superadmin";
  }

  const caaChatId = await getCaaChatId(env);
  if (caaChatId === null) {
    return null;
  }

  const chatMember = await fetchTelegramChatMember(env, caaChatId, userId);
  if (isActiveTelegramChatMember(chatMember)) {
    return "caa_member";
  }

  return null;
}
