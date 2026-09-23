"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BundleCard } from "@/components/bundle-card";
import { BundleSectionHeader, type SortBy } from "./bundle-section-header";

export interface BundleGridItem {
  key: string;
  name: string;
  description?: string;
  skillCount: number;
  createdAt: number;
  isPublic: boolean;
  /** Each dashboard brings its own buttons. */
  actions: ReactNode;
}

/** Bundle cards with their sort control, for account and browser bundles. */
export function BundleGrid({
  items,
  title,
}: {
  items: BundleGridItem[];
  /** A plain heading instead of the count and sort control. */
  title?: string;
}) {
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const sorted = useMemo(() => {
    const list = [...items];
    return sortBy === "alphabetical"
      ? list.sort((a, b) => a.name.localeCompare(b.name))
      : list.sort((a, b) => b.createdAt - a.createdAt);
  }, [items, sortBy]);

  return (
    <section className="space-y-5">
      {title ? (
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      ) : (
        <BundleSectionHeader
          count={items.length}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      )}
      <div className="grid gap-3 motion-reduce:animate-none sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((item, i) => (
          <div
            key={item.key}
            className="animate-in fill-mode-[both] fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
            style={{
              animationDelay: `${i * 30}ms`,
              animationDuration: "150ms",
            }}
          >
            <BundleCard
              name={item.name}
              urlId={item.key}
              description={item.description}
              skillCount={item.skillCount}
              createdAt={item.createdAt}
              creatorName="You"
              isPublic={item.isPublic}
              actions={item.actions}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
