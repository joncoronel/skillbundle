"use client";

import { useQueryState } from "nuqs";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { exploreQueryParser } from "@/lib/search-params";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/cubby-ui/input-group";
import { Kbd } from "@/components/ui/cubby-ui/kbd";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";

interface ExploreFiltersProps {
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
  loading?: boolean;
}

export function ExploreFilters({
  className,
  ref,
  loading,
}: ExploreFiltersProps) {
  const [query, setQuery] = useQueryState("q", exploreQueryParser);

  return (
    <ExploreFiltersView
      className={className}
      ref={ref}
      loading={loading}
      query={query}
      onQueryChange={(value) => setQuery(value || null)}
      onClear={() => setQuery(null)}
    />
  );
}

/**
 * Presentational search input with the query controlled via props — no URL
 * state. Rendered by `ExploreFilters` (nuqs-backed) and by the explore page's
 * Suspense fallback, which must not touch useSearchParams so the default
 * state can statically prerender.
 */
export function ExploreFiltersView({
  className,
  ref,
  loading,
  query,
  onQueryChange,
  onClear,
}: ExploreFiltersProps & {
  query: string;
  onQueryChange: (value: string) => void;
  onClear: () => void;
}) {
  const hasQuery = query.length > 0;

  return (
    <section className={className}>
      <InputGroup className="max-w-md">
        <InputGroupAddon align="inline-start">
          {loading ? (
            <DotMatrixRipple size="xs" ariaLabel="Searching" />
          ) : (
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="size-4"
            />
          )}
        </InputGroupAddon>
        <InputGroupInput
          ref={ref}
          placeholder="Search bundles..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          {hasQuery ? (
            <InputGroupButton
              size="icon_xs"
              onClick={onClear}
              aria-label="Clear search"
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            </InputGroupButton>
          ) : (
            <Kbd size="sm" className="hidden sm:flex">
              /
            </Kbd>
          )}
        </InputGroupAddon>
      </InputGroup>
    </section>
  );
}
