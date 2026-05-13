import type { Env } from "../../shared/env";
import { updateHourlyGroupMetrics } from "../services/analytics/update-hourly-group-metrics";
import { updateHourlyUserMetrics } from "../services/analytics/update-hourly-user-metrics";
import { updateMonthlySnapshots } from "../services/analytics/update-monthly-snapshots";
import { purgeUnreactedMedia } from "../services/media/purge-unreacted-media";
import { compactActivityEvents } from "../services/privacy/compact-activity-events";

type D1DatabaseLike = Pick<D1Database, "prepare">;

const WATERMARK_KEY = "analytics.hourly.last_processed_bucket";
const PROJECTION_WATERMARK_KEY = "analytics.hourly.last_processed_projection_at";
type ProjectionCursor = {
  projectedAt: string;
  rawEventId: number;
};

function floorToHour(input: Date): string {
  const date = new Date(input);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function previousHour(input: Date): string {
  return new Date(new Date(floorToHour(input)).getTime() - 60 * 60 * 1000).toISOString();
}

async function readWatermark(db: D1DatabaseLike): Promise<string | null> {
  const row = await db.prepare("SELECT value_json FROM settings WHERE key = ?")
    .bind(WATERMARK_KEY)
    .first<{ value_json: string }>();

  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.value_json) as string;
  } catch {
    return null;
  }
}

async function readProjectionWatermark(db: D1DatabaseLike): Promise<ProjectionCursor | null> {
  const row = await db.prepare("SELECT value_json FROM settings WHERE key = ?")
    .bind(PROJECTION_WATERMARK_KEY)
    .first<{ value_json: string }>();

  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.value_json) as string | { projectedAt?: string; rawEventId?: number };
    if (typeof parsed === "string") {
      return {
        projectedAt: parsed,
        rawEventId: 0,
      };
    }

    if (typeof parsed?.projectedAt === "string" && typeof parsed?.rawEventId === "number") {
      return {
        projectedAt: parsed.projectedAt,
        rawEventId: parsed.rawEventId,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function writeWatermark(db: D1DatabaseLike, bucketHour: string): Promise<void> {
  await db.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(WATERMARK_KEY, JSON.stringify(bucketHour))
    .run();
}

async function writeProjectionWatermark(db: D1DatabaseLike, cursor: ProjectionCursor): Promise<void> {
  await db.prepare(`
      INSERT INTO settings (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(PROJECTION_WATERMARK_KEY, JSON.stringify(cursor))
    .run();
}

async function pendingBuckets(
  db: D1DatabaseLike,
  projectionCursor: ProjectionCursor | null,
  now: Date,
): Promise<string[]> {
  const cutoff = floorToHour(now);
  const lowerBoundProjectedAt = projectionCursor?.projectedAt ?? "";
  const lowerBoundRawEventId = projectionCursor?.rawEventId ?? 0;
  const rows = await db.prepare(`
      SELECT DISTINCT bucket_hour
      FROM (
        SELECT substr(messages.sent_at, 1, 13) || ':00:00.000Z' AS bucket_hour
        FROM messages
        INNER JOIN raw_events
          ON raw_events.chat_id = messages.chat_id
         AND raw_events.message_id = messages.message_id
         AND raw_events.event_kind = 'message'
        WHERE raw_events.projected_at IS NOT NULL
          AND (
            raw_events.projected_at > ?
            OR (raw_events.projected_at = ? AND raw_events.id > ?)
          )
          AND messages.sent_at < ?

        UNION

        SELECT substr(message_versions.edited_at, 1, 13) || ':00:00.000Z' AS bucket_hour
        FROM message_versions
        INNER JOIN raw_events
          ON raw_events.id = message_versions.source_raw_event_id
         AND raw_events.event_kind = 'edited_message'
        WHERE raw_events.projected_at IS NOT NULL
          AND (
            raw_events.projected_at > ?
            OR (raw_events.projected_at = ? AND raw_events.id > ?)
          )
          AND message_versions.edited_at < ?

        UNION

        SELECT substr(reaction_events.observed_at, 1, 13) || ':00:00.000Z' AS bucket_hour
        FROM reaction_events
        INNER JOIN raw_events
          ON raw_events.id = reaction_events.source_raw_event_id
        WHERE raw_events.projected_at IS NOT NULL
          AND (
            raw_events.projected_at > ?
            OR (raw_events.projected_at = ? AND raw_events.id > ?)
          )
          AND reaction_events.observed_at < ?
      )
      ORDER BY bucket_hour ASC
    `)
    .bind(
      lowerBoundProjectedAt,
      lowerBoundProjectedAt,
      lowerBoundRawEventId,
      cutoff,
      lowerBoundProjectedAt,
      lowerBoundProjectedAt,
      lowerBoundRawEventId,
      cutoff,
      lowerBoundProjectedAt,
      lowerBoundProjectedAt,
      lowerBoundRawEventId,
      cutoff,
    )
    .all<{ bucket_hour: string }>();

  return rows.results.map((row) => row.bucket_hour);
}

async function newestProjectedAt(
  db: D1DatabaseLike,
  previousProjectionCursor: ProjectionCursor | null,
  now: Date,
): Promise<ProjectionCursor | null> {
  const cutoff = floorToHour(now);
  const lowerBoundProjectedAt = previousProjectionCursor?.projectedAt ?? "";
  const lowerBoundRawEventId = previousProjectionCursor?.rawEventId ?? 0;
  const row = await db.prepare(`
      SELECT id, projected_at
      FROM raw_events
      WHERE projected_at IS NOT NULL
        AND (
          projected_at > ?
          OR (projected_at = ? AND id > ?)
        )
        AND projected_at < ?
      ORDER BY projected_at DESC, id DESC
      LIMIT 1
    `)
    .bind(lowerBoundProjectedAt, lowerBoundProjectedAt, lowerBoundRawEventId, cutoff)
    .first<{ id: number; projected_at: string | null }>();

  if (!row?.projected_at) {
    return null;
  }

  return {
    projectedAt: row.projected_at,
    rawEventId: row.id,
  };
}

export async function runHourlyAggregation(env: Env, now = new Date()): Promise<void> {
  const watermark = await readWatermark(env.DB);
  const projectionCursor = await readProjectionWatermark(env.DB);
  const buckets = await pendingBuckets(env.DB, projectionCursor, now);

  for (const bucketHour of buckets) {
    await updateHourlyUserMetrics(env.DB, bucketHour);
    await updateHourlyGroupMetrics(env.DB, bucketHour);
    await updateMonthlySnapshots(env.DB, bucketHour);
    await writeWatermark(env.DB, bucketHour);
  }

  const latestProjectedCursor = await newestProjectedAt(env.DB, projectionCursor, now);
  if (latestProjectedCursor) {
    await writeProjectionWatermark(env.DB, latestProjectedCursor);
  }

  if (!watermark && buckets.length === 0) {
    const initialWatermark = previousHour(now);
    await writeWatermark(env.DB, initialWatermark);
  }

  await purgeUnreactedMedia(env, now);
  await compactActivityEvents(env, now);
}
