export type BirthdayDate = {
  month: number;
  day: number;
  year?: number | null;
};

export type BirthdayDemandMember = {
  userId: number;
  wantsAiCard: boolean;
  hasUnusedMemberCard: boolean;
};

const WINDOW_COLOR_PALETTE = [
  "#7ab7ff",
  "#ff7f8b",
  "#b8f05a",
  "#f0c328",
  "#c7a7ff",
  "#70d6ff",
  "#ffad2f",
  "#d6a761",
] as const;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function birthdayCelebrationDate(birthday: BirthdayDate, year: number): string {
  const day = birthday.month === 2 && birthday.day === 29 && !isLeapYear(year)
    ? 28
    : birthday.day;

  return `${year}-${pad2(birthday.month)}-${pad2(day)}`;
}

export function birthdayAgeOnDate(birthday: BirthdayDate, celebrationDate: string): number | null {
  if (!birthday.year) {
    return null;
  }

  const year = Number(celebrationDate.slice(0, 4));
  return Number.isSafeInteger(year) ? year - birthday.year : null;
}

export function genericCardDemandForDate(members: BirthdayDemandMember[]): number {
  return members.filter((member) => member.wantsAiCard && !member.hasUnusedMemberCard).length;
}

export function mondayFirstMonthOffset(year: number, monthIndex: number): number {
  return (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
}

function dateFromKey(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date must use YYYY-MM-DD");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateKey(date) !== value) {
    throw new Error("date must use YYYY-MM-DD");
  }

  return date;
}

function dateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function addDaysToDateKey(value: string, days: number): string {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

export function formatMonthDayInput(value: string): string {
  const date = dateFromKey(value);
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}`;
}

function parseMonthDayInput(value: string): { month: number; day: number } {
  const trimmed = value.trim();
  const fullDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const match = fullDate
    ? [fullDate[0], fullDate[3], fullDate[2]]
    : /^(\d{1,2})[./-](\d{1,2})$/.exec(trimmed);
  if (!match) {
    throw new Error("period dates must use DD/MM");
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const maxDay = month === 2 ? 29 : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  if (!Number.isSafeInteger(month) || month < 1 || month > 12 || !Number.isSafeInteger(day) || day < 1 || day > maxDay) {
    throw new Error("period date is not valid");
  }

  return { month, day };
}

export function birthdayPeriodFromMonthDays(anchorDate: string, startsOnInput: string, endsOnInput: string): { startsOn: string; endsOn: string } {
  const anchor = dateFromKey(anchorDate);
  const start = parseMonthDayInput(startsOnInput);
  const end = parseMonthDayInput(endsOnInput);
  const startYear = anchor.getUTCFullYear();
  const endYear = end.month < start.month || (end.month === start.month && end.day < start.day)
    ? startYear + 1
    : startYear;
  const startsOn = `${startYear}-${pad2(start.month)}-${pad2(start.day)}`;
  const endsOn = `${endYear}-${pad2(end.month)}-${pad2(end.day)}`;

  dateFromKey(startsOn);
  dateFromKey(endsOn);

  return { startsOn, endsOn };
}

export function birthdayPeriodFromDateFieldChange(
  current: { startsOn: string; endsOn: string },
  field: "start" | "end",
  value: string,
): { startsOn: string; endsOn: string } {
  const inputFromValue = (nextValue: string): string => /^\d{4}-\d{2}-\d{2}$/.test(nextValue)
    ? formatMonthDayInput(nextValue)
    : nextValue;
  const startsOn = field === "start" ? inputFromValue(value) : formatMonthDayInput(current.startsOn);
  const endsOn = field === "end" ? inputFromValue(value) : formatMonthDayInput(current.endsOn);

  return birthdayPeriodFromMonthDays(current.startsOn, startsOn, endsOn);
}

export function randomBirthdayWindowColor(seed?: number): string {
  if (typeof seed === "number") {
    return WINDOW_COLOR_PALETTE[Math.abs(seed) % WINDOW_COLOR_PALETTE.length];
  }

  return WINDOW_COLOR_PALETTE[Math.floor(Math.random() * WINDOW_COLOR_PALETTE.length)];
}
