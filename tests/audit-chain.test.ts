/**
 * Integration test: audit-fetch chain.
 *
 * Pre-seeds a skill flagged needsAudit=true, mocks getSkillAudits to return
 * a multi-partner response, runs fetchAuditBatch, drains the scheduler,
 * then asserts:
 *   - skillAudits row stored with all 4 audits
 *   - worstAuditStatus / worstAuditRiskLevel denormalized to skill + summary
 *   - needsAudit cleared
 *   - auditFetchedAt stamped
 *
 * Mocks ./lib/skillsApi at the module level so the action's import is
 * rebound to the test stub before the Convex VM loads it.
 */
import { vi, test, expect, beforeEach } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../convex/lib/skillsApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/lib/skillsApi")>();
  return {
    ...actual,
    getSkillAudits: vi.fn(),
  };
});

import { getSkillAudits } from "../convex/lib/skillsApi";

test("fetchAuditBatch stores audits + denormalizes worst status", async () => {
  const t = makeTest();

  // Stub the audit endpoint with a realistic 4-provider response, mixed
  // pass/warn so worst-status reduction has something to actually do.
  vi.mocked(getSkillAudits).mockResolvedValue({
    id: "test-org/test-repo/test-skill",
    source: "test-org/test-repo",
    slug: "test-skill",
    audits: [
      {
        provider: "Gen Agent Trust Hub",
        slug: "agent-trust-hub",
        status: "pass",
        summary: "All good",
        auditedAt: "2026-05-01T00:00:00.000Z",
        riskLevel: "LOW",
      },
      {
        provider: "Socket",
        slug: "socket",
        status: "pass",
        summary: "No alerts",
        auditedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        provider: "Snyk",
        slug: "snyk",
        status: "warn",
        summary: "1 issue",
        auditedAt: "2026-05-01T00:00:00.000Z",
        riskLevel: "MEDIUM",
      },
      {
        provider: "ZeroLeaks",
        slug: "zeroleaks",
        status: "pass",
        summary: "Score: 95/100",
        auditedAt: "2026-05-01T00:00:00.000Z",
        riskLevel: "NONE",
      },
    ],
  });

  // Seed: one needsAudit=true skill + summary.
  const skillDocId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "test-org/test-repo",
      skillId: "test-skill",
      name: "Test Skill",
      installs: 1000,
      leaderboard: "all-time",
      lastSynced: Date.now(),
      needsAudit: true,
    });
    await ctx.db.insert("skillSummaries", {
      source: "test-org/test-repo",
      skillId: "test-skill",
      name: "Test Skill",
      installs: 1000,
      skillDocId: id,
      isDelisted: false,
      needsAudit: true,
    });
    return id;
  });

  // Run + drain. fetchAuditBatch self-schedules until done; finishInProgress
  // drains all pending scheduled functions synchronously.
  await t.action(internal.audits.fetchAuditBatch, {});
  await t.finishInProgressScheduledFunctions();

  // Assert end-state.
  await t.run(async (ctx) => {
    const auditRow = await ctx.db
      .query("skillAudits")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "test-org/test-repo").eq("skillId", "test-skill"),
      )
      .unique();
    expect(auditRow).not.toBeNull();
    expect(auditRow!.audits).toHaveLength(4);
    // Worst status: any warn → warn. Worst risk: MEDIUM (from Snyk) wins.
    expect(auditRow!.worstStatus).toBe("warn");
    expect(auditRow!.worstRiskLevel).toBe("MEDIUM");

    const skill = await ctx.db.get(skillDocId);
    expect(skill!.worstAuditStatus).toBe("warn");
    expect(skill!.worstAuditRiskLevel).toBe("MEDIUM");
    expect(skill!.needsAudit).toBe(false);
    expect(skill!.auditFetchedAt).toBeGreaterThan(0);

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "test-org/test-repo").eq("skillId", "test-skill"),
      )
      .unique();
    expect(summary!.worstAuditStatus).toBe("warn");
    expect(summary!.worstAuditRiskLevel).toBe("MEDIUM");
    expect(summary!.needsAudit).toBe(false);
  });
});

test("fetchAuditBatch records 404 as worstStatus=unknown", async () => {
  const t = makeTest();

  // The 404 path is wrapped in an error class our retry helper treats as
  // "real answer, not transient". The action should record an empty audit
  // list with worstStatus=unknown rather than retrying.
  const { SkillsApiNotFoundError } = await import(
    "../convex/lib/skillsApi"
  );
  vi.mocked(getSkillAudits).mockRejectedValue(
    new SkillsApiNotFoundError("not audited yet"),
  );

  const skillDocId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "test-org/test-repo",
      skillId: "unaudited-skill",
      name: "Unaudited",
      installs: 1000,
      leaderboard: "all-time",
      lastSynced: Date.now(),
      needsAudit: true,
    });
    await ctx.db.insert("skillSummaries", {
      source: "test-org/test-repo",
      skillId: "unaudited-skill",
      name: "Unaudited",
      installs: 1000,
      skillDocId: id,
      isDelisted: false,
      needsAudit: true,
    });
    return id;
  });

  await t.action(internal.audits.fetchAuditBatch, {});
  await t.finishInProgressScheduledFunctions();

  await t.run(async (ctx) => {
    const auditRow = await ctx.db
      .query("skillAudits")
      .withIndex("by_source_skillId", (q) =>
        q
          .eq("source", "test-org/test-repo")
          .eq("skillId", "unaudited-skill"),
      )
      .unique();
    expect(auditRow).not.toBeNull();
    expect(auditRow!.audits).toHaveLength(0);
    expect(auditRow!.worstStatus).toBe("unknown");

    const skill = await ctx.db.get(skillDocId);
    expect(skill!.needsAudit).toBe(false);
    expect(skill!.auditFetchedAt).toBeGreaterThan(0);
  });
});
