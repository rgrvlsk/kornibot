type D1DatabaseLike = Pick<D1Database, "prepare">;

export async function updateHourlyGroupMetrics(
  db: D1DatabaseLike,
  bucketHour: string,
): Promise<void> {
  const row = await db.prepare(`
      SELECT
        COALESCE(SUM(messages_sent), 0) AS messages_sent,
        COUNT(*) AS active_users,
        COALESCE(SUM(replies_sent), 0) AS replies_sent,
        COALESCE(SUM(edits_made), 0) AS edits_made,
        COALESCE(SUM(reactions_emitted), 0) AS reactions_emitted,
        COALESCE(SUM(reactions_received), 0) AS reactions_received,
        COALESCE(SUM(media_sent), 0) AS media_sent
      FROM hourly_user_metrics
      WHERE bucket_hour = ?
    `)
    .bind(bucketHour)
    .first<{
      messages_sent: number;
      active_users: number;
      replies_sent: number;
      edits_made: number;
      reactions_emitted: number;
      reactions_received: number;
      media_sent: number;
    }>();

  await db.prepare(`
      INSERT INTO hourly_group_metrics (
        bucket_hour,
        messages_sent,
        active_users,
        replies_sent,
        edits_made,
        reactions_emitted,
        reactions_received,
        media_sent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket_hour) DO UPDATE SET
        messages_sent = excluded.messages_sent,
        active_users = excluded.active_users,
        replies_sent = excluded.replies_sent,
        edits_made = excluded.edits_made,
        reactions_emitted = excluded.reactions_emitted,
        reactions_received = excluded.reactions_received,
        media_sent = excluded.media_sent
    `)
    .bind(
      bucketHour,
      row?.messages_sent ?? 0,
      row?.active_users ?? 0,
      row?.replies_sent ?? 0,
      row?.edits_made ?? 0,
      row?.reactions_emitted ?? 0,
      row?.reactions_received ?? 0,
      row?.media_sent ?? 0,
    )
    .run();
}
