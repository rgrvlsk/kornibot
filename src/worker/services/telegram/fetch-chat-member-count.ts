import type { Env } from "../../../shared/env";

type ChatMemberCountResponse = {
  ok?: boolean;
  result?: number;
};

export async function fetchChatMemberCount(
  env: Env,
  chatId: number,
): Promise<number | null> {
  const url = new URL(`https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMemberCount`);
  url.searchParams.set("chat_id", String(chatId));

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const payload = await response.json<ChatMemberCountResponse>();
  if (!payload.ok || typeof payload.result !== "number") {
    return null;
  }

  return payload.result;
}

export async function fetchHumanChatMemberCount(
  env: Env,
  chatId: number,
): Promise<number | null> {
  const count = await fetchChatMemberCount(env, chatId);

  return count === null ? null : Math.max(0, count - 1);
}
