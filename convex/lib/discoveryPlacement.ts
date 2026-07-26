/**
 * Which SKILL.md does each row get? The whole decision, with only the reads
 * injected.
 *
 * `discoverSkillMdUrls` (convex/skills.ts) used to hold all of this inline,
 * interleaved with tree fetches, raw downloads and `updateSkillMdUrl` mutations,
 * so the only way to drive it was to make GitHub's Tree API answer in a
 * particular shape mid-action. The cost of that was not theoretical: three panel
 * rounds found bugs in those blocks, and one of them — a `rejected` set — could be
 * deleted outright with the suite still green.
 *
 * The rule: this module decides, `skills.ts` acts. Nothing here fetches, writes,
 * or reads the clock. `planNamePlacements` is async only because it needs file
 * bodies, and it gets them through a `NameReader` the caller supplies — so a test
 * hands it a lookup table and observes both the placements AND how many batches it
 * asked for.
 *
 * ## The properties, all of which have broken at least once
 *
 *   1. EXACT ACROSS EVERY CANDIDATE BEFORE ANY LOOSE ONE. Not exact-then-loose per
 *      file, and not per batch either. See `planNamePlacements`.
 *   2. A PATH BINDS AT MOST ONCE, within a phase and across batches.
 *   3. A SKILL BINDS AT MOST ONCE, to the first candidate that claims it.
 *
 * Discovery's looseness and the reverted pass-1 name check are the same subject
 * from two other angles; both are recorded in docs/skill-lifecycle.md, "Discovery:
 * which SKILL.md a row gets", together with the production measurements behind
 * them. Deliberately not restated here: those numbers were re-stamped by hand
 * across several files once already, and every extra copy is another place for them
 * to drift.
 */
import { matchesSkillId, matchesSkillIdExactly } from "./skillMatch";

/** A row awaiting a file. `docId` is opaque here — this module never writes. */
export type SkillRef = { docId: string; skillId: string };

/** "Bind this row to this repo-relative path." */
export type Placement = { skill: SkillRef; path: string };

/** A candidate SKILL.md whose body was read and carried a `name:`. */
export type NamedCandidate = { path: string; name: string };

/**
 * Reads a batch of candidate paths.
 *
 * Returns one slot per input path: the parsed name, or `null` when the file could
 * not be fetched or carried no frontmatter `name:`. Those two are deliberately the
 * same answer here — neither is evidence about any row, so both simply take the
 * candidate out of consideration.
 */
export type NameReader = (
  paths: readonly string[],
) => Promise<readonly (NamedCandidate | null)[]>;

/**
 * How many candidate bodies `planNamePlacements` reads concurrently.
 *
 * Pass 2 only — pass 1 decides from the tree and fetches nothing. (An earlier
 * pass-1 verification step did fetch per folder-matched skill; it was reverted,
 * and the constant's docstring went on describing it for a while. See
 * docs/skill-lifecycle.md.)
 */
export const DISCOVERY_WAVE_SIZE = 10;

/** What a slug may look like before it is spliced into a raw-content path. */
const SAFE_SLUG = /^[A-Za-z0-9._-]+$/;

/**
 * Where to look when the repo tree could not be listed (404, 409 too-large, rate
 * limited), in priority order: the two conventional skill locations, then a
 * repo-root file last, because in a repo that also has `skills/` a root SKILL.md
 * is usually the plugin's own front matter rather than the skill being sought.
 *
 * A slug that cannot safely be a path segment drops the two INTERPOLATED paths
 * and keeps the root one. `skillId` arrives from the skills.sh feed
 * (`convex/skills.ts`, `skillId: s.slug`) and reaches `rawGitHubUrl`, which is
 * bare template concatenation — so `..` segments would normalise out of our repo
 * and into someone else's, and the resulting URL would be persisted as this row's
 * `skillMdUrl` and later rendered as its content. The charset is the one
 * `SAFE_SEGMENT` (lib/install-commands.ts) already enforces on the
 * install-command sink; this closes the read sink to match.
 *
 * Keeping `SKILL.md` matters: it is a constant, so it cannot traverse anywhere,
 * and dropping it would withhold the one probe that could still bind a row whose
 * slug is merely unusual. Real ones exist — `ckm:slides` is a production row with
 * ~32k installs. Refusing to interpolate an unsafe slug is the security fix;
 * refusing to look in the repo root would just be collateral.
 *
 * Both callers treat "no path matched" as a non-verdict rather than a failure —
 * `skills.ts` marks the row unfound and the next sync retries, `githubOnly.ts`
 * answers `tree_unavailable` — so a short list here is safe, not silent.
 */
export function probePathsFor(skillId: string): string[] {
  const root = `SKILL.md`;
  if (!SAFE_SLUG.test(skillId) || skillId === "." || skillId === "..") {
    return [root];
  }
  return [
    `skills/${skillId}/SKILL.md`,
    `.claude/skills/${skillId}/SKILL.md`,
    root,
  ];
}

/**
 * The tree-unavailable fallback: guess each row's path and keep the first hit.
 *
 * `probe` answers "does this path exist?" — a HEAD request in production, a set
 * lookup in tests. The decisions that live here rather than in the caller: try
 * `probePathsFor`'s paths in order, stop a row at its first hit so a repo-root
 * SKILL.md never wins over a matching folder, and give a row that misses
 * everything no placement at all rather than a fallback guess.
 *
 * A probe that throws is the caller's business; it should answer `false`.
 */
export async function planProbePlacements({
  skills,
  probe,
}: {
  skills: readonly SkillRef[];
  probe: (path: string) => Promise<boolean>;
}): Promise<Placement[]> {
  const binds: Placement[] = [];
  for (const skill of skills) {
    for (const path of probePathsFor(skill.skillId)) {
      if (await probe(path)) {
        binds.push({ skill, path });
        break;
      }
    }
  }
  return binds;
}

/**
 * Pass 1: the folder is named exactly like the slug, decided from the tree alone.
 *
 * The match is a literal `Map` lookup and must stay one. Folding here — even
 * separators only — would make pass 1 disagree with the `skillMdByDir.get(skillId)`
 * that `aliasBindsSameFile` (convex/githubOnly.ts) predicts, and the add card
 * would vouch for a file the pipeline never binds.
 *
 * `byDir` is built by `indexSkillMds` (lib/github.ts), which lets a later entry
 * overwrite an earlier one, so a repo with two folders of the same name resolves by
 * tree order, last wins. That is documented behaviour, not an accident here.
 */
export function planDirPlacements(
  skills: readonly SkillRef[],
  byDir: ReadonlyMap<string, string>,
): Placement[] {
  const binds: Placement[] = [];
  for (const skill of skills) {
    const path = byDir.get(skill.skillId);
    // Falsy, not `!== undefined`: an empty path would bind
    // `https://raw.githubusercontent.com/owner/repo/branch/` — a directory URL
    // stored with a truthy `hasSkillMdUrl`, which the content pipeline then
    // retries forever instead of the row being marked unfound. `indexSkillMds`
    // cannot currently produce one; this keeps that from being load-bearing.
    if (!path) continue;
    binds.push({ skill, path });
  }
  return binds;
}

/**
 * Pass 2: match a candidate's frontmatter `name` against the slug.
 *
 * Two phases, and THE ORDER BETWEEN THEM IS THE POINT. Every candidate in the repo
 * gets its exact chance before any candidate is offered to the loose rule.
 *
 * This was once one loop per path with both rules inside it, which let the loose
 * arm on an early file beat the exact arm on a later one — the divergence that made
 * this pass disagree with the GitHub-only preview after the preview went
 * exact-only. `tests/discovery-placement.test.ts` pins it with the concrete case.
 *
 * ## Why the loop lives here
 *
 * It used to live in the caller, which left the caller computing "is this the last
 * batch?" — the one piece of arithmetic that decided whether the loose rule could
 * fire at all, in the one place no test could reach. Now the phase boundary is
 * structural: the loose `offer` is simply after the loop.
 *
 * ## Why the exact phase only sees each batch once
 *
 * A candidate that failed to match exactly cannot start matching later: `open` only
 * ever shrinks and both matchers are pure. So re-offering earlier batches is
 * provably a no-op — and doing it anyway made the phase quadratic in the number of
 * candidates for no reachable bind. Offering each batch once keeps it linear.
 *
 * The loose phase, by contrast, must see EVERYTHING, which is exactly why it waits
 * for the loop to finish.
 *
 * ## Placements are returned, not streamed
 *
 * The caller applies them after all reads finish, so a crash mid-walk now persists
 * no pass-2 binds where it once persisted some. That is a deliberate trade: the
 * row keeps `needsDiscovery` and the next sync retries it, which it would have done
 * for the unwritten remainder anyway.
 */
export async function planNamePlacements({
  remaining,
  candidates,
  usedPaths,
  readNames,
  waveSize = DISCOVERY_WAVE_SIZE,
}: {
  /** Rows still unbound, in the order they get first refusal. */
  remaining: readonly SkillRef[];
  /** Candidate SKILL.md paths not already bound, in tree order. */
  candidates: readonly string[];
  /** Paths already bound, by pass 1 or a sibling row. */
  usedPaths: ReadonlySet<string>;
  /** Supplies names for a batch of paths. The only I/O this function performs. */
  readNames: NameReader;
  /** Batch size. Defaults to `DISCOVERY_WAVE_SIZE`; tests set it small. */
  waveSize?: number;
}): Promise<Placement[]> {
  const takenPaths = new Set(usedPaths);
  const open = new Map(remaining.map((s) => [s.skillId, s]));
  const binds: Placement[] = [];
  const named: NamedCandidate[] = [];

  const offer = (
    entries: readonly NamedCandidate[],
    matches: (name: string, skillId: string) => boolean,
  ) => {
    for (const { path, name } of entries) {
      if (open.size === 0) return;
      // Property 2. Within a phase this stops one file claiming two rows; across
      // phases it stops the loose rule re-offering what the exact rule took.
      if (takenPaths.has(path)) continue;
      for (const [skillId, skill] of open) {
        if (!matches(name, skillId)) continue;
        binds.push({ skill, path });
        takenPaths.add(path);
        // Property 3: first claim wins, and this path is spent.
        open.delete(skillId);
        break;
      }
    }
  };

  // Floored at 1. `waveSize` exists for tests, and `0` would slice an empty batch
  // forever without advancing `i` — an unkillable spin, since the loop awaits only
  // resolved promises and so never yields to the timer queue.
  const step = Math.max(1, Math.floor(waveSize));

  for (let i = 0; i < candidates.length && open.size > 0; i += step) {
    const read = await readNames(candidates.slice(i, i + step));
    const fresh = read.filter((r): r is NamedCandidate => r !== null);
    named.push(...fresh);
    offer(fresh, matchesSkillIdExactly);
  }

  offer(named, matchesSkillId);
  return binds;
}
