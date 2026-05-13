import { describe, expect, it } from "vitest";

import {
  activityTone,
  foldSearchText,
  formatRelativeActivity,
  memberStatusLabel,
} from "../../src/dashboard/src/pages/members-utils";

describe("members ui helpers", () => {
  it("normalizes Catalan names for member search", () => {
    expect(foldSearchText("Héctor Saàz")).toBe("hector saaz");
  });

  it("normalizes compatibility latin letters and numbers for member search", () => {
    expect(foldSearchText("🄽🄾🄴🄼🄸 １２３ ①②③")).toBe("noemi 123 123");
  });

  it("uses readable labels instead of raw unknown membership state", () => {
    expect(memberStatusLabel(null)).toBe("Membre");
    expect(memberStatusLabel("member")).toBe("Membre");
  });

  it("formats activity recency and tone from configurable thresholds", () => {
    const now = new Date("2026-05-05T12:00:00.000Z");

    expect(formatRelativeActivity("2026-05-05T11:56:00.000Z", now)).toBe("fa 4 min");
    expect(formatRelativeActivity(null, now)).toBe("sense activitat");
    expect(activityTone("2026-05-05T11:56:00.000Z", { goodHours: 24, warmHours: 168 }, now)).toBe("good");
    expect(activityTone("2026-05-03T12:00:00.000Z", { goodHours: 24, warmHours: 168 }, now)).toBe("warm");
    expect(activityTone(null, { goodHours: 24, warmHours: 168 }, now)).toBe("danger");
  });
});
