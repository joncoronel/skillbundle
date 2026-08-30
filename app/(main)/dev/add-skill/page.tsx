import { Suspense } from "react";
import { verifyAdmin } from "@/lib/auth";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { AddSkillForm } from "./add-skill-form";

export default function AddSkillPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-12 pb-20">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Add Skill Manually
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Insert a skill into the catalog by hand: one skills.sh lists but the
          leaderboard feed missed, or one that only exists in a GitHub repo.
          Admin-only.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
        <AddSkillLoader />
      </Suspense>
    </div>
  );
}

async function AddSkillLoader() {
  await verifyAdmin();
  return <AddSkillForm />;
}
