"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/cubby-ui/card";
import {
  type ColumnDef,
  type PaginationState,
  DataTable,
  DataTableToolbar,
  DataTableToolbarSeparator,
  DataTableSearch,
  DataTableContent,
  DataTableHeader,
  DataTableBody,
  DataTablePagination,
} from "@/components/ui/cubby-ui/data-table/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/cubby-ui/select";
import { Button } from "@/components/ui/cubby-ui/button";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { formatInstalls, timeAgo } from "@/lib/utils";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/cubby-ui/tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorFilter =
  | "contentFetchError"
  | "pendingContentFetch"
  | "pendingDiscovery"
  | "noUrlRetrying"
  | "noUrlExhausted"
  | "delisted";

const FILTER_LABELS: Record<ErrorFilter, string> = {
  contentFetchError: "Content Errors",
  pendingContentFetch: "Pending Fetch",
  pendingDiscovery: "Pending Discovery",
  noUrlRetrying: "No URL (retrying)",
  noUrlExhausted: "No URL (exhausted)",
  delisted: "Delisted",
};

type SkillError = {
  _id: Id<"skills">;
  source: string;
  skillId: string;
  name: string;
  installs: number;
  hasContentFetchError?: boolean;
  skillMdUrl?: string;
  needsDiscovery?: boolean;
  needsContentFetch?: boolean;
  contentFetchedAt?: number;
  isDelisted?: boolean;
  discoveryFailCount?: number;
};

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function DevDashboardContent() {
  const { data: admin } = useQuery(convexQuery(api.devStats.isAdmin, {}));
  const { data: syncStats } = useQuery({
    ...convexQuery(api.devStats.getSyncStats, {}),
    enabled: !!admin,
  });

  const [activeFilter, setActiveFilter] =
    useState<ErrorFilter>("contentFetchError");

  if (admin === false) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        You don&apos;t have access to this page.
      </p>
    );
  }

  const stats = {
    totalSkills: syncStats?.totalSkills ?? 0,
    contentFetchErrors: syncStats?.contentFetchErrors ?? 0,
    pendingContentFetch: syncStats?.pendingContentFetch ?? 0,
    pendingDiscovery: syncStats?.pendingDiscovery ?? 0,
    noSkillMdUrl: syncStats?.noSkillMdUrl ?? 0,
    noUrlExhausted: syncStats?.noUrlExhausted ?? 0,
    delisted: syncStats?.delisted ?? 0,
  };

  const loading = syncStats === undefined;

  return (
    <div className="space-y-8">
      <StatsCards stats={stats} loading={loading} />
      <ErrorSkillsList
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        stats={stats}
      />
      <EmbeddingPanel />
      <DelistedAnalysis />
      <FeaturedBundlesSection />
      <AdminActions />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Cards
// ---------------------------------------------------------------------------

function StatsCards({
  stats,
  loading,
}: {
  stats: {
    totalSkills: number;
    contentFetchErrors: number;
    pendingContentFetch: number;
    pendingDiscovery: number;
    noSkillMdUrl: number;
    noUrlExhausted: number;
    delisted: number;
  };
  loading?: boolean;
}) {
  const cards = [
    {
      label: "Total Skills",
      value: stats.totalSkills,
      warn: false,
      tooltip: "Total number of skills synced from skills.sh",
    },
    {
      label: "Content Errors",
      value: stats.contentFetchErrors,
      warn: stats.contentFetchErrors > 0,
      tooltip:
        "Skills with a URL that failed content fetch. After 2 failures the URL is cleared and the skill is sent back to discovery.",
    },
    {
      label: "Pending Fetch",
      value: stats.pendingContentFetch,
      warn: stats.pendingContentFetch > 50,
      tooltip:
        "Skills queued for content download. Should drain to 0 after each sync.",
    },
    {
      label: "Pending Discovery",
      value: stats.pendingDiscovery,
      warn: stats.pendingDiscovery > 50,
      tooltip:
        "Skills queued for URL discovery. Should drain to 0 after each sync.",
    },
    {
      label: "No URL",
      value: stats.noSkillMdUrl,
      warn: false,
      tooltip:
        "Skills where discovery couldn't find a SKILL.md URL. Retried every 7 days, gives up after 3 failures.",
    },
    {
      label: "Delisted",
      value: stats.delisted,
      warn: false,
      tooltip:
        "Skills not seen in the skills.sh API for 30+ days. Excluded from search results.",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.label} className="gap-0 py-0">
          <div className="px-5 py-4">
            <Tooltip>
              <TooltipTrigger
                render={<p />}
                className="text-xs text-muted-foreground cursor-help decoration-dashed decoration-muted-foreground/40 underline underline-offset-2"
              >
                {card.label}
              </TooltipTrigger>
              <TooltipContent className="max-w-56">
                {card.tooltip}
              </TooltipContent>
            </Tooltip>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {loading ? "..." : card.value.toLocaleString()}
              {card.warn && (
                <Badge variant="warning" className="ml-2 text-xs align-middle">
                  !
                </Badge>
              )}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error Skills Table
// ---------------------------------------------------------------------------

function ErrorSkillsList({
  activeFilter,
  onFilterChange,
  stats,
}: {
  activeFilter: ErrorFilter;
  onFilterChange: (filter: ErrorFilter) => void;
  stats: {
    contentFetchErrors: number;
    pendingContentFetch: number;
    pendingDiscovery: number;
    noSkillMdUrl: number;
    noUrlExhausted: number;
    delisted: number;
  };
}) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

  const { data: result } = useQuery(
    convexQuery(api.devStats.listSkillsWithErrors, {
      filter: activeFilter,
    }),
  );

  const retryFetch = useAction(api.devStats.callRetryContentFetch);
  const retryDiscovery = useAction(api.devStats.callRetryDiscovery);
  const retryBatch = useAction(api.devStats.callRetryBatch);
  const probeUrl = useAction(api.devStats.probeSkillUrl);
  const [batchLoading, setBatchLoading] = useState(false);

  const filterCounts: Record<ErrorFilter, number> = {
    contentFetchError: stats.contentFetchErrors,
    pendingContentFetch: stats.pendingContentFetch,
    pendingDiscovery: stats.pendingDiscovery,
    noUrlRetrying: stats.noSkillMdUrl - stats.noUrlExhausted,
    noUrlExhausted: stats.noUrlExhausted,
    delisted: stats.delisted,
  };

  const handleRetryFetch = async (skillId: Id<"skills">) => {
    try {
      await retryFetch({ skillId });
      toast.info({ title: "Skill queued for content re-fetch" });
    } catch {
      toast.error({ title: "Failed to queue retry" });
    }
  };

  const handleRetryDiscovery = async (skillId: Id<"skills">) => {
    try {
      await retryDiscovery({ skillId });
      toast.info({ title: "Skill queued for URL re-discovery" });
    } catch {
      toast.error({ title: "Failed to queue re-discovery" });
    }
  };

  const handleRetryBatch = async () => {
    if (
      activeFilter !== "contentFetchError" &&
      activeFilter !== "noUrlExhausted"
    )
      return;
    setBatchLoading(true);
    try {
      const result = await retryBatch({ filter: activeFilter });
      toast.info({ title: `Queued ${result.count} skills for retry` });
    } finally {
      setBatchLoading(false);
    }
  };

  const columns: ColumnDef<SkillError, unknown>[] = [
    {
      accessorKey: "name",
      header: "Skill",
      cell: ({ row }) => {
        const skill = row.original;
        const hasUrl = skill.skillMdUrl && skill.skillMdUrl !== "";
        const repoUrl = `https://github.com/${skill.source}`;
        return (
          <div className="min-w-0">
            <span className="font-medium">{skill.name}</span>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate underline decoration-muted-foreground/40 hover:decoration-muted-foreground"
              >
                {skill.source}/{skill.skillId}
              </a>
              {hasUrl && (
                <a
                  href={skill.skillMdUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 underline decoration-muted-foreground/40 hover:decoration-muted-foreground"
                >
                  SKILL.md
                </a>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "installs",
      header: "Installs",
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {formatInstalls(row.original.installs)}
        </span>
      ),
    },
    {
      id: "fetched",
      header: "Fetched",
      cell: ({ row }) =>
        row.original.contentFetchedAt ? (
          <span className="text-xs text-muted-foreground">
            {timeAgo(row.original.contentFetchedAt)}
          </span>
        ) : null,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const skill = row.original;
        return (
          <div className="flex items-center gap-1.5">
            {skill.hasContentFetchError && (
              <Badge variant="warning">error</Badge>
            )}
            {skill.isDelisted && <Badge variant="secondary">delisted</Badge>}
            {skill.skillMdUrl === "" && <Badge variant="outline">no url</Badge>}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <SkillActions
          skill={row.original}
          filter={activeFilter}
          onRetryFetch={handleRetryFetch}
          onRetryDiscovery={handleRetryDiscovery}
          probeUrl={probeUrl}
        />
      ),
    },
  ];

  const filterOptions = (Object.keys(FILTER_LABELS) as ErrorFilter[]).map(
    (key) => ({
      label: `${FILTER_LABELS[key]} (${filterCounts[key].toLocaleString()})`,
      value: key,
    }),
  );

  return (
    <div>
      {result === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={result.skills as SkillError[]}
            enableSorting
            enableFiltering
            enablePagination
            pagination={pagination}
            onPaginationChange={setPagination}
            className="md:max-w-none"
            getRowId={(row: SkillError) => row._id}
          >
            <DataTableToolbar variant="ghost">
              <Select
                items={filterOptions}
                value={activeFilter}
                onValueChange={(value) => {
                  if (value) {
                    onFilterChange(value as ErrorFilter);
                    setPagination((p) => ({ ...p, pageIndex: 0 }));
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-auto min-w-16 border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent size="sm" alignItemWithTrigger>
                  {filterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(activeFilter === "contentFetchError" ||
                activeFilter === "noUrlExhausted") && (
                <>
                  <DataTableToolbarSeparator />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRetryBatch}
                    disabled={batchLoading}
                  >
                    {batchLoading ? "Retrying..." : "Retry All"}
                  </Button>
                </>
              )}
              <DataTableToolbarSeparator />
              <DataTableSearch placeholder="Search skills..." />
            </DataTableToolbar>
            <DataTableContent hoverable className="max-h-[600px] overflow-y-auto md:max-w-none">
              <DataTableHeader enableSorting />
              <DataTableBody emptyState="No skills in this category." />
            </DataTableContent>
            <DataTablePagination showSelectedCount={false} />
          </DataTable>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill Actions Cell (with probe state)
// ---------------------------------------------------------------------------

function SkillActions({
  skill,
  filter,
  onRetryFetch,
  onRetryDiscovery,
  probeUrl,
}: {
  skill: SkillError;
  filter: ErrorFilter;
  onRetryFetch: (id: Id<"skills">) => void;
  onRetryDiscovery: (id: Id<"skills">) => void;
  probeUrl: (args: { url: string }) => Promise<{
    status: number;
    ok: boolean;
    error?: string;
  }>;
}) {
  const [probeResult, setProbeResult] = useState<{
    status: number;
    ok: boolean;
  } | null>(null);
  const [probing, setProbing] = useState(false);

  const hasUrl = skill.skillMdUrl && skill.skillMdUrl !== "";

  const handleProbe = async () => {
    if (!hasUrl) return;
    setProbing(true);
    try {
      const result = await probeUrl({ url: skill.skillMdUrl! });
      setProbeResult(result);
    } catch {
      setProbeResult({ status: 0, ok: false });
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {probeResult && (
        <Badge variant={probeResult.ok ? "info" : "warning"}>
          {probeResult.status || "err"}
        </Badge>
      )}
      {hasUrl && (
        <Button
          variant="ghost"
          size="xs"
          onClick={handleProbe}
          disabled={probing}
        >
          {probing ? "..." : "Test"}
        </Button>
      )}
      {(filter === "contentFetchError" || filter === "pendingContentFetch") &&
        hasUrl && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onRetryFetch(skill._id)}
          >
            Retry
          </Button>
        )}
      {(filter === "contentFetchError" ||
        filter === "noUrlRetrying" ||
        filter === "noUrlExhausted") &&
        !hasUrl && (
        <Button
          variant="outline"
          size="xs"
          onClick={() => onRetryDiscovery(skill._id)}
        >
          Re-discover
        </Button>
      )}
      {filter === "contentFetchError" && hasUrl && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onRetryDiscovery(skill._id)}
        >
          Re-discover
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embedding Pipeline Panel
// ---------------------------------------------------------------------------

type EmbedSkill = {
  source: string;
  skillId: string;
  name: string;
  installs: number;
};

function EmbeddingSkillRow({
  skill,
  badge,
}: {
  skill: EmbedSkill;
  badge: { label: string; variant: "warning" | "info" };
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <span className="font-medium truncate">{skill.name}</span>
      <span className="text-muted-foreground truncate">{skill.source}</span>
      <span className="ml-auto text-xs font-mono tabular-nums text-muted-foreground shrink-0">
        {formatInstalls(skill.installs)}
      </span>
      <Badge variant={badge.variant} className="text-[10px] shrink-0">
        {badge.label}
      </Badge>
    </div>
  );
}

function EmbeddingSkillList({
  title,
  tooltip,
  skills,
  badgeVariant,
  badgeLabel,
}: {
  title: string;
  tooltip: string;
  skills: Array<EmbedSkill & { reason?: string }> | undefined;
  badgeVariant: "warning" | "info";
  badgeLabel?: string;
}) {
  if (skills === undefined) {
    return (
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </p>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div>
      <Tooltip>
        <TooltipTrigger
          render={<p />}
          className="mb-2 inline-block text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-help decoration-dashed decoration-muted-foreground/40 underline underline-offset-2"
        >
          {title} ({skills.length})
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{tooltip}</TooltipContent>
      </Tooltip>

      {skills.length === 0 ? (
        <p className="text-xs text-muted-foreground">All clear.</p>
      ) : (
        <div className="rounded-lg border divide-y">
          {skills.slice(0, 20).map((s) => (
            <EmbeddingSkillRow
              key={`${s.source}/${s.skillId}`}
              skill={s}
              badge={{
                label: badgeLabel ?? s.reason ?? "skipped",
                variant: badgeVariant,
              }}
            />
          ))}
          {skills.length > 20 && (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              +{skills.length - 20} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmbeddingPanel() {
  const { data: skipped } = useQuery(
    convexQuery(api.devStats.listUnembeddableSkills, {}),
  );
  const { data: minimal } = useQuery(
    convexQuery(api.devStats.listMinimalModeSkills, {}),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Embedding Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <EmbeddingSkillList
            title="Unembeddable skills"
            tooltip="Skills the worker permanently gave up on — usually because content was too dense to fit OpenAI's per-input token limit even after truncation. Investigate individually if you want to recover them."
            skills={skipped}
            badgeVariant="warning"
          />
          <EmbeddingSkillList
            title="Minimal-mode skills"
            tooltip="Skills embedded with name + description only because their content was too dense to embed in full. These have degraded embeddings — if the count grows large, consider improving the truncation strategy (tiktoken, chunking)."
            skills={minimal}
            badgeVariant="info"
            badgeLabel="minimal"
          />
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          For full coverage stats, run:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
            npx convex run skills:embeddingCoverageStats
          </code>
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Delisted Skills Analysis
// ---------------------------------------------------------------------------

function DelistedAnalysis() {
  const analyze = useAction(api.devStats.analyzeDelistedSkills);
  const [result, setResult] = useState<{
    total: number;
    buckets: Record<string, number>;
    samples: Array<{
      source: string;
      skillId: string;
      installs: number;
      lastSeenInApi: number | undefined;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await analyze({});
      setResult(res);
    } catch (e) {
      toast.error({ title: "Failed to analyze delisted skills" });
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delisted Skills Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={run}
          >
            {loading ? "Analyzing..." : "Analyze"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Buckets delisted skills by last-known install count. Clusters near
            50 → our floor filter; spread across levels → skills.sh upstream
            removals.
          </p>
        </div>
        {result && (
          <div className="mt-4 space-y-3 text-sm">
            <div>
              Total delisted:{" "}
              <strong>{result.total.toLocaleString()}</strong>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Install distribution
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(result.buckets).map(([k, v]) => (
                  <div key={k} className="rounded border px-2 py-1">
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className="font-mono">{v.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Samples (spot-check against skills.sh)
              </div>
              <ul className="space-y-1 font-mono text-xs">
                {result.samples.map((s) => (
                  <li key={`${s.source}/${s.skillId}`}>
                    {s.source}/{s.skillId} — installs: {s.installs}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Featured Bundles
// ---------------------------------------------------------------------------

type FeaturedBundle =
  FunctionReturnType<typeof api.bundles.listFeatured>[number];

function FeaturedBundlesSection() {
  const { data: bundles } = useQuery(
    convexQuery(api.bundles.listFeatured, { includePrivate: true }),
  );
  const setFeatured = useMutation(api.bundles.setBundleFeatured);
  const [pendingId, setPendingId] = useState<Id<"bundles"> | null>(null);

  const handleUnfeature = async (bundleId: Id<"bundles">) => {
    setPendingId(bundleId);
    try {
      await setFeatured({ bundleId, featured: false });
      toast.info({ title: "Removed from featured" });
    } catch (e) {
      toast.error({ title: "Couldn't update featured status" });
      console.error(e);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Featured Bundles</CardTitle>
      </CardHeader>
      <CardContent>
        {bundles === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : bundles.length === 0 ? (
          <EmptyFeaturedState />
        ) : (
          <div className="rounded-lg border divide-y">
            {bundles.map((b) => (
              <FeaturedBundleRow
                key={b._id}
                bundle={b}
                onUnfeature={handleUnfeature}
                isPending={pendingId === b._id}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeaturedBundleRow({
  bundle,
  onUnfeature,
  isPending,
}: {
  bundle: FeaturedBundle;
  onUnfeature: (id: Id<"bundles">) => void;
  isPending: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <HugeiconsIcon
        icon={StarIcon}
        aria-hidden
        className="size-4 fill-primary text-primary shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/stack/${bundle.urlId}`}
            className="truncate text-sm font-medium underline-offset-2 decoration-muted-foreground/40 hover:underline focus-visible:underline outline-none"
          >
            {bundle.name}
          </Link>
          {!bundle.isPublic ? (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 shrink-0">
              Private
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span className="truncate">by {bundle.creatorName}</span>
          <span aria-hidden>·</span>
          <span>
            {bundle.skillCount} skill{bundle.skillCount !== 1 ? "s" : ""}
          </span>
          {bundle.featuredAt !== undefined ? (
            <>
              <span aria-hidden>·</span>
              <span>featured {timeAgo(bundle.featuredAt)}</span>
            </>
          ) : null}
        </div>
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => onUnfeature(bundle._id)}
        loading={isPending}
      >
        Unfeature
      </Button>
    </div>
  );
}

function EmptyFeaturedState() {
  return (
    <div className="rounded-lg border border-dashed px-4 py-10 text-center">
      <HugeiconsIcon
        icon={StarIcon}
        aria-hidden
        strokeWidth={1.5}
        className="mx-auto size-6 text-muted-foreground"
      />
      <p className="mt-3 text-sm font-medium">No featured bundles yet.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Visit any public bundle and click{" "}
        <span className="font-semibold text-foreground">Feature</span> to add
        one. Featured bundles surface in the Featured section on Explore.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin Actions
// ---------------------------------------------------------------------------

function AdminActions() {
  const triggerSync = useAction(api.devStats.triggerSync);
  const triggerBackfill = useAction(api.devStats.triggerBackfill);
  const triggerRecalculate = useAction(api.devStats.triggerRecalculateStats);
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (label: string, fn: () => Promise<unknown>) => {
    setLoading(label);
    try {
      await fn();
      toast.info({ title: `${label} scheduled` });
    } catch (e) {
      toast.error({ title: `Failed to schedule ${label}` });
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  const actions = [
    {
      label: "Run Sync",
      description:
        "Trigger the full skill sync pipeline (fetch API, upsert, discover, content fetch).",
      fn: () => triggerSync({}),
    },
    {
      label: "Backfill Summaries",
      description:
        "Re-populate all skillSummary denormalized fields from the skills table.",
      fn: () => triggerBackfill({ type: "summaries" as const }),
    },
    {
      label: "Refresh Stats",
      description:
        "Recalculate dashboard stat counts by scanning all summaries.",
      fn: () => triggerRecalculate({}),
    },
    {
      label: "Backfill Embeddings",
      description:
        "Generate semantic embeddings for any skills that are missing one.",
      fn: () => triggerBackfill({ type: "embeddings" as const }),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {actions.map((action) => (
            <div
              key={action.label}
              className="flex items-start gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{action.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {action.description}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={loading !== null}
                onClick={() => handleAction(action.label, action.fn)}
              >
                {loading === action.label ? "..." : "Run"}
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Actions run in the background. Check Convex logs for progress.
        </p>
      </CardContent>
    </Card>
  );
}
