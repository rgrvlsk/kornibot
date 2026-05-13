import { ACTIVITY_METRICS_CTE } from "../analytics/activity-metrics-source";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type AnchorRow = {
  max_bucket_hour: string | null;
};

type DailyMessageRow = {
  date: string;
  messages_sent: number;
  active_users: number;
};

type ReactionLeaderRow = {
  user_id: number;
  username: string | null;
  nickname: string | null;
  reactions_received: number;
};

type HistogramRow = {
  date: string;
  messages_sent: number;
};

type CurrentUserRow = {
  user_id: number;
  username: string | null;
  nickname: string | null;
};

export async function queryMemberMetrics(
  db: D1DatabaseLike,
  userId: number,
): Promise<{
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
}> {
  const anchor = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT MAX(metric_start) AS max_bucket_hour
      FROM activity_metrics
    `)
    .first<AnchorRow>();
  const endDay = (anchor?.max_bucket_hour ?? new Date().toISOString()).slice(0, 10);

  const dailyMessages = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        substr(metric_start, 1, 10) AS date,
        COALESCE(SUM(messages_sent), 0) AS messages_sent,
        COUNT(DISTINCT CASE WHEN messages_sent > 0 THEN user_id END) AS active_users
      FROM activity_metrics
      WHERE date(metric_start) >= date(?, '-29 days')
        AND date(metric_start) <= date(?)
      GROUP BY substr(metric_start, 1, 10)
      ORDER BY date ASC
    `)
    .bind(endDay, endDay)
    .all<DailyMessageRow>();

  const mostReactionsReceived = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        activity_metrics.user_id,
        users.username,
        users.nickname,
        COALESCE(SUM(activity_metrics.reactions_received), 0) AS reactions_received
      FROM activity_metrics
      LEFT JOIN users
        ON users.user_id = activity_metrics.user_id
      WHERE date(activity_metrics.metric_start) >= date(?, '-29 days')
        AND date(activity_metrics.metric_start) <= date(?)
      GROUP BY activity_metrics.user_id, users.username, users.nickname
      HAVING COALESCE(SUM(activity_metrics.reactions_received), 0) > 0
      ORDER BY reactions_received DESC, activity_metrics.user_id ASC
      LIMIT 10
    `)
    .bind(endDay, endDay)
    .all<ReactionLeaderRow>();

  const personalHistogram = await db.prepare(`
      WITH ${ACTIVITY_METRICS_CTE}
      SELECT
        substr(metric_start, 1, 10) AS date,
        COALESCE(SUM(messages_sent), 0) AS messages_sent
      FROM activity_metrics
      WHERE user_id = ?
        AND date(metric_start) >= date(?, '-29 days')
        AND date(metric_start) <= date(?)
      GROUP BY substr(metric_start, 1, 10)
      ORDER BY date ASC
    `)
    .bind(userId, endDay, endDay)
    .all<HistogramRow>();

  const currentUser = await db.prepare(`
      SELECT user_id, username, nickname
      FROM users
      WHERE user_id = ?
    `)
    .bind(userId)
    .first<CurrentUserRow>();

  return {
    dailyMessages: dailyMessages.results.map((row) => ({
      date: row.date,
      messagesSent: row.messages_sent,
      activeUsers: row.active_users,
    })),
    mostReactionsReceived: mostReactionsReceived.results.map((row) => ({
      userId: row.user_id,
      username: row.username,
      nickname: row.nickname,
      reactionsReceived: row.reactions_received,
    })),
    personalHistogram: personalHistogram.results.map((row) => ({
      date: row.date,
      messagesSent: row.messages_sent,
    })),
    currentUser: currentUser
      ? {
        userId: currentUser.user_id,
        username: currentUser.username,
        nickname: currentUser.nickname,
      }
      : null,
  };
}
