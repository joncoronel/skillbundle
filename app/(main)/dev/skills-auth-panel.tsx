"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/cubby-ui/card";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { timeAgo } from "@/lib/utils";

/**
 * Which credential the skills.sh sync is running on.
 *
 * The fallback to the legacy API key is silent by design, since the catalog
 * keeps syncing either way. Without this panel a broken relay, or a token
 * skills.sh has started refusing, would go unnoticed until the key itself
 * stopped working. That is the whole point of migrating, so it has to be
 * visible.
 *
 * The verdict is computed here rather than in the query on purpose: a Convex
 * query only re-runs when its read set changes, so a `Date.now()` comparison
 * baked in there would go stale in exactly the case worth catching. See
 * `getSkillsAuthStatus`.
 */
export function SkillsAuthPanel({ admin }: { admin: boolean | undefined }) {
  const {
    data: auth,
    isPending,
    error,
  } = useQuery({
    ...convexQuery(api.devStats.getSkillsAuthStatus, {}),
    enabled: !!admin,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Skills.sh API Auth</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending || !auth ? (
          error ? (
            <p className="text-xs font-medium text-danger-foreground">
              Couldn&apos;t read auth status:{" "}
              <span className="break-words">
                {error instanceof Error ? error.message : "unknown error"}
              </span>
            </p>
          ) : (
            <Skeleton className="h-28 w-full rounded-lg" />
          )
        ) : (
          <AuthDetail auth={auth} />
        )}
      </CardContent>
    </Card>
  );
}

type AuthStatus = FunctionReturnType<typeof api.devStats.getSkillsAuthStatus>;

function AuthDetail({ auth }: { auth: AuthStatus }) {
  const now = useNow();
  if (now === null) return <Skeleton className="h-28 w-full rounded-lg" />;

  const tokenFresh = auth.usableUntil !== null && auth.usableUntil > now;
  // A rejection newer than the last successful refresh means the token we
  // currently hold is the one skills.sh refused, so a fresh expiry proves
  // nothing. Treat it as "not on OIDC" even though the token looks healthy.
  const rejectedSinceRefresh =
    auth.lastOidcRejectedAt !== null &&
    auth.lastOidcRejectedAt > (auth.refreshedAt ?? 0);
  const usingOidc = tokenFresh && !rejectedSinceRefresh;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {usingOidc ? (
          <Badge variant="success">Vercel OIDC</Badge>
        ) : auth.hasLegacyKey ? (
          <Badge variant="warning">Legacy API key</Badge>
        ) : (
          <Badge variant="danger">No credential</Badge>
        )}
        <span className="text-muted-foreground">
          {usingOidc
            ? "sending the relayed OIDC token."
            : auth.hasLegacyKey
              ? "sending SKILLS_SH_API_KEY."
              : "no credential available. Every call will 401."}
        </span>
      </div>

      {/* Rendered in every state, not just the healthy one. When the cron stops
          firing nothing throws, so these two timestamps are the only way to
          tell "never had OIDC" from "lost it an hour ago". */}
      <p className="text-xs text-muted-foreground">
        {auth.refreshedAt
          ? `Last successful refresh ${timeAgo(auth.refreshedAt)}.`
          : "No successful refresh recorded."}{" "}
        {auth.expiresAt
          ? tokenFresh
            ? `Token good for another ${formatDuration(auth.usableUntil! - now)}.`
            : `Token expired ${timeAgo(auth.expiresAt)}.`
          : "No token cached."}{" "}
        Runtime tokens live 2h; refreshed hourly by the{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
          refresh skills.sh OIDC token
        </code>{" "}
        cron.
      </p>

      {rejectedSinceRefresh && (
        <p className="text-xs font-medium text-danger-foreground">
          skills.sh rejected the OIDC token{" "}
          {timeAgo(auth.lastOidcRejectedAt!)}
          {auth.lastOidcRejectedStatus
            ? ` with a ${auth.lastOidcRejectedStatus}`
            : ""}
          . The token itself is fine, so this is upstream refusing it. Check the
          project&apos;s OIDC federation settings.
        </p>
      )}

      {!auth.relayConfigured && (
        <p className="text-xs text-muted-foreground">
          Relay not configured on this deployment: set{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
            SKILLS_TOKEN_URL
          </code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
            SKILLS_TOKEN_SECRET
          </code>
          . Expected on production only.
        </p>
      )}

      {auth.lastRefreshError && (
        <p className="text-xs font-medium break-words text-danger-foreground">
          Last refresh failed
          {auth.lastRefreshErrorAt ? ` ${timeAgo(auth.lastRefreshErrorAt)}` : ""}
          : {auth.lastRefreshError}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Force a refresh with{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
          npx convex run skillsAuth:refreshToken
        </code>
        .
      </p>
    </div>
  );
}

/**
 * Wall clock, ticking, as render state.
 *
 * The whole point of computing the verdict here rather than in the query is
 * that it has to be evaluated against a live clock; reading `Date.now()` in
 * render is both impure and a one-shot, so a panel left open would freeze on
 * the value it had at mount. Against a 2h credential that is long enough to
 * show "good for another 1h 58m" well after it has expired. Null until the
 * first effect so server and client render the same thing.
 */
function useNow(intervalMs = 30_000): number | null {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    // Bucketed to the tick interval so repeated calls between ticks return an
    // identical value. A raw Date.now() here changes on every call, which
    // useSyncExternalStore treats as a perpetually-changing store and loops on.
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    // No clock on the server: render the same placeholder both sides, then
    // upgrade once hydrated.
    () => null,
  );
}

/**
 * Coarse "time until" for a credential measured in minutes, not days.
 *
 * `timeAgo` can't do this: it computes `Date.now() - timestamp`, which is
 * negative for anything in the future and lands in its "just now" branch, so a
 * perfectly healthy 2h token would read as expiring immediately.
 */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
