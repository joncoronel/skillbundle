import { parseAsString, parseAsStringLiteral } from "nuqs";

// -- Home page (/) parsers --

const modeValues = ["text", "repo"] as const;
export type ModeValue = (typeof modeValues)[number];
export const modeParser = parseAsStringLiteral(modeValues).withDefault("text");

export const searchQueryParser = parseAsString.withDefault("");
export const repoUrlParser = parseAsString.withDefault("");

// -- Explore page (/explore) parsers --

export const exploreQueryParser = parseAsString.withDefault("");

const exploreSortValues = ["newest", "starred"] as const;
export type ExploreSortValue = (typeof exploreSortValues)[number];
export const exploreSortParser =
  parseAsStringLiteral(exploreSortValues).withDefault("newest");

// -- Settings page (/settings/custom) parsers --

const settingsTabValues = ["profile", "security", "billing"] as const;
export type SettingsTabValue = (typeof settingsTabValues)[number];
export const settingsTabParser =
  parseAsStringLiteral(settingsTabValues).withDefault("profile");
