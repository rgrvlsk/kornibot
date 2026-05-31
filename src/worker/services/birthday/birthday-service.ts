import type { Env } from "../../../shared/env";
import { addDays, addMonthsUtc, birthdayCelebrationDate, dateKey } from "./birthday-utils";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type BirthdayPreferenceRow = {
  user_id: number;
  month: number;
  day: number;
  year: number | null;
  wants_ai_card: number;
  prompt_ideas_json: string;
  updated_at: string;
};

type BirthdayCardRow = {
  id: number;
  scope_type: "global" | "window" | "member";
  window_id: number | null;
  user_id: number | null;
  state: "available" | "used" | "archived" | "disabled";
  r2_key: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  uploaded_by_user_id: number;
  uploaded_at: string;
  used_at: string | null;
  used_for_user_id: number | null;
  disabled_at: string | null;
};

type BirthdayWindowRow = {
  id: number;
  preset_key: string | null;
  label: string;
  starts_on: string;
  ends_on: string;
  color: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

type AvailableGenericCardRow = {
  id: number;
  scope_type: "global" | "window";
  window_id: number | null;
  uploaded_at: string;
};

type BirthdayDemandRow = {
  user_id: number;
  username: string | null;
  nickname: string | null;
  first_name: string | null;
  month: number;
  day: number;
  year: number | null;
  wants_ai_card: number;
  member_card_count: number;
};

type IdRow = {
  id: number;
};

type BirthdayCardPage = {
  cards: BirthdayCard[];
  nextCursor: number | null;
};

export type BirthdayPreference = {
  month: number;
  day: number;
  year: number | null;
  wantsAiCard: boolean;
  promptIdeas: string[];
  updatedAt: string;
  customCard: BirthdayCard | null;
};

export type BirthdayCard = {
  id: number;
  scopeType: "global" | "window" | "member";
  windowId: number | null;
  userId: number | null;
  state: "available" | "used" | "archived" | "disabled";
  r2Key: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  uploadedByUserId: number;
  uploadedAt: string;
  usedAt: string | null;
  usedForUserId: number | null;
  disabledAt: string | null;
};

export type BirthdayWindow = {
  id: number;
  presetKey: string | null;
  label: string;
  startsOn: string;
  endsOn: string;
  color: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BirthdayInput = {
  month: number;
  day: number;
  year: number | null;
  wantsAiCard: boolean;
  promptIdeas: string[];
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_CARD_MIME_TYPE = "application/octet-stream";
const PRESET_WINDOWS_SEEDED_SETTING = "birthday.preset_windows_seeded_at";
const BIRTHDAY_MIN_AGE = 16;
const BIRTHDAY_MAX_AGE = 80;
const BIRTHDAY_CARD_STATES = ["available", "used", "archived", "disabled"] as const;
const PRESET_WINDOWS = [
  { key: "reis", label: "Reis", color: "#f0c328", start: { month: 1, day: 2 }, end: { month: 1, day: 7 } },
  { key: "santa_eulalia", label: "Santa Eulalia", color: "#7ab7ff", start: { month: 2, day: 8 }, end: { month: 2, day: 12 } },
  { key: "sant_medir", label: "Sant Medir", color: "#b8f05a", start: { month: 3, day: 1 }, end: { month: 3, day: 4 } },
  { key: "carnaval", label: "Carnaval", color: "#ff7f8b", start: { month: 2, day: 6 }, end: { month: 2, day: 18 } },
  { key: "pasqua", label: "Pasqua", color: "#c7a7ff", start: { month: 3, day: 24 }, end: { month: 4, day: 6 } },
  { key: "sant_jordi", label: "Sant Jordi", color: "#ff5f57", start: { month: 4, day: 20 }, end: { month: 4, day: 24 } },
  { key: "corpus", label: "Corpus", color: "#f2f0d2", start: { month: 5, day: 28 }, end: { month: 6, day: 4 } },
  { key: "sant_joan", label: "Sant Joan", color: "#ffad2f", start: { month: 6, day: 18 }, end: { month: 6, day: 25 } },
  { key: "pride_barcelona", label: "Pride Barcelona", color: "#70d6ff", start: { month: 6, day: 20 }, end: { month: 7, day: 1 } },
  { key: "festa_major", label: "Festa Major Gracia/Sants", color: "#d6a761", start: { month: 8, day: 14 }, end: { month: 8, day: 31 } },
  { key: "diada", label: "Diada", color: "#f0c328", start: { month: 9, day: 8 }, end: { month: 9, day: 12 } },
  { key: "merce", label: "La Merce", color: "#b8f05a", start: { month: 9, day: 19 }, end: { month: 9, day: 25 } },
  { key: "castanyada", label: "Castanyada", color: "#d6a761", start: { month: 10, day: 24 }, end: { month: 11, day: 7 } },
  { key: "nadal", label: "Nadal", color: "#7ab7ff", start: { month: 12, day: 20 }, end: { month: 1, day: 6 } },
] as const;

function parsePromptIdeas(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function normalizePromptIdeas(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function assertDateString(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || dateKey(parsed) !== value) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
}

function currentYear(now = new Date()): number {
  return now.getUTCFullYear();
}

function isRealisticBirthdayYear(year: number, now = new Date()): boolean {
  const age = currentYear(now) - year;
  return age >= BIRTHDAY_MIN_AGE && age <= BIRTHDAY_MAX_AGE;
}

export function normalizeBirthdayYear(year: number | null, now = new Date()): number | null {
  if (year === null) {
    return null;
  }

  if (!Number.isSafeInteger(year) || year < 0) {
    throw new Error("year must be null or make age 16-80");
  }

  const candidates = year <= 99
    ? [1900 + year, 2000 + year]
    : [year];
  const realistic = candidates.filter((candidate) => isRealisticBirthdayYear(candidate, now));
  if (realistic.length === 1) {
    return realistic[0];
  }

  throw new Error("year must be null or make age 16-80");
}

function assertBirthdayWindowInput(input: {
  label: string;
  startsOn: string;
  endsOn: string;
}): string {
  const label = input.label.trim();
  if (!label) {
    throw new Error("label is required");
  }
  assertDateString(input.startsOn, "window start");
  assertDateString(input.endsOn, "window end");
  if (input.endsOn < input.startsOn) {
    throw new Error("window end must be after start");
  }

  return label;
}

function assertBirthdayDate(input: BirthdayInput): void {
  if (!Number.isSafeInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error("month must be 1-12");
  }

  const maxDay = input.month === 2 ? 29 : ([4, 6, 9, 11].includes(input.month) ? 30 : 31);
  if (!Number.isSafeInteger(input.day) || input.day < 1 || input.day > maxDay) {
    throw new Error("day is not valid for month");
  }

  if (input.year !== null && !Number.isSafeInteger(input.year)) {
    throw new Error("year must be null or a valid year");
  }
}

function toPreference(row: BirthdayPreferenceRow, customCard: BirthdayCard | null): BirthdayPreference {
  return {
    month: row.month,
    day: row.day,
    year: row.year,
    wantsAiCard: row.wants_ai_card === 1,
    promptIdeas: parsePromptIdeas(row.prompt_ideas_json),
    updatedAt: row.updated_at,
    customCard,
  };
}

function toCard(row: BirthdayCardRow): BirthdayCard {
  return {
    id: row.id,
    scopeType: row.scope_type,
    windowId: row.window_id,
    userId: row.user_id,
    state: row.state,
    r2Key: row.r2_key,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedAt: row.uploaded_at,
    usedAt: row.used_at,
    usedForUserId: row.used_for_user_id,
    disabledAt: row.disabled_at,
  };
}

function toWindow(row: BirthdayWindowRow): BirthdayWindow {
  return {
    id: row.id,
    presetKey: row.preset_key,
    label: row.label,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    color: row.color,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function presetDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function presetRangeForYear(
  preset: (typeof PRESET_WINDOWS)[number],
  year: number,
): { startsOn: string; endsOn: string } {
  const startsOn = presetDate(year, preset.start.month, preset.start.day);
  const endYear = preset.end.month < preset.start.month ? year + 1 : year;
  return {
    startsOn,
    endsOn: presetDate(endYear, preset.end.month, preset.end.day),
  };
}

export async function ensureUpcomingBirthdayWindows(
  db: D1DatabaseLike,
  anchorDate: Date,
): Promise<void> {
  const seeded = await db.prepare("SELECT value_json FROM settings WHERE key = ?")
    .bind(PRESET_WINDOWS_SEEDED_SETTING)
    .first<{ value_json: string }>();
  if (seeded) {
    return;
  }

  const anchorYear = anchorDate.getUTCFullYear();
  const years = [anchorYear - 1, anchorYear, anchorYear + 1];

  for (const year of years) {
    for (const preset of PRESET_WINDOWS) {
      const range = presetRangeForYear(preset, year);
      const exists = await db.prepare(`
          SELECT id
          FROM birthday_windows
          WHERE preset_key = ?
            AND starts_on = ?
          LIMIT 1
        `)
        .bind(preset.key, range.startsOn)
        .first<IdRow>();

      if (exists) {
        continue;
      }

      await db.prepare(`
          INSERT OR IGNORE INTO birthday_windows (
            preset_key,
            label,
            starts_on,
            ends_on,
            color,
            enabled,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, 1, ?)
        `)
        .bind(
          preset.key,
          preset.label,
          range.startsOn,
          range.endsOn,
          preset.color,
          new Date().toISOString(),
        )
        .run();
    }
  }

  await markPresetWindowsSeeded(db);
}

async function markPresetWindowsSeeded(db: D1DatabaseLike): Promise<void> {
  await db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `)
    .bind(PRESET_WINDOWS_SEEDED_SETTING, JSON.stringify(new Date().toISOString()), new Date().toISOString())
    .run();
}

export async function upsertBirthdayPreference(
  db: D1DatabaseLike,
  userId: number,
  input: BirthdayInput,
): Promise<BirthdayPreference> {
  const normalizedInput = {
    ...input,
    year: normalizeBirthdayYear(input.year),
    promptIdeas: normalizePromptIdeas(input.promptIdeas),
  };
  assertBirthdayDate(normalizedInput);

  await db.prepare(`
      INSERT INTO birthday_preferences (
        user_id,
        month,
        day,
        year,
        wants_ai_card,
        prompt_ideas_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        month = excluded.month,
        day = excluded.day,
        year = excluded.year,
        wants_ai_card = excluded.wants_ai_card,
        prompt_ideas_json = excluded.prompt_ideas_json,
        updated_at = excluded.updated_at
    `)
    .bind(
      userId,
      normalizedInput.month,
      normalizedInput.day,
      normalizedInput.year,
      normalizedInput.wantsAiCard ? 1 : 0,
      JSON.stringify(normalizedInput.promptIdeas),
      new Date().toISOString(),
    )
    .run();

  if (!normalizedInput.wantsAiCard) {
    await disableMemberBirthdayCards(db, userId);
  }

  const saved = await queryBirthdayPreference(db, userId);
  if (!saved) {
    throw new Error("birthday preference was not saved");
  }

  return saved;
}

export async function deleteBirthdayPreference(db: D1DatabaseLike, userId: number): Promise<void> {
  await disableMemberBirthdayCards(db, userId);
  await db.prepare("DELETE FROM birthday_preferences WHERE user_id = ?").bind(userId).run();
}

async function disableMemberBirthdayCards(db: D1DatabaseLike, userId: number): Promise<void> {
  await db.prepare(`
      UPDATE birthday_cards
      SET state = 'disabled',
          disabled_at = COALESCE(disabled_at, ?)
      WHERE scope_type = 'member'
        AND user_id = ?
        AND state = 'available'
    `)
    .bind(new Date().toISOString(), userId)
    .run();
}

export async function queryBirthdayPreference(
  db: D1DatabaseLike,
  userId: number,
): Promise<BirthdayPreference | null> {
  const row = await db.prepare(`
      SELECT user_id, month, day, year, wants_ai_card, prompt_ideas_json, updated_at
      FROM birthday_preferences
      WHERE user_id = ?
    `)
    .bind(userId)
    .first<BirthdayPreferenceRow>();

  if (!row) {
    return null;
  }

  const cardRow = await db.prepare(`
      SELECT *
      FROM birthday_cards
      WHERE scope_type = 'member'
        AND user_id = ?
        AND state = 'available'
      ORDER BY uploaded_at DESC, id DESC
      LIMIT 1
    `)
    .bind(userId)
    .first<BirthdayCardRow>();

  return toPreference(row, cardRow ? toCard(cardRow) : null);
}

export async function createBirthdayWindow(
  db: D1DatabaseLike,
  input: {
    presetKey: string | null;
    label: string;
    startsOn: string;
    endsOn: string;
    color: string;
    enabled: boolean;
  },
): Promise<BirthdayWindow> {
  const label = assertBirthdayWindowInput(input);

  const result = await db.prepare(`
      INSERT INTO birthday_windows (
        preset_key,
        label,
        starts_on,
        ends_on,
        color,
        enabled,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      input.presetKey,
      label,
      input.startsOn,
      input.endsOn,
      input.color || "#7ab7ff",
      input.enabled ? 1 : 0,
      new Date().toISOString(),
    )
    .run();

  const row = await db.prepare("SELECT * FROM birthday_windows WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first<BirthdayWindowRow>();
  if (!row) {
    throw new Error("birthday window was not saved");
  }

  return toWindow(row);
}

export async function listBirthdayWindows(db: D1DatabaseLike): Promise<BirthdayWindow[]> {
  const rows = await db.prepare(`
      SELECT *
      FROM birthday_windows
      ORDER BY starts_on ASC, id ASC
    `)
    .all<BirthdayWindowRow>();

  return rows.results.map(toWindow);
}

export async function queryBirthdayWindow(db: D1DatabaseLike, windowId: number): Promise<BirthdayWindow | null> {
  const row = await db.prepare("SELECT * FROM birthday_windows WHERE id = ?")
    .bind(windowId)
    .first<BirthdayWindowRow>();
  return row ? toWindow(row) : null;
}

export async function deleteBirthdayWindow(db: D1DatabaseLike, windowId: number): Promise<boolean> {
  const existing = await db.prepare("SELECT id FROM birthday_windows WHERE id = ?")
    .bind(windowId)
    .first<IdRow>();
  if (!existing) {
    return false;
  }

  await db.prepare("DELETE FROM birthday_windows WHERE id = ?")
    .bind(windowId)
    .run();

  return true;
}

export async function listBirthdayCards(
  db: D1DatabaseLike,
  options: {
    cursor?: number;
    limit?: number;
  } = {},
): Promise<BirthdayCardPage> {
  const limit = Math.max(1, Math.min(options.limit ?? 60, 100));
  const cursor = Math.max(0, options.cursor ?? 0);
  const rows = await db.prepare(`
      SELECT *
      FROM birthday_cards
      ORDER BY
        CASE state
          WHEN 'available' THEN 0
          WHEN 'used' THEN 1
          WHEN 'archived' THEN 2
          ELSE 3
        END,
        uploaded_at DESC,
        id DESC
      LIMIT ?
      OFFSET ?
    `)
    .bind(limit + 1, cursor)
    .all<BirthdayCardRow>();

  const cards = rows.results.slice(0, limit).map(toCard);
  return {
    cards,
    nextCursor: rows.results.length > limit ? cursor + limit : null,
  };
}

export async function patchBirthdayWindow(
  db: D1DatabaseLike,
  windowId: number,
  input: Partial<{
    label: string;
    startsOn: string;
    endsOn: string;
    color: string;
    enabled: boolean;
  }>,
): Promise<BirthdayWindow | null> {
  const current = await db.prepare("SELECT * FROM birthday_windows WHERE id = ?")
    .bind(windowId)
    .first<BirthdayWindowRow>();
  if (!current) {
    return null;
  }

  return createOrUpdateWindow(db, windowId, {
    label: input.label ?? current.label,
    startsOn: input.startsOn ?? current.starts_on,
    endsOn: input.endsOn ?? current.ends_on,
    color: input.color ?? current.color,
    enabled: input.enabled ?? current.enabled === 1,
  });
}

async function createOrUpdateWindow(
  db: D1DatabaseLike,
  windowId: number,
  input: {
    label: string;
    startsOn: string;
    endsOn: string;
    color: string;
    enabled: boolean;
  },
): Promise<BirthdayWindow> {
  const label = assertBirthdayWindowInput(input);

  await db.prepare(`
      UPDATE birthday_windows
      SET label = ?,
          starts_on = ?,
          ends_on = ?,
          color = ?,
          enabled = ?,
          updated_at = ?
      WHERE id = ?
    `)
    .bind(label, input.startsOn, input.endsOn, input.color || "#7ab7ff", input.enabled ? 1 : 0, new Date().toISOString(), windowId)
    .run();

  const row = await db.prepare("SELECT * FROM birthday_windows WHERE id = ?")
    .bind(windowId)
    .first<BirthdayWindowRow>();
  if (!row) {
    throw new Error("birthday window was not saved");
  }

  return toWindow(row);
}

export async function createBirthdayCard(
  env: Env,
  input: {
    scopeType: "global" | "window" | "member";
    windowId: number | null;
    userId: number | null;
    uploadedByUserId: number;
    file: File;
  },
): Promise<BirthdayCard> {
  if (!["global", "window", "member"].includes(input.scopeType)) {
    throw new Error("invalid card scope");
  }
  if (input.scopeType === "window" && !input.windowId) {
    throw new Error("windowId is required for window cards");
  }
  if (input.scopeType === "member" && !input.userId) {
    throw new Error("userId is required for member cards");
  }
  if (!input.file.type.startsWith("image/")) {
    throw new Error("card file must be an image");
  }
  if (input.file.size > MAX_IMAGE_BYTES) {
    throw new Error("card file must be 10MB or smaller");
  }

  await assertCardScopeTargets(env.DB, input);

  const now = new Date().toISOString();
  const key = `birthday/cards/${input.scopeType}/${input.userId ?? input.windowId ?? "global"}/${crypto.randomUUID()}-${sanitizeFileName(input.file.name)}`;
  await env.MEDIA_BUCKET.put(key, await input.file.arrayBuffer(), {
    httpMetadata: {
      contentType: input.file.type || DEFAULT_CARD_MIME_TYPE,
    },
  });

  const result = await env.DB.prepare(`
      INSERT INTO birthday_cards (
        scope_type,
        window_id,
        user_id,
        state,
        r2_key,
        file_name,
        mime_type,
        size_bytes,
        uploaded_by_user_id,
        uploaded_at
      )
      VALUES (?, ?, ?, 'available', ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      input.scopeType,
      input.windowId,
      input.userId,
      key,
      input.file.name,
      input.file.type || DEFAULT_CARD_MIME_TYPE,
      input.file.size,
      input.uploadedByUserId,
      now,
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM birthday_cards WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first<BirthdayCardRow>();
  if (!row) {
    throw new Error("birthday card was not saved");
  }

  return toCard(row);
}

async function assertCardScopeTargets(
  db: D1DatabaseLike,
  input: {
    scopeType: "global" | "window" | "member";
    windowId: number | null;
    userId: number | null;
  },
): Promise<void> {
  if (input.scopeType === "window") {
    const row = await db.prepare("SELECT id FROM birthday_windows WHERE id = ?")
      .bind(input.windowId)
      .first<IdRow>();
    if (!row) {
      throw new Error("birthday window not found");
    }
  }

  if (input.scopeType === "member") {
    const row = await db.prepare("SELECT user_id AS id FROM users WHERE user_id = ?")
      .bind(input.userId)
      .first<IdRow>();
    if (!row) {
      throw new Error("member not found");
    }
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "card";
}

export async function patchBirthdayCard(
  db: D1DatabaseLike,
  cardId: number,
  input: {
    state?: "available" | "used" | "archived" | "disabled";
  },
): Promise<BirthdayCard | null> {
  const row = await db.prepare("SELECT * FROM birthday_cards WHERE id = ?")
    .bind(cardId)
    .first<BirthdayCardRow>();
  if (!row) {
    return null;
  }

  const state = input.state ?? row.state;
  if (!BIRTHDAY_CARD_STATES.includes(state)) {
    throw new Error("invalid birthday card state");
  }

  await db.prepare(`
      UPDATE birthday_cards
      SET state = ?,
          disabled_at = CASE WHEN ? = 'disabled' THEN COALESCE(disabled_at, ?) ELSE disabled_at END
      WHERE id = ?
    `)
    .bind(state, state, new Date().toISOString(), cardId)
    .run();

  const next = await db.prepare("SELECT * FROM birthday_cards WHERE id = ?")
    .bind(cardId)
    .first<BirthdayCardRow>();
  return next ? toCard(next) : null;
}

export async function queryBirthdayCard(
  db: D1DatabaseLike,
  cardId: number,
): Promise<BirthdayCard | null> {
  const row = await db.prepare("SELECT * FROM birthday_cards WHERE id = ?")
    .bind(cardId)
    .first<BirthdayCardRow>();
  return row ? toCard(row) : null;
}

export async function queryBirthdayAlmanac(
  db: D1DatabaseLike,
  options: {
    from: string;
    months: number;
  },
): Promise<{
  from: string;
  through: string;
  windows: BirthdayWindow[];
  birthdays: Array<{
    date: string;
    userId: number;
    username: string | null;
    nickname: string | null;
    firstName: string | null;
    wantsAiCard: boolean;
    hasUnusedMemberCard: boolean;
  }>;
  warnings: Array<{
    date: string;
    neededGenericCards: number;
    availableGenericCards: number;
  }>;
}> {
  const months = Math.min(Math.max(options.months, 1), 12);
  assertDateString(options.from, "from");
  const fromDate = new Date(`${options.from}T00:00:00.000Z`);
  const throughDate = addDays(addMonthsUtc(fromDate, months), -1);
  const through = dateKey(throughDate);
  await ensureUpcomingBirthdayWindows(db, fromDate);
  const windows = await listBirthdayWindows(db);
  const activeWindows = windows.filter((window) => window.enabled && window.endsOn >= options.from && window.startsOn <= through);
  const birthdays: Array<{
    date: string;
    userId: number;
    username: string | null;
    nickname: string | null;
    firstName: string | null;
    wantsAiCard: boolean;
    hasUnusedMemberCard: boolean;
  }> = [];

  for (let year = fromDate.getUTCFullYear(); year <= throughDate.getUTCFullYear(); year += 1) {
    const rows = await db.prepare(`
        SELECT
          users.user_id,
          users.username,
          users.nickname,
          users.first_name,
          birthday_preferences.month,
          birthday_preferences.day,
          birthday_preferences.year,
          birthday_preferences.wants_ai_card,
          (
            SELECT COUNT(*)
            FROM birthday_cards
            WHERE birthday_cards.scope_type = 'member'
              AND birthday_cards.user_id = users.user_id
              AND birthday_cards.state = 'available'
          ) AS member_card_count
        FROM birthday_preferences
        INNER JOIN users ON users.user_id = birthday_preferences.user_id
        WHERE COALESCE(users.last_membership_status, 'member') IN ('member', 'administrator', 'creator', 'restricted')
      `)
      .all<BirthdayDemandRow>();

    for (const row of rows.results) {
      const celebrationDate = birthdayCelebrationDate({ month: row.month, day: row.day, year: row.year }, year);
      if (celebrationDate < options.from || celebrationDate > through) {
        continue;
      }

      birthdays.push({
        date: celebrationDate,
        userId: row.user_id,
        username: row.username,
        nickname: row.nickname,
        firstName: row.first_name,
        wantsAiCard: row.wants_ai_card === 1,
        hasUnusedMemberCard: row.member_card_count > 0,
      });
    }
  }

  const warnings: Array<{ date: string; neededGenericCards: number; availableGenericCards: number }> = [];
  const genericCards = await listAvailableGenericCards(db);
  const birthdayDates = [...new Set(birthdays.map((birthday) => birthday.date))].sort();
  for (const birthdayDate of birthdayDates) {
    const neededGenericCards = birthdays.filter((birthday) => (
      birthday.date === birthdayDate
      && birthday.wantsAiCard
      && !birthday.hasUnusedMemberCard
    )).length;

    if (neededGenericCards === 0) {
      continue;
    }

    const availableGenericCards = countEligibleGenericCards(genericCards, birthdayDate, activeWindows);
    if (availableGenericCards < neededGenericCards) {
      warnings.push({ date: birthdayDate, neededGenericCards, availableGenericCards });
    }

    consumeGenericCards(genericCards, birthdayDate, activeWindows, neededGenericCards);
  }

  return {
    from: options.from,
    through,
    windows: activeWindows,
    birthdays,
    warnings,
  };
}

async function listAvailableGenericCards(
  db: D1DatabaseLike,
): Promise<AvailableGenericCardRow[]> {
  const rows = await db.prepare(`
      SELECT id, scope_type, window_id, uploaded_at
      FROM birthday_cards
      WHERE state = 'available'
        AND scope_type IN ('global', 'window')
      ORDER BY uploaded_at ASC, id ASC
    `)
    .all<AvailableGenericCardRow>();

  return rows.results;
}

function countEligibleGenericCards(
  cards: AvailableGenericCardRow[],
  date: string,
  windows: BirthdayWindow[],
): number {
  return cards.filter((card) => isGenericCardEligible(card, date, windows)).length;
}

function consumeGenericCards(
  cards: AvailableGenericCardRow[],
  date: string,
  windows: BirthdayWindow[],
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const cardIndex = bestEligibleGenericCardIndex(cards, date, windows);
    if (cardIndex === -1) {
      return;
    }

    cards.splice(cardIndex, 1);
  }
}

function bestEligibleGenericCardIndex(
  cards: AvailableGenericCardRow[],
  date: string,
  windows: BirthdayWindow[],
): number {
  const candidates = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => isGenericCardEligible(card, date, windows))
    .sort((left, right) => {
      const leftWindow = left.card.window_id ? windows.find((window) => window.id === left.card.window_id) : null;
      const rightWindow = right.card.window_id ? windows.find((window) => window.id === right.card.window_id) : null;
      const leftScope = left.card.scope_type === "window" ? 0 : 1;
      const rightScope = right.card.scope_type === "window" ? 0 : 1;
      if (leftScope !== rightScope) {
        return leftScope - rightScope;
      }

      const leftEnd = leftWindow?.endsOn ?? "9999-12-31";
      const rightEnd = rightWindow?.endsOn ?? "9999-12-31";
      if (leftEnd !== rightEnd) {
        return leftEnd.localeCompare(rightEnd);
      }

      if (left.card.uploaded_at !== right.card.uploaded_at) {
        return left.card.uploaded_at.localeCompare(right.card.uploaded_at);
      }

      return left.card.id - right.card.id;
    });

  return candidates[0]?.index ?? -1;
}

function isGenericCardEligible(
  card: AvailableGenericCardRow,
  date: string,
  windows: BirthdayWindow[],
): boolean {
  if (card.scope_type === "global") {
    return true;
  }

  return windows.some((window) => (
    window.id === card.window_id
    && date >= window.startsOn
    && date <= window.endsOn
  ));
}
