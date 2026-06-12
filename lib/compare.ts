export interface SkillRef {
  source: string;
  skillId: string;
}

/** Comparison columns the layout supports side by side. */
export const MAX_COMPARE_SKILLS = 3;

export function refKey(ref: SkillRef) {
  return `${ref.source}:${ref.skillId}`;
}

export function serializeSkillsParam(refs: SkillRef[]) {
  return refs.map(refKey).join(",");
}

export function compareHref(refs: SkillRef[]) {
  if (refs.length === 0) return "/compare";
  // `/`, `:`, and `,` are legal in query values — restore them after encoding
  // so links built here match the readable form nuqs writes on in-page
  // updates (a blanket encodeURIComponent produces an equivalent but
  // percent-soup URL).
  const value = encodeURIComponent(serializeSkillsParam(refs))
    .replaceAll("%2F", "/")
    .replaceAll("%3A", ":")
    .replaceAll("%2C", ",");
  return `/compare?skills=${value}`;
}

/**
 * Param format: `owner/repo:skillId,owner/repo:skillId` — the last `:` in
 * each entry separates the skillId from its source (sources are GitHub
 * owner/repo pairs and never contain `:`). Malformed entries are dropped,
 * duplicates are deduped (they'd render columns with duplicate React keys),
 * and the list is capped at the column maximum.
 */
export function parseSkillsParam(value: string): SkillRef[] {
  const refs = value
    .split(",")
    .map((entry): SkillRef | null => {
      const colonIdx = entry.lastIndexOf(":");
      if (colonIdx <= 0 || colonIdx === entry.length - 1) return null;
      return {
        source: entry.slice(0, colonIdx),
        skillId: entry.slice(colonIdx + 1),
      };
    })
    .filter((r): r is SkillRef => r !== null);

  const seen = new Set<string>();
  return refs
    .filter((r) => {
      const k = refKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_COMPARE_SKILLS);
}
