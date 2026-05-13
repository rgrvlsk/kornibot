type D1DatabaseLike = Pick<D1Database, "prepare">;

type SearchRow = {
  raw_event_id: number;
  update_id: number;
  event_kind: string;
  chat_id: number;
  message_id: number | null;
  actor_user_id: number | null;
  received_at: string;
  text: string | null;
};

export type SearchItem = {
  rawEventId: number;
  updateId: number;
  eventKind: string;
  chatId: number;
  messageId: number | null;
  actorUserId: number | null;
  receivedAt: string;
  text: string | null;
};

export async function querySearch(
  db: D1DatabaseLike,
  searchParams: URLSearchParams,
): Promise<{ items: SearchItem[] }> {
  const params: Array<number | string> = [];
  const conditions: string[] = [];
  const userId = searchParams.get("userId");
  const eventKind = searchParams.get("type");
  const text = searchParams.get("text");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (userId) {
    conditions.push("raw_events.actor_user_id = ?");
    params.push(Number(userId));
  }

  if (eventKind) {
    conditions.push("raw_events.event_kind = ?");
    params.push(eventKind);
  }

  if (text) {
    conditions.push("COALESCE(messages.current_text, messages.current_caption, '') LIKE ?");
    params.push(`%${text}%`);
  }

  if (dateFrom) {
    conditions.push("raw_events.received_at >= ?");
    params.push(dateFrom);
  }

  if (dateTo) {
    conditions.push("raw_events.received_at <= ?");
    params.push(dateTo);
  }

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

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")} `;
  }

  sql += " ORDER BY raw_events.id DESC LIMIT 50 ";

  const rows = await db.prepare(sql)
    .bind(...params)
    .all<SearchRow>();

  return {
    items: rows.results.map((row) => ({
      rawEventId: row.raw_event_id,
      updateId: row.update_id,
      eventKind: row.event_kind,
      chatId: row.chat_id,
      messageId: row.message_id,
      actorUserId: row.actor_user_id,
      receivedAt: row.received_at,
      text: row.text,
    })),
  };
}
