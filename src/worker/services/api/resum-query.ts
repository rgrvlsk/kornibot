import { ACTIVITY_METRICS_CTE } from "../analytics/activity-metrics-source";
import { readMessageRetentionSettings } from "../settings/group-settings";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type LatestMetricRow = {
  bucket_hour: string | null;
  first_bucket_hour: string | null;
};

type DailyMetricRow = {
  date: string;
  messages_sent: number;
  active_users: number;
  replies_sent: number;
  edits_made: number;
  reactions_emitted: number;
  reactions_received: number;
  media_sent: number;
};

type WindowMetricRow = {
  messages_sent: number;
  active_users: number;
  replies_sent: number;
  reactions_emitted: number;
  reactions_received: number;
  media_sent: number;
};

type HighlightedMemberRow = {
  user_id: number;
  username: string | null;
  nickname: string | null;
  profile_photo_r2_key: string | null;
  messages_sent: number;
  replies_sent: number;
  reactions_emitted: number;
  reactions_received: number;
};

type ConversationRow = {
  chat_id: number;
  message_id: number;
  from_user_id: number | null;
  username: string | null;
  nickname: string | null;
  text: string | null;
  sent_at: string;
  replies: number;
  reactions: number;
};

type ThreadStarterRow = {
  user_id: number;
  username: string | null;
  nickname: string | null;
  profile_photo_r2_key: string | null;
  threads_started: number;
  replies: number;
  reactions: number;
  score: number;
};

type DailyConversationRow = ConversationRow & {
  date: string;
};

type MovementRow = {
  event_type: string;
  count: number;
};

type MovementDailyRow = {
  date: string;
  event_type: string;
  count: number;
};

type CountRow = {
  count: number;
};

type RhythmRow = {
  weekday: number;
  hour_window: number;
  activity: number;
};

type AuditFreshnessRow = {
  latest_event_at: string | null;
  latest_projected_at: string | null;
  unprojected_raw_events: number;
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
    profilePhoto: {
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
    profilePhoto: {
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
    total: number;
  }>;
  memberMovement: {
    joins: number;
    leaves: number;
    knownUsers: number;
    daily: Array<{
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

const WEEKDAY_LABELS = ["dg", "dl", "dt", "dc", "dj", "dv", "ds"];

function profilePhotoUrl(userId: number, r2Key: string | null): string | null {
  return r2Key ? `/api/users/${userId}/profile-photo` : null;
}

function floorToHour(input: Date): string {
  const date = new Date(input);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function addHours(timestamp: string, delta: number): string {
  return new Date(new Date(timestamp).getTime() + delta * 60 * 60 * 1000).toISOString();
}

function startOfDay(day: string): string {
  return `${day}T00:00:00.000Z`;
}

function dateRange(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

function numberOrZero(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return Number((numerator / denominator).toFixed(2));
}

function runningAverage(
  values: Array<{ date: string; messages: number; totalReactions: number }>,
): ResumPayload["runningAverages30d"] {
  return values.map((_, index) => {
    const window = values.slice(Math.max(0, index - 6), index + 1);
    return {
      date: values[index].date,
      messages: Math.round(window.reduce((sum, row) => sum + row.messages, 0) / window.length),
      totalReactions: Math.round(window.reduce((sum, row) => sum + row.totalReactions, 0) / window.length),
    };
  });
}

async function queryWindowMetrics(
  db: D1DatabaseLike,
  startHour: string,
  endHour: string,
): Promise<WindowMetricRow> {
  const row = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        COALESCE(SUM(messages_sent), 0) AS messages_sent,
        COUNT(DISTINCT CASE
          WHEN messages_sent + replies_sent + edits_made + reactions_emitted + reactions_received + media_sent > 0
          THEN user_id
        END) AS active_users,
        COALESCE(SUM(replies_sent), 0) AS replies_sent,
        COALESCE(SUM(reactions_emitted), 0) AS reactions_emitted,
        COALESCE(SUM(reactions_received), 0) AS reactions_received,
        COALESCE(SUM(media_sent), 0) AS media_sent
      FROM activity_metrics
      WHERE metric_start > ?
        AND metric_start <= ?
    `)
    .bind(startHour, endHour)
    .first<WindowMetricRow>();

  return {
    messages_sent: numberOrZero(row?.messages_sent),
    active_users: numberOrZero(row?.active_users),
    replies_sent: numberOrZero(row?.replies_sent),
    reactions_emitted: numberOrZero(row?.reactions_emitted),
    reactions_received: numberOrZero(row?.reactions_received),
    media_sent: numberOrZero(row?.media_sent),
  };
}

export async function queryResum(db: D1DatabaseLike): Promise<ResumPayload> {
  const [latestMetric, messageRetention] = await Promise.all([
    db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        MAX(metric_start) AS bucket_hour,
        MIN(metric_start) AS first_bucket_hour
      FROM activity_metrics
    `)
      .first<LatestMetricRow>(),
    readMessageRetentionSettings(db),
  ]);
  const latestAggregateHour = latestMetric?.bucket_hour;
  const anchorHour = latestAggregateHour ?? floorToHour(new Date());
  const endDay = anchorHour.slice(0, 10);
  const firstMetricDay = latestMetric?.first_bucket_hour?.slice(0, 10) ?? endDay;
  const visibleStartDay = addDays(endDay, -29);
  const messageDetailDays = Math.min(messageRetention.detailDays, 30);
  const detailStartDay = addDays(endDay, -(messageDetailDays - 1));
  const chartStartDay = firstMetricDay > visibleStartDay ? firstMetricDay : visibleStartDay;
  const detailChartStartDay = firstMetricDay > detailStartDay ? firstMetricDay : detailStartDay;
  const sourceStartDay = firstMetricDay > addDays(chartStartDay, -6) ? firstMetricDay : addDays(chartStartDay, -6);
  const exclusiveEnd = startOfDay(addDays(endDay, 1));
  const visibleStart = startOfDay(chartStartDay);
  const detailStart = startOfDay(detailChartStartDay);
  const sourceStart = startOfDay(sourceStartDay);

  const [currentWindow, previousWindow, dailyRows] = await Promise.all([
    queryWindowMetrics(db, addHours(anchorHour, -24), anchorHour),
    queryWindowMetrics(db, addHours(anchorHour, -48), addHours(anchorHour, -24)),
    db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        substr(metric_start, 1, 10) AS date,
        COALESCE(SUM(messages_sent), 0) AS messages_sent,
        COUNT(DISTINCT CASE
          WHEN messages_sent + replies_sent + edits_made + reactions_emitted + reactions_received + media_sent > 0
          THEN user_id
        END) AS active_users,
        COALESCE(SUM(replies_sent), 0) AS replies_sent,
        COALESCE(SUM(edits_made), 0) AS edits_made,
        COALESCE(SUM(reactions_emitted), 0) AS reactions_emitted,
        COALESCE(SUM(reactions_received), 0) AS reactions_received,
        COALESCE(SUM(media_sent), 0) AS media_sent
      FROM activity_metrics
      WHERE metric_start >= ?
        AND metric_start < ?
      GROUP BY substr(metric_start, 1, 10)
      ORDER BY date ASC
    `)
      .bind(sourceStart, exclusiveEnd)
      .all<DailyMetricRow>(),
  ]);

  const dailyByDate = new Map(dailyRows.results.map((row) => [row.date, row]));
  const sourceDaily = dateRange(sourceStartDay, endDay).map((date) => {
    const row = dailyByDate.get(date);
    return {
      date,
      messages: numberOrZero(row?.messages_sent),
      activeUsers: numberOrZero(row?.active_users),
      replies: numberOrZero(row?.replies_sent),
      totalReactions: numberOrZero(row?.reactions_emitted),
      media: numberOrZero(row?.media_sent),
    };
  });
  const daily30d = sourceDaily.filter((row) => row.date >= chartStartDay);
  const runningSource = sourceDaily.map((row) => ({
    date: row.date,
    messages: row.messages,
    totalReactions: row.totalReactions,
  }));

  const [
    highlightedMemberRows,
    conversationRows,
    threadStarterRows,
    dailyConversationRows,
    movementRows,
    movementDailyRows,
    knownUsers,
    reactedMedia,
    purgeCandidates,
    rhythmRows,
    freshness,
  ] = await Promise.all([
    db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        activity_metrics.user_id,
        users.username,
        users.nickname,
        users.profile_photo_r2_key,
        COALESCE(SUM(activity_metrics.messages_sent), 0) AS messages_sent,
        COALESCE(SUM(activity_metrics.replies_sent), 0) AS replies_sent,
        COALESCE(SUM(activity_metrics.reactions_emitted), 0) AS reactions_emitted,
        COALESCE(SUM(activity_metrics.reactions_received), 0) AS reactions_received
      FROM activity_metrics
      LEFT JOIN users
        ON users.user_id = activity_metrics.user_id
      WHERE activity_metrics.metric_start >= ?
        AND activity_metrics.metric_start < ?
      GROUP BY activity_metrics.user_id, users.username, users.nickname, users.profile_photo_r2_key
    `)
      .bind(visibleStart, exclusiveEnd)
      .all<HighlightedMemberRow>(),
    db.prepare(`
      WITH reply_counts AS (
        SELECT chat_id, root_message_id AS message_id, COUNT(*) AS replies
        FROM message_replies
        WHERE replied_at >= ?
          AND replied_at < ?
        GROUP BY chat_id, root_message_id
      ),
      reaction_counts AS (
        SELECT chat_id, message_id, COUNT(*) AS reactions
        FROM message_reactions
        WHERE is_active = 1
        GROUP BY chat_id, message_id
      )
      SELECT
        messages.chat_id,
        messages.message_id,
        messages.from_user_id,
        users.username,
        users.nickname,
        COALESCE(messages.current_text, messages.current_caption) AS text,
        messages.sent_at,
        COALESCE(reply_counts.replies, 0) AS replies,
        COALESCE(reaction_counts.reactions, 0) AS reactions
      FROM messages
      LEFT JOIN users
        ON users.user_id = messages.from_user_id
      LEFT JOIN reply_counts
        ON reply_counts.chat_id = messages.chat_id
       AND reply_counts.message_id = messages.message_id
      LEFT JOIN reaction_counts
        ON reaction_counts.chat_id = messages.chat_id
       AND reaction_counts.message_id = messages.message_id
      WHERE messages.sent_at >= ?
        AND messages.sent_at < ?
        AND COALESCE(messages.current_text, messages.current_caption) IS NOT NULL
        AND COALESCE(reply_counts.replies, 0) + COALESCE(reaction_counts.reactions, 0) > 0
      ORDER BY (COALESCE(reaction_counts.reactions, 0) * 2 + COALESCE(reply_counts.replies, 0)) DESC,
        messages.sent_at DESC
      LIMIT 5
    `)
      .bind(detailStart, exclusiveEnd, detailStart, exclusiveEnd)
      .all<ConversationRow>(),
    db.prepare(`
      WITH reply_counts AS (
        SELECT chat_id, root_message_id AS message_id, COUNT(*) AS replies
        FROM message_replies
        WHERE replied_at >= ?
          AND replied_at < ?
        GROUP BY chat_id, root_message_id
      ),
      reaction_counts AS (
        SELECT chat_id, message_id, COUNT(*) AS reactions
        FROM message_reactions
        WHERE is_active = 1
          AND first_seen_at >= ?
          AND first_seen_at < ?
        GROUP BY chat_id, message_id
      ),
      scored_threads AS (
        SELECT
          messages.from_user_id AS user_id,
          COALESCE(reply_counts.replies, 0) AS replies,
          COALESCE(reaction_counts.reactions, 0) AS reactions
        FROM messages
        LEFT JOIN reply_counts
          ON reply_counts.chat_id = messages.chat_id
         AND reply_counts.message_id = messages.message_id
        LEFT JOIN reaction_counts
          ON reaction_counts.chat_id = messages.chat_id
         AND reaction_counts.message_id = messages.message_id
        WHERE messages.sent_at >= ?
          AND messages.sent_at < ?
          AND messages.from_user_id IS NOT NULL
          AND messages.reply_to_message_id IS NULL
          AND COALESCE(reply_counts.replies, 0) + COALESCE(reaction_counts.reactions, 0) > 0
      )
      SELECT
        scored_threads.user_id,
        users.username,
        users.nickname,
        users.profile_photo_r2_key,
        COUNT(*) AS threads_started,
        COALESCE(SUM(scored_threads.replies), 0) AS replies,
        COALESCE(SUM(scored_threads.reactions), 0) AS reactions,
        COALESCE(SUM(scored_threads.reactions * 2 + scored_threads.replies + 3), 0) AS score
      FROM scored_threads
      LEFT JOIN users
        ON users.user_id = scored_threads.user_id
      GROUP BY scored_threads.user_id, users.username, users.nickname, users.profile_photo_r2_key
      ORDER BY score DESC, threads_started DESC, scored_threads.user_id ASC
      LIMIT 5
    `)
      .bind(detailStart, exclusiveEnd, detailStart, exclusiveEnd, detailStart, exclusiveEnd)
      .all<ThreadStarterRow>(),
    db.prepare(`
      WITH reply_counts AS (
        SELECT chat_id, root_message_id AS message_id, COUNT(*) AS replies
        FROM message_replies
        WHERE replied_at >= ?
          AND replied_at < ?
        GROUP BY chat_id, root_message_id
      ),
      reaction_counts AS (
        SELECT chat_id, message_id, COUNT(*) AS reactions
        FROM message_reactions
        WHERE is_active = 1
        GROUP BY chat_id, message_id
      ),
      scored AS (
        SELECT
          substr(messages.sent_at, 1, 10) AS date,
          messages.chat_id,
          messages.message_id,
          messages.from_user_id,
          users.username,
          users.nickname,
          COALESCE(messages.current_text, messages.current_caption) AS text,
          messages.sent_at,
          COALESCE(reply_counts.replies, 0) AS replies,
          COALESCE(reaction_counts.reactions, 0) AS reactions,
          ROW_NUMBER() OVER (
            PARTITION BY substr(messages.sent_at, 1, 10)
            ORDER BY (COALESCE(reaction_counts.reactions, 0) * 2 + COALESCE(reply_counts.replies, 0)) DESC,
              messages.sent_at DESC
          ) AS rank
        FROM messages
        LEFT JOIN users
          ON users.user_id = messages.from_user_id
        LEFT JOIN reply_counts
          ON reply_counts.chat_id = messages.chat_id
         AND reply_counts.message_id = messages.message_id
        LEFT JOIN reaction_counts
          ON reaction_counts.chat_id = messages.chat_id
         AND reaction_counts.message_id = messages.message_id
        WHERE messages.sent_at >= ?
          AND messages.sent_at < ?
          AND COALESCE(messages.current_text, messages.current_caption) IS NOT NULL
          AND COALESCE(reply_counts.replies, 0) + COALESCE(reaction_counts.reactions, 0) > 0
      )
      SELECT
        date,
        chat_id,
        message_id,
        from_user_id,
        username,
        nickname,
        text,
        sent_at,
        replies,
        reactions
      FROM scored
      WHERE rank = 1
      ORDER BY date ASC
    `)
      .bind(detailStart, exclusiveEnd, detailStart, exclusiveEnd)
      .all<DailyConversationRow>(),
    db.prepare(`
      SELECT event_type, COUNT(*) AS count
      FROM user_membership_events
      WHERE observed_at >= ?
        AND observed_at < ?
      GROUP BY event_type
    `)
      .bind(visibleStart, exclusiveEnd)
      .all<MovementRow>(),
    db.prepare(`
      SELECT substr(observed_at, 1, 10) AS date, event_type, COUNT(*) AS count
      FROM user_membership_events
      WHERE observed_at >= ?
        AND observed_at < ?
      GROUP BY substr(observed_at, 1, 10), event_type
      ORDER BY date ASC
    `)
      .bind(visibleStart, exclusiveEnd)
      .all<MovementDailyRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM users").first<CountRow>(),
    db.prepare(`
      SELECT COUNT(DISTINCT media_objects.id) AS count
      FROM media_objects
      WHERE media_objects.created_at >= ?
        AND media_objects.created_at < ?
        AND EXISTS (
          SELECT 1
          FROM message_reactions
          WHERE message_reactions.chat_id = media_objects.chat_id
            AND message_reactions.message_id = media_objects.message_id
            AND message_reactions.is_active = 1
          LIMIT 1
        )
    `)
      .bind(visibleStart, exclusiveEnd)
      .first<CountRow>(),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM media_objects
      INNER JOIN messages
        ON messages.chat_id = media_objects.chat_id
       AND messages.message_id = media_objects.message_id
      WHERE messages.sent_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM reaction_events
          WHERE reaction_events.chat_id = media_objects.chat_id
            AND reaction_events.message_id = media_objects.message_id
            AND reaction_events.is_active = 1
          LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1
          FROM message_reactions
          WHERE message_reactions.chat_id = media_objects.chat_id
            AND message_reactions.message_id = media_objects.message_id
            AND message_reactions.is_active = 1
          LIMIT 1
        )
    `)
      .bind(addHours(anchorHour, -7 * 24))
      .first<CountRow>(),
    db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        CAST(strftime('%w', metric_start) AS INTEGER) AS weekday,
        CAST(CAST(strftime('%H', metric_start) AS INTEGER) / 2 AS INTEGER) AS hour_window,
        COALESCE(SUM(messages_sent + reactions_emitted), 0) AS activity
      FROM (
        SELECT
          metric_start,
          COALESCE(SUM(messages_sent), 0) AS messages_sent,
          COALESCE(SUM(reactions_emitted), 0) AS reactions_emitted
        FROM activity_metrics
        WHERE metric_start >= ?
          AND metric_start < ?
        GROUP BY metric_start
      )
      GROUP BY weekday, hour_window
    `)
      .bind(visibleStart, exclusiveEnd)
      .all<RhythmRow>(),
    db.prepare(`
      SELECT
        MAX(received_at) AS latest_event_at,
        MAX(projected_at) AS latest_projected_at,
        COALESCE(SUM(CASE WHEN projected_at IS NULL THEN 1 ELSE 0 END), 0) AS unprojected_raw_events
      FROM raw_events
    `)
      .first<AuditFreshnessRow>(),
  ]);

  const highlightedMembers = highlightedMemberRows.results
    .map((row) => ({
      userId: row.user_id,
      username: row.username,
      nickname: row.nickname,
      profilePhoto: {
        url: profilePhotoUrl(row.user_id, row.profile_photo_r2_key),
      },
      score: Math.round(row.messages_sent + row.replies_sent * 2 + row.reactions_received + row.reactions_emitted * 0.25),
      messages: numberOrZero(row.messages_sent),
      replies: numberOrZero(row.replies_sent),
      reactionsEmitted: numberOrZero(row.reactions_emitted),
      reactionsReceived: numberOrZero(row.reactions_received),
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.userId - right.userId)
    .slice(0, 5);

  const movementByType = new Map(movementRows.results.map((row) => [row.event_type, row.count]));
  const movementDailyByDate = new Map<string, { joins: number; leaves: number }>();
  for (const row of movementDailyRows.results) {
    const previous = movementDailyByDate.get(row.date) ?? { joins: 0, leaves: 0 };
    movementDailyByDate.set(row.date, {
      joins: previous.joins + (row.event_type === "joined" ? numberOrZero(row.count) : 0),
      leaves: previous.leaves + (row.event_type === "left" ? numberOrZero(row.count) : 0),
    });
  }
  const totalJoins = numberOrZero(movementByType.get("joined"));
  const totalLeaves = numberOrZero(movementByType.get("left"));
  let runningKnownUsers = Math.max(0, (knownUsers?.count ?? 0) - totalJoins + totalLeaves);
  const movementDaily = daily30d.map((row) => {
    const movement = movementDailyByDate.get(row.date) ?? { joins: 0, leaves: 0 };
    runningKnownUsers = Math.max(0, runningKnownUsers + movement.joins - movement.leaves);
    return {
      date: row.date,
      joins: movement.joins,
      leaves: movement.leaves,
      knownUsers: runningKnownUsers,
    };
  });
  const rhythmMatrix = Array.from({ length: 7 }, (_, weekday) => ({
    label: WEEKDAY_LABELS[weekday],
    cells: Array.from({ length: 12 }, () => 0),
    total: 0,
  }));
  let maxRhythmActivity = 0;
  for (const row of rhythmRows.results) {
    if (row.weekday >= 0 && row.weekday < rhythmMatrix.length && row.hour_window >= 0 && row.hour_window < 12) {
      rhythmMatrix[row.weekday].cells[row.hour_window] = row.activity;
      rhythmMatrix[row.weekday].total += row.activity;
      maxRhythmActivity = Math.max(maxRhythmActivity, row.activity);
    }
  }

  return {
    anchorHour,
    messageDetailDays,
    pulse24h: {
      messages: currentWindow.messages_sent,
      activeUsers: currentWindow.active_users,
      replies: currentWindow.replies_sent,
      replyRatio: ratio(currentWindow.replies_sent, currentWindow.messages_sent),
      totalReactions: currentWindow.reactions_emitted,
      media: currentWindow.media_sent,
      deltaMessages: currentWindow.messages_sent - previousWindow.messages_sent,
      deltaReactions: currentWindow.reactions_emitted - previousWindow.reactions_emitted,
    },
    daily30d,
    runningAverages30d: runningAverage(runningSource).filter((row) => row.date >= chartStartDay),
    highlightedMembers,
    topConversations: conversationRows.results.map((row) => ({
      chatId: row.chat_id,
      messageId: row.message_id,
      fromUserId: row.from_user_id,
      username: row.username,
      nickname: row.nickname,
      text: row.text,
      sentAt: row.sent_at,
      replies: row.replies,
      reactions: row.reactions,
    })),
    threadStarters: threadStarterRows.results.map((row) => ({
      userId: row.user_id,
      username: row.username,
      nickname: row.nickname,
      profilePhoto: {
        url: profilePhotoUrl(row.user_id, row.profile_photo_r2_key),
      },
      threadsStarted: numberOrZero(row.threads_started),
      replies: numberOrZero(row.replies),
      reactions: numberOrZero(row.reactions),
      score: numberOrZero(row.score),
    })),
    dailyTopConversations: dailyConversationRows.results.map((row) => ({
      date: row.date,
      chatId: row.chat_id,
      messageId: row.message_id,
      fromUserId: row.from_user_id,
      username: row.username,
      nickname: row.nickname,
      text: row.text,
      sentAt: row.sent_at,
      replies: row.replies,
      reactions: row.reactions,
    })),
    rhythm30d: rhythmMatrix.map((row) => ({
      label: row.label,
      cells: maxRhythmActivity > 0
        ? row.cells.map((cell) => Number((cell / maxRhythmActivity).toFixed(2)))
        : row.cells,
      total: row.total,
    })),
    memberMovement: {
      joins: totalJoins,
      leaves: totalLeaves,
      knownUsers: knownUsers?.count ?? 0,
      daily: movementDaily,
    },
    mediaSignal: {
      mediaSent30d: daily30d.reduce((sum, row) => sum + row.media, 0),
      reactedMediaCount: reactedMedia?.count ?? 0,
      purgeCandidateCount: purgeCandidates?.count ?? 0,
    },
    auditFreshness: {
      latestEventAt: freshness?.latest_event_at ?? null,
      latestProjectedAt: freshness?.latest_projected_at ?? null,
      unprojectedRawEvents: numberOrZero(freshness?.unprojected_raw_events),
      latestAggregateHour: latestAggregateHour ?? null,
    },
  };
}
