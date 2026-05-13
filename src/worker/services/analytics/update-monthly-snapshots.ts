import { ACTIVITY_METRICS_CTE } from "./activity-metrics-source";

type D1DatabaseLike = Pick<D1Database, "prepare">;

export async function updateMonthlySnapshots(
  db: D1DatabaseLike,
  bucketHour: string,
): Promise<void> {
  const month = bucketHour.slice(0, 7);

  const rows = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        user_id,
        COALESCE(SUM(messages_sent), 0) AS messages_sent,
        COALESCE(SUM(replies_sent), 0) AS replies_sent,
        COALESCE(SUM(edits_made), 0) AS edits_made,
        COALESCE(SUM(reactions_emitted), 0) AS reactions_emitted,
        COALESCE(SUM(reactions_received), 0) AS reactions_received,
        COALESCE(SUM(media_sent), 0) AS media_sent
      FROM activity_metrics
      WHERE substr(metric_start, 1, 7) = ?
      GROUP BY user_id
    `)
    .bind(month)
    .all<{
      user_id: number;
      messages_sent: number;
      replies_sent: number;
      edits_made: number;
      reactions_emitted: number;
      reactions_received: number;
      media_sent: number;
    }>();

  for (const row of rows.results) {
    const averageReactionsPerMessage = row.messages_sent > 0
      ? Number((row.reactions_received / row.messages_sent).toFixed(2))
      : 0;

    await db.prepare(`
        INSERT INTO monthly_user_snapshots (
          month,
          user_id,
          messages_sent,
          replies_sent,
          edits_made,
          reactions_emitted,
          reactions_received,
          media_sent,
          average_reactions_per_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(month, user_id) DO UPDATE SET
          messages_sent = excluded.messages_sent,
          replies_sent = excluded.replies_sent,
          edits_made = excluded.edits_made,
          reactions_emitted = excluded.reactions_emitted,
          reactions_received = excluded.reactions_received,
          media_sent = excluded.media_sent,
          average_reactions_per_message = excluded.average_reactions_per_message
      `)
      .bind(
        month,
        row.user_id,
        row.messages_sent,
        row.replies_sent,
        row.edits_made,
        row.reactions_emitted,
        row.reactions_received,
        row.media_sent,
        averageReactionsPerMessage,
      )
      .run();
  }
}
