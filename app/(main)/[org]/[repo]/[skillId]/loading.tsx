import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export default function SkillLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-12">
      {/* Breadcrumb */}
      <Skeleton className="h-4 w-48 mb-6" />
      {/* Title */}
      <Skeleton className="h-9 w-80 mb-3" />
      {/* Meta (installs + source) */}
      <Skeleton className="h-4 w-56 mb-4" />
      {/* Tech badges */}
      <div className="flex gap-1.5 mb-8">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      {/* Install command */}
      <Skeleton className="h-12 w-full rounded-xl mb-8" />
      {/* Content lines */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
