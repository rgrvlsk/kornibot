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
): Promise<void> {
  await callTelegramMethod(env, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}
