"use client";

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, which
 * `app/(main)/error.tsx` sits below and therefore cannot cover.
 *
 * Two constraints from the file convention shape this file:
 *
 * 1. `global-error` replaces the whole document, so it renders its own <html>
 *    and <body> — and it does NOT receive the app's global stylesheet. Tailwind
 *    classes would not resolve here, so everything is inline. `color-scheme`
 *    lets the browser pick sensible default colors in both themes without a
 *    theme provider.
 * 2. `metadata` / `generateMetadata` exports are not supported here, so the tab
 *    title is a plain <title> element.
 *
 * `retry()` rather than `reset()`: reset only clears client state and re-renders,
 * which cannot recover from a failed Server Component render. This app's realistic
 * failure is Convex being unreachable during a server render, and only retry()
 * re-runs that.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong | SkillBundle</title>
      </head>
      <body
        style={{
          colorScheme: "light dark",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          lineHeight: 1.5,
        }}
      >
        <main style={{ maxWidth: "32rem", width: "100%" }}>
          <p
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              opacity: 0.6,
              margin: "0 0 1.5rem",
            }}
          >
            500 INTERNAL_ERROR
          </p>

          <h1
            style={{
              fontSize: "clamp(1.75rem, 5vw, 2.5rem)",
              fontWeight: 500,
              letterSpacing: "-0.02em",
              margin: "0 0 1rem",
            }}
          >
            Something went wrong.
          </h1>

          <p style={{ opacity: 0.7, margin: "0 0 2rem" }}>
            The page failed to load. This is usually temporary — trying again
            often works.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                font: "inherit",
                cursor: "pointer",
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid currentColor",
                background: "transparent",
                color: "inherit",
              }}
            >
              Try again
            </button>
            {/* Intentionally a plain <a>, not next/link. This boundary only
                renders when the root layout itself failed, so the router and
                provider tree are not in a trustworthy state — a client-side
                navigation would try to reuse them. A hard document load is the
                reliable way out. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                font: "inherit",
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid transparent",
                textDecoration: "underline",
                color: "inherit",
              }}
            >
              Back home
            </a>
          </div>

          {/* Server Component errors arrive here with a generic message and a
              digest. Surfacing it gives the user something quotable that maps
              to the server logs. */}
          {error.digest ? (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                opacity: 0.5,
                marginTop: "2rem",
              }}
            >
              Error ID: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
