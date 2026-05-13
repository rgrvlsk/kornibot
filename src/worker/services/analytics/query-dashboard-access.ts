type D1DatabaseLike = Pick<D1Database, "prepare">;

export type DashboardAccessOverviewItem = {
  userId: number;
  username: string | null;
  role: string;
  latestAccessAt: string;
};

type AccessOverviewRow = {
  user_id: number;
  username: string | null;
  role: string;
  latest_access_at: string;
};

function clampLimit(value: number): number {
  if (!Number.isSafeInteger(value)) {
    return 20;
  }

  return Math.max(1, Math.min(100, value));
}

export async function queryDashboardAccessOverview(
  db: D1DatabaseLike,
  limit = 20,
): Promise<DashboardAccessOverviewItem[]> {
  const rows = await db.prepare(`
      SELECT
        user_id,
        username,
        role,
        last_access_at AS latest_access_at
      FROM dashboard_access_hourly
      ORDER BY last_access_at DESC, user_id ASC
      LIMIT ?
    `)
    .bind(clampLimit(limit))
    .all<AccessOverviewRow>();

  return rows.results.map((row) => ({
    userId: row.user_id,
    username: row.username,
    role: row.role,
    latestAccessAt: row.latest_access_at,
  }));
}
