/**
 * Typed client for the skills.sh public v1 API.
 *
 * Docs: https://skills.sh/api/v1
 *
 * Auth: SKILLS_SH_API_KEY env var. Without it, requests are unauthenticated
 * (60 req/min per IP). With it, 600 req/min per key. Set via:
 *   npx convex env set SKILLS_SH_API_KEY sk_live_...
 */

const BASE_URL = "https://skills.sh/api/v1";

export class SkillsApiRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`skills.sh API rate limited; retry after ${retryAfterSeconds}s`);
    this.name = "SkillsApiRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class SkillsApiNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillsApiNotFoundError";
  }
}

function authHeaders(): Record<string, string> {
  const key = process.env.SKILLS_SH_API_KEY;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "SkillStack",
  };
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
    throw new SkillsApiRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 60);
  }
  if (res.status === 404) {
    throw new SkillsApiNotFoundError(`skills.sh API 404: ${path}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`skills.sh API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Run an API call with short inline retries for transient failures (5xx,
 * timeouts, network blips). Rate limits and 404s are bubbled up unchanged
 * so the caller can handle them on the fast path. At our scale a single
 * upstream hiccup shouldn't retire a row to the 7-day refresh limbo —
 * 2-3 attempts catches almost all transient cases.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SkillsApiRateLimitError) throw e;
      if (e instanceof SkillsApiNotFoundError) throw e;
      lastErr = e;
      if (attempt < maxAttempts) {
        // Linear backoff: 500ms, 1000ms. Keeps total worst-case wait under
        // 1.5s per skill so a flaky upstream doesn't blow the chain timing.
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Common skill object shape returned by listing/search/curated endpoints. */
export interface V1Skill {
  id: string;            // "{source}/{slug}"
  slug: string;
  name: string;
  source: string;        // "owner/repo" or "domain.com"
  installs: number;
  sourceType: "github" | "well-known";
  installUrl: string | null;
  url: string;
  isDuplicate?: boolean;
  // Hot view only:
  installsYesterday?: number;
  change?: number;
}

interface V1Pagination {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/v1/skills (paginated leaderboard)
// ---------------------------------------------------------------------------

export type LeaderboardView = "all-time" | "trending" | "hot";

export async function listSkills(opts: {
  view?: LeaderboardView;
  page?: number;
  perPage?: number;
}): Promise<{ data: V1Skill[]; pagination: V1Pagination }> {
  const params = new URLSearchParams();
  if (opts.view) params.set("view", opts.view);
  if (opts.page !== undefined) params.set("page", String(opts.page));
  if (opts.perPage !== undefined) params.set("per_page", String(opts.perPage));
  const qs = params.toString();
  return request(`/skills${qs ? `?${qs}` : ""}`);
}

// ---------------------------------------------------------------------------
// GET /api/v1/skills/{source}/{skill} (detail with files)
// ---------------------------------------------------------------------------

export interface V1SkillDetail {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash: string | null;
  files: Array<{ path: string; contents: string }> | null;
}

/**
 * Fetch full detail for a skill. `source` is "owner/repo" or "domain.com".
 * `slug` may itself contain slashes (e.g. "a/b-test-analysis" for skills named
 * "A/B Test Analysis"), so it MUST be percent-encoded — the API parser splits
 * the path and counts segments before decoding, so a literal "/" in the slug
 * gets misrouted as a 400 invalid_path.
 */
export async function getSkillDetail(
  source: string,
  slug: string,
): Promise<V1SkillDetail> {
  return request(`/skills/${source}/${encodeURIComponent(slug)}`);
}

/**
 * Memory-lean variant of getSkillDetail. Strips the response down to just the
 * hash + SKILL.md contents before returning, so callers don't hold the full
 * `files[]` array (which can be megabytes for skills with lots of bundled
 * examples/references) through subsequent awaits. Returns nulls if the skill
 * has no snapshot yet OR no SKILL.md file.
 */
export async function getSkillSyncData(
  source: string,
  slug: string,
): Promise<{ hash: string | null; skillMdContents: string | null }> {
  const detail = await getSkillDetail(source, slug);
  const skillMd = detail.files?.find((f) => f.path === "SKILL.md");
  return {
    hash: detail.hash,
    skillMdContents: skillMd?.contents ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/skills/curated (first-party skills)
// ---------------------------------------------------------------------------

export interface V1CuratedOwner {
  owner: string;
  totalInstalls: number;
  featuredRepo: string;
  featuredSkill: string;
  skills: V1Skill[];
}

export async function getCurated(): Promise<{
  data: V1CuratedOwner[];
  totalOwners: number;
  totalSkills: number;
  generatedAt: string;
}> {
  return request("/skills/curated");
}

// ---------------------------------------------------------------------------
// GET /api/v1/skills/audit/{source}/{skill}
// ---------------------------------------------------------------------------

export type AuditStatus = "pass" | "warn" | "fail";
export type AuditRiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface V1AuditEntry {
  provider: string;
  slug: string;
  status: AuditStatus;
  summary: string;
  auditedAt: string;
  riskLevel?: AuditRiskLevel;
  categories?: string[];
}

export interface V1AuditResponse {
  id: string;
  source: string;
  slug: string;
  audits: V1AuditEntry[];
}

export async function getSkillAudits(
  source: string,
  slug: string,
): Promise<V1AuditResponse> {
  return request(`/skills/audit/${source}/${encodeURIComponent(slug)}`);
}
