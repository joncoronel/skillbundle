/**
 * Regression test for the chart date anchor (components/skill-chart-shared.ts).
 *
 * A bare `new Date("YYYY-MM-DD")` is parsed as UTC midnight, which negative-offset
 * zones (e.g. US Pacific) format as the PREVIOUS calendar day — the off-by-one
 * the charts shipped with. `toDate` pins the day to UTC noon so local-timezone
 * formatters land on the right day. These assertions lock that in regardless of
 * the machine's own timezone.
 */
import { describe, expect, test } from "vitest";
import { toDate } from "../components/skill-chart-shared";

describe("toDate — chart date anchor", () => {
  test("anchors the day at UTC noon, not midnight", () => {
    const d = toDate("2026-06-17");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(5); // June, 0-indexed
    expect(d.getUTCDate()).toBe(17);
    // The whole point: noon (12), not the footgun midnight (0).
    expect(d.getUTCHours()).toBe(12);
  });

  test("renders the correct calendar day in US Pacific", () => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/Los_Angeles",
    });
    // Bare string = UTC midnight → a day early in Pacific (the original bug).
    expect(fmt.format(new Date("2026-06-17"))).toBe("Jun 16");
    // toDate = UTC noon → the right day.
    expect(fmt.format(toDate("2026-06-17"))).toBe("Jun 17");
  });
});
