/**
 * The one condition vocabulary, shared by the Convex read layer and every
 * surface that renders it.
 *
 * This module is deliberately dependency-free (no React, no icons, no Convex)
 * for the same reason `lib/bundle-limits.ts` is: `convex/skillVersions.ts`
 * imports it to RANK rows server-side, and the dashboard and register import it
 * to render them. A second copy is how the dashboard came to show a green
 * all-clear over a delisted dependency that the bundle page was calling
 * "Needs attention" — the ranking lived on the client and the server never knew
 * about half of it.
 *
 * DESIGN.md "Status light and condition vocabulary" fixes this ordering; change
 * it there and here together.
 */

/**
 * Row condition, in consequence order.
 *
 * The first three are things that are WRONG (the bundle may not install, or may
 * not be safe). The next two are things that MOVED. Steady is the rest, and on
 * a healthy bundle it is every row.
 *
 * `delisted` and `fetch-error` are STATES, not events: nothing records when a
 * skill was delisted, and unlike a change they do not stop being true because
 * you read about them. Everything downstream has to treat them accordingly —
 * see `isFault`.
 */
export type Condition =
  | "audit"
  | "delisted"
  | "fetch-error"
  | "description"
  | "content"
  | "steady";

export const CONDITION_RANK: Record<Condition, number> = {
  audit: 5,
  delisted: 4,
  "fetch-error": 3,
  description: 2,
  content: 1,
  steady: 0,
};

/**
 * The three sections the register groups into, and the three the dashboard's
 * status light reads from. Same taxonomy on purpose: the summary line and the
 * structure underneath it must not be two different vocabularies.
 *
 * One section per CONDITION was the obvious alternative and it is worse — six
 * headers for a set that rarely fills three of them.
 */
export type GroupKey = "attention" | "changed" | "steady";

export const GROUP_OF: Record<Condition, GroupKey> = {
  audit: "attention",
  delisted: "attention",
  "fetch-error": "attention",
  description: "changed",
  content: "changed",
  steady: "steady",
};

export const GROUP_ORDER: GroupKey[] = ["attention", "changed", "steady"];

/** The kinds a version/audit event can take. A subset of `Condition`. */
export type ChangeKind = "audit" | "description" | "content";

/**
 * True for conditions with no timestamp and no read-state.
 *
 * A fault cannot be marked read: "I have seen that this is delisted" does not
 * make it listed again, so clearing it would be the product forgetting a
 * standing problem. Callers must keep faults out of anything baseline-relative
 * and must not render `timeAgo` for them — we do not know when it happened.
 */
export function isFault(condition: Condition): boolean {
  return condition === "delisted" || condition === "fetch-error";
}

/**
 * Resolve a row's condition from the skill's current state plus whatever event
 * the archive reported for it.
 *
 * An audit regression outranks a fault because an unsafe skill that still
 * installs is worse than a missing one that cannot hurt you.
 */
export function resolveCondition(
  skill: { isDelisted?: boolean; hasContentFetchError?: boolean },
  kind: ChangeKind | undefined,
): Condition {
  if (kind === "audit") return "audit";
  if (skill.isDelisted) return "delisted";
  if (skill.hasContentFetchError) return "fetch-error";
  if (kind === "description") return "description";
  if (kind === "content") return "content";
  return "steady";
}
