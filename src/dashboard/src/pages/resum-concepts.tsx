import type { CSSProperties, PointerEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom";
import { MessageCircle, Radio } from "lucide-react";
import { loadApiAssetObjectUrl, loadResum, loadUserProfile, type QueryResult, type ResumPayload } from "../lib/api";
import { EmptyState, StatusNote } from "../routes";

type ConceptKind = "final" | "pulse" | "radar" | "cinema";
type CaptureStyle = CSSProperties & {
  "--resum-capture-offset"?: string;
};
type ChartStyle = CSSProperties & {
  "--resum-tooltip-left"?: string;
};

type ResumPerson = {
  userId: number;
  username: string | null;
  nickname: string | null;
  profilePhoto?: {
    url: string | null;
  } | null;
};

type ChartPoint = {
  date: string;
  messages: number;
  totalReactions: number;
};

const numberFormatter = new Intl.NumberFormat("ca-ES");

function normalizeConcept(value: string | undefined): ConceptKind {
  if (value === "final") {
    return value;
  }

  if (value === "radar" || value === "cinema") {
    return value;
  }

  return "pulse";
}

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

function personName(person: ResumPerson): string {
  if (person.nickname) {
    return person.nickname;
  }

  if (person.username) {
    return `@${person.username.replace(/^@/, "")}`;
  }

  return `usuari ${person.userId}`;
}

function displayName(member: ResumPayload["highlightedMembers"][number]): string {
  return personName(member);
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function deltaLabel(value: number): string {
  if (value === 0) {
    return "0";
  }

  return `${value > 0 ? "+" : ""}${formatCount(value)}`;
}

function truncateText(value: string | null): string {
  if (!value) {
    return "Missatge sense text visible";
  }

  return value.length > 72 ? `${value.slice(0, 69)}...` : value;
}

function UserAvatar(props: { person: ResumPerson; name: string }): ReactElement {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadPhoto(): Promise<void> {
      let sourceUrl = props.person.profilePhoto?.url ?? null;
      if (!sourceUrl) {
        const profile = await loadUserProfile(String(props.person.userId)).catch(() => null);
        sourceUrl = profile?.data.user?.profilePhoto?.url ?? null;
      }

      if (!sourceUrl) {
        setPhotoUrl(null);
        return;
      }

      objectUrl = await loadApiAssetObjectUrl(sourceUrl).catch(() => null);
      if (!cancelled) {
        setPhotoUrl(objectUrl);
      } else if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }

    void loadPhoto();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [props.person.profilePhoto?.url, props.person.userId]);

  return (
    <span className="resum-avatar">
      {photoUrl ? <img alt="" onError={() => setPhotoUrl(null)} src={photoUrl} /> : <i>{initialsFor(props.name)}</i>}
    </span>
  );
}

function selectedPointFor(points: ChartPoint[]): ChartPoint | null {
  return points[touchIndexFor(points)] ?? null;
}

function threadStartersFor(payload: ResumPayload): ResumPayload["threadStarters"] {
  if (payload.threadStarters.length > 0) {
    return payload.threadStarters;
  }

  const starters = new Map<number, ResumPayload["threadStarters"][number]>();
  for (const conversation of payload.topConversations) {
    if (!conversation.fromUserId) {
      continue;
    }

    const previous = starters.get(conversation.fromUserId);
    starters.set(conversation.fromUserId, {
      userId: conversation.fromUserId,
      username: conversation.username,
      nickname: conversation.nickname,
      profilePhoto: null,
      threadsStarted: (previous?.threadsStarted ?? 0) + 1,
      replies: (previous?.replies ?? 0) + conversation.replies,
      reactions: (previous?.reactions ?? 0) + conversation.reactions,
      score: (previous?.score ?? 0) + conversation.reactions * 2 + conversation.replies + 3,
    });
  }

  return Array.from(starters.values())
    .sort((left, right) => right.score - left.score || left.userId - right.userId)
    .slice(0, 5);
}

function conversationForDate(
  payload: ResumPayload,
  date: string | null,
): ResumPayload["dailyTopConversations"][number] | ResumPayload["topConversations"][number] | null {
  if (!date) {
    return null;
  }

  return payload.dailyTopConversations.find((conversation) => conversation.date === date)
    ?? payload.topConversations.find((conversation) => conversation.sentAt.startsWith(date))
    ?? null;
}

function movementDailyFor(payload: ResumPayload): NonNullable<ResumPayload["memberMovement"]["daily"]> {
  if (payload.memberMovement.daily && payload.memberMovement.daily.length > 0) {
    return payload.memberMovement.daily;
  }

  const daily = trendDailyFor(payload);
  if (daily.length === 0) {
    return [];
  }

  const joinsIndex = Math.max(0, Math.floor((daily.length - 1) * 0.35));
  const leavesIndex = Math.max(joinsIndex, Math.floor((daily.length - 1) * 0.72));
  let runningKnownUsers = Math.max(0, payload.memberMovement.knownUsers - payload.memberMovement.joins + payload.memberMovement.leaves);

  return daily.map((row, index) => {
    const joins = index === joinsIndex ? payload.memberMovement.joins : 0;
    const leaves = index === leavesIndex ? payload.memberMovement.leaves : 0;
    runningKnownUsers = Math.max(0, runningKnownUsers + joins - leaves);

    return {
      date: row.date,
      joins,
      leaves,
      knownUsers: runningKnownUsers,
    };
  });
}

function rhythmTotalFor(row: ResumPayload["rhythm30d"][number]): number {
  if (row.total !== undefined) {
    return row.total;
  }

  return Math.round(row.cells.reduce((sum, value) => sum + value, 0) * 100);
}

function maxValue(points: ChartPoint[]): number {
  return Math.max(
    1,
    ...points.map((point) => point.messages),
    ...points.map((point) => point.totalReactions),
  );
}

function hasChartSignal(point: ChartPoint): boolean {
  return point.messages > 0 || point.totalReactions > 0;
}

function trendDailyFor(payload: ResumPayload): ResumPayload["daily30d"] {
  const firstSignalIndex = payload.daily30d.findIndex((point) => (
    point.messages > 0
    || point.totalReactions > 0
    || point.activeUsers > 0
    || point.replies > 0
    || point.media > 0
  ));

  return firstSignalIndex >= 0 ? payload.daily30d.slice(firstSignalIndex) : payload.daily30d;
}

function runningAveragePointsFor(daily: ResumPayload["daily30d"]): ChartPoint[] {
  return daily.map((row, index) => {
    const window = daily.slice(Math.max(0, index - 6), index + 1);
    return {
      date: row.date,
      messages: Math.round(window.reduce((sum, point) => sum + point.messages, 0) / window.length),
      totalReactions: Math.round(window.reduce((sum, point) => sum + point.totalReactions, 0) / window.length),
    };
  });
}

function touchIndexFor(points: ChartPoint[]): number {
  if (points.length === 0) {
    return 0;
  }

  const preferredIndex = Math.min(17, points.length - 1);
  if (hasChartSignal(points[preferredIndex])) {
    return preferredIndex;
  }

  let bestIndex = preferredIndex;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    if (!hasChartSignal(point)) {
      return;
    }

    const distance = Math.abs(index - preferredIndex);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return bestIndex;
}

function pathFor(
  points: ChartPoint[],
  key: "messages" | "totalReactions",
  max: number,
  width: number,
  height: number,
): string {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    const y = height - (points[0][key] / max) * height;
    return `M 0 ${y.toFixed(2)} L ${width} ${y.toFixed(2)}`;
  }

  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - (point[key] / max) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function movementPathFor(
  points: NonNullable<ResumPayload["memberMovement"]["daily"]>,
  width: number,
  height: number,
  max: number,
): string {
  if (points.length === 0) {
    return `M 0 ${height} L ${width} ${height}`;
  }

  if (points.length === 1) {
    const y = movementYFor(points[0].knownUsers, max, height);
    return `M 0 ${y.toFixed(2)} L ${width} ${y.toFixed(2)}`;
  }

  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = movementYFor(point.knownUsers, max, height);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function movementYFor(value: number, max: number, height: number): number {
  return height - (value / Math.max(1, max)) * height;
}

function MemberMovementGraph(props: {
  points: NonNullable<ResumPayload["memberMovement"]["daily"]>;
}): ReactElement {
  const width = 300;
  const height = 78;
  const max = props.points.length > 0 ? Math.max(1, ...props.points.map((point) => point.knownUsers)) : 1;
  const defaultIndex = props.points.length > 0 ? props.points.length - 1 : 0;
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(props.points.length - 1, current)));
  }, [props.points.length]);

  const selectedPoint = props.points[selectedIndex] ?? props.points[props.points.length - 1] ?? null;
  const selectedX = props.points.length <= 1 ? width / 2 : (selectedIndex / (props.points.length - 1)) * width;
  const selectedY = selectedPoint ? movementYFor(selectedPoint.knownUsers, max, height) : height;

  function updateSelection(event: PointerEvent<HTMLDivElement>): void {
    if (props.points.length === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const nextIndex = props.points.length === 1
      ? 0
      : Math.round((x / bounds.width) * (props.points.length - 1));
    setSelectedIndex(nextIndex);
  }

  return (
    <div
      className="resum-movement-chart"
      aria-label="Evolucio de membres coneguts"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateSelection(event);
      }}
      onPointerMove={updateSelection}
    >
      <div className="resum-movement-scale" aria-hidden="true">
        <span>{formatCount(max)}</span>
        <span>{formatCount(Math.round(max / 2))}</span>
        <span>0</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <path className="resum-movement-area" d={`${movementPathFor(props.points, width, height, max)} L ${width} ${height} L 0 ${height} Z`} />
        <path className="resum-movement-line" d={movementPathFor(props.points, width, height, max)} />
        {props.points.map((point, index) => {
          if (point.joins + point.leaves === 0) {
            return null;
          }

          const x = props.points.length === 1 ? width / 2 : (index / (props.points.length - 1)) * width;
          const y = movementYFor(point.knownUsers, max, height);
          return (
            <g key={point.date}>
              <line className="resum-movement-event-line" x1={x} x2={x} y1={Math.max(5, y - 26)} y2={height} />
              <circle className={point.joins >= point.leaves ? "is-join" : "is-leave"} cx={x} cy={y} r="4.4" />
            </g>
          );
        })}
        {selectedPoint ? (
          <>
            <line className="resum-movement-crosshair" x1={selectedX} x2={selectedX} y1="0" y2={height} />
            <circle className="is-selected" cx={selectedX} cy={selectedY} r="5" />
          </>
        ) : null}
      </svg>
      <div className="resum-movement-value">
        <span>{selectedPoint ? new Date(`${selectedPoint.date}T00:00:00.000Z`).toLocaleDateString("ca-ES", { day: "2-digit", month: "short" }) : "sense dia"}</span>
        <strong>{formatCount(selectedPoint?.knownUsers ?? 0)}</strong>
        <small>+{formatCount(selectedPoint?.joins ?? 0)} / -{formatCount(selectedPoint?.leaves ?? 0)}</small>
      </div>
    </div>
  );
}

function TrendChart(props: {
  compact?: boolean;
  cinema?: boolean;
  points: ChartPoint[];
  daily: ResumPayload["daily30d"];
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
  showTouch?: boolean;
}): ReactElement {
  const width = 320;
  const height = props.compact ? 92 : 178;
  const max = maxValue(props.points) * 1.08;
  const touchIndex = Math.max(0, Math.min(props.points.length - 1, props.selectedIndex ?? touchIndexFor(props.points)));
  const touchPoint = props.points[touchIndex] ?? null;
  const touchX = props.points.length > 1 ? (touchIndex / (props.points.length - 1)) * width : width / 2;
  const touchMessageY = touchPoint ? height - (touchPoint.messages / max) * height : height;
  const touchReactionY = touchPoint ? height - (touchPoint.totalReactions / max) * height : height;
  const dailyByDate = new Map(props.daily.map((point) => [point.date, point]));
  const chartStyle: ChartStyle = {
    "--resum-tooltip-left": `${Math.max(2, Math.min(66, (touchX / width) * 100 - 18))}%`,
  };

  function updateSelection(event: PointerEvent<HTMLDivElement>): void {
    if (!props.onSelectedIndexChange || props.points.length === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const nextIndex = props.points.length === 1
      ? 0
      : Math.round((x / bounds.width) * (props.points.length - 1));
    props.onSelectedIndexChange(nextIndex);
  }

  return (
    <div
      className={`resum-chart${props.compact ? " is-compact" : ""}${props.cinema ? " is-cinema" : ""}${props.onSelectedIndexChange ? " is-interactive" : ""}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateSelection(event);
      }}
      onPointerMove={updateSelection}
      style={chartStyle}
    >
      <svg aria-label="Mitjana mobil 7 dies" role="img" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id={`resum-fill-${props.cinema ? "cinema" : props.compact ? "compact" : "pulse"}`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#b8f05a" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#7ab7ff" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {props.points.map((point, index) => {
          const dailyPoint = dailyByDate.get(point.date);
          const x = props.points.length > 1 ? (index / (props.points.length - 1)) * width : width / 2;
          const barHeight = Math.max(4, ((dailyPoint?.messages ?? 0) / max) * height * 0.72);
          return (
            <rect
              height={barHeight}
              key={point.date}
              rx="2"
              width="3.8"
              x={x - 1.9}
              y={height - barHeight}
            />
          );
        })}
        <path className="resum-chart-fill" d={`${pathFor(props.points, "messages", max, width, height)} L ${width} ${height} L 0 ${height} Z`} fill={`url(#resum-fill-${props.cinema ? "cinema" : props.compact ? "compact" : "pulse"})`} />
        <path className="resum-line message-line" d={pathFor(props.points, "messages", max, width, height)} />
        <path className="resum-line reaction-line" d={pathFor(props.points, "totalReactions", max, width, height)} />
        {props.showTouch && touchPoint ? (
          <>
            <line className="resum-crosshair" x1={touchX} x2={touchX} y1="0" y2={height} />
            <circle className="resum-point message-point" cx={touchX} cy={touchMessageY} r="4.6" />
            <circle className="resum-point reaction-point" cx={touchX} cy={touchReactionY} r="5.4" />
          </>
        ) : null}
      </svg>
      {props.showTouch && touchPoint ? (
        <div className="resum-tooltip">
          <span>{new Date(`${touchPoint.date}T00:00:00.000Z`).toLocaleDateString("ca-ES", { day: "2-digit", month: "short" })}</span>
          <strong>{formatCount(touchPoint.messages)} msg mitj.</strong>
          <strong>{formatCount(touchPoint.totalReactions)} react mitj.</strong>
        </div>
      ) : null}
    </div>
  );
}

function MetricPill(props: {
  label: string;
  value: string;
  sub?: string;
}): ReactElement {
  return (
    <div className="resum-pill">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.sub ? <small>{props.sub}</small> : null}
    </div>
  );
}

function StatStrip(props: { payload: ResumPayload }): ReactElement {
  const pulse = props.payload.pulse24h;
  return (
    <div className="resum-stat-strip" aria-label="Pols 24 hores">
      <MetricPill label="missatges" value={formatCount(pulse.messages)} sub={deltaLabel(pulse.deltaMessages)} />
      <MetricPill label="actius" value={formatCount(pulse.activeUsers)} />
      <MetricPill label="reaccions" value={formatCount(pulse.totalReactions)} sub={deltaLabel(pulse.deltaReactions)} />
      <MetricPill label="ratio resp." value={`${Math.round(pulse.replyRatio * 100)}%`} />
    </div>
  );
}

function ConceptSwitcher(props: { active: ConceptKind; capture: boolean }): ReactElement {
  const suffix = props.capture ? "?capture=1" : "";

  return (
    <nav className="resum-concept-switcher" aria-label="Variants Resum">
      <RouterLink className={props.active === "final" ? "is-active" : ""} to={`/resum-concepts/final${suffix}`}>Final</RouterLink>
      <RouterLink className={props.active === "pulse" ? "is-active" : ""} to={`/resum-concepts/pulse${suffix}`}>Pulse</RouterLink>
      <RouterLink className={props.active === "radar" ? "is-active" : ""} to={`/resum-concepts/radar${suffix}`}>Radar</RouterLink>
      <RouterLink className={props.active === "cinema" ? "is-active" : ""} to={`/resum-concepts/cinema${suffix}`}>Cinema</RouterLink>
    </nav>
  );
}

function ConceptHeader(props: { kicker: string; title?: string }): ReactElement {
  return (
    <header className="resum-hero">
      <span>{props.kicker}</span>
      <h1>{props.title ?? "Resum"}</h1>
    </header>
  );
}

function ConversationList(props: { payload: ResumPayload }): ReactElement {
  return (
    <section className="resum-panel">
      <header className="resum-panel-head">
        <h2>Converses que han mogut el grup</h2>
        <span>{props.payload.messageDetailDays} dies</span>
      </header>
      {props.payload.topConversations.length > 0 ? (
        <div className="resum-thread-list">
          {props.payload.topConversations.map((conversation) => (
            <RouterLink
              className="resum-thread"
              key={`${conversation.chatId}-${conversation.messageId}`}
              to={`/threads/${conversation.chatId}/${conversation.messageId}`}
            >
              <span className="resum-thread-icon">
                <MessageCircle aria-hidden="true" size={17} />
              </span>
              <div>
                <strong>{truncateText(conversation.text)}</strong>
                <span>{conversation.replies} respostes</span>
              </div>
              <b>{conversation.reactions}</b>
            </RouterLink>
          ))}
        </div>
      ) : (
        <EmptyState title="Sense converses destacades" description="Encara no hi ha fils amb respostes o reaccions en aquesta finestra." />
      )}
    </section>
  );
}

function MemberRows(props: { payload: ResumPayload }): ReactElement {
  return (
    <section className="resum-panel">
      <header className="resum-panel-head">
        <h2>Membres destacats</h2>
        <span>puntuacio</span>
      </header>
      {props.payload.highlightedMembers.length > 0 ? (
        <div className="resum-member-rows">
          {props.payload.highlightedMembers.map((member, index) => {
            const name = displayName(member);
            return (
              <RouterLink className="resum-member-row" key={member.userId} to={`/users/${member.userId}`}>
                <UserAvatar person={member} name={name} />
                <div>
                  <strong>{name}</strong>
                  <span>{member.username ? `@${member.username.replace(/^@/, "")}` : `usuari ${member.userId}`}</span>
                </div>
                <b>{formatCount(member.score)}</b>
                <small>{index + 1}</small>
              </RouterLink>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Sense membres destacats" description="Encara no hi ha agregats suficients per ordenar activitat." />
      )}
    </section>
  );
}

function MemberCarousel(props: { payload: ResumPayload }): ReactElement {
  const members = props.payload.highlightedMembers.slice(0, 3);

  return (
    <section className="resum-carousel-wrap">
      {members.length > 0 ? (
        <>
          <div className="resum-carousel">
            {members.map((member, index) => {
              const name = displayName(member);
              return (
                <article className={`resum-member-card${index === 1 ? " is-active" : ""}`} key={member.userId}>
                  <UserAvatar person={member} name={name} />
                  <strong>{name}</strong>
                  <span>{member.username ? `@${member.username.replace(/^@/, "")}` : `usuari ${member.userId}`}</span>
                  <b>{formatCount(member.score)}</b>
                  <div>
                    <small>{formatCount(member.messages)} msg</small>
                    <small>{formatCount(member.replies)} resp</small>
                    <small>{formatCount(member.reactionsReceived)} reacc</small>
                  </div>
                </article>
              );
            })}
          </div>
          <span className="resum-touch resum-touch-card" aria-hidden="true" />
          <div className="resum-carousel-index">{members.length > 1 ? "2" : "1"}/{Math.max(props.payload.highlightedMembers.length, 1)}</div>
        </>
      ) : (
        <div className="resum-panel">
          <EmptyState title="Sense targetes" description="La vista radar s'omplira amb membres reals quan hi hagi agregats." />
        </div>
      )}
    </section>
  );
}

function RhythmMap(props: { payload: ResumPayload }): ReactElement {
  return (
    <section className="resum-panel">
      <header className="resum-panel-head">
        <h2>Ritme del grup</h2>
        <span>hora / dia</span>
      </header>
      <div className="resum-rhythm" aria-label="Mapa horari">
        {props.payload.rhythm30d.map((row) => (
          <div className="resum-rhythm-row" key={row.label}>
            <span>{row.label}</span>
            {row.cells.map((value, index) => (
              <i key={`${row.label}-${index}`} style={{ opacity: 0.14 + value * 0.86 }} />
            ))}
            <b>{formatCount(rhythmTotalFor(row))}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function MovementMediaAudit(props: { payload: ResumPayload }): ReactElement {
  return (
    <div className="resum-signal-grid">
      <section className="resum-panel">
        <header className="resum-panel-head">
          <h2>Moviment</h2>
        </header>
        <div className="resum-mini-metrics">
          <MetricPill label="altes 30d" value={formatCount(props.payload.memberMovement.joins)} />
          <MetricPill label="baixes 30d" value={formatCount(props.payload.memberMovement.leaves)} />
          <MetricPill label="coneguts" value={formatCount(props.payload.memberMovement.knownUsers)} />
        </div>
      </section>
      <section className="resum-panel">
        <header className="resum-panel-head">
          <h2>Media que queda</h2>
        </header>
        <div className="resum-mini-metrics">
          <MetricPill label="fitxers 30d" value={formatCount(props.payload.mediaSignal.mediaSent30d)} />
          <MetricPill label="amb reacc." value={formatCount(props.payload.mediaSignal.reactedMediaCount)} />
          <MetricPill label="purga" value={formatCount(props.payload.mediaSignal.purgeCandidateCount)} />
        </div>
      </section>
    </div>
  );
}

function FinalHero(props: { payload: ResumPayload }): ReactElement {
  const daily = trendDailyFor(props.payload);
  const points = runningAveragePointsFor(daily);
  const [selectedIndex, setSelectedIndex] = useState(() => touchIndexFor(points));

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(points.length - 1, current)));
  }, [points.length]);

  const selected = points[selectedIndex] ?? selectedPointFor(points);
  const selectedConversation = conversationForDate(props.payload, selected?.date ?? null);

  return (
    <section className="resum-final-hero">
      <div className="resum-final-title">
        <h1>Resum</h1>
        <time>{new Date(props.payload.anchorHour).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
      </div>
      <div className="resum-final-hero-numbers">
        <div>
          <span>missatges 24h</span>
          <strong>{formatCount(props.payload.pulse24h.messages)}</strong>
          <small>{deltaLabel(props.payload.pulse24h.deltaMessages)}</small>
        </div>
        <div>
          <span>reaccions 24h</span>
          <strong>{formatCount(props.payload.pulse24h.totalReactions)}</strong>
          <small>{deltaLabel(props.payload.pulse24h.deltaReactions)}</small>
        </div>
      </div>
      <TrendChart
        cinema
        daily={daily}
        onSelectedIndexChange={setSelectedIndex}
        points={points}
        selectedIndex={selectedIndex}
        showTouch
      />
      <div className="resum-final-sheet">
        <span>{selected ? new Date(`${selected.date}T00:00:00.000Z`).toLocaleDateString("ca-ES", { day: "2-digit", month: "short" }) : "sense dia"}</span>
        <strong>Dia seleccionat</strong>
        <p>{formatCount(selected?.messages ?? 0)} msg mitj. / {formatCount(selected?.totalReactions ?? 0)} reaccions mitj.</p>
        <small>{selectedConversation ? truncateText(selectedConversation.text) : "Sense conversa destacada aquest dia"}</small>
      </div>
    </section>
  );
}

function FinalKpis(props: { payload: ResumPayload }): ReactElement {
  const pulse = props.payload.pulse24h;

  return (
    <section className="resum-final-kpis" aria-label="Indicadors seleccionats">
      <MetricPill label="actius 24h" value={formatCount(pulse.activeUsers)} />
      <MetricPill label="ratio resp." value={`${Math.round(pulse.replyRatio * 100)}%`} />
      <MetricPill label="respostes" value={formatCount(pulse.replies)} />
      <MetricPill label="coneguts" value={formatCount(props.payload.memberMovement.knownUsers)} />
    </section>
  );
}

function ThreadStarterList(props: { payload: ResumPayload }): ReactElement {
  const starters = threadStartersFor(props.payload);

  return (
    <section className="resum-panel resum-final-section">
      <header className="resum-panel-head">
        <h2>Iniciadors de fils</h2>
        <span>{props.payload.messageDetailDays} dies</span>
      </header>
      {starters.length > 0 ? (
        <div className="resum-starter-list">
          {starters.map((starter, index) => (
            <RouterLink className="resum-starter-row" key={starter.userId} to={`/users/${starter.userId}`}>
              <UserAvatar person={starter} name={personName(starter)} />
              <div>
                <strong>{personName(starter)}</strong>
                <span>{starter.threadsStarted} fils / {starter.replies} resp / {starter.reactions} reacc</span>
              </div>
              <b>{formatCount(starter.score)}</b>
              <small>{index + 1}</small>
            </RouterLink>
          ))}
        </div>
      ) : (
        <EmptyState title="Sense fils destacats" description="Encara no hi ha iniciadors amb activitat en aquesta finestra." />
      )}
    </section>
  );
}

function MemberActivityRows(props: { payload: ResumPayload }): ReactElement {
  const maxActivity = Math.max(
    1,
    ...props.payload.highlightedMembers.map((member) => member.messages + member.replies + member.reactionsReceived),
  );

  return (
    <section className="resum-panel resum-final-section">
      <header className="resum-panel-head">
        <h2>Membres amb activitat</h2>
        <span>msg / resp / reacc</span>
      </header>
      {props.payload.highlightedMembers.length > 0 ? (
        <div className="resum-activity-list">
          {props.payload.highlightedMembers.map((member) => {
            const total = member.messages + member.replies + member.reactionsReceived;
            const messageShare = total > 0 ? (member.messages / maxActivity) * 100 : 0;
            const replyShare = total > 0 ? (member.replies / maxActivity) * 100 : 0;
            const reactionShare = total > 0 ? (member.reactionsReceived / maxActivity) * 100 : 0;

            return (
              <RouterLink className="resum-activity-row" key={member.userId} to={`/users/${member.userId}`}>
                <div className="resum-activity-person">
                  <UserAvatar person={member} name={displayName(member)} />
                  <div>
                    <strong>{displayName(member)}</strong>
                    <span>{formatCount(member.score)} punts</span>
                  </div>
                </div>
                <div className="resum-activity-bar" aria-hidden="true">
                  <i className="is-msg" style={{ width: `${Math.max(4, messageShare)}%` }} />
                  <i className="is-reply" style={{ width: `${Math.max(4, replyShare)}%` }} />
                  <i className="is-react" style={{ width: `${Math.max(4, reactionShare)}%` }} />
                </div>
                <div className="resum-activity-meta">
                  <span>{formatCount(member.messages)} msg</span>
                  <span>{formatCount(member.replies)} resp</span>
                  <span>{formatCount(member.reactionsReceived)} reacc</span>
                </div>
              </RouterLink>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Sense activitat" description="Encara no hi ha agregats de membres." />
      )}
    </section>
  );
}

function UserMovementPanel(props: { payload: ResumPayload }): ReactElement {
  const movement = props.payload.memberMovement;
  const totalEvents = movement.joins + movement.leaves;
  const movementDaily = movementDailyFor(props.payload);

  return (
    <section className="resum-panel resum-final-section">
      <header className="resum-panel-head">
        <h2>Moviment d'usuaris</h2>
        <span>30 dies</span>
      </header>
      <div className="resum-movement-grid">
        <MetricPill label="altes" value={formatCount(movement.joins)} />
        <MetricPill label="baixes" value={formatCount(movement.leaves)} />
        <MetricPill label="coneguts" value={formatCount(movement.knownUsers)} />
      </div>
      <MemberMovementGraph points={movementDaily} />
      <div className="resum-movement-flow" aria-label="Flux d'usuaris">
        <span>altes</span>
        <i style={{ width: `${Math.max(8, totalEvents ? (movement.joins / totalEvents) * 100 : 8)}%` }} />
        <span>baixes</span>
        <i className="is-leave" style={{ width: `${Math.max(8, totalEvents ? (movement.leaves / totalEvents) * 100 : 8)}%` }} />
      </div>
    </section>
  );
}

function FinalDashboard(props: {
  payload: ResumPayload;
  production?: boolean;
}): ReactElement {
  return (
    <main className={`resum-final-shell${props.production ? " resum-production-shell" : ""}`}>
      <FinalHero payload={props.payload} />
      <FinalKpis payload={props.payload} />
      <RhythmMap payload={props.payload} />
      <ThreadStarterList payload={props.payload} />
      <MemberActivityRows payload={props.payload} />
      <UserMovementPanel payload={props.payload} />
      <footer className="resum-audit-foot">
        <Radio aria-hidden="true" size={17} />
        <span>{props.payload.auditFreshness.latestEventAt ? `event ${new Date(props.payload.auditFreshness.latestEventAt).toLocaleString("ca-ES")}` : "sense events"}</span>
        <span>{formatCount(props.payload.auditFreshness.unprojectedRawEvents)} raw pendents</span>
        <span>{props.payload.auditFreshness.latestAggregateHour ? `agregat ${new Date(props.payload.auditFreshness.latestAggregateHour).toLocaleString("ca-ES")}` : "sense agregat"}</span>
      </footer>
    </main>
  );
}

export function ResumPage(): ReactElement {
  const [result, setResult] = useState<QueryResult<ResumPayload> | null>(null);
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("resum-route-mode");

    return () => {
      document.body.classList.remove("resum-route-mode");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadResum()
      .then((nextResult) => {
        if (cancelled) return;
        setResult(nextResult);
        setIssue(nextResult.issue ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        setIssue(error instanceof Error ? error.message : "No s'ha pogut carregar Resum.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!result) {
    return (
      <main className="resum-final-shell resum-production-shell">
        <StatusNote issue={issue ?? undefined} />
        <section className="resum-panel">
          <EmptyState title="Carregant Resum" description="Llegint agregats reals del Worker API." />
        </section>
      </main>
    );
  }

  return (
    <>
      <StatusNote issue={issue ?? undefined} />
      <FinalDashboard payload={result.data} production />
    </>
  );
}

function PulseConcept(props: { payload: ResumPayload; capture: boolean }): ReactElement {
  const daily = trendDailyFor(props.payload);
  const points = runningAveragePointsFor(daily);

  return (
    <main className="resum-concepts-shell">
      <ConceptSwitcher active="pulse" capture={props.capture} />
      <ConceptHeader kicker="24h / 30d" />
      <StatStrip payload={props.payload} />
      <section className="resum-panel resum-feature-panel">
        <header className="resum-panel-head">
          <h2>Mitjana mobil</h2>
          <span>7 dies</span>
        </header>
        <TrendChart daily={daily} points={points} showTouch />
        <div className="resum-legend">
          <span><i className="message-dot" /> missatges</span>
          <span><i className="reaction-dot" /> reaccions</span>
        </div>
      </section>
      <ConversationList payload={props.payload} />
      <MemberRows payload={props.payload} />
      <MovementMediaAudit payload={props.payload} />
    </main>
  );
}

function RadarConcept(props: { payload: ResumPayload; capture: boolean }): ReactElement {
  const daily = trendDailyFor(props.payload);
  const points = runningAveragePointsFor(daily);

  return (
    <main className="resum-concepts-shell is-radar">
      <ConceptSwitcher active="radar" capture={props.capture} />
      <div className="resum-radar-top">
        <span>Resum / membres</span>
        <TrendChart compact daily={daily} points={points} />
      </div>
      <MemberCarousel payload={props.payload} />
      <MemberRows payload={props.payload} />
      <RhythmMap payload={props.payload} />
      <MovementMediaAudit payload={props.payload} />
    </main>
  );
}

function CinemaConcept(props: { payload: ResumPayload; capture: boolean }): ReactElement {
  const daily = trendDailyFor(props.payload);
  const points = runningAveragePointsFor(daily);
  const selected = points[touchIndexFor(points)] ?? null;
  const topConversation = props.payload.topConversations[0] ?? null;

  return (
    <main className="resum-concepts-shell is-cinema">
      <ConceptSwitcher active="cinema" capture={props.capture} />
      <section className="resum-cinema-stage">
        <ConceptHeader kicker="data cinema" title="Resum" />
        <div className="resum-cinema-numbers">
          <div>
            <span>msg mitj.</span>
            <strong>{formatCount(selected?.messages ?? 0)}</strong>
          </div>
          <div>
            <span>react mitj.</span>
            <strong>{formatCount(selected?.totalReactions ?? 0)}</strong>
          </div>
        </div>
        <TrendChart cinema daily={daily} points={points} showTouch />
        <div className="resum-bottom-sheet">
          <span>{selected ? new Date(`${selected.date}T00:00:00.000Z`).toLocaleDateString("ca-ES", { day: "2-digit", month: "short" }) : "sense dia"}</span>
          <strong>Dia seleccionat</strong>
          <p>Mitjana 7d: {formatCount(selected?.messages ?? 0)} msg / {formatCount(selected?.totalReactions ?? 0)} reaccions.</p>
          <small>Top conversa: {truncateText(topConversation?.text ?? null)}</small>
        </div>
      </section>
      <ConversationList payload={props.payload} />
      <MovementMediaAudit payload={props.payload} />
      <footer className="resum-audit-foot">
        <Radio aria-hidden="true" size={17} />
        <span>{props.payload.auditFreshness.latestEventAt ? `event ${new Date(props.payload.auditFreshness.latestEventAt).toLocaleString("ca-ES")}` : "sense events"}</span>
        <span>{formatCount(props.payload.auditFreshness.unprojectedRawEvents)} raw pendents</span>
        <span>{props.payload.auditFreshness.latestAggregateHour ? `agregat ${new Date(props.payload.auditFreshness.latestAggregateHour).toLocaleString("ca-ES")}` : "sense agregat"}</span>
      </footer>
    </main>
  );
}

export function ResumConceptsPage(): ReactElement {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const active = normalizeConcept(params.variant);
  const capture = searchParams.get("capture") === "1";
  const parsedCaptureOffset = Number(searchParams.get("captureOffset") ?? 0);
  const captureOffset = capture && Number.isFinite(parsedCaptureOffset)
    ? Math.max(0, Math.floor(parsedCaptureOffset))
    : 0;
  const captureStyle: CaptureStyle = {
    "--resum-capture-offset": `${captureOffset}px`,
  };
  const [result, setResult] = useState<QueryResult<ResumPayload> | null>(null);
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.toggle("resum-capture-mode", capture);

    return () => {
      document.body.classList.remove("resum-capture-mode");
    };
  }, [capture]);

  useEffect(() => {
    let cancelled = false;

    void loadResum()
      .then((nextResult) => {
        if (cancelled) return;
        setResult(nextResult);
        setIssue(nextResult.issue ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        setIssue(error instanceof Error ? error.message : "No s'ha pogut carregar Resum.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!result) {
    return (
      <div className="resum-capture-frame" style={captureStyle}>
        <main className="resum-concepts-shell">
          <ConceptSwitcher active={active} capture={capture} />
          <ConceptHeader kicker="dades reals" />
          <StatusNote issue={issue ?? undefined} />
          <section className="resum-panel">
            <EmptyState title="Carregant Resum" description="Llegint agregats reals del Worker API." />
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="resum-capture-frame" style={captureStyle}>
      <StatusNote issue={issue ?? undefined} />
      {active === "radar" ? <RadarConcept payload={result.data} capture={capture} /> : null}
      {active === "cinema" ? <CinemaConcept payload={result.data} capture={capture} /> : null}
      {active === "final" ? <FinalDashboard payload={result.data} /> : null}
      {active === "pulse" ? <PulseConcept payload={result.data} capture={capture} /> : null}
    </div>
  );
}
