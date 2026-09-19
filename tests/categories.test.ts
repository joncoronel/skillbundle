import { test, expect } from "vitest";
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  deriveTags,
  EXTRA_TAG_MIN,
  PRIMARY_CONFIDENCE_MIN,
} from "../convex/lib/categories";
import { CATEGORY_DEFINITIONS } from "../convex/lib/categoryDefinitions";

const low = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0.1]));

test("main category comes first, extras follow by score", () => {
  expect(
    deriveTags(
      { ...low, security: 0.7, infra: 0.9, docs: 0.95 },
      "security",
      0.8,
    ),
  ).toEqual(["security", "docs", "infra"]);
});

test("a confident main category is tagged even when its own yes/no is low", () => {
  expect(deriveTags({ ...low, marketing: 0.21 }, "marketing", 0.98)).toEqual([
    "marketing",
  ]);
});

test("an unsure main category is dropped", () => {
  expect(
    deriveTags({ ...low }, "workplace", PRIMARY_CONFIDENCE_MIN - 0.01),
  ).toEqual([]);
});

test("'Other' and unknown keys never become tags", () => {
  expect(deriveTags({ ...low }, undefined, 0.9)).toEqual([]);
  expect(deriveTags({ ...low }, "notACategory", 0.9)).toEqual([]);
});

test("extras need the cutoff, not just a majority", () => {
  expect(
    deriveTags(
      { ...low, backend: EXTRA_TAG_MIN - 0.01, testing: EXTRA_TAG_MIN },
      undefined,
      0,
    ),
  ).toEqual(["testing"]);
});

test("every category has a label and both definitions", () => {
  for (const key of CATEGORY_KEYS) {
    expect(CATEGORY_LABELS[key]).toBeTruthy();
    expect(CATEGORY_DEFINITIONS[key].counts).toBeTruthy();
    expect(CATEGORY_DEFINITIONS[key].doesNotCount).toBeTruthy();
  }
  // Labels double as Jev's choice options, so they must be unique.
  expect(new Set(Object.values(CATEGORY_LABELS)).size).toBe(
    CATEGORY_KEYS.length,
  );
});
