PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS raw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL UNIQUE,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  event_kind TEXT NOT NULL,
  chat_id INTEGER,
  message_id INTEGER,
  actor_user_id INTEGER,
  payload_json TEXT NOT NULL,
  projected_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_raw_events_received_at
  ON raw_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_events_chat_message
  ON raw_events(chat_id, message_id);

CREATE INDEX IF NOT EXISTS idx_raw_events_actor_user
  ON raw_events(actor_user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_events_event_kind_received_at
  ON raw_events(event_kind, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_events_projected_at
  ON raw_events(projected_at);

CREATE TABLE IF NOT EXISTS messages (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  from_user_id INTEGER,
  sent_at TEXT NOT NULL,
  message_type TEXT NOT NULL,
  reply_to_message_id INTEGER,
  thread_root_message_id INTEGER,
  current_text TEXT,
  current_caption TEXT,
  has_media INTEGER NOT NULL DEFAULT 0,
  is_currently_visible INTEGER NOT NULL DEFAULT 1,
  last_known_edit_at TEXT,
  deleted_at TEXT,
  last_event_id INTEGER,
  message_thread_id INTEGER,
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_sent_at
  ON messages(sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_from_user_sent_at
  ON messages(from_user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_thread_root
  ON messages(thread_root_message_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON messages(reply_to_message_id);

CREATE INDEX IF NOT EXISTS idx_messages_visible_sent_at
  ON messages(is_currently_visible, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id
  ON messages(chat_id, message_thread_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS message_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  text TEXT,
  caption TEXT,
  edited_at TEXT NOT NULL,
  source_raw_event_id INTEGER NOT NULL UNIQUE,
  FOREIGN KEY (source_raw_event_id) REFERENCES raw_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_message_versions_chat_message_version
  ON message_versions(chat_id, message_id, version_no DESC);

CREATE TABLE IF NOT EXISTS message_replies (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  parent_message_id INTEGER NOT NULL,
  root_message_id INTEGER NOT NULL,
  replied_at TEXT NOT NULL,
  source_raw_event_id INTEGER NOT NULL UNIQUE,
  PRIMARY KEY (chat_id, message_id),
  FOREIGN KEY (source_raw_event_id) REFERENCES raw_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_message_replies_parent
  ON message_replies(chat_id, parent_message_id, replied_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_replies_root
  ON message_replies(chat_id, root_message_id, replied_at DESC);

CREATE TABLE IF NOT EXISTS reaction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  reactor_user_id INTEGER,
  reaction_key TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  source_raw_event_id INTEGER NOT NULL,
  FOREIGN KEY (source_raw_event_id) REFERENCES raw_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reaction_events_message_time
  ON reaction_events(chat_id, message_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_reaction_events_reactor_time
  ON reaction_events(reactor_user_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reaction_events_source_raw_event_reaction_key
  ON reaction_events(source_raw_event_id, reaction_key);

CREATE TABLE IF NOT EXISTS message_reactions (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  reactor_user_id INTEGER NOT NULL,
  reaction_key TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (chat_id, message_id, reactor_user_id, reaction_key)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_reactor
  ON message_reactions(reactor_user_id, last_changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions(chat_id, message_id, last_changed_at DESC);

CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  language_code TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  nickname TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  profile_photo_file_id TEXT,
  profile_photo_file_unique_id TEXT,
  profile_photo_width INTEGER,
  profile_photo_height INTEGER,
  profile_photo_checked_at TEXT,
  last_membership_status TEXT,
  last_joined_at TEXT,
  last_left_at TEXT,
  profile_photo_r2_key TEXT,
  profile_photo_mime_type TEXT,
  profile_photo_size_bytes INTEGER,
  last_membership_checked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users(username);

CREATE TABLE IF NOT EXISTS media_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime_type TEXT,
  file_name TEXT,
  size_bytes INTEGER,
  duration_seconds INTEGER,
  width INTEGER,
  height INTEGER,
  r2_key TEXT NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_media_objects_chat_message
  ON media_objects(chat_id, message_id);

CREATE INDEX IF NOT EXISTS idx_media_objects_kind_created_at
  ON media_objects(kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_objects_file_unique_id
  ON media_objects(telegram_file_unique_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_objects_message_file_unique
  ON media_objects(chat_id, message_id, telegram_file_unique_id);

CREATE TABLE IF NOT EXISTS auth_roles (
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  granted_via TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_auth_roles_role_active
  ON auth_roles(role, is_active);

CREATE TABLE IF NOT EXISTS birthday_preferences (
  user_id INTEGER PRIMARY KEY,
  month INTEGER NOT NULL,
  day INTEGER NOT NULL,
  year INTEGER,
  wants_ai_card INTEGER NOT NULL DEFAULT 0,
  prompt_ideas_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_birthday_preferences_month_day
  ON birthday_preferences(month, day);

CREATE TABLE IF NOT EXISTS birthday_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_key TEXT,
  label TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  color TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_birthday_windows_dates
  ON birthday_windows(starts_on, ends_on, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS idx_birthday_windows_preset_start_unique
  ON birthday_windows(preset_key, starts_on)
  WHERE preset_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS birthday_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL,
  window_id INTEGER,
  user_id INTEGER,
  state TEXT NOT NULL DEFAULT 'available',
  r2_key TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  uploaded_by_user_id INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  used_at TEXT,
  used_for_user_id INTEGER,
  disabled_at TEXT,
  FOREIGN KEY (window_id) REFERENCES birthday_windows(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_birthday_cards_scope_state
  ON birthday_cards(scope_type, state, uploaded_at);

CREATE INDEX IF NOT EXISTS idx_birthday_cards_window_state
  ON birthday_cards(window_id, state, uploaded_at);

CREATE INDEX IF NOT EXISTS idx_birthday_cards_user_state
  ON birthday_cards(user_id, state, uploaded_at);

CREATE TABLE IF NOT EXISTS birthday_send_log (
  user_id INTEGER NOT NULL,
  celebration_date TEXT NOT NULL,
  status TEXT NOT NULL,
  birthday_card_id INTEGER,
  telegram_message_id INTEGER,
  sent_at TEXT,
  error_message TEXT,
  PRIMARY KEY (user_id, celebration_date),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (birthday_card_id) REFERENCES birthday_cards(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_birthday_send_log_date_status
  ON birthday_send_log(celebration_date, status);

CREATE TABLE IF NOT EXISTS bot_flow_states (
  user_id INTEGER NOT NULL,
  flow TEXT NOT NULL,
  step TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (user_id, flow)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS hourly_user_metrics (
  bucket_hour TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  replies_sent INTEGER NOT NULL DEFAULT 0,
  edits_made INTEGER NOT NULL DEFAULT 0,
  reactions_emitted INTEGER NOT NULL DEFAULT 0,
  reactions_received INTEGER NOT NULL DEFAULT 0,
  media_sent INTEGER NOT NULL DEFAULT 0,
  active_minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_hour, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hourly_user_metrics_user_bucket
  ON hourly_user_metrics(user_id, bucket_hour DESC);

CREATE TABLE IF NOT EXISTS hourly_group_metrics (
  bucket_hour TEXT PRIMARY KEY,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  active_users INTEGER NOT NULL DEFAULT 0,
  replies_sent INTEGER NOT NULL DEFAULT 0,
  edits_made INTEGER NOT NULL DEFAULT 0,
  reactions_emitted INTEGER NOT NULL DEFAULT 0,
  reactions_received INTEGER NOT NULL DEFAULT 0,
  media_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS monthly_user_snapshots (
  month TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  replies_sent INTEGER NOT NULL DEFAULT 0,
  edits_made INTEGER NOT NULL DEFAULT 0,
  reactions_emitted INTEGER NOT NULL DEFAULT 0,
  reactions_received INTEGER NOT NULL DEFAULT 0,
  media_sent INTEGER NOT NULL DEFAULT 0,
  average_reactions_per_message REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (month, user_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_user_snapshots_user_month
  ON monthly_user_snapshots(user_id, month DESC);

CREATE TABLE IF NOT EXISTS user_membership_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  actor_user_id INTEGER,
  message_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  custom_title TEXT,
  source_raw_event_id INTEGER NOT NULL,
  FOREIGN KEY (source_raw_event_id) REFERENCES raw_events(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_membership_events_source_user_type
  ON user_membership_events(source_raw_event_id, user_id, event_type);

CREATE INDEX IF NOT EXISTS idx_user_membership_events_user_time
  ON user_membership_events(user_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_membership_events_chat_time
  ON user_membership_events(chat_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS user_membership_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at TEXT,
  left_at TEXT,
  join_source_raw_event_id INTEGER,
  leave_source_raw_event_id INTEGER,
  FOREIGN KEY (join_source_raw_event_id) REFERENCES raw_events(id) ON DELETE RESTRICT,
  FOREIGN KEY (leave_source_raw_event_id) REFERENCES raw_events(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_membership_periods_join_source_user
  ON user_membership_periods(join_source_raw_event_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_membership_periods_leave_source_user
  ON user_membership_periods(leave_source_raw_event_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_membership_periods_user_time
  ON user_membership_periods(user_id, joined_at DESC, left_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_membership_periods_open
  ON user_membership_periods(chat_id, user_id, left_at);

CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id INTEGER PRIMARY KEY,
  title TEXT,
  type TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  last_update_id INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_chats_last_activity
  ON telegram_chats(last_activity_at DESC);

CREATE TABLE IF NOT EXISTS audit_group_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  previous_audit_chat_id INTEGER,
  next_audit_chat_id INTEGER NOT NULL,
  reset_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reset_by_user_id INTEGER NOT NULL,
  deleted_media_objects INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dashboard_access_hourly (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  role TEXT NOT NULL,
  last_access_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboard_access_hourly_last_access
  ON dashboard_access_hourly(last_access_at DESC);

CREATE TABLE IF NOT EXISTS member_status_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  audit_chat_id INTEGER,
  caa_chat_id INTEGER,
  audit_status TEXT,
  audit_is_active INTEGER NOT NULL DEFAULT 0,
  caa_status TEXT,
  caa_is_active INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL,
  checked_by TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_status_checks_user_time
  ON member_status_checks(user_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_status_checks_time
  ON member_status_checks(checked_at DESC);

CREATE TABLE IF NOT EXISTS activity_blips (
  period_grain TEXT NOT NULL,
  period_start TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  replies_sent INTEGER NOT NULL DEFAULT 0,
  edits_made INTEGER NOT NULL DEFAULT 0,
  reactions_emitted INTEGER NOT NULL DEFAULT 0,
  reactions_received INTEGER NOT NULL DEFAULT 0,
  media_sent INTEGER NOT NULL DEFAULT 0,
  active_minutes INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT NOT NULL,
  PRIMARY KEY (period_grain, period_start, user_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_blips_user_period
  ON activity_blips(user_id, period_grain, period_start DESC);

CREATE TABLE IF NOT EXISTS message_metric_targets (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  from_user_id INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_metric_targets_user
  ON message_metric_targets(from_user_id, sent_at DESC);
