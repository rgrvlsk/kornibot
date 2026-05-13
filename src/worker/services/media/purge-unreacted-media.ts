import type { Env } from "../../../shared/env";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type MediaPurgeCandidate = {
  id: number;
  chat_id: number;
  message_id: number;
  r2_key: string;
};

export type MediaPurgeResult = {
  rowsDeleted: number;
  r2ObjectsDeleted: number;
};

const DEFAULT_MAX_ROWS = 100;

function retentionCutoff(now: Date): string {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function findCandidates(
  db: D1DatabaseLike,
  cutoff: string,
  maxRows: number,
): Promise<MediaPurgeCandidate[]> {
  const rows = await db.prepare(`
      SELECT
        media_objects.id,
        media_objects.chat_id,
        media_objects.message_id,
        media_objects.r2_key
      FROM media_objects
      INNER JOIN messages
        ON messages.chat_id = media_objects.chat_id
       AND messages.message_id = media_objects.message_id
      WHERE messages.sent_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM reaction_events
          WHERE reaction_events.chat_id = media_objects.chat_id
            AND reaction_events.message_id = media_objects.message_id
            AND reaction_events.is_active = 1
          LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1
          FROM message_reactions
          WHERE message_reactions.chat_id = media_objects.chat_id
            AND message_reactions.message_id = media_objects.message_id
            AND message_reactions.is_active = 1
          LIMIT 1
        )
      ORDER BY messages.sent_at ASC, media_objects.id ASC
      LIMIT ?
    `)
    .bind(cutoff, maxRows)
    .all<MediaPurgeCandidate>();

  return rows.results;
}

async function countRowsForR2Key(db: D1DatabaseLike, r2Key: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM media_objects WHERE r2_key = ?")
    .bind(r2Key)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function deleteMediaRow(db: D1DatabaseLike, id: number): Promise<void> {
  await db.prepare("DELETE FROM media_objects WHERE id = ?")
    .bind(id)
    .run();
}

async function markMessageMediaState(
  db: D1DatabaseLike,
  chatId: number,
  messageId: number,
): Promise<void> {
  await db.prepare(`
      UPDATE messages
      SET has_media = CASE
        WHEN EXISTS (
          SELECT 1
          FROM media_objects
          WHERE media_objects.chat_id = messages.chat_id
            AND media_objects.message_id = messages.message_id
          LIMIT 1
        )
        THEN 1
        ELSE 0
      END
      WHERE chat_id = ? AND message_id = ?
    `)
    .bind(chatId, messageId)
    .run();
}

export async function purgeUnreactedMedia(
  env: Env,
  now = new Date(),
  options: { maxRows?: number } = {},
): Promise<MediaPurgeResult> {
  const candidates = await findCandidates(
    env.DB,
    retentionCutoff(now),
    options.maxRows ?? DEFAULT_MAX_ROWS,
  );
  let rowsDeleted = 0;
  let r2ObjectsDeleted = 0;

  for (const candidate of candidates) {
    const referencesBeforeDelete = await countRowsForR2Key(env.DB, candidate.r2_key);

    if (referencesBeforeDelete <= 1) {
      await env.MEDIA_BUCKET.delete(candidate.r2_key);
      r2ObjectsDeleted += 1;
    }

    await deleteMediaRow(env.DB, candidate.id);
    await markMessageMediaState(env.DB, candidate.chat_id, candidate.message_id);
    rowsDeleted += 1;
  }

  return { rowsDeleted, r2ObjectsDeleted };
}
