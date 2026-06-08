import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { cacheLife } from "next/cache";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon, GlobalSearchIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { LabeledSection } from "@/components/labeled-section";
import { MarkdownContent } from "@/components/markdown-content";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { highlightMarkdownCode } from "@/lib/highlight-markdown-code";
import { formatInstalls, timeAgo } from "@/lib/utils";
import { OfficialBadge } from "@/components/skill-badges";
import { SkillAuditSection } from "@/components/skill-audit-section";

// EXPERIMENT: `fetchQuery` from convex/nextjs forces `cache: "no-store"` on its
// underlying fetch, which seems to stop `use cache` from persisting to Vercel's
// data cache (every render re-queried Convex in prod, though it cached fine in
// `next start`). Using `ConvexHttpClient` directly skips that no-store override,
// to see whether the cached result then persists across requests on Vercel.
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Shared cached loaders. Both the `/[org]/[repo]/[skillId]` and the
// `/site/[source]/[skillId]` routes import these (also from generateMetadata),
// so the metadata pass and the body pass dedupe to a single cache entry per
// (source, skillId).
export async function loadSkill(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  console.log(`[SKILL-FETCH] loadSkill ${source}/${skillId}`);
  return convex.query(api.skills.getBySourceAndSkillId, { source, skillId });
}

export async function loadAudits(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  console.log(`[SKILL-FETCH] loadAudits ${source}/${skillId}`);
  const row = await convex.query(api.audits.getBySourceAndSkillId, {
    source,
    skillId,
  });
  return row?.audits ?? null;
}

async function loadHighlightedCode(content: string) {
  "use cache";
  cacheLife("days");
  return highlightMarkdownCode(content);
}

async function loadTimeAgo(timestamp: number) {
  "use cache";
  cacheLife("days");
  return timeAgo(timestamp);
}

// Plain async component, rendered inline by the page — NOT `use cache`. Only the
// data functions above are cached. With `generateStaticParams` present this is
// the Cache Components "full page caching" pattern: the whole route is a single
// prerender, so an on-demand skill renders once and is saved to the durable
// route cache for subsequent requests — rather than being a per-request `use
// cache` hole (which is ephemeral on serverless and re-queried every request).
export async function CachedSkillDetail({
  source,
  skillId,
  variant,
}: {
  source: string;
  skillId: string;
  variant: "github" | "site";
}) {
  const [skill, audits] = await Promise.all([
    loadSkill(source, skillId),
    loadAudits(source, skillId),
  ]);

  if (!skill) {
    notFound();
  }

  const preHighlighted = skill.content
    ? await loadHighlightedCode(skill.content)
    : undefined;
  const timeLabel = skill.contentUpdatedAt
    ? `Updated ${await loadTimeAgo(skill.contentUpdatedAt)}`
    : `Added ${await loadTimeAgo(skill._creationTime)}`;

  const isGitHub = variant === "github";
  const installCommand = isGitHub
    ? `npx skills add ${source} --skill ${skillId}`
    : `npx skills add ${source}/${skillId}`;
  const externalUrl = isGitHub
    ? `https://github.com/${source}`
    : `https://${source}`;
  const externalIcon = isGitHub ? GithubIcon : GlobalSearchIcon;
  const [org, repo] = source.split("/");

  return (
    <>
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6">
        <Link href="/" className="hover:text-foreground transition-colors">
          Home
        </Link>
        <span>/</span>
        {isGitHub ? (
          <>
            <Link
              href={`/${org}`}
              className="hover:text-foreground transition-colors"
            >
              {org}
            </Link>
            <span>/</span>
            <Link
              href={`/${source}`}
              className="hover:text-foreground transition-colors"
            >
              {repo}
            </Link>
          </>
        ) : (
          <Link
            href={`/site/${source}`}
            className="hover:text-foreground transition-colors"
          >
            {source}
          </Link>
        )}
        <span>/</span>
        <span className="text-foreground">{skillId}</span>
      </nav>

      <h1 className="font-display text-3xl font-semibold tracking-tight text-balance mb-3">
        {skillId}
      </h1>

      {skill.isDelisted && (
        <div className="mb-4 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill is no longer listed on skills.sh
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        {skill.curatedOwner && <OfficialBadge owner={skill.curatedOwner} />}
        <span className="tabular-nums">
          {formatInstalls(skill.installs)} installs
        </span>
        <span>·</span>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors hover:underline"
        >
          <HugeiconsIcon
            icon={externalIcon}
            strokeWidth={2}
            className="size-3.5"
          />
          {source}
        </a>
        <span>·</span>
        <span>{timeLabel}</span>
      </div>

      {skill.hasContentFetchError && !skill.isDelisted && (
        <div className="mt-6 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill&apos;s source file could not be loaded. The install command
          may not work.
        </div>
      )}

      <LabeledSection label="Install" className="mt-10">
        <div className="group relative rounded-xl bg-muted w-fit max-w-full">
          <pre className="overflow-x-auto px-4 py-3 text-sm font-mono pr-16">
            {installCommand}
          </pre>
          <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
            <CopyButton content={installCommand} className="backdrop-blur-sm" />
          </div>
        </div>
      </LabeledSection>

      {skill.description && (
        <LabeledSection label="Overview" className="mt-10">
          <p className="text-lg leading-relaxed text-pretty text-muted-foreground">
            {skill.description}
          </p>
        </LabeledSection>
      )}

      <SkillAuditSection
        source={source}
        skillId={skillId}
        audits={audits}
        className="mt-10"
      />

      {skill.content && (
        <LabeledSection label="Documentation" className="mt-14">
          <MarkdownContent
            preHighlighted={preHighlighted}
            baseUrl={skill.skillMdUrl ?? null}
          >
            {skill.content}
          </MarkdownContent>
        </LabeledSection>
      )}

      {!skill.description && !skill.content && (
        <p className="mt-10 text-sm text-muted-foreground">
          No documentation available for this skill.
        </p>
      )}
    </>
  );
}

// Full inner skeleton (breadcrumb + title + body) used as the `<Suspense>`
// fallback while a cold skill's content renders.
export function SkillDetailContentSkeleton() {
  return (
    <>
      <div className="mb-6">
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="mb-3 h-9 w-1/2 max-w-md" />
      <SkillDetailPageSkeleton installCommand="npx skills add ..." />
    </>
  );
}

function SkillDetailPageSkeleton({ installCommand }: { installCommand: string }) {
  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <Skeleton className="h-4 w-20" />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Skeleton className="h-4 w-40" />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Skeleton className="h-4 w-24" />
      </div>

      <LabeledSection label="Install" className="mt-10">
        <div className="rounded-xl bg-muted w-fit max-w-full">
          <pre className="overflow-x-auto px-4 py-3 text-sm font-mono pr-16 invisible">
            {installCommand}
          </pre>
        </div>
      </LabeledSection>

      <LabeledSection label="Overview" className="mt-10">
        <div className="space-y-2">
          <Skeleton className="h-5 w-full max-w-2xl" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-5 w-3/4 max-w-md" />
        </div>
      </LabeledSection>

      <LabeledSection label="Documentation" className="mt-14">
        <div className="space-y-3">
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
      </LabeledSection>
    </>
  );
}
