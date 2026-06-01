import { describe, expect, it } from "vitest";

import { buildSetCommandsRequest } from "../../scripts/telegram-commands";
import { buildSetWebhookRequest, parseTelegramWebhookArgs } from "../../scripts/telegram-webhook";

describe("telegram webhook script helpers", () => {
  it("parses set and info commands", () => {
    expect(parseTelegramWebhookArgs(["set", "https://worker.example.com/telegram/webhook"])).toEqual({
      command: "set",
      webhookUrl: "https://worker.example.com/telegram/webhook",
    });

    expect(parseTelegramWebhookArgs(["info"])).toEqual({
      command: "info",
      webhookUrl: undefined,
    });
  });

  it("builds setWebhook request with secret and allowed updates", () => {
    const request = buildSetWebhookRequest({
      botToken: "token",
      secretToken: "secret",
      webhookUrl: "https://worker.example.com/telegram/webhook",
    });

    expect(request.url).toBe("https://api.telegram.org/bottoken/setWebhook");
    expect(request.init).toEqual({
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://worker.example.com/telegram/webhook",
        secret_token: "secret",
        allowed_updates: ["message", "edited_message", "message_reaction", "chat_member", "callback_query"],
      }),
    });
  });
});

describe("telegram commands script helpers", () => {
  it("builds setMyCommands request to clear the default private menu", () => {
    const request = buildSetCommandsRequest("token");

    expect(request.url).toBe("https://api.telegram.org/bottoken/setMyCommands");
    expect(request.init).toEqual({
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scope: { type: "all_private_chats" },
        commands: [],
      }),
    });
  });
});
