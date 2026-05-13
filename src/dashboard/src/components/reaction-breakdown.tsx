import type { ReactElement } from "react";
import type { UserProfilePayload } from "../lib/api";

function getLatestSnapshot(monthlySnapshots: UserProfilePayload["monthlySnapshots"]) {
  return monthlySnapshots[0] ?? null;
}

function sumHourly(
  hourlyMetrics: UserProfilePayload["hourlyMetrics"],
  key: keyof UserProfilePayload["hourlyMetrics"][number],
): number {
  return hourlyMetrics.reduce((total, row) => total + Number(row[key]), 0);
}

function formatDeltaPercent(value: number, average: number | null | undefined): string {
  if (!average || average <= 0) {
    return "vs grup pendent";
  }

  const percent = Math.round(((value - average) / average) * 100);
  return `${percent > 0 ? "+" : ""}${percent}% vs grup`;
}

function formatAverageLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || value <= 0) {
    return "ø grup pendent";
  }

  return `ø grup ${value.toLocaleString("ca-ES", { maximumSignificantDigits: 2 })}`;
}

export function ReactionBreakdown(props: {
  monthlySnapshots: UserProfilePayload["monthlySnapshots"];
  hourlyMetrics: UserProfilePayload["hourlyMetrics"];
  peerAverages?: UserProfilePayload["peerAverages"];
}): ReactElement {
  const latest = getLatestSnapshot(props.monthlySnapshots);
  const emitted = latest?.reactionsEmitted ?? sumHourly(props.hourlyMetrics, "reactionsEmitted");
  const received = latest?.reactionsReceived ?? sumHourly(props.hourlyMetrics, "reactionsReceived");
  const messages = latest?.messagesSent ?? sumHourly(props.hourlyMetrics, "messagesSent");
  const average = latest?.averageReactionsPerMessage ?? (messages > 0 ? received / messages : 0);
  const rows = [
    {
      label: "emeses",
      value: emitted,
      average: props.peerAverages?.reactionsEmitted,
      tone: "blue",
      display: String(emitted),
    },
    {
      label: "rebudes",
      value: received,
      average: props.peerAverages?.reactionsReceived,
      tone: "lime",
      display: String(received),
    },
    {
      label: "mitjana",
      value: average,
      average: props.peerAverages?.averageReactionsPerMessage,
      tone: "amber",
      display: average.toFixed(1),
    },
  ];

  if (!latest && props.hourlyMetrics.length === 0) {
    return (
      <div className="empty-state">
        <strong>Sense reaccions</strong>
        <p>Encara no hi ha prou activitat agregada per aquest perfil.</p>
      </div>
    );
  }

  return (
    <div className="reaction-breakdown">
      <span className="reaction-balance">{received - emitted > 0 ? "+" : ""}{received - emitted} balanç</span>
      {rows.map((row) => {
        const rowMax = Math.max(row.value, row.average ?? 0, 1) * 1.18;
        const ownWidth = `${Math.max(4, Math.min(100, (row.value / rowMax) * 100))}%`;
        const averageLeft = row.average && row.average > 0 ? `${Math.min(100, (row.average / rowMax) * 100)}%` : null;
        return (
          <div className={`reaction-insight tone-${row.tone}`} key={row.label}>
            <span>{row.label}</span>
            <strong>{row.display}</strong>
            <div className="reaction-track">
              <i style={{ width: ownWidth }} />
              {averageLeft ? <b style={{ left: averageLeft }} /> : null}
              <span
                className="reaction-average-label"
                style={averageLeft ? { left: averageLeft } : undefined}
              >
                {formatAverageLabel(row.average)}
              </span>
            </div>
            <small>{formatDeltaPercent(row.value, row.average)}</small>
          </div>
        );
      })}
    </div>
  );
}
