import { RULES } from "./rules.js";
import { buildResult } from "./result.js";

const MAX_EXCERPT = 500;
const SENTENCE_BREAK = /[.!?;:]\s+(?=[A-Z0-9"“(])/g;

/** Returns the sentence around [start, end) so the excerpt stays readable and traceable. */
export function excerptAround(text, start, end) {
  let from = 0;
  let to = text.length;
  for (const match of text.matchAll(SENTENCE_BREAK)) {
    const boundary = match.index + match[0].length;
    if (boundary <= start) from = boundary;
    else if (match.index + 1 >= end) {
      to = match.index + 1;
      break;
    }
  }
  let excerpt = text.slice(from, to).trim();
  if (excerpt.length > MAX_EXCERPT) {
    const center = start - from;
    const windowStart = Math.max(0, center - Math.floor(MAX_EXCERPT / 2));
    excerpt = text.slice(from + windowStart, from + windowStart + MAX_EXCERPT).trim();
  }
  return excerpt;
}

/**
 * Quick Scan: deterministic, local phrase-pattern matching. No network, no model.
 * Each finding quotes the sentence that matched, verbatim from its source block.
 */
export function quickScan(document) {
  const findings = [];
  const seen = new Set();
  for (const block of document.blocks) {
    for (const rule of RULES) {
      const key = `${rule.title}:${block.id}`;
      if (seen.has(key)) continue;
      const match = rule.pattern.exec(block.text);
      if (!match) continue;
      const excerpt = excerptAround(block.text, match.index, match.index + match[0].length);
      if (rule.skipPattern?.test(excerpt)) continue;
      seen.add(key);
      findings.push({
        blockId: block.id,
        classification: rule.classification,
        severity: rule.severity,
        category: rule.category,
        title: rule.title,
        originalQuote: excerpt,
        plainEnglish: rule.plainEnglish,
        whyItMatters: rule.whyItMatters,
        suggestedAction: rule.suggestedAction,
        confidence: 0.78,
        sourceText: block.text
      });
    }
  }
  return buildResult({
    document,
    findings,
    mode: "quick",
    limit: 20,
    limitations: [
      "Quick Scan checks for known phrase patterns. It is not an AI or legal review and may miss clauses that depend on context."
    ]
  });
}
