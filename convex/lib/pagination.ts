// Shared continuation-cap rule for the self-scheduling paginated jobs.
//
// Each such job drains a paginated scan by rescheduling itself with the next
// cursor until `isDone`. The iteration cap is only a backstop against a
// non-draining loop (a bug, or a cursor that never advances) — in normal
// operation the job exits on `isDone` long before reaching it. Deriving every
// cap from one rule (`ceil(rows / page)`) instead of hand-picked magic numbers
// makes each cap legibly "enough pages to cover `rows` rows" rather than a guess
// a future reader can't tell from a coverage guarantee.
export function maxIterForRows(rows: number, page: number): number {
  return Math.ceil(rows / page);
}

// Safe upper bound on the non-delisted skill catalog. The `rows` basis for jobs
// whose scan is bounded by "all skills" rather than a smaller work-set:
// computeCopyCounts must visit every non-delisted row (a row's copy group
// changes when peers change, not itself), so its cap MUST cover the whole
// catalog or the tail silently misses a recompute; the other catalog-scale jobs
// use it as a generous drain backstop. Bump it if the catalog ever approaches it
// — the jobs warn when they hit their cap, so truncation is never silent.
export const CATALOG_MAX_ROWS = 60_000;
