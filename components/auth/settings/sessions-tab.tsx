"use client";

import * as React from "react";
import { useSession } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { revokeSession } from "@/app/(main)/settings/actions";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { timeAgo } from "@/lib/utils";

export interface BackendSession {
  id: string;
  status: string;
  lastActiveAt: number;
  createdAt: number;
  latestActivity: {
    deviceType?: string;
    browserName?: string;
    browserVersion?: string;
    ipAddress?: string;
    city?: string;
    country?: string;
    isMobile?: boolean;
  } | null;
}

export function SessionsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-lg border p-3"
        >
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * How many rows render before the list collapses behind "Show all".
 *
 * `getSessions` asks Clerk for up to 50 active sessions and this list used to
 * render every one of them, unbounded. That is not a hypothetical: a session is
 * created per sign-in and Clerk keeps them for days, so the test account reached
 * 45 rows and roughly 10,000px, which put the Danger zone below it out of reach
 * and made the tab a wall of near-identical lines. Five covers the devices
 * someone actually recognises; the rest is an audit trail they can open.
 */
const COLLAPSED_COUNT = 5;

export function SessionsTab({ sessions }: { sessions: BackendSession[] }) {
  // `useSession`, not `useClerk`, for its `isLoaded` flag. The server action
  // feeding this list can resolve before Clerk hydrates, and until it does no
  // row is the current one: nothing carries "This device", the sort falls back
  // to recency, and every row shows Revoke, including the session you are
  // sitting in. Holding the skeleton is cheaper than letting the list reorder
  // and grow a button under the pointer.
  const { isLoaded, session: currentSession } = useSession();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = React.useState(false);
  const [revoking, setRevoking] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const listId = React.useId();

  if (!isLoaded) return <SessionsSkeleton />;

  // Current device first, then most recently active. Clerk returns them in no
  // order that helps: "This device" was landing sixth, so the one row a reader
  // is looking for to get their bearings was buried among identical ones.
  const ordered = [...sessions].sort((a, b) => {
    if (a.id === currentSession?.id) return -1;
    if (b.id === currentSession?.id) return 1;
    return b.lastActiveAt - a.lastActiveAt;
  });
  const hidden = Math.max(0, ordered.length - COLLAPSED_COUNT);
  const visible = expanded ? ordered : ordered.slice(0, COLLAPSED_COUNT);

  const handleRevoke = async (sessionId: string) => {
    // A set, not a single id: nothing serialises these, so revoking a second
    // row while the first is still in flight would otherwise clear the first
    // row's pending state and leave it looking idle mid-request.
    setRevoking((prev) => new Set(prev).add(sessionId));
    try {
      await revokeSession(sessionId);
      // Write through the query cache, not into local state. Base UI unmounts
      // an inactive tab panel (`keepMounted` defaults to false), so a
      // component-local copy is discarded on every tab switch and reseeded
      // from a cache that still holds the revoked row, which then comes back
      // looking active.
      queryClient.setQueryData<BackendSession[]>(
        ["clerk-sessions"],
        (prev) => prev?.filter((s) => s.id !== sessionId) ?? prev,
      );
    } catch (err) {
      // Logged as well as toasted: `revokeSession` throws distinguishable
      // errors ("Not authenticated", "Not authorized to revoke this session")
      // that all collapse into one message for the user.
      console.error("Failed to revoke session:", err);
      toast.error({
        title: "Could not revoke that session",
        description: "Please try again.",
      });
    } finally {
      setRevoking((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {ordered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No active sessions found.
        </p>
      )}

      <div id={listId} className="flex flex-col gap-3">
        {visible.map((session) => {
          const isCurrent = session.id === currentSession?.id;
          const activity = session.latestActivity;
          // Browser first, because that is what distinguishes one row from
          // another. Keying the heading on `deviceType` alone printed "Windows"
          // down the whole list and pushed the only varying part into the
          // secondary line.
          const browser = activity?.browserName;
          const device = activity?.deviceType;
          const deviceLabel = browser
            ? device
              ? `${browser} on ${device}`
              : browser
            : (device ?? "Unknown device");
          const browserLabel =
            browser && activity?.browserVersion
              ? `Version ${activity.browserVersion}`
              : null;
          const locationParts = [activity?.city, activity?.country].filter(
            Boolean,
          );
          const locationLabel =
            locationParts.length > 0 ? locationParts.join(", ") : null;

          return (
            <div
              key={session.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{deviceLabel}</span>
                  {isCurrent && <Badge variant="success">This device</Badge>}
                </div>
                {browserLabel && (
                  <span className="text-xs text-muted-foreground">
                    {browserLabel}
                  </span>
                )}
                {(activity?.ipAddress || locationLabel) && (
                  <span className="text-xs text-muted-foreground">
                    {[activity?.ipAddress, locationLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                {/* Relative, not `toLocaleString()`. "Last active 2h ago" is
                  the question being asked of this list; a full local
                  timestamp on every row is four numbers to parse per session.
                  Safe here because this list is fetched client-side and never
                  prerendered, so `timeAgo` cannot cause a hydration mismatch.

                  The exact time is not left to `title`, which reaches a mouse
                  and nothing else. `dateTime` puts it in the markup and the
                  `sr-only` span reads it out, so the rounding in `timeAgo`
                  does not hide the detail that identifies a session you do not
                  recognise.

                  No `title` beside that span. It carried the same string, and
                  a `title` on an element that already has text content becomes
                  the accessible description, so a screen reader can announce
                  the timestamp twice. The hover tooltip is the smaller loss. */}
                {session.lastActiveAt ? (
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={new Date(session.lastActiveAt).toISOString()}
                  >
                    Last active {timeAgo(session.lastActiveAt)}
                    <span className="sr-only">
                      , {new Date(session.lastActiveAt).toLocaleString()}
                    </span>
                  </time>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Last active unknown
                  </span>
                )}
              </div>
              {!isCurrent && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRevoke(session.id)}
                  loading={revoking.has(session.id)}
                  leadingIcon={
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  }
                >
                  Revoke
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
        >
          {expanded ? "Show fewer" : `Show all ${ordered.length} sessions`}
        </Button>
      )}
    </div>
  );
}
