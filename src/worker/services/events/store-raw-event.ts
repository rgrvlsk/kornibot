import type { NormalizedTelegramUpdate } from "../telegram/normalize-update";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type StoredRawEvent = {
  id: number;
  inserted: boolean;
  projectionCompleted: boolean;
};

export async function storeRawEvent(
  db: D1DatabaseLike,
  update: NormalizedTelegramUpdate,
): Promise<StoredRawEvent> {
  const insertResult = await db.prepare(`
      INSERT OR IGNORE INTO raw_events (
        update_id,
        event_kind,
        chat_id,
        message_id,
        actor_user_id,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      update.updateId,
      update.eventKind,
      update.chatId,
      update.messageId,
      update.actorUserId,
      update.payloadJson,
    )
    .run();

  const storedRow = await db.prepare("SELECT id, projected_at FROM raw_events WHERE update_id = ?")
    .bind(update.updateId)
    .first<{ id: number; projected_at: string | null }>();

  if (!storedRow) {
    throw new Error(`raw event ${update.updateId} was not persisted`);
  }

  return {
    id: storedRow.id,
    inserted: insertResult.meta.changes > 0,
    projectionCompleted: storedRow.projected_at !== null,
  };
}

export async function markRawEventProjected(
  db: D1DatabaseLike,
  rawEventId: number,
): Promise<void> {
  await db.prepare(`
      UPDATE raw_events
      SET projected_at = COALESCE(projected_at, ?)
      WHERE id = ?
    `)
    .bind(new Date().toISOString(), rawEventId)
    .run();
}
