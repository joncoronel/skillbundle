/**
 * Coverage for the skill version archive — the change-capture half of
 * monitoring.
 *
 * Two things are being protected here, and they fail in opposite directions:
 *
 *   1. Under-capture. A change that leaves no version row is a silent gap in a
 *      skill's timeline, and worse, an alert that never fires. The interesting
 *      case is the frontmatter-only edit (a `version:` bump), which is INVISIBLE
 *      in `skills.content` because extractBodyContent strips frontmatter. That
 *      is exactly why the archive stores the raw file and hashes over it.
 *
 *   2. Over-capture. A duplicate row is a phantom "this changed!" event.
 *      `fetchSkillContent` retries three times and /dev can re-trigger the whole
 *      content chain by hand, so the same hash genuinely arrives more than once.
 *      PRODUCT.md's "earn every alert" principle makes this the more damaging of
 *      the two: a monitoring product dies from noise, not from a missed event.
 *
 * Walks the well-known source path (updateSkillFromDetail via
 * fetchSkillDetailBatch) rather than the GitHub raw path, for the same reason
 * tests/skills-chain.test.ts does: well-known goes through the v1 detail
 * endpoint exclusively, so there is no GitHub Tree API or raw.githubusercontent
 * to mock. `recordSkillVersion` is shared by both paths, so what it asserts
 * holds for either.
 */
import { vi, test, expect, beforeEach } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest } from "./_setup";
import { extractFrontmatterVersion } from "../convex/skillVersions";

beforeEach(() => {
  vi.clearAllMocks();
});

const SOURCE = "example.com";
const SKILL_ID = "demo-skill";

function skillMd(opts: {
  description: string;
  body: string;
  version?: string;
}) {
  const versionLine = opts.version ? `version: ${opts.version}\n` : "";
  return `---\nname: Demo Skill\ndescription: ${opts.description}\n${versionLine}---\n\n${opts.body}\n`;
}

async function seedSkill(t: ReturnType<typeof makeTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const skillDocId = await ctx.db.insert("skills", {
      source: SOURCE,
      skillId: SKILL_ID,
      name: "Demo Skill",
      installs: 100,
      leaderboard: "all-time",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      needsContentFetch: true,
      needsDiscovery: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: SOURCE,
      skillId: SKILL_ID,
      name: "Demo Skill",
      installs: 100,
      skillDocId,
      isDelisted: false,
      lastSeenInApi: now,
      needsContentFetch: true,
      needsDiscovery: false,
    });
    return skillDocId;
  });
}

/** Drive one content write end to end, exactly as fetchSkillDetailBatch does. */
async function writeContent(
  t: ReturnType<typeof makeTest>,
  skillDocId: Id<"skills">,
  raw: string,
) {
  const hash = await sha256Hex(raw);
  const description = raw.match(/^description:[ \t]*(.+)$/m)?.[1];
  const body = raw.split(/\n---\n/)[1]?.trim();

  const outcome = await t.mutation(internal.skills.updateSkillFromDetail, {
    skillId: skillDocId,
    description,
    content: body,
    syncHash: hash,
  });

  if (outcome.changed) {
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob([raw], { type: "text/markdown" }),
      );
      await ctx.runMutation(internal.skillVersions.recordSkillVersion, {
        skillDocId,
        rawStorageId: storageId,
        rawBytes: raw.length,
        syncHash: hash,
        previousSyncHash: outcome.previousSyncHash,
        frontmatterVersion: extractFrontmatterVersion(raw) ?? undefined,
        descriptionBefore: outcome.previousDescription,
        descriptionAfter: description,
        descriptionChanged: outcome.descriptionChanged,
        contentChanged: outcome.contentChanged,
      });
    });
  }
  return outcome;
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function versionsFor(
  t: ReturnType<typeof makeTest>,
  skillDocId: Id<"skills">,
) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("skillVersions")
      .withIndex("by_skill_changedAt", (q) => q.eq("skillDocId", skillDocId))
      .order("asc")
      .collect(),
  );
}

// ---------------------------------------------------------------------------
// extractFrontmatterVersion — strict on purpose
// ---------------------------------------------------------------------------

test("extractFrontmatterVersion reads a declared version", () => {
  expect(
    extractFrontmatterVersion(
      skillMd({ description: "d", body: "b", version: "4.0.4" }),
    ),
  ).toBe("4.0.4");
});

test("extractFrontmatterVersion tolerates quotes and prerelease tags", () => {
  expect(
    extractFrontmatterVersion(`---\nname: x\nversion: "1.2.3-beta.1"\n---\nb`),
  ).toBe("1.2.3-beta.1");
  expect(extractFrontmatterVersion(`---\nname: x\nversion: '2'\n---\nb`)).toBe(
    "2",
  );
});

test("extractFrontmatterVersion returns null when absent", () => {
  expect(
    extractFrontmatterVersion(skillMd({ description: "d", body: "b" })),
  ).toBeNull();
  expect(extractFrontmatterVersion("no frontmatter at all")).toBeNull();
});

test("extractFrontmatterVersion ignores a version outside the frontmatter", () => {
  // A body mentioning "version: 9.9.9" in prose must not be mistaken for a
  // declaration, or the timeline reports bumps that never happened.
  const raw = `---\nname: x\n---\n\nUpgrade with version: 9.9.9 in your config.`;
  expect(extractFrontmatterVersion(raw)).toBeNull();
});

test("extractFrontmatterVersion rejects a block scalar", () => {
  // Deliberately stricter than extractFrontmatterDescription. A version is a
  // short scalar on one line or it is not a version — matching looser would
  // turn a malformed field into a fake "version changed" event.
  expect(
    extractFrontmatterVersion(`---\nname: x\nversion: |\n  4.0.4\n---\nb`),
  ).toBeNull();
});

// ---------------------------------------------------------------------------
// Archive behaviour
// ---------------------------------------------------------------------------

test("first content write is recorded as a baseline", async () => {
  const t = makeTest();
  const skillDocId = await seedSkill(t);

  await writeContent(
    t,
    skillDocId,
    skillMd({ description: "First", body: "Body one", version: "1.0.0" }),
  );

  const versions = await versionsFor(t, skillDocId);
  expect(versions).toHaveLength(1);
  expect(versions[0].isBaseline).toBe(true);
  expect(versions[0].frontmatterVersion).toBe("1.0.0");
  // No predecessor row exists, so there is nothing to carry forward.
  expect(versions[0].previousFrontmatterVersion).toBeUndefined();
});

test("a baseline reports no description change", async () => {
  // The row a manual add leaves behind holds a name and an install count and
  // nothing else, so when the content chain fills it in, the writers compare
  // the file's description against `undefined` and report a change. That is our
  // own two-step ingest showing through, not an upstream edit — and it reached
  // the timeline as a "Description changed" badge over a before-value of None
  // on the skill's very first row.
  //
  // The one-time baseline backfill never had the problem because it hardcodes
  // `descriptionChanged: false`, which is why a skill it covered shows a bare
  // "Earliest recorded version" and a skill added after it did not.
  const t = makeTest();
  const skillDocId = await seedSkill(t);
  // The row carries a description but NO `syncHash` — exactly what an add
  // leaves behind now that `kickPostAddChain` seeds one from the SKILL.md it
  // downloaded. This is what makes the assertions below non-vacuous: without
  // it `previousDescription` is undefined anyway and the suppression under test
  // cannot be distinguished from doing nothing.
  await t.run(async (ctx) => {
    await ctx.db.patch(skillDocId, { description: "Seeded at add time" });
  });

  const outcome = await writeContent(
    t,
    skillDocId,
    skillMd({ description: "Install and configure the thing", body: "Body" }),
  );
  // The writer still reports the change — suppression is the archive's call,
  // and `needsEmbedding` downstream depends on this staying true.
  expect(outcome.descriptionChanged).toBe(true);
  // Narrowed rather than asserted through: the unchanged-hash arm of
  // `contentWriteOutcome` carries no `previousDescription`.
  if (!outcome.changed) throw new Error("expected a content change");
  expect(outcome.previousDescription).toBe("Seeded at add time");

  const versions = await versionsFor(t, skillDocId);
  expect(versions[0].isBaseline).toBe(true);
  expect(versions[0].descriptionChanged).toBe(false);
  // Dropped, not merely absent: the caller passed "Seeded at add time" and the
  // archive refused it, because a starting point has nothing to have moved from.
  expect(versions[0].descriptionBefore).toBeUndefined();
  // Kept: it is what the file says now, not a claim that anything moved.
  expect(versions[0].descriptionAfter).toBe("Install and configure the thing");
});

test("a first row is a real change when the skill already had content", async () => {
  // The well-known-source case, and the reason `isBaseline` is not simply
  // "no predecessor row". `backfillArchiveBaselines` only walks GitHub sources
  // (`listSkillsNeedingBaseline` filters on `isGitHubSource && skillMdUrl`), so
  // a well-known skill reaches its first real change with an EMPTY archive but
  // a `syncHash` that has been on its skills row since long before the archive
  // existed. Flagging that row a baseline hid it from the feed, which drops
  // baselines — one silently swallowed change per well-known skill.
  const t = makeTest();
  const skillDocId = await seedSkill(t);

  // Content that predates the archive: the skills row carries a hash and a
  // description, but nothing was ever recorded.
  await t.run(async (ctx) => {
    await ctx.db.patch(skillDocId, {
      description: "Old description",
      content: "Old body",
      syncHash: "hash-from-before-the-archive-existed",
    });
  });
  expect(await versionsFor(t, skillDocId)).toHaveLength(0);

  await writeContent(
    t,
    skillDocId,
    skillMd({ description: "New description", body: "New body" }),
  );

  const versions = await versionsFor(t, skillDocId);
  expect(versions).toHaveLength(1);
  expect(versions[0].isBaseline).toBe(false);
  // No predecessor blob, so no body diff — but the high-severity half survives,
  // because `descriptionBefore` is read off the live skills row.
  expect(versions[0].descriptionBefore).toBe("Old description");
  expect(versions[0].descriptionAfter).toBe("New description");
  expect(versions[0].descriptionChanged).toBe(true);
});

test("an unchanged hash writes no version row", async () => {
  const t = makeTest();
  const skillDocId = await seedSkill(t);
  const raw = skillMd({ description: "Same", body: "Same body" });

  await writeContent(t, skillDocId, raw);
  const outcome = await writeContent(t, skillDocId, raw);

  expect(outcome.changed).toBe(false);
  // This is the guard that keeps the 7-day refresh sweep from archiving ~16k
  // blobs every cycle for a catalog that mostly did not change.
  expect(await versionsFor(t, skillDocId)).toHaveLength(1);
});

test("a second change is not a baseline and carries the previous version", async () => {
  const t = makeTest();
  const skillDocId = await seedSkill(t);

  await writeContent(
    t,
    skillDocId,
    skillMd({ description: "First", body: "Body one", version: "1.0.0" }),
  );
  await writeContent(
    t,
    skillDocId,
    skillMd({ description: "Second", body: "Body two", version: "2.0.0" }),
  );

  const versions = await versionsFor(t, skillDocId);
  expect(versions).toHaveLength(2);
  expect(versions[1].isBaseline).toBe(false);
  expect(versions[1].frontmatterVersion).toBe("2.0.0");
  expect(versions[1].previousFrontmatterVersion).toBe("1.0.0");
  expect(versions[1].previousSyncHash).toBe(versions[0].syncHash);
});

test("a description change is captured on both sides, in full", async () => {
  const t = makeTest();
  const skillDocId = await seedSkill(t);

  await writeContent(
    t,
    skillDocId,
    skillMd({ description: "Use when styling", body: "Body" }),
  );
  await writeContent(
    t,
    skillDocId,
    skillMd({ description: "Use when refactoring", body: "Body" }),
  );

  const [, second] = await versionsFor(t, skillDocId);
  // The description decides WHEN an agent invokes a skill, so an upstream edit
  // changes the user's agent behaviour without touching their code. Both sides
  // are stored inline so an alert can render the change without fetching a blob.
  expect(second.descriptionChanged).toBe(true);
  expect(second.descriptionBefore).toBe("Use when styling");
  expect(second.descriptionAfter).toBe("Use when refactoring");
});

test("a frontmatter-only version bump is still captured", async () => {
  const t = makeTest();
  const skillDocId = await seedSkill(t);

  const before = skillMd({ description: "D", body: "Body", version: "4.0.3" });
  const after = skillMd({ description: "D", body: "Body", version: "4.0.4" });

  await writeContent(t, skillDocId, before);
  const outcome = await writeContent(t, skillDocId, after);

  // The body and description are byte-identical, so `skills.content` sees
  // nothing. The hash is over the RAW file, which is why this registers at all —
  // and it is the single most legible entry a timeline can show.
  expect(outcome.changed).toBe(true);
  const versions = await versionsFor(t, skillDocId);
  expect(versions).toHaveLength(2);
  expect(versions[1].previousFrontmatterVersion).toBe("4.0.3");
  expect(versions[1].frontmatterVersion).toBe("4.0.4");
});

test("re-recording the same hash is a no-op and releases the blob", async () => {
  const t = makeTest();
  const skillDocId = await seedSkill(t);
  const raw = skillMd({ description: "D", body: "Body" });
  await writeContent(t, skillDocId, raw);

  const hash = await sha256Hex(raw);
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob([raw], { type: "text/markdown" })),
  );

  await t.mutation(internal.skillVersions.recordSkillVersion, {
    skillDocId,
    rawStorageId: storageId,
    rawBytes: raw.length,
    syncHash: hash,
    descriptionChanged: false,
    contentChanged: false,
  });

  // fetchSkillContent retries three times and /dev can re-run the chain, so the
  // same hash genuinely arrives twice. A duplicate row here would surface as a
  // phantom change event to every watcher.
  expect(await versionsFor(t, skillDocId)).toHaveLength(1);
  // The rejected blob must not be orphaned: file storage has no reaper, and the
  // mutation is the only owner once the action has handed it over.
  expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).toBeNull();
});

test("recording against a deleted skill releases the blob instead of orphaning it", async () => {
  const t = makeTest();
  const skillDocId = await seedSkill(t);
  await t.run(async (ctx) => ctx.db.delete(skillDocId));

  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["gone"], { type: "text/markdown" })),
  );

  await t.mutation(internal.skillVersions.recordSkillVersion, {
    skillDocId,
    rawStorageId: storageId,
    rawBytes: 4,
    syncHash: "deadbeef",
    descriptionChanged: false,
    contentChanged: false,
  });

  expect(await versionsFor(t, skillDocId)).toHaveLength(0);
  expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).toBeNull();
});
