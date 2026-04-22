"use client";

import * as React from "react";
import { useClerk } from "@clerk/nextjs";
import { revokeSession } from "@/app/(main)/settings/custom/actions";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

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

export function SessionsTab({
  sessionsPromise,
}: {
  sessionsPromise: Promise<BackendSession[]>;
}) {
  const initialSessions = React.use(sessionsPromise);
  const { session: currentSession } = useClerk();
  const [sessions, setSessions] = React.useState(initialSessions);

  const handleRevoke = async (sessionId: string) => {
    try {
      await revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      console.error("Failed to revoke session:", err);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {sessions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No active sessions found.
        </p>
      )}

      {sessions.map((session) => {
        const isCurrent = session.id === currentSession?.id;
        const activity = session.latestActivity;
        const deviceLabel = activity?.deviceType || "Unknown device";
        const browserLabel = activity?.browserName
          ? `${activity.browserName} ${activity.browserVersion ?? ""}`.trim()
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
              <span className="text-xs text-muted-foreground">
                Last active:{" "}
                {session.lastActiveAt
                  ? new Date(session.lastActiveAt).toLocaleString()
                  : "Unknown"}
              </span>
            </div>
            {!isCurrent && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRevoke(session.id)}
                leftSection={<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />}
              >
                Revoke
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
