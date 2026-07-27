/**
 * Which SKILL.md does a single GitHub-only ADD bind? The decision, reads injected.
 *
 * Sibling of `discoveryPlacement.ts` and the same argument for existing: this ran
 * inline in `resolveGitHubSkillMd` (convex/githubOnly.ts), interleaved with tree
 * fetches and raw downloads, so the only way to drive it was to make GitHub answer
 * in a particular shape mid-add. The ordering rules below have been rewritten twice
 * after review found the hint could outvote the folder rule, and neither version
 * was reachable by a test.
 *
 * The two modules stay separate because they answer different questions. Discovery
 * has a slug skills.sh already assigned and hunts for the file behind it; the add
 * INVENTS the row's permanent identity, so a wrong bind here is unrepairable. See
 * `skillMatch.ts` for why that makes this side strict.
 *
 * ## The order, which is the whole content
 *
 *   1. A folder named exactly like the slug wins outright.
 *   2. Then the path HINT from a pasted URL, if the tree agrees that file exists
 *      and it names itself the slug.
 *   3. Then every candidate in tree order, capped.
 *
 * Step 2 exists only to skip step 3's downloads, and it must never be able to beat
 * step 1 — an earlier version ran before the tree was fetched and could bind a
 * different copy than the folder rule would, which showed up as the confirm card
 * vouching for a file the pipeline never binds. Here that is structural: step 1
 * returns before step 2 is reachable.
 */
import { matchesSkillIdExactly } from "./skillMatch";

/** A candidate's body plus its frontmatter `name`, if it carried one. */
export type SkillMdRead = { contents: string; name: string | null };

/**
 * Reads one candidate. `null` means the fetch failed — distinct from a file with
 * no `name:`, because for the folder match a failed read is not evidence of
 * absence (see `dir_unreadable`).
 */
export type BodyReader = (path: string) => Promise<SkillMdRead | null>;

export type ResolvePick =
  /** Bind this. `matchedBy` is what the caller's alias policy keys on. */
  | {
      status: "found";
      path: string;
      contents: string;
      matchedBy: "dir" | "frontmatter";
    }
  /**
   * The folder rule matched but the file would not download. The tree says it
   * exists, so this is transient CDN trouble and the caller must NOT report the
   * skill as absent.
   */
  | { status: "dir_unreadable"; path: string }
  /** Nothing in the repo claims this slug. */
  | { status: "none" };

/**
 * How many candidates step 3 will download. This runs inside a user-facing action
 * with an admin watching a spinner, so a monorepo with hundreds of SKILL.md files
 * must not turn preview into a multi-minute stall. Past the cap is treated as
 * not-found; steps 1 and 2 cover the conventional layouts regardless.
 */
export const RESOLVE_PASS2_CAP = 50;

/** Step 3 downloads concurrently in waves of this size, exiting on first match. */
export const RESOLVE_WAVE_SIZE = 10;

export async function pickSkillMd({
  skillId,
  candidates,
  byDir,
  pathHint,
  readBody,
  cap = RESOLVE_PASS2_CAP,
  waveSize = RESOLVE_WAVE_SIZE,
}: {
  /** The slug the caller typed, or derived from the pasted URL. */
  skillId: string;
  /** Every SKILL.md in the tree, in tree order (`indexSkillMds`). */
  candidates: readonly string[];
  /** Directory name to path, from `indexSkillMds`. */
  byDir: ReadonlyMap<string, string>;
  /** `parseSkillInput`'s `path`: a file to try before the full scan. */
  pathHint?: string;
  /** The only I/O this function performs. */
  readBody: BodyReader;
  cap?: number;
  waveSize?: number;
}): Promise<ResolvePick> {
  // Step 1. A literal lookup, deliberately: `aliasBindsSameFile` predicts this
  // result the same way, and discovery's pass 1 is the same literal rule.
  const dirMatch = byDir.get(skillId);
  if (dirMatch) {
    const read = await readBody(dirMatch);
    if (read === null) return { status: "dir_unreadable", path: dirMatch };
    return {
      status: "found",
      path: dirMatch,
      contents: read.contents,
      matchedBy: "dir",
    };
  }

  // Step 2. No `byDir` guard needed — step 1 returned if there was a folder match,
  // and `indexSkillMds` never stores an empty path, so reaching here means there
  // wasn't one. The hint can only reorder step 3, never outvote step 1.
  //
  // Worth knowing before relying on it: for any NESTED link the hint's parent
  // segment IS the slug by construction (the parser takes the slug from the path
  // tail and builds the hint from that same tail), and `byDir` is keyed on exactly
  // that segment — so step 1 would already have returned. This fires only for a
  // ROOT-level SKILL.md link in a repo with no folder named like the slug, which is
  // the case that used to pay the whole scan.
  if (pathHint !== undefined && candidates.includes(pathHint)) {
    const read = await readBody(pathHint);
    if (read?.name && matchesSkillIdExactly(read.name, skillId)) {
      return {
        status: "found",
        path: pathHint,
        contents: read.contents,
        matchedBy: "frontmatter",
      };
    }
  }

  // Step 3. Waves for latency, but results are checked in candidate order within a
  // wave, so first-match-wins is identical to a serial scan.
  //
  // Floored at 1: a zero wave would slice an empty batch forever without advancing,
  // and since the loop awaits only settled promises it would never yield — a hang
  // rather than an error. Same guard, same reason, as `planNamePlacements`.
  const step = Math.max(1, Math.floor(waveSize));
  const capped = candidates.slice(0, Math.max(0, Math.floor(cap)));
  for (let i = 0; i < capped.length; i += step) {
    const wave = capped.slice(i, i + step);
    const reads = await Promise.all(wave.map((path) => readBody(path)));
    for (let j = 0; j < wave.length; j++) {
      const read = reads[j];
      if (read?.name && matchesSkillIdExactly(read.name, skillId)) {
        return {
          status: "found",
          path: wave[j],
          contents: read.contents,
          matchedBy: "frontmatter",
        };
      }
    }
  }
  return { status: "none" };
}
