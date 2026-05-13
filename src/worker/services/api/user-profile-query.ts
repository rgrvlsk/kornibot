import { ACTIVITY_METRICS_CTE } from "../analytics/activity-metrics-source";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type UserRow = {
  user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  is_bot: number;
  language_code: string | null;
  profile_photo_file_id: string | null;
  profile_photo_file_unique_id: string | null;
  profile_photo_width: number | null;
  profile_photo_height: number | null;
  profile_photo_r2_key: string | null;
  profile_photo_mime_type: string | null;
  profile_photo_size_bytes: number | null;
  profile_photo_checked_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_membership_status: string | null;
  last_joined_at: string | null;
  last_left_at: string | null;
  dashboard_role?: "caa_member" | "superadmin" | null;
  is_dashboard_superadmin?: number;
  is_caa_member?: number;
};

type MembershipPeriodRow = {
  joined_at: string | null;
  left_at: string | null;
};

type HourlyMetricRow = {
  bucket_hour: string;
  messages_sent: number;
  replies_sent: number;
  edits_made: number;
  reactions_emitted: number;
  reactions_received: number;
  media_sent: number;
  active_minutes: number;
};

type MonthlySnapshotRow = {
  month: string;
  messages_sent: number;
  replies_sent: number;
  edits_made: number;
  reactions_emitted: number;
  reactions_received: number;
  media_sent: number;
  average_reactions_per_message: number;
};

type PeerAverageRow = {
  reactions_emitted: number | null;
  reactions_received: number | null;
  average_reactions_per_message: number | null;
};

type UserActivityRow = {
  user_id: number;
  activity_count: number;
};

type UserRecentActivityRow = {
  user_id: number;
  messages_last_24h: number;
  reactions_given_last_24h: number;
};

type ActivityWindowRow = {
  window_days: number;
  activity_count: number;
};

type LatestMetricRow = {
  bucket_hour: string | null;
};

type UserCountRow = {
  count: number;
};

type UserPhotoRow = {
  profile_photo_r2_key: string | null;
  profile_photo_mime_type: string | null;
};

function profilePhotoUrl(userId: number, r2Key: string | null): string | null {
  return r2Key ? `/api/users/${userId}/profile-photo` : null;
}

function hasPeerAverage(row: PeerAverageRow | null): row is PeerAverageRow {
  return row !== null && (
    row.reactions_emitted !== null
    || row.reactions_received !== null
    || row.average_reactions_per_message !== null
  );
}

export async function queryUserProfile(
  db: D1DatabaseLike,
  userId: number,
): Promise<{
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
    dashboardRole: "caa_member" | "superadmin" | null;
    isDashboardSuperadmin: boolean;
    isCaaMember: boolean;
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
}> {
  const user = await db.prepare(`
      SELECT
        user_id,
        username,
        first_name,
        last_name,
        nickname,
        is_bot,
        language_code,
        profile_photo_file_id,
        profile_photo_file_unique_id,
        profile_photo_width,
        profile_photo_height,
        profile_photo_r2_key,
        profile_photo_mime_type,
        profile_photo_size_bytes,
        profile_photo_checked_at,
        first_seen_at,
        last_seen_at,
        last_membership_status,
        last_joined_at,
        last_left_at,
        (
          SELECT role
          FROM auth_roles
          WHERE auth_roles.user_id = users.user_id
            AND auth_roles.is_active = 1
            AND auth_roles.role IN ('superadmin', 'caa_member')
          ORDER BY CASE auth_roles.role WHEN 'superadmin' THEN 0 ELSE 1 END
          LIMIT 1
        ) AS dashboard_role,
        EXISTS (
          SELECT 1
          FROM auth_roles
          WHERE auth_roles.user_id = users.user_id
            AND auth_roles.is_active = 1
            AND auth_roles.role = 'superadmin'
        ) AS is_dashboard_superadmin,
        EXISTS (
          SELECT 1
          FROM auth_roles
          WHERE auth_roles.user_id = users.user_id
            AND auth_roles.is_active = 1
            AND auth_roles.role = 'caa_member'
        ) AS is_caa_member
      FROM users
      WHERE user_id = ?
    `)
    .bind(userId)
    .first<UserRow>();

  const membershipPeriods = await db.prepare(`
      SELECT joined_at, left_at
      FROM user_membership_periods
      WHERE user_id = ?
      ORDER BY COALESCE(joined_at, left_at) DESC, id DESC
      LIMIT 50
    `)
    .bind(userId)
    .all<MembershipPeriodRow>();

  const hourlyMetrics = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        period_start AS bucket_hour,
        messages_sent,
        replies_sent,
        edits_made,
        reactions_emitted,
        reactions_received,
        media_sent,
        active_minutes
      FROM activity_metrics
      WHERE user_id = ?
      ORDER BY metric_start DESC
      LIMIT 336
    `)
    .bind(userId)
    .all<HourlyMetricRow>();

  const monthlySnapshots = await db.prepare(`
      SELECT
        month,
        messages_sent,
        replies_sent,
        edits_made,
        reactions_emitted,
        reactions_received,
        media_sent,
        average_reactions_per_message
      FROM monthly_user_snapshots
      WHERE user_id = ?
      ORDER BY month DESC
      LIMIT 12
    `)
    .bind(userId)
    .all<MonthlySnapshotRow>();

  const latestMonth = monthlySnapshots.results[0]?.month ?? null;
  const peerAverages = latestMonth
    ? await db.prepare(`
        SELECT
          AVG(reactions_emitted) AS reactions_emitted,
          AVG(reactions_received) AS reactions_received,
          AVG(average_reactions_per_message) AS average_reactions_per_message
        FROM monthly_user_snapshots
        WHERE month = ?
          AND user_id != ?
      `)
      .bind(latestMonth, userId)
      .first<PeerAverageRow>()
    : null;
  const hourlyPeerAverages = hasPeerAverage(peerAverages)
    ? null
    : await db.prepare(`
        WITH ${ACTIVITY_METRICS_CTE},
        latest_metric AS (
          SELECT MAX(metric_start) AS bucket_hour
          FROM activity_metrics
        ),
        peer_totals AS (
          SELECT
            user_id,
            COALESCE(SUM(reactions_emitted), 0) AS reactions_emitted,
            COALESCE(SUM(reactions_received), 0) AS reactions_received,
            COALESCE(SUM(messages_sent), 0) AS messages_sent
          FROM activity_metrics
          WHERE user_id != ?
            AND (SELECT bucket_hour FROM latest_metric) IS NOT NULL
            AND date(metric_start) >= date((SELECT bucket_hour FROM latest_metric), '-29 days')
            AND date(metric_start) <= date((SELECT bucket_hour FROM latest_metric))
          GROUP BY user_id
        )
        SELECT
          AVG(reactions_emitted) AS reactions_emitted,
          AVG(reactions_received) AS reactions_received,
          AVG(
            CASE
              WHEN messages_sent > 0 THEN CAST(reactions_received AS REAL) / messages_sent
              ELSE 0
            END
          ) AS average_reactions_per_message
        FROM peer_totals
      `)
      .bind(userId)
      .first<PeerAverageRow>();
  const selectedPeerAverages = hasPeerAverage(peerAverages) ? peerAverages : hourlyPeerAverages;

  return {
    user: user
      ? {
        userId: user.user_id,
        telegramId: user.user_id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        nickname: user.nickname,
        isBot: user.is_bot === 1,
        languageCode: user.language_code,
        profilePhoto: user.profile_photo_file_id && user.profile_photo_file_unique_id
          ? {
            fileId: user.profile_photo_file_id,
            fileUniqueId: user.profile_photo_file_unique_id,
            width: user.profile_photo_width,
            height: user.profile_photo_height,
            r2Key: user.profile_photo_r2_key,
            mimeType: user.profile_photo_mime_type,
            sizeBytes: user.profile_photo_size_bytes,
            checkedAt: user.profile_photo_checked_at,
            url: profilePhotoUrl(user.user_id, user.profile_photo_r2_key),
          }
        : null,
        firstSeenAt: user.first_seen_at,
        lastSeenAt: user.last_seen_at,
        lastMembershipStatus: user.last_membership_status,
        lastJoinedAt: user.last_joined_at,
        lastLeftAt: user.last_left_at,
        dashboardRole: user.dashboard_role ?? null,
        isDashboardSuperadmin: user.is_dashboard_superadmin === 1,
        isCaaMember: user.is_caa_member === 1,
      }
      : null,
    membershipPeriods: membershipPeriods.results.map((row) => ({
      joinedAt: row.joined_at,
      leftAt: row.left_at,
    })),
    hourlyMetrics: hourlyMetrics.results.map((row) => ({
      bucketHour: row.bucket_hour,
      messagesSent: row.messages_sent,
      repliesSent: row.replies_sent,
      editsMade: row.edits_made,
      reactionsEmitted: row.reactions_emitted,
      reactionsReceived: row.reactions_received,
      mediaSent: row.media_sent,
      activeMinutes: row.active_minutes,
    })),
    monthlySnapshots: monthlySnapshots.results.map((row) => ({
      month: row.month,
      messagesSent: row.messages_sent,
      repliesSent: row.replies_sent,
      editsMade: row.edits_made,
      reactionsEmitted: row.reactions_emitted,
      reactionsReceived: row.reactions_received,
      mediaSent: row.media_sent,
      averageReactionsPerMessage: row.average_reactions_per_message,
    })),
    peerAverages: selectedPeerAverages
      ? {
        reactionsEmitted: selectedPeerAverages.reactions_emitted,
        reactionsReceived: selectedPeerAverages.reactions_received,
        averageReactionsPerMessage: selectedPeerAverages.average_reactions_per_message,
      }
      : null,
  };
}

export async function queryUserProfiles(
  db: D1DatabaseLike,
  searchParams: URLSearchParams,
): Promise<{
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
    lastMembershipStatus: string | null;
    lastJoinedAt: string | null;
    lastLeftAt: string | null;
    lastSeenAt: string | null;
  }>;
  summary: {
    activityDailyAverage: number;
    activityWindowDays: number;
    knownUserCount: number;
    messagesLast24h: number;
    reactionsGivenLast24h: number;
  };
}> {
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "100"), 1), 500);
  const knownUserCount = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM users
    `)
    .first<UserCountRow>();
  const activityWindow = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE},
      windowed_metrics AS (
        SELECT *
        FROM activity_metrics
        WHERE (SELECT MAX(metric_start) FROM activity_metrics) IS NOT NULL
          AND date(metric_start) >= date((SELECT MAX(metric_start) FROM activity_metrics), '-29 days')
          AND date(metric_start) <= date((SELECT MAX(metric_start) FROM activity_metrics))
      )
      SELECT
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE CAST(julianday(MAX(date(metric_start))) - julianday(MIN(date(metric_start))) + 1 AS INTEGER)
        END AS window_days,
        COALESCE(SUM(messages_sent + edits_made + reactions_emitted + media_sent), 0) AS activity_count
      FROM windowed_metrics
    `)
    .first<ActivityWindowRow>();
  const activityWindowDays = activityWindow?.window_days ?? 0;
  const activityRows = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE},
      windowed_metrics AS (
        SELECT *
        FROM activity_metrics
        WHERE (SELECT MAX(metric_start) FROM activity_metrics) IS NOT NULL
          AND date(metric_start) >= date((SELECT MAX(metric_start) FROM activity_metrics), '-29 days')
          AND date(metric_start) <= date((SELECT MAX(metric_start) FROM activity_metrics))
      )
      SELECT
        user_id,
        COALESCE(SUM(messages_sent + edits_made + reactions_emitted + media_sent), 0) AS activity_count
      FROM windowed_metrics
      GROUP BY user_id
    `)
    .all<UserActivityRow>();
  const activityByUserId = new Map(activityRows.results.map((row) => [row.user_id, row.activity_count]));
  const latestMetric = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT MAX(metric_start) AS bucket_hour
      FROM activity_metrics
    `)
    .first<LatestMetricRow>();
  const recentActivityRows = latestMetric?.bucket_hour
    ? await db.prepare(`
        WITH ${ACTIVITY_METRICS_CTE}
        SELECT
          user_id,
          COALESCE(SUM(messages_sent), 0) AS messages_last_24h,
          COALESCE(SUM(reactions_emitted), 0) AS reactions_given_last_24h
        FROM activity_metrics
        WHERE julianday(metric_start) > julianday(?, '-24 hours')
          AND julianday(metric_start) <= julianday(?)
        GROUP BY user_id
      `)
      .bind(latestMetric.bucket_hour, latestMetric.bucket_hour)
      .all<UserRecentActivityRow>()
    : { results: [] };
  const recentActivityByUserId = new Map(recentActivityRows.results.map((row) => [row.user_id, row]));
  const recentActivitySummary = recentActivityRows.results.reduce((summary, row) => ({
    messagesLast24h: summary.messagesLast24h + row.messages_last_24h,
    reactionsGivenLast24h: summary.reactionsGivenLast24h + row.reactions_given_last_24h,
  }), {
    messagesLast24h: 0,
    reactionsGivenLast24h: 0,
  });
  const rows = await db.prepare(`
      SELECT
        user_id,
        username,
        nickname,
        profile_photo_file_id,
        profile_photo_file_unique_id,
        profile_photo_width,
        profile_photo_height,
        profile_photo_r2_key,
        profile_photo_mime_type,
        profile_photo_size_bytes,
        profile_photo_checked_at,
        (
          SELECT role
          FROM auth_roles
          WHERE auth_roles.user_id = users.user_id
            AND auth_roles.is_active = 1
            AND auth_roles.role IN ('superadmin', 'caa_member')
          ORDER BY CASE auth_roles.role WHEN 'superadmin' THEN 0 ELSE 1 END
          LIMIT 1
        ) AS dashboard_role,
        EXISTS (
          SELECT 1
          FROM auth_roles
          WHERE auth_roles.user_id = users.user_id
            AND auth_roles.is_active = 1
            AND auth_roles.role = 'superadmin'
        ) AS is_dashboard_superadmin,
        EXISTS (
          SELECT 1
          FROM auth_roles
          WHERE auth_roles.user_id = users.user_id
            AND auth_roles.is_active = 1
            AND auth_roles.role = 'caa_member'
        ) AS is_caa_member,
        last_membership_status,
        last_joined_at,
        last_left_at,
        last_seen_at
      FROM users
      ORDER BY COALESCE(last_seen_at, updated_at) DESC, user_id ASC
      LIMIT ?
    `)
    .bind(limit)
    .all<Pick<UserRow,
      | "user_id"
      | "username"
      | "nickname"
      | "profile_photo_file_id"
      | "profile_photo_file_unique_id"
      | "profile_photo_width"
      | "profile_photo_height"
      | "profile_photo_r2_key"
      | "profile_photo_mime_type"
      | "profile_photo_size_bytes"
      | "profile_photo_checked_at"
      | "last_membership_status"
      | "last_joined_at"
      | "last_left_at"
      | "last_seen_at"
    > & {
      dashboard_role: "caa_member" | "superadmin" | null;
      is_dashboard_superadmin: number;
      is_caa_member: number;
    }>();

  return {
    items: rows.results.map((row) => ({
      userId: row.user_id,
      telegramId: row.user_id,
      username: row.username,
      nickname: row.nickname,
      profilePhoto: row.profile_photo_file_id && row.profile_photo_file_unique_id
        ? {
          fileId: row.profile_photo_file_id,
          fileUniqueId: row.profile_photo_file_unique_id,
          width: row.profile_photo_width,
          height: row.profile_photo_height,
          r2Key: row.profile_photo_r2_key,
          mimeType: row.profile_photo_mime_type,
          sizeBytes: row.profile_photo_size_bytes,
          checkedAt: row.profile_photo_checked_at,
          url: profilePhotoUrl(row.user_id, row.profile_photo_r2_key),
        }
        : null,
      activityDailyAverage: activityWindowDays > 0
        ? (activityByUserId.get(row.user_id) ?? 0) / activityWindowDays
        : 0,
      activityWindowDays,
      messagesLast24h: recentActivityByUserId.get(row.user_id)?.messages_last_24h ?? 0,
      reactionsGivenLast24h: recentActivityByUserId.get(row.user_id)?.reactions_given_last_24h ?? 0,
      dashboardRole: row.dashboard_role,
      isDashboardSuperadmin: row.is_dashboard_superadmin === 1,
      isCaaMember: row.is_caa_member === 1,
      lastMembershipStatus: row.last_membership_status,
      lastJoinedAt: row.last_joined_at,
      lastLeftAt: row.last_left_at,
      lastSeenAt: row.last_seen_at,
    })),
    summary: {
      activityDailyAverage: activityWindowDays > 0
        ? (activityWindow?.activity_count ?? 0) / activityWindowDays
        : 0,
      activityWindowDays,
      knownUserCount: knownUserCount?.count ?? 0,
      messagesLast24h: recentActivitySummary.messagesLast24h,
      reactionsGivenLast24h: recentActivitySummary.reactionsGivenLast24h,
    },
  };
}

export async function queryUserProfilePhoto(
  db: D1DatabaseLike,
  userId: number,
): Promise<{
  r2Key: string;
  mimeType: string | null;
} | null> {
  const row = await db.prepare(`
      SELECT profile_photo_r2_key, profile_photo_mime_type
      FROM users
      WHERE user_id = ?
    `)
    .bind(userId)
    .first<UserPhotoRow>();

  if (!row?.profile_photo_r2_key) {
    return null;
  }

  return {
    r2Key: row.profile_photo_r2_key,
    mimeType: row.profile_photo_mime_type,
  };
}
