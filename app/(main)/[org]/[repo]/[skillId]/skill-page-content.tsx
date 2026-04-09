import Link from "next/link";
import Markdown from "react-markdown";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { formatInstalls, timeAgo } from "@/lib/utils";

interface Skill {
  source: string;
  skillId: string;
  name: string;
  description?: string;
  installs: number;
  contentUpdatedAt?: number;
  createdAt: number;
  isDelisted: boolean;
  hasContentFetchError: boolean;
}

interface SkillPageContentProps {
  skill: Skill;
  content: string | null;
}

export function SkillPageContent({ skill, content }: SkillPageContentProps) {
  const installCommand = `npx skills add ${skill.source} --skill ${skill.skillId}`;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-12 pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6">
        <Link href="/" className="hover:text-foreground transition-colors">
          Home
        </Link>
        <span>/</span>
        <span>{skill.source}</span>
        <span>/</span>
        <span className="text-foreground">{skill.skillId}</span>
      </nav>

      {/* Delisted banner */}
      {skill.isDelisted && (
        <div className="mb-4 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill is no longer listed on skills.sh
        </div>
      )}

      {/* Header */}
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">{skill.name}</h1>

      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <span className="tabular-nums">
          {formatInstalls(skill.installs)} installs
        </span>
        <span>·</span>
        <a
          href={`https://github.com/${skill.source}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors hover:underline"
        >
          {skill.source}
        </a>
        <span>·</span>
        {skill.contentUpdatedAt ? (
          <span>Updated {timeAgo(skill.contentUpdatedAt)}</span>
        ) : (
          <span>Added {timeAgo(skill.createdAt)}</span>
        )}
      </div>

      {/* Install warning */}
      {skill.hasContentFetchError && !skill.isDelisted && (
        <div className="mb-4 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill&apos;s source file could not be found in its repository. The install command may not work.
        </div>
      )}

      {/* Install command */}
      <div className="group relative rounded-xl bg-muted mb-8">
        <pre className="overflow-x-auto px-4 py-3 text-sm font-mono pr-16">
          {installCommand}
        </pre>
        <div className="absolute top-1.5 right-1.5">
          <CopyButton content={installCommand} />
        </div>
      </div>

      {/* Content */}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        {skill.description && (
          <p className="lead text-muted-foreground">{skill.description}</p>
        )}
        {content ? (
          <Markdown>{content}</Markdown>
        ) : !skill.description ? (
          <p className="text-muted-foreground">
            No detailed content available for this skill.
          </p>
        ) : null}
      </div>
    </div>
  );
}
