/**
 * Shared bundle field limits, imported by both server (Convex mutations)
 * and client (form validation + character counters). Server is
 * authoritative — clients import these to preempt failures, but the
 * server re-validates as defense-in-depth.
 */

export const MAX_BUNDLE_DESCRIPTION_LENGTH = 500;

/**
 * Hard cap on the number of skills a single bundle can hold. Enforced by
 * `createBundle` and `updateBundleSkills` before they hit the catalog
 * validator, so a pathological payload (10k skill refs) fails with a
 * clear error instead of a cryptic Convex `TRANSACTION_LIMIT_EXCEEDED`
 * when the parallel `Promise.all` of index lookups exhausts the
 * per-transaction budget. Also serves as a DoS-shape guard.
 *
 * Bundles in real use are 5–20 skills; 100 is a generous ceiling that
 * still gives the validator predictable cost (~100 indexed reads /
 * ~50ms execution time).
 */
export const MAX_BUNDLE_SKILLS = 100;
