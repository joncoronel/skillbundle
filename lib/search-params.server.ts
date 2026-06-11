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
