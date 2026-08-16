import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { GlobalBundleBar } from "@/components/global-bundle-bar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      {/* First focusable thing in the DOM, so Tab-once reaches it. Without it a
          keyboard user crosses 8 header stops — brand, four nav links, theme,
          and both auth actions — before any page content, on every navigation.

          `z-50` because the header's layering contract tops out at z-40 for the
          pill (see app-header.tsx); this has to clear it while visible. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-surface-3 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-[var(--surface-shadow-3),var(--surface-rim-3)] focus:outline-2 focus:outline-offset-2 focus:outline-ring/60"
      >
        Skip to content
      </a>

      <AppHeader />

      {/* THE landmark for every route in this group, and the skip link's target.
          Pages render their own width/padding wrapper inside it and must NOT
          render a `<main>` of their own — nesting two is invalid and both would
          be visible, unlike the hidden one React parks during streaming.

          It lives here because per-page landmarks failed silently: `/[org]`,
          `/[org]/[repo]` and `/site/[source]` shipped with no `<main>` at all
          and nothing caught it. A layout cannot be missed, including by routes
          added later. `e2e/instant-navigation.spec.ts` asserts exactly one.

          `tabIndex={-1}` lets it accept programmatic focus; without it the
          browser scrolls but focus stays in the header, so the next Tab returns
          there and the skip link achieves nothing. Its own focus ring is
          suppressed because a ring around the whole page reads as a rendering
          fault — the first Tab after the jump shows a real one. */}
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      {/* Lives in the layout (not per page) so the same instance — and its
          open/collapsed state — persists across home ↔ compare navigations.
          GlobalBundleBar reads usePathname() to gate visibility, which suspends
          during a dynamic route's App Shell, so it sits behind <Suspense>; the
          bar self-hides on an empty selection, so the null fallback is correct. */}
      <Suspense fallback={null}>
        <GlobalBundleBar />
      </Suspense>
    </div>
  );
}
