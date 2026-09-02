import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type CSSProperties } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { GitCompareIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/cubby-ui/button";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { highlightMarkdownCode } from "@/lib/highlight-markdown-code";
import { compareHref } from "@/lib/compare";
import { cn, formatDate } from "@/lib/utils";
import { extractOutline, normalizeOutline } from "@/lib/markdown-outline";
import { RECORD_SURFACE } from "@/components/skill-record";
import { SkillSidebar, SkillSidebarShell } from "@/components/skill-sidebar";
import { SkillSection } from "@/components/skill-section";
import type { SectionNavItem } from "@/components/skill-section-nav";
import { SkillDocument, SkillDocumentMeta } from "@/components/skill-document";
import { BundleToggleButton } from "@/components/bundle-toggle-button";
import { SkillCopies } from "@/components/skill-copies";
import { skillHref } from "@/lib/skill-urls";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import { loadSkill, SKILL_SYNC_TAG } from "@/lib/skill-cache";

// Shared loaders. `fetchQuery` forces `cache: "no-store"` on its underlying
// fetch, which would block prerendering. Each loader is a `'use cache'`
// function: that isolates the no-store fetch behind a cache boundary and keys
// the result by its args (source, skillId), so the route prerenders a static
// shell and the `generateMetadata` pass + body share one entry.
//
// The skill row itself is loaded by `loadSkill` in lib/skill-cache.ts, which
// also carries the canonical explanation of the two-tag split ("skill-sync" for
// daily install data, "skill-content" for the row). Read that before re-tagging
// or merging anything below.
//
// loadAudits and loadStars stay untagged, for two different reasons: the audit chain writes audits but pinging for them does not
// pay (see below), and nothing in this app writes star counts at all — that
// loader calls GitHub directly, so a tag would have no publisher.
//
// loadAudits deliberately stays on "days" and untagged. A weekly life plus a
// dedicated "skill-audit" tag was tried and reverted: that tag's publish gate is
// a catalog-wide OR over the whole day's audit drain (~1.3k skills), and
// `auditsChanged` counts a provider re-stamping `auditedAt` under an identical
// verdict — so the gate fires most days and the entry gets expired daily anyway,
// exactly as this timer does. It bought no writes while replacing a guaranteed
// 24h self-heal with a best-effort ping whose only signal lived in scheduler
// args, and moving `expire` from 7 days to 30 on a security surface. Revisit
// only alongside per-skill tags (TODO.md), which is what would make such a gate
// selective enough to pay.

export async function loadAudits(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  const row = await fetchQuery(api.audits.getBySourceAndSkillId, {
    source,
    skillId,
  });
  return row?.audits ?? null;
}

// Everything on the "skill-sync" cadence, in ONE cache entry:
//
//   insights — install count, installRank, snapshots (daily syncSkills). The
//              faster-moving momentum fields (trending/hot) deliberately stay
//              off this page; they live on the home rails, kept fresh by their
//              own crons.
//   copies   — duplicate/rename relationships: the live skill a renamed alias
//              points to, plus aliases (same repo, other names) and forks
//              (different repos, same content). Populated by
//              resolveRepoIdentities on the weekly duplicate chain.
//   versions — version history for the History tab, written on the
//              content-refresh path.
//
// These were three separate `'use cache'` functions. They bought nothing:
// SkillDetailBody awaits all of them in a single Promise.all inside a single
// Suspense boundary, so there was never any independent streaming to gain, and
// they share one tag so they were always invalidated together anyway. Three
// entries meant three ISR writes per post-sync visit for one boundary's worth
// of data. The History tab reading `versions` through the same loader is the
// point, not a leak: the tab routes share this one cache entry with the
// Overview instead of adding entries of their own. Only split them again if
// one of them moves onto a different tag.
//
// The 24h cacheLife is the fallback if a revalidate ping is missed.
export async function loadSkillSyncData(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
  const [insights, copies, versions] = await Promise.all([
    fetchQuery(api.skills.getInsights, { source, skillId }),
    fetchQuery(api.duplicates.getSkillCopies, { source, skillId }),
    fetchQuery(api.skillVersions.listForSkill, { source, skillId }),
  ]);
  return { insights, copies, versions };
}

// GitHub star count for the repo behind a skill. Fetched lazily (only for
// viewed skills) rather than by a sync over thousands of repos.
// GitHub sources only (source is "owner/repo"); well-known sources have no repo.
// Set GITHUB_TOKEN to lift GitHub's 60/hr unauthenticated limit to 5000/hr.
//
// Untagged, so the cacheLife below is the whole mechanism — nothing in this
// system writes star counts; the loader calls GitHub directly. Keyed by
// `source`, not by skill, so every skill in a repo shares one entry.
//
// THREE different lifetimes, because `'use cache'` persists a failure exactly
// like a success and this loader has three outcomes that mean different things:
//
//   no repo   — a well-known source has no GitHub repo, ever. Structural, so
//               "max" (30d revalidate / 365d expire) rather than re-deciding
//               it on a timer.
//   a count   — "weeks" (7d revalidate / 30d expire), so a star count can read
//               up to 30 days stale in the tail. Fine: it is decorative and
//               drifts slowly, and each refresh is a live GitHub call, so
//               stretching it cuts rate-limit pressure as much as cache writes.
//   a failure — a 403 from the 60/hr unauthenticated ceiling (GITHUB_TOKEN is
//               optional, so that is a supported setup), a 5xx, a dropped
//               socket, or a malformed body. Must NOT inherit the long life:
//               `null` hides the whole Stars section, the entry is keyed by
//               repo so one 403 would blank it for every skill in that repo,
//               and nothing can revalidate an untagged entry before a new
//               build.
//
//               "hours" (1h revalidate / 24h expire), NOT "minutes". The
//               dominant failure above is the hourly rate limit, and a 60s
//               retry would re-request each viewed repo ~60 times per hour
//               while the limit is tripped — contradicting the very argument
//               made for the long life one line up. An hour matches the reset
//               window and still recovers ~168x faster than "weeks". The cost
//               is that a transient blip also hides the section for up to an
//               hour, which for a decorative number is the better trade.
//
// Conditional cacheLife across branches is the documented pattern for exactly
// this ("cache briefly when an item is missing but likely available later").
export async function loadStars(source: string): Promise<number | null> {
  "use cache";
  if (!source.includes("/")) {
    cacheLife("max");
    return null;
  }
  try {
    // What actually keeps this on the /repos endpoint is `SAFE_SEGMENT` in
    // lib/install-commands.ts rejecting exact dot segments — the route only
    // renders once `buildSkillInstallCommand` returns non-null, which runs that
    // check. encodeURIComponent is belt-and-braces for the rest of the charset
    // and does NOT cover the dot case: `.` is unreserved, so it re-emits ".."
    // unchanged and `/repos/../x` would still collapse onto `/x`, with the
    // token attached. Do not treat this line as the guard.
    const path = source.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`https://api.github.com/repos/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    });
    if (!res.ok) {
      cacheLife("hours");
      return null;
    }
    const data = (await res.json()) as { stargazers_count?: unknown };
    if (typeof data.stargazers_count !== "number") {
      cacheLife("hours");
      return null;
    }
    cacheLife("weeks");
    return data.stargazers_count;
  } catch {
    cacheLife("hours");
    return null;
  }
}

// shiki reads `Date.now()` internally, which can't be baked into a prerender.
// The highlight is deterministic and expensive, so caching it (keyed by content)
// freezes that read and keeps the skill body in the static shell.
//
// "max", not "days": the cache key IS the content and the transform is pure, so
// re-running on a timer can only ever reproduce the same bytes. On "days" that
// meant re-running shiki and rewriting an identical entry every 24h for every
// viewed skill; "max" stretches that to a 30-day revalidate (365-day expire).
// Not "never" — no `'use cache'` profile is, and entries are keyed by build ID
// anyway, so every deploy resets them. On a frequently-deployed app the real
// ceiling here is deploy cadence, not cacheLife.
//
// The content-keying also means aliases and forks (which this app explicitly
// tracks, see loadSkillSyncData) share a single entry rather than one each.
async function highlightSkillContent(content: string) {
  "use cache";
  cacheLife("max");
  return highlightMarkdownCode(content);
}

/**
 * The two-column geometry, as variables because the masthead's right padding
 * and the grid's second column have to be the same number and are set on
 * different elements.
 *
 * Applied to BOTH page containers and to the skeleton's own grid, which is the
 * fix for a real bug rather than belt and braces: an undefined var inside
 * `grid-cols-[minmax(0,1fr)_var(--skill-side)]` makes the whole declaration
 * invalid at computed-value time, so `grid-template-columns` falls back to
 * `none` and every child auto-places into one implicit column. The result is
 * not a subtly wrong layout, it is the sidebar sitting on top of the document —
 * and it only appeared in `loading.tsx`, whose container is a different element
 * that never carried these.
 *
 * Keeping them on the skeleton's own root means it renders correctly wherever
 * it is mounted, so the next component that reuses it cannot reintroduce this.
 */
const LAYOUT_VARS = {
  "--skill-side": "17rem",
  "--skill-gap": "2.5rem",
} as CSSProperties;

type SkillDetailPageProps = {
  source: string;
  skillId: string;
  installCommand: string;
  externalUrl: string;
  externalIcon: IconSvgElement;
  externalLabel: string;
};

/**
 * The Overview tab's content. The page frame — container, breadcrumb, h1, tab
 * strip — moved up into each skill route's `layout.tsx` when the page grew its
 * History / Stats / Security tab routes, so this component starts below the
 * tabs and owns only the two-column overview body.
 */
export function SkillDetailPage({
  source,
  skillId,
  installCommand,
  externalUrl,
  externalIcon,
  externalLabel,
}: SkillDetailPageProps) {
  return (
    <div className="mt-8" style={LAYOUT_VARS}>
      {/* Boundary sits around the Suspense, not inside it, so it covers the
          fallback too. The layout's masthead and tab strip stay rendered if
          the body fails — the page remains navigable. */}
      <DataErrorBoundary label="this skill">
        <Suspense
          fallback={<SkillDetailPageSkeleton installCommand={installCommand} />}
        >
          <SkillDetailBody
            source={source}
            skillId={skillId}
            installCommand={installCommand}
            externalUrl={externalUrl}
            externalIcon={externalIcon}
            externalLabel={externalLabel}
          />
        </Suspense>
      </DataErrorBoundary>
    </div>
  );
}

async function SkillDetailBody({
  source,
  skillId,
  installCommand,
  externalUrl,
  externalIcon,
  externalLabel,
}: {
  source: string;
  skillId: string;
  installCommand: string;
  externalUrl: string;
  externalIcon: IconSvgElement;
  externalLabel: string;
}) {
  const [skill, audits, syncData, stars] = await Promise.all([
    loadSkill(source, skillId),
    loadAudits(source, skillId),
    loadSkillSyncData(source, skillId),
    loadStars(source),
  ]);

  if (!skill) {
    notFound();
  }

  const { insights, copies } = syncData;

  const preHighlighted = skill.content
    ? await highlightSkillContent(skill.content)
    : undefined;

  const updatedKind = skill.contentUpdatedAt ? "Updated" : "Added";
  const updatedDate = formatDate(skill.contentUpdatedAt ?? skill._creationTime);

  const hasCopies = copies.aliases.length > 0 || copies.forks.length > 0;

  // The section nav is assembled here, on the server, so the whole outline is
  // in the prerendered HTML: the rail is part of the page's structure, not
  // something that appears once JS lands. Page sections sit at level 0; the
  // SKILL.md's own headings nest under Documentation at level 1+, which is what
  // makes the nav readable as "these are our sections, and that last one is
  // their file".
  const navItems: SectionNavItem[] = [
    { id: "overview", title: "Overview", level: 0 },
    ...(hasCopies
      ? [{ id: "copies", title: "Also available at", level: 0 }]
      : []),
    { id: "documentation", title: "Documentation", level: 0 },
    ...(skill.content
      ? normalizeOutline(extractOutline(skill.content)).map((heading) => ({
          id: heading.id,
          title: heading.title,
          level: heading.level,
        }))
      : []),
  ];

  return (
    // ONE grid for the whole body, not a masthead grid stacked on a content
    // grid. That was the tempting version — facts beside the lead, then a full
    // width run below — and it does not survive contact: two grids with
    // different column counts put the description's left edge and the
    // document's left edge on different x positions, and a page whose two main
    // text blocks do not share a margin reads as a mistake no amount of
    // spacing fixes. With one grid every left edge is the same line, and the
    // sidebar simply runs alongside from the lead to the end of the document.
    //
    // The sidebar is what recovered the space this layout was wasting: a lead
    // capped at a readable measure leaves roughly 45% of a 1152px page empty,
    // and the facts had been laid across the full width underneath it instead
    // of into the hole beside it.
    //
    // Two columns, one breakpoint, one sidebar — on the trailing side at every
    // width it exists. It used to be two sidebars that swapped sides at `xl`,
    // which meant the card jumped across the page on a resize and neither
    // column was ever affordable.
    //
    // The sidebar belongs on the trailing side because of which of the rail's
    // edges faces the document. Its entries indent rightward with heading
    // depth, so on the left it turned a ragged column of line-ends toward the
    // content and the gutter never resolved into a straight line. On the right
    // the flush edge — every marker starting at the same x — is the one the
    // reader sees against the text, and the depth indent runs away into the
    // margin where raggedness costs nothing.
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_var(--skill-side)] lg:gap-x-[var(--skill-gap)]">
      {/* The lead, the warnings that qualify it, and the command. */}
      <div className="lg:col-start-1 lg:row-start-1">
        {skill.description && (
          // The lead, at full contrast. PRODUCT.md is explicit that a skill's
          // description is what decides when an agent invokes it, which makes
          // it the single most decision-relevant sentence on the page — it
          // stops being a muted caption under a heading and becomes the thing
          // the masthead is built around. The old "Overview" section label goes
          // with it: a heading that only ever introduced one sentence was a
          // section in name only, and it was one of the three labels the reader
          // could not tell apart.
          // 16px, one step over the 14px UI body and no more. At 18px this was
          // reading as a pull quote: a skill description is frequently a dense
          // 200-word trigger list rather than a tagline, and set that large it
          // filled the viewport before the reader reached anything else.
          <p className="max-w-[74ch] text-base leading-relaxed text-foreground">
            {skill.description}
          </p>
        )}

        <div className="mt-6 space-y-3">
          {skill.isDelisted && (
            <div className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
              This skill is no longer listed on skills.sh
            </div>
          )}

          {skill.hasContentFetchError && !skill.isDelisted && (
            <div className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
              This skill&apos;s source file could not be loaded. The install
              command may not work.
            </div>
          )}

          {skill.isGitHubOnly && !skill.isDelisted && (
            <div className="rounded-lg border border-info-border bg-info px-4 py-3 text-sm text-info-foreground">
              This skill is available only on GitHub, not through the skills.sh
              API. Install counts and security audits stay unavailable until
              it&apos;s listed on skills.sh.
            </div>
          )}

          {copies.renamedTo && (
            <div className="rounded-lg border border-info-border bg-info px-4 py-3 text-sm text-info-foreground">
              This repository was renamed. Live version:{" "}
              <Link
                href={skillHref(
                  copies.renamedTo.source,
                  copies.renamedTo.skillId,
                )}
                className="font-medium underline underline-offset-2 hover:no-underline"
              >
                {copies.renamedTo.source}/{copies.renamedTo.skillId}
              </Link>
            </div>
          )}
        </div>

        {/* The command to run, on its own. It used to be a labelled section;
            it needs no label, because a line reading `npx skills add …` beside
            a copy button is already the most legible thing on the page. The
            primary action is not beside it — it sits at the top of the sidebar,
            where the old design had it and where it does not have to share a
            row with a string the reader is meant to read. */}
        {/* `w-fit`, not full width. The command is a fixed string a reader
            copies, so the block shrink-wraps to it; stretched across the whole
            column the fill became a band of empty grey with a few words at the
            left end. `max-w-full` keeps a long command scrollable instead of
            widening the column. */}
        <div className="group relative mt-7 w-fit max-w-full rounded-xl bg-muted">
          <pre className="overflow-x-auto px-4 py-3 pr-16 font-mono text-sm">
            {installCommand}
          </pre>
          <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
            <CopyButton content={installCommand} className="backdrop-blur-sm" />
          </div>
        </div>
      </div>

      {/* The sidebar spans both content rows so its sticky child has the whole
          page to travel through. It sits BETWEEN the two content blocks in DOM
          order, which is the only thing deciding where it lands once the grid
          is off: below `lg` the action and the record follow the install
          command and precede the document, instead of being stranded past
          20,000px of someone else's markdown. */}
      <SkillSidebar
        className="mt-10 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0"
        navItems={navItems}
        detailBase={skillHref(source, skillId)}
        externalUrl={externalUrl}
        externalIcon={externalIcon}
        externalLabel={externalLabel}
        curatedOwner={skill.curatedOwner}
        insights={insights}
        updatedKind={updatedKind}
        updatedDate={updatedDate}
        audits={audits}
        stars={stars}
        // Passed in rather than imported by the card, so the card stays free of
        // bundle state and this server component keeps composing the sidebar.
        //
        // Both actions on this skill, ranked and adjacent — the same pairing
        // the quick-look sheet already uses in its footer. Compare survives the
        // card's fold with the primary, which is not a concession: "this is not
        // what I wanted, show me the alternatives" is a thought you have while
        // reading the file, not only before you start.
        action={
          <div className="space-y-2">
            <BundleToggleButton
              source={source}
              skillId={skillId}
              name={skill.name}
            />
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              className="w-full"
              render={<Link href={compareHref([{ source, skillId }])} />}
              leadingIcon={
                <HugeiconsIcon
                  icon={GitCompareIcon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              }
            >
              Compare
            </Button>
          </div>
        }
      />

      <div className="mt-14 space-y-14 lg:col-start-1 lg:row-start-2">
        <SkillCopies aliases={copies.aliases} forks={copies.forks} />

        {skill.content && (
          <SkillSection
            id="documentation"
            title="Documentation"
            // The file's name and a link to it ride on the heading's
            // baseline. That is what lets the document below need no header,
            // no frame, and no rule of its own — and, with `SKILL.md` and a
            // link to the source sitting right there, no sentence explaining
            // that the file belongs to its author either. The label is the
            // explanation.
            meta={<SkillDocumentMeta sourceUrl={skill.skillMdUrl ?? null} />}
          >
            <SkillDocument
              content={skill.content}
              preHighlighted={preHighlighted}
              sourceUrl={skill.skillMdUrl ?? null}
              // Extra air on top of the section's own `mt-6`. This is the
              // one place on the page where the voice changes, and with no
              // frame drawn around the file the gap is what marks the
              // handoff — the largest space inside any section, so the
              // author's first heading reads as a beginning rather than as
              // the next paragraph of ours.
              className="mt-4"
            />
          </SkillSection>
        )}

        {!skill.content && (
          <SkillSection id="documentation" title="Documentation">
            <p className="text-sm text-muted-foreground">
              This skill publishes no SKILL.md content that SkillBundle can
              read.
            </p>
          </SkillSection>
        )}
      </div>
    </div>
  );
}

/**
 * The Suspense fallback, and the body of each route's `loading.tsx`.
 *
 * It traces the real page: the lead and the command in column 1, the action and
 * the record panel in the sidebar, then the two sections below. That
 * correspondence is load bearing and nothing tests it — the e2e guards assert a
 * shell commits instantly, not that it resembles the page — so a skeleton left
 * behind after a layout change reads to a user as one skeleton being replaced
 * by a different skeleton rather than as content arriving. Restructure the page,
 * restructure this in the same commit.
 */
export function SkillDetailPageSkeleton({
  installCommand,
}: {
  installCommand: string;
}) {
  return (
    <div
      className="lg:grid lg:grid-cols-[minmax(0,1fr)_var(--skill-side)] lg:gap-x-[var(--skill-gap)]"
      style={LAYOUT_VARS}
    >
      <div className="lg:col-start-1 lg:row-start-1">
        <div className="max-w-[74ch] space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>

        <div className="mt-7 w-fit max-w-full rounded-xl bg-muted">
          {/* The real command, hidden: it reserves the exact width the resolved
              block will take, so nothing resizes under the reader when the body
              lands. */}
          <pre className="invisible overflow-x-auto px-4 py-3 pr-16 font-mono text-sm">
            {installCommand}
          </pre>
        </div>
      </div>

      <SkillSidebarShell className="mt-10 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
        {/* The record card itself, with only its values pending. Drawing the
              container rather than a plain block keeps the sidebar the same
              shape and the same material before and after. Always drawn
              unfolded: the fold is a scroll state, and the body resolves long
              before anyone has scrolled into the document. */}
        <div className={cn("divide-y divide-border", RECORD_SURFACE)}>
          {/* The action block. BundleToggleButton renders its own skeleton
                until hydration, so the first of these reserves the same box it
                will; the second is Compare, which resolves with the shell. */}
          <div className="space-y-2 px-4 py-3">
            <Skeleton className="h-9 w-full rounded-lg sm:h-8" />
            <Skeleton className="h-9 w-full rounded-lg sm:h-8" />
          </div>
          {/* Installs: label, total, its trailing-week delta, then the trend. */}
          <div className="px-4 py-4">
            <Skeleton className="h-3 w-14" />
            <div className="mt-1.5 flex min-h-9 items-center">
              <Skeleton className="h-6 w-20" />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 py-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3.5 w-12" />
            </div>
            <Skeleton className="mt-3 h-10 w-full" />
          </div>
          {/* Repository: label, the repo link, and its star meta line. */}
          <div className="px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-4 w-full max-w-40" />
            <div className="mt-2 flex items-center gap-1.5">
              <Skeleton className="size-3.5 shrink-0 rounded-full" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
          {/* Updated. Security only renders when a skill has audits, so it
                is not reserved here. */}
          <div className="px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-4 w-full max-w-40" />
          </div>
        </div>

        {/* The rail, under the card in the same column. Its label is REAL
              text, like the section headings below: it does not depend on the
              data being loaded, so skeletoning it would withhold the page's
              structure for no reason and then shift it in when the body lands.
              What is genuinely unknown — the document's own headings — stays a
              placeholder. Six rows, which is roughly what progressive depth
              shows before a branch opens. */}
        <div className="mt-6 hidden lg:block">
          <p className="mb-4 text-xs font-medium text-muted-foreground">
            On this page
          </p>
          <div className="space-y-3.5">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <Skeleton key={item} className="h-3 w-full max-w-32" />
            ))}
          </div>
        </div>
      </SkillSidebarShell>

      <div className="mt-14 space-y-14 lg:col-start-1 lg:row-start-2">
        {/* Drawn THROUGH the real section component, not by re-typing its
            header markup. The header is real text either way — the word
            "SKILL.md" doesn't depend on the data being loaded — and rendering
            it through `SkillSection` is what stops the skeleton's border,
            spacing and heading scale from drifting from the page's. */}
        <SkillSection
          id="documentation"
          title="Documentation"
          meta={<span className="font-mono text-foreground">SKILL.md</span>}
        >
          <div className="mt-4 space-y-3">
            <Skeleton className="h-6 w-64" />
            <div className="space-y-2 pt-2">
              <Skeleton className="h-4 w-full max-w-2xl" />
              <Skeleton className="h-4 w-full max-w-2xl" />
              <Skeleton className="h-4 w-2/3 max-w-md" />
            </div>
            <div className="space-y-2 pt-4">
              <Skeleton className="h-4 w-full max-w-2xl" />
              <Skeleton className="h-4 w-5/6 max-w-2xl" />
            </div>
          </div>
        </SkillSection>
      </div>
    </div>
  );
}

// Fallback for the Overview segment's `loading.tsx`. The router shows this
// under the layout's masthead + tab strip while a not-yet-generated skill is
// rendered on-demand; once ISR caches the page, repeat visits serve the
// finished HTML and never hit this. The masthead's own skeleton lives with the
// layout (SkillMastheadSkeleton) — this covers only the tab body.
export function SkillDetailPageLoading() {
  return (
    <div className="mt-8">
      <SkillDetailPageSkeleton installCommand="npx skills add ..." />
    </div>
  );
}
