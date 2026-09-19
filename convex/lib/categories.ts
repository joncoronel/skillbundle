/**
 * Skill categories: the fixed list every skill is tagged against, and the rule
 * that turns Jev's per-category probabilities into tags.
 *
 * Imported by the frontend as well as by Convex, so this file holds only keys,
 * labels and the rule. The "counts / doesn't count" text Jev reads lives in
 * `categoryDefinitions.ts`, which is server-only.
 *
 * Keys are stored on rows and in the Typesense index, so renaming one means a
 * re-tag of the whole catalog. Labels are display-only and safe to change.
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
 * Bump when a definition in `categoryDefinitions.ts` changes enough to warrant
 * re-tagging, then run `tags:markAllForTagging`. Stored on each row as
 * `tagsVersion`, so a partial re-tag is visible.
 */
export const CATEGORIES_VERSION = 3;

/**
 * The model version is pinned rather than `jev-latest`, so an upstream release
 * can't move tags without a re-tag we chose to run. Stored as `tagsModel`.
 */
export const TAGS_MODEL = "jev-1.13.0";

// Tuned on a 150-skill sample (Sep 2026). The main category is tagged whenever
// the "pick one" answer is reasonably sure, even if that category's own yes/no
// scored low: the two questions are answered independently and disagree on
// some skills (`branding` came back Marketing at 0.98 from the pick-one and
// 0.21 from the yes/no). Extra tags need 0.6, not 0.5, because the false
// positives in the sample sat between 0.5 and 0.65.
export const PRIMARY_CONFIDENCE_MIN = 0.5;
export const EXTRA_TAG_MIN = 0.6;

/**
 * The tags a skill gets, main category first, then extras by score. Pure, so
 * a threshold change can be re-applied to stored scores without calling Jev.
 */
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
