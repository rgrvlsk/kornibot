import type { ResolvedRole } from "../auth/resolve-role";

type D1DatabaseLike = Pick<D1Database, "prepare">;

export type DashboardAccessActor = {
  userId: number;
  username: string | null;
  role: ResolvedRole;
};

export async function recordDashboardAccess(
  db: D1DatabaseLike,
  actor: DashboardAccessActor,
  now = new Date(),
): Promise<void> {
  const observedAt = now.toISOString();

  await db.prepare(`
      INSERT INTO dashboard_access_hourly (
        user_id,
        username,
        role,
        last_access_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = CASE
          WHEN excluded.last_access_at >= dashboard_access_hourly.last_access_at THEN excluded.username
          ELSE dashboard_access_hourly.username
        END,
        role = CASE
          WHEN excluded.last_access_at >= dashboard_access_hourly.last_access_at THEN excluded.role
          ELSE dashboard_access_hourly.role
        END,
        last_access_at = max(dashboard_access_hourly.last_access_at, excluded.last_access_at)
    `)
    .bind(
      actor.userId,
      actor.username,
      actor.role,
      observedAt,
    )
    .run();
}
