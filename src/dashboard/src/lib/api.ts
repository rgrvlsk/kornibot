export type SessionRole = "caa_member" | "superadmin";

export type DashboardSession = {
  role: SessionRole;
  userId: number;
  username: string | null;
};

export type FeedItem = {
  rawEventId: number;
  updateId: number;
  eventKind: string;
  chatId: number;
  messageId: number | null;
  actorUserId: number | null;
  receivedAt: string;
  text: string | null;
};

export type SearchItem = FeedItem;

export type ThreadPayload = {
  root: {
    chatId: number;
    messageId: number;
    fromUserId: number | null;
    currentText: string | null;
  } | null;
  replies: Array<{
    messageId: number;
    fromUserId: number | null;
    currentText: string | null;
    repliedAt: string;
  }>;
  versions: Array<{
    versionNo: number;
    text: string | null;
    editedAt: string;
  }>;
  reactions: Array<{
    reactorUserId: number | null;
    reactionKey: string;
    isActive: number;
    lastChangedAt: string;
  }>;
};

export type SettingsPayload = {
  groups: {
    auditChatId: number;
    caaChatId: number | null;
  };
  memberActivityThresholds: {
    goodHours: number;
    warmHours: number;
  };
  messageRetention: {
    detailDays: number;
  };
  canManagePrivilegedSettings: boolean;
  safeEnv: {
    initialAuditChatId: number;
    defaultLanguage: string;
    defaultTimezone: string;
    hasCorsAllowedOrigins: boolean;
  };
  auditDataCounts: {
    rawEvents: number;
    messages: number;
    users: number;
    mediaObjects: number;
    membershipEvents: number;
    membershipPeriods: number;
    hourlyGroupMetrics: number;
    hourlyUserMetrics: number;
    monthlyUserSnapshots: number;
    mediaBytes: number;
  };
  auditUsage: {
    daily: Array<{
      date: string;
      rawEvents: number;
      messages: number;
      mediaObjects: number;
      mediaBytes: number;
    }>;
    monthToDate: {
      rawEvents: number;
      messages: number;
      mediaObjects: number;
      mediaBytes: number;
    };
  };
};

export type AccessOverviewPayload = {
  items: Array<{
    userId: number;
    username: string | null;
    role: SessionRole;
    latestAccessAt: string;
  }>;
};

export type SetupStatusPayload = {
  isComplete: boolean;
  auditChatId: number;
  caaChatId: number | null;
  bootstrapSuperadminConfigured: boolean;
  safeEnv: SettingsPayload["safeEnv"];
};

export type TelegramChatSummary = {
  chatId: number;
  title: string | null;
  type: string;
  firstSeenAt: string;
  lastActivityAt: string;
  lastUpdateId: number;
  isAuditChat: boolean;
  isCaaChat: boolean;
};

export type UserListPayload = {
  summary: {
    activityDailyAverage: number;
    activityWindowDays: number;
    messagesLast24h: number;
    reactionsGivenLast24h: number;
    telegramMemberCount: number | null;
    knownUserCount: number;
  };
  items: Array<{
    userId: number;
    telegramId: number;
    username: string | null;
    nickname: string | null;
    profilePhoto: {
      fileId: string;
      fileUniqueId: string;
      width: number | null;
      height: number | null;
      r2Key: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
      checkedAt: string | null;
      url: string | null;
    } | null;
    activityDailyAverage: number;
    activityWindowDays: number;
    messagesLast24h: number;
    reactionsGivenLast24h: number;
    dashboardRole: "caa_member" | "superadmin" | null;
    isDashboardSuperadmin: boolean;
    isCaaMember: boolean;
    isAuditGroupOwner: boolean;
    isAuditGroupAdmin: boolean;
    lastMembershipStatus: string | null;
    lastJoinedAt: string | null;
    lastLeftAt: string | null;
    lastSeenAt: string | null;
  }>;
};

export type UserProfilePayload = {
  user: {
    userId: number;
    telegramId: number;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    nickname: string | null;
    isBot: boolean;
    languageCode: string | null;
    profilePhoto: {
      fileId: string;
      fileUniqueId: string;
      width: number | null;
      height: number | null;
      r2Key: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
      checkedAt: string | null;
      url: string | null;
    } | null;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    lastMembershipStatus: string | null;
    lastJoinedAt: string | null;
    lastLeftAt: string | null;
    dashboardRole?: "caa_member" | "superadmin" | null;
    isDashboardSuperadmin?: boolean;
    isCaaMember?: boolean;
  } | null;
  membershipPeriods: Array<{
    joinedAt: string | null;
    leftAt: string | null;
  }>;
  hourlyMetrics: Array<{
    bucketHour: string;
    messagesSent: number;
    repliesSent: number;
    editsMade: number;
    reactionsEmitted: number;
    reactionsReceived: number;
    mediaSent: number;
    activeMinutes: number;
  }>;
  monthlySnapshots: Array<{
    month: string;
    messagesSent: number;
    repliesSent: number;
    editsMade: number;
    reactionsEmitted: number;
    reactionsReceived: number;
    mediaSent: number;
    averageReactionsPerMessage: number;
  }>;
  peerAverages: {
    reactionsEmitted: number | null;
    reactionsReceived: number | null;
    averageReactionsPerMessage: number | null;
  } | null;
};

export type MemberMetricsPayload = {
  dailyMessages: Array<{
    date: string;
    messagesSent: number;
    activeUsers: number;
  }>;
  mostReactionsReceived: Array<{
    userId: number;
    username: string | null;
    nickname: string | null;
    reactionsReceived: number;
  }>;
  personalHistogram: Array<{
    date: string;
    messagesSent: number;
  }>;
  currentUser: {
    userId: number;
    username: string | null;
    nickname: string | null;
  } | null;
};

export type ResumPayload = {
  anchorHour: string;
  messageDetailDays: number;
  pulse24h: {
    messages: number;
    activeUsers: number;
    replies: number;
    replyRatio: number;
    totalReactions: number;
    media: number;
    deltaMessages: number;
    deltaReactions: number;
  };
  daily30d: Array<{
    date: string;
    messages: number;
    activeUsers: number;
    replies: number;
    totalReactions: number;
    media: number;
  }>;
  runningAverages30d: Array<{
    date: string;
    messages: number;
    totalReactions: number;
  }>;
  highlightedMembers: Array<{
    userId: number;
    username: string | null;
    nickname: string | null;
    profilePhoto?: {
      url: string | null;
    } | null;
    score: number;
    messages: number;
    replies: number;
    reactionsEmitted: number;
    reactionsReceived: number;
  }>;
  topConversations: Array<{
    chatId: number;
    messageId: number;
    fromUserId: number | null;
    username: string | null;
    nickname: string | null;
    text: string | null;
    sentAt: string;
    replies: number;
    reactions: number;
  }>;
  threadStarters: Array<{
    userId: number;
    username: string | null;
    nickname: string | null;
    profilePhoto?: {
      url: string | null;
    } | null;
    threadsStarted: number;
    replies: number;
    reactions: number;
    score: number;
  }>;
  dailyTopConversations: Array<{
    date: string;
    chatId: number;
    messageId: number;
    fromUserId: number | null;
    username: string | null;
    nickname: string | null;
    text: string | null;
    sentAt: string;
    replies: number;
    reactions: number;
  }>;
  rhythm30d: Array<{
    label: string;
    cells: number[];
    total?: number;
  }>;
  memberMovement: {
    joins: number;
    leaves: number;
    knownUsers: number;
    daily?: Array<{
      date: string;
      joins: number;
      leaves: number;
      knownUsers: number;
    }>;
  };
  mediaSignal: {
    mediaSent30d: number;
    reactedMediaCount: number;
    purgeCandidateCount: number;
  };
  auditFreshness: {
    latestEventAt: string | null;
    latestProjectedAt: string | null;
    unprojectedRawEvents: number;
    latestAggregateHour: string | null;
  };
};

export type QueryResult<T> = {
  data: T;
  issue?: string;
};

export type ProfilePhotoRefreshPayload = {
  checked: number;
  updated: number;
  empty: number;
  skipped: number;
  failed: number;
  notDue: number;
  nextCursor: number | null;
  done: boolean;
};

export type CaaRoleRefreshPayload = {
  checked: number;
  active: number;
  deactivated: number;
  failed: number;
  nextCursor: number | null;
  done: boolean;
};

export type MemberStatusRefreshPayload = {
  userId: number;
  auditStatus: string | null;
  auditActive: boolean;
  caaStatus: string | null;
  caaActive: boolean;
  isCaaMember: boolean;
  failed: number;
  checkedAt: string;
};

type AuthResponse = {
  ok: true;
  role: SessionRole;
  session: DashboardSession;
  sessionToken: string;
  user: {
    id: number;
    username: string | null;
  };
};

type SessionResponse = {
  ok: true;
  session: DashboardSession;
};

type FeedResponse = {
  ok: true;
  items: FeedItem[];
  nextCursor: string | null;
};

type SearchResponse = {
  ok: true;
  items: SearchItem[];
};

type ThreadResponse = {
  ok: true;
  root: ThreadPayload["root"];
  replies: ThreadPayload["replies"];
  versions: ThreadPayload["versions"];
  reactions: ThreadPayload["reactions"];
};

type SettingsResponse = {
  ok: true;
  settings: SettingsPayload;
};

type AccessOverviewResponse = {
  ok: true;
  items: AccessOverviewPayload["items"];
};

type SetupStatusResponse = {
  ok: true;
  setup: SetupStatusPayload;
};

type TelegramChatsResponse = {
  ok: true;
  items: TelegramChatSummary[];
};

type UserListResponse = {
  ok: true;
  items: UserListPayload["items"];
  summary: UserListPayload["summary"];
};

type ProfilePhotoRefreshResponse = {
  ok: true;
  result: ProfilePhotoRefreshPayload;
};

type CaaRoleRefreshResponse = {
  ok: true;
  result: CaaRoleRefreshPayload;
};

type MemberStatusRefreshResponse = {
  ok: true;
  result: MemberStatusRefreshPayload;
};

type AuditResetResponse = {
  ok: true;
  reset: {
    previousAuditChatId: number;
    nextAuditChatId: number;
    deletedMediaObjects: number;
  };
};

type UserProfileResponse = {
  ok: true;
  user: UserProfilePayload["user"];
  membershipPeriods: UserProfilePayload["membershipPeriods"];
  hourlyMetrics: UserProfilePayload["hourlyMetrics"];
  monthlySnapshots: UserProfilePayload["monthlySnapshots"];
  peerAverages: UserProfilePayload["peerAverages"];
};

type MemberMetricsResponse = {
  ok: true;
  dailyMessages: MemberMetricsPayload["dailyMessages"];
  mostReactionsReceived: MemberMetricsPayload["mostReactionsReceived"];
  personalHistogram: MemberMetricsPayload["personalHistogram"];
  currentUser: MemberMetricsPayload["currentUser"];
};

type ResumResponse = { ok: true } & ResumPayload;

type ApiErrorResponse = {
  ok: false;
  message?: string;
};

type TelegramAuthPayload = Record<string, unknown>;

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

const TELEGRAM_BOT_USERNAME = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "").trim();
const SESSION_TOKEN_STORAGE_KEY = "kornibot.dashboard.session-token";
const DEV_ACCESS_KEY_STORAGE_KEY = "kornibot.dashboard.dev-access-key";
const DEV_ACCESS_KEY_HEADER = "x-kornibot-dev-access-key";
const VISIT_TRACKING_DEDUPE_MS = 10_000;

let lastTrackedVisitAt = 0;

function buildApiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

export function buildApiAssetUrl(path: string): string {
  return buildApiUrl(path);
}

export async function loadApiAssetObjectUrl(path: string): Promise<string | null> {
  const response = await fetch(buildApiUrl(path), {
    credentials: "include",
    headers: createHeaders(),
  });

  if (!response.ok) {
    return null;
  }

  return URL.createObjectURL(await response.blob());
}


function readStoredSessionToken(): string | null {
  return window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
}

function storeSessionToken(token: string): void {
  window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
}

export function clearStoredSessionToken(): void {
  window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
}

function supportsStoredDevAccessKey(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined";
}

export function readStoredDevAccessKey(): string | null {
  if (!supportsStoredDevAccessKey()) {
    return null;
  }

  const key = window.localStorage.getItem(DEV_ACCESS_KEY_STORAGE_KEY)?.trim();
  return key && key.length > 0 ? key : null;
}

function storeDevAccessKey(key: string): void {
  if (!supportsStoredDevAccessKey()) {
    return;
  }

  window.localStorage.setItem(DEV_ACCESS_KEY_STORAGE_KEY, key);
}

export function clearStoredDevAccessKey(): void {
  if (!supportsStoredDevAccessKey()) {
    return;
  }

  window.localStorage.removeItem(DEV_ACCESS_KEY_STORAGE_KEY);
}

function createHeaders(extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  headers.set("accept", "application/json");

  const devAccessKey = readStoredDevAccessKey();
  if (devAccessKey) {
    headers.set(DEV_ACCESS_KEY_HEADER, devAccessKey);
  }

  const token = readStoredSessionToken();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return headers;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as ApiErrorResponse;
    return payload.message ?? `API no disponible (${response.status}).`;
  } catch {
    return `API no disponible (${response.status}).`;
  }
}

async function requestJson<TRaw, TData>(
  path: string,
  mapResponse: (value: TRaw) => TData,
): Promise<QueryResult<TData>> {
  const response = await fetch(buildApiUrl(path), {
    credentials: "include",
    headers: createHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = await response.json() as TRaw;

  return {
    data: mapResponse(payload),
  };
}

async function mutateJson<TRaw, TData>(
  path: string,
  init: RequestInit,
  mapResponse: (value: TRaw) => TData,
): Promise<TData> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: "include",
    headers: createHeaders(init.headers),
  });

  const payload = await response.json() as TRaw | ApiErrorResponse;
  if (!response.ok) {
    throw new Error((payload as ApiErrorResponse).message ?? `Request failed (${response.status})`);
  }

  return mapResponse(payload as TRaw);
}

export function getTelegramBotUsername(): string {
  return TELEGRAM_BOT_USERNAME;
}


export async function authenticateTelegram(payload: TelegramAuthPayload): Promise<DashboardSession> {
  const response = await mutateJson<AuthResponse, AuthResponse>("/auth/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  }, (value) => value);

  storeSessionToken(response.sessionToken);
  return response.session;
}

export async function authenticateDevAccess(key: string): Promise<DashboardSession> {
  const response = await mutateJson<AuthResponse, AuthResponse>("/auth/dev-access", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ key }),
  }, (value) => value);

  storeSessionToken(response.sessionToken);
  storeDevAccessKey(key.trim());
  return response.session;
}

export async function loadCurrentSession(): Promise<DashboardSession | null> {
  try {
    const response = await fetch(buildApiUrl("/auth/session"), {
      credentials: "include",
      headers: createHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      clearStoredSessionToken();
      clearStoredDevAccessKey();
      return null;
    }

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = await response.json() as SessionResponse;
    return payload.session;
  } catch {
    return null;
  }
}

export async function logoutSession(): Promise<void> {
  clearStoredSessionToken();
  clearStoredDevAccessKey();

  try {
    await fetch(buildApiUrl("/auth/logout"), {
      method: "POST",
      credentials: "include",
      headers: createHeaders(),
    });
  } catch {
    // Ignore network failures during local sign-out.
  }
}

export async function recordDashboardVisit(): Promise<void> {
  const now = Date.now();
  if (now - lastTrackedVisitAt < VISIT_TRACKING_DEDUPE_MS) {
    return;
  }

  lastTrackedVisitAt = now;

  try {
    await fetch(buildApiUrl("/api/access-analytics/visit"), {
      method: "POST",
      credentials: "include",
      headers: createHeaders(),
      keepalive: true,
    });
  } catch {
    // Access analytics must never block dashboard use.
  }
}

export async function loadFeed(cursor?: string | null): Promise<QueryResult<{ items: FeedItem[]; nextCursor: string | null }>> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) {
    params.set("cursor", cursor);
  }

  return requestJson<FeedResponse, { items: FeedItem[]; nextCursor: string | null }>(
    `/api/feed?${params.toString()}`,
    (payload) => ({
      items: payload.items,
      nextCursor: payload.nextCursor,
    }),
  );
}

export async function loadSearch(search: {
  text?: string;
  type?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<QueryResult<{ items: SearchItem[] }>> {
  const params = new URLSearchParams();
  if (search.text) params.set("text", search.text);
  if (search.type) params.set("type", search.type);
  if (search.userId) params.set("userId", search.userId);
  if (search.dateFrom) params.set("dateFrom", search.dateFrom);
  if (search.dateTo) params.set("dateTo", search.dateTo);

  return requestJson<SearchResponse, { items: SearchItem[] }>(
    `/api/search?${params.toString()}`,
    (payload) => ({
      items: payload.items,
    }),
  );
}

export async function loadThread(chatId: string, messageId: string): Promise<QueryResult<ThreadPayload>> {
  return requestJson<ThreadResponse, ThreadPayload>(
    `/api/threads/${chatId}/${messageId}`,
    (payload) => ({
      root: payload.root,
      replies: payload.replies,
      versions: payload.versions,
      reactions: payload.reactions,
    }),
  );
}

export async function loadSettings(): Promise<QueryResult<SettingsPayload>> {
  return requestJson<SettingsResponse, SettingsPayload>(
    "/api/settings",
    (payload) => ({
      ...payload.settings,
      messageRetention: payload.settings.messageRetention ?? {
        detailDays: 7,
      },
      auditDataCounts: {
        ...payload.settings.auditDataCounts,
        mediaBytes: payload.settings.auditDataCounts.mediaBytes ?? 0,
      },
      auditUsage: payload.settings.auditUsage ?? {
        daily: [],
        monthToDate: {
          rawEvents: 0,
          messages: 0,
          mediaObjects: 0,
          mediaBytes: 0,
        },
      },
    }),
  );
}

export async function loadAccessOverview(): Promise<QueryResult<AccessOverviewPayload>> {
  return requestJson<AccessOverviewResponse, AccessOverviewPayload>(
    "/api/access-analytics/overview?limit=20",
    (payload) => ({
      items: payload.items,
    }),
  );
}

export async function loadSetupStatus(): Promise<QueryResult<SetupStatusPayload>> {
  return requestJson<SetupStatusResponse, SetupStatusPayload>(
    "/api/setup/status",
    (payload) => payload.setup,
  );
}

export async function loadTelegramChats(): Promise<QueryResult<{ items: TelegramChatSummary[] }>> {
  return requestJson<TelegramChatsResponse, { items: TelegramChatSummary[] }>(
    "/api/telegram-chats",
    (payload) => ({
      items: payload.items,
    }),
  );
}

export async function updateGroupSettings(payload: {
  auditChatId: number;
  caaChatId: number;
}): Promise<SettingsPayload> {
  return mutateJson<SettingsResponse, SettingsPayload>(
    "/api/settings/groups",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    (response) => response.settings,
  );
}

export async function updateMemberActivityThresholds(payload: {
  goodHours: number;
  warmHours: number;
}): Promise<SettingsPayload> {
  return mutateJson<SettingsResponse, SettingsPayload>(
    "/api/settings/members/activity-thresholds",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    (response) => response.settings,
  );
}

export async function updateMessageRetention(payload: {
  detailDays: number;
}): Promise<SettingsPayload> {
  return mutateJson<SettingsResponse, SettingsPayload>(
    "/api/settings/privacy/message-retention",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    (response) => response.settings,
  );
}

export async function resetAuditGroup(payload: {
  nextAuditChatId: number;
  confirmation: string;
}): Promise<AuditResetResponse["reset"]> {
  return mutateJson<AuditResetResponse, AuditResetResponse["reset"]>(
    "/api/settings/audit-group-reset",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    (response) => response.reset,
  );
}

export async function loadUsers(): Promise<QueryResult<UserListPayload>> {
  return requestJson<UserListResponse, UserListPayload>(
    "/api/users?limit=500",
    (payload) => ({
      items: payload.items,
      summary: payload.summary,
    }),
  );
}

export async function refreshProfilePhotos(payload: {
  cursor: number | null;
  force: boolean;
}): Promise<ProfilePhotoRefreshPayload> {
  return mutateJson<ProfilePhotoRefreshResponse, ProfilePhotoRefreshPayload>(
    "/api/users/profile-photos/refresh",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        cursor: payload.cursor ?? 0,
        force: payload.force,
        limit: 8,
      }),
    },
    (response) => response.result,
  );
}

export async function refreshCaaRoles(payload: {
  cursor: number | null;
}): Promise<CaaRoleRefreshPayload> {
  return mutateJson<CaaRoleRefreshResponse, CaaRoleRefreshPayload>(
    "/api/users/caa-roles/refresh",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        cursor: payload.cursor ?? 0,
        limit: 8,
      }),
    },
    (response) => response.result,
  );
}

export async function refreshMemberStatus(userId: string | number): Promise<MemberStatusRefreshPayload> {
  return mutateJson<MemberStatusRefreshResponse, MemberStatusRefreshPayload>(
    `/api/users/${userId}/status/refresh`,
    {
      method: "POST",
    },
    (response) => response.result,
  );
}

export async function loadUserProfile(userId: string): Promise<QueryResult<UserProfilePayload>> {
  return requestJson<UserProfileResponse, UserProfilePayload>(
    `/api/users/${userId}`,
    (payload) => ({
      user: payload.user,
      membershipPeriods: payload.membershipPeriods,
      hourlyMetrics: payload.hourlyMetrics,
      monthlySnapshots: payload.monthlySnapshots,
      peerAverages: payload.peerAverages,
    }),
  );
}

export async function loadMemberMetrics(): Promise<QueryResult<MemberMetricsPayload>> {
  return requestJson<MemberMetricsResponse, MemberMetricsPayload>(
    "/api/member-metrics",
    (payload) => ({
      dailyMessages: payload.dailyMessages,
      mostReactionsReceived: payload.mostReactionsReceived,
      personalHistogram: payload.personalHistogram,
      currentUser: payload.currentUser,
    }),
  );
}

export async function loadResum(): Promise<QueryResult<ResumPayload>> {
  return requestJson<ResumResponse, ResumPayload>(
    "/api/resum",
    (payload) => ({
      anchorHour: payload.anchorHour,
      messageDetailDays: payload.messageDetailDays ?? 7,
      pulse24h: payload.pulse24h,
      daily30d: payload.daily30d,
      runningAverages30d: payload.runningAverages30d,
      highlightedMembers: payload.highlightedMembers,
      topConversations: payload.topConversations,
      threadStarters: payload.threadStarters ?? [],
      dailyTopConversations: payload.dailyTopConversations ?? [],
      rhythm30d: payload.rhythm30d,
      memberMovement: payload.memberMovement,
      mediaSignal: payload.mediaSignal,
      auditFreshness: payload.auditFreshness,
    }),
  );
}
