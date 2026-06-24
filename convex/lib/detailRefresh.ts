// Shared "refresh one skill from the v1 detail endpoint" operation, used by both
// the reconcile job (stale healthy off-board rows, daily) and the curated-only
// refresh (never-on-leaderboard healthy rows, weekly). The two jobs own their
// own scan + continuation strategies, but the per-skill body — fetch detail
// under retry, upsert with a pinned day, and classify the three failure modes —
// is identical, so it lives here once. Returns a discriminated outcome; the
// caller decides what to do with a rate-limit (each reschedules its own job).

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  getSkillDetail as v1GetSkillDetail,
  SkillsApiNotFoundError,
  SkillsApiRateLimitError,
  withTransientRetry,
} from "./skillsApi";

export type RefreshOutcome =
  | { kind: "refreshed" }
  | { kind: "gone" } // 404 — gone upstream; leave unstamped for the 30-day delist
  | { kind: "rateLimited"; retryAfterSeconds: number }
  | { kind: "error" }; // transient/unexpected — logged, skip this one

export async function refreshSkillFromDetail(
  ctx: ActionCtx,
  skill: { source: string; skillId: string; name: string; isDuplicate: boolean },
  opts: { day: string; leaderboard: string },
): Promise<RefreshOutcome> {
  try {
    const detail = await withTransientRetry(() =>
      v1GetSkillDetail(skill.source, skill.skillId),
    );
    // Fast-path upsert (existing row): updates installs, writes a day-pinned
    // snapshot, stamps lastSeenInApi. `leaderboard` is set-on-insert only, so the
    // value is ignored on the existing-row patch these jobs always take.
    await ctx.runMutation(internal.skills.upsertSkillsBatch, {
      skills: [
        {
          source: skill.source,
          skillId: skill.skillId,
          name: skill.name,
          installs: detail.installs,
          isDuplicate: skill.isDuplicate,
        },
      ],
      leaderboard: opts.leaderboard,
      day: opts.day,
    });
    return { kind: "refreshed" };
  } catch (err) {
    if (err instanceof SkillsApiNotFoundError) return { kind: "gone" };
    if (err instanceof SkillsApiRateLimitError) {
      return { kind: "rateLimited", retryAfterSeconds: err.retryAfterSeconds };
    }
    console.error(
      `refreshSkillFromDetail failed for ${skill.source}/${skill.skillId}:`,
      err,
    );
    return { kind: "error" };
  }
}
