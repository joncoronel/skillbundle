import { Badge } from "@/components/ui/cubby-ui/badge";

export type SkillStatus = "delisted" | "fetch-error" | "updated" | null;

export function deriveSkillStatus(props: {
  isDelisted?: boolean;
  hasContentFetchError?: boolean;
  updatedSinceAdded?: boolean;
}): SkillStatus {
  if (props.isDelisted) return "delisted";
  if (props.hasContentFetchError) return "fetch-error";
  if (props.updatedSinceAdded) return "updated";
  return null;
}

const STATUS_BADGE_CONFIG: Record<
  Exclude<SkillStatus, null>,
  { label: string; variant: "warning" | "info" }
> = {
  delisted: { label: "No longer listed", variant: "warning" },
  "fetch-error": { label: "Install may fail", variant: "warning" },
  updated: { label: "Updated", variant: "info" },
};

export function SkillStatusBadge({ status }: { status: SkillStatus }) {
  if (!status) return null;
  const { label, variant } = STATUS_BADGE_CONFIG[status];
  return (
    <Badge variant={variant} className="text-[10px] px-1.5 py-0.5">
      {label}
    </Badge>
  );
}
