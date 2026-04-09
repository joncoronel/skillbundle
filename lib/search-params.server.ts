import {
  createLoader,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";

// -- Home page (/) --

const modeValues = ["text", "repo"] as const;

export const loadHomeSearchParams = createLoader({
  q: parseAsString.withDefault(""),
  repo: parseAsString.withDefault(""),
  mode: parseAsStringLiteral(modeValues).withDefault("text"),
});

// -- Explore page (/explore) --

export const loadExploreSearchParams = createLoader({
  q: parseAsString.withDefault(""),
});

// -- Settings page (/settings/custom) --

const settingsTabValues = ["profile", "security", "billing"] as const;

export const loadSettingsSearchParams = createLoader({
  tab: parseAsStringLiteral(settingsTabValues).withDefault("profile"),
});
