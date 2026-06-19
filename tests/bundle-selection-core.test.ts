/**
 * Unit tests for planBulkAdd (lib/bundle-selection-core.ts).
 *
 * Pure function — no jotai store or DOM needed. Covers the cap/dedup rule that
 * backs the source-page "Add all" control: dedup within the incoming list,
 * dedup against the current selection, clamp to the cap, and the counts the
 * caller turns into a toast. The `cap` argument is passed explicitly so the
 * tests stay small instead of building 100-element fixtures.
 */
import { test, expect, describe } from "vitest";
import {
  planBulkAdd,
  type SelectedSkill,
} from "../lib/bundle-selection-core";

/** Compact skill factory: `s("a")` → owner/repo:a, `s("a", "x/y")` → x/y:a. */
function s(skillId: string, source = "owner/repo"): SelectedSkill {
  return { source, skillId, name: skillId };
}

const keys = (list: SelectedSkill[]) =>
  list.map((x) => `${x.source}/${x.skillId}`);

describe("planBulkAdd", () => {
  test("adds everything when the selection is empty and under cap", () => {
    const plan = planBulkAdd([], [s("a"), s("b"), s("c")], 10);
    expect(plan.added).toBe(3);
    expect(plan.alreadyPresent).toBe(0);
    expect(plan.skippedForCap).toBe(0);
    expect(keys(plan.additions)).toEqual([
      "owner/repo/a",
      "owner/repo/b",
      "owner/repo/c",
    ]);
  });

  test("preserves input order", () => {
    const plan = planBulkAdd([], [s("c"), s("a"), s("b")], 10);
    expect(keys(plan.additions)).toEqual([
      "owner/repo/c",
      "owner/repo/a",
      "owner/repo/b",
    ]);
  });

  test("skips skills already in the current selection", () => {
    const plan = planBulkAdd([s("a")], [s("a"), s("b")], 10);
    expect(plan.added).toBe(1);
    expect(plan.alreadyPresent).toBe(1);
    expect(plan.skippedForCap).toBe(0);
    expect(keys(plan.additions)).toEqual(["owner/repo/b"]);
  });

  test("dedupes duplicates within the incoming list", () => {
    const plan = planBulkAdd([], [s("a"), s("a"), s("b")], 10);
    expect(plan.added).toBe(2);
    expect(plan.alreadyPresent).toBe(1); // the second "a" is a dup
    expect(keys(plan.additions)).toEqual(["owner/repo/a", "owner/repo/b"]);
  });

  test("disambiguates skills with the same id from different sources", () => {
    const plan = planBulkAdd([], [s("a", "x/y"), s("a", "p/q")], 10);
    expect(plan.added).toBe(2);
    expect(keys(plan.additions)).toEqual(["x/y/a", "p/q/a"]);
  });

  test("clamps to the cap and reports the overflow as skippedForCap", () => {
    const plan = planBulkAdd([s("a")], [s("b"), s("c"), s("d")], 2);
    expect(plan.added).toBe(1); // only one slot left under cap=2
    expect(plan.skippedForCap).toBe(2);
    expect(plan.alreadyPresent).toBe(0);
    expect(keys(plan.additions)).toEqual(["owner/repo/b"]);
  });

  test("adds nothing when the selection is already at cap", () => {
    const plan = planBulkAdd([s("a"), s("b")], [s("c"), s("d")], 2);
    expect(plan.added).toBe(0);
    expect(plan.skippedForCap).toBe(2);
    expect(plan.additions).toEqual([]);
  });

  test("adds nothing when every incoming skill is already present", () => {
    const plan = planBulkAdd([s("a"), s("b")], [s("a"), s("b")], 10);
    expect(plan.added).toBe(0);
    expect(plan.alreadyPresent).toBe(2);
    expect(plan.skippedForCap).toBe(0);
    expect(plan.additions).toEqual([]);
  });

  test("counts already-present before cap when both apply", () => {
    // "a" is already in; cap=2 leaves one slot, taken by "b"; "c" overflows.
    const plan = planBulkAdd([s("a")], [s("a"), s("b"), s("c")], 2);
    expect(plan.added).toBe(1);
    expect(plan.alreadyPresent).toBe(1);
    expect(plan.skippedForCap).toBe(1);
    expect(keys(plan.additions)).toEqual(["owner/repo/b"]);
  });
});
