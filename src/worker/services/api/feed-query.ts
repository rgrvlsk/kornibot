type D1DatabaseLike = Pick<D1Database, "prepare">;

export type FeedItem = {
  rawEventId: number;
  updateId: number;
  eventKind: string;
  chatId: number;
  messageId: number | null;
  actorUserId: number | null;
  receivedAt: string;
  text: string | null;
};

type FeedRow = {
  raw_event_id: number;
  update_id: number;
  event_kind: string;
  chat_id: number;
  message_id: number | null;
  actor_user_id: number | null;
  received_at: string;
  text: string | null;
};

function clampLimit(value: string | null): number {
  const parsed = Number(value ?? "20");

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }

  return Math.min(parsed, 50);
}

export async function queryFeed(
  db: D1DatabaseLike,
  searchParams: URLSearchParams,
): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const limit = clampLimit(searchParams.get("limit"));
  const cursor = searchParams.get("cursor");
  const params: Array<number | string> = [];
  let sql = `
    SELECT
      raw_events.id AS raw_event_id,
      raw_events.update_id,
      raw_events.event_kind,
      raw_events.chat_id,
      raw_events.message_id,
      raw_events.actor_user_id,
      raw_events.received_at,
      COALESCE(messages.current_text, messages.current_caption) AS text
    FROM raw_events
    LEFT JOIN messages
      ON messages.chat_id = raw_events.chat_id
      AND messages.message_id = raw_events.message_id
  `;

  if (cursor) {
    sql += " WHERE raw_events.id < ? ";
    params.push(Number(cursor));
  }

  sql += " ORDER BY raw_events.id DESC LIMIT ? ";
  params.push(limit);

  const rows = await db.prepare(sql)
    .bind(...params)
    .all<FeedRow>();

  const items = rows.results.map((row) => ({
    rawEventId: row.raw_event_id,
    updateId: row.update_id,
    eventKind: row.event_kind,
    chatId: row.chat_id,
    messageId: row.message_id,
    actorUserId: row.actor_user_id,
    receivedAt: row.received_at,
    text: row.text,
  }));

  return {
    items,
    nextCursor: items.length === limit ? String(items.at(-1)?.rawEventId ?? "") : null,
  };
}
