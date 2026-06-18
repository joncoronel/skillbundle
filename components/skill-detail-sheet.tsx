"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { LabeledSection } from "@/components/labeled-section";
import { api } from "@/convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  createSheetHandle,
} from "@/components/ui/cubby-ui/sheet";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Copy01Icon,
  GitCompareIcon,
  PlusSignIcon,
  MinusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Button, buttonVariants } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { useCopyToClipboard } from "@/components/ui/cubby-ui/copy-button/hooks/use-copy-to-clipboard";
import {
  useBundleActions,
  useIsSkillSelected,
} from "@/lib/bundle-selection";
import { generateInstallCommands } from "@/lib/install-commands";
import { compareHref } from "@/lib/compare";
import { formatInstalls } from "@/lib/utils";
import type { SkillData } from "@/components/skill-card";
import { OfficialBadge } from "@/components/skill-badges";
import { SkillAuditSection } from "@/components/skill-audit-section";
import { skillHref } from "@/lib/skill-urls";

// Streamdown + shiki are heavy and only render after the user opens a sheet,
// so keep them out of the discovery list's initial JS payload.
const MarkdownContent = dynamic(
  () =>
    import("@/components/markdown-content").then((m) => ({
      default: m.MarkdownContent,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    ),
  },
);

export type SkillDetailHandle = ReturnType<typeof createSheetHandle<SkillData>>;

export function createSkillDetailHandle() {
  return createSheetHandle<SkillData>();
}

/**
 * Footer action mode.
 *
 *  - `"select"` (default): toggles the skill in the global bundle-selection
 *    store. Used on the homepage / explore where the bottom BundleBar
 *    reads from that store and the user is composing a new bundle.
 *  - `"copy-install"`: copies a single-skill `npx skills add` command to
 *    the clipboard. Used on the bundle detail page, where the selection
 *    store has no visible surface (BundleBar isn't mounted) and the
 *    useful action for an individual skill is "install just this one."
 */
type FooterAction = "select" | "copy-install";

interface SkillDetailSheetProps {
  handle: SkillDetailHandle;
  footerAction?: FooterAction;
}

export function SkillDetailSheet({
  handle,
  footerAction = "select",
}: SkillDetailSheetProps) {
  return (
    <Sheet handle={handle}>
      {({ payload: skill }) => (
        <SheetContent side="right" variant="floating" className="sm:max-w-lg">
          {skill && (
            <SkillDetailSheetContent
              skill={skill}
              handle={handle}
              footerAction={footerAction}
            />
          )}
        </SheetContent>
      )}
    </Sheet>
  );
}

function SkillDetailSheetContent({
  skill,
  handle,
  footerAction,
}: {
  skill: SkillData;
  handle: SkillDetailHandle;
  footerAction: FooterAction;
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-display font-medium flex items-center gap-1.5">
          {skill.name}
          {skill.curatedOwner && <OfficialBadge owner={skill.curatedOwner} />}
        </SheetTitle>
        <SheetDescription>
          <span className="tabular-nums">
            {formatInstalls(skill.installs)} installs
          </span>
          {" · "}
          <a
            href={`https://github.com/${skill.source}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {skill.source}
          </a>
        </SheetDescription>
      </SheetHeader>
      <SheetBody>
        <SkillDetailBody skill={skill} />
      </SheetBody>
      <SheetFooter>
        <Link
          href={skillHref(skill.source, skill.skillId)}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          onNavigate={() => handle.close()}
        >
          View full page
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </Link>
        <Link
          href={compareHref([{ source: skill.source, skillId: skill.skillId }])}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          onNavigate={() => handle.close()}
        >
          <HugeiconsIcon
            icon={GitCompareIcon}
            strokeWidth={2}
            className="size-3.5"
          />
          Compare
        </Link>
        {footerAction === "copy-install" ? (
          <CopyInstallButton skill={skill} />
        ) : (
          <BundleToggleButton skill={skill} />
        )}
      </SheetFooter>
    </>
  );
}

function SkillDetailBody({ skill }: { skill: SkillData }) {
  // Fetch content + audits in parallel and gate the body render on BOTH.
  // The detail sheet is a single visual block — letting audits resolve and
  // paint before the markdown lands causes the audit section to flash in
  // and then jump down when the longer documentation finally renders. Wait
  // for both before showing anything.
  //
  // Direct Convex queries by design — see the cost note in
  // app/(main)/compare/compare-content.tsx (CompareColumn) for the cached
  // route-handler escape hatch and when it would be worth switching to it.
  const { data: contentData, isPending: contentLoading } = useQuery(
    convexQuery(api.skills.getContent, {
      source: skill.source,
      skillId: skill.skillId,
    }),
  );
  const { data: auditData, isPending: auditLoading } = useQuery(
    convexQuery(api.audits.getBySourceAndSkillId, {
      source: skill.source,
      skillId: skill.skillId,
    }),
  );

  if (contentLoading || auditLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  const content = contentData?.content ?? null;
  const baseUrl = contentData?.skillMdUrl ?? null;
  const audits = auditData?.audits ?? null;

  // Mirrors the full detail page (components/skill-detail-page.tsx): render
  // each section independently and show a fallback at the bottom only when
  // both description and content are absent. The audit section is an
  // independent signal — a skill with no docs but a real audit verdict is
  // still worth showing, especially for skills whose SKILL.md couldn't be
  // discovered upstream.
  return (
    <div className="space-y-8">
      {skill.description && (
        <LabeledSection label="Overview">
          <p className="text-base leading-relaxed text-pretty text-muted-foreground">
            {skill.description}
          </p>
        </LabeledSection>
      )}
      <SkillAuditSection
        source={skill.source}
        skillId={skill.skillId}
        audits={audits}
      />
      {content && (
        <LabeledSection label="Documentation">
          <MarkdownContent baseUrl={baseUrl} surface="card">
            {content}
          </MarkdownContent>
        </LabeledSection>
      )}
      {!content && !skill.description && (
        <p className="text-sm text-muted-foreground">
          No detailed content available for this skill.
        </p>
      )}
    </div>
  );
}

function BundleToggleButton({ skill }: { skill: SkillData }) {
  const isSelected = useIsSkillSelected(skill.source, skill.skillId);
  const { toggleSkill } = useBundleActions();
  return (
    <Button
      variant={isSelected ? "outline" : "primary"}
      size="sm"
      leftSection={
        <HugeiconsIcon
          icon={isSelected ? MinusSignIcon : PlusSignIcon}
          strokeWidth={2}
          className="size-3.5"
        />
      }
      onClick={() =>
        toggleSkill({
          source: skill.source,
          skillId: skill.skillId,
          name: skill.name,
        })
      }
    >
      {isSelected ? "Remove from bundle" : "Add to bundle"}
    </Button>
  );
}

function CopyInstallButton({ skill }: { skill: SkillData }) {
  // Defer to the canonical install-command generator so the format stays
  // in lockstep with the bundle-level install commands (single source of
  // truth for `npx skills add ...`).
  const command = generateInstallCommands([
    { source: skill.source, skillId: skill.skillId },
  ])[0]?.command;
  // useCopyToClipboard owns the 2s `isCopied` reset and its unmount
  // cleanup — covers the case where the sheet closes during the window
  // (which would otherwise schedule setState on a torn-down component).
  // It also adds an `execCommand` fallback for insecure contexts where
  // navigator.clipboard throws.
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  async function handleCopy() {
    if (!command) return;
    const success = await copyToClipboard(command);
    if (!success) {
      // Both navigator.clipboard and the execCommand fallback failed —
      // tell the user instead of leaving the button stuck.
      toast.error({
        title: "Couldn't copy",
        description: "Your browser blocked clipboard access.",
      });
    }
  }

  return (
    <Button
      variant="primary"
      size="sm"
      onClick={handleCopy}
      leftSection={
        <HugeiconsIcon
          icon={isCopied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      }
    >
      {isCopied ? "Copied!" : "Copy install"}
    </Button>
  );
}
