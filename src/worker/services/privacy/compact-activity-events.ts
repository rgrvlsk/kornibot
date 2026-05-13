import type { Env } from "../../../shared/env";
import { readMessageRetentionSettings } from "../settings/group-settings";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type ActivityBlipRow = {
  period_grain: "hour" | "day";
  period_start: string;
  user_id: number;
  messages_sent: number;
  replies_sent: number;
  edits_made: number;
  reactions_emitted: number;
  reactions_received: number;
  media_sent: number;
  active_minutes: number;
};

const HOURLY_ACTIVITY_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function cutoffIso(now: Date, retentionMs: number): string {
  return new Date(now.getTime() - retentionMs).toISOString();
}

async function upsertBlip(
  db: D1DatabaseLike,
  row: ActivityBlipRow,
  archivedAt: string,
): Promise<void> {
  await db.prepare(`
      INSERT INTO activity_blips (
        period_grain,
        period_start,
        user_id,
        messages_sent,
        replies_sent,
        edits_made,
        reactions_emitted,
        reactions_received,
        media_sent,
        active_minutes,
        archived_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period_grain, period_start, user_id) DO UPDATE SET
        messages_sent = excluded.messages_sent,
        replies_sent = excluded.replies_sent,
        edits_made = excluded.edits_made,
        reactions_emitted = excluded.reactions_emitted,
        reactions_received = excluded.reactions_received,
        media_sent = excluded.media_sent,
        active_minutes = excluded.active_minutes,
        archived_at = excluded.archived_at
    `)
    .bind(
      row.period_grain,
      row.period_start,
      row.user_id,
      row.messages_sent,
      row.replies_sent,
      row.edits_made,
      row.reactions_emitted,
      row.reactions_received,
      row.media_sent,
      row.active_minutes,
      archivedAt,
    )
    .run();
}

async function archiveHourlyBlips(db: D1DatabaseLike, eventCutoff: string, archivedAt: string): Promise<void> {
  const rows = await db.prepare(`
      SELECT
        'hour' AS period_grain,
        bucket_hour AS period_start,
        user_id,
        messages_sent,
        replies_sent,
        edits_made,
        reactions_emitted,
        reactions_received,
        media_sent,
        active_minutes
      FROM hourly_user_metrics
      WHERE bucket_hour < ?
      ORDER BY bucket_hour ASC, user_id ASC
    `)
    .bind(eventCutoff)
    .all<ActivityBlipRow>();

  for (const row of rows.results) {
    await upsertBlip(db, row, archivedAt);
  }
}

async function archiveMessageMetricTargets(
  db: D1DatabaseLike,
  eventCutoff: string,
  archivedAt: string,
): Promise<void> {
  await db.prepare(`
      INSERT OR IGNORE INTO message_metric_targets (
        chat_id,
        message_id,
        from_user_id,
        sent_at,
        archived_at
      )
      SELECT
        chat_id,
        message_id,
        from_user_id,
        sent_at,
        ?
      FROM messages
      WHERE sent_at < ?
        AND from_user_id IS NOT NULL
    `)
    .bind(archivedAt, eventCutoff)
    .run();
}

async function removeDetailedOldEvents(db: D1DatabaseLike, eventCutoff: string): Promise<void> {
  await db.prepare(`
      DELETE FROM message_replies
      WHERE replied_at < ?
    `)
    .bind(eventCutoff)
    .run();

  await db.prepare(`
      DELETE FROM message_versions
      WHERE edited_at < ?
    `)
    .bind(eventCutoff)
    .run();

  await db.prepare(`
      DELETE FROM reaction_events
      WHERE observed_at < ?
    `)
    .bind(eventCutoff)
    .run();

  await db.prepare(`
      DELETE FROM message_reactions
      WHERE last_changed_at < ?
    `)
    .bind(eventCutoff)
    .run();

  await db.prepare(`
      DELETE FROM raw_events
      WHERE event_kind IN ('message', 'edited_message', 'message_reaction')
        AND received_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM message_versions
          WHERE message_versions.source_raw_event_id = raw_events.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM message_replies
          WHERE message_replies.source_raw_event_id = raw_events.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM reaction_events
          WHERE reaction_events.source_raw_event_id = raw_events.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM user_membership_events
          WHERE user_membership_events.source_raw_event_id = raw_events.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM user_membership_periods
          WHERE user_membership_periods.join_source_raw_event_id = raw_events.id
             OR user_membership_periods.leave_source_raw_event_id = raw_events.id
        )
    `)
    .bind(eventCutoff)
    .run();

  await db.prepare(`
      DELETE FROM messages
      WHERE sent_at < ?
    `)
    .bind(eventCutoff)
    .run();
}

async function foldHourlyBlipsToDays(
  db: D1DatabaseLike,
  hourlyCutoff: string,
  archivedAt: string,
): Promise<void> {
  const rows = await db.prepare(`
      SELECT
        'day' AS period_grain,
        substr(period_start, 1, 10) AS period_start,
        user_id,
        COALESCE(SUM(messages_sent), 0) AS messages_sent,
        COALESCE(SUM(replies_sent), 0) AS replies_sent,
        COALESCE(SUM(edits_made), 0) AS edits_made,
        COALESCE(SUM(reactions_emitted), 0) AS reactions_emitted,
        COALESCE(SUM(reactions_received), 0) AS reactions_received,
        COALESCE(SUM(media_sent), 0) AS media_sent,
        COALESCE(SUM(active_minutes), 0) AS active_minutes
      FROM activity_blips
      WHERE period_grain = 'hour'
        AND period_start < ?
      GROUP BY substr(period_start, 1, 10), user_id
      ORDER BY period_start ASC, user_id ASC
    `)
    .bind(hourlyCutoff)
    .all<ActivityBlipRow>();

  for (const row of rows.results) {
    await upsertBlip(db, row, archivedAt);
  }

  await db.prepare(`
      DELETE FROM activity_blips
      WHERE period_grain = 'hour'
        AND period_start < ?
    `)
    .bind(hourlyCutoff)
    .run();

  await db.prepare(`
      DELETE FROM hourly_user_metrics
      WHERE bucket_hour < ?
    `)
    .bind(hourlyCutoff)
    .run();
}

export async function compactActivityEvents(env: Env, now = new Date()): Promise<void> {
  const archivedAt = now.toISOString();
  const messageRetention = await readMessageRetentionSettings(env.DB);
  const eventCutoff = cutoffIso(now, messageRetention.detailDays * DAY_MS);
  const hourlyCutoff = cutoffIso(now, HOURLY_ACTIVITY_RETENTION_MS);

  await archiveHourlyBlips(env.DB, eventCutoff, archivedAt);
  await archiveMessageMetricTargets(env.DB, eventCutoff, archivedAt);
  await removeDetailedOldEvents(env.DB, eventCutoff);
  await foldHourlyBlipsToDays(env.DB, hourlyCutoff, archivedAt);
}
