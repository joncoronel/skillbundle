import { createParser, parseAsString, parseAsStringLiteral } from "nuqs";
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

const leaderboardTabValues = ["popular", "trending", "hot"] as const;
export type LeaderboardTabValue = (typeof leaderboardTabValues)[number];
export const leaderboardTabParser =
  parseAsStringLiteral(leaderboardTabValues).withDefault("popular");

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
