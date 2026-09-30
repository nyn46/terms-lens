// Real-Chrome end-to-end check. Development only; not part of the packaged extension.
// Usage: npm run test:e2e   (needs Google Chrome installed; closes any windows it opens)
//
// It launches Chrome with a throwaway profile, loads extension/ over the DevTools pipe, and drives the
// real side panel against the live GitHub Terms page. Chrome cannot synthesise the toolbar-icon click
// that grants "activeTab", so it loads test-only copies that add host access for the test origins.
// The shipped manifest is exercised separately (activation-card test).
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const SRC = join(ROOT, "extension");
const OUT = process.env.E2E_OUT || mkdtempSync(join(tmpdir(), "terms-lens-e2e-"));
const CHROME = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);
if (!CHROME) throw new Error("Chrome was not found. Set CHROME_PATH.");
const PAGE = "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service";
const PDF = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

const profile = join(OUT, "profile");
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

function makeCopy(name, edit) {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(SRC, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  edit(manifest);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}
const grantedCopy = makeCopy("ext-granted", (m) => { m.host_permissions = ["https://docs.github.com/*"]; });
const tabsCopy = makeCopy("ext-tabs", (m) => { m.permissions.push("tabs"); m.host_permissions = ["https://www.w3.org/*"]; });

const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  "--no-first-run", "--no-default-browser-check", "--window-size=1300,900", "about:blank"
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

let nextId = 1;
const pending = new Map();
const listeners = [];
let buffer = "";
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let i;
  while ((i = buffer.indexOf("\0")) !== -1) {
    const msg = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else listeners.forEach((l) => l(msg));
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const requests = [];
const panelSessions = new Set();
listeners.push((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push({ s: m.sessionId, text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push({ s: m.sessionId, text: `${m.params.entry.text} ${m.params.entry.url || ""}` });
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push({ s: m.sessionId, text: m.params.args.map((a) => a.value ?? a.description).join(" ") });
  if (m.method === "Network.requestWillBeSent") requests.push({ s: m.sessionId, url: m.params.request.url, method: m.params.request.method });
});

async function attach(targetId) {
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Runtime", "Log", "Network", "Page"]) await send(`${domain}.enable`, {}, sessionId).catch(() => {});
  return sessionId;
}
const ev = async (s, expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, s);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (s, expression, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await ev(s, expression)) return true; } catch { /* page still loading */ }
    await sleep(250);
  }
  return false;
};

const results = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  [${String(detail).slice(0, 220)}]` : ""}`);
};

async function openPage(url, ready = "document.readyState === 'complete'") {
  const { targetId } = await send("Target.createTarget", { url });
  await send("Target.activateTarget", { targetId });
  const s = await attach(targetId);
  await waitFor(s, ready);
  await sleep(1200);
  return { targetId, s };
}

let ghTarget = null;
async function openPanel(extId, { fakeModel, keepTab = false } = {}) {
  // The service worker scans whichever tab was activated last, so re-select the test page first.
  if (ghTarget && !keepTab) { await send("Target.activateTarget", { targetId: ghTarget }); await sleep(600); }
  const { targetId } = await send("Target.createTarget", { url: "about:blank", background: true });
  const s = await attach(targetId);
  panelSessions.add(s);
  await send("Emulation.setDeviceMetricsOverride", { width: 420, height: 950, deviceScaleFactor: 1, mobile: false }, s);
  if (fakeModel) await send("Page.addScriptToEvaluateOnNewDocument", { source: fakeModel }, s);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__sent = []; const _s = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = (m, ...r) => { window.__sent.push(m?.type); return _s(m, ...r); };" }, s).catch(() => {});
  await send("Page.navigate", { url: `chrome-extension://${extId}/sidepanel.html` }, s);
  await waitFor(s, "!!document.querySelector('#scanButton') && document.readyState==='complete'");
  return { targetId, s };
}

const text = (s, sel) => ev(s, `document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const visible = (s, sel) => ev(s, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.classList.contains('hidden'); })()`);
const scanAndWait = async (s) => {
  await ev(s, "document.querySelector('#scanButton').click()");
  return waitFor(s, "!document.querySelector('#results').classList.contains('hidden')", 40000);
};
const readClipboard = () => execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" });
const pngOf = async (s, name) => writeFileSync(join(OUT, name), Buffer.from((await send("Page.captureScreenshot", { format: "png" }, s)).data, "base64"));
const listTargets = async () => (await send("Target.getTargets")).targetInfos;

const FAKE = (state, behaviour) => `
  window.__lm = { createCalls: 0 };
  ${state === "missing" ? "globalThis.LanguageModel = undefined;" : `globalThis.LanguageModel = {
    availability: async () => ${JSON.stringify(state)},
    create: async (o) => { window.__lm.createCalls++; o.monitor?.({ addEventListener: (n, cb) => { cb({ loaded: 0.4 }); cb({ loaded: 1 }); } });
      return { destroy() {}, prompt: async (input) => {
        ${behaviour === "throw" ? "throw new Error('model crashed');" : behaviour === "invalid" ? "return 'this is not json {{{';" : behaviour === "invented" ? "const b = JSON.parse(input).blocks[0]; return JSON.stringify({ findings: [{ blockId: b.blockId, classification: 'concern', severity: 'high', category: 'X', title: 'Invented clause', originalQuote: 'This sentence does not exist anywhere on the page.', plainEnglish: 'Made up.', whyItMatters: 'Made up.' }] });" : `
        const b = JSON.parse(input).blocks[0];
        return JSON.stringify({ findings: [{ blockId: b.blockId, classification: 'caution', severity: 'medium', category: 'General',
          title: 'Stand-in model finding', originalQuote: b.text.slice(0, 40), plainEnglish: 'Stand-in explanation.', whyItMatters: 'Stand-in reason.' }] });`}
      } }; } };`}
`;

try {
  await sleep(2500);
  const granted = (await send("Extensions.loadUnpacked", { path: grantedCopy })).id;
  const withTabs = (await send("Extensions.loadUnpacked", { path: tabsCopy })).id;
  const pristine = (await send("Extensions.loadUnpacked", { path: SRC })).id;
  record("extension loads without manifest errors (3 builds)", Boolean(granted && withTabs && pristine), `ids ${granted}`);

  const gh = await openPage(PAGE, "document.readyState === 'complete' && document.querySelectorAll('p').length > 20");
  await sleep(800);
  const sw = (await listTargets()).find((t) => t.type === "service_worker" && t.url.includes(granted));
  const swSession = sw ? await attach(sw.targetId) : null;
  record("service worker is running", Boolean(swSession));
  ghTarget = gh.targetId;
  await send("Target.activateTarget", { targetId: gh.targetId });
  await sleep(800);

  // ---- Quick Scan, real page, localhost not running ----
  const p1 = await openPanel(granted);
  record("start screen offers 'Scan this page'", (await text(p1.s, "#scanButton")) === "Scan this page");
  const nativeAi = await ev(p1.s, "typeof LanguageModel === 'undefined' ? 'api-missing' : LanguageModel.availability({expectedInputs:[{type:'text',languages:['en']}],expectedOutputs:[{type:'text',languages:['en']}]})");
  console.log("INFO  Chrome's own LanguageModel.availability() on this machine:", nativeAi);

  // double click: one scan only
  await ev(p1.s, "const b = document.querySelector('#scanButton'); b.click(); b.click(); b.click();");
  const done = await waitFor(p1.s, "!document.querySelector('#results').classList.contains('hidden')", 40000);
  record("Quick Scan completes on the GitHub Terms page with localhost stopped", done, await text(p1.s, "#resultTitle"));
  const scans = await ev(p1.s, "window.__sent.filter(t => t === 'SCAN_TAB').length");
  record("triple-click starts exactly one scan", scans === 1, `SCAN_TAB sent ${scans}x`);

  const cards = await ev(p1.s, "document.querySelectorAll('.finding').length");
  record("badge reads Quick Scan with the contract-patterns explanation",
    (await text(p1.s, "#modeBadge")) === "Quick Scan" &&
    (await text(p1.s, "#modeExplainer")) === "Checks this page for known contract patterns. It may miss clauses that depend on context.");
  record("page text says nothing about AI for Quick Scan", !/\bAI\b/.test(await text(p1.s, "#modeExplainer")));
  const titles = await ev(p1.s, "[...document.querySelectorAll('.finding')].map(c => c.querySelector('h3').textContent + '|' + c.querySelector('blockquote').textContent)");
  record("every finding is unique", new Set(titles).size === titles.length && cards > 0, `${cards} cards`);
  const counts = await ev(p1.s, "[...document.querySelectorAll('.summary-count strong')].map(e => +e.textContent)");
  const byClass = await ev(p1.s, "['concern','caution','positive'].map(c => document.querySelectorAll('.finding.' + c).length)");
  record("summary counts equal rendered cards", JSON.stringify(counts) === JSON.stringify(byClass) && counts.reduce((a, b) => a + b, 0) === cards, JSON.stringify(counts));
  const quotes = await ev(p1.s, "[...document.querySelectorAll('.finding blockquote')].map(q => q.textContent.replace(/^\\u201C|\\u201D$/g, ''))");
  const pageText = await ev(gh.s, "document.body.innerText.replace(/\\s+/g, ' ')");
  record("every blockquote is non-empty and appears in the live page text", quotes.length === cards && quotes.every((q) => q.trim().length >= 8 && pageText.includes(q)), `${quotes.length} checked`);
  record("no source button is active without evidence", await ev(p1.s, "[...document.querySelectorAll('.finding')].every(c => !c.querySelector('.source-button').disabled && c.querySelector('blockquote').textContent.length > 4)"));
  record("limitations and disclaimer are present", /not legal advice/.test(await text(p1.s, "#limitations")) && /not legal advice/.test(await text(p1.s, "footer")));

  // filters
  let filtersOk = true;
  const detail = [];
  for (const kind of ["all", "concern", "caution", "positive"]) {
    await ev(p1.s, `document.querySelector('.filter[data-filter=${kind}]').click()`);
    const shown = await ev(p1.s, "[...document.querySelectorAll('.finding')].map(c => c.className.replace('finding ', ''))");
    const expected = kind === "all" ? cards : counts[["concern", "caution", "positive"].indexOf(kind)];
    const right = shown.length === expected && (kind === "all" || shown.every((c) => c === kind));
    detail.push(`${kind}:${shown.length}`);
    filtersOk &&= right;
  }
  record("All and each category filter show the right cards", filtersOk, detail.join(" "));
  await ev(p1.s, "document.querySelector('.filter[data-filter=all]').click()");

  // highlight real evidence for several findings
  let highlightOk = true;
  const nSources = Math.min(cards, 4);
  for (let i = 0; i < nSources; i++) {
    await ev(gh.s, "document.querySelectorAll('*').forEach(e => { e.style.outline = ''; })");
    await ev(p1.s, `document.querySelectorAll('.source-button')[${i}].click()`);
    await sleep(1200);
    const ok = await ev(gh.s, "[...document.querySelectorAll('*')].some(e => /245, 158, 11|f59e0b/i.test(e.style.outline))");
    const target = await ev(gh.s, "[...document.querySelectorAll('*')].find(e => /245, 158, 11|f59e0b/i.test(e.style.outline))?.innerText.replace(/\\s+/g,' ').slice(0,4000) ?? ''");
    highlightOk &&= ok && target.includes(quotes[i].slice(0, 30));
  }
  record("'Show on the page' highlights the real evidence element", highlightOk, `${nSources} checked`);
  await pngOf(p1.s, "panel-quick.png");

  // hand-off buttons are offered after the Quick Scan
  record("ChatGPT and Gemini buttons appear with the Quick Scan result", (await visible(p1.s, "#chatgptButton")) && (await visible(p1.s, "#geminiButton")));

  // rescan does not stack results
  await ev(p1.s, "document.querySelector('#scanAgain').click()");
  await waitFor(p1.s, "!document.querySelector('#results').classList.contains('hidden')", 40000);
  await sleep(800);
  record("scanning again replaces results (no stale or doubled cards)", (await ev(p1.s, "document.querySelectorAll('.finding').length")) === cards);

  // close and reopen
  await send("Target.closeTarget", { targetId: p1.targetId });
  const reopened = await openPanel(granted);
  record("reopened panel starts clean", (await visible(reopened.s, "#idle")) && (await ev(reopened.s, "document.querySelectorAll('.finding').length")) === 0);
  await scanAndWait(reopened.s);
  record("scan after reopening gives the same, non-duplicated cards", (await ev(reopened.s, "document.querySelectorAll('.finding').length")) === cards);
  await pngOf(reopened.s, "panel-results.png");

  // ---- Continue in ChatGPT / Gemini ----
  const downloads = join(process.env.USERPROFILE || "", "Downloads");
  const handoffClick = async (extId, id) => {
    const p = await openPanel(extId);
    await scanAndWait(p.s);
    await sleep(800);
    // Clipboard writes need a focused page; emulate focus without switching tabs (which would reset the panel).
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }, p.s);
    await ev(p.s, `document.querySelector('#${id}Button').click()`);
    await waitFor(p.s, "!document.querySelector('#handoffStatus').classList.contains('hidden')", 10000);
    await sleep(1500);
    const stillThere = (await visible(p.s, "#results")) && (await visible(p.s, "#handoffStatus")) && (await ev(p.s, "document.querySelectorAll('.finding').length")) > 0;
    record(`${id}: results and the "Prompt copied" message stay on screen after the new tab opens`, stillThere);
    return { p, status: await text(p.s, "#handoffStatus"), clip: readClipboard() };
  };

  // Short document: the full prompt fits on the clipboard.
  {
    const SMALL = "https://docs.github.com/terms-lens-test/short-terms";
    const html = "<!doctype html><html><head><title>Test Terms</title></head><body><main><h1>Test Terms</h1><h2>Disputes</h2><p>All disputes will be resolved through binding arbitration on an individual basis.</p><h2>Billing</h2><p>Your subscription will automatically renew each month unless you cancel before renewal.</p></main></body></html>";
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const s = await attach(targetId);
    listeners.push(async (m) => {
      if (m.method === "Fetch.requestPaused" && m.sessionId === s) {
        await send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: Buffer.from(html).toString("base64") }, s);
      }
    });
    await send("Fetch.enable", { patterns: [{ urlPattern: `${SMALL}*` }] }, s);
    await send("Page.navigate", { url: SMALL }, s);
    await waitFor(s, "document.readyState === 'complete' && document.querySelectorAll('p').length >= 2");
    await send("Target.activateTarget", { targetId });
    ghTarget = targetId;
    await sleep(800);
    for (const [id, label, url] of [["chatgpt", "ChatGPT", "https://chatgpt.com"], ["gemini", "Gemini", "https://gemini.google.com"]]) {
      await send("Target.activateTarget", { targetId });
      const { status, clip } = await handoffClick(granted, id);
      record(`Continue in ${label} (short page) shows "Prompt copied. Paste it into ${label} to continue."`, status === `Prompt copied. Paste it into ${label} to continue.`, status);
      record(`Continue in ${label} (short page) copied the complete prompt`, clip.includes("--- DOCUMENT TEXT ---") && clip.includes("Test Terms") && clip.includes(SMALL) && clip.includes("binding arbitration") && clip.includes("Mandatory arbitration") && clip.includes("Do not invent clauses"), `${clip.length} chars`);
      record(`Continue in ${label} opened ${url}`, (await listTargets()).some((t) => t.type === "page" && t.url.startsWith(url)));
    }
    ghTarget = gh.targetId;
  }

  // Long document (the real GitHub terms): saved as a file, short instructions copied.
  for (const [id, label, url] of [["chatgpt", "ChatGPT", "https://chatgpt.com"], ["gemini", "Gemini", "https://gemini.google.com"]]) {
    await send("Target.activateTarget", { targetId: gh.targetId });
    const started = Date.now();
    const { p, status, clip } = await handoffClick(granted, id);
    const file = `terms-lens-github-terms-of-service-github-docs-analysis.md`;
    record(`Continue in ${label} (long page) explains the file upload in one sentence`, status.includes(file) && status.includes(`Upload the file in ${label}`), status);
    record(`Continue in ${label} (long page) copied short instructions naming the file`, clip.includes(file) && clip.length < 400, `${clip.length} chars`);
    const candidates = [file, file.replace(".md", " (1).md"), file.replace(".md", " (2).md")].map((f) => join(downloads, f)).filter((f) => existsSync(f));
    const saved = candidates.find((f) => statSync(f).mtimeMs >= started - 2000);
    record(`Continue in ${label} (long page) downloaded the analysis file with the document`, Boolean(saved) && readFileSync(saved, "utf8").includes("--- DOCUMENT TEXT ---") && readFileSync(saved, "utf8").includes("GitHub Terms of Service"), saved || "no file found");
    if (saved) rmSync(saved, { force: true }); // remove the test artifact from Downloads
    record(`Continue in ${label} (long page) opened ${url}`, (await listTargets()).some((t) => t.type === "page" && t.url.startsWith(url)));
    if (id === "gemini") await pngOf(p.s, "panel-handoff.png");
  }
  const leaked = requests.filter((r) => panelSessions.has(r.s) && /chatgpt\.com|openai\.com|gemini\.google|generativelanguage|googleapis/i.test(r.url));
  record("no document content is sent to ChatGPT or Gemini by Terms Lens", leaked.length === 0, leaked.map((r) => r.url).join(",") || "panel made no request to either service");
  const posts = requests.filter((r) => panelSessions.has(r.s) && r.method !== "GET");
  record("side panel made no POST/PUT requests at all", posts.length === 0, posts.map((r) => r.url).join(","));

  // ---- Private AI states (stand-in model; real model is never downloaded here) ----
  for (const [label, state] of [["unavailable", "unavailable"], ["API missing", "missing"]]) {
    const p = await openPanel(granted, { fakeModel: FAKE(state) });
    await scanAndWait(p.s);
    await sleep(800);
    const info = await ev(p.s, "({ err: !document.querySelector('#error').classList.contains('hidden'), cards: document.querySelectorAll('.finding').length, aiHidden: document.querySelector('#aiOffer').classList.contains('hidden'), chatgpt: !!document.querySelector('#chatgptButton').offsetParent, gemini: !!document.querySelector('#geminiButton').offsetParent })");
    record(`AI ${label}: Quick Scan stays, no error, ChatGPT and Gemini offered`, !info.err && info.cards > 0 && info.aiHidden && info.chatgpt && info.gemini, JSON.stringify(info));
  }
  {
    const p = await openPanel(granted, { fakeModel: FAKE("downloadable") });
    await scanAndWait(p.s);
    await sleep(1000);
    const before = await ev(p.s, "({ created: window.__lm.createCalls, button: document.querySelector('#aiButton').textContent, text: document.querySelector('#aiOfferText').textContent })");
    record("downloadable: nothing downloads before the click; button says Download private AI model", before.created === 0 && before.button === "Download private AI model" && /on-device AI/.test(before.text), JSON.stringify(before));
    await ev(p.s, "document.querySelector('#aiButton').click()");
    const ok = await waitFor(p.s, "document.querySelector('#modeBadge').textContent === 'Private AI Scan'", 30000);
    const after = await ev(p.s, "({ created: window.__lm.createCalls, title: document.querySelector('.finding h3')?.textContent, explainer: document.querySelector('#modeExplainer').textContent, tabs: !document.querySelector('#modeTabs').classList.contains('hidden') })");
    record("downloadable: a click starts the download and shows Private AI results", ok && after.created === 1 && after.title === "Stand-in model finding" && /stays on this device/.test(after.explainer) && after.tabs, JSON.stringify(after));
    await pngOf(p.s, "panel-ai.png");
    await ev(p.s, "document.querySelector('.mode-tab[data-mode=quick]').click()");
    record("Quick and Private AI results stay visually separate and switchable", (await text(p.s, "#modeBadge")) === "Quick Scan" && (await ev(p.s, "document.querySelectorAll('.finding').length")) === cards);
  }
  {
    const p = await openPanel(granted, { fakeModel: FAKE("downloading") });
    await scanAndWait(p.s);
    await sleep(1000);
    const info = await ev(p.s, "({ created: window.__lm.createCalls, button: document.querySelector('#aiButton').textContent, text: document.querySelector('#aiOfferText').textContent })");
    record("downloading: shown as not ready, and no session is created", info.created === 0 && info.button === "Check again" && /isn't ready yet/.test(info.text), JSON.stringify(info));
  }
  for (const [label, behaviour] of [["model throws", "throw"], ["model returns invalid output", "invalid"], ["model invents evidence", "invented"]]) {
    const p = await openPanel(granted, { fakeModel: FAKE("available", behaviour) });
    await scanAndWait(p.s);
    await sleep(800);
    await ev(p.s, "document.querySelector('#aiButton').click()");
    await waitFor(p.s, "window.__lm.createCalls > 0 && (!document.querySelector('#notice').classList.contains('hidden') || !document.querySelector('#modeTabs').classList.contains('hidden'))", 15000);
    await sleep(500);
    const info = await ev(p.s, "({ badge: document.querySelector('#modeBadge').textContent, notice: document.querySelector('#notice').textContent, cards: document.querySelectorAll('.finding').length, titles: [...document.querySelectorAll('.finding h3')].map(h => h.textContent), err: !document.querySelector('#error').classList.contains('hidden'), trace: /TypeError|Error:|\\.js:\\d+|undefined/.test(document.body.innerText) })");
    const good = !info.err && !info.trace && !info.titles.includes("Invented clause") && info.badge === "Quick Scan" && info.cards === cards;
    record(`AI ${label}: safe fallback, no stack trace, nothing invented shown`, good, JSON.stringify({ badge: info.badge, cards: info.cards, notice: info.notice.slice(0, 80) }));
  }

  // ---- permission denial is recoverable (manual URL path) ----
  {
    const p = await openPanel(granted);
    await scanAndWait(p.s);
    await ev(p.s, "window.__origRequest = chrome.permissions.request.bind(chrome.permissions); chrome.permissions.request = async () => false; document.querySelector('.manual-entry').open = true; document.querySelector('#manualUrl').value = 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement'; document.querySelector('#analyzeManual').click();");
    await waitFor(p.s, "!document.querySelector('#error').classList.contains('hidden')", 8000);
    const msg = await text(p.s, "#errorMessage");
    record("permission denied: calm message, nothing fetched", /permission/i.test(msg) && /try again/i.test(msg) && !/Error:|undefined/.test(msg), msg);
    await ev(p.s, "chrome.permissions.request = async () => true; document.querySelector('#scanButton'); void 0");
    await ev(p.s, "document.querySelector('#retry').click()");
    const back = await waitFor(p.s, "!document.querySelector('#results').classList.contains('hidden')", 40000);
    record("after a denial the user can simply try again and scan works", back);
  }

  // ---- unsupported pages (build with the 'tabs' permission, so the URL is visible) ----
  {
    const browserPage = await openPage("chrome://version/");
    await send("Target.activateTarget", { targetId: browserPage.targetId });
    await sleep(700);
    const p = await openPanel(withTabs, { keepTab: true });
    await ev(p.s, "document.querySelector('#scanButton').click()");
    await waitFor(p.s, "!document.querySelector('#access').classList.contains('hidden')", 10000);
    const t = await text(p.s, "#accessTitle"); const b = await text(p.s, "#accessText");
    record("chrome:// page: friendly 'can't be scanned' message", /can't be scanned/.test(t) && /Chrome's own pages/.test(b) && !(await visible(p.s, "#error")), t);
    const store = await openPage("https://chromewebstore.google.com/");
    await send("Target.activateTarget", { targetId: store.targetId });
    await sleep(800);
    const p2 = await openPanel(withTabs, { keepTab: true });
    await ev(p2.s, "document.querySelector('#scanButton').click()");
    await waitFor(p2.s, "!document.querySelector('#access').classList.contains('hidden')", 10000);
    record("Chrome Web Store: friendly 'can't be scanned' message", /Web Store/.test(await text(p2.s, "#accessText")), await text(p2.s, "#accessText"));
  }

  // ---- shipped manifest: no toolbar click yet -> friendly activation card ----
  {
    await send("Target.activateTarget", { targetId: gh.targetId });
    await sleep(700);
    const p = await openPanel(pristine);
    await ev(p.s, "document.querySelector('#scanButton').click()");
    await sleep(2500);
    record("shipped build before the toolbar click: friendly card, no error", (await visible(p.s, "#access")) && !(await visible(p.s, "#error")), await text(p.s, "#accessTitle"));
  }

  // ---- global checks ----
  const local = requests.filter((r) => /127\.0\.0\.1|localhost|:8787/.test(r.url));
  record("no request to localhost during any test", local.length === 0, `${requests.length} requests observed`);
  const ext = errors.filter((e) => !/favicon/i.test(e.text) && !/docs\.github\.com|chatgpt|gemini|google|w3\.org/i.test(e.text) && ![gh.s].includes(e.s));
  record("no extension console errors (side panel and service worker)", ext.length === 0, ext.map((e) => e.text).join(" | "));
} catch (error) {
  console.error("HARNESS ERROR", error);
  record("harness completed", false, String(error));
} finally {
  writeFileSync(join(OUT, "e2e-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nResults and screenshots: ${OUT}`);
  chrome.kill();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
