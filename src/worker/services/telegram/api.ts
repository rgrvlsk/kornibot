import type { Env } from "../../../shared/env";

type TelegramApiResponse<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
};

export type TelegramAdministrator = {
  status?: string;
  user?: {
    id?: number;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
  };
};

export type TelegramSentMessage = {
  message_id: number;
};

export type TelegramBotCommand = {
  command: string;
  description: string;
};

export type TelegramBotCommandScope =
  | { type: "all_private_chats" }
  | { type: "chat"; chat_id: number | string }
  | { type: "chat_member"; chat_id: number | string; user_id: number };

export class TelegramApiError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TelegramApiError";
  }
}

async function callTelegramMethod<T>(
  env: Env,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const parsed = await response.json<TelegramApiResponse<T>>()
    .catch((): TelegramApiResponse<T> => ({}));

  if (!response.ok || parsed.ok === false || parsed.result === undefined) {
    throw new TelegramApiError(parsed.description ?? `Telegram ${method} failed with HTTP ${response.status}`);
  }

  return parsed.result;
}

export async function fetchTelegramChatAdministrators(
  env: Env,
  chatId: number,
): Promise<TelegramAdministrator[]> {
  return callTelegramMethod<TelegramAdministrator[]>(env, "getChatAdministrators", {
    chat_id: chatId,
  });
}

export async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
  options: {
    replyMarkup?: unknown;
  } = {},
): Promise<TelegramSentMessage> {
  return callTelegramMethod<TelegramSentMessage>(env, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function answerTelegramCallbackQuery(
  env: Env,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callTelegramMethod(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export async function setTelegramBotCommands(
  env: Env,
  commands: TelegramBotCommand[],
  scope: TelegramBotCommandScope,
): Promise<boolean> {
  return callTelegramMethod<boolean>(env, "setMyCommands", {
    scope,
    commands,
  });
}

export async function sendTelegramPhoto(
  env: Env,
  chatId: number,
  photo: Blob,
  fileName: string,
  caption: string,
): Promise<TelegramSentMessage> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set("photo", photo, fileName);

  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const parsed = await response.json<TelegramApiResponse<TelegramSentMessage>>()
    .catch((): TelegramApiResponse<TelegramSentMessage> => ({}));

  if (!response.ok || parsed.ok === false || parsed.result === undefined) {
    throw new TelegramApiError(parsed.description ?? `Telegram sendPhoto failed with HTTP ${response.status}`);
  }

  return parsed.result;
}
