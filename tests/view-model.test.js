import test from "node:test";
import assert from "node:assert/strict";
import { prepareView } from "../extension/lib/view-model.js";
import { quickScan } from "../extension/lib/quick-scan.js";
import { buildResult, dedupeFindings, hasEvidence } from "../extension/lib/result.js";

const finding = (overrides = {}) => ({
  blockId: "b1", classification: "concern", severity: "high", category: "Disputes",
  title: "Mandatory arbitration", originalQuote: "All disputes will be resolved by binding arbitration.",
  plainEnglish: "p", whyItMatters: "w", suggestedAction: null, confidence: 0.8, sourceText: "x", ...overrides
});

test("a single finding renders exactly once", () => {
  const view = prepareView({ findings: [finding()] });
  assert.equal(view.findings.length, 1);
  assert.equal(view.total, 1);
});

test("true duplicates collapse, including whitespace and case differences", () => {
  const view = prepareView({ findings: [finding(), finding({ blockId: "b9", originalQuote: "all disputes will be resolved   by binding arbitration." })] });
  assert.equal(view.total, 1);
});

test("similar but distinct findings stay separate", () => {
  const view = prepareView({ findings: [
    finding(),
    finding({ originalQuote: "Employees must also use mandatory arbitration for wage claims." }), // same title, different evidence
    finding({ title: "Class actions waived", originalQuote: "All disputes will be resolved by binding arbitration." }), // same evidence, different title
    finding({ category: "Payments" }) // same title and evidence, different category
  ] });
  assert.equal(view.total, 4);
});

test("summary counts equal the visible unique findings, and All shows every one", () => {
  const view = prepareView({ findings: [
    finding(), finding(),
    finding({ classification: "caution", title: "Automatic renewal", originalQuote: "Your subscription will automatically renew." }),
    finding({ classification: "positive", title: "Cancel any time", originalQuote: "You may cancel at any time." })
  ] });
  assert.deepEqual(view.counts, { concern: 1, caution: 1, positive: 1 });
  assert.equal(view.all.length, view.counts.concern + view.counts.caution + view.counts.positive);
  assert.equal(view.findings.length, view.all.length);
});

test("each category filter shows only its own findings", () => {
  const result = { findings: [
    finding(),
    finding({ classification: "caution", title: "Automatic renewal", originalQuote: "Your subscription will automatically renew." }),
    finding({ classification: "positive", title: "Cancel any time", originalQuote: "You may cancel at any time." })
  ] };
  for (const kind of ["concern", "caution", "positive"]) {
    const view = prepareView(result, kind);
    assert.equal(view.findings.length, 1);
    assert.ok(view.findings.every((f) => f.classification === kind));
  }
  assert.equal(prepareView(result, "nonsense").filter, "all");
});

test("findings without genuine evidence are never rendered", () => {
  for (const originalQuote of ["", "   ", undefined, null, "short"]) {
    assert.equal(hasEvidence({ originalQuote }), false);
  }
  const view = prepareView({ findings: [finding({ originalQuote: "" }), finding({ originalQuote: "  " }), finding()] });
  assert.equal(view.total, 1);
  assert.ok(view.all.every((f) => f.originalQuote.trim().length > 0));
  assert.equal(buildResult({ document: { title: "t", blocks: [] }, findings: [finding({ originalQuote: "" })], mode: "quick", limitations: [] }).findings.length, 0);
});

test("Quick Scan output always carries verified non-empty evidence from its source block", () => {
  const blocks = [
    { id: "b1", heading: "", text: "All disputes will be resolved through binding arbitration. You waive any class action rights." },
    { id: "b2", heading: "", text: "Subscriptions automatically renew. Payments are non-refundable." }
  ];
  const result = quickScan({ title: "T", url: "https://example.com", blocks });
  assert.ok(result.findings.length >= 4);
  for (const f of result.findings) {
    assert.ok(f.originalQuote.trim().length >= 8);
    assert.ok(blocks.find((b) => b.id === f.blockId).text.includes(f.originalQuote));
  }
  assert.equal(dedupeFindings(result.findings).length, result.findings.length);
});

test("negated phrases are interpreted correctly", () => {
  const scan = (text) => quickScan({ title: "T", url: "https://example.com", blocks: [{ id: "b", heading: "", text }] }).findings.map((f) => f.title);
  assert.deepEqual(scan("We do not sell your personal information to anyone."), []);
  assert.deepEqual(scan("We will never sell personal data to third parties."), []);
  assert.ok(scan("We may sell personal information to our partners.").includes("Personal data may be sold"));
});
