export const ACTIVITY_METRICS_CTE = `
  activity_metrics AS (
    SELECT
      'hour' AS period_grain,
      bucket_hour AS period_start,
      bucket_hour AS metric_start,
      user_id,
      messages_sent,
      replies_sent,
      edits_made,
      reactions_emitted,
      reactions_received,
      media_sent,
      active_minutes
    FROM hourly_user_metrics

    UNION ALL

    SELECT
      activity_blips.period_grain,
      activity_blips.period_start,
      CASE
        WHEN activity_blips.period_grain = 'day' THEN activity_blips.period_start || 'T00:00:00.000Z'
        ELSE activity_blips.period_start
      END AS metric_start,
      activity_blips.user_id,
      activity_blips.messages_sent,
      activity_blips.replies_sent,
      activity_blips.edits_made,
      activity_blips.reactions_emitted,
      activity_blips.reactions_received,
      activity_blips.media_sent,
      activity_blips.active_minutes
    FROM activity_blips
    WHERE activity_blips.period_grain = 'day'
      OR NOT EXISTS (
        SELECT 1
        FROM hourly_user_metrics
        WHERE hourly_user_metrics.user_id = activity_blips.user_id
          AND hourly_user_metrics.bucket_hour = activity_blips.period_start
      )
  )
`;
