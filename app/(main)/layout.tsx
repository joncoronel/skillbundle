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
          open/collapsed state — persists across home ↔ compare navigations. */}
      <GlobalBundleBar />
    </div>
  );
}
