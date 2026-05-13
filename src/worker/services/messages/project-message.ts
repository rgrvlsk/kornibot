import type { Env } from "../../../shared/env";
import { archiveMedia } from "../media/archive-media";
import { fetchTelegramFile } from "../telegram/fetch-file";
import type {
  NormalizedChatMemberUpdate,
  NormalizedMediaAttachment,
  NormalizedMembershipEvent,
  NormalizedMessageUpdate,
  NormalizedReactionUpdate,
  NormalizedTelegramUpdate,
  NormalizedTelegramUser,
} from "../telegram/normalize-update";
import { refreshUserProfilePhoto } from "../users/profile-photo-refresh";

type D1DatabaseLike = Pick<D1Database, "prepare">;

function displayName(user: NormalizedTelegramUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ");
}

async function upsertUser(
  db: D1DatabaseLike,
  user: NormalizedTelegramUser | null,
  observedAt: string,
): Promise<void> {
  if (!user) {
    return;
  }

  await db.prepare(`
      INSERT INTO users (
        user_id,
        username,
        first_name,
        last_name,
        nickname,
        is_bot,
        language_code,
        first_seen_at,
        last_seen_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        nickname = excluded.nickname,
        is_bot = excluded.is_bot,
        language_code = COALESCE(excluded.language_code, users.language_code),
        first_seen_at = COALESCE(users.first_seen_at, excluded.first_seen_at),
        last_seen_at = CASE
          WHEN users.last_seen_at IS NULL OR excluded.last_seen_at > users.last_seen_at THEN excluded.last_seen_at
          ELSE users.last_seen_at
        END,
        updated_at = excluded.updated_at
    `)
    .bind(
      user.userId,
      user.username,
      user.firstName,
      user.lastName,
      displayName(user),
      user.isBot ? 1 : 0,
      user.languageCode,
      observedAt,
      observedAt,
      new Date().toISOString(),
    )
    .run();
}

async function insertMembershipEvent(
  db: D1DatabaseLike,
  chatId: number,
  event: NormalizedMembershipEvent,
  rawEventId: number,
): Promise<void> {
  await db.prepare(`
      INSERT OR IGNORE INTO user_membership_events (
        chat_id,
        user_id,
        event_type,
        observed_at,
        actor_user_id,
        message_id,
        old_status,
        new_status,
        custom_title,
        source_raw_event_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      chatId,
      event.user.userId,
      event.eventType,
      event.observedAt,
      event.actorUserId,
      event.messageId,
      event.oldStatus,
      event.newStatus,
      event.customTitle,
      rawEventId,
    )
    .run();
}

async function applyMembershipPeriod(
  db: D1DatabaseLike,
  chatId: number,
  event: NormalizedMembershipEvent,
  rawEventId: number,
): Promise<void> {
  if (event.eventType === "joined") {
    const openPeriod = await db.prepare(`
        SELECT id
        FROM user_membership_periods
        WHERE chat_id = ? AND user_id = ? AND left_at IS NULL
        ORDER BY joined_at DESC, id DESC
        LIMIT 1
      `)
      .bind(chatId, event.user.userId)
      .first<{ id: number }>();

    if (openPeriod) {
      return;
    }

    await db.prepare(`
        INSERT OR IGNORE INTO user_membership_periods (
          chat_id,
          user_id,
          joined_at,
          join_source_raw_event_id
        )
        VALUES (?, ?, ?, ?)
      `)
      .bind(chatId, event.user.userId, event.observedAt, rawEventId)
      .run();
    return;
  }

  const updateResult = await db.prepare(`
      UPDATE user_membership_periods
      SET left_at = ?, leave_source_raw_event_id = ?
      WHERE id = (
        SELECT id
        FROM user_membership_periods
        WHERE chat_id = ? AND user_id = ? AND left_at IS NULL
        ORDER BY joined_at DESC, id DESC
        LIMIT 1
      )
    `)
    .bind(event.observedAt, rawEventId, chatId, event.user.userId)
    .run();

  if (updateResult.meta.changes > 0) {
    return;
  }

  await db.prepare(`
      INSERT OR IGNORE INTO user_membership_periods (
        chat_id,
        user_id,
        left_at,
        leave_source_raw_event_id
      )
      VALUES (?, ?, ?, ?)
    `)
    .bind(chatId, event.user.userId, event.observedAt, rawEventId)
    .run();
}

async function updateUserMembershipStatus(
  db: D1DatabaseLike,
  event: NormalizedMembershipEvent,
): Promise<void> {
  await db.prepare(`
      UPDATE users
      SET
        last_membership_status = ?,
        last_joined_at = CASE WHEN ? = 'joined' THEN ? ELSE last_joined_at END,
        last_left_at = CASE WHEN ? = 'left' THEN ? ELSE last_left_at END,
        updated_at = ?
      WHERE user_id = ?
    `)
    .bind(
      event.newStatus ?? event.eventType,
      event.eventType,
      event.observedAt,
      event.eventType,
      event.observedAt,
      new Date().toISOString(),
      event.user.userId,
    )
    .run();
}

async function persistMembershipEvents(
  db: D1DatabaseLike,
  env: Env,
  chatId: number,
  events: NormalizedMembershipEvent[],
  rawEventId: number,
): Promise<void> {
  for (const event of events) {
    await upsertUser(db, event.user, event.observedAt);
    await refreshUserProfilePhoto(db, env, event.user.userId);

    await insertMembershipEvent(db, chatId, event, rawEventId);
    await applyMembershipPeriod(db, chatId, event, rawEventId);
    await updateUserMembershipStatus(db, event);
  }
}

async function persistReplyProjection(
  db: D1DatabaseLike,
  update: NormalizedMessageUpdate,
  rawEventId: number,
): Promise<void> {
  if (!update.replyToMessageId) {
    return;
  }

  await db.prepare(`
      INSERT INTO message_replies (
        chat_id,
        message_id,
        parent_message_id,
        root_message_id,
        replied_at,
        source_raw_event_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, message_id) DO UPDATE SET
        parent_message_id = excluded.parent_message_id,
        root_message_id = excluded.root_message_id,
        replied_at = excluded.replied_at,
        source_raw_event_id = excluded.source_raw_event_id
    `)
    .bind(
      update.chatId,
      update.messageId,
      update.replyToMessageId,
      update.threadRootMessageId ?? update.replyToMessageId,
      update.observedAt,
      rawEventId,
    )
    .run();
}

type ExistingMediaObject = {
  r2_key: string;
  mime_type: string | null;
};

async function findArchivedMediaByUniqueId(
  db: D1DatabaseLike,
  fileUniqueId: string,
): Promise<ExistingMediaObject | null> {
  return db.prepare(`
      SELECT r2_key, mime_type
      FROM media_objects
      WHERE telegram_file_unique_id = ?
      ORDER BY id ASC
      LIMIT 1
    `)
    .bind(fileUniqueId)
    .first<ExistingMediaObject>();
}

async function persistMediaObject(
  db: D1DatabaseLike,
  update: NormalizedMessageUpdate,
  media: NormalizedMediaAttachment,
  r2Key: string,
  contentType: string | null,
): Promise<void> {
  await db.prepare(`
      INSERT INTO media_objects (
        chat_id,
        message_id,
        telegram_file_id,
        telegram_file_unique_id,
        kind,
        mime_type,
        file_name,
        size_bytes,
        duration_seconds,
        width,
        height,
        r2_key,
        caption
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, message_id, telegram_file_unique_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        message_id = excluded.message_id,
        telegram_file_id = excluded.telegram_file_id,
        kind = excluded.kind,
        mime_type = excluded.mime_type,
        file_name = excluded.file_name,
        size_bytes = excluded.size_bytes,
        duration_seconds = excluded.duration_seconds,
        width = excluded.width,
        height = excluded.height,
        r2_key = excluded.r2_key,
        caption = excluded.caption
    `)
    .bind(
      update.chatId,
      update.messageId,
      media.fileId,
      media.fileUniqueId,
      media.kind,
      contentType ?? media.mimeType,
      media.fileName,
      media.sizeBytes,
      media.durationSeconds,
      media.width,
      media.height,
      r2Key,
      update.caption,
    )
    .run();
}

async function archiveMessageMedia(
  db: D1DatabaseLike,
  env: Env,
  update: NormalizedMessageUpdate,
): Promise<boolean> {
  if (!update.media) {
    return true;
  }

  const existingMedia = await findArchivedMediaByUniqueId(db, update.media.fileUniqueId);

  if (existingMedia) {
    await persistMediaObject(
      db,
      update,
      update.media,
      existingMedia.r2_key,
      existingMedia.mime_type,
    );
    return true;
  }

  const resolvedFile = await fetchTelegramFile(env, update.media);

  if (resolvedFile.status === "skip") {
    return true;
  }

  const archivedMedia = await archiveMedia(
    env,
    update.chatId,
    update.messageId,
    {
      ...update.media,
      sizeBytes: resolvedFile.file.sizeBytes ?? update.media.sizeBytes,
    },
    resolvedFile.file.downloadUrl,
  );

  await persistMediaObject(
    db,
    {
      ...update,
      media: {
        ...update.media,
        sizeBytes: resolvedFile.file.sizeBytes ?? update.media.sizeBytes,
      },
    },
    {
      ...update.media,
      sizeBytes: resolvedFile.file.sizeBytes ?? update.media.sizeBytes,
    },
    archivedMedia.r2Key,
    archivedMedia.contentType,
  );

  return true;
}

async function persistMessageProjection(
  db: D1DatabaseLike,
  env: Env,
  update: NormalizedMessageUpdate,
  rawEventId: number,
): Promise<boolean> {
  await upsertUser(db, update.fromUser, update.observedAt);

  await db.prepare(`
      INSERT INTO messages (
        chat_id,
        message_id,
        message_thread_id,
        from_user_id,
        sent_at,
        message_type,
        reply_to_message_id,
        thread_root_message_id,
        current_text,
        current_caption,
        has_media,
        is_currently_visible,
        last_known_edit_at,
        last_event_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, message_id) DO UPDATE SET
        from_user_id = excluded.from_user_id,
        message_thread_id = excluded.message_thread_id,
        sent_at = excluded.sent_at,
        message_type = excluded.message_type,
        reply_to_message_id = excluded.reply_to_message_id,
        thread_root_message_id = excluded.thread_root_message_id,
        current_text = excluded.current_text,
        current_caption = excluded.current_caption,
        has_media = excluded.has_media,
        is_currently_visible = excluded.is_currently_visible,
        last_known_edit_at = excluded.last_known_edit_at,
        last_event_id = excluded.last_event_id
    `)
    .bind(
      update.chatId,
      update.messageId,
      update.messageThreadId,
      update.fromUser?.userId ?? null,
      update.sentAt,
      update.messageType,
      update.replyToMessageId,
      update.threadRootMessageId,
      update.text,
      update.caption,
      update.hasMedia ? 1 : 0,
      1,
      update.editedAt,
      rawEventId,
    )
    .run();

  await db.prepare(`
      INSERT OR IGNORE INTO message_versions (
        chat_id,
        message_id,
        version_no,
        text,
        caption,
        edited_at,
        source_raw_event_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      update.chatId,
      update.messageId,
      rawEventId,
      update.text,
      update.caption,
      update.editedAt ?? update.sentAt,
      rawEventId,
    )
    .run();

  await persistReplyProjection(db, update, rawEventId);
  await persistMembershipEvents(db, env, update.chatId, update.membershipEvents, rawEventId);
  return archiveMessageMedia(db, env, update);
}

async function persistReactionProjection(
  db: D1DatabaseLike,
  update: NormalizedReactionUpdate,
  rawEventId: number,
): Promise<boolean> {
  await upsertUser(db, update.reactorUser, update.observedAt);

  for (const delta of update.deltas) {
    await db.prepare(`
        INSERT OR IGNORE INTO reaction_events (
          chat_id,
          message_id,
          reactor_user_id,
          reaction_key,
          is_active,
          observed_at,
          source_raw_event_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        update.chatId,
        update.messageId,
        update.reactorUser?.userId ?? null,
        delta.reactionKey,
        delta.isActive ? 1 : 0,
        update.observedAt,
        rawEventId,
      )
      .run();
  }

  if (!update.reactorUser) {
    return true;
  }

  for (const reactionKey of update.currentReactionKeys) {
    await db.prepare(`
        INSERT INTO message_reactions (
          chat_id,
          message_id,
          reactor_user_id,
          reaction_key,
          first_seen_at,
          last_changed_at,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id, message_id, reactor_user_id, reaction_key) DO UPDATE SET
          last_changed_at = excluded.last_changed_at,
          is_active = excluded.is_active
      `)
      .bind(
        update.chatId,
        update.messageId,
        update.reactorUser?.userId ?? null,
        reactionKey,
        update.observedAt,
        update.observedAt,
        1,
      )
      .run();
  }

  for (const delta of update.deltas) {
    if (delta.isActive) {
      continue;
    }

    await db.prepare(`
        INSERT INTO message_reactions (
          chat_id,
          message_id,
          reactor_user_id,
          reaction_key,
          first_seen_at,
          last_changed_at,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id, message_id, reactor_user_id, reaction_key) DO UPDATE SET
          last_changed_at = excluded.last_changed_at,
          is_active = excluded.is_active
      `)
      .bind(
        update.chatId,
        update.messageId,
        update.reactorUser?.userId ?? null,
        delta.reactionKey,
        update.observedAt,
        update.observedAt,
        0,
      )
      .run();
  }

  return true;
}

async function persistChatMemberProjection(
  db: D1DatabaseLike,
  env: Env,
  update: NormalizedChatMemberUpdate,
  rawEventId: number,
): Promise<boolean> {
  await upsertUser(db, update.actorUser, update.observedAt);
  await persistMembershipEvents(db, env, update.chatId, update.membershipEvents, rawEventId);
  return true;
}

export async function projectMessage(
  db: D1DatabaseLike,
  env: Env,
  update: NormalizedTelegramUpdate,
  rawEventId: number,
): Promise<boolean> {
  switch (update.eventKind) {
    case "message":
    case "edited_message":
      return persistMessageProjection(db, env, update, rawEventId);
    case "message_reaction":
      return persistReactionProjection(db, update, rawEventId);
    case "chat_member":
      return persistChatMemberProjection(db, env, update, rawEventId);
    case "callback_query":
      return true;
  }
}
