/**
 * The category list and the tag rule. Imported by the frontend too, so the
 * definitions Jev reads live server-only in `categoryDefinitions.ts`.
 *
 * Keys are stored on rows, in the search index and in `?cat=` links, so
 * renaming one needs a re-tag and breaks shared links. Labels are display-only.
 */

export const CATEGORY_LABELS = {
  frontend: "Frontend",
  design: "UI & Design",
  mobile: "Mobile & Desktop Apps",
  backend: "Backend & APIs",
  databases: "Databases & Storage",
  cloud: "Cloud & Infrastructure",
  cicd: "CI/CD & Build Tooling",
  testing: "Testing & QA",
  debugging: "Debugging & Performance",
  security: "Security",
  codeReview: "Code Review & Refactoring",
  architecture: "Architecture & Patterns",
  languages: "Programming Languages",
  gitWorkflow: "Git & Project Workflow",
  planning: "Planning & Specs",
  aiApps: "Building AI Apps & Agents",
  agentTooling: "Agent Behavior & Skill Tooling",
  media: "Image, Video & Audio",
  browser: "Browser Automation & Scraping",
  dataAnalysis: "Data Analysis & Visualization",
  dataEngineering: "Data Engineering",
  ml: "Machine Learning",
  docs: "Docs & Writing",
  workplace: "Workplace & Productivity Apps",
  marketing: "Marketing & Growth",
  finance: "Finance & Business",
  science: "Science & Research",
  gameDev: "Game Development",
} as const;

export type CategoryKey = keyof typeof CATEGORY_LABELS;

export const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS) as CategoryKey[];

export function isCategoryKey(value: string): value is CategoryKey {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value);
}

/**
 * The category key behind a URL slug, or undefined.
 *
 * The inverse of `categorySlug` in `lib/skill-urls.ts`, built by running that
 * derivation over `CATEGORY_KEYS` rather than by reversing it — a kebab slug
 * cannot be turned back into camelCase unambiguously, and guessing would
 * quietly 404 a page the sitemap advertises. Lives here, beside the keys it
 * enumerates, so a new key joins the lookup by existing.
 *
 * The slug rule is duplicated rather than imported: this module is shared with
 * the Convex backend, which must not import from `lib/`. The test in
 * tests/category-urls.test.ts asserts the two agree on every key, so the copy
 * cannot drift silently.
 */
const SLUG_TO_KEY: ReadonlyMap<string, CategoryKey> = new Map(
  CATEGORY_KEYS.map((key) => [
    key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
    key,
  ]),
);

export function categoryKeyFromSlug(slug: string): CategoryKey | undefined {
  return SLUG_TO_KEY.get(slug);
}

/** Bump with a definitions change, then run `tags:markAllForTagging`. */
export const CATEGORIES_VERSION = 3;

/** Pinned, not `jev-latest`, so an upstream release can't move tags. */
export const TAGS_MODEL = "jev-1.13.0";

// Tuned on a sample. The two questions are answered independently and can
// disagree (`branding`: Marketing 0.98 from the pick-one, 0.21 from its
// yes/no), so a confident main category is tagged regardless. Extras need 0.6
// because the sample's false positives sat between 0.5 and 0.65.
export const PRIMARY_CONFIDENCE_MIN = 0.5;
export const EXTRA_TAG_MIN = 0.6;

/** Main category first, then extras by score. Pure, so a threshold change
 *  can be re-applied to stored scores without calling Jev. */
export function deriveTags(
  scores: Record<string, number>,
  primary: string | undefined,
  primaryConfidence: number | undefined,
): CategoryKey[] {
  const tags: CategoryKey[] = [];
  if (
    primary !== undefined &&
    isCategoryKey(primary) &&
    (primaryConfidence ?? 0) >= PRIMARY_CONFIDENCE_MIN
  ) {
    tags.push(primary);
  }
  const extras = CATEGORY_KEYS.filter(
    (key) => !tags.includes(key) && (scores[key] ?? 0) >= EXTRA_TAG_MIN,
  ).sort((a, b) => scores[b] - scores[a]);
  return [...tags, ...extras];
}
