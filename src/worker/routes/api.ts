import type { Env } from "../../shared/env";
import { readDashboardSessionFromRequest } from "../services/auth/request-session";
import { resolveSessionRole } from "../services/auth/resolve-session-role";
import { refreshKnownCaaMemberRoles } from "../services/auth/sync-caa-roles";
import { queryDashboardAccessOverview } from "../services/analytics/query-dashboard-access";
import { recordDashboardAccess } from "../services/analytics/record-dashboard-access";
import {
  createBirthdayCard,
  createBirthdayWindow,
  deleteBirthdayWindow,
  deleteBirthdayPreference,
  ensureUpcomingBirthdayWindows,
  listBirthdayCards,
  listBirthdayWindows,
  patchBirthdayCard,
  patchBirthdayWindow,
  queryBirthdayAlmanac,
  queryBirthdayCard,
  upsertBirthdayPreference,
} from "../services/birthday/birthday-service";
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

function isStaffRole(role: string): boolean {
  return role === "superadmin" || role === "caa_member";
}

function parseInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(String(value));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseOptionalPositiveInteger(value: string | null): number | undefined {
  if (value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseBirthdayCardState(value: unknown): "available" | "used" | "archived" | "disabled" | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "available" || value === "used" || value === "archived" || value === "disabled") {
    return value;
  }

  throw new Error("invalid birthday card state");
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

  if (request.method === "GET" && path === "/api/birthday/almanac") {
    const months = Number(url.searchParams.get("months") ?? 12);
    const from = url.searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
    try {
      const result = await queryBirthdayAlmanac(env.DB, {
        from,
        months: Number.isFinite(months) ? months : 12,
      });
      return jsonResponse({ ok: true, ...result });
    } catch (error) {
      return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "invalid birthday almanac query" }, { status: 400 });
    }
  }

  if (request.method === "GET" && path === "/api/birthday/windows") {
    await ensureUpcomingBirthdayWindows(env.DB, new Date());
    return jsonResponse({ ok: true, windows: await listBirthdayWindows(env.DB) });
  }

  if (request.method === "GET" && path === "/api/birthday/cards") {
    const result = await listBirthdayCards(env.DB, {
      cursor: parseOptionalPositiveInteger(url.searchParams.get("cursor")),
      limit: parseOptionalPositiveInteger(url.searchParams.get("limit")),
    });
    return jsonResponse({ ok: true, ...result });
  }

  if (request.method === "POST" && path === "/api/birthday/windows") {
    if (!isStaffRole(currentRole)) {
      return jsonResponse({ ok: false, message: "staff role required" }, { status: 403 });
    }

    const payload = await request.json<Record<string, unknown>>();
    try {
      const window = await createBirthdayWindow(env.DB, {
        presetKey: typeof payload.presetKey === "string" ? payload.presetKey : null,
        label: String(payload.label ?? ""),
        startsOn: String(payload.startsOn ?? ""),
        endsOn: String(payload.endsOn ?? ""),
        color: String(payload.color ?? "#7ab7ff"),
        enabled: payload.enabled !== false,
      });
      return jsonResponse({ ok: true, window });
    } catch (error) {
      return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "invalid birthday window" }, { status: 400 });
    }
  }

  if (request.method === "PATCH" && /^\/api\/birthday\/windows\/\d+$/.test(path)) {
    if (!isStaffRole(currentRole)) {
      return jsonResponse({ ok: false, message: "staff role required" }, { status: 403 });
    }

    const windowId = Number(path.split("/").at(-1));
    const payload = await request.json<Record<string, unknown>>();
    try {
      const window = await patchBirthdayWindow(env.DB, windowId, {
        label: typeof payload.label === "string" ? payload.label : undefined,
        startsOn: typeof payload.startsOn === "string" ? payload.startsOn : undefined,
        endsOn: typeof payload.endsOn === "string" ? payload.endsOn : undefined,
        color: typeof payload.color === "string" ? payload.color : undefined,
        enabled: typeof payload.enabled === "boolean" ? payload.enabled : undefined,
      });
      return window
        ? jsonResponse({ ok: true, window })
        : jsonResponse({ ok: false, message: "birthday window not found" }, { status: 404 });
    } catch (error) {
      return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "invalid birthday window" }, { status: 400 });
    }
  }

  if (request.method === "DELETE" && /^\/api\/birthday\/windows\/\d+$/.test(path)) {
    if (!isStaffRole(currentRole)) {
      return jsonResponse({ ok: false, message: "staff role required" }, { status: 403 });
    }

    const windowId = Number(path.split("/").at(-1));
    const deleted = await deleteBirthdayWindow(env.DB, windowId);
    return deleted
      ? new Response(null, { status: 204 })
      : jsonResponse({ ok: false, message: "birthday window not found" }, { status: 404 });
  }

  if (request.method === "POST" && path === "/api/birthday/cards") {
    if (!isStaffRole(currentRole)) {
      return jsonResponse({ ok: false, message: "staff role required" }, { status: 403 });
    }

    try {
      const form = await request.formData();
      const file = form.get("file") as unknown as File | null;
      if (!file || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
        throw new Error("file is required");
      }

      const card = await createBirthdayCard(env, {
        scopeType: String(form.get("scopeType") ?? "global") as "global" | "window" | "member",
        windowId: parseInteger(form.get("windowId")),
        userId: parseInteger(form.get("userId")),
        uploadedByUserId: session.userId,
        file,
      });
      return jsonResponse({ ok: true, card });
    } catch (error) {
      return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "invalid birthday card" }, { status: 400 });
    }
  }

  if (request.method === "PATCH" && /^\/api\/birthday\/cards\/\d+$/.test(path)) {
    if (!isStaffRole(currentRole)) {
      return jsonResponse({ ok: false, message: "staff role required" }, { status: 403 });
    }

    const cardId = Number(path.split("/").at(-1));
    const payload = await request.json<Record<string, unknown>>();
    try {
      const card = await patchBirthdayCard(env.DB, cardId, {
        state: parseBirthdayCardState(payload.state),
      });
      return card
        ? jsonResponse({ ok: true, card })
        : jsonResponse({ ok: false, message: "birthday card not found" }, { status: 404 });
    } catch (error) {
      return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "invalid birthday card" }, { status: 400 });
    }
  }

  if (request.method === "GET" && /^\/api\/birthday\/cards\/\d+\/image$/.test(path)) {
    const cardId = Number(path.split("/").at(-2));
    const card = await queryBirthdayCard(env.DB, cardId);
    if (!card) {
      return jsonResponse({ ok: false, message: "birthday card not found" }, { status: 404 });
    }

    const object = await env.MEDIA_BUCKET.get(card.r2Key);
    if (!object) {
      return jsonResponse({ ok: false, message: "birthday card image not found" }, { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        "cache-control": "private, max-age=300",
        "content-type": card.mimeType ?? object.httpMetadata?.contentType ?? "image/png",
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
    const body: Record<string, unknown> = { ok: true, ...result };
    if (result.birthday === null) {
      delete body.birthday;
    }
    return jsonResponse(body);
  }

  if (request.method === "PUT" && /^\/api\/users\/\d+\/birthday$/.test(path)) {
    if (!isStaffRole(currentRole)) {
      return jsonResponse({ ok: false, message: "staff role required" }, { status: 403 });
    }

    const userId = Number(path.split("/").at(-2));
    const payload = await request.json<Record<string, unknown>>();
    try {
      const birthday = await upsertBirthdayPreference(env.DB, userId, {
        month: Number(payload.month),
        day: Number(payload.day),
        year: payload.year === null || payload.year === undefined || payload.year === "" ? null : Number(payload.year),
        wantsAiCard: payload.wantsAiCard === true,
        promptIdeas: Array.isArray(payload.promptIdeas) ? payload.promptIdeas.filter((item): item is string => typeof item === "string") : [],
      });
      return jsonResponse({ ok: true, birthday });
    } catch (error) {
      return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "invalid birthday payload" }, { status: 400 });
    }
  }

  if (request.method === "DELETE" && /^\/api\/users\/\d+\/birthday$/.test(path)) {
    if (!isStaffRole(currentRole)) {
      return jsonResponse({ ok: false, message: "staff role required" }, { status: 403 });
    }

    const userId = Number(path.split("/").at(-2));
    await deleteBirthdayPreference(env.DB, userId);
    return new Response(null, { status: 204 });
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
