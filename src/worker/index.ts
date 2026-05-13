import type { Env } from "../shared/env";
import type { AppResponse } from "../shared/types";
import { applyCorsHeaders, createPreflightResponse } from "./http/cors";
import { handleApiRequest } from "./routes/api";
import { handleAssetRequest } from "./routes/assets";
import { handleDevAccessAuth, handleLogout, handleSessionRequest, handleTelegramAuth } from "./routes/auth-telegram";
import { runHourlyAggregation } from "./cron/hourly-aggregation";
import { handleTelegramWebhook } from "./routes/telegram-webhook";
import { runDailyKnownMemberStatusRefresh } from "./services/users/member-status-refresh";

function jsonResponse(body: AppResponse, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    ...init,
  });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;

    if (request.method === "OPTIONS") {
      return createPreflightResponse(request, env);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      response = jsonResponse({ ok: true, message: "kornibot worker ready" });
      return applyCorsHeaders(response, request, env);
    }

    if (request.method === "GET" && url.pathname === "/") {
      response = jsonResponse({ ok: true, message: "kornibot api" });
      return applyCorsHeaders(response, request, env);
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/assets/")) {
      response = await handleAssetRequest(request, env);
      return applyCorsHeaders(response, request, env);
    }

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      response = await handleTelegramWebhook(request, env);
      return applyCorsHeaders(response, request, env);
    }

    if (request.method === "POST" && url.pathname === "/auth/telegram") {
      response = await handleTelegramAuth(request, env);
      return applyCorsHeaders(response, request, env);
    }

    if (request.method === "POST" && url.pathname === "/auth/dev-access") {
      response = await handleDevAccessAuth(request, env);
      return applyCorsHeaders(response, request, env);
    }

    if (request.method === "GET" && url.pathname === "/auth/session") {
      response = await handleSessionRequest(request, env);
      return applyCorsHeaders(response, request, env);
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      response = handleLogout();
      return applyCorsHeaders(response, request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      response = await handleApiRequest(request, env);
      return applyCorsHeaders(response, request, env);
    }

    response = new Response("Not found", { status: 404 });
    return applyCorsHeaders(response, request, env);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const scheduledAt = new Date(controller.scheduledTime);
      await runHourlyAggregation(env, scheduledAt);
      await runDailyKnownMemberStatusRefresh(env, scheduledAt);
    })());
  },
};
