import { describe, expect, it } from "vitest";

import {
  birthdayAgeOnDate,
  birthdayCelebrationDate,
  birthdayPeriodFromDateFieldChange,
  birthdayPeriodFromMonthDays,
  formatMonthDayInput,
  genericCardDemandForDate,
  mondayFirstMonthOffset,
  randomBirthdayWindowColor,
} from "../../src/dashboard/src/pages/birthday-utils";

describe("birthday ui helpers", () => {
  it("uses Feb 28 for Feb 29 birthdays in non-leap years", () => {
    expect(birthdayCelebrationDate({ month: 2, day: 29 }, 2025)).toBe("2025-02-28");
    expect(birthdayCelebrationDate({ month: 2, day: 29 }, 2024)).toBe("2024-02-29");
  });

  it("only returns age when the birth year exists", () => {
    expect(birthdayAgeOnDate({ month: 5, day: 31, year: 1990 }, "2026-05-31")).toBe(36);
    expect(birthdayAgeOnDate({ month: 5, day: 31, year: null }, "2026-05-31")).toBeNull();
  });

  it("counts generic demand only for AI-card birthdays without unused member cards", () => {
    expect(genericCardDemandForDate([
      { userId: 100, wantsAiCard: true, hasUnusedMemberCard: false },
      { userId: 200, wantsAiCard: true, hasUnusedMemberCard: true },
      { userId: 300, wantsAiCard: false, hasUnusedMemberCard: false },
    ])).toBe(1);
  });

  it("returns Monday-first offsets for month grids", () => {
    expect(mondayFirstMonthOffset(2026, 5)).toBe(0);
    expect(mondayFirstMonthOffset(2026, 4)).toBe(4);
    expect(mondayFirstMonthOffset(2026, 10)).toBe(6);
  });

  it("formats concrete dates as day/month inputs without exposing the year", () => {
    expect(formatMonthDayInput("2026-12-20")).toBe("20/12");
    expect(formatMonthDayInput("2027-01-10")).toBe("10/01");
  });

  it("resolves flipped day/month periods through the new year", () => {
    expect(birthdayPeriodFromMonthDays("2026-06-01", "20/12", "10/01")).toEqual({
      startsOn: "2026-12-20",
      endsOn: "2027-01-10",
    });
    expect(birthdayPeriodFromMonthDays("2026-06-01", "08/02", "12/02")).toEqual({
      startsOn: "2026-02-08",
      endsOn: "2026-02-12",
    });
  });

  it("builds editable month/day fields without exposing years", () => {
    expect(birthdayPeriodFromDateFieldChange({
      endsOn: "2027-01-10",
      startsOn: "2026-12-20",
    }, "end", "10/01")).toEqual({
      startsOn: "2026-12-20",
      endsOn: "2027-01-10",
    });

    expect(birthdayPeriodFromDateFieldChange({
      endsOn: "2026-02-18",
      startsOn: "2026-02-06",
    }, "start", "20/12")).toEqual({
      startsOn: "2026-12-20",
      endsOn: "2027-02-18",
    });

    expect(birthdayPeriodFromDateFieldChange({
      endsOn: "2026-12-30",
      startsOn: "2026-12-23",
    }, "end", "08/01")).toEqual({
      startsOn: "2026-12-23",
      endsOn: "2027-01-08",
    });
  });

  it("assigns birthday window colors from a constrained palette", () => {
    expect(new Set(Array.from({ length: 20 }, (_, index) => randomBirthdayWindowColor(index))).size).toBeGreaterThan(1);
    expect(randomBirthdayWindowColor(0)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
