export type BirthdayDate = {
  month: number;
  day: number;
  year?: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function birthdayCelebrationDate(birthday: BirthdayDate, year: number): string {
  const day = birthday.month === 2 && birthday.day === 29 && !isLeapYear(year)
    ? 28
    : birthday.day;

  return `${year}-${pad2(birthday.month)}-${pad2(day)}`;
}

export function localBarcelonaParts(input: Date): {
  date: string;
  year: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(input);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = value("month");
  const day = value("day");

  return {
    date: `${year}-${month}-${day}`,
    year,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

export function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

export function isDateWithinWindow(date: string, startsOn: string, endsOn: string): boolean {
  return date >= startsOn && date <= endsOn;
}
