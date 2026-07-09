import {
  createParser,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs";
import {
  parseSkillsParam,
  serializeSkillsParam,
  type SkillRef,
} from "@/lib/compare";

// Shared debounce duration for all search inputs (home, /explore). Picked
// short enough to feel responsive on a typing pause, long enough that mid-
// word keystrokes don't fire a fetch.
export const SEARCH_DEBOUNCE_MS = 200;

// -- Home page (/) parsers --

const modeValues = ["text", "repo"] as const;
export type ModeValue = (typeof modeValues)[number];
export const modeParser = parseAsStringLiteral(modeValues).withDefault("text");

export const searchQueryParser = parseAsString.withDefault("");
export const repoUrlParser = parseAsString.withDefault("");

// Leaderboard sheet. null = closed; "hot"/"trending" open the sheet on that
// tab. URL-backed so leaderboard views are shareable and back closes the sheet.
// (Replaces the old ?tab= browse lens — Trending/Hot no longer swap the
// catalog; they live in their own sheet so the composer's search/sort/filters
// never point at a list they don't control.)
const leaderboardViewValues = ["hot", "trending"] as const;
export type LeaderboardViewValue = (typeof leaderboardViewValues)[number];
export const leaderboardViewParser = parseAsStringLiteral(leaderboardViewValues);

// Catalog sort. Deliberately NO .withDefault(): null means "auto" — the UI
// resolves it to "relevance" when a query is present, "installs" otherwise,
// and only an explicit user choice is reflected in the URL. Trending/Hot are
// NOT sorts (they're subset ranks on ~60/~30 rows) — they live in the
// zeitgeist rail, not here. "recent"/"rising" join once the Typesense sync
// populates contentUpdatedAt/momentum7d (see docs/search-overhaul.md).
const catalogSortValues = ["relevance", "installs"] as const;
export type CatalogSortValue = (typeof catalogSortValues)[number];
export const catalogSortParser = parseAsStringLiteral(catalogSortValues);

// Catalog filters. Every filter's broadest value is the default and stays
// absent from the URL — the URL only records explicit narrowing.
export const officialFilterParser = parseAsBoolean.withDefault(false);
// "pass" = passed audits only; "nofail" = anything except a failed verdict.
const auditFilterValues = ["pass", "nofail"] as const;
export type AuditFilterValue = (typeof auditFilterValues)[number];
export const auditFilterParser = parseAsStringLiteral(auditFilterValues);
// Minimum lifetime installs (preset buckets in the UI; any integer accepted).
export const minInstallsParser = parseAsInteger;
// Publisher (owner) narrowing — any-of a set of owner slugs (e.g.
// ["vercel-labs","anthropics"]). Comma-separated in the URL (?pub=a,b); [] = any.
export const publisherParser = parseAsArrayOf(parseAsString)
  .withDefault([])
  .withOptions({ clearOnDefault: true });
// Search scope. Default (false) searches skill names only; opt in to also
// search descriptions. A preference, not a filter — not part of "active
// filters" / Clear.
export const searchDescriptionsParser = parseAsBoolean.withDefault(false);
// true = hide skills whose SKILL.md fetch failed (install command may break).
export const brokenFilterParser = parseAsBoolean.withDefault(false);

// -- Explore page (/explore) parsers --

export const exploreQueryParser = parseAsString.withDefault("");

const exploreSortValues = ["newest", "starred"] as const;
export type ExploreSortValue = (typeof exploreSortValues)[number];
export const exploreSortParser =
  parseAsStringLiteral(exploreSortValues).withDefault("newest");

// -- Compare page (/compare) parsers --

export const compareSkillsParser = createParser<SkillRef[]>({
  parse: (value) => parseSkillsParam(value),
  serialize: serializeSkillsParam,
  eq: (a, b) => serializeSkillsParam(a) === serializeSkillsParam(b),
}).withDefault([]);

// -- Settings page (/settings) parsers --

const settingsTabValues = ["profile", "security", "billing"] as const;
export type SettingsTabValue = (typeof settingsTabValues)[number];
export const settingsTabParser =
  parseAsStringLiteral(settingsTabValues).withDefault("profile");
