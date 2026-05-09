/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../convex/schema";

/**
 * Wrapper around `convexTest` that provides the module map via Vite's
 * `import.meta.glob`. Without this, convex-test walks the filesystem to
 * locate `convex/_generated/`, which fails under pnpm's symlinked
 * node_modules layout.
 *
 * Tests live at the top-level `tests/` directory rather than inside
 * `convex/` because Convex's bundler treats every `.ts` file under
 * `convex/` as a function to compile for the Convex runtime — which
 * would try (and fail) to bundle convex-test's Node-only
 * `node:async_hooks` import. Keeping tests outside the convex/ root
 * avoids that conflict (matches the placement in convex-test's docs).
 */
export function makeTest() {
  // Glob every JS/TS module under convex/ so convex-test can resolve
  // internal function references (internal.skills.foo, etc.) at dispatch
  // time. The path is relative to this file.
  const modules = import.meta.glob("../convex/**/*.{js,ts}");
  return convexTest(schema, modules);
}
