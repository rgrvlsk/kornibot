import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { closeD1Databases, SqliteD1Database } from "../helpers/worker-test-env";

const contexts: SqliteD1Database[] = [];

afterEach(() => {
  closeD1Databases(contexts);
});

describe("schema baseline", () => {
  it("keeps a single current migration without course corrections", () => {
    const migrationsDir = resolve(process.cwd(), "migrations");
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const migration = readFileSync(join(migrationsDir, "0001_current_schema.sql"), "utf8");

    expect(files).toEqual(["0001_current_schema.sql"]);
    expect(migration).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bRENAME\s+TO\b/i);
    expect(migration).not.toContain("_cf_KV");
    expect(migration).not.toContain("d1_migrations");
  });

  it("creates the current production-shaped app schema", () => {
    const db = new SqliteD1Database();
    contexts.push(db);

    const tables = db.sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "activity_blips",
      "audit_group_resets",
      "auth_roles",
      "dashboard_access_hourly",
      "hourly_group_metrics",
      "hourly_user_metrics",
      "media_objects",
      "member_status_checks",
      "message_metric_targets",
      "message_reactions",
      "message_replies",
      "message_versions",
      "messages",
      "monthly_user_snapshots",
      "raw_events",
      "reaction_events",
      "settings",
      "telegram_chats",
      "user_membership_events",
      "user_membership_periods",
      "users",
    ]);

    expect(tableColumns(db, "raw_events")).toEqual([
      "id",
      "update_id",
      "received_at",
      "event_kind",
      "chat_id",
      "message_id",
      "actor_user_id",
      "payload_json",
      "projected_at",
    ]);
    expect(tableColumns(db, "messages")).toEqual([
      "chat_id",
      "message_id",
      "from_user_id",
      "sent_at",
      "message_type",
      "reply_to_message_id",
      "thread_root_message_id",
      "current_text",
      "current_caption",
      "has_media",
      "is_currently_visible",
      "last_known_edit_at",
      "deleted_at",
      "last_event_id",
      "message_thread_id",
    ]);
    expect(tableColumns(db, "users")).toEqual([
      "user_id",
      "username",
      "first_name",
      "last_name",
      "is_bot",
      "language_code",
      "updated_at",
      "nickname",
      "first_seen_at",
      "last_seen_at",
      "profile_photo_file_id",
      "profile_photo_file_unique_id",
      "profile_photo_width",
      "profile_photo_height",
      "profile_photo_checked_at",
      "last_membership_status",
      "last_joined_at",
      "last_left_at",
      "profile_photo_r2_key",
      "profile_photo_mime_type",
      "profile_photo_size_bytes",
      "last_membership_checked_at",
    ]);
    expect(tableColumns(db, "dashboard_access_hourly")).toEqual([
      "user_id",
      "username",
      "role",
      "last_access_at",
    ]);
    expect(indexes(db)).toEqual([
      "idx_activity_blips_user_period",
      "idx_auth_roles_role_active",
      "idx_dashboard_access_hourly_last_access",
      "idx_hourly_user_metrics_user_bucket",
      "idx_media_objects_chat_message",
      "idx_media_objects_file_unique_id",
      "idx_media_objects_kind_created_at",
      "idx_media_objects_message_file_unique",
      "idx_member_status_checks_time",
      "idx_member_status_checks_user_time",
      "idx_message_metric_targets_user",
      "idx_message_reactions_message",
      "idx_message_reactions_reactor",
      "idx_message_replies_parent",
      "idx_message_replies_root",
      "idx_message_versions_chat_message_version",
      "idx_messages_from_user_sent_at",
      "idx_messages_reply_to",
      "idx_messages_sent_at",
      "idx_messages_thread_id",
      "idx_messages_thread_root",
      "idx_messages_visible_sent_at",
      "idx_monthly_user_snapshots_user_month",
      "idx_raw_events_actor_user",
      "idx_raw_events_chat_message",
      "idx_raw_events_event_kind_received_at",
      "idx_raw_events_projected_at",
      "idx_raw_events_received_at",
      "idx_reaction_events_message_time",
      "idx_reaction_events_reactor_time",
      "idx_reaction_events_source_raw_event_reaction_key",
      "idx_telegram_chats_last_activity",
      "idx_user_membership_events_chat_time",
      "idx_user_membership_events_source_user_type",
      "idx_user_membership_events_user_time",
      "idx_user_membership_periods_join_source_user",
      "idx_user_membership_periods_leave_source_user",
      "idx_user_membership_periods_open",
      "idx_user_membership_periods_user_time",
      "idx_users_username",
    ]);
  });
});

function tableColumns(db: SqliteD1Database, tableName: string): string[] {
  return db.sqlite.prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function indexes(db: SqliteD1Database): string[] {
  return db.sqlite.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => (row as { name: string }).name);
}
