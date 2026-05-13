# D1 Schema Notes

## Intent

- event-first
- projection-friendly
- cheap dashboard reads

## Goals

- keep `raw_events` append-only
- preserve edit history with `message_versions`
- track reactions as event log + current state
- keep media metadata in `D1`
- keep media bytes in `R2`
- keep dashboard access analytics as latest-access projection
- keep current schema in `migrations/0001_current_schema.sql`

## Operational Notes

- timestamps stored as UTC ISO-8601 text
- `messages` = current-state projection
- `hourly_user_metrics` and `monthly_user_snapshots` avoid normal raw-event scans
- `settings` uses `key -> JSON value`
- `auth_roles` stores explicit effective-role rows
- `member_status_checks` stores Telegram membership verification snapshots
- `telegram_chats` stores observed group registry
- `audit_group_resets` stores destructive audit-group changes
- `dashboard_access_hourly` stores user + role + latest access date

## Hot-Path Indexes

- feed by time
- feed by user
- thread traversal
- replies by parent or root
- reactions by message and reactor
- media by message
- analytics by user and time bucket
- access analytics by user and latest access date
