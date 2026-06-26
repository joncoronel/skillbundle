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
      <AppHeader />
      {children}
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
