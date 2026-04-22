import { Suspense } from "react";
import type { Metadata } from "next";
import { UserProfile } from "@clerk/nextjs";
import { verifySession } from "@/lib/auth";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl py-8 px-4">
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <SettingsLoader />
      </Suspense>
    </div>
  );
}

async function SettingsLoader() {
  await verifySession();
  return <UserProfile routing="hash" />;
}
