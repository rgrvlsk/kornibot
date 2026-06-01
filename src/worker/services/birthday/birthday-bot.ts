import type { Env } from "../../../shared/env";
import { formatPrivateBotCommandMenu, type PrivateBotCommandName } from "../bot/command-registry";
import { emptyPrivateBotCommandAccess, resolveLivePrivateBotCommandAccess, syncPrivateBotCommandsForAccess } from "../bot/command-sync";
import { resolveRole } from "../auth/resolve-role";
import { readGroupSettings } from "../settings/group-settings";
import { sendTelegramMessage, sendTelegramPhoto, answerTelegramCallbackQuery } from "../telegram/api";
import { fetchTelegramChatMember, isActiveTelegramChatMember } from "../telegram/fetch-chat-member";
import { fetchTelegramFile } from "../telegram/fetch-file";
import type { NormalizedCallbackQueryUpdate, NormalizedMessageUpdate, NormalizedTelegramUpdate } from "../telegram/normalize-update";
import {
  createBirthdayCard,
  deleteBirthdayPreference,
  listBirthdayCardMemberTargets,
  listBirthdayWindows,
  normalizeBirthdayYear,
  queryBirthdayPreference,
  queryBirthdayWindow,
  upsertBirthdayPreference,
  type BirthdayCardMemberTarget,
  type BirthdayPreference,
  type BirthdayWindow,
} from "./birthday-service";

type BirthdayBotDisposition = "handled" | "continue";

type BotFlowRow = {
  flow: "birthday" | "cards";
  step: string;
  state_json: string;
};

type BirthdayFlowState = {
  month?: number;
  day?: number;
  year?: number | null;
};

type CardFlowState = {
  scopeType?: "global" | "window" | "member";
  windowId?: number | null;
  userId?: number | null;
  awaiting?: "window" | "member";
};

type ParsedBirthdayYear =
  | { ok: true; year: number | null }
  | { ok: false; message: string };

const CARD_PICKER_PAGE_SIZE = 5;
const KORNIBOT_REFERENCE_IMAGE_KEY = "deploy-assets/kornibot-profile.png";

export async function handleBirthdayBotUpdate(
  env: Env,
  update: NormalizedTelegramUpdate,
): Promise<BirthdayBotDisposition> {
  if (update.eventKind === "callback_query") {
    return handleBirthdayCallback(env, update);
  }

  if (update.eventKind !== "message") {
    return "continue";
  }

  const text = update.text?.trim() ?? "";
  const command = botCommandFromText(text);
  if (command === "menu") {
    if (update.chatType === "private") {
      await handleMenuCommand(env, update);
      return "handled";
    }

    return "continue";
  }

  if (command) {
    const privateCommandText = /^\/start(?:@\w+)?(?:\s|$)/i.test(text)
      ? (command === "felicitacions" ? "/felicitacions" : "/aniversari")
      : text;
    if (update.chatType === "private") {
      await handlePrivateCommand(
        env,
        update,
        command === "felicitacions" ? "cards" : "birthday",
        privateCommandText,
      );
      return "handled";
    }

    await sendTelegramMessage(env, update.chatId, deepLinkMessage(command), {
      replyMarkup: {
        inline_keyboard: [[{
          text: "Obre DM",
          url: botDeepLink(env, command),
        }]],
      },
    });
    return "continue";
  }

  if (update.chatType !== "private" || !update.fromUser) {
    return "continue";
  }

  const flow = await readBotFlow(env, update.fromUser.userId);
  if (!flow) {
    return "continue";
  }

  if (flow.flow === "birthday") {
    await handleBirthdayText(env, update, flow);
    return "handled";
  }

  await handleCardsTextOrUpload(env, update, flow);
  return "handled";
}

async function handleMenuCommand(env: Env, update: NormalizedMessageUpdate): Promise<void> {
  if (!update.fromUser) {
    await sendTelegramMessage(env, update.chatId, formatPrivateBotCommandMenu(emptyPrivateBotCommandAccess()));
    return;
  }

  const access = await resolveLivePrivateBotCommandAccess(env, update.fromUser.userId);
  await syncPrivateBotCommandsForAccess(env, update.fromUser.userId, access);
  await sendTelegramMessage(env, update.chatId, formatPrivateBotCommandMenu(access));
}

async function handlePrivateCommand(
  env: Env,
  update: NormalizedMessageUpdate,
  flow: "birthday" | "cards",
  text: string,
): Promise<void> {
  if (!update.fromUser) {
    return;
  }

  const groups = await readGroupSettings(env);
  if (flow === "cards") {
    const role = await resolveRole(env, update.fromUser.userId);
    if (!role) {
      await sendTelegramMessage(env, update.chatId, "Nomes CAA pot pujar felicitacions.");
      return;
    }

    const parsed = parseCardScopeText(text.replace(/^\/felicitacions(?:@\w+)?/i, "").trim());
    if (parsed) {
      await startCardUpload(env, update.chatId, update.fromUser.userId, parsed);
      return;
    }

    await persistBotFlow(env, update.fromUser.userId, "cards", "scope", {});
    await sendTelegramMessage(env, update.chatId, "Felicitacions: tria desti.", {
      replyMarkup: {
        inline_keyboard: [
          [{ text: "Global", callback_data: "card:global" }],
          [{ text: "Finestra", callback_data: "card:window" }, { text: "Membre", callback_data: "card:member" }],
        ],
      },
    });
    return;
  }

  const member = await fetchTelegramChatMember(env, groups.auditChatId, update.fromUser.userId);
  if (!isActiveTelegramChatMember(member)) {
    await sendTelegramMessage(env, update.chatId, "Aquest flux es reserva a membres actius.");
    return;
  }

  const existing = await queryBirthdayPreference(env.DB, update.fromUser.userId);
  if (existing) {
    await sendTelegramMessage(env, update.chatId, `Guardat: ${formatPreference(existing)}.`, {
      replyMarkup: {
        inline_keyboard: [
          [{ text: "Canvia", callback_data: "bday:restart" }, { text: "Esborra", callback_data: "bday:delete" }],
        ],
      },
    });
    return;
  }

  await startBirthdayCollection(env, update.chatId, update.fromUser.userId);
}

async function startBirthdayCollection(env: Env, chatId: number, userId: number): Promise<void> {
  await persistBotFlow(env, userId, "birthday", "month", {});
  await sendTelegramMessage(env, chatId, "Aniversari: mes.", {
    replyMarkup: {
      inline_keyboard: monthKeyboard(),
    },
  });
}

async function handleBirthdayCallback(env: Env, update: NormalizedCallbackQueryUpdate): Promise<BirthdayBotDisposition> {
  if (!update.data?.startsWith("bday:") && !update.data?.startsWith("card:")) {
    return "continue";
  }

  await answerTelegramCallbackQuery(env, update.callbackQueryId);

  if (update.data.startsWith("card:")) {
    await handleCardCallback(env, update);
    return "handled";
  }

  const [, action, rawValue] = update.data.split(":");
  const flow = await readBotFlow(env, update.actorUser.userId);
  const state = parseState<BirthdayFlowState>(flow?.state_json ?? "{}");

  if (action === "restart") {
    await deleteBirthdayPreference(env.DB, update.actorUser.userId);
    await startBirthdayCollection(env, update.chatId, update.actorUser.userId);
    return "handled";
  }

  if (action === "delete") {
    await deleteBirthdayPreference(env.DB, update.actorUser.userId);
    await deleteBotFlow(env, update.actorUser.userId, "birthday");
    await sendTelegramMessage(env, update.chatId, "Aniversari esborrat.");
    return "handled";
  }

  if (action === "month") {
    const month = Number(rawValue);
    if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
      return "handled";
    }
    await persistBotFlow(env, update.actorUser.userId, "birthday", "day", { month });
    await sendTelegramMessage(env, update.chatId, "Dia.", {
      replyMarkup: {
        inline_keyboard: dayKeyboard(month),
      },
    });
    return "handled";
  }

  if (action === "day" && state.month) {
    const day = Number(rawValue);
    if (!Number.isSafeInteger(day) || day < 1 || day > maxDayForMonth(state.month)) {
      return "handled";
    }
    await persistBotFlow(env, update.actorUser.userId, "birthday", "year", { month: state.month, day });
    await sendTelegramMessage(env, update.chatId, "Any? Envia'l o omet.", {
      replyMarkup: {
        inline_keyboard: [[{ text: "Omet", callback_data: "bday:year:none" }]],
      },
    });
    return "handled";
  }

  if (action === "year" && rawValue === "none" && state.month && state.day) {
    await persistBotFlow(env, update.actorUser.userId, "birthday", "ai", { ...state, year: null });
    await sendAiQuestion(env, update.chatId);
    return "handled";
  }

  if (action === "ai" && state.month && state.day) {
    const wantsAiCard = rawValue === "1";
    if (!wantsAiCard) {
      await saveBirthdayFromFlow(env, update.chatId, update.actorUser.userId, state, false, []);
      return "handled";
    }

    await persistBotFlow(env, update.actorUser.userId, "birthday", "ideas", state);
    await sendTelegramMessage(env, update.chatId, "Idees? Series, llibres, pelis, hobbies. Separat per comes.");
    return "handled";
  }

  return "handled";
}

async function handleBirthdayText(
  env: Env,
  update: NormalizedMessageUpdate,
  flow: BotFlowRow,
): Promise<void> {
  if (!update.fromUser) {
    return;
  }

  const state = parseState<BirthdayFlowState>(flow.state_json);
  const text = update.text?.trim() ?? update.caption?.trim() ?? "";

  if (flow.step === "year" && state.month && state.day) {
    const year = parseYear(text);
    if (!year.ok) {
      await sendTelegramMessage(env, update.chatId, year.message);
      return;
    }

    await persistBotFlow(env, update.fromUser.userId, "birthday", "ai", { ...state, year: year.year });
    await sendAiQuestion(env, update.chatId);
    return;
  }

  if (flow.step === "ideas" && state.month && state.day) {
    await saveBirthdayFromFlow(env, update.chatId, update.fromUser.userId, state, true, splitIdeas(text));
    return;
  }

  await sendTelegramMessage(env, update.chatId, "Toca /aniversari per recomencar.");
}

async function saveBirthdayFromFlow(
  env: Env,
  chatId: number,
  userId: number,
  state: BirthdayFlowState,
  wantsAiCard: boolean,
  promptIdeas: string[],
): Promise<void> {
  if (!state.month || !state.day) {
    await sendTelegramMessage(env, chatId, "Falten dades. Toca /aniversari.");
    return;
  }

  await upsertBirthdayPreference(env.DB, userId, {
    month: state.month,
    day: state.day,
    year: state.year ?? null,
    wantsAiCard,
    promptIdeas,
  });
  await deleteBotFlow(env, userId, "birthday");
  await sendTelegramMessage(env, chatId, "Aniversari guardat.");
}

async function handleCardCallback(env: Env, update: NormalizedCallbackQueryUpdate): Promise<void> {
  const role = await resolveRole(env, update.actorUser.userId);
  if (!role) {
    await sendTelegramMessage(env, update.chatId, "Nomes CAA pot pujar felicitacions.");
    return;
  }

  const [, action, rawValue] = update.data?.split(":") ?? [];
  if (action === "global") {
    await startCardUpload(env, update.chatId, update.actorUser.userId, {
      scopeType: "global",
      windowId: null,
      userId: null,
    });
    return;
  }

  if (action === "window") {
    await persistBotFlow(env, update.actorUser.userId, "cards", "scope", { awaiting: "window" });
    await sendWindowPicker(env, update.chatId, 0);
    return;
  }

  if (action === "w") {
    await persistBotFlow(env, update.actorUser.userId, "cards", "scope", { awaiting: "window" });
    await sendWindowPicker(env, update.chatId, parsePickerCursor(rawValue));
    return;
  }

  if (action === "wp") {
    const windowId = parsePickerId(rawValue);
    if (windowId) {
      await startCardUpload(env, update.chatId, update.actorUser.userId, { scopeType: "window", windowId, userId: null });
    }
    return;
  }

  if (action === "member") {
    await persistBotFlow(env, update.actorUser.userId, "cards", "scope", { awaiting: "member" });
    await sendMemberPicker(env, update.chatId, 0);
    return;
  }

  if (action === "m") {
    await persistBotFlow(env, update.actorUser.userId, "cards", "scope", { awaiting: "member" });
    await sendMemberPicker(env, update.chatId, parsePickerCursor(rawValue));
    return;
  }

  if (action === "mp") {
    const userId = parsePickerId(rawValue);
    if (userId) {
      await startCardUpload(env, update.chatId, update.actorUser.userId, { scopeType: "member", windowId: null, userId });
    }
  }
}

async function sendWindowPicker(env: Env, chatId: number, cursor: number): Promise<void> {
  const windows = (await listBirthdayWindows(env.DB)).filter((window) => window.enabled);
  const page = pagedItems(windows, cursor);
  if (page.items.length === 0) {
    await sendTelegramMessage(env, chatId, "Cap finestra disponible. Escriu un ID de finestra valid.");
    return;
  }

  await sendTelegramMessage(env, chatId, "Tria finestra.", {
    replyMarkup: {
      inline_keyboard: [
        ...page.items.map((window) => [{
          text: formatWindowPickerLabel(window),
          callback_data: `card:wp:${window.id}`,
        }]),
        ...pickerNavigationRows("w", page),
      ],
    },
  });
}

async function sendMemberPicker(env: Env, chatId: number, cursor: number): Promise<void> {
  const targets = await listBirthdayCardMemberTargets(env.DB);
  const page = pagedItems(targets, cursor);
  if (page.items.length === 0) {
    await sendTelegramMessage(env, chatId, "Cap membre disponible. Escriu un ID de membre valid.");
    return;
  }

  await sendTelegramMessage(env, chatId, "Tria membre.", {
    replyMarkup: {
      inline_keyboard: [
        ...page.items.map((target) => [{
          text: formatMemberPickerLabel(target),
          callback_data: `card:mp:${target.userId}`,
        }]),
        ...pickerNavigationRows("m", page),
      ],
    },
  });
}

async function handleCardsTextOrUpload(
  env: Env,
  update: NormalizedMessageUpdate,
  flow: BotFlowRow,
): Promise<void> {
  if (!update.fromUser) {
    return;
  }

  const role = await resolveRole(env, update.fromUser.userId);
  if (!role) {
    await sendTelegramMessage(env, update.chatId, "Nomes CAA pot pujar felicitacions.");
    return;
  }

  const state = parseState<CardFlowState>(flow.state_json);
  if (update.media) {
    await handleCardUploadMedia(env, update, state);
    return;
  }

  const text = update.text?.trim() ?? update.caption?.trim() ?? "";
  if (state.awaiting === "window") {
    const windowId = parseInteger(text);
    if (!windowId) {
      await sendTelegramMessage(env, update.chatId, "ID finestra invalid.");
      return;
    }
    await startCardUpload(env, update.chatId, update.fromUser.userId, { scopeType: "window", windowId, userId: null });
    return;
  }

  if (state.awaiting === "member") {
    const userId = parseInteger(text);
    if (!userId) {
      await sendTelegramMessage(env, update.chatId, "ID membre invalid.");
      return;
    }
    await startCardUpload(env, update.chatId, update.fromUser.userId, { scopeType: "member", windowId: null, userId });
    return;
  }

  const parsed = parseCardScopeText(text);
  if (parsed) {
    await startCardUpload(env, update.chatId, update.fromUser.userId, parsed);
    return;
  }

  await sendTelegramMessage(env, update.chatId, "Escriu global, finestra 12 o membre 123.");
}

async function handleCardUploadMedia(
  env: Env,
  update: NormalizedMessageUpdate,
  state: CardFlowState,
): Promise<void> {
  if (!update.fromUser || !update.media) {
    return;
  }

  if (!state.scopeType) {
    await sendTelegramMessage(env, update.chatId, "Primer tria desti.");
    return;
  }

  if (update.media.kind !== "photo" && update.media.kind !== "document") {
    await sendTelegramMessage(env, update.chatId, "Envia una imatge.");
    return;
  }

  if (update.media.mimeType && !update.media.mimeType.startsWith("image/")) {
    await sendTelegramMessage(env, update.chatId, "El fitxer no es imatge.");
    return;
  }

  const resolved = await fetchTelegramFile(env, update.media);
  if (resolved.status === "skip") {
    await sendTelegramMessage(env, update.chatId, "Imatge massa gran o no descarregable.");
    return;
  }

  const response = await fetch(resolved.file.downloadUrl);
  if (!response.ok) {
    await sendTelegramMessage(env, update.chatId, "No s'ha pogut baixar la imatge.");
    return;
  }

  const contentType = response.headers.get("content-type") ?? update.media.mimeType ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    await sendTelegramMessage(env, update.chatId, "El fitxer no es imatge.");
    return;
  }

  const fileName = update.media.fileName ?? `${update.media.kind}-${update.media.fileUniqueId}.jpg`;
  const file = new File([await response.arrayBuffer()], fileName, { type: contentType });
  let card: Awaited<ReturnType<typeof createBirthdayCard>>;
  try {
    card = await createBirthdayCard(env, {
      scopeType: state.scopeType,
      windowId: state.windowId ?? null,
      userId: state.userId ?? null,
      uploadedByUserId: update.fromUser.userId,
      file,
    });
  } catch (error) {
    await sendTelegramMessage(env, update.chatId, error instanceof Error ? error.message : "No s'ha pogut pujar la felicitacio.");
    return;
  }

  await deleteBotFlow(env, update.fromUser.userId, "cards");
  await sendTelegramMessage(env, update.chatId, `Felicitacio pujada #${card.id}.`);
}

async function startCardUpload(
  env: Env,
  chatId: number,
  staffUserId: number,
  state: Required<Pick<CardFlowState, "scopeType">> & Pick<CardFlowState, "windowId" | "userId">,
): Promise<void> {
  if (state.scopeType === "window") {
    const windowId = state.windowId ?? null;
    if (!windowId || !await queryBirthdayWindow(env.DB, windowId)) {
      await persistBotFlow(env, staffUserId, "cards", "scope", { awaiting: "window" });
      await sendTelegramMessage(env, chatId, "Finestra no trobada. Escriu un ID de finestra valid.");
      return;
    }
  }

  const nextState: CardFlowState = {
    scopeType: state.scopeType,
    windowId: state.windowId ?? null,
    userId: state.userId ?? null,
  };

  await persistBotFlow(env, staffUserId, "cards", "upload", nextState);

  if (state.scopeType === "member" && state.userId) {
    const preference = await queryBirthdayPreference(env.DB, state.userId);
    await sendMemberPrompt(env, chatId, state.userId, preference);
  }

  await sendTelegramMessage(env, chatId, "Envia la imatge.");
}

async function sendMemberPrompt(
  env: Env,
  chatId: number,
  userId: number,
  preference: BirthdayPreference | null,
): Promise<void> {
  const prompt = buildMemberPrompt(userId, preference);
  const referenceImage = await env.MEDIA_BUCKET.get(KORNIBOT_REFERENCE_IMAGE_KEY);

  if (!referenceImage) {
    await sendTelegramMessage(env, chatId, prompt);
    return;
  }

  const bytes = await new Response(referenceImage.body).arrayBuffer();
  const photo = new Blob([bytes], {
    type: referenceImage.httpMetadata?.contentType ?? "image/png",
  });

  await sendTelegramPhoto(env, chatId, photo, "kornibot-profile.png", prompt);
}

async function persistBotFlow(
  env: Env,
  userId: number,
  flow: "birthday" | "cards",
  step: string,
  state: Record<string, unknown>,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await env.DB.prepare(`
      INSERT INTO bot_flow_states (
        user_id,
        flow,
        step,
        state_json,
        updated_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, flow) DO UPDATE SET
        step = excluded.step,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `)
    .bind(userId, flow, step, JSON.stringify(state), new Date().toISOString(), expiresAt)
    .run();
}

async function readBotFlow(env: Env, userId: number): Promise<BotFlowRow | null> {
  return env.DB.prepare(`
      SELECT flow, step, state_json
      FROM bot_flow_states
      WHERE user_id = ?
        AND expires_at > ?
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .bind(userId, new Date().toISOString())
    .first<BotFlowRow>();
}

async function deleteBotFlow(env: Env, userId: number, flow: "birthday" | "cards"): Promise<void> {
  await env.DB.prepare("DELETE FROM bot_flow_states WHERE user_id = ? AND flow = ?")
    .bind(userId, flow)
    .run();
}

function parseState<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return {} as T;
  }
}

function monthKeyboard(): Array<Array<{ text: string; callback_data: string }>> {
  const labels = ["gen", "feb", "mar", "abr", "mai", "jun", "jul", "ago", "set", "oct", "nov", "des"];
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let index = 0; index < labels.length; index += 3) {
    rows.push(labels.slice(index, index + 3).map((label, offset) => ({
      text: label,
      callback_data: `bday:month:${index + offset + 1}`,
    })));
  }

  return rows;
}

function dayKeyboard(month: number): Array<Array<{ text: string; callback_data: string }>> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  const maxDay = maxDayForMonth(month);
  for (let day = 1; day <= maxDay; day += 7) {
    rows.push(Array.from({ length: Math.min(7, maxDay - day + 1) }, (_, index) => {
      const value = day + index;
      return {
        text: String(value),
        callback_data: `bday:day:${value}`,
      };
    }));
  }

  return rows;
}

function maxDayForMonth(month: number): number {
  if (month === 2) {
    return 29;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function sendAiQuestion(env: Env, chatId: number): Promise<unknown> {
  return sendTelegramMessage(env, chatId, "Targeta AI?", {
    replyMarkup: {
      inline_keyboard: [[
        { text: "Si", callback_data: "bday:ai:1" },
        { text: "No", callback_data: "bday:ai:0" },
      ]],
    },
  });
}

function parseYear(value: string): ParsedBirthdayYear {
  if (!value || /^omet|sense$/i.test(value)) {
    return { ok: true, year: null };
  }

  const year = Number(value);
  try {
    return { ok: true, year: normalizeBirthdayYear(year) };
  } catch {
    return {
      ok: false,
      message: "No cola. Kornibot no compra viatges temporals: has de tenir entre 16 i 80 anys. Torna-hi amb un any real (90 val) o escriu omet.",
    };
  }
}

function splitIdeas(value: string): string[] {
  return value
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parseInteger(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePickerId(value: string | undefined): number | null {
  return value ? parseInteger(value) : null;
}

function parsePickerCursor(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function pagedItems<T>(items: T[], cursor: number): { items: T[]; previousCursor: number | null; nextCursor: number | null } {
  const safeCursor = Math.max(0, cursor);
  const pageItems = items.slice(safeCursor, safeCursor + CARD_PICKER_PAGE_SIZE);
  return {
    items: pageItems,
    previousCursor: safeCursor > 0 ? Math.max(0, safeCursor - CARD_PICKER_PAGE_SIZE) : null,
    nextCursor: safeCursor + CARD_PICKER_PAGE_SIZE < items.length ? safeCursor + CARD_PICKER_PAGE_SIZE : null,
  };
}

function pickerNavigationRows(
  kind: "w" | "m",
  page: { previousCursor: number | null; nextCursor: number | null },
): Array<Array<{ text: string; callback_data: string }>> {
  const row: Array<{ text: string; callback_data: string }> = [];
  if (page.previousCursor !== null) {
    row.push({ text: "Anterior", callback_data: `card:${kind}:${page.previousCursor}` });
  }
  if (page.nextCursor !== null) {
    row.push({ text: "Seguent", callback_data: `card:${kind}:${page.nextCursor}` });
  }

  return row.length ? [row] : [];
}

function formatWindowPickerLabel(window: BirthdayWindow): string {
  return `${window.label} · ${window.startsOn}`;
}

function formatMemberPickerLabel(target: BirthdayCardMemberTarget): string {
  const name = target.nickname ?? target.firstName ?? target.username ?? String(target.userId);
  return target.month && target.day ? `${name} · ${target.day}/${target.month}` : name;
}

function parseCardScopeText(value: string): { scopeType: "global" | "window" | "member"; windowId: number | null; userId: number | null } | null {
  const trimmed = value.trim().toLocaleLowerCase("ca-ES");
  if (!trimmed) {
    return null;
  }

  if (trimmed === "global" || trimmed === "tot l'any" || trimmed === "any") {
    return { scopeType: "global", windowId: null, userId: null };
  }

  const windowMatch = /^(?:finestra|window)\s+(\d+)$/i.exec(trimmed);
  if (windowMatch) {
    return { scopeType: "window", windowId: Number(windowMatch[1]), userId: null };
  }

  const memberMatch = /^(?:membre|member|user)\s+(\d+)$/i.exec(trimmed);
  if (memberMatch) {
    return { scopeType: "member", windowId: null, userId: Number(memberMatch[1]) };
  }

  return null;
}

function formatPreference(preference: BirthdayPreference): string {
  const date = `${preference.day}/${preference.month}${preference.year ? `/${preference.year}` : ""}`;
  return `${date} · AI ${preference.wantsAiCard ? "si" : "no"}`;
}

function buildMemberPrompt(userId: number, preference: BirthdayPreference | null): string {
  const ideas = preference?.promptIdeas.length ? preference.promptIdeas.join(", ") : "member personality from staff notes";
  return [
    "Prompt per copiar:",
    `Birthday card for member ${userId}.`,
    `The attached image contains the "kornibot" character reference.`,
    "Reframe and position kornibot inside the scene as a candid or posed birthday-card picture, matching the scene perspective, lighting, and mood.",
    `Ideas: ${ideas}.`,
    "Use inspired-by language, do not copy protected characters directly. Warm Barcelona community birthday mood.",
  ].join("\n");
}

function deepLinkMessage(command: "aniversari" | "felicitacions"): string {
  return command === "felicitacions"
    ? "Obre DM amb Kornibot per pujar imatges de felicitacio."
    : "Obre DM amb Kornibot per guardar el teu aniversari.";
}

function botCommandFromText(text: string): PrivateBotCommandName | "menu" | null {
  const match = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+(.+))?$/u.exec(text.trim());
  if (!match) {
    return null;
  }

  const command = match[1]?.toLocaleLowerCase("ca-ES");
  const payload = match[2]?.trim().split(/\s+/)[0]?.toLocaleLowerCase("ca-ES") ?? "";
  if (command === "aniversari" || command === "felicitacions") {
    return command;
  }

  if (command === "menu") {
    return "menu";
  }

  if (command === "start" && (payload === "aniversari" || payload === "felicitacions")) {
    return payload;
  }

  return null;
}

function botDeepLink(env: Env, command: "aniversari" | "felicitacions"): string {
  const username = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || "kornibot_bot";
  return `https://t.me/${username}?start=${command}`;
}
