type D1DatabaseLike = Pick<D1Database, "prepare">;

type RootRow = {
  chat_id: number;
  message_id: number;
  from_user_id: number | null;
  current_text: string | null;
};

type ReplyRow = {
  message_id: number;
  from_user_id: number | null;
  current_text: string | null;
  replied_at: string;
};

type VersionRow = {
  version_no: number;
  text: string | null;
  edited_at: string;
};

type ReactionRow = {
  reactor_user_id: number | null;
  reaction_key: string;
  is_active: number;
  last_changed_at: string;
};

export async function queryThread(
  db: D1DatabaseLike,
  chatId: number,
  messageId: number,
): Promise<{
  root: {
    chatId: number;
    messageId: number;
    fromUserId: number | null;
    currentText: string | null;
  } | null;
  replies: Array<{
    messageId: number;
    fromUserId: number | null;
    currentText: string | null;
    repliedAt: string;
  }>;
  versions: Array<{
    versionNo: number;
    text: string | null;
    editedAt: string;
  }>;
  reactions: Array<{
    reactorUserId: number | null;
    reactionKey: string;
    isActive: number;
    lastChangedAt: string;
  }>;
}> {
  const root = await db.prepare(`
      SELECT chat_id, message_id, from_user_id, current_text
      FROM messages
      WHERE chat_id = ? AND message_id = ?
    `)
    .bind(chatId, messageId)
    .first<RootRow>();

  const replies = await db.prepare(`
      SELECT
        messages.message_id,
        messages.from_user_id,
        messages.current_text,
        message_replies.replied_at
      FROM message_replies
      INNER JOIN messages
        ON messages.chat_id = message_replies.chat_id
        AND messages.message_id = message_replies.message_id
      WHERE message_replies.chat_id = ?
        AND message_replies.root_message_id = ?
      ORDER BY message_replies.replied_at ASC
    `)
    .bind(chatId, messageId)
    .all<ReplyRow>();

  const versions = await db.prepare(`
      SELECT version_no, text, edited_at
      FROM message_versions
      WHERE chat_id = ? AND message_id = ?
      ORDER BY version_no ASC
    `)
    .bind(chatId, messageId)
    .all<VersionRow>();

  const reactions = await db.prepare(`
      SELECT reactor_user_id, reaction_key, is_active, last_changed_at
      FROM message_reactions
      WHERE chat_id = ? AND message_id = ?
      ORDER BY reaction_key ASC
    `)
    .bind(chatId, messageId)
    .all<ReactionRow>();

  return {
    root: root
      ? {
        chatId: root.chat_id,
        messageId: root.message_id,
        fromUserId: root.from_user_id,
        currentText: root.current_text,
      }
      : null,
    replies: replies.results.map((row) => ({
      messageId: row.message_id,
      fromUserId: row.from_user_id,
      currentText: row.current_text,
      repliedAt: row.replied_at,
    })),
    versions: versions.results.map((row) => ({
      versionNo: row.version_no,
      text: row.text,
      editedAt: row.edited_at,
    })),
    reactions: reactions.results.map((row) => ({
      reactorUserId: row.reactor_user_id,
      reactionKey: row.reaction_key,
      isActive: row.is_active,
      lastChangedAt: row.last_changed_at,
    })),
  };
}
