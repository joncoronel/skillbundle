"use client";

import * as React from "react";
import { useUser, useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  ReverificationProvider,
  useReverificationFlow,
} from "@/components/auth/reverification-provider";
import { useMyRepos } from "@/hooks/use-my-repos";

// Where GitHub sends the user back after the OAuth consent screen — repo mode
// on the home page, so they land exactly where they left.
const RETURN_URL = "/?mode=repo";

/**
 * The GitHub-connection affordance in repo-mode's empty state. Repo
 * *suggestions* live in the composer input (an Autocomplete over the repos
 * this connection unlocks); this component owns everything before that works:
 * connect, grant-scope, reconnect, and failed-connect states, collapsing to a
 * one-line hint once the connection is healthy.
 *
 * The parent gates rendering to resolved-Pro users; the server re-checks the
 * plan and the token on every call, so nothing here is authoritative.
 */
export function RepoPicker() {
  return (
    <ReverificationProvider>
      <RepoPickerInner />
    </ReverificationProvider>
  );
}

function RepoPickerInner() {
  const { user, isLoaded } = useUser();
  const {
    account,
    failedAccount,
    hasRepoScope,
    serverStatus,
    repos,
    reposPending,
    reposError,
    refetchRepos,
  } = useMyRepos();
  const onNeedsReverification = useReverificationFlow();
  const [connecting, setConnecting] = React.useState(false);
  const [connectError, setConnectError] = React.useState(false);

  const connectGitHub = useReverification(
    () =>
      user?.createExternalAccount({
        strategy: "oauth_github",
        additionalScopes: ["repo"],
        redirectUrl: RETURN_URL,
      }),
    { onNeedsReverification },
  );
  const reauthorizeGitHub = useReverification(
    () =>
      account?.reauthorize({
        additionalScopes: ["repo"],
        redirectUrl: RETURN_URL,
      }),
    { onNeedsReverification },
  );
  const destroyFailedAccount = useReverification(
    () => failedAccount?.destroy(),
    { onNeedsReverification },
  );

  // Clerk returns a GitHub consent URL to navigate to; the reauthorize path is
  // for an account that's already linked (a second createExternalAccount for
  // the same provider fails).
  const startOAuth = async (mode: "connect" | "reauthorize" | "retry") => {
    setConnectError(false);
    setConnecting(true);
    try {
      // A retry after a rejected connect must clear the dead unverified
      // record first — createExternalAccount fails while one lingers.
      if (mode === "retry" && failedAccount) {
        await destroyFailedAccount();
        await user?.reload();
      }
      const res =
        mode === "reauthorize" && account
          ? await reauthorizeGitHub()
          : await connectGitHub();
      const url = res?.verification?.externalVerificationRedirectURL?.href;
      if (url) {
        globalThis.location.assign(url);
        return; // keep `connecting` while the page navigates away
      }
      setConnectError(true);
    } catch (err) {
      if (!isReverificationCancelledError(err)) {
        console.error("Failed to start GitHub connect:", err);
        setConnectError(true);
      }
    }
    setConnecting(false);
  };

  if (!isLoaded || !user) return null;

  // A rejected connect attempt: explain the rejection instead of silently
  // showing "Connect GitHub" again. Clerk never links a GitHub identity whose
  // email another user owns (account-takeover protection), so the honest
  // recovery is a different GitHub account — or signing into the account that
  // owns that email.
  if (failedAccount) {
    const claimed =
      failedAccount.verification?.error?.code === "oauth_identification_claimed";
    return (
      <ConnectPrompt
        label="Try a different GitHub account"
        caption={
          claimed
            ? "That GitHub account's email already belongs to a different SkillBundle account. Sign in to that account to use it here, or connect a GitHub account with a different email."
            : (failedAccount.verification?.error?.longMessage ??
              "The GitHub connection didn't complete. Try again.")
        }
        connecting={connecting}
        showError={connectError}
        onClick={() => startOAuth("retry")}
      />
    );
  }

  if (!account || serverStatus === "not_connected") {
    return (
      <ConnectPrompt
        label="Connect GitHub"
        caption="Pick from your own repos — private ones included — right in the field above. GitHub's permission model makes repo access broad; we only read file listings and manifests."
        connecting={connecting}
        showError={connectError}
        onClick={() => startOAuth("connect")}
      />
    );
  }

  if (!hasRepoScope || serverStatus === "missing_scope") {
    return (
      <ConnectPrompt
        label="Grant private repo access"
        caption="Your GitHub account is connected without repo access. Granting it lets you pick from all your repos, private ones included."
        connecting={connecting}
        showError={connectError}
        onClick={() => startOAuth("reauthorize")}
      />
    );
  }

  if (serverStatus === "token_invalid") {
    return (
      <ConnectPrompt
        label="Reconnect GitHub"
        caption="GitHub access expired or was revoked — reconnect to pick from your repos."
        connecting={connecting}
        showError={connectError}
        onClick={() => startOAuth("reauthorize")}
      />
    );
  }

  if (reposError || serverStatus === "error") {
    return (
      <div className="mt-5">
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load your repositories.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => refetchRepos()}
        >
          Try again
        </Button>
      </div>
    );
  }

  // Healthy connection: the composer input is now the picker, so this
  // collapses to a pointer at it. aria-live keeps the transition from
  // "loading" honest for assistive tech without a spinner.
  return (
    <p
      className="mt-4 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {reposPending
        ? "Loading your repositories…"
        : repos.length === 0
          ? "No repositories on your GitHub account yet."
          : `GitHub connected — start typing above to pick from your ${repos.length} repos.`}
    </p>
  );
}

function ConnectPrompt({
  label,
  caption,
  connecting,
  showError,
  onClick,
}: {
  label: string;
  caption: string;
  connecting: boolean;
  showError: boolean;
  onClick: () => void;
}) {
  return (
    <div className="mt-5">
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={connecting}
      >
        <HugeiconsIcon
          icon={GithubIcon}
          strokeWidth={2}
          className="size-3.5"
        />
        {connecting ? "Opening GitHub…" : label}
      </Button>
      <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
        {caption}
      </p>
      {showError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Couldn&rsquo;t start the GitHub connection. Please try again.
        </p>
      )}
    </div>
  );
}
