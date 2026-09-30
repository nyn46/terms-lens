import test from "node:test";
import assert from "node:assert/strict";
import { quickScan, excerptAround } from "../extension/lib/quick-scan.js";
import { countFindings, dedupeFindings } from "../extension/lib/result.js";
import { sanitizeDocument } from "../extension/lib/text.js";

const doc = (blocks) => ({ title: "Example Terms", url: "https://example.com/terms", blocks });

const SAMPLE = doc([
  { id: "b1", heading: "Disputes", text: "Welcome to the service. All disputes will be resolved through binding arbitration on an individual basis. You waive any class action rights." },
  { id: "b2", heading: "Billing", text: "Your subscription will automatically renew each month. Fees are non-refundable once charged." },
  { id: "b3", heading: "Cancel", text: "You may cancel your subscription at any time from your account settings." },
  { id: "b4", heading: "Privacy", text: "We will not sell your personal information to third parties for advertising." }
]);

test("Quick Scan finds concerns, cautions and positives locally", () => {
  const result = quickScan(SAMPLE);
  assert.equal(result.analysisMode, "quick");
  const titles = result.findings.map((f) => f.title);
  for (const expected of ["Mandatory arbitration", "Class actions waived", "Automatic renewal", "Refunds restricted", "Cancellation is available"]) {
    assert.ok(titles.includes(expected), `missing ${expected}`);
  }
});

test("counts in the result and summary match the findings", () => {
  const result = quickScan(SAMPLE);
  const counts = countFindings(result.findings);
  assert.deepEqual(counts, { concern: 3, caution: 1, positive: 1 });
  assert.equal(result.summary, "Found 3 potential concerns, 1 important condition, and 1 user-friendly provision.");
});

test("every excerpt is verbatim text from its source block and contains the match", () => {
  const result = quickScan(SAMPLE);
  const blocks = new Map(SAMPLE.blocks.map((b) => [b.id, b.text]));
  for (const finding of result.findings) {
    assert.ok(blocks.get(finding.blockId).includes(finding.originalQuote), finding.title);
    assert.ok(finding.originalQuote.length <= 500);
    assert.ok(finding.confidence > 0 && finding.confidence <= 1);
  }
  const arbitration = result.findings.find((f) => f.title === "Mandatory arbitration");
  assert.equal(arbitration.originalQuote, "All disputes will be resolved through binding arbitration on an individual basis.");
});

test("negated statements are not flagged, judged on the matching sentence", () => {
  const result = quickScan(SAMPLE);
  assert.equal(result.findings.some((f) => f.title === "Personal data may be sold"), false);
  const mixed = quickScan(doc([{ id: "m", heading: "", text: "We do not sell your data to brokers. Partners may buy the sale of personal information in some regions." }]));
  assert.ok(mixed.findings.some((f) => f.title === "Personal data may be sold"));
});

test("deduplicates repeated clauses across blocks and within a block", () => {
  const repeated = "All disputes will be resolved through binding arbitration on an individual basis.";
  const result = quickScan(doc([
    { id: "a", heading: "", text: repeated },
    { id: "b", heading: "", text: repeated },
    { id: "c", heading: "", text: `${repeated} Separately, mandatory arbitration also applies to employees.` }
  ]));
  const arbitration = result.findings.filter((f) => f.title === "Mandatory arbitration");
  // "a" and "b" quote identical wording and collapse; "c" matches a longer, different span.
  assert.equal(arbitration.length, 2);
  assert.equal(new Set(arbitration.map((f) => f.originalQuote)).size, arbitration.length);
  const direct = dedupeFindings([
    { classification: "concern", category: "X", originalQuote: "Same   wording here" },
    { classification: "concern", category: "X", originalQuote: "same wording here" }
  ]);
  assert.equal(direct.length, 1);
});

test("a page with no known patterns returns an empty, non-error result", () => {
  const result = quickScan(doc([{ id: "x", heading: "", text: "Welcome to our friendly recipe blog about sourdough bread." }]));
  assert.deepEqual(result.findings, []);
  assert.match(result.limitations[0], /known contract patterns/);
});

test("excerptAround caps very long text without losing the match", () => {
  const text = `${"word ".repeat(300)}binding arbitration${" word".repeat(300)}`;
  const start = text.indexOf("binding arbitration");
  const excerpt = excerptAround(text, start, start + 19);
  assert.ok(excerpt.length <= 500);
  assert.ok(excerpt.includes("binding arbitration"));
});

test("sanitizeDocument rejects non-web URLs and empty text", () => {
  assert.throws(() => sanitizeDocument({ ...SAMPLE, url: "chrome://extensions" }), /valid HTTP/);
  assert.throws(() => sanitizeDocument({ ...SAMPLE, blocks: [{ id: "a", text: "short" }] }), /enough readable text/);
});

test("Quick Scan module makes no network or localhost calls", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["quick-scan.js", "rules.js", "result.js", "text.js"]) {
    const source = await readFile(new URL(`../extension/lib/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|127\.0\.0\.1|localhost|WebSocket/);
  }
});
