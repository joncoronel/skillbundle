/**
 * Guards isSafeRepoPath (convex/lib/github.ts): a source-derived "owner/repo"
 * must be two clean GitHub path segments before it's interpolated into an
 * api.github.com URL. The important cases are the path-traversal vectors that
 * isGitHubSource lets through (a "." / ".." repo segment) and out-of-charset
 * characters that could alter the request path.
 */
import { test, expect } from "vitest";
import { isSafeRepoPath } from "../convex/lib/github";

test("accepts normal owner/repo names", () => {
  for (const ok of [
    "vercel-labs/agent-skills",
    "anthropics/skills",
    "qu-skills/skills",
    "a_b.c/d.e_f-g",
  ]) {
    expect(isSafeRepoPath(ok)).toBe(true);
  }
});

test("rejects path-traversal segments", () => {
  for (const bad of ["owner/..", "../repo", "owner/.", "./repo", "..", "owner/../x"]) {
    expect(isSafeRepoPath(bad)).toBe(false);
  }
});

test("rejects wrong segment count", () => {
  for (const bad of ["just-one", "a/b/c", "", "a/b/"]) {
    expect(isSafeRepoPath(bad)).toBe(false);
  }
});

test("rejects out-of-charset characters that could alter the request path", () => {
  for (const bad of [
    "owner/repo?foo=bar",
    "owner/repo#frag",
    "owner/repo%2F..",
    "owner/repo with space",
    "owner//repo",
    "owner/re@po",
  ]) {
    expect(isSafeRepoPath(bad)).toBe(false);
  }
});
