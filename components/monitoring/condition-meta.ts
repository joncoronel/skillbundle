import type { IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  FileEditIcon,
  SecurityWarningIcon,
  TextAlignLeftIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";

import type { Condition, GroupKey } from "@/lib/monitoring/conditions";

/**
 * How each condition presents: glyph, the words that carry it, and its hue.
 *
 * One table for both surfaces. The dashboard had a three-row `KIND_META` and
 * the register a six-row `CONDITION_META` with the same icons and the same
 * labels — two tables meant the dashboard had no row for a delisted skill,
 * which is a large part of why it could not report one.
 */
export const CONDITION_META: Record<
  Condition,
  { icon: IconSvgElement | null; label: string; tone: string }
> = {
  audit: {
    icon: SecurityWarningIcon,
    label: "Security verdict changed",
    tone: "text-danger-foreground",
  },
  delisted: {
    icon: ViewOffSlashIcon,
    label: "No longer listed",
    tone: "text-warning-foreground",
  },
  "fetch-error": {
    icon: Alert02Icon,
    label: "Install may fail",
    tone: "text-warning-foreground",
  },
  description: {
    icon: TextAlignLeftIcon,
    label: "Description changed",
    tone: "text-warning-foreground",
  },
  content: {
    icon: FileEditIcon,
    label: "Content edited",
    tone: "text-muted-foreground",
  },
  // No glyph. `CheckmarkBadge02Icon` was here and it is the Official mark's
  // icon (skill-badges.tsx) — the same shape meaning "verified first-party" in
  // the catalog and "nothing wrong" here. Beyond the collision, a marker on
  // every healthy row is not a marker: the column exists so the eye lands on
  // the few rows that need something, and forty checkmarks defeat that. Steady
  // reads as an empty cell, and says "Steady" to a screen reader.
  steady: {
    icon: null,
    label: "Steady",
    tone: "text-muted-foreground",
  },
};

export const GROUP_LABEL: Record<GroupKey, string> = {
  attention: "Needs attention",
  changed: "Changed",
  steady: "Steady",
};

/**
 * Audit verdicts and risk levels arrive as raw enums — lowercase from our own
 * audit rows, SHOUTED from some providers ("HIGH", "SAFE"). Both used to be
 * printed as-is under `uppercase`, which hid the inconsistency behind a style.
 * Without the uppercase they have to be normalised here instead: a verdict is a
 * word in a sentence, not a constant.
 */
export function formatVerdict(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
