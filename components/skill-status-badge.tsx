import type { IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  RefreshIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { SignalIcon, type SignalTone } from "@/components/skill-badges";

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

const STATUS_ICON_CONFIG: Record<
  Exclude<SkillStatus, null>,
  {
    icon: IconSvgElement;
    label: string;
    // Status icons only ever use these two of SignalIcon's tones (never "muted").
    tone: Extract<SignalTone, "warning" | "info">;
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
  const { icon, label, tone, tooltip } = STATUS_ICON_CONFIG[status];
  return <SignalIcon icon={icon} label={label} tone={tone} tooltip={tooltip} />;
}
