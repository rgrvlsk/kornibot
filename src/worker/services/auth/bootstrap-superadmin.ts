import type { Env } from "../../../shared/env";

function parseBootstrapUserId(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function bootstrapSuperadmin(
  env: Env,
  userId: number,
): Promise<boolean> {
  const existing = await env.DB.prepare(`
      SELECT user_id
      FROM auth_roles
      WHERE role = 'superadmin' AND is_active = 1
      LIMIT 1
    `)
    .first<{ user_id: number }>();

  if (existing) {
    return existing.user_id === userId;
  }

  if (parseBootstrapUserId(env.BOOTSTRAP_SUPERADMIN_USER_ID) !== userId) {
    return false;
  }

  await env.DB.prepare(`
      INSERT INTO auth_roles (user_id, role, granted_via, is_active)
      VALUES (?, 'superadmin', 'bootstrap', 1)
      ON CONFLICT(user_id, role) DO UPDATE SET
        is_active = 1,
        granted_via = excluded.granted_via
    `)
    .bind(userId)
    .run();

  return true;
}
