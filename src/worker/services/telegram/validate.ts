import type { Env } from "../../../shared/env";

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encode(left);
  const rightBytes = encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }

  return diff === 0;
}

export function isValidTelegramWebhookSecret(request: Request, env: Env): boolean {
  const headerValue = request.headers.get("x-telegram-bot-api-secret-token");

  if (!headerValue) {
    return false;
  }

  return timingSafeEqual(headerValue, env.TELEGRAM_WEBHOOK_SECRET);
}
