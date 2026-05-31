import type { Env } from "../../../shared/env";
import { readGroupSettings } from "../settings/group-settings";
import { fetchTelegramChatMember, isActiveTelegramChatMember } from "../telegram/fetch-chat-member";
import { sendTelegramMessage, sendTelegramPhoto } from "../telegram/api";
import { birthdayCelebrationDate, localBarcelonaParts } from "./birthday-utils";

type BirthdayCandidateRow = {
  user_id: number;
  username: string | null;
  first_name: string | null;
  nickname: string | null;
  month: number;
  day: number;
  year: number | null;
  wants_ai_card: number;
};

type BirthdayCardRow = {
  id: number;
  r2_key: string;
  file_name: string | null;
  mime_type: string | null;
};

type BirthdayWindowRow = {
  id: number;
};

type ExistingLogRow = {
  status: string;
  birthday_card_id: number | null;
};

const TELEGRAM_RETRY_ATTEMPTS = 3;

export async function runBirthdayGreetingSender(
  env: Env,
  now = new Date(),
): Promise<{ checked: number; sent: number; skipped: number }> {
  const local = localBarcelonaParts(now);
  if (local.hour !== 8 || local.minute !== 8) {
    return { checked: 0, sent: 0, skipped: 0 };
  }

  const groups = await readGroupSettings(env);
  const candidates = await findBirthdayCandidates(env, local.year, local.date);
  let checked = 0;
  let sent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const existing = await env.DB.prepare(`
        SELECT status, birthday_card_id
        FROM birthday_send_log
        WHERE user_id = ? AND celebration_date = ?
      `)
      .bind(candidate.user_id, local.date)
      .first<ExistingLogRow>();

    if (existing?.status === "sent" || existing?.status === "skipped") {
      skipped += 1;
      continue;
    }

    checked += 1;
    if (existing?.birthday_card_id) {
      await restoreReservedCard(env, existing.birthday_card_id, candidate.user_id);
    }

    await env.DB.prepare(`
        INSERT INTO birthday_send_log (
          user_id,
          celebration_date,
          status
        )
        VALUES (?, ?, 'pending')
        ON CONFLICT(user_id, celebration_date) DO UPDATE SET
          status = 'pending',
          birthday_card_id = NULL,
          telegram_message_id = NULL,
          sent_at = NULL,
          error_message = NULL
      `)
      .bind(candidate.user_id, local.date)
      .run();

    let card: BirthdayCardRow | null = null;
    const caption = birthdayCaption(candidate, local.year);

    try {
      const chatMember = await fetchTelegramChatMemberWithRetry(env, groups.auditChatId, candidate.user_id);
      if (!isActiveTelegramChatMember(chatMember)) {
        await markSendSkipped(env, candidate.user_id, local.date, "member is not active");
        skipped += 1;
        continue;
      }

      card = candidate.wants_ai_card === 1
        ? await reserveBirthdayCard(env, candidate.user_id, local.date)
        : null;
      if (card) {
        await markPendingCard(env, candidate.user_id, local.date, card.id);
      }

      const message = await retryTelegram(async () => card
        ? sendCard(env, groups.auditChatId, card, caption)
        : sendTelegramMessage(env, groups.auditChatId, caption));
      await env.DB.prepare(`
          UPDATE birthday_send_log
          SET status = 'sent',
              birthday_card_id = ?,
              telegram_message_id = ?,
              sent_at = ?
          WHERE user_id = ? AND celebration_date = ?
        `)
        .bind(card?.id ?? null, message.message_id ?? null, now.toISOString(), candidate.user_id, local.date)
        .run();
      sent += 1;
    } catch (error) {
      if (card) {
        await restoreReservedCard(env, card.id, candidate.user_id);
      }

      await env.DB.prepare(`
          UPDATE birthday_send_log
          SET status = 'failed',
              birthday_card_id = NULL,
              error_message = ?
          WHERE user_id = ? AND celebration_date = ?
        `)
        .bind(error instanceof Error ? error.message : "birthday send failed", candidate.user_id, local.date)
        .run();
      skipped += 1;
    }
  }

  return { checked, sent, skipped };
}

async function findBirthdayCandidates(env: Env, year: number, celebrationDate: string): Promise<BirthdayCandidateRow[]> {
  const rows = await env.DB.prepare(`
      SELECT
        users.user_id,
        users.username,
        users.first_name,
        users.nickname,
        birthday_preferences.month,
        birthday_preferences.day,
        birthday_preferences.year,
        birthday_preferences.wants_ai_card
      FROM birthday_preferences
      INNER JOIN users ON users.user_id = birthday_preferences.user_id
      WHERE COALESCE(users.last_membership_status, 'member') IN ('member', 'administrator', 'creator', 'restricted')
      ORDER BY users.user_id ASC
    `)
    .all<BirthdayCandidateRow>();

  return rows.results.filter((row) => (
    birthdayCelebrationDate({ month: row.month, day: row.day, year: row.year }, year) === celebrationDate
  ));
}

async function reserveBirthdayCard(
  env: Env,
  userId: number,
  celebrationDate: string,
): Promise<BirthdayCardRow | null> {
  const memberCard = await env.DB.prepare(`
      SELECT id, r2_key, file_name, mime_type
      FROM birthday_cards
      WHERE scope_type = 'member'
        AND user_id = ?
        AND state = 'available'
      ORDER BY uploaded_at ASC, id ASC
      LIMIT 1
    `)
    .bind(userId)
    .first<BirthdayCardRow>();

  if (memberCard && await markCardUsed(env, memberCard.id, userId)) {
    return memberCard;
  }

  const windowRows = await env.DB.prepare(`
      SELECT id
      FROM birthday_windows
      WHERE enabled = 1
        AND starts_on <= ?
        AND ends_on >= ?
      ORDER BY starts_on ASC, id ASC
    `)
    .bind(celebrationDate, celebrationDate)
    .all<BirthdayWindowRow>();
  const windowIds = windowRows.results.map((row) => row.id);
  const genericCard = windowIds.length > 0
    ? await env.DB.prepare(`
        SELECT id, r2_key, file_name, mime_type
        FROM birthday_cards
        WHERE state = 'available'
          AND (
            scope_type = 'global'
            OR (scope_type = 'window' AND window_id IN (${windowIds.map(() => "?").join(", ")}))
          )
        ORDER BY
          CASE scope_type WHEN 'window' THEN 0 ELSE 1 END,
          RANDOM()
        LIMIT 1
      `)
      .bind(...windowIds)
      .first<BirthdayCardRow>()
    : await env.DB.prepare(`
        SELECT id, r2_key, file_name, mime_type
        FROM birthday_cards
        WHERE state = 'available'
          AND scope_type = 'global'
        ORDER BY RANDOM()
        LIMIT 1
      `)
      .first<BirthdayCardRow>();

  if (genericCard && await markCardUsed(env, genericCard.id, userId)) {
    return genericCard;
  }

  return null;
}

async function markCardUsed(env: Env, cardId: number, userId: number): Promise<boolean> {
  const result = await env.DB.prepare(`
      UPDATE birthday_cards
      SET state = 'used',
          used_at = ?,
          used_for_user_id = ?
      WHERE id = ?
        AND state = 'available'
    `)
    .bind(new Date().toISOString(), userId, cardId)
    .run();

  return result.meta.changes > 0;
}

async function markPendingCard(env: Env, userId: number, celebrationDate: string, cardId: number): Promise<void> {
  await env.DB.prepare(`
      UPDATE birthday_send_log
      SET birthday_card_id = ?
      WHERE user_id = ? AND celebration_date = ?
    `)
    .bind(cardId, userId, celebrationDate)
    .run();
}

async function restoreReservedCard(env: Env, cardId: number, userId: number): Promise<void> {
  await env.DB.prepare(`
      UPDATE birthday_cards
      SET state = 'available',
          used_at = NULL,
          used_for_user_id = NULL
      WHERE id = ? AND state = 'used' AND used_for_user_id = ?
    `)
    .bind(cardId, userId)
    .run();
}

async function sendCard(
  env: Env,
  chatId: number,
  card: BirthdayCardRow,
  caption: string,
): Promise<{ message_id: number }> {
  const object = await env.MEDIA_BUCKET.get(card.r2_key);
  if (!object) {
    return sendTelegramMessage(env, chatId, caption);
  }

  const blob = await r2ObjectToBlob(object, card.mime_type ?? "image/png");
  return sendTelegramPhoto(env, chatId, blob, card.file_name ?? "birthday-card.png", caption);
}

async function fetchTelegramChatMemberWithRetry(
  env: Env,
  chatId: number,
  userId: number,
): Promise<Awaited<ReturnType<typeof fetchTelegramChatMember>>> {
  const member = await retryTelegram(() => fetchTelegramChatMember(env, chatId, userId), {
    shouldRetryResult: (member) => member === null,
  });
  if (member === null) {
    throw new Error("member status check failed");
  }

  return member;
}

async function retryTelegram<T>(
  operation: () => Promise<T>,
  options: {
    shouldRetryResult?: (result: T) => boolean;
  } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TELEGRAM_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await operation();
      if (attempt < TELEGRAM_RETRY_ATTEMPTS && options.shouldRetryResult?.(result)) {
        continue;
      }

      return result;
    } catch (error) {
      lastError = error;
      if (attempt === TELEGRAM_RETRY_ATTEMPTS) {
        break;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return operation();
}

async function r2ObjectToBlob(
  object: R2ObjectBody | { body: BodyInit; httpMetadata?: { contentType?: string } },
  mimeType: string,
): Promise<Blob> {
  const maybeWithArrayBuffer = object as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof maybeWithArrayBuffer.arrayBuffer === "function") {
    return new Blob([await maybeWithArrayBuffer.arrayBuffer()], { type: mimeType });
  }

  const body = (object as { body?: BodyInit }).body;
  if (typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return new Blob([body], { type: mimeType });
  }
  if (body instanceof ReadableStream) {
    return new Response(body).blob();
  }

  return new Blob([], { type: mimeType });
}

function birthdayCaption(candidate: BirthdayCandidateRow, localYear: number): string {
  const name = candidate.first_name || candidate.nickname || (candidate.username ? `@${candidate.username}` : `user ${candidate.user_id}`);
  const age = candidate.year ? ` (${localYear - candidate.year})` : "";
  const mention = candidate.username ? `@${candidate.username}` : name;
  return `Per molts anys, ${mention}${age}!`;
}

async function markSendSkipped(env: Env, userId: number, celebrationDate: string, reason: string): Promise<void> {
  await env.DB.prepare(`
      UPDATE birthday_send_log
      SET status = 'skipped',
          error_message = ?
      WHERE user_id = ? AND celebration_date = ?
    `)
    .bind(reason, userId, celebrationDate)
    .run();
}
