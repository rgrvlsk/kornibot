import { afterEach, describe, expect, it } from "vitest";

import { closeD1Databases, FakeR2Bucket, SqliteD1Database } from "../helpers/worker-test-env";
import type { Env } from "../../src/shared/env";
import { runHourlyAggregation } from "../../src/worker/cron/hourly-aggregation";
import { updateMonthlySnapshots } from "../../src/worker/services/analytics/update-monthly-snapshots";

const contexts: SqliteD1Database[] = [];
const buckets: FakeR2Bucket[] = [];

function createEnv() {
  const db = new SqliteD1Database();
  const bucket = new FakeR2Bucket();
  contexts.push(db);
  buckets.push(bucket);

  const env: Env = {
    DB: db as unknown as D1Database,
    MEDIA_BUCKET: bucket as unknown as R2Bucket,
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "super-secret",
    SESSION_SECRET: "session-secret",
    CORS_ALLOWED_ORIGINS: "",
  };

  return { db, bucket, env };
}

function seedAggregationFixture(db: SqliteD1Database): void {
  db.sqlite.exec(`
    INSERT INTO users (user_id, username, first_name, updated_at)
    VALUES
      (100, 'ada', 'Ada', '2024-03-31T23:00:00.000Z'),
      (200, 'lin', 'Lin', '2024-03-31T23:00:00.000Z');

    INSERT INTO raw_events (id, update_id, received_at, event_kind, chat_id, message_id, actor_user_id, payload_json, projected_at)
    VALUES
      (1, 2001, '2024-03-31T23:10:00.000Z', 'message', -1002829359850, 10, 100, '{}', '2024-03-31T23:10:01.000Z'),
      (2, 2002, '2024-03-31T23:20:00.000Z', 'message', -1002829359850, 11, 200, '{}', '2024-03-31T23:20:01.000Z'),
      (3, 2003, '2024-03-31T23:25:00.000Z', 'edited_message', -1002829359850, 10, 100, '{}', '2024-03-31T23:25:01.000Z'),
      (4, 2004, '2024-03-31T23:30:00.000Z', 'message_reaction', -1002829359850, 10, 200, '{}', '2024-03-31T23:30:01.000Z'),
      (5, 2005, '2024-04-01T00:05:00.000Z', 'message', -1002829359850, 12, 100, '{}', '2024-04-01T00:05:01.000Z');

    INSERT INTO messages (
      chat_id, message_id, from_user_id, sent_at, message_type, reply_to_message_id,
      thread_root_message_id, current_text, current_caption, has_media, is_currently_visible,
      last_known_edit_at, last_event_id
    )
    VALUES
      (-1002829359850, 10, 100, '2024-03-31T23:10:00.000Z', 'text', NULL, NULL, 'Hello edited', NULL, 0, 1, '2024-03-31T23:25:00.000Z', 3),
      (-1002829359850, 11, 200, '2024-03-31T23:20:00.000Z', 'text', 10, 10, 'Reply body', NULL, 0, 1, NULL, 2),
      (-1002829359850, 12, 100, '2024-04-01T00:05:00.000Z', 'text', NULL, NULL, 'April message', NULL, 0, 1, NULL, 5);

    INSERT INTO message_versions (chat_id, message_id, version_no, text, caption, edited_at, source_raw_event_id)
    VALUES
      (-1002829359850, 10, 1, 'Hello original', NULL, '2024-03-31T23:10:00.000Z', 1),
      (-1002829359850, 10, 3, 'Hello edited', NULL, '2024-03-31T23:25:00.000Z', 3),
      (-1002829359850, 11, 2, 'Reply body', NULL, '2024-03-31T23:20:00.000Z', 2),
      (-1002829359850, 12, 5, 'April message', NULL, '2024-04-01T00:05:00.000Z', 5);

    INSERT INTO message_replies (chat_id, message_id, parent_message_id, root_message_id, replied_at, source_raw_event_id)
    VALUES (-1002829359850, 11, 10, 10, '2024-03-31T23:20:00.000Z', 2);

    INSERT INTO reaction_events (chat_id, message_id, reactor_user_id, reaction_key, is_active, observed_at, source_raw_event_id)
    VALUES (-1002829359850, 10, 200, 'emoji:🔥', 1, '2024-03-31T23:30:00.000Z', 4);
  `);
}

function seedDelayedEventTimeFixture(db: SqliteD1Database): void {
  db.sqlite.exec(`
    INSERT INTO users (user_id, username, first_name, updated_at)
    VALUES (300, 'nia', 'Nia', '2024-04-01T00:00:00.000Z');

    INSERT INTO raw_events (id, update_id, received_at, event_kind, chat_id, message_id, actor_user_id, payload_json, projected_at)
    VALUES
      (10, 3010, '2024-04-01T00:10:00.000Z', 'message', -1002829359850, 20, 300, '{}', '2024-04-01T00:10:01.000Z'),
      (11, 3011, '2024-04-01T00:12:00.000Z', 'message_reaction', -1002829359850, 20, 300, '{}', '2024-04-01T00:12:01.000Z'),
      (12, 3012, '2024-04-01T00:13:00.000Z', 'message_reaction', -1002829359850, 20, 300, '{}', '2024-04-01T00:13:01.000Z');

    INSERT INTO messages (
      chat_id, message_id, from_user_id, sent_at, message_type, reply_to_message_id,
      thread_root_message_id, current_text, current_caption, has_media, is_currently_visible,
      last_known_edit_at, last_event_id
    )
    VALUES
      (-1002829359850, 20, 300, '2024-03-31T23:50:00.000Z', 'text', NULL, NULL, 'Delayed event time', NULL, 0, 1, NULL, 10);

    INSERT INTO reaction_events (chat_id, message_id, reactor_user_id, reaction_key, is_active, observed_at, source_raw_event_id)
    VALUES
      (-1002829359850, 20, 300, 'emoji:🔥', 1, '2024-03-31T23:55:00.000Z', 11),
      (-1002829359850, 20, 300, 'emoji:🔥', 0, '2024-03-31T23:56:00.000Z', 12);
  `);
}

function seedSameProjectionTimestampFixture(db: SqliteD1Database): void {
  db.sqlite.exec(`
    INSERT INTO users (user_id, username, first_name, updated_at)
    VALUES
      (400, 'ori', 'Ori', '2024-04-01T00:00:00.000Z'),
      (500, 'kai', 'Kai', '2024-04-01T00:00:00.000Z');

    INSERT INTO raw_events (id, update_id, received_at, event_kind, chat_id, message_id, actor_user_id, payload_json, projected_at)
    VALUES
      (20, 4020, '2024-04-01T00:20:00.000Z', 'message', -1002829359850, 30, 400, '{}', '2024-04-01T00:59:59.000Z'),
      (21, 4021, '2024-04-01T00:21:00.000Z', 'message', -1002829359850, 31, 500, '{}', '2024-04-01T00:59:59.000Z');

    INSERT INTO messages (
      chat_id, message_id, from_user_id, sent_at, message_type, reply_to_message_id,
      thread_root_message_id, current_text, current_caption, has_media, is_currently_visible,
      last_known_edit_at, last_event_id
    )
    VALUES
      (-1002829359850, 30, 400, '2024-04-01T00:20:00.000Z', 'text', NULL, NULL, 'First same timestamp', NULL, 0, 1, NULL, 20),
      (-1002829359850, 31, 500, '2024-04-01T00:21:00.000Z', 'text', NULL, NULL, 'Second same timestamp', NULL, 0, 1, NULL, 21);
  `);
}

afterEach(() => {
  closeD1Databases(contexts);

  buckets.length = 0;
});

describe("hourly aggregation", () => {
  it("processes only new windows", async () => {
    const { db, env } = createEnv();
    seedAggregationFixture(db);

    db.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?)")
      .run("analytics.hourly.last_processed_bucket", JSON.stringify("2024-03-31T23:00:00.000Z"));
    db.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?)")
      .run("analytics.hourly.last_processed_projection_at", JSON.stringify({
        projectedAt: "2024-03-31T23:30:01.000Z",
        rawEventId: 4,
      }));

    await runHourlyAggregation(env, new Date("2024-04-01T01:15:00.000Z"));

    expect(
      db.sqlite.prepare("SELECT bucket_hour, user_id, messages_sent FROM hourly_user_metrics ORDER BY bucket_hour, user_id").all(),
    ).toEqual([
      { bucket_hour: "2024-04-01T00:00:00.000Z", user_id: 100, messages_sent: 1 },
    ]);

    expect(
      db.sqlite.prepare("SELECT value_json FROM settings WHERE key = ?").get("analytics.hourly.last_processed_bucket"),
    ).toEqual({
      value_json: "\"2024-04-01T00:00:00.000Z\"",
    });
  });

  it("writes hourly user metrics from new buckets", async () => {
    const { db, env } = createEnv();
    seedAggregationFixture(db);

    await runHourlyAggregation(env, new Date("2024-04-01T00:45:00.000Z"));

    expect(
      db.sqlite.prepare(`
        SELECT bucket_hour, user_id, messages_sent, replies_sent, edits_made, reactions_emitted, reactions_received
        FROM hourly_user_metrics
        ORDER BY user_id
      `).all(),
    ).toEqual([
      {
        bucket_hour: "2024-03-31T23:00:00.000Z",
        user_id: 100,
        messages_sent: 1,
        replies_sent: 0,
        edits_made: 1,
        reactions_emitted: 0,
        reactions_received: 1,
      },
      {
        bucket_hour: "2024-03-31T23:00:00.000Z",
        user_id: 200,
        messages_sent: 1,
        replies_sent: 1,
        edits_made: 0,
        reactions_emitted: 1,
        reactions_received: 0,
      },
    ]);
  });

  it("updates monthly snapshots when the month boundary is crossed", async () => {
    const { db, env } = createEnv();
    seedAggregationFixture(db);

    await runHourlyAggregation(env, new Date("2024-04-01T01:15:00.000Z"));

    expect(
      db.sqlite.prepare(`
        SELECT month, user_id, messages_sent, replies_sent, edits_made, reactions_emitted, reactions_received
        FROM monthly_user_snapshots
        ORDER BY month, user_id
      `).all(),
    ).toEqual([
      {
        month: "2024-03",
        user_id: 100,
        messages_sent: 1,
        replies_sent: 0,
        edits_made: 1,
        reactions_emitted: 0,
        reactions_received: 1,
      },
      {
        month: "2024-03",
        user_id: 200,
        messages_sent: 1,
        replies_sent: 1,
        edits_made: 0,
        reactions_emitted: 1,
        reactions_received: 0,
      },
      {
        month: "2024-04",
        user_id: 100,
        messages_sent: 1,
        replies_sent: 0,
        edits_made: 0,
        reactions_emitted: 0,
        reactions_received: 0,
      },
    ]);
  });

  it("is idempotent when rerun for the same wall clock window", async () => {
    const { db, env } = createEnv();
    seedAggregationFixture(db);

    const now = new Date("2024-04-01T01:15:00.000Z");
    await runHourlyAggregation(env, now);
    await runHourlyAggregation(env, now);

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM hourly_user_metrics").get(),
    ).toEqual({ count: 3 });

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM monthly_user_snapshots").get(),
    ).toEqual({ count: 3 });

    expect(
      db.sqlite.prepare("SELECT value_json FROM settings WHERE key = ?").get("analytics.hourly.last_processed_bucket"),
    ).toEqual({
      value_json: "\"2024-04-01T00:00:00.000Z\"",
    });
  });

  it("uses event time instead of ingestion time for delayed events", async () => {
    const { db, env } = createEnv();
    seedDelayedEventTimeFixture(db);

    await runHourlyAggregation(env, new Date("2024-04-01T01:15:00.000Z"));

    expect(
      db.sqlite.prepare(`
        SELECT bucket_hour, user_id, messages_sent, reactions_emitted, reactions_received
        FROM hourly_user_metrics
        ORDER BY bucket_hour, user_id
      `).all(),
    ).toEqual([
      {
        bucket_hour: "2024-03-31T23:00:00.000Z",
        user_id: 300,
        messages_sent: 1,
        reactions_emitted: 1,
        reactions_received: 1,
      },
    ]);
  });

  it("excludes inactive reactions from positive reaction metrics", async () => {
    const { db, env } = createEnv();
    seedDelayedEventTimeFixture(db);

    await runHourlyAggregation(env, new Date("2024-04-01T01:15:00.000Z"));

    expect(
      db.sqlite.prepare(`
        SELECT month, user_id, reactions_emitted, reactions_received, average_reactions_per_message
        FROM monthly_user_snapshots
      `).all(),
    ).toEqual([
      {
        month: "2024-03",
        user_id: 300,
        reactions_emitted: 1,
        reactions_received: 1,
        average_reactions_per_message: 1,
      },
    ]);
  });

  it("does not skip projected events that share the same projected_at timestamp", async () => {
    const { db, env } = createEnv();
    seedSameProjectionTimestampFixture(db);

    db.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?)")
      .run("analytics.hourly.last_processed_projection_at", JSON.stringify({
        projectedAt: "2024-04-01T00:59:59.000Z",
        rawEventId: 20,
      }));
    db.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?)")
      .run("analytics.hourly.last_processed_bucket", JSON.stringify("2024-03-31T23:00:00.000Z"));

    await runHourlyAggregation(env, new Date("2024-04-01T01:15:00.000Z"));

    expect(
      db.sqlite.prepare(`
        SELECT bucket_hour, user_id, messages_sent
        FROM hourly_user_metrics
        ORDER BY user_id
      `).all(),
    ).toEqual([
      {
        bucket_hour: "2024-04-01T00:00:00.000Z",
        user_id: 400,
        messages_sent: 1,
      },
      {
        bucket_hour: "2024-04-01T00:00:00.000Z",
        user_id: 500,
        messages_sent: 1,
      },
    ]);

    expect(
      db.sqlite.prepare("SELECT value_json FROM settings WHERE key = ?").get("analytics.hourly.last_processed_projection_at"),
    ).toEqual({
      value_json: "{\"projectedAt\":\"2024-04-01T00:59:59.000Z\",\"rawEventId\":21}",
    });
  });

  it("purges old media when the message has no reactions", async () => {
    const { db, bucket, env } = createEnv();

    db.sqlite.exec(`
      INSERT INTO raw_events (id, update_id, received_at, event_kind, chat_id, message_id, actor_user_id, payload_json, projected_at)
      VALUES (100, 5000, '2024-03-24T00:00:00.000Z', 'message', -1002829359850, 1000, 100, '{}', '2024-03-24T00:00:01.000Z');

      INSERT INTO messages (
        chat_id, message_id, from_user_id, sent_at, message_type, reply_to_message_id,
        thread_root_message_id, current_text, current_caption, has_media, is_currently_visible,
        last_known_edit_at, last_event_id
      )
      VALUES (-1002829359850, 1000, 100, '2024-03-24T00:00:00.000Z', 'service', NULL, NULL, NULL, NULL, 1, 1, NULL, 100);

      INSERT INTO media_objects (
        chat_id, message_id, telegram_file_id, telegram_file_unique_id, kind, r2_key
      )
      VALUES (-1002829359850, 1000, 'file-old', 'unique-old', 'document', 'telegram/-1002829359850/1000/document-unique-old');
    `);

    await runHourlyAggregation(env, new Date("2024-04-01T00:00:00.000Z"));

    expect(bucket.deletedKeys).toEqual(["telegram/-1002829359850/1000/document-unique-old"]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM media_objects").get()).toEqual({ count: 0 });
  });

  it("keeps old media when the message has reactions", async () => {
    const { db, bucket, env } = createEnv();

    db.sqlite.exec(`
      INSERT INTO raw_events (id, update_id, received_at, event_kind, chat_id, message_id, actor_user_id, payload_json, projected_at)
      VALUES
        (110, 5010, '2024-03-24T00:00:00.000Z', 'message', -1002829359850, 1010, 100, '{}', '2024-03-24T00:00:01.000Z'),
        (111, 5011, '2024-03-24T00:01:00.000Z', 'message_reaction', -1002829359850, 1010, 200, '{}', '2024-03-24T00:01:01.000Z');

      INSERT INTO messages (
        chat_id, message_id, from_user_id, sent_at, message_type, reply_to_message_id,
        thread_root_message_id, current_text, current_caption, has_media, is_currently_visible,
        last_known_edit_at, last_event_id
      )
      VALUES (-1002829359850, 1010, 100, '2024-03-24T00:00:00.000Z', 'service', NULL, NULL, NULL, NULL, 1, 1, NULL, 110);

      INSERT INTO media_objects (
        chat_id, message_id, telegram_file_id, telegram_file_unique_id, kind, r2_key
      )
      VALUES (-1002829359850, 1010, 'file-kept', 'unique-kept', 'document', 'telegram/-1002829359850/1010/document-unique-kept');

      INSERT INTO reaction_events (chat_id, message_id, reactor_user_id, reaction_key, is_active, observed_at, source_raw_event_id)
      VALUES (-1002829359850, 1010, 200, 'emoji:🔥', 1, '2024-03-24T00:01:00.000Z', 111);
    `);

    await runHourlyAggregation(env, new Date("2024-04-01T00:00:00.000Z"));

    expect(bucket.deletedKeys).toEqual([]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM media_objects").get()).toEqual({ count: 1 });
  });

  it("keeps a shared R2 object while another media row still references it", async () => {
    const { db, bucket, env } = createEnv();

    db.sqlite.exec(`
      INSERT INTO raw_events (id, update_id, received_at, event_kind, chat_id, message_id, actor_user_id, payload_json, projected_at)
      VALUES
        (120, 5020, '2024-03-24T00:00:00.000Z', 'message', -1002829359850, 1020, 100, '{}', '2024-03-24T00:00:01.000Z'),
        (121, 5021, '2024-03-24T00:02:00.000Z', 'message', -1002829359850, 1021, 101, '{}', '2024-03-24T00:02:01.000Z'),
        (122, 5022, '2024-03-24T00:03:00.000Z', 'message_reaction', -1002829359850, 1021, 200, '{}', '2024-03-24T00:03:01.000Z');

      INSERT INTO messages (
        chat_id, message_id, from_user_id, sent_at, message_type, reply_to_message_id,
        thread_root_message_id, current_text, current_caption, has_media, is_currently_visible,
        last_known_edit_at, last_event_id
      )
      VALUES
        (-1002829359850, 1020, 100, '2024-03-24T00:00:00.000Z', 'service', NULL, NULL, NULL, NULL, 1, 1, NULL, 120),
        (-1002829359850, 1021, 101, '2024-03-24T00:02:00.000Z', 'service', NULL, NULL, NULL, NULL, 1, 1, NULL, 121);

      INSERT INTO media_objects (
        chat_id, message_id, telegram_file_id, telegram_file_unique_id, kind, r2_key
      )
      VALUES
        (-1002829359850, 1020, 'file-shared', 'unique-shared', 'document', 'telegram/-1002829359850/1020/document-unique-shared'),
        (-1002829359850, 1021, 'file-shared', 'unique-shared', 'document', 'telegram/-1002829359850/1020/document-unique-shared');

      INSERT INTO reaction_events (chat_id, message_id, reactor_user_id, reaction_key, is_active, observed_at, source_raw_event_id)
      VALUES (-1002829359850, 1021, 200, 'emoji:🔥', 1, '2024-03-24T00:03:00.000Z', 122);
    `);

    await runHourlyAggregation(env, new Date("2024-04-01T00:00:00.000Z"));

    expect(bucket.deletedKeys).toEqual([]);
    expect(
      db.sqlite.prepare("SELECT message_id, has_media FROM messages WHERE message_id IN (1020, 1021) ORDER BY message_id").all(),
    ).toEqual([]);
    expect(
      db.sqlite.prepare("SELECT message_id, from_user_id FROM message_metric_targets WHERE message_id IN (1020, 1021) ORDER BY message_id").all(),
    ).toEqual([
      { message_id: 1020, from_user_id: 100 },
      { message_id: 1021, from_user_id: 101 },
    ]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM media_objects").get()).toEqual({ count: 1 });
  });

  it("archives old message and reaction events into hourly anonymized blips", async () => {
    const { db, env } = createEnv();
    seedAggregationFixture(db);

    await runHourlyAggregation(env, new Date("2024-04-08T00:00:00.000Z"));

    expect(
      db.sqlite.prepare(`
        SELECT
          period_grain,
          period_start,
          user_id,
          messages_sent,
          replies_sent,
          edits_made,
          reactions_emitted,
          reactions_received,
          media_sent,
          active_minutes
        FROM activity_blips
        ORDER BY period_start, user_id
      `).all(),
    ).toEqual([
      {
        period_grain: "hour",
        period_start: "2024-03-31T23:00:00.000Z",
        user_id: 100,
        messages_sent: 1,
        replies_sent: 0,
        edits_made: 1,
        reactions_emitted: 0,
        reactions_received: 1,
        media_sent: 0,
        active_minutes: 2,
      },
      {
        period_grain: "hour",
        period_start: "2024-03-31T23:00:00.000Z",
        user_id: 200,
        messages_sent: 1,
        replies_sent: 1,
        edits_made: 0,
        reactions_emitted: 1,
        reactions_received: 0,
        media_sent: 0,
        active_minutes: 2,
      },
    ]);

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE event_kind IN ('message', 'message_reaction') AND received_at < '2024-04-01T00:00:00.000Z'").get())
      .toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE sent_at < '2024-04-01T00:00:00.000Z'").get())
      .toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM reaction_events").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM message_reactions").get()).toEqual({ count: 0 });
  });

  it("uses configured message detail retention days for privacy compaction", async () => {
    const { db, env } = createEnv();
    seedAggregationFixture(db);
    db.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?)")
      .run("privacy.message_detail_retention_days", JSON.stringify(3));

    await runHourlyAggregation(env, new Date("2024-04-04T00:00:00.000Z"));

    expect(
      db.sqlite.prepare("SELECT message_id FROM messages ORDER BY message_id").all(),
    ).toEqual([{ message_id: 12 }]);
    expect(
      db.sqlite.prepare("SELECT update_id FROM raw_events ORDER BY update_id").all(),
    ).toEqual([{ update_id: 2005 }]);
    expect(
      db.sqlite.prepare("SELECT period_grain, period_start, user_id FROM activity_blips ORDER BY period_start, user_id").all(),
    ).toEqual([
      { period_grain: "hour", period_start: "2024-03-31T23:00:00.000Z", user_id: 100 },
      { period_grain: "hour", period_start: "2024-03-31T23:00:00.000Z", user_id: 200 },
    ]);
  });

  it("folds old hourly user activity into date-only blips after three weeks", async () => {
    const { db, env } = createEnv();
    seedAggregationFixture(db);

    await runHourlyAggregation(env, new Date("2024-04-22T02:00:00.000Z"));

    expect(
      db.sqlite.prepare(`
        SELECT
          period_grain,
          period_start,
          user_id,
          messages_sent,
          replies_sent,
          edits_made,
          reactions_emitted,
          reactions_received,
          active_minutes
        FROM activity_blips
        ORDER BY period_start, user_id
      `).all(),
    ).toEqual([
      {
        period_grain: "day",
        period_start: "2024-03-31",
        user_id: 100,
        messages_sent: 1,
        replies_sent: 0,
        edits_made: 1,
        reactions_emitted: 0,
        reactions_received: 1,
        active_minutes: 2,
      },
      {
        period_grain: "day",
        period_start: "2024-03-31",
        user_id: 200,
        messages_sent: 1,
        replies_sent: 1,
        edits_made: 0,
        reactions_emitted: 1,
        reactions_received: 0,
        active_minutes: 2,
      },
      {
        period_grain: "day",
        period_start: "2024-04-01",
        user_id: 100,
        messages_sent: 1,
        replies_sent: 0,
        edits_made: 0,
        reactions_emitted: 0,
        reactions_received: 0,
        active_minutes: 1,
      },
    ]);

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM hourly_user_metrics").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM activity_blips WHERE period_grain = 'hour'").get())
      .toEqual({ count: 0 });
  });

  it("updates monthly snapshots from live metrics and archived blips", async () => {
    const { db } = createEnv();

    db.sqlite.exec(`
      INSERT INTO hourly_user_metrics (
        bucket_hour, user_id, messages_sent, replies_sent, edits_made, reactions_emitted, reactions_received, media_sent, active_minutes
      )
      VALUES ('2024-03-30T12:00:00.000Z', 100, 3, 1, 0, 1, 2, 0, 4);

      INSERT INTO activity_blips (
        period_grain, period_start, user_id, messages_sent, replies_sent, edits_made,
        reactions_emitted, reactions_received, media_sent, active_minutes, archived_at
      )
      VALUES
        ('day', '2024-03-01', 100, 4, 0, 1, 2, 3, 1, 8, '2024-04-01T00:00:00.000Z'),
        ('hour', '2024-03-02T10:00:00.000Z', 100, 2, 1, 0, 1, 5, 0, 3, '2024-04-01T00:00:00.000Z');
    `);

    await updateMonthlySnapshots(db as unknown as D1Database, "2024-03-30T12:00:00.000Z");

    expect(
      db.sqlite.prepare(`
        SELECT month, user_id, messages_sent, replies_sent, edits_made, reactions_emitted, reactions_received, media_sent, average_reactions_per_message
        FROM monthly_user_snapshots
      `).all(),
    ).toEqual([
      {
        month: "2024-03",
        user_id: 100,
        messages_sent: 9,
        replies_sent: 2,
        edits_made: 1,
        reactions_emitted: 4,
        reactions_received: 10,
        media_sent: 1,
        average_reactions_per_message: 1.11,
      },
    ]);
  });
});
