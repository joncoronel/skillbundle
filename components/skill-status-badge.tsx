import type { IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  RefreshIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { SignalChip } from "@/components/skill-badges";

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

const STATUS_CHIP_CONFIG: Record<
  Exclude<SkillStatus, null>,
  {
    icon: IconSvgElement;
    label: string;
    tone: "warning" | "info";
    tooltip: string;
  }
> = {
  delisted: {
    icon: ViewOffSlashIcon,
    label: "No longer listed",
    tone: "warning",
    tooltip: "This skill is no longer listed on skills.sh.",
  },
  "fetch-error": {
    icon: Alert02Icon,
    label: "Install may fail",
    tone: "warning",
    tooltip:
      "This skill's source file couldn't be loaded, so the install command may not work.",
  },
  updated: {
    icon: RefreshIcon,
    label: "Updated",
    tone: "info",
    tooltip: "This skill was updated after you added it.",
  },
};

export function SkillStatusBadge({ status }: { status: SkillStatus }) {
  if (!status) return null;
  const { icon, label, tone, tooltip } = STATUS_CHIP_CONFIG[status];
  return <SignalChip icon={icon} label={label} tone={tone} tooltip={tooltip} />;
}
