import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FEEDBACK_MS, MAX_CLIPBOARD_CHARS, SERVICES, buildHandoff, continueIn } from "../extension/lib/handoff.js";
import { quickScan } from "../extension/lib/quick-scan.js";

const EXTENSION = fileURLToPath(new URL("../extension", import.meta.url));

const agreement = {
  title: "Example Terms",
  url: "https://example.com/terms",
  blocks: [
    { id: "b1", heading: "Disputes", text: "All disputes will be resolved through binding arbitration on an individual basis." },
    { id: "b2", heading: "Billing", text: "Your subscription will automatically renew each month." }
  ]
};
const findings = quickScan(agreement).findings;
const date = new Date("2026-10-01T12:00:00Z");

/** Records the order of every side effect so the tests can check "copy first, then open". */
function fakeDeps({ failClipboard = false, failDownload = false } = {}) {
  const events = [];
  return {
    events,
    deps: {
      writeClipboard: async (text) => { if (failClipboard) throw new Error("denied"); events.push({ type: "copy", text }); },
      downloadFile: async (name, content) => { if (failDownload) throw new Error("blocked"); events.push({ type: "download", name, content }); },
      openTab: async (url) => { events.push({ type: "open", url }); },
      announce: (message) => { events.push({ type: "announce", message }); },
      delay: async (ms) => { events.push({ type: "delay", ms }); }
    }
  };
}

test("the prompt carries title, URL, date, findings, evidence, the text and the rules", () => {
  const { clipboardText, mode } = buildHandoff({ document: agreement, findings, date });
  assert.equal(mode, "clipboard");
  for (const expected of [
    "Example Terms", "https://example.com/terms", "2026-10-01", "Mandatory arbitration",
    "All disputes will be resolved through binding arbitration on an individual basis.",
    "--- AGREEMENT TEXT ---", "Your subscription will automatically renew each month.",
    "Do not invent clauses", "quote the exact agreement wording", "definite findings", "uncertainty",
    "not legal advice", "Concerns", "Important conditions", "User-friendly provisions", "Questions the reader should investigate"
  ]) assert.ok(clipboardText.includes(expected), `missing: ${expected}`);
});

test("ChatGPT: the prompt is copied BEFORE the tab opens, feedback shows in between", async () => {
  const { events, deps } = fakeDeps();
  const handoff = buildHandoff({ document: agreement, findings, date });
  const outcome = await continueIn("chatgpt", handoff, deps);
  assert.deepEqual(events.map((e) => e.type), ["copy", "announce", "delay", "open"]);
  assert.equal(events[0].text, handoff.clipboardText);
  assert.equal(events[1].message, "Copied. Paste into ChatGPT to continue.");
  assert.equal(events[2].ms, FEEDBACK_MS);
  assert.equal(events[3].url, "https://chatgpt.com/");
  assert.equal(outcome.ok, true);
});

test("Gemini: the prompt is copied BEFORE the tab opens, feedback shows in between", async () => {
  const { events, deps } = fakeDeps();
  const handoff = buildHandoff({ document: agreement, findings, date });
  await continueIn("gemini", handoff, deps);
  assert.deepEqual(events.map((e) => e.type), ["copy", "announce", "delay", "open"]);
  assert.equal(events[1].message, "Copied. Paste into Gemini to continue.");
  assert.equal(events[3].url, "https://gemini.google.com/app");
});

test("clipboard failure opens nothing and returns a usable fallback with the full prompt", async () => {
  const { events, deps } = fakeDeps({ failClipboard: true });
  const handoff = buildHandoff({ document: agreement, findings, date });
  const outcome = await continueIn("chatgpt", handoff, deps);
  assert.equal(outcome.ok, false);
  assert.equal(events.some((e) => e.type === "open"), false);
  assert.equal(events.some((e) => e.type === "announce"), false);
  assert.equal(outcome.fallback.text, handoff.clipboardText);
  assert.equal(outcome.fallback.serviceId, "chatgpt");
  assert.match(outcome.message, /Copy the text below/);
});

test("a long agreement is saved as a file, short upload instructions are copied, then the service opens", async () => {
  const big = { ...agreement, blocks: Array.from({ length: 500 }, (_, i) => ({ id: `b${i}`, heading: "", text: `Clause ${i}: ` + "The user agrees to these terms. ".repeat(6) })) };
  const handoff = buildHandoff({ document: big, findings: [], date });
  assert.equal(handoff.mode, "file");
  assert.ok(handoff.fileContent.length > MAX_CLIPBOARD_CHARS);
  assert.equal(handoff.fileName, "terms-lens-example-terms-analysis.md");
  assert.ok(handoff.fileContent.includes("Clause 499"), "nothing is truncated");

  const { events, deps } = fakeDeps();
  const outcome = await continueIn("gemini", handoff, deps);
  assert.deepEqual(events.map((e) => e.type), ["download", "copy", "announce", "delay", "open"]);
  assert.equal(events[0].name, handoff.fileName);
  assert.ok(events[1].text.length < 300 && events[1].text.includes(handoff.fileName));
  assert.match(events[2].message, /Upload the file in Gemini/);
  assert.equal(outcome.mode, "file");
});

test("the size threshold sits exactly at the documented limit", () => {
  const filler = (n) => ({ ...agreement, blocks: [{ id: "b", heading: "", text: "x".repeat(n) }] });
  const overhead = buildHandoff({ document: filler(1), findings: [], date }).clipboardText.length - 1;
  assert.equal(buildHandoff({ document: filler(MAX_CLIPBOARD_CHARS - overhead), findings: [], date }).mode, "clipboard");
  assert.equal(buildHandoff({ document: filler(MAX_CLIPBOARD_CHARS - overhead + 1), findings: [], date }).mode, "file");
});

test("a failed download also opens nothing and offers the instructions to copy by hand", async () => {
  const big = { ...agreement, blocks: [{ id: "b", heading: "", text: "y".repeat(MAX_CLIPBOARD_CHARS + 10) }] };
  const { events, deps } = fakeDeps({ failDownload: true });
  const outcome = await continueIn("chatgpt", buildHandoff({ document: big, findings: [], date }), deps);
  assert.equal(outcome.ok, false);
  assert.equal(events.some((e) => e.type === "open"), false);
});

test("unknown services are refused and do nothing", async () => {
  const { events, deps } = fakeDeps();
  assert.equal((await continueIn("evil", buildHandoff({ document: agreement, findings, date }), deps)).ok, false);
  assert.equal(events.length, 0);
  assert.deepEqual(Object.keys(SERVICES).sort(), ["chatgpt", "gemini"]);
});

async function sourceFiles(dir, pattern) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await sourceFiles(path, pattern)));
    else if (pattern.test(entry.name)) out.push(path);
  }
  return out;
}

test("no API key is requested, named or stored, and only known storage keys are written", async () => {
  for (const file of await sourceFiles(EXTENSION, /\.(js|html|json|css)$/)) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /api[_-]?key|apikey|OPENAI|GEMINI_|Authorization|chrome\.cookies|document\.cookie|type="password"/i, file);
    for (const match of source.matchAll(/storage\.(?:local|sync)\.set/g)) assert.fail(`persistent storage used in ${file}`);
  }
});

test("the built-in Chrome AI feature is completely gone", async () => {
  for (const file of await sourceFiles(EXTENSION, /\.(js|html|json|css|md|txt)$/)) {
    if (file.includes("vendor")) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /LanguageModel|Prompt API|on-device|private ai|ondevice|downloadprogress|responseConstraint/i, file);
  }
  const manifest = JSON.parse(await readFile(`${EXTENSION}/manifest.json`, "utf8"));
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.options_ui, undefined);
  assert.ok(!manifest.permissions.includes("sidePanel"));
  const docs = [".", "README.md", "PRIVACY.md", "CHROMEWEBSTORE.md"];
  for (const name of docs.slice(1)) {
    const text = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /LanguageModel|Prompt API|on-device AI|Private AI Scan|Download private AI model/i, name);
  }
});

test("the packaged extension never names localhost and asks for least-privilege permissions", async () => {
  for (const file of await sourceFiles(EXTENSION, /\.(js|html|json|css)$/)) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /127\.0\.0\.1|localhost|:8787/, file);
  }
  const manifest = JSON.parse(await readFile(`${EXTENSION}/manifest.json`, "utf8"));
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  for (const banned of ["clipboardWrite", "downloads", "tabs", "cookies"]) assert.ok(!manifest.permissions.includes(banned), banned);
});

test("hand-off code contains no network calls and no provider cookie access", async () => {
  const source = await readFile(`${EXTENSION}/lib/handoff.js`, "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|cookie/i);
});
