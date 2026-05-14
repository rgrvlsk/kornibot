import type { Env } from "../../shared/env";
import { readDashboardSessionFromRequest } from "../services/auth/request-session";
import { resolveSessionRole } from "../services/auth/resolve-session-role";
import { refreshKnownCaaMemberRoles } from "../services/auth/sync-caa-roles";
import { queryDashboardAccessOverview } from "../services/analytics/query-dashboard-access";
import { recordDashboardAccess } from "../services/analytics/record-dashboard-access";
import { queryFeed } from "../services/api/feed-query";
import { queryMemberMetrics } from "../services/api/member-metrics-query";
import { queryResum } from "../services/api/resum-query";
import { querySearch } from "../services/api/search-query";
import { queryThread } from "../services/api/thread-query";
import { queryUserProfile, queryUserProfilePhoto, queryUserProfiles } from "../services/api/user-profile-query";
import { resetAuditGroup } from "../services/settings/audit-reset";
import { getDashboardSettings, readGroupSettings, querySetupStatus, queryTelegramChats, updateGroupSettings, updateMemberActivityThresholds, updateMessageRetentionSettings } from "../services/settings/group-settings";
import { fetchTelegramChatAdministrators } from "../services/telegram/api";
import { fetchHumanChatMemberCount } from "../services/telegram/fetch-chat-member-count";
import { refreshSingleMemberStatus } from "../services/users/member-status-refresh";
import { refreshKnownUserProfilePhotos } from "../services/users/profile-photo-refresh";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    ...init,
  });
}

function isSuperadminRole(role: string): boolean {
  return role === "superadmin";
}

export async function handleApiRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await readDashboardSessionFromRequest(env, request);

  if (!session) {
    return jsonResponse({ ok: false, message: "missing or invalid session" }, { status: 401 });
  }

  const currentRole = await resolveSessionRole(env, session);
  if (!currentRole) {
    return jsonResponse({ ok: false, message: "user is not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/setup/status") {
    return jsonResponse({ ok: true, setup: await querySetupStatus(env) });
  }

  if (request.method === "POST" && path === "/api/access-analytics/visit") {
    await recordDashboardAccess(env.DB, {
      userId: session.userId,
      username: session.username,
      role: currentRole,
    });

    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && path === "/api/access-analytics/overview") {
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return jsonResponse({
      ok: true,
      items: await queryDashboardAccessOverview(env.DB, Number.isFinite(limit) ? limit : 20),
    });
  }

  if (request.method === "GET" && path === "/api/telegram-chats") {
    return jsonResponse({ ok: true, items: await queryTelegramChats(env) });
  }

  if (request.method === "GET" && path === "/api/feed") {
    const result = await queryFeed(env.DB, url.searchParams);
    return jsonResponse({ ok: true, ...result });
  }

  if (request.method === "GET" && path === "/api/member-metrics") {
    const result = await queryMemberMetrics(env.DB, session.userId);
    return jsonResponse({ ok: true, ...result });
  }

  if (request.method === "GET" && path === "/api/resum") {
    const result = await queryResum(env.DB);
    return jsonResponse({ ok: true, ...result });
  }

  if (request.method === "GET" && path === "/api/search") {
    const result = await querySearch(env.DB, url.searchParams);
    return jsonResponse({ ok: true, ...result });
  }

  if (request.method === "GET" && path === "/api/users") {
    const groups = await readGroupSettings(env);
    const [result, telegramMemberCount, auditAdministrators] = await Promise.all([
      queryUserProfiles(env.DB, url.searchParams),
      fetchHumanChatMemberCount(env, groups.auditChatId),
      fetchTelegramChatAdministrators(env, groups.auditChatId)
        .then((administrators) => Array.isArray(administrators) ? administrators : [])
        .catch(() => []),
    ]);
    const auditOwnerUserId = auditAdministrators.find((member) => member.status === "creator")?.user?.id ?? null;
    const auditAdminUserIds = new Set(
      auditAdministrators
        .filter((member) => member.status === "administrator")
        .map((member) => member.user?.id)
        .filter((userId): userId is number => typeof userId === "number" && Number.isSafeInteger(userId)),
    );

    return jsonResponse({
      ok: true,
      ...result,
      items: result.items.map((item) => ({
        ...item,
        isAuditGroupOwner: item.telegramId === auditOwnerUserId,
        isAuditGroupAdmin: auditAdminUserIds.has(item.telegramId),
      })),
      summary: {
        ...result.summary,
        telegramMemberCount,
      },
    });
  }

  if (request.method === "GET" && /^\/api\/users\/\d+\/profile-photo$/.test(path)) {
    const userId = Number(path.split("/").at(-2));
    const photo = await queryUserProfilePhoto(env.DB, userId);
    if (!photo) {
      return jsonResponse({ ok: false, message: "profile photo not found" }, { status: 404 });
    }

    const object = await env.MEDIA_BUCKET.get(photo.r2Key);
    if (!object) {
      return jsonResponse({ ok: false, message: "profile photo not found" }, { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        "cache-control": "private, max-age=300",
        "content-type": photo.mimeType ?? object.httpMetadata?.contentType ?? "image/jpeg",
      },
    });
  }

  if (request.method === "POST" && path === "/api/users/profile-photos/refresh") {
    if (!isSuperadminRole(currentRole)) {
      return jsonResponse({ ok: false, message: "superadmin role required" }, { status: 403 });
    }

    const payload = await request.json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const cursor = Number(payload.cursor ?? 0);
    const limit = Number(payload.limit ?? 8);

    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      return jsonResponse({ ok: false, message: "invalid cursor" }, { status: 400 });
    }

    const result = await refreshKnownUserProfilePhotos(env.DB, env, {
      cursor,
      force: payload.force === true,
      limit: Number.isFinite(limit) ? limit : 8,
    });
    return jsonResponse({ ok: true, result });
  }

  if (request.method === "POST" && path === "/api/users/caa-roles/refresh") {
    if (!isSuperadminRole(currentRole)) {
      return jsonResponse({ ok: false, message: "superadmin role required" }, { status: 403 });
    }

    const payload = await request.json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const cursor = Number(payload.cursor ?? 0);
    const limit = Number(payload.limit ?? 8);

    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      return jsonResponse({ ok: false, message: "invalid cursor" }, { status: 400 });
    }

    const result = await refreshKnownCaaMemberRoles(env, {
      cursor,
      limit: Number.isFinite(limit) ? limit : 8,
    });
    return jsonResponse({ ok: true, result });
  }

  if (request.method === "POST" && /^\/api\/users\/\d+\/status\/refresh$/.test(path)) {
    if (!isSuperadminRole(currentRole)) {
      return jsonResponse({ ok: false, message: "superadmin role required" }, { status: 403 });
    }

    const userId = Number(path.split("/").at(-3));
    const result = await refreshSingleMemberStatus(env, userId, {
      checkedBy: "manual",
    });

    if (!result) {
      return jsonResponse({ ok: false, message: "user not found" }, { status: 404 });
    }

    return jsonResponse({ ok: true, result });
  }

  if (request.method === "GET" && /^\/api\/users\/\d+$/.test(path)) {
    const userId = Number(path.split("/").at(-1));
    const result = await queryUserProfile(env.DB, userId);
    return jsonResponse({ ok: true, ...result });
  }

  if (request.method === "GET" && /^\/api\/threads\/-?\d+\/\d+$/.test(path)) {
    const [, , , chatId, messageId] = path.split("/");
    const result = await queryThread(env.DB, Number(chatId), Number(messageId));
    return jsonResponse({ ok: true, ...result });
  }

  if (request.method === "GET" && path === "/api/settings") {
    const settings = await getDashboardSettings(env, isSuperadminRole(currentRole));
    return jsonResponse({ ok: true, settings });
  }

  if (request.method === "PATCH" && path === "/api/settings/groups") {
    if (!isSuperadminRole(currentRole)) {
      return jsonResponse({ ok: false, message: "superadmin role required" }, { status: 403 });
    }

    const payload = await request.json<Record<string, unknown>>();

    try {
      const auditChatId = Number(payload.auditChatId);
      const caaChatId = Number(payload.caaChatId);
      if (!Number.isSafeInteger(auditChatId) || !Number.isSafeInteger(caaChatId)) {
        throw new Error("auditChatId and caaChatId are required");
      }

      const settings = await updateGroupSettings(env, { auditChatId, caaChatId });
      return jsonResponse({ ok: true, settings });
    } catch (error) {
      return jsonResponse({
        ok: false,
        message: error instanceof Error ? error.message : "invalid group settings payload",
      }, { status: 400 });
    }
  }

  if (request.method === "PATCH" && path === "/api/settings/members/activity-thresholds") {
    if (!isSuperadminRole(currentRole)) {
      return jsonResponse({ ok: false, message: "superadmin role required" }, { status: 403 });
    }

    const payload = await request.json<Record<string, unknown>>();

    try {
      const settings = await updateMemberActivityThresholds(env, {
        goodHours: Number(payload.goodHours),
        warmHours: Number(payload.warmHours),
      });
      return jsonResponse({ ok: true, settings });
    } catch (error) {
      return jsonResponse({
        ok: false,
        message: error instanceof Error ? error.message : "invalid activity thresholds payload",
      }, { status: 400 });
    }
  }

  if (request.method === "PATCH" && path === "/api/settings/privacy/message-retention") {
    if (!isSuperadminRole(currentRole)) {
      return jsonResponse({ ok: false, message: "superadmin role required" }, { status: 403 });
    }

    const payload = await request.json<Record<string, unknown>>();

    try {
      const settings = await updateMessageRetentionSettings(
        env,
        {
          detailDays: Number(payload.detailDays),
        },
        {
          userId: session.userId,
          username: session.username,
        },
        isSuperadminRole(currentRole),
      );
      return jsonResponse({ ok: true, settings });
    } catch (error) {
      return jsonResponse({
        ok: false,
        message: error instanceof Error ? error.message : "invalid message retention payload",
      }, { status: 400 });
    }
  }

  if (request.method === "POST" && path === "/api/settings/audit-group-reset") {
    if (!isSuperadminRole(currentRole)) {
      return jsonResponse({ ok: false, message: "superadmin role required" }, { status: 403 });
    }

    const payload = await request.json<Record<string, unknown>>();

    try {
      const reset = await resetAuditGroup(env, {
        nextAuditChatId: Number(payload.nextAuditChatId),
        confirmation: String(payload.confirmation ?? ""),
        resetByUserId: session.userId,
      });
      return jsonResponse({ ok: true, reset });
    } catch (error) {
      return jsonResponse({
        ok: false,
        message: error instanceof Error ? error.message : "invalid audit reset payload",
      }, { status: 400 });
    }
  }

  return new Response("Not found", { status: 404 });
}
