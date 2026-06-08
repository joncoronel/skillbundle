import { SkillDetailContentSkeleton } from "@/components/skill-detail-page";

// Shown on the first (uncached) visit while the page prerenders, and during
// client navigations until the prerendered page is ready. Mirrors the GitHub
// skill route's loading.tsx.
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      <SkillDetailContentSkeleton />
    </div>
  );
}
