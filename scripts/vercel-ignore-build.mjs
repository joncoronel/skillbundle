// Vercel's Ignored Build Step (wired up in vercel.json). Exit 0 SKIPS the
// build, exit 1 runs it. Note that is the reverse of the usual convention.
//
// Skips a deploy only when every file changed since the last successful
// deployment is Markdown. Why it is worth having: a deploy is not free here.
// Each one starts a fresh ISR cache (entries are keyed by build ID), so crawlers
// re-render and Vercel re-bills every page they touch, and every build reads
// Convex from `generateStaticParams`. Of the 11 production deploys on
// Sep 9-11 2026, three changed only TODO.md or comments; this catches the
// Markdown ones.
//
// Kept to `*.md` and nothing cleverer, so a real change can never be skipped
// by mistake. No Markdown file is read by the app at build or run time; if
// one ever is, narrow the match below rather than widening it.
//
// Every uncertain case BUILDS: no previous SHA (e.g. no earlier successful
// deploy), a previous SHA outside Vercel's 10-commit shallow
// clone, a git error, or an empty diff.
//
// Comparing against VERCEL_GIT_PREVIOUS_SHA rather than `HEAD^` is the point:
// with `HEAD^`, pushing a code commit followed by a docs commit in one go
// would skip the code. Vercel only sets that variable when an ignore command
// is configured, which is the case whenever this script runs.
import { execFileSync } from "node:child_process";

const BUILD = 1;
const SKIP = 0;

function decide() {
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (!previous) return BUILD;

  let changed;
  try {
    changed = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", previous, "HEAD"],
      {
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return BUILD;
  }

  if (changed.length === 0) return BUILD;
  const docsOnly = changed.every((file) => file.toLowerCase().endsWith(".md"));
  console.log(
    docsOnly
      ? `Skipping build: only Markdown changed since ${previous.slice(0, 7)} (${changed.join(", ")})`
      : `Building: ${changed.length} file(s) changed since ${previous.slice(0, 7)}`,
  );
  return docsOnly ? SKIP : BUILD;
}

process.exit(decide());
