"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { parseSkillInput } from "@/lib/parse-skill-input";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/cubby-ui/card";
import { toast } from "@/components/ui/cubby-ui/toast/toast";

type AddResult = {
  status: "inserted" | "relisted" | "already_exists";
  source: string;
  skillId: string;
  name: string;
};

export function AddSkillForm() {
  const { data: admin } = useQuery(convexQuery(api.devStats.isAdmin, {}));
  const addSkill = useAction(api.skills.addSkillManually);

  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [lastAdded, setLastAdded] = useState<AddResult | null>(null);

  if (admin === false) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        You don&apos;t have access to this page.
      </p>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || pending) return;

    // Validate the input shape client-side BEFORE calling the action. Convex
    // intentionally forwards all server-side throws to the browser console in
    // dev (visible as a red "Server Error" overlay), and there's no way to
    // suppress that — even with ConvexError. Validating client-side means
    // bad input never reaches the server, so no overlay for what's really
    // just a typo. The action still re-validates as defense-in-depth.
    try {
      parseSkillInput(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error({
        title: "Couldn't add skill",
        description: friendlyError(message),
      });
      return;
    }

    setPending(true);
    try {
      const result = await addSkill({ input: trimmed });
      setLastAdded(result);
      setInput("");
      switch (result.status) {
        case "inserted":
          toast.success({
            title: "Skill added",
            description: `${result.name} is now in the catalog. SKILL.md will fill in shortly.`,
          });
          break;
        case "relisted":
          toast.success({
            title: "Skill relisted",
            description: `${result.name} was previously delisted and is now active again.`,
          });
          break;
        case "already_exists":
          toast.info({
            title: "Already in catalog",
            description: `${result.name} is already listed. No changes made.`,
          });
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const friendly = friendlyError(message);
      toast.error({ title: "Couldn't add skill", description: friendly });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Skill URL or source/slug</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="text"
              placeholder="vercel-labs/agent-skills/next-js-development"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={pending}
              autoFocus
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Paste a skills.sh URL or the <code>source/slug</code> form. The
                skill must already exist on skills.sh.
              </p>
              <Button type="submit" disabled={!input.trim() || pending}>
                {pending ? "Adding…" : "Add to catalog"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {lastAdded && (
        <Card>
          <CardHeader>
            <CardTitle>Last added</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{lastAdded.status}</dd>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{lastAdded.name}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="font-mono text-xs">{lastAdded.source}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="font-mono text-xs">{lastAdded.skillId}</dd>
            </dl>
            <div className="mt-4">
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={skillDetailHref(lastAdded.source, lastAdded.skillId)}
                    target="_blank"
                  />
                }
              >
                Open on skillstack
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// GitHub sources route as /[org]/[repo]/[skillId]; well-known sources route
// as /site/[source]/[skillId]. Mirrors isGitHubSource on the backend.
function skillDetailHref(source: string, skillId: string): string {
  const parts = source.split("/");
  const isGitHub = parts.length === 2 && !parts[0].includes(".");
  return isGitHub
    ? `/${source}/${skillId}`
    : `/site/${source}/${skillId}`;
}

// Convert raw error strings from the Convex action into something the admin
// can actually act on. Avoids surfacing internal stack-trace prefixes
// (e.g. "[Request ID: ...]") in toasts.
function friendlyError(raw: string): string {
  const cleaned = raw.replace(/\[Request ID:.*?\]\s*/g, "").trim();
  if (/URL must be from skills\.sh/i.test(cleaned)) {
    return "That URL isn't from skills.sh. Paste a skills.sh URL or a source/slug.";
  }
  if (/looks like a domain/i.test(cleaned)) {
    return cleaned;
  }
  if (/skills\.sh API 404/i.test(cleaned)) {
    return "Skill not found on skills.sh. Manual adds must already be listed there.";
  }
  if (/not authorized/i.test(cleaned) || /not authenticated/i.test(cleaned)) {
    return "You don't have permission to add skills.";
  }
  if (/Slug is missing|Invalid skill input|Skill input is empty/i.test(cleaned)) {
    return cleaned;
  }
  return cleaned || "Unknown error.";
}
