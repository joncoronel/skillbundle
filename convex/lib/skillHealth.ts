import { MAX_DISCOVERY_FAILURES } from "../devStats";

/**
 * Is a skill healthy enough to detail-refresh? True when our content pipeline has
 * a working SKILL.md URL, no content-fetch error, and discovery isn't exhausted.
 * Broke skills fail this: the v1 detail endpoint serves a stale/unreliable count
 * for dead-or-moved repos, so the refresh jobs (reconcile, curated-refresh) skip
 * them and let the 30-day delist handle them.
 *
 * Job-agnostic refresh-eligibility rule, paired with isDeadRenamedAlias
 * (lib/source.ts); both jobs import both from the lib layer.
 */
export function isRefreshHealthy(s: {
  hasSkillMdUrl: boolean;
  hasContentFetchError: boolean;
  discoveryFailCount: number;
}): boolean {
  return (
    s.hasSkillMdUrl &&
    !s.hasContentFetchError &&
    s.discoveryFailCount < MAX_DISCOVERY_FAILURES
  );
}
