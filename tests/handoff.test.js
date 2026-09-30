import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MAX_CLIPBOARD_CHARS, SERVICES, buildHandoff, continueIn } from "../extension/lib/handoff.js";
import { quickScan } from "../extension/lib/quick-scan.js";

const document = {
  title: "Example Terms",
  url: "https://example.com/terms",
  blocks: [
    { id: "b1", heading: "Disputes", text: "All disputes will be resolved through binding arbitration on an individual basis." },
    { id: "b2", heading: "Billing", text: "Your subscription will automatically renew each month." }
  ]
};
const findings = quickScan(document).findings;
const date = new Date("2026-09-30T12:00:00Z");

function fakeDeps({ failClipboard = false } = {}) {
  const calls = { clipboard: [], tabs: [], files: [] };
  return {
    calls,
    deps: {
      writeClipboard: async (text) => { if (failClipboard) throw new Error("denied"); calls.clipboard.push(text); },
      openTab: async (url) => { calls.tabs.push(url); },
      downloadFile: async (name, content) => { calls.files.push({ name, content }); }
    }
  };
}

test("the prompt carries title, URL, date, findings, evidence, document text and the safety instructions", () => {
  const { clipboardText, mode } = buildHandoff({ document, findings, date });
  assert.equal(mode, "clipboard");
  for (const expected of [
    "Example Terms", "https://example.com/terms", "2026-09-30", "Mandatory arbitration",
    "All disputes will be resolved through binding arbitration on an individual basis.",
    "--- DOCUMENT TEXT ---", "Your subscription will automatically renew each month.",
    "Do not invent clauses", "quote or precisely identify the source wording",
    "what the document says (facts) from what is uncertain", "not legal advice",
    "Concerns", "Important conditions", "Positive or user-friendly", "Questions the reader should investigate"
  ]) assert.ok(clipboardText.includes(expected), `missing: ${expected}`);
});

test("Continue in ChatGPT copies the prompt and opens ChatGPT", async () => {
  const { calls, deps } = fakeDeps();
  const handoff = buildHandoff({ document, findings, date });
  const outcome = await continueIn("chatgpt", handoff, deps);
  assert.equal(outcome.ok, true);
  assert.deepEqual(calls.tabs, ["https://chatgpt.com/"]);
  assert.equal(calls.clipboard[0], handoff.clipboardText);
  assert.equal(outcome.message, "Prompt copied. Paste it into ChatGPT to continue.");
  assert.equal(calls.files.length, 0);
});

test("Continue in Gemini copies the prompt and opens Gemini", async () => {
  const { calls, deps } = fakeDeps();
  const handoff = buildHandoff({ document, findings, date });
  const outcome = await continueIn("gemini", handoff, deps);
  assert.deepEqual(calls.tabs, ["https://gemini.google.com/app"]);
  assert.equal(calls.clipboard[0], handoff.clipboardText);
  assert.equal(outcome.message, "Prompt copied. Paste it into Gemini to continue.");
});

test("a very long document is downloaded as a file with short copied instructions", async () => {
  const big = { ...document, blocks: Array.from({ length: 400 }, (_, i) => ({ id: `b${i}`, heading: "", text: `Clause number ${i}: ` + "The user agrees to these terms. ".repeat(6) })) };
  const handoff = buildHandoff({ document: big, findings: [], date });
  assert.equal(handoff.mode, "file");
  assert.match(handoff.fileName, /^terms-lens-example-terms-analysis\.md$/);
  assert.ok(handoff.fileContent.length > MAX_CLIPBOARD_CHARS);
  const { calls, deps } = fakeDeps();
  const outcome = await continueIn("gemini", handoff, deps);
  assert.equal(calls.files.length, 1);
  assert.equal(calls.files[0].name, handoff.fileName);
  assert.ok(calls.clipboard[0].length < 400 && calls.clipboard[0].includes(handoff.fileName));
  assert.deepEqual(calls.tabs, [SERVICES.gemini.url]);
  assert.match(outcome.message, /Upload the file in Gemini/);
});

test("if copying fails nothing is opened and the user is told calmly", async () => {
  const { calls, deps } = fakeDeps({ failClipboard: true });
  const outcome = await continueIn("chatgpt", buildHandoff({ document, findings, date }), deps);
  assert.equal(outcome.ok, false);
  assert.equal(calls.tabs.length, 0);
  assert.match(outcome.message, /nothing was shared/);
});

test("unknown services are refused and do nothing", async () => {
  const { calls, deps } = fakeDeps();
  assert.equal((await continueIn("evil", buildHandoff({ document, findings, date }), deps)).ok, false);
  assert.equal(calls.clipboard.length + calls.tabs.length, 0);
});

test("the extension never requests, stores or names an API key or account session", async () => {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(js|html|json)$/.test(entry.name)) files.push(path);
    }
  };
  await walk(fileURLToPath(new URL("../extension", import.meta.url)));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /api[_-]?key|apikey|OPENAI|GEMINI_|Authorization|chrome\.cookies|document\.cookie|type="password"/i, file.replace(/.*extension\//, ""));
    // Only the preference is ever written to storage.
    for (const match of source.matchAll(/storage\.(?:local|sync)\.set\(\s*\{\s*(\w+)/g)) {
      assert.equal(match[1], "providerPreference", file);
    }
  }
});

test("the packaged extension only opens ChatGPT or Gemini on an explicit hand-off click", async () => {
  const panel = await readFile(new URL("../extension/sidepanel.js", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /chatgpt\.com|gemini\.google\.com/); // URLs live only in the hand-off module
  const handoffSource = await readFile(new URL("../extension/lib/handoff.js", import.meta.url), "utf8");
  assert.doesNotMatch(handoffSource, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.ok(!manifest.permissions.includes("clipboardWrite")); // a click gesture is enough
  assert.ok(!manifest.permissions.includes("downloads"));
});
