import { normalizeText } from "./text.js";

const CLASSIFICATIONS = ["concern", "caution", "positive", "neutral"];
const SEVERITIES = ["high", "medium", "low"];

export function countFindings(findings) {
  const count = (key) => findings.filter((item) => item.classification === key).length;
  return { concern: count("concern"), caution: count("caution"), positive: count("positive") };
}

export function summarize(findings) {
  const { concern, caution, positive } = countFindings(findings);
  const s = (n) => (n === 1 ? "" : "s");
  return `Found ${concern} potential concern${s(concern)}, ${caution} important condition${s(caution)}, and ${positive} user-friendly provision${s(positive)}.`;
}

/** Removes repeated findings: same classification, category and quoted wording. */
export function dedupeFindings(findings) {
  const seen = new Set();
  const unique = [];
  for (const finding of findings) {
    const key = [
      finding.classification,
      finding.category,
      normalizeText(finding.originalQuote).toLowerCase()
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique;
}

/**
 * Keeps only findings whose quoted evidence really exists in the referenced
 * block. A case-only mismatch is repaired to the source's exact wording.
 * Anything malformed or unsupported is dropped, never rendered.
 */
export function verifyAndCleanFindings(result, blocks) {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const cleaned = [];

  for (const finding of findings) {
    if (!finding || typeof finding !== "object") continue;
    const block = byId.get(finding.blockId);
    const quote = normalizeText(finding.originalQuote);
    if (!block || quote.length < 8) continue;
    const source = normalizeText(block.text);
    const index = source.toLowerCase().indexOf(quote.toLowerCase());
    if (index === -1) continue;
    if (!CLASSIFICATIONS.includes(finding.classification)) continue;
    const title = normalizeText(finding.title);
    const plainEnglish = normalizeText(finding.plainEnglish);
    if (!title || !plainEnglish) continue;
    cleaned.push({
      blockId: block.id,
      classification: finding.classification,
      severity: SEVERITIES.includes(finding.severity) ? finding.severity : "medium",
      category: normalizeText(finding.category) || "General",
      title: title.slice(0, 120),
      originalQuote: source.slice(index, index + quote.length),
      plainEnglish: plainEnglish.slice(0, 600),
      whyItMatters: normalizeText(finding.whyItMatters).slice(0, 600),
      suggestedAction: finding.suggestedAction ? normalizeText(finding.suggestedAction).slice(0, 400) : null,
      confidence: Math.max(0, Math.min(1, Number(finding.confidence) || 0)),
      sourceText: block.text
    });
  }
  return cleaned;
}

export function buildResult({ document, findings, mode, limitations, limit = 30, extra = {} }) {
  const final = dedupeFindings(findings).slice(0, limit);
  return {
    documentTitle: document.title,
    effectiveDate: null,
    summary: summarize(final),
    findings: final,
    limitations,
    analysisMode: mode,
    analyzedBlocks: document.blocks.length,
    ...extra
  };
}
