import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

type TelegramApiResponse = {
  ok?: boolean;
  description?: string;
};

export function buildSetCommandsRequest(botToken: string): { url: string; init: RequestInit } {
  return {
    url: `${TELEGRAM_API_BASE_URL}/bot${botToken}/setMyCommands`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scope: { type: "all_private_chats" },
        commands: [],
      }),
    },
  };
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

async function runTelegramRequest(request: { url: string; init: RequestInit }): Promise<void> {
  const response = await fetch(request.url, request.init);
  const responseBody = await response.text();
  const parsed = responseBody ? (JSON.parse(responseBody) as TelegramApiResponse) : {};

  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.description ?? `Telegram API request failed with HTTP ${response.status}`);
  }

  console.log(JSON.stringify(parsed, null, 2));
}

async function main(): Promise<void> {
  const extra = process.argv.slice(2);
  if (extra.length > 0) {
    throw new Error("Usage: pnpm telegram:commands:set");
  }

  await runTelegramRequest(buildSetCommandsRequest(getRequiredEnv("BOT_TOKEN")));
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  void main();
}
