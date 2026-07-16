"use client";

import { createContext, use, useCallback, useMemo } from "react";
import { useQueryStates } from "nuqs";
import {
  homeParamParsers,
  homeParamUrlKeys,
  HOME_PARAM_DEFAULTS,
  type HomeParams,
  type CatalogSortValue,
} from "@/lib/search-params";
import type { FacetCount, SkillFilters } from "@/lib/search/typesense";

/**
 * The home explorer's shared state: the URL params plus the derivations every
 * surface (composer, chin controls, mobile sheet, list region) needs. One
 * context instead of a 20-prop hand-off — consumers read exactly what they
 * use via `useExplorerState()`.
 */
export interface ExplorerState extends HomeParams {
  /** Atomic partial update — multi-param writes are ONE URL/history entry. */
  setParams: (partial: Partial<HomeParams>) => void;

  // -- Derived --
  /** textQuery, trimmed. */
  trimmedQuery: string;
  hasQuery: boolean;
  isRepo: boolean;
  /** Any explicit narrowing/sort beyond the entry state (activates search). */
  anyFilter: boolean;
  /**
   * Any actual narrowing filter (Official included) — excludes explicit sort,
   * which activates search but doesn't narrow results. Drives "loosen a
   * filter"-style copy; use `anyFilter` for activation.
   */
  hasNarrowing: boolean;
  /** Text mode with a query, filter, or explicit sort — Typesense drives. */
  searchActive: boolean;
  /** sortParam with null auto-resolved (relevance with a query, else installs). */
  effectiveSort: CatalogSortValue;
  /** The engine-agnostic filter set for searchSkills/query keys. */
  filters: SkillFilters;
  /**
   * How many narrowing filters are active. `chin` counts the desktop chin's
   * own controls (Official lives up in the input row there, with its own
   * pressed state); `sheet` adds Official, whose mobile home IS the sheet.
   * Clear always covers exactly the controls that share its surface.
   */
  filterCount: { chin: number; sheet: number };

  // -- Actions --
  /** The chin's Clear: narrowing filters only (not sort/scope/Official). */
  clearFilters: () => void;
  /** The sheet's Clear: everything the sheet contains, Official included. */
  clearSheetFilters: () => void;
  /**
   * Set the sort, clearing the param when it matches what the UI would
   * auto-resolve to anyway — the URL only carries explicit deviations, and
   * "sort: installs with nothing else" stays the entry state instead of
   * needlessly activating Typesense.
   */
  changeSort: (next: CatalogSortValue) => void;
}

const ExplorerStateContext = createContext<ExplorerState | null>(null);

function buildExplorerState(
  params: HomeParams,
  setParams: (partial: Partial<HomeParams>) => void,
): ExplorerState {
  const trimmedQuery = params.textQuery.trim();
  const hasQuery = trimmedQuery.length > 0;
  const hasNarrowing =
    params.official ||
    params.publisher.length > 0 ||
    params.audit !== null ||
    params.minInstalls !== null ||
    params.broken;
  const anyFilter = hasNarrowing || params.sortParam !== null;
  const isRepo = params.mode === "repo";

  const narrowing =
    (params.publisher.length > 0 ? 1 : 0) +
    (params.audit ? 1 : 0) +
    (params.minInstalls !== null ? 1 : 0) +
    (params.broken ? 1 : 0);

  return {
    ...params,
    setParams,
    trimmedQuery,
    hasQuery,
    isRepo,
    anyFilter,
    hasNarrowing,
    searchActive: !isRepo && (hasQuery || anyFilter),
    effectiveSort: params.sortParam ?? (hasQuery ? "relevance" : "installs"),
    filters: {
      officialOnly: params.official || undefined,
      owners: params.publisher.length > 0 ? params.publisher : undefined,
      audit: params.audit ?? undefined,
      minInstalls: params.minInstalls ?? undefined,
      // Always hide skills.sh-flagged forks/copies (parity with the cached
      // Popular query's `!isDuplicate`). No user toggle: the flag is unset
      // across the whole catalog today, so a control would do nothing — see
      // docs/search-overhaul.md. Kept so it auto-applies if it ever populates.
      hideForks: true,
      excludeBroken: params.broken || undefined,
    },
    filterCount: {
      chin: narrowing,
      sheet: narrowing + (params.official ? 1 : 0),
    },
    clearFilters: () =>
      setParams({ publisher: [], audit: null, minInstalls: null, broken: false }),
    clearSheetFilters: () =>
      setParams({
        publisher: [],
        audit: null,
        minInstalls: null,
        broken: false,
        official: false,
      }),
    changeSort: (next) => {
      const autoDefault: CatalogSortValue = hasQuery ? "relevance" : "installs";
      setParams({ sortParam: next === autoDefault ? null : next });
    },
  };
}

/**
 * Live provider — nuqs-backed. Reading search params (useSearchParams under
 * the hood) makes this subtree dynamic under Cache Components, so the page
 * wraps it in Suspense with a fallback on ExplorerStaticProvider below.
 */
export function ExplorerStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [params, setQueryStates] = useQueryStates(homeParamParsers, {
    urlKeys: homeParamUrlKeys,
  });
  const setParams = useCallback(
    (partial: Partial<HomeParams>) => {
      void setQueryStates(partial);
    },
    [setQueryStates],
  );
  const value = useMemo(
    () => buildExplorerState(params, setParams),
    [params, setParams],
  );
  return <ExplorerStateContext value={value}>{children}</ExplorerStateContext>;
}

const noopSet = () => {};
// Module-level so the static shell's context value is render-stable.
const STATIC_STATE = buildExplorerState(HOME_PARAM_DEFAULTS, noopSet);

/**
 * Static-shell provider — the no-params entry state (derived from the parsers)
 * with noop setters, and no search-params read, so the page's Suspense
 * fallback prerenders the exact idle UI. After hydration React swaps in the
 * live provider — identical when no params are set, so no visible flash.
 */
export function ExplorerStaticProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ExplorerStateContext value={STATIC_STATE}>{children}</ExplorerStateContext>
  );
}

export function useExplorerState(): ExplorerState {
  const ctx = use(ExplorerStateContext);
  if (!ctx) {
    throw new Error(
      "useExplorerState must be used inside ExplorerStateProvider / ExplorerStaticProvider",
    );
  }
  return ctx;
}

// -- Facet counts ------------------------------------------------------------

const EMPTY_FACETS: Record<string, FacetCount[]> = {};

// Derived (not URL) state, so it can't live on ExplorerState itself — the
// facets come out of useCatalogSearchStatus in SkillExplorerView, BELOW the
// state provider. Its own context saves the composer from couriering a prop
// it never reads down to the filter controls. Default = no counts (the static
// shell and idle state render without a provider value).
const CatalogFacetsContext =
  createContext<Record<string, FacetCount[]>>(EMPTY_FACETS);

export function CatalogFacetsProvider({
  facets,
  children,
}: {
  facets: Record<string, FacetCount[]>;
  children: React.ReactNode;
}) {
  return (
    <CatalogFacetsContext value={facets}>{children}</CatalogFacetsContext>
  );
}

/** Facet counts for the current result set ({} when idle/static). */
export function useCatalogFacets(): Record<string, FacetCount[]> {
  return use(CatalogFacetsContext);
}
