import type { Env } from "../../../shared/env";

type TelegramChatAdministrator = {
  status?: string;
  user?: {
    id?: number;
  };
};

type ChatAdministratorsResponse = {
  ok: boolean;
  result?: TelegramChatAdministrator[];
};

export async function fetchChatOwnerUserId(env: Env, chatId: number): Promise<number | null> {
  const url = new URL(`https://api.telegram.org/bot${env.BOT_TOKEN}/getChatAdministrators`);
  url.searchParams.set("chat_id", String(chatId));

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as ChatAdministratorsResponse;
  if (!payload.ok || !Array.isArray(payload.result)) {
    return null;
  }

  const ownerId = payload.result.find((member) => member.status === "creator")?.user?.id;
  return typeof ownerId === "number" && Number.isSafeInteger(ownerId) ? ownerId : null;
}
