import type { Env } from "../../../shared/env";

type ChatMemberResponse = {
  ok: boolean;
  result?: TelegramChatMember;
};

export type TelegramChatMember = {
  status?: string;
  is_member?: boolean;
};

export async function fetchTelegramChatMember(
  env: Env,
  chatId: number,
  userId: number,
): Promise<TelegramChatMember | null> {
  const url = new URL(`https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember`);
  url.searchParams.set("chat_id", String(chatId));
  url.searchParams.set("user_id", String(userId));

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as ChatMemberResponse;
  if (!payload.ok || !payload.result) {
    return null;
  }

  return payload.result;
}

export function isActiveTelegramChatMember(member: TelegramChatMember | null): boolean {
  if (!member) {
    return false;
  }

  return member.status === "administrator"
    || member.status === "creator"
    || member.status === "member"
    || (member.status === "restricted" && member.is_member === true);
}
