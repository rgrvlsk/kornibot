import type { ReactElement } from "react";
import type { UserProfilePayload } from "../lib/api";

type ComparisonMetric = {
  label: string;
  current: number;
  previous: number;
  tone: "blue" | "lime" | "amber";
};

function formatDeltaPercent(current: number, previous: number): string {
  if (previous <= 0) {
    return current > 0 ? "+100%" : "0%";
  }

  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta > 0 ? "+" : ""}${delta}%`;
}

function sumHourly(
  rows: UserProfilePayload["hourlyMetrics"],
  key: keyof UserProfilePayload["hourlyMetrics"][number],
): number {
  return rows.reduce((total, row) => total + Number(row[key]), 0);
}

export function MonthlyComparison(props: {
  monthlySnapshots: UserProfilePayload["monthlySnapshots"];
  hourlyMetrics: UserProfilePayload["hourlyMetrics"];
}): ReactElement {
  const sortedMetrics = [...props.hourlyMetrics].sort((left, right) => Date.parse(right.bucketHour) - Date.parse(left.bucketHour));
  const anchor = sortedMetrics[0] ? Date.parse(sortedMetrics[0].bucketHour) : Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = anchor - 7 * dayMs;
  const previousStart = anchor - 14 * dayMs;
  const currentWeek = sortedMetrics.filter((row) => Date.parse(row.bucketHour) > currentStart);
  const previousWeek = sortedMetrics.filter((row) => {
    const time = Date.parse(row.bucketHour);
    return time <= currentStart && time > previousStart;
  });

  if (currentWeek.length === 0) {
    return (
      <div className="empty-state">
        <strong>Comparativa no disponible</strong>
        <p>Cal activitat horaria recent per comparar setmanes.</p>
      </div>
    );
  }

  const currentMessages = sumHourly(currentWeek, "messagesSent");
  const previousMessages = sumHourly(previousWeek, "messagesSent");
  const currentReactions = sumHourly(currentWeek, "reactionsReceived");
  const previousReactions = sumHourly(previousWeek, "reactionsReceived");

  const rows: ComparisonMetric[] = [
    {
      label: "Missatges",
      current: currentMessages,
      previous: previousMessages,
      tone: "blue",
    },
    {
      label: "Respostes",
      current: sumHourly(currentWeek, "repliesSent"),
      previous: sumHourly(previousWeek, "repliesSent"),
      tone: "blue",
    },
    {
      label: "Reaccions",
      current: currentReactions,
      previous: previousReactions,
      tone: "lime",
    },
    {
      label: "Mitjana",
      current: currentMessages > 0 ? currentReactions / currentMessages : 0,
      previous: previousMessages > 0 ? previousReactions / previousMessages : 0,
      tone: "amber",
    },
  ];

  return (
    <div className="comparison-panel">
      <div className="comparison-tabs" aria-label="Mode de comparativa">
        <button className="is-active" type="button">Setmana</button>
        <button disabled={props.monthlySnapshots.length <= 2} type="button">
          Mes
          <span>pendent &gt;2 mesos</span>
        </button>
      </div>
      <div className="comparison-legend">
        <span><i /> Aquesta setmana</span>
        <span><i /> Setmana anterior</span>
      </div>
      <div className="comparison-bars">
        {rows.map((row) => (
          <div className={`comparison-bar tone-${row.tone}`} key={row.label}>
            <span>{row.label}</span>
            <p>
              <strong>{row.current.toLocaleString("ca-ES", { maximumFractionDigits: 1 })}</strong>
              <em>{formatDeltaPercent(row.current, row.previous)}</em>
            </p>
            <div>
              <i style={{ height: `${Math.max(8, Math.min(46, (row.current / Math.max(row.current, row.previous, 1)) * 46))}px` }} />
              <b style={{ height: `${Math.max(8, Math.min(46, (row.previous / Math.max(row.current, row.previous, 1)) * 46))}px` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
