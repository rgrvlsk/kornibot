import type { ReactElement } from "react";
import type { UserProfilePayload } from "../lib/api";

function formatDayLabel(value: string): string {
  return new Intl.DateTimeFormat("ca-ES", {
    weekday: "short",
  }).format(new Date(value)).replace(".", "");
}

function buildBuckets(hourlyMetrics: UserProfilePayload["hourlyMetrics"]): Array<{
  key: string;
  label: string;
  total: number;
  cells: Array<{ key: string; intensity: number }>;
}> {
  const dayMap = new Map<string, {
    total: number;
    cells: Array<{ key: string; intensity: number }>;
  }>();

  for (const metric of hourlyMetrics) {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(metric.bucketHour);
    const date = new Date(isDateOnly ? `${metric.bucketHour}T00:00:00.000Z` : metric.bucketHour);
    const dayKey = isDateOnly ? metric.bucketHour : date.toISOString().slice(0, 10);
    const intensity = metric.messagesSent + metric.repliesSent + metric.reactionsReceived + metric.reactionsEmitted;
    const normalizedIntensity = Math.min(1, intensity / 10);

    if (!dayMap.has(dayKey)) {
      dayMap.set(
        dayKey, {
          total: 0,
          cells: Array.from({ length: 12 }, (_, index) => ({
            key: `${dayKey}-${index}`,
            intensity: 0,
          })),
        },
      );
    }

    const day = dayMap.get(dayKey)!;
    day.total += intensity;
    if (isDateOnly) {
      day.cells = day.cells.map((cell) => ({
        key: cell.key,
        intensity: Math.max(cell.intensity, normalizedIntensity),
      }));
    } else {
      const hourWindow = Math.floor(date.getUTCHours() / 2);
      day.cells[hourWindow] = {
        key: `${dayKey}-${hourWindow}`,
        intensity: Math.max(day.cells[hourWindow].intensity, normalizedIntensity),
      };
    }
  }

  const latestDay = Array.from(dayMap.keys()).sort().at(-1);
  if (!latestDay) {
    return [];
  }

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${latestDay}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });

  return days
    .map((dayKey) => ({
      key: dayKey,
      label: formatDayLabel(dayKey),
      total: dayMap.get(dayKey)?.total ?? 0,
      cells: dayMap.get(dayKey)?.cells ?? Array.from({ length: 12 }, (_, index) => ({
        key: `${dayKey}-${index}`,
        intensity: 0,
      })),
    }));
}

export function ActivityHeatmap(props: {
  hourlyMetrics: UserProfilePayload["hourlyMetrics"];
}): ReactElement {
  const rows = buildBuckets(props.hourlyMetrics);

  return (
    <div className="activity-heatmap">
      <div className="activity-legend">
        <span aria-hidden="true" />
        <div className="activity-time-labels">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
        <span aria-hidden="true" />
      </div>
      <div className="activity-grid">
        {rows.map((row) => (
          <div className="activity-grid-row" key={row.key}>
            <span>{row.label}</span>
            <div className="activity-grid-cells">
              {row.cells.map((cell) => (
                <i
                  key={cell.key}
                  style={{
                    opacity: 0.18 + cell.intensity * 0.82,
                  }}
                />
              ))}
            </div>
            <strong>{row.total}</strong>
          </div>
        ))}
      </div>
      <div className="activity-scale">
        <span>Baixa activitat</span>
        <i />
        <i />
        <i />
        <i />
        <i />
        <span>Alta activitat</span>
      </div>
    </div>
  );
}
