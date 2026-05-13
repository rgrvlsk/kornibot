export type ActivityTone = "good" | "warm" | "danger";

export type MemberActivityThresholds = {
  goodHours: number;
  warmHours: number;
};

const STATUS_LABELS: Record<string, string> = {
  administrator: "Membre",
  creator: "Membre",
  kicked: "Fora",
  left: "Fora",
  member: "Membre",
  restricted: "Limitat",
};

const MONTHS = [
  "gen.",
  "febr.",
  "març",
  "abr.",
  "maig",
  "juny",
  "jul.",
  "ag.",
  "set.",
  "oct.",
  "nov.",
  "des.",
];

export function foldSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("ca-ES")
    .trim();
}

export function memberStatusLabel(status: string | null): string {
  if (!status) {
    return "Membre";
  }

  return STATUS_LABELS[status] ?? status;
}

export function memberStatusTone(status: string | null): "good" | "neutral" | "danger" {
  if (!status || status === "member" || status === "administrator" || status === "creator") {
    return "good";
  }

  if (status === "left" || status === "kicked") {
    return "danger";
  }

  return "neutral";
}

export function activityTone(
  lastSeenAt: string | null,
  thresholds: MemberActivityThresholds,
  now = new Date(),
): ActivityTone {
  if (!lastSeenAt) {
    return "danger";
  }

  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) {
    return "danger";
  }

  const diffHours = (now.getTime() - lastSeenMs) / (60 * 60 * 1000);
  if (diffHours <= thresholds.goodHours) {
    return "good";
  }

  if (diffHours <= thresholds.warmHours) {
    return "warm";
  }

  return "danger";
}

export function formatRelativeActivity(lastSeenAt: string | null, now = new Date()): string {
  if (!lastSeenAt) {
    return "sense activitat";
  }

  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) {
    return "sense activitat";
  }

  const diffMinutes = Math.max(0, Math.floor((now.getTime() - lastSeenMs) / (60 * 1000)));
  if (diffMinutes < 1) {
    return "ara";
  }

  if (diffMinutes < 60) {
    return `fa ${diffMinutes} min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `fa ${diffHours} h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `fa ${diffDays} ${diffDays === 1 ? "dia" : "dies"}`;
}

export function formatJoinedAt(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  const month = MONTHS[date.getMonth()] ?? "";
  return `Unit el ${date.getDate()} ${month} ${date.getFullYear()}`;
}

export function initialsFor(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }

  return words.slice(0, 2).map((word) => word[0]?.toLocaleUpperCase("ca-ES") ?? "").join("");
}
