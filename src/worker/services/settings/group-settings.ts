import type { Env } from "../../../shared/env";
import { sendTelegramMessage } from "../telegram/api";

const DEFAULT_AUDIT_CHAT_ID = -1002829359850;
const DEFAULT_LANGUAGE = "ca";
const DEFAULT_TIMEZONE = "Europe/Madrid";
const DEFAULT_MESSAGE_DETAIL_RETENTION_DAYS = 7;
const MIN_MESSAGE_DETAIL_RETENTION_DAYS = 1;
const MAX_MESSAGE_DETAIL_RETENTION_DAYS = 30;

type D1DatabaseLike = Pick<D1Database, "prepare">;

export type DashboardRole = "caa_member" | "superadmin";

export type SafeEnvSettings = {
  initialAuditChatId: number;
  defaultLanguage: string;
  defaultTimezone: string;
  hasCorsAllowedOrigins: boolean;
};

export type GroupSettings = {
  auditChatId: number;
  caaChatId: number | null;
};

export type MemberActivityThresholds = {
  goodHours: number;
  warmHours: number;
};

export type MessageRetentionSettings = {
  detailDays: number;
};

export type DashboardSettings = {
  groups: GroupSettings;
  memberActivityThresholds: MemberActivityThresholds;
  messageRetention: MessageRetentionSettings;
  canManagePrivilegedSettings: boolean;
  safeEnv: SafeEnvSettings;
  auditDataCounts: {
    rawEvents: number;
    messages: number;
    users: number;
    mediaObjects: number;
    membershipEvents: number;
    membershipPeriods: number;
    hourlyGroupMetrics: number;
    hourlyUserMetrics: number;
    monthlyUserSnapshots: number;
    mediaBytes: number;
  };
  auditUsage: {
    daily: Array<{
      date: string;
      rawEvents: number;
      messages: number;
      mediaObjects: number;
      mediaBytes: number;
    }>;
    monthToDate: {
      rawEvents: number;
      messages: number;
      mediaObjects: number;
      mediaBytes: number;
    };
  };
};

export type TelegramChatSummary = {
  chatId: number;
  title: string | null;
  type: string;
  firstSeenAt: string;
  lastActivityAt: string;
  lastUpdateId: number;
  isAuditChat: boolean;
  isCaaChat: boolean;
};

type SettingRow = {
  value_json: string;
};

type TelegramChatRow = {
  chat_id: number;
  title: string | null;
  type: string;
  first_seen_at: string;
  last_activity_at: string;
  last_update_id: number;
};

type CountRow = {
  count: number;
};

type BytesRow = {
  bytes: number | null;
};

type DailyCountRow = {
  date: string;
  count: number;
  bytes?: number | null;
};

const DEFAULT_MEMBER_ACTIVITY_THRESHOLDS: MemberActivityThresholds = {
  goodHours: 24,
  warmHours: 168,
};

function parseNumericEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = JSON.parse(value) as unknown;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) ? parsed : null;
}

function parseMemberActivityThresholds(value: string | null): MemberActivityThresholds | null {
  if (value === null) {
    return null;
  }

  const parsed = JSON.parse(value) as unknown;
  if (
    typeof parsed !== "object"
    || parsed === null
    || !("goodHours" in parsed)
    || !("warmHours" in parsed)
  ) {
    return null;
  }

  const goodHours = Number(parsed.goodHours);
  const warmHours = Number(parsed.warmHours);
  if (!Number.isSafeInteger(goodHours) || !Number.isSafeInteger(warmHours) || goodHours <= 0 || warmHours <= goodHours) {
    return null;
  }

  return { goodHours, warmHours };
}

function validMessageDetailRetentionDays(value: number): boolean {
  return Number.isSafeInteger(value)
    && value >= MIN_MESSAGE_DETAIL_RETENTION_DAYS
    && value <= MAX_MESSAGE_DETAIL_RETENTION_DAYS;
}

function parseMessageRetentionSettings(value: string | null): MessageRetentionSettings | null {
  if (value === null) {
    return null;
  }

  const parsed = JSON.parse(value) as unknown;
  const detailDays = Number(parsed);
  if (!validMessageDetailRetentionDays(detailDays)) {
    return null;
  }

  return { detailDays };
}

export function getInitialAuditChatId(env: Env): number {
  return parseNumericEnv(env.INITIAL_AUDIT_CHAT_ID, DEFAULT_AUDIT_CHAT_ID);
}

export function getSafeEnvSettings(env: Env): SafeEnvSettings {
  return {
    initialAuditChatId: getInitialAuditChatId(env),
    defaultLanguage: DEFAULT_LANGUAGE,
    defaultTimezone: DEFAULT_TIMEZONE,
    hasCorsAllowedOrigins: typeof env.CORS_ALLOWED_ORIGINS === "string" && env.CORS_ALLOWED_ORIGINS.trim().length > 0,
  };
}

async function readNumericSetting(db: D1DatabaseLike, key: string): Promise<number | null> {
  const row = await db.prepare("SELECT value_json FROM settings WHERE key = ?")
    .bind(key)
    .first<SettingRow>();

  if (!row) {
    return null;
  }

  try {
    return parseOptionalNumber(row.value_json);
  } catch {
    return null;
  }
}

async function readJsonSetting(db: D1DatabaseLike, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value_json FROM settings WHERE key = ?")
    .bind(key)
    .first<SettingRow>();

  return row?.value_json ?? null;
}

export async function readGroupSettings(env: Env): Promise<GroupSettings> {
  const storedAuditChatId = await readNumericSetting(env.DB, "groups.audit_chat_id");
  const caaChatId = await readNumericSetting(env.DB, "groups.caa_chat_id");

  return {
    auditChatId: storedAuditChatId ?? getInitialAuditChatId(env),
    caaChatId,
  };
}

export async function readMemberActivityThresholds(env: Env): Promise<MemberActivityThresholds> {
  const value = await readJsonSetting(env.DB, "members.activity_thresholds");
  if (!value) {
    return DEFAULT_MEMBER_ACTIVITY_THRESHOLDS;
  }

  try {
    return parseMemberActivityThresholds(value) ?? DEFAULT_MEMBER_ACTIVITY_THRESHOLDS;
  } catch {
    return DEFAULT_MEMBER_ACTIVITY_THRESHOLDS;
  }
}

export async function readMessageRetentionSettings(db: D1DatabaseLike): Promise<MessageRetentionSettings> {
  const value = await readJsonSetting(db, "privacy.message_detail_retention_days");
  if (!value) {
    return { detailDays: DEFAULT_MESSAGE_DETAIL_RETENTION_DAYS };
  }

  try {
    return parseMessageRetentionSettings(value) ?? { detailDays: DEFAULT_MESSAGE_DETAIL_RETENTION_DAYS };
  } catch {
    return { detailDays: DEFAULT_MESSAGE_DETAIL_RETENTION_DAYS };
  }
}

export async function getAuditChatId(env: Env): Promise<number> {
  return (await readGroupSettings(env)).auditChatId;
}

export async function getCaaChatId(env: Env): Promise<number | null> {
  return (await readGroupSettings(env)).caaChatId;
}

async function upsertNumberSetting(db: D1DatabaseLike, key: string, value: number): Promise<void> {
  await db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `)
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
}

async function upsertJsonSetting(db: D1DatabaseLike, key: string, value: unknown): Promise<void> {
  await db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `)
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
}

async function countRows(db: D1DatabaseLike, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<CountRow>();
  return row?.count ?? 0;
}

async function sumMediaBytes(db: D1DatabaseLike): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM media_objects").first<BytesRow>();
  return row?.bytes ?? 0;
}

async function queryAuditDataCounts(db: D1DatabaseLike): Promise<DashboardSettings["auditDataCounts"]> {
  const [
    rawEvents,
    messages,
    users,
    mediaObjects,
    membershipEvents,
    membershipPeriods,
    hourlyGroupMetrics,
    hourlyUserMetrics,
    monthlyUserSnapshots,
    mediaBytes,
  ] = await Promise.all([
    countRows(db, "raw_events"),
    countRows(db, "messages"),
    countRows(db, "users"),
    countRows(db, "media_objects"),
    countRows(db, "user_membership_events"),
    countRows(db, "user_membership_periods"),
    countRows(db, "hourly_group_metrics"),
    countRows(db, "hourly_user_metrics"),
    countRows(db, "monthly_user_snapshots"),
    sumMediaBytes(db),
  ]);

  return {
    rawEvents,
    messages,
    users,
    mediaObjects,
    membershipEvents,
    membershipPeriods,
    hourlyGroupMetrics,
    hourlyUserMetrics,
    monthlyUserSnapshots,
    mediaBytes,
  };
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayStartIso(date: Date): string {
  return `${dateKey(date)}T00:00:00.000Z`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function queryAuditUsage(db: D1DatabaseLike, now = new Date()): Promise<DashboardSettings["auditUsage"]> {
  const startDate = addDays(now, -13);
  const startIso = dayStartIso(startDate);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthStartIso = dayStartIso(monthStart);
  const daily = new Map<string, DashboardSettings["auditUsage"]["daily"][number]>();

  for (let index = 0; index < 14; index += 1) {
    const date = dateKey(addDays(startDate, index));
    daily.set(date, {
      date,
      rawEvents: 0,
      messages: 0,
      mediaObjects: 0,
      mediaBytes: 0,
    });
  }

  const [rawDaily, messageDaily, mediaDaily, rawMonth, messageMonth, mediaMonth] = await Promise.all([
    db.prepare(`
      SELECT substr(received_at, 1, 10) AS date, COUNT(*) AS count
      FROM raw_events
      WHERE received_at >= ?
      GROUP BY date
      ORDER BY date ASC
    `).bind(startIso).all<DailyCountRow>(),
    db.prepare(`
      SELECT substr(sent_at, 1, 10) AS date, COUNT(*) AS count
      FROM messages
      WHERE sent_at >= ?
      GROUP BY date
      ORDER BY date ASC
    `).bind(startIso).all<DailyCountRow>(),
    db.prepare(`
      SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
      FROM media_objects
      WHERE created_at >= ?
      GROUP BY date
      ORDER BY date ASC
    `).bind(startIso).all<DailyCountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE received_at >= ?").bind(monthStartIso).first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM messages WHERE sent_at >= ?").bind(monthStartIso).first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM media_objects WHERE created_at >= ?").bind(monthStartIso).first<DailyCountRow>(),
  ]);

  for (const row of rawDaily.results ?? []) {
    const point = daily.get(row.date);
    if (point) point.rawEvents = row.count;
  }
  for (const row of messageDaily.results ?? []) {
    const point = daily.get(row.date);
    if (point) point.messages = row.count;
  }
  for (const row of mediaDaily.results ?? []) {
    const point = daily.get(row.date);
    if (point) {
      point.mediaObjects = row.count;
      point.mediaBytes = row.bytes ?? 0;
    }
  }

  return {
    daily: Array.from(daily.values()),
    monthToDate: {
      rawEvents: rawMonth?.count ?? 0,
      messages: messageMonth?.count ?? 0,
      mediaObjects: mediaMonth?.count ?? 0,
      mediaBytes: mediaMonth?.bytes ?? 0,
    },
  };
}

function hasAuditData(counts: DashboardSettings["auditDataCounts"]): boolean {
  return counts.rawEvents > 0
    || counts.messages > 0
    || counts.mediaObjects > 0
    || counts.membershipEvents > 0
    || counts.membershipPeriods > 0
    || counts.hourlyGroupMetrics > 0
    || counts.hourlyUserMetrics > 0
    || counts.monthlyUserSnapshots > 0;
}

export async function updateGroupSettings(
  env: Env,
  input: {
    auditChatId: number;
    caaChatId: number;
  },
): Promise<DashboardSettings> {
  const currentGroups = await readGroupSettings(env);
  if (input.auditChatId !== currentGroups.auditChatId) {
    const counts = await queryAuditDataCounts(env.DB);
    if (hasAuditData(counts)) {
      throw new Error("audit group change requires audit reset");
    }
  }

  await upsertNumberSetting(env.DB, "groups.audit_chat_id", input.auditChatId);
  await upsertNumberSetting(env.DB, "groups.caa_chat_id", input.caaChatId);

  return getDashboardSettings(env, true);
}

export async function updateMemberActivityThresholds(
  env: Env,
  input: MemberActivityThresholds,
): Promise<DashboardSettings> {
  if (
    !Number.isSafeInteger(input.goodHours)
    || !Number.isSafeInteger(input.warmHours)
    || input.goodHours <= 0
    || input.warmHours <= input.goodHours
  ) {
    throw new Error("activity thresholds require goodHours > 0 and warmHours > goodHours");
  }

  await upsertJsonSetting(env.DB, "members.activity_thresholds", input);
  return getDashboardSettings(env, true);
}

export async function updateMessageRetentionSettings(
  env: Env,
  input: MessageRetentionSettings,
  changedBy: {
    userId: number;
    username: string | null;
  },
  canManagePrivilegedSettings: boolean,
): Promise<DashboardSettings> {
  if (!validMessageDetailRetentionDays(input.detailDays)) {
    throw new Error("message retention requires detailDays between 1 and 30");
  }

  const groups = await readGroupSettings(env);
  if (groups.caaChatId === null) {
    throw new Error("CAA group is not configured");
  }

  const current = await readMessageRetentionSettings(env.DB);
  if (input.detailDays !== current.detailDays) {
    const actor = changedBy.username ?? String(changedBy.userId);
    await sendTelegramMessage(
      env,
      groups.caaChatId,
      `Kornibot: ${actor} ha canviat la retencio de missatges a ${input.detailDays} dies. El canvi s'aplicara al proper cron.`,
    );
  }

  await upsertNumberSetting(env.DB, "privacy.message_detail_retention_days", input.detailDays);
  return getDashboardSettings(env, canManagePrivilegedSettings);
}

export async function updateAuditChatId(env: Env, auditChatId: number): Promise<void> {
  await upsertNumberSetting(env.DB, "groups.audit_chat_id", auditChatId);
}

export async function getDashboardSettings(env: Env, canManagePrivilegedSettings: boolean): Promise<DashboardSettings> {
  return {
    groups: await readGroupSettings(env),
    memberActivityThresholds: await readMemberActivityThresholds(env),
    messageRetention: await readMessageRetentionSettings(env.DB),
    canManagePrivilegedSettings,
    safeEnv: getSafeEnvSettings(env),
    auditDataCounts: await queryAuditDataCounts(env.DB),
    auditUsage: await queryAuditUsage(env.DB),
  };
}

export async function querySetupStatus(env: Env): Promise<{
  isComplete: boolean;
  auditChatId: number;
  caaChatId: number | null;
  bootstrapSuperadminConfigured: boolean;
  safeEnv: SafeEnvSettings;
}> {
  const groups = await readGroupSettings(env);

  return {
    isComplete: groups.caaChatId !== null,
    auditChatId: groups.auditChatId,
    caaChatId: groups.caaChatId,
    bootstrapSuperadminConfigured: Number.isSafeInteger(Number(env.BOOTSTRAP_SUPERADMIN_USER_ID)),
    safeEnv: getSafeEnvSettings(env),
  };
}

export async function queryTelegramChats(env: Env): Promise<TelegramChatSummary[]> {
  const groups = await readGroupSettings(env);
  const rows = await env.DB.prepare(`
      SELECT chat_id, title, type, first_seen_at, last_activity_at, last_update_id
      FROM telegram_chats
      ORDER BY last_activity_at DESC, chat_id ASC
    `)
    .all<TelegramChatRow>();

  return rows.results.map((row) => ({
    chatId: row.chat_id,
    title: row.title,
    type: row.type,
    firstSeenAt: row.first_seen_at,
    lastActivityAt: row.last_activity_at,
    lastUpdateId: row.last_update_id,
    isAuditChat: row.chat_id === groups.auditChatId,
    isCaaChat: row.chat_id === groups.caaChatId,
  }));
}
