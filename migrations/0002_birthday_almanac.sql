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
