import { Suspense } from "react";
import { verifyAdmin } from "@/lib/auth";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { AddSkillForm } from "./add-skill-form";

export default function AddSkillPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 pt-12 pb-20">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-medium tracking-tight">
          Add Skill Manually
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Insert a skill from skills.sh into the catalog, bypassing the
          50-install leaderboard threshold. Admin-only.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
        <AddSkillLoader />
      </Suspense>
    </main>
  );
}

async function AddSkillLoader() {
  await verifyAdmin();
  return <AddSkillForm />;
}
