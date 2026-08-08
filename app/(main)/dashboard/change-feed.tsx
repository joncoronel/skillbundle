"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  FileEditIcon,
  SecurityWarningIcon,
  TextAlignLeftIcon,
} from "@hugeicons/core-free-icons";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/cubby-ui/button";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import { solidSurface } from "@/lib/cubby-ui/elevated";
import { skillHref } from "@/lib/skill-urls";
import { cn, timeAgo } from "@/lib/utils";

type Feed = FunctionReturnType<typeof api.skillVersions.listRecentChangesForUser>;
type FeedItem = Feed["items"][number];

/**
 * The status panel: the signed-in home's answer to "is anything wrong?".
 *
 * ## One object, two readings
 *
 * All-clear and has-changes are the SAME panel, not two components swapped in
 * and out. That is the design idea, and it is downstream of PRODUCT.md
 * principle 3: nothing-changed is the common outcome and the healthy one, so it
 * has to read as an instrument at rest rather than as a page that failed to
 * load. A separate "empty state" — the illustrated, centred, call-to-action kind
 * — would say the opposite every single visit.
 *
 * So the panel keeps its shape and its status light, and only its readout
 * changes. The light is the worst thing currently in it, which is why it is
 * honest rather than decorative: green when there is nothing, amber for content
 * edits, red for a security regression.
 *
 * ## Consequence, not chronology
 *
 * Rows arrive pre-ranked by the query (security → description → content) and are
 * rendered at three different weights so the ordering is visible and not just
 * true. A description change carries its before/after inline, because the
 * description is what decides when an agent invokes a skill — that payload is
 * the product's entire argument, and it makes its own case better than a
 * sentence explaining it would.
 */
export function ChangeFeed({ feed }: { feed: Feed }) {
  const markAllViewed = useMutation(
    api.bundles.markAllBundlesViewed,
  ).withOptimisticUpdate((localStore) => {
    // Empty the feed synchronously so the panel settles the moment the button
    // is pressed. This is the payoff gesture of the whole surface — waiting a
    // round trip to see "all clear" would flatten it.
    for (const q of localStore.getAllQueries(
      api.skillVersions.listRecentChangesForUser,
    )) {
      if (q.value === undefined) continue;
      localStore.setQuery(api.skillVersions.listRecentChangesForUser, q.args, {
        ...q.value,
        items: [],
        suppressed: false,
      });
    }
  });

  const [revealSuppressed, setRevealSuppressed] = useState(false);

  const hasChanges = feed.items.length > 0;
  const showRows = hasChanges && (!feed.suppressed || revealSuppressed);

  return (
    <section
      aria-label="Change status"
      className={cn("rounded-2xl", solidSurface(3, 1))}
    >
      <Crossfade active={hasChanges}>
        <AllClear watchedSkillCount={feed.watchedSkillCount} />
        <div>
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 sm:px-6">
            <StatusLight tone={worstTone(feed)} />
            <h2 className="flex-1 text-sm font-semibold tracking-tight">
              {feed.suppressed
                ? "Catalog-wide update"
                : `${feed.items.length} ${
                    feed.items.length === 1 ? "skill" : "skills"
                  } changed`}
            </h2>
            <Button
              variant="outline"
              size="xs"
              className="h-8 sm:h-7"
              onClick={() => void markAllViewed({})}
            >
              Mark all read
            </Button>
          </header>

          {feed.suppressed ? (
            <div className="border-t border-border px-5 py-4 sm:px-6">
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                {feed.items.length} of the skills you watch changed at once,
                which almost always means we reprocessed catalog content rather
                than their authors editing them. Holding them back until that is
                clear.
              </p>
              {!revealSuppressed ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-2 mt-2"
                  onClick={() => setRevealSuppressed(true)}
                >
                  Show them anyway
                </Button>
              ) : null}
            </div>
          ) : null}

          {showRows ? (
            <ul className="divide-y divide-border border-t border-border">
              {feed.items.map((item) => (
                <ChangeRow key={`${item.source}::${item.skillId}`} item={item} />
              ))}
            </ul>
          ) : null}
        </div>
      </Crossfade>
    </section>
  );
}

/**
 * The resting readout. Deliberately one line of statement plus one line of
 * fact, at the same height as the has-changes header — the panel should not
 * visibly deflate when there is no news.
 *
 * It reports numbers so it is self-evidently working. "Nothing has changed" on
 * its own is indistinguishable from a query that silently returned nothing.
 */
function AllClear({ watchedSkillCount }: { watchedSkillCount: number }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <StatusLight tone="clear" />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">
          Nothing has changed.
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {watchedSkillCount === 0
            ? "You aren't watching any skills yet."
            : `Watching ${watchedSkillCount} skill${
                watchedSkillCount === 1 ? "" : "s"
              }, all as you last left them.`}
        </p>
      </div>
    </div>
  );
}

type Tone = "clear" | "hold" | "content" | "alert";

/**
 * The instrument light. A 6px dot in a soft ring of its own hue — small enough
 * that green on a healthy visit reads as "powered on" rather than as
 * congratulation, which is what would make it noise after the third time.
 *
 * Colour is never the only carrier: the heading beside it always states the
 * condition in words, and each row repeats it in its own label.
 */
const TONE_LIGHT: Record<Tone, { dot: string; halo: string }> = {
  clear: { dot: "bg-success-foreground", halo: "bg-success/20" },
  hold: { dot: "bg-muted-foreground", halo: "bg-muted-foreground/15" },
  content: { dot: "bg-warning-foreground", halo: "bg-warning/20" },
  alert: { dot: "bg-danger-foreground", halo: "bg-danger/20" },
};

function StatusLight({ tone }: { tone: Tone }) {
  const { dot, halo } = TONE_LIGHT[tone];
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full",
        halo,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
    </span>
  );
}

function worstTone(feed: Feed): Tone {
  // Suppressed goes neutral rather than red. The panel is saying "we do not
  // believe these yet" — lighting it with the severity of events it is actively
  // holding back would assert exactly what it is declining to assert.
  if (feed.suppressed) return "hold";
  return feed.items.some((i) => i.kind === "audit") ? "alert" : "content";
}

const KIND_META: Record<
  FeedItem["kind"],
  { icon: IconSvgElement; label: string; iconClass: string }
> = {
  audit: {
    icon: SecurityWarningIcon,
    label: "Security verdict changed",
    iconClass: "text-danger-foreground",
  },
  description: {
    icon: TextAlignLeftIcon,
    label: "Description changed",
    iconClass: "text-warning-foreground",
  },
  content: {
    icon: FileEditIcon,
    label: "Content edited",
    iconClass: "text-muted-foreground",
  },
};

function ChangeRow({ item }: { item: FeedItem }) {
  const meta = KIND_META[item.kind];
  const href = item.version
    ? `${skillHref(item.source, item.skillId)}#history`
    : skillHref(item.source, item.skillId);

  return (
    <li>
      <Link
        href={href}
        className={cn(
          "group flex gap-3 px-5 py-3.5 outline-none transition-colors duration-100 sm:px-6",
          "hover:bg-surface-hover focus-visible:bg-surface-hover",
          "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:-outline-offset-2",
        )}
      >
        <HugeiconsIcon
          icon={meta.icon}
          strokeWidth={2}
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0", meta.iconClass)}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">{meta.label}</span>
          </div>

          {item.audit ? (
            <p className="mt-1 font-mono text-xs uppercase tracking-eyebrow text-danger-foreground">
              {item.audit.from} &rarr; {item.audit.to}
              {item.audit.riskLevel ? ` · ${item.audit.riskLevel}` : null}
            </p>
          ) : null}

          {item.kind === "description" ? (
            <DescriptionDelta
              before={item.version?.descriptionBefore}
              after={item.version?.descriptionAfter}
            />
          ) : null}

          <p className="mt-1.5 text-xs text-muted-foreground">
            in {item.bundleName}
          </p>
        </div>

        {/* Anchored to the right edge so the row has two ends instead of a
            long void between the text and the chevron, and so times read down
            a column. */}
        <span className="shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
          {timeAgo(item.changedAt)}
        </span>

        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-transform duration-100 group-hover:translate-x-0.5 group-hover:text-muted-foreground motion-reduce:transition-none"
        />
      </Link>
    </li>
  );
}

/**
 * The before/after of a skill's description, inline.
 *
 * No surrounding tray. A box here would be a box inside the panel, and the
 * codebase already made this call for rendered markdown — the diff is a
 * quotation of content, not a second surface.
 *
 * `−` and `+` are diff notation rather than icons standing in for one, set in
 * mono to say so, and they carry the meaning on their own: PRODUCT.md commits
 * to colour never being the sole indicator of state, and a two-line red/green
 * delta is the easiest place in the product to break that.
 */
function DescriptionDelta({
  before,
  after,
}: {
  before?: string;
  after?: string;
}) {
  if (!before && !after) return null;
  return (
    // Capped measure: descriptions are prose, and on a wide dashboard an
    // uncapped line runs past 120ch and stops being readable.
    <div className="mt-1.5 max-w-[68ch] space-y-0.5 text-xs leading-relaxed">
      {before ? (
        <p className="flex gap-2">
          <span aria-hidden className="font-mono text-danger-foreground">
            &minus;
          </span>
          <span className="sr-only">Was: </span>
          <span className="line-clamp-2 text-muted-foreground line-through decoration-muted-foreground/40">
            {before}
          </span>
        </p>
      ) : null}
      {after ? (
        <p className="flex gap-2">
          <span aria-hidden className="font-mono text-success-foreground">
            +
          </span>
          <span className="sr-only">Now: </span>
          <span className="line-clamp-2 text-foreground">{after}</span>
        </p>
      ) : null}
    </div>
  );
}
