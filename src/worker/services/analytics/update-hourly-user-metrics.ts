type D1DatabaseLike = Pick<D1Database, "prepare">;

type HourlyUserMetric = {
  userId: number;
  messagesSent: number;
  repliesSent: number;
  editsMade: number;
  reactionsEmitted: number;
  reactionsReceived: number;
  mediaSent: number;
  activeMinutes: number;
};

function nextBucket(bucketHour: string): string {
  return new Date(new Date(bucketHour).getTime() + 60 * 60 * 1000).toISOString();
}

function metricFor(map: Map<number, HourlyUserMetric>, userId: number): HourlyUserMetric {
  const existing = map.get(userId);
  if (existing) {
    return existing;
  }

  const created: HourlyUserMetric = {
    userId,
    messagesSent: 0,
    repliesSent: 0,
    editsMade: 0,
    reactionsEmitted: 0,
    reactionsReceived: 0,
    mediaSent: 0,
    activeMinutes: 0,
  };
  map.set(userId, created);
  return created;
}

export async function updateHourlyUserMetrics(
  db: D1DatabaseLike,
  bucketHour: string,
): Promise<void> {
  const bucketEnd = nextBucket(bucketHour);
  const metrics = new Map<number, HourlyUserMetric>();

  const messageRows = await db.prepare(`
      SELECT
        messages.from_user_id AS user_id,
        COUNT(*) AS messages_sent
      FROM messages
      INNER JOIN raw_events
        ON raw_events.chat_id = messages.chat_id
       AND raw_events.message_id = messages.message_id
       AND raw_events.event_kind = 'message'
      WHERE raw_events.projected_at IS NOT NULL
        AND messages.from_user_id IS NOT NULL
        AND messages.sent_at >= ?
        AND messages.sent_at < ?
      GROUP BY messages.from_user_id
    `)
    .bind(bucketHour, bucketEnd)
    .all<{ user_id: number; messages_sent: number }>();

  for (const row of messageRows.results) {
    const metric = metricFor(metrics, row.user_id);
    metric.messagesSent = row.messages_sent;
  }

  const editRows = await db.prepare(`
      SELECT
        messages.from_user_id AS user_id,
        COUNT(*) AS edits_made
      FROM message_versions
      INNER JOIN raw_events
        ON raw_events.id = message_versions.source_raw_event_id
       AND raw_events.event_kind = 'edited_message'
      INNER JOIN messages
        ON messages.chat_id = message_versions.chat_id
       AND messages.message_id = message_versions.message_id
      WHERE raw_events.projected_at IS NOT NULL
        AND messages.from_user_id IS NOT NULL
        AND message_versions.edited_at >= ?
        AND message_versions.edited_at < ?
      GROUP BY messages.from_user_id
    `)
    .bind(bucketHour, bucketEnd)
    .all<{ user_id: number; edits_made: number }>();

  for (const row of editRows.results) {
    metricFor(metrics, row.user_id).editsMade = row.edits_made;
  }

  const replyRows = await db.prepare(`
      SELECT
        messages.from_user_id AS user_id,
        COUNT(*) AS replies_sent
      FROM messages
      INNER JOIN raw_events
        ON messages.chat_id = raw_events.chat_id
       AND messages.message_id = raw_events.message_id
       AND raw_events.event_kind = 'message'
      WHERE raw_events.projected_at IS NOT NULL
        AND messages.sent_at >= ?
        AND messages.sent_at < ?
        AND messages.reply_to_message_id IS NOT NULL
        AND messages.from_user_id IS NOT NULL
      GROUP BY messages.from_user_id
    `)
    .bind(bucketHour, bucketEnd)
    .all<{ user_id: number; replies_sent: number }>();

  for (const row of replyRows.results) {
    metricFor(metrics, row.user_id).repliesSent = row.replies_sent;
  }

  const emittedRows = await db.prepare(`
      SELECT
        reactor_user_id AS user_id,
        COUNT(*) AS reactions_emitted
      FROM reaction_events
      WHERE reactor_user_id IS NOT NULL
        AND is_active = 1
        AND observed_at >= ?
        AND observed_at < ?
      GROUP BY reactor_user_id
    `)
    .bind(bucketHour, bucketEnd)
    .all<{ user_id: number; reactions_emitted: number }>();

  for (const row of emittedRows.results) {
    metricFor(metrics, row.user_id).reactionsEmitted = row.reactions_emitted;
  }

  const receivedRows = await db.prepare(`
      SELECT
        COALESCE(messages.from_user_id, message_metric_targets.from_user_id) AS user_id,
        COUNT(*) AS reactions_received
      FROM reaction_events
      LEFT JOIN messages
        ON messages.chat_id = reaction_events.chat_id
       AND messages.message_id = reaction_events.message_id
      LEFT JOIN message_metric_targets
        ON message_metric_targets.chat_id = reaction_events.chat_id
       AND message_metric_targets.message_id = reaction_events.message_id
      WHERE reaction_events.observed_at >= ?
        AND reaction_events.observed_at < ?
        AND reaction_events.is_active = 1
        AND COALESCE(messages.from_user_id, message_metric_targets.from_user_id) IS NOT NULL
      GROUP BY COALESCE(messages.from_user_id, message_metric_targets.from_user_id)
    `)
    .bind(bucketHour, bucketEnd)
    .all<{ user_id: number; reactions_received: number }>();

  for (const row of receivedRows.results) {
    metricFor(metrics, row.user_id).reactionsReceived = row.reactions_received;
  }

  const mediaRows = await db.prepare(`
      SELECT
        messages.from_user_id AS user_id,
        COUNT(*) AS media_sent
      FROM messages
      INNER JOIN raw_events
        ON messages.chat_id = raw_events.chat_id
       AND messages.message_id = raw_events.message_id
       AND raw_events.event_kind = 'message'
      WHERE raw_events.projected_at IS NOT NULL
        AND messages.sent_at >= ?
        AND messages.sent_at < ?
        AND messages.has_media = 1
        AND messages.from_user_id IS NOT NULL
      GROUP BY messages.from_user_id
    `)
    .bind(bucketHour, bucketEnd)
    .all<{ user_id: number; media_sent: number }>();

  for (const row of mediaRows.results) {
    metricFor(metrics, row.user_id).mediaSent = row.media_sent;
  }

  const activeMinuteRows = await db.prepare(`
      SELECT
        user_id,
        COUNT(DISTINCT minute_bucket) AS active_minutes
      FROM (
        SELECT
          messages.from_user_id AS user_id,
          substr(messages.sent_at, 1, 16) AS minute_bucket
        FROM messages
        INNER JOIN raw_events
          ON raw_events.chat_id = messages.chat_id
         AND raw_events.message_id = messages.message_id
         AND raw_events.event_kind = 'message'
        WHERE raw_events.projected_at IS NOT NULL
          AND messages.from_user_id IS NOT NULL
          AND messages.sent_at >= ?
          AND messages.sent_at < ?

        UNION ALL

        SELECT
          messages.from_user_id AS user_id,
          substr(message_versions.edited_at, 1, 16) AS minute_bucket
        FROM message_versions
        INNER JOIN raw_events
          ON raw_events.id = message_versions.source_raw_event_id
         AND raw_events.event_kind = 'edited_message'
        INNER JOIN messages
          ON messages.chat_id = message_versions.chat_id
         AND messages.message_id = message_versions.message_id
        WHERE raw_events.projected_at IS NOT NULL
          AND messages.from_user_id IS NOT NULL
          AND message_versions.edited_at >= ?
          AND message_versions.edited_at < ?

        UNION ALL

        SELECT
          reaction_events.reactor_user_id AS user_id,
          substr(reaction_events.observed_at, 1, 16) AS minute_bucket
        FROM reaction_events
        WHERE reaction_events.reactor_user_id IS NOT NULL
          AND reaction_events.is_active = 1
          AND reaction_events.observed_at >= ?
          AND reaction_events.observed_at < ?
      )
      GROUP BY user_id
    `)
    .bind(
      bucketHour,
      bucketEnd,
      bucketHour,
      bucketEnd,
      bucketHour,
      bucketEnd,
    )
    .all<{ user_id: number; active_minutes: number }>();

  for (const row of activeMinuteRows.results) {
    metricFor(metrics, row.user_id).activeMinutes = row.active_minutes;
  }

  for (const metric of metrics.values()) {
    await db.prepare(`
        INSERT INTO hourly_user_metrics (
          bucket_hour,
          user_id,
          messages_sent,
          replies_sent,
          edits_made,
          reactions_emitted,
          reactions_received,
          media_sent,
          active_minutes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bucket_hour, user_id) DO UPDATE SET
          messages_sent = excluded.messages_sent,
          replies_sent = excluded.replies_sent,
          edits_made = excluded.edits_made,
          reactions_emitted = excluded.reactions_emitted,
          reactions_received = excluded.reactions_received,
          media_sent = excluded.media_sent,
          active_minutes = excluded.active_minutes
      `)
      .bind(
        bucketHour,
        metric.userId,
        metric.messagesSent,
        metric.repliesSent,
        metric.editsMade,
        metric.reactionsEmitted,
        metric.reactionsReceived,
        metric.mediaSent,
        metric.activeMinutes,
      )
      .run();
  }
}
