/**
 * Which SKILL.md does each row get? The decision, with the I/O taken out.
 *
 * `discoverSkillMdUrls` (convex/skills.ts) used to hold all of this inline,
 * interleaved with tree fetches, raw downloads and `updateSkillMdUrl` mutations.
 * That made it unreachable by a test: the only way to drive it was to make
 * GitHub's Tree API answer in a particular shape mid-action. The cost of that was
 * not theoretical. Three panel rounds found bugs inside those blocks — a pass-1
 * guard that was a no-op in its own motivating case, a slice-window bug in the
 * exact phase, and a `rejected` set whose entire removal left the suite green.
 *
 * So the rule here: this module decides, `skills.ts` acts. Nothing in this file
 * fetches, writes, or reads the clock. Every function is a pure map from
 * "what we know" to "what should be bound", which is exactly the shape a test can
 * hold still.
 *
 * The three properties worth protecting, all of which have been broken at least
 * once:
 *
 *   1. EXACT ACROSS EVERY CANDIDATE BEFORE ANY LOOSE ONE. Not exact-then-loose
 *      per file. See `planNamePlacements`.
 *   2. A PATH BINDS AT MOST ONCE. Both within a phase and across the waves the
 *      caller drives.
 *   3. A SKILL BINDS AT MOST ONCE, to the first candidate that claims it.
 */
import { matchesSkillId, matchesSkillIdExactly } from "./skillMatch";

/** A row awaiting a file. `docId` is opaque here — this module never writes. */
export type SkillRef = { docId: string; skillId: string };

/** "Bind this row to this repo-relative path." */
export type Placement = { skill: SkillRef; path: string };

/** A candidate SKILL.md whose body has been read and carried a `name:`. */
export type NamedCandidate = { path: string; name: string };

/**
 * Where to look when the repo tree could not be listed (404, 409 too-large, rate
 * limited), in priority order.
 *
 * Guesses rather than searches, so it stays deliberately short: the two
 * conventional skill locations plus a repo-root file. A miss here is not a
 * verdict — the caller falls through to marking the row unfound, and the next
 * sync retries with a tree that may well fetch.
 */
export function probePathsFor(skillId: string): string[] {
  return [
    `skills/${skillId}/SKILL.md`,
    `.claude/skills/${skillId}/SKILL.md`,
    `SKILL.md`,
  ];
}

/**
 * Pass 1: the folder is named exactly like the slug.
 *
 * Decided from the tree alone, without opening anything. A verification step
 * lived here briefly (Jul 2026) and was reverted after `bindAudit.ts` measured
 * it against production: zero confirmable wrong binds in 13,080 rows, against 12
 * healthy binds it would have refused. The lesson it left is recorded at the call
 * site — a SKILL.md's `name` does not reliably identify its owner.
 *
 * `byDir` maps directory name to path and is built by `indexSkillMds`
 * (lib/github.ts), which lets a later entry overwrite an earlier one — so a repo
 * with two folders of the same name resolves by tree order, last wins. That is
 * the documented behaviour, not an accident of this function.
 */
export function planDirPlacements(
  skills: readonly SkillRef[],
  byDir: ReadonlyMap<string, string>,
): Placement[] {
  const binds: Placement[] = [];
  for (const skill of skills) {
    const path = byDir.get(skill.skillId);
    if (path === undefined) continue;
    binds.push({ skill, path });
  }
  return binds;
}

/**
 * Pass 2: match a candidate's frontmatter `name` against the slug.
 *
 * Two phases, and the ORDER BETWEEN THEM IS THE POINT. Every candidate gets its
 * exact chance before any candidate is offered to the loose rule.
 *
 * This was once one loop per path with both rules inside it, which let the loose
 * arm on an early file beat the exact arm on a later one. That is what made this
 * pass disagree with the GitHub-only preview after the preview went exact-only:
 * given `a-sdk/SKILL.md` (name `vercel-ai-sdk`) listed before `z-ai/SKILL.md`
 * (name `vercel-ai`), a preview for slug `vercel-ai` vouches for z-ai while this
 * pass bound a-sdk on the prefix rule. The row then served a file the confirm
 * card never showed. Pinned in tests/discovery-placement.test.ts.
 *
 * ## Called once per wave, and safe to be
 *
 * The caller downloads candidates in waves and calls this after each one with
 * every name read SO FAR, the paths already bound, and whether the last wave has
 * landed. `allNamedRead` gates the loose phase: until the caller says every
 * candidate has been read, only the exact phase may bind, because a later file
 * might still claim a slug exactly.
 *
 * Re-scanning earlier waves' names on each call is intentional and cannot
 * double-bind. A name that failed to match in an earlier call cannot match in a
 * later one — `remaining` only ever shrinks, and the two matchers are pure — so
 * re-offering it is a no-op. That replaces a length-tracked window into the
 * accumulated array, which is where the slice-window bug lived: `slice(-wave.length)`
 * reached back into earlier waves whenever a wave contributed fewer named entries
 * than it had paths.
 */
export function planNamePlacements({
  remaining,
  named,
  usedPaths,
  allNamedRead,
}: {
  /** Rows still unbound, in the order they should get first refusal. */
  remaining: readonly SkillRef[];
  /** Candidates read so far that carried a `name:`, in tree order. */
  named: readonly NamedCandidate[];
  /** Paths already bound — by pass 1, or by an earlier wave of this pass. */
  usedPaths: readonly string[];
  /** True once every candidate has been read. Gates the loose phase. */
  allNamedRead: boolean;
}): Placement[] {
  const takenPaths = new Set(usedPaths);
  const open = new Map(remaining.map((s) => [s.skillId, s]));
  const binds: Placement[] = [];

  const phase = (matches: (name: string, skillId: string) => boolean) => {
    for (const { path, name } of named) {
      if (open.size === 0) return;
      // Property 2. Within a phase this stops one file claiming two rows; across
      // phases it stops the loose rule re-offering a path the exact rule took.
      if (takenPaths.has(path)) continue;
      for (const [skillId, skill] of open) {
        if (!matches(name, skillId)) continue;
        binds.push({ skill, path });
        takenPaths.add(path);
        open.delete(skillId);
        // Property 3: first claim wins, and this path is spent.
        break;
      }
    }
  };

  phase(matchesSkillIdExactly);
  if (allNamedRead) phase(matchesSkillId);
  return binds;
}
