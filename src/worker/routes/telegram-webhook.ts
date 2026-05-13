import type { Env } from "../../shared/env";
import { markRawEventProjected, storeRawEvent } from "../services/events/store-raw-event";
import { getAuditChatId } from "../services/settings/group-settings";
import { projectMessage } from "../services/messages/project-message";
import { normalizeTelegramUpdate } from "../services/telegram/normalize-update";
import { recordTelegramChat } from "../services/telegram/record-chat";
import { isValidTelegramWebhookSecret } from "../services/telegram/validate";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    ...init,
  });
}

export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  if (!isValidTelegramWebhookSecret(request, env)) {
    return jsonResponse({ ok: false, message: "invalid telegram webhook secret" }, { status: 401 });
  }

  const payload = await request.json<unknown>();
  const normalizedUpdate = normalizeTelegramUpdate(payload);

  if (!normalizedUpdate) {
    return jsonResponse({ ok: true, message: "telegram update ignored" });
  }

  await recordTelegramChat(env.DB, normalizedUpdate);

  if (normalizedUpdate.chatId !== await getAuditChatId(env)) {
    return jsonResponse({ ok: true, message: "telegram update ignored" });
  }

  const storedRawEvent = await storeRawEvent(env.DB, normalizedUpdate);

  if (!storedRawEvent.projectionCompleted) {
    const projectionCompleted = await projectMessage(env.DB, env, normalizedUpdate, storedRawEvent.id);

    if (projectionCompleted) {
      await markRawEventProjected(env.DB, storedRawEvent.id);
    }
  }

  return jsonResponse({ ok: true, message: "telegram update processed" });
}
