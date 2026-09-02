"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/cubby-ui/button";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import {
  CONDITION_META,
  formatVerdict,
} from "@/components/monitoring/condition-meta";
import { DescriptionDelta } from "@/components/monitoring/description-delta";
import {
  StatusLight,
  TONE_OF_GROUP,
  type Tone,
} from "@/components/monitoring/status-light";
import { GROUP_OF, isFault } from "@/lib/monitoring/conditions";
import { solidSurface } from "@/lib/cubby-ui/elevated";
import { skillHref } from "@/lib/skill-urls";
import { cn, timeAgo } from "@/lib/utils";

type Feed = FunctionReturnType<
  typeof api.skillVersions.listRecentChangesForUser
>;
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
 * honest rather than decorative.
 *
 * ## Consequence, not chronology
 *
 * Rows arrive pre-ranked by the query, using the SAME ordering the bundle
 * register sorts by (lib/monitoring/conditions). A description change carries
 * its before/after inline, because the description is what decides when an
 * agent invokes a skill — that payload is the product's entire argument, and it
 * makes its own case better than a sentence explaining it would.
 *
 * ## Faults are not news, and never clear
 *
 * A delisted or unfetchable skill is a STATE. It has no timestamp, and reading
 * about it does not fix it, so it survives "Mark all read" and renders no time.
 * The panel used to be blind to both, which meant it could show a green
 * all-clear over a dependency the bundle page was calling Needs attention.
 */
export function ChangeFeed({ feed }: { feed: Feed | undefined }) {
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
        // Faults survive. Marking read acknowledges CHANGES; a skill that is
        // still delisted is still delisted, and dropping it here would make the
        // button look like it fixed something. The server agrees — faults do not
        // consult the baseline — so clearing them optimistically would also
        // flicker them straight back on the next round trip.
        items: q.value.items.filter((i) => isFault(i.condition)),
        suppressed: false,
      });
    }
  });

  const [revealSuppressed, setRevealSuppressed] = useState(false);
  const allClearRef = useRef<HTMLHeadingElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);

  if (feed === undefined) return <ChangeFeedPending />;

  const hasItems = feed.items.length > 0;
  const changes = feed.items.filter((i) => !isFault(i.condition));
  const faults = feed.items.filter((i) => isFault(i.condition));
  // Suppression hides CHANGES behind a disclosure; faults are never held back.
  const shownItems = !feed.suppressed || revealSuppressed ? feed.items : faults;

  function handleMarkAllRead() {
    // Which heading survives depends on whether anything is left. Faults do not
    // clear, so a reader with one delisted skill stays on THIS panel — the
    // crossfade never flips, `AllClear` stays `display: none`, and focusing it
    // is a silent no-op. That is how the original focus collapse came back:
    // the fault-survival rule made the all-clear branch unreachable in exactly
    // the case the button still renders.
    const target = faults.length > 0 ? panelHeadingRef : allClearRef;
    void markAllViewed({});
    // The button's own subtree gets `display: none` (or the button unmounts
    // outright, since it is hidden when no changes remain), so without this the
    // focused element vanishes and focus falls to <body> — dumping a keyboard
    // user at the top of the document. rAF so the swap has happened first.
    requestAnimationFrame(() => target.current?.focus());
  }

  return (
    <section
      aria-label="Change status"
      // The live region sits on the SECTION, not inside either reading, because
      // the crossfade unmounts one of them. A live region that gets removed
      // never announces — the previous placement announced "all clear" and
      // stayed silent for every outcome that was actually worth hearing.
      aria-live="polite"
      className={cn("rounded-2xl", solidSurface(3, 1))}
    >
      <Crossfade active={hasItems}>
        <AllClear
          watchedSkillCount={feed.watchedSkillCount}
          checkedCount={feed.checkedSkillCount}
          headingRef={allClearRef}
        />
        <div>
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 sm:px-6">
            <StatusLight tone={worstTone(feed)} />
            {/* tabIndex -1 so "Mark all read" can hand focus here when faults
                keep the panel on this reading. */}
            <h2
              ref={panelHeadingRef}
              tabIndex={-1}
              className="flex-1 text-sm font-semibold tracking-tight outline-none"
            >
              {feed.suppressed
                ? "Catalog-wide update"
                : headline(faults.length, changes.length)}
            </h2>
            {changes.length > 0 ? (
              <Button
                variant="outline"
                size="xs"
                className="h-8 sm:h-7"
                onClick={handleMarkAllRead}
              >
                Mark all read
              </Button>
            ) : null}
          </header>

          {/* Same coverage caveat as the all-clear. Without it this reading
              shows a bare "N skills changed", which reads as the whole answer
              — and this is the likelier branch for an account large enough to
              hit the cap in the first place. */}
          {feed.checkedSkillCount < feed.watchedSkillCount ? (
            <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground tabular-nums sm:px-6">
              <CoverageNote
                checked={feed.checkedSkillCount}
                total={feed.watchedSkillCount}
              />
            </p>
          ) : null}

          {feed.suppressed ? (
            <div className="border-t border-border px-5 py-4 sm:px-6">
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                {changes.length} of the skills you watch changed at once, which
                almost always means we reprocessed catalog content rather than
                their authors editing them. Holding them back until that is
                clear.
              </p>
              {!revealSuppressed ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="mt-2 -ml-2"
                  onClick={() => setRevealSuppressed(true)}
                >
                  Show them anyway
                </Button>
              ) : null}
            </div>
          ) : null}

          {shownItems.length > 0 ? (
            <ul className="divide-y divide-border border-t border-border">
              {shownItems.map((item) => (
                <ChangeRow
                  key={`${item.source}::${item.skillId}`}
                  item={item}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </Crossfade>
    </section>
  );
}

/**
 * Same height and shape as the resolved panel. The dashboard no longer blocks
 * on this query, so this is what fills the slot for the fraction of a second
 * the fan-out takes — a collapsed panel would make the page jump.
 */
function ChangeFeedPending() {
  return (
    <section
      aria-label="Change status"
      aria-busy
      className={cn("rounded-2xl", solidSurface(3, 1))}
    >
      <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span
          aria-hidden
          className="grid size-5 shrink-0 place-items-center rounded-full bg-muted-foreground/10"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/40 motion-reduce:animate-none" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-muted-foreground">
            Checking what changed&hellip;
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            Reading the archive for the skills you watch.
          </p>
        </div>
      </div>
    </section>
  );
}

function headline(faults: number, changes: number): string {
  const parts: string[] = [];
  if (faults > 0)
    parts.push(`${faults} need${faults === 1 ? "s" : ""} attention`);
  if (changes > 0)
    parts.push(`${changes} skill${changes === 1 ? "" : "s"} changed`);
  return parts.join(", ");
}

/**
 * The resting readout. Deliberately one line of statement plus one line of
 * fact, at the same height as the has-changes header — the panel should not
 * visibly deflate when there is no news.
 *
 * It reports numbers so it is self-evidently working. "Nothing has changed" on
 * its own is indistinguishable from a query that silently returned nothing.
 */
function AllClear({
  watchedSkillCount,
  checkedCount,
  headingRef,
}: {
  watchedSkillCount: number;
  /**
   * How many of those were actually resolved this load. Below the total when
   * the feed truncated — see MAX_FEED_CANDIDATES.
   */
  checkedCount: number;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  // An all-clear is a CLAIM, and it is only true about what we looked at. With
  // more watched skills than one load resolves, "all as you last left them"
  // over the full count asserts something the query never checked — the same
  // false-reassurance defect as the delisted-skill blocker, one layer along.
  const partial = checkedCount < watchedSkillCount;
  // Watching nothing is not the same as everything being fine. DESIGN.md names
  // `empty` alongside `pending` as never-green, and the sibling `RegisterTally`
  // already implements it — this component had only the partial half of the
  // same rule, so an account with no watched skills got a green all-clear over
  // an empty list.
  const empty = watchedSkillCount === 0;
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      {/* Green is a CLAIM, and only two states earn it. A partial check has not
          looked at everything; an empty list has nothing to look at. Both go
          neutral — the tone DESIGN.md reserves for the product declining to
          assert. */}
      <StatusLight tone={partial || empty ? "hold" : "clear"} />
      <div className="min-w-0">
        {/* tabIndex -1 so "Mark all read" can hand focus here rather than
            dropping it when its own subtree is hidden. */}
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-semibold tracking-tight outline-none"
        >
          {empty
            ? "Nothing to watch yet."
            : partial
              ? "Nothing changed in the skills we checked."
              : "Nothing has changed."}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {empty
            ? "Add a skill to a bundle and it will be watched from then on."
            : partial
              ? null
              : `Watching ${watchedSkillCount} skill${
                  watchedSkillCount === 1 ? "" : "s"
                }, all as you last left them.`}
          {partial ? (
            <CoverageNote checked={checkedCount} total={watchedSkillCount} />
          ) : null}
        </p>
      </div>
    </div>
  );
}

/**
 * What the load did NOT look at.
 *
 * Rendered on both readings, not just the all-clear. A reader with 700 watched
 * skills and three changes gets "3 skills changed" — a count that reads as
 * complete and is not, which is the more likely branch for the only accounts
 * big enough to hit the cap.
 *
 * Deliberately does not promise the remainder gets picked up later. An earlier
 * version said "the rest are checked on later loads", which is false: the scan
 * takes the oldest baselines first, and viewing a bundle moves its skills to
 * the NEWEST baseline — so the unchecked tail is the recently-seen tail and it
 * stays there. Nothing rotates. Saying otherwise turned one false reassurance
 * into a smaller one.
 */
function CoverageNote({ checked, total }: { checked: number; total: number }) {
  return (
    <span className="block">
      Checked {checked} of {total} watched skills, least recently checked first.
      The other {total - checked} were not checked on this load.
    </span>
  );
}

function worstTone(feed: Feed): Tone {
  // Suppressed goes neutral rather than red. The panel is saying "we do not
  // believe these yet" — lighting it with the severity of events it is actively
  // holding back would assert exactly what it is declining to assert. Faults
  // are exempt: those are not in doubt, so they still light it.
  const faulted = feed.items.some((i) => GROUP_OF[i.condition] === "attention");
  if (faulted) return "alert";
  if (feed.suppressed) return "hold";
  return feed.items.length > 0 ? TONE_OF_GROUP.changed : "clear";
}

function ChangeRow({ item }: { item: FeedItem }) {
  const meta = CONDITION_META[item.condition];
  // A change row's payoff is the recorded edit, which lives on the skill's
  // History tab; rows without a version land on the Overview.
  const href = item.version
    ? `${skillHref(item.source, item.skillId)}/history`
    : skillHref(item.source, item.skillId);

  return (
    <li>
      <Link
        href={href}
        className={cn(
          "group flex gap-3 px-5 py-3.5 transition-colors duration-100 outline-none sm:px-6",
          "hover:bg-surface-hover focus-visible:bg-surface-hover",
          "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:-outline-offset-2",
        )}
      >
        {meta.icon ? (
          <HugeiconsIcon
            icon={meta.icon}
            strokeWidth={2}
            aria-hidden
            className={cn("mt-0.5 size-4 shrink-0", meta.tone)}
          />
        ) : (
          <span aria-hidden className="mt-0.5 size-4 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">{meta.label}</span>
          </div>

          {item.audit ? (
            <p className="mt-1 text-xs font-medium text-danger-foreground">
              {formatVerdict(item.audit.from)} &rarr;{" "}
              {formatVerdict(item.audit.to)}
              {item.audit.riskLevel
                ? ` · ${formatVerdict(item.audit.riskLevel)} risk`
                : null}
            </p>
          ) : null}

          {item.condition === "description" ? (
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
            a column. Faults carry no time — see the module header. */}
        {item.changedAt !== null ? (
          <span className="shrink-0 pt-px text-xs text-muted-foreground tabular-nums">
            {timeAgo(item.changedAt)}
          </span>
        ) : null}

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
