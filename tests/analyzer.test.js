import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeWithRules,
  sanitizeRequest,
  verifyAndCleanFindings
} from "../server/analyzer.js";

const document = {
  title: "Example Terms",
  url: "https://example.com/terms",
  blocks: [
    { id: "block-1", heading: "Disputes", text: "All disputes will be resolved through binding arbitration on an individual basis." },
    { id: "block-2", heading: "Cancellation", text: "You may cancel your subscription at any time from your account settings." }
  ]
};

test("sanitizeRequest keeps safe, traceable blocks", () => {
  const result = sanitizeRequest(document);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].id, "block-1");
});

test("rule scan detects concerning and positive clauses", () => {
  const result = analyzeWithRules(document);
  assert.ok(result.findings.some((item) => item.classification === "concern"));
  assert.ok(result.findings.some((item) => item.classification === "positive"));
});

test("evidence verifier drops hallucinated quotes", () => {
  const findings = verifyAndCleanFindings({
    findings: [
      {
        blockId: "block-1",
        classification: "concern",
        severity: "high",
        category: "Disputes",
        title: "Supported",
        originalQuote: "binding arbitration",
        plainEnglish: "Explanation",
        whyItMatters: "Reason",
        suggestedAction: null,
        confidence: 0.9
      },
      {
        blockId: "block-2",
        classification: "concern",
        severity: "high",
        category: "Payments",
        title: "Invented",
        originalQuote: "A clause that does not exist",
        plainEnglish: "Explanation",
        whyItMatters: "Reason",
        suggestedAction: null,
        confidence: 0.9
      }
    ]
  }, document.blocks);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Supported");
});

test("sanitizeRequest rejects unsupported URLs", () => {
  assert.throws(() => sanitizeRequest({ ...document, url: "file:///tmp/terms" }), /valid HTTP/);
});
