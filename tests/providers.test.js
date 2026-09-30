import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createChromeAiProvider, parseModelOutput, chunkBlocks } from "../extension/lib/providers/chrome-ai.js";
import { createProviders, runDeeperScan, runQuickScan, normalizePreference } from "../extension/lib/providers/index.js";

const document = {
  title: "Terms",
  url: "https://example.com/terms",
  blocks: [
    { id: "block-1", heading: "Disputes", text: "All disputes will be resolved through binding arbitration on an individual basis." },
    { id: "block-2", heading: "Billing", text: "Your subscription will automatically renew each month unless you cancel before renewal." }
  ]
};

const fakeModel = ({ state = "available", reply, failPrompt = false } = {}) => ({
  availability: async () => state,
  create: async (options) => {
    options.monitor?.({ addEventListener: (_n, cb) => cb({ loaded: 0.5 }) });
    return {
      prompt: async () => {
        if (failPrompt) throw new Error("boom");
        return typeof reply === "function" ? reply() : reply;
      },
      destroy() {}
    };
  }
});

const goodReply = JSON.stringify({
  findings: [{
    blockId: "block-1", classification: "concern", severity: "high", category: "Disputes",
    title: "Disputes go to arbitration", originalQuote: "binding arbitration",
    plainEnglish: "You may not be able to sue in court.", whyItMatters: "Limits remedies."
  }]
});

const providersWith = (model) => createProviders({ "chrome-ai": createChromeAiProvider({ languageModel: model }) });

test("Quick Scan completes with no other provider present", async () => {
  const result = await runQuickScan(document, createProviders({ "chrome-ai": { availability: async () => { throw new Error("nope"); } } }));
  assert.equal(result.analysisMode, "quick");
  assert.ok(result.findings.length >= 2);
});

test("availability maps every Chrome state, including a missing API", async () => {
  for (const state of ["available", "downloadable", "downloading", "unavailable"]) {
    assert.equal((await createChromeAiProvider({ languageModel: fakeModel({ state }) }).availability()).state, state);
  }
  assert.equal((await createChromeAiProvider({ languageModel: undefined }).availability()).state, "unavailable");
  const throwing = { availability: async () => { throw new Error("x"); } };
  assert.equal((await createChromeAiProvider({ languageModel: throwing }).availability()).state, "unavailable");
});

test("Private AI Scan returns validated, evidence-checked findings", async () => {
  const outcome = await runDeeperScan("chrome-ai", document, providersWith(fakeModel({ reply: goodReply })));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.analysisMode, "private-ai");
  assert.equal(outcome.result.findings.length, 1);
  assert.equal(outcome.result.findings[0].sourceText, document.blocks[0].text);
});

test("model output is validated: hallucinated quotes, bad JSON and bad shapes are dropped", () => {
  const hallucinated = JSON.stringify({ findings: [{ blockId: "block-1", classification: "concern", title: "T", plainEnglish: "P", originalQuote: "a clause that is not there" }] });
  assert.deepEqual(parseModelOutput(hallucinated, document.blocks), []);
  assert.deepEqual(parseModelOutput("not json at all", document.blocks), []);
  assert.deepEqual(parseModelOutput(JSON.stringify({ findings: "nope" }), document.blocks), []);
  assert.deepEqual(parseModelOutput(JSON.stringify({ findings: [null, 4, { blockId: "zzz" }] }), document.blocks), []);
  const badClass = JSON.stringify({ findings: [{ blockId: "block-1", classification: "scary", title: "T", plainEnglish: "P", originalQuote: "binding arbitration" }] });
  assert.deepEqual(parseModelOutput(badClass, document.blocks), []);
});

test("fallback: unavailable AI leaves Quick Scan usable and reports a calm reason", async () => {
  const outcome = await runDeeperScan("chrome-ai", document, providersWith(fakeModel({ state: "unavailable" })));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "unavailable");
  assert.equal((await runQuickScan(document)).findings.length > 0, true);
});

test("fallback: a model that throws mid-scan yields a failure, not an exception", async () => {
  const outcome = await runDeeperScan("chrome-ai", document, providersWith(fakeModel({ failPrompt: true })));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "failed");
});

test("future providers are placeholders that refuse to run and never transmit", async () => {
  const providers = createProviders();
  for (const id of ["cloud", "byok"]) {
    assert.equal((await providers[id].availability()).state, "coming-soon");
    const outcome = await runDeeperScan(id, document, providers);
    assert.equal(outcome.ok, false);
  }
});

test("download progress is only reported through the create() monitor", async () => {
  const seen = [];
  const provider = createChromeAiProvider({ languageModel: fakeModel({ state: "downloadable", reply: goodReply }) });
  await provider.analyze(document, { onDownloadProgress: (value) => seen.push(value) });
  assert.deepEqual(seen, [0.5]);
});

test("chunkBlocks splits by size and preserves order", () => {
  const blocks = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, heading: "", text: "x".repeat(2000) }));
  const chunks = chunkBlocks(blocks, 4500);
  assert.deepEqual(chunks.map((c) => c.length), [2, 2, 1]);
});

test("preferences normalise to a known value", () => {
  assert.equal(normalizePreference("chrome-ai"), "chrome-ai");
  assert.equal(normalizePreference("evil"), "automatic");
  assert.equal(normalizePreference(undefined), "automatic");
});

test("packaged extension has no localhost dependency and no embedded keys", async () => {
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
  const files = (await walk(new URL("../extension", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")))
    .filter((file) => /\.(js|json|html)$/.test(file));
  assert.ok(files.length > 5);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /127\.0\.0\.1|localhost|8787/, file);
    assert.doesNotMatch(source, /sk-[A-Za-z0-9_-]{16,}|Bearer\s/, file);
  }
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "sidePanel", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
});
