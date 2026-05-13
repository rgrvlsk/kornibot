import type { NormalizedTelegramUpdate } from "./normalize-update";

type D1DatabaseLike = Pick<D1Database, "prepare">;

export async function recordTelegramChat(
  db: D1DatabaseLike,
  update: NormalizedTelegramUpdate,
): Promise<void> {
  const activityAt = "observedAt" in update ? update.observedAt : new Date().toISOString();

  await db.prepare(`
      INSERT INTO telegram_chats (
        chat_id,
        title,
        type,
        first_seen_at,
        last_activity_at,
        last_update_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        title = COALESCE(excluded.title, telegram_chats.title),
        type = excluded.type,
        last_activity_at = excluded.last_activity_at,
        last_update_id = excluded.last_update_id
    `)
    .bind(
      update.chatId,
      update.chatTitle,
      update.chatType,
      activityAt,
      activityAt,
      update.updateId,
    )
    .run();
}
