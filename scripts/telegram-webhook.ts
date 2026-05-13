import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const ALLOWED_UPDATES = ["message", "edited_message", "message_reaction", "chat_member", "callback_query"] as const;

type TelegramWebhookCommand = "set" | "info";

export type TelegramWebhookArgs = {
  command: TelegramWebhookCommand;
  webhookUrl?: string;
};

type SetWebhookRequestInput = {
  botToken: string;
  secretToken: string;
  webhookUrl: string;
};

type TelegramApiResponse = {
  ok?: boolean;
  description?: string;
};

function isTelegramWebhookCommand(value: string): value is TelegramWebhookCommand {
  return value === "set" || value === "info";
}

export function parseTelegramWebhookArgs(argv: string[]): TelegramWebhookArgs {
  const [command, webhookUrl, ...extra] = argv;

  if (!command || !isTelegramWebhookCommand(command)) {
    throw new Error("Usage: pnpm telegram:webhook:set <worker-webhook-url> OR pnpm telegram:webhook:info");
  }

  if (extra.length > 0) {
    throw new Error(`Unexpected arguments: ${extra.join(", ")}`);
  }

  if (command === "set" && !webhookUrl) {
    throw new Error("Missing webhook URL");
  }

  if (command === "info" && webhookUrl) {
    throw new Error("getWebhookInfo does not take a URL");
  }

  return { command, webhookUrl };
}

export function buildSetWebhookRequest(input: SetWebhookRequestInput): { url: string; init: RequestInit } {
  return {
    url: `${TELEGRAM_API_BASE_URL}/bot${input.botToken}/setWebhook`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: input.webhookUrl,
        secret_token: input.secretToken,
        allowed_updates: ALLOWED_UPDATES,
      }),
    },
  };
}

function buildGetWebhookInfoRequest(botToken: string): { url: string; init: RequestInit } {
  return {
    url: `${TELEGRAM_API_BASE_URL}/bot${botToken}/getWebhookInfo`,
    init: { method: "GET" },
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
  const args = parseTelegramWebhookArgs(process.argv.slice(2));
  const botToken = getRequiredEnv("BOT_TOKEN");

  if (args.command === "set") {
    const secretToken = getRequiredEnv("TELEGRAM_WEBHOOK_SECRET");
    const webhookUrl = args.webhookUrl;

    if (!webhookUrl) {
      throw new Error("Missing webhook URL");
    }

    await runTelegramRequest(
      buildSetWebhookRequest({
        botToken,
        secretToken,
        webhookUrl,
      }),
    );
    return;
  }

  await runTelegramRequest(buildGetWebhookInfoRequest(botToken));
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  void main();
}
