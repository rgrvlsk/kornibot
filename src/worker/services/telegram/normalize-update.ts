type TelegramChat = {
  id: number;
  type: string;
  title?: string;
};

type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TelegramReactionType =
  | { type: "emoji"; emoji: string }
  | { type: "custom_emoji"; custom_emoji_id: string }
  | { type: "paid" };

type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  date: number;
  edit_date?: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  reply_to_message?: {
    message_id: number;
    reply_to_message?: {
      message_id: number;
    };
  };
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
  audio?: TelegramAudio;
  voice?: TelegramVoice;
  animation?: TelegramAnimation;
  sticker?: TelegramSticker;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
};

type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

type TelegramVideo = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration?: number;
  mime_type?: string;
  file_size?: number;
  file_name?: string;
};

type TelegramAudio = {
  file_id: string;
  file_unique_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
  file_name?: string;
};

type TelegramVoice = {
  file_id: string;
  file_unique_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
};

type TelegramAnimation = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration?: number;
  mime_type?: string;
  file_size?: number;
  file_name?: string;
};

type TelegramSticker = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

type TelegramReactionUpdate = {
  chat: TelegramChat;
  message_id: number;
  date: number;
  user?: TelegramUser;
  old_reaction: TelegramReactionType[];
  new_reaction: TelegramReactionType[];
};

type TelegramChatMember = {
  status: string;
  user: TelegramUser;
  is_member?: boolean;
  custom_title?: string;
};

type TelegramChatMemberUpdate = {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  message_reaction?: TelegramReactionUpdate;
  chat_member?: TelegramChatMemberUpdate;
  callback_query?: TelegramCallbackQuery;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type NormalizedTelegramUser = {
  userId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  isBot: boolean;
  languageCode: string | null;
};

type BaseNormalizedUpdate = {
  updateId: number;
  chatId: number;
  chatTitle: string | null;
  chatType: string;
  messageId: number | null;
  actorUserId: number | null;
  payloadJson: string;
};

export type NormalizedMessageUpdate = BaseNormalizedUpdate & {
  eventKind: "message" | "edited_message";
  messageId: number;
  messageThreadId: number | null;
  observedAt: string;
  sentAt: string;
  editedAt: string | null;
  fromUser: NormalizedTelegramUser | null;
  messageType: "text" | "caption" | "service";
  text: string | null;
  caption: string | null;
  replyToMessageId: number | null;
  threadRootMessageId: number | null;
  hasMedia: boolean;
  media: NormalizedMediaAttachment | null;
  membershipEvents: NormalizedMembershipEvent[];
};

export type ReactionDelta = {
  reactionKey: string;
  isActive: boolean;
};

export type NormalizedReactionUpdate = BaseNormalizedUpdate & {
  eventKind: "message_reaction";
  messageId: number;
  observedAt: string;
  reactorUser: NormalizedTelegramUser | null;
  currentReactionKeys: string[];
  deltas: ReactionDelta[];
};

export type NormalizedMembershipEvent = {
  eventType: "joined" | "left";
  observedAt: string;
  user: NormalizedTelegramUser;
  actorUserId: number | null;
  messageId: number | null;
  oldStatus: string | null;
  newStatus: string | null;
  customTitle: string | null;
};

export type NormalizedChatMemberUpdate = BaseNormalizedUpdate & {
  eventKind: "chat_member";
  observedAt: string;
  actorUser: NormalizedTelegramUser | null;
  membershipEvents: NormalizedMembershipEvent[];
};

export type NormalizedCallbackQueryUpdate = BaseNormalizedUpdate & {
  eventKind: "callback_query";
  callbackQueryId: string;
  observedAt: string;
  actorUser: NormalizedTelegramUser;
  data: string | null;
};

export type NormalizedTelegramUpdate =
  | NormalizedMessageUpdate
  | NormalizedReactionUpdate
  | NormalizedChatMemberUpdate
  | NormalizedCallbackQueryUpdate;

export type NormalizedMediaAttachment = {
  kind: "photo" | "video" | "document" | "audio" | "voice" | "animation" | "sticker";
  fileId: string;
  fileUniqueId: string;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

function toIsoTimestamp(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toISOString();
}

function normalizeUser(user?: TelegramUser): NormalizedTelegramUser | null {
  if (!user) {
    return null;
  }

  return {
    userId: user.id,
    username: user.username ?? null,
    firstName: user.first_name,
    lastName: user.last_name ?? null,
    isBot: user.is_bot,
    languageCode: user.language_code ?? null,
  };
}

function requireNormalizedUser(user: TelegramUser): NormalizedTelegramUser {
  const normalizedUser = normalizeUser(user);

  if (!normalizedUser) {
    throw new Error("telegram user was not normalized");
  }

  return normalizedUser;
}

function reactionKey(reaction: TelegramReactionType): string {
  if (reaction.type === "emoji") {
    return `emoji:${reaction.emoji}`;
  }

  if (reaction.type === "custom_emoji") {
    return `custom_emoji:${reaction.custom_emoji_id}`;
  }

  return "paid";
}

function hasMedia(message: TelegramMessage): boolean {
  return extractMedia(message) !== null;
}

function deriveMessageType(message: TelegramMessage): "text" | "caption" | "service" {
  if (message.text) {
    return "text";
  }

  if (message.caption) {
    return "caption";
  }

  return "service";
}

function normalizeMessageMembershipEvents(
  message: TelegramMessage,
  observedAt: string,
  actorUserId: number | null,
): NormalizedMembershipEvent[] {
  const events: NormalizedMembershipEvent[] = [];

  for (const user of message.new_chat_members ?? []) {
    events.push({
      eventType: "joined",
      observedAt,
      user: requireNormalizedUser(user),
      actorUserId,
      messageId: message.message_id,
      oldStatus: null,
      newStatus: "member",
      customTitle: null,
    });
  }

  if (message.left_chat_member) {
    events.push({
      eventType: "left",
      observedAt,
      user: requireNormalizedUser(message.left_chat_member),
      actorUserId,
      messageId: message.message_id,
      oldStatus: "member",
      newStatus: "left",
      customTitle: null,
    });
  }

  return events;
}

function isActiveChatMember(member: TelegramChatMember): boolean {
  if (member.status === "creator" || member.status === "administrator" || member.status === "member") {
    return true;
  }

  if (member.status === "restricted") {
    return member.is_member === true;
  }

  return false;
}

function normalizeChatMemberMembershipEvent(
  chatMemberUpdate: TelegramChatMemberUpdate,
  observedAt: string,
): NormalizedMembershipEvent | null {
  const wasActive = isActiveChatMember(chatMemberUpdate.old_chat_member);
  const isActive = isActiveChatMember(chatMemberUpdate.new_chat_member);

  if (wasActive === isActive) {
    return null;
  }

  return {
    eventType: isActive ? "joined" : "left",
    observedAt,
    user: requireNormalizedUser(chatMemberUpdate.new_chat_member.user),
    actorUserId: chatMemberUpdate.from.id,
    messageId: null,
    oldStatus: chatMemberUpdate.old_chat_member.status,
    newStatus: chatMemberUpdate.new_chat_member.status,
    customTitle: chatMemberUpdate.new_chat_member.custom_title ?? null,
  };
}

function deriveThreadRootMessageId(message: TelegramMessage): number | null {
  const replyToMessageId = message.reply_to_message?.message_id;
  const explicitRoot = message.reply_to_message?.reply_to_message?.message_id;

  return explicitRoot ?? replyToMessageId ?? null;
}

function normalizePhoto(message: TelegramMessage): NormalizedMediaAttachment | null {
  const photo = [...(message.photo ?? [])]
    .sort((left, right) => (right.file_size ?? 0) - (left.file_size ?? 0))[0];

  if (!photo) {
    return null;
  }

  return {
    kind: "photo",
    fileId: photo.file_id,
    fileUniqueId: photo.file_unique_id,
    mimeType: null,
    fileName: null,
    sizeBytes: photo.file_size ?? null,
    durationSeconds: null,
    width: photo.width,
    height: photo.height,
  };
}

function extractMedia(message: TelegramMessage): NormalizedMediaAttachment | null {
  const photo = normalizePhoto(message);

  if (photo) {
    return photo;
  }

  if (message.document) {
    return {
      kind: "document",
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      mimeType: message.document.mime_type ?? null,
      fileName: message.document.file_name ?? null,
      sizeBytes: message.document.file_size ?? null,
      durationSeconds: null,
      width: null,
      height: null,
    };
  }

  if (message.video) {
    return {
      kind: "video",
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      mimeType: message.video.mime_type ?? null,
      fileName: message.video.file_name ?? null,
      sizeBytes: message.video.file_size ?? null,
      durationSeconds: message.video.duration ?? null,
      width: message.video.width,
      height: message.video.height,
    };
  }

  if (message.audio) {
    return {
      kind: "audio",
      fileId: message.audio.file_id,
      fileUniqueId: message.audio.file_unique_id,
      mimeType: message.audio.mime_type ?? null,
      fileName: message.audio.file_name ?? null,
      sizeBytes: message.audio.file_size ?? null,
      durationSeconds: message.audio.duration ?? null,
      width: null,
      height: null,
    };
  }

  if (message.voice) {
    return {
      kind: "voice",
      fileId: message.voice.file_id,
      fileUniqueId: message.voice.file_unique_id,
      mimeType: message.voice.mime_type ?? null,
      fileName: null,
      sizeBytes: message.voice.file_size ?? null,
      durationSeconds: message.voice.duration ?? null,
      width: null,
      height: null,
    };
  }

  if (message.animation) {
    return {
      kind: "animation",
      fileId: message.animation.file_id,
      fileUniqueId: message.animation.file_unique_id,
      mimeType: message.animation.mime_type ?? null,
      fileName: message.animation.file_name ?? null,
      sizeBytes: message.animation.file_size ?? null,
      durationSeconds: message.animation.duration ?? null,
      width: message.animation.width,
      height: message.animation.height,
    };
  }

  if (message.sticker) {
    return {
      kind: "sticker",
      fileId: message.sticker.file_id,
      fileUniqueId: message.sticker.file_unique_id,
      mimeType: null,
      fileName: null,
      sizeBytes: message.sticker.file_size ?? null,
      durationSeconds: null,
      width: message.sticker.width,
      height: message.sticker.height,
    };
  }

  return null;
}

function normalizeMessageUpdate(
  updateId: number,
  rawMessage: TelegramMessage,
  eventKind: "message" | "edited_message",
  payloadJson: string,
): NormalizedMessageUpdate {
  const fromUser = normalizeUser(rawMessage.from);
  const media = extractMedia(rawMessage);
  const observedAt = toIsoTimestamp(rawMessage.edit_date ?? rawMessage.date);

  return {
    updateId,
    eventKind,
    chatId: rawMessage.chat.id,
    chatTitle: rawMessage.chat.title ?? null,
    chatType: rawMessage.chat.type,
    messageId: rawMessage.message_id,
    messageThreadId: rawMessage.message_thread_id ?? null,
    actorUserId: fromUser?.userId ?? null,
    payloadJson,
    observedAt,
    sentAt: toIsoTimestamp(rawMessage.date),
    editedAt: rawMessage.edit_date ? toIsoTimestamp(rawMessage.edit_date) : null,
    fromUser,
    messageType: deriveMessageType(rawMessage),
    text: rawMessage.text ?? null,
    caption: rawMessage.caption ?? null,
    replyToMessageId: rawMessage.reply_to_message?.message_id ?? null,
    threadRootMessageId: deriveThreadRootMessageId(rawMessage),
    hasMedia: media !== null && hasMedia(rawMessage),
    media,
    membershipEvents: normalizeMessageMembershipEvents(rawMessage, observedAt, fromUser?.userId ?? null),
  };
}

function normalizeCallbackQueryUpdate(
  updateId: number,
  callbackQuery: TelegramCallbackQuery,
  payloadJson: string,
): NormalizedCallbackQueryUpdate | null {
  if (!callbackQuery.message) {
    return null;
  }

  return {
    updateId,
    eventKind: "callback_query",
    chatId: callbackQuery.message.chat.id,
    chatTitle: callbackQuery.message.chat.title ?? null,
    chatType: callbackQuery.message.chat.type,
    messageId: callbackQuery.message.message_id,
    actorUserId: callbackQuery.from.id,
    payloadJson,
    callbackQueryId: callbackQuery.id,
    observedAt: toIsoTimestamp(callbackQuery.message.date),
    actorUser: requireNormalizedUser(callbackQuery.from),
    data: callbackQuery.data ?? null,
  };
}

function normalizeReactionUpdate(
  updateId: number,
  reactionUpdate: TelegramReactionUpdate,
  payloadJson: string,
): NormalizedReactionUpdate {
  const reactorUser = normalizeUser(reactionUpdate.user);
  const previousKeys = new Set(reactionUpdate.old_reaction.map(reactionKey));
  const currentKeys = new Set(reactionUpdate.new_reaction.map(reactionKey));
  const deltas: ReactionDelta[] = [];

  for (const key of currentKeys) {
    if (!previousKeys.has(key)) {
      deltas.push({ reactionKey: key, isActive: true });
    }
  }

  for (const key of previousKeys) {
    if (!currentKeys.has(key)) {
      deltas.push({ reactionKey: key, isActive: false });
    }
  }

  return {
    updateId,
    eventKind: "message_reaction",
    chatId: reactionUpdate.chat.id,
    chatTitle: reactionUpdate.chat.title ?? null,
    chatType: reactionUpdate.chat.type,
    messageId: reactionUpdate.message_id,
    actorUserId: reactorUser?.userId ?? null,
    payloadJson,
    observedAt: toIsoTimestamp(reactionUpdate.date),
    reactorUser,
    currentReactionKeys: [...currentKeys].sort(),
    deltas: deltas.sort((left, right) => left.reactionKey.localeCompare(right.reactionKey)),
  };
}

function normalizeChatMemberUpdate(
  updateId: number,
  chatMemberUpdate: TelegramChatMemberUpdate,
  payloadJson: string,
): NormalizedChatMemberUpdate {
  const observedAt = toIsoTimestamp(chatMemberUpdate.date);
  const membershipEvent = normalizeChatMemberMembershipEvent(chatMemberUpdate, observedAt);

  return {
    updateId,
    eventKind: "chat_member",
    chatId: chatMemberUpdate.chat.id,
    chatTitle: chatMemberUpdate.chat.title ?? null,
    chatType: chatMemberUpdate.chat.type,
    messageId: null,
    actorUserId: chatMemberUpdate.from.id,
    payloadJson,
    observedAt,
    actorUser: normalizeUser(chatMemberUpdate.from),
    membershipEvents: membershipEvent ? [membershipEvent] : [],
  };
}

export function normalizeTelegramUpdate(input: unknown): NormalizedTelegramUpdate | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const update = input as TelegramUpdate;
  const payloadJson = JSON.stringify(update);

  if (update.message) {
    return normalizeMessageUpdate(update.update_id, update.message, "message", payloadJson);
  }

  if (update.edited_message) {
    return normalizeMessageUpdate(update.update_id, update.edited_message, "edited_message", payloadJson);
  }

  if (update.message_reaction) {
    return normalizeReactionUpdate(update.update_id, update.message_reaction, payloadJson);
  }

  if (update.chat_member) {
    return normalizeChatMemberUpdate(update.update_id, update.chat_member, payloadJson);
  }

  if (update.callback_query) {
    return normalizeCallbackQueryUpdate(update.update_id, update.callback_query, payloadJson);
  }

  return null;
}
