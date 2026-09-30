import { countFindings, dedupeFindings, hasEvidence } from "./result.js";

export const FILTERS = ["all", "concern", "caution", "positive"];

/**
 * The single source of truth for what the side panel renders.
 * Findings without genuine evidence are dropped, repeats collapse, and the
 * counts are computed from the very array that is returned for "All".
 */
export function prepareView(result, filter = "all") {
  const all = dedupeFindings((result?.findings ?? []).filter(hasEvidence));
  const counts = countFindings(all);
  const selected = FILTERS.includes(filter) ? filter : "all";
  const findings = selected === "all" ? all : all.filter((item) => item.classification === selected);
  return { all, findings, counts, total: all.length, filter: selected };
}
