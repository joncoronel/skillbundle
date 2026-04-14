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

interface ExploreFiltersProps {
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function ExploreFilters({ className, ref }: ExploreFiltersProps) {
  const [query, setQuery] = useQueryState("q", exploreQueryParser);
  const hasQuery = query.length > 0;

  return (
    <section className={className}>
      <InputGroup className="max-w-md">
        <InputGroupAddon align="inline-start">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="size-4"
          />
        </InputGroupAddon>
        <InputGroupInput
          ref={ref}
          placeholder="Search bundles..."
          value={query}
          onChange={(e) => setQuery(e.target.value || null)}
        />
        <InputGroupAddon align="inline-end">
          {hasQuery ? (
            <InputGroupButton
              size="icon_xs"
              onClick={() => setQuery(null)}
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
