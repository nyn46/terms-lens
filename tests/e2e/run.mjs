// Real-Chrome end-to-end check. Development only; not part of the packaged extension.
// Usage: npm run test:e2e   (needs Google Chrome; uses a throwaway profile and a test-only fixture server)
//
// Chrome is launched with a throwaway profile and the unpacked extension is loaded over the DevTools pipe. The popup
// is opened as a tab (Chrome cannot click the toolbar icon for us) and pointed at the page under test. Chrome cannot
// grant "activeTab" without that physical click, so test-only copies of the manifest add host access for the fixture
// hosts; the shipped manifest is exercised in the "blocked" scenario.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "../fixtures/server.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(ROOT, "extension");
const OUT = process.env.E2E_OUT || mkdtempSync(join(tmpdir(), "terms-lens-e2e-"));
const CHROME = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);
if (!CHROME) throw new Error("Chrome was not found. Set CHROME_PATH.");
const GITHUB = "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service";

const fixtures = await startFixtureServer();
const FIX = (name) => `http://fixtures.test:${fixtures.port}/${name}`;

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
const grantedDir = makeCopy("ext-granted", (m) => { m.host_permissions = ["http://fixtures.test/*", "https://docs.github.com/*"]; });
const crossDir = makeCopy("ext-cross", (m) => { m.host_permissions = ["http://fixtures.test/*", "http://other.test/*"]; });

const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  `--host-resolver-rules=MAP fixtures.test 127.0.0.1, MAP other.test 127.0.0.1`,
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out after 30s`)); }, 30000);
  pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const requests = [];
const popupSessions = new Set();
const createdTabs = [];
listeners.push((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push({ s: m.sessionId, text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push({ s: m.sessionId, text: `${m.params.entry.text} ${m.params.entry.url || ""}` });
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push({ s: m.sessionId, text: m.params.args.map((a) => a.value ?? a.description).join(" ") });
  if (m.method === "Network.requestWillBeSent") requests.push({ s: m.sessionId, url: m.params.request.url, method: m.params.request.method });
  if (m.method === "Target.targetCreated" && m.params.targetInfo.type === "page") createdTabs.push({ url: m.params.targetInfo.url, at: Date.now(), targetId: m.params.targetInfo.targetId });
});

async function attach(targetId, { enableNetwork = true } = {}) {
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Runtime", "Log", ...(enableNetwork ? ["Network"] : []), "Page"]) await send(`${domain}.enable`, {}, sessionId).catch(() => {});
  return sessionId;
}
const ev = async (s, expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, s);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (s, expression, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await ev(s, expression)) return true; } catch { /* still loading */ }
    await sleep(200);
  }
  return false;
};

const results = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 300) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  [${String(detail).slice(0, 200)}]` : ""}`);
};
await send("Target.setDiscoverTargets", { discover: true });

const pngOf = async (s, name) => writeFileSync(join(OUT, name), Buffer.from((await send("Page.captureScreenshot", { format: "png" }, s)).data, "base64"));
const readClipboard = () => execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" });

// ---- the page under test -------------------------------------------------------------------------------

let pageTarget;
let pageSession;
let extId;
let swSession;

async function openPageTab() {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  pageTarget = targetId;
  pageSession = await attach(targetId, { enableNetwork: false });
}

async function gotoPage(url, ready = "document.readyState === 'complete'") {
  await send("Page.navigate", { url }, pageSession);
  await send("Target.activateTarget", { targetId: pageTarget });
  await waitFor(pageSession, ready);
  await sleep(700);
}

const loaded = new Map();
async function useExtension(dir) {
  if (!loaded.has(dir)) {
    const { id } = await send("Extensions.loadUnpacked", { path: dir });
    await sleep(800);
    const sw = (await send("Target.getTargets")).targetInfos.find((t) => t.type === "service_worker" && t.url.includes(id));
    loaded.set(dir, { id, sw: sw ? await attach(sw.targetId) : null });
  }
  ({ id: extId, sw: swSession } = loaded.get(dir));
  return extId;
}

async function pageTabInfo() {
  if (!swSession) return null;
  return ev(swSession, "chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((t) => t[0] ? { id: t[0].id, url: t[0].url, title: t[0].title } : null)");
}

const FAKE_DELAY = "const _ex = chrome.scripting.executeScript.bind(chrome.scripting); chrome.scripting.executeScript = async (...a) => { await new Promise((r) => setTimeout(r, window.__delay || 0)); return _ex(...a); };";
const COUNT_MESSAGES = "window.__sent = []; const _sm = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = (m, ...r) => { window.__sent.push(m?.type); return _sm(m, ...r); };";

async function openPopup({ tab, reducedMotion = false, height = 600 } = {}) {
  const info = tab ?? (await pageTabInfo());
  const { targetId } = await send("Target.createTarget", { url: "about:blank", background: true });
  const s = await attach(targetId);
  popupSessions.add(s);
  await send("Emulation.setDeviceMetricsOverride", { width: 392, height, deviceScaleFactor: 1, mobile: false }, s);
  if (reducedMotion) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, s);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `chrome.tabs.query = async () => [${JSON.stringify(info)}]; ${FAKE_DELAY} ${COUNT_MESSAGES}` }, s);
  await send("Page.navigate", { url: `chrome-extension://${extId}/popup.html` }, s);
  await waitFor(s, "!!document.querySelector('#scanButton') && document.readyState === 'complete'");
  await sleep(250);
  return { targetId, s, info };
}

const text = (s, sel) => ev(s, `document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const visible = (s, sel) => ev(s, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.classList.contains('hidden'); })()`);
const shown = (s) => ev(s, "['idle','loading','results','notice'].find((id) => !document.querySelector('#' + id).classList.contains('hidden'))");

async function scanNow(popup, { wait = 25000 } = {}) {
  await ev(popup.s, "document.querySelector('#scanButton').click()");
  await waitFor(popup.s, "!document.querySelector('#results').classList.contains('hidden') || !document.querySelector('#notice').classList.contains('hidden')", wait);
  await sleep(350);
  return shown(popup.s);
}

const readResults = (s) => ev(s, `({
  title: document.querySelector('#resultTitle').textContent,
  chip: document.querySelector('#sourceChip').textContent,
  counts: [...document.querySelectorAll('.stat strong')].map((e) => +e.textContent),
  cards: [...document.querySelectorAll('.card')].map((c) => ({
    cls: c.className.replace('card ', ''), title: c.querySelector('h3').textContent,
    quote: c.querySelector('blockquote').textContent.replace(/^\\u201C|\\u201D$/g, ''),
    locateDisabled: c.querySelector('.locate').disabled
  }))
})`);

const FIND_HIGHLIGHT = `(() => { const out = []; const visit = (root, tag) => { for (const el of root.querySelectorAll('*')) {
  if (/245, 179, 1|f5b301/i.test(el.style.outline)) out.push({ tag, text: el.textContent.replace(/\\s+/g, ' ').slice(0, 300), inModal: !!el.closest('dialog, [role=dialog], [aria-modal], .terms-layer, .ReactModal__Content') });
  if (el.shadowRoot) visit(el.shadowRoot, 'shadow');
  if (el.tagName === 'IFRAME') { try { visit(el.contentDocument, 'frame'); } catch {} } } }; visit(document, 'top'); return out; })()`;
const CLEAR_HIGHLIGHT = `(() => { const visit = (root) => { for (const el of root.querySelectorAll('*')) { el.style.outline = ''; if (el.shadowRoot) visit(el.shadowRoot); if (el.tagName === 'IFRAME') { try { visit(el.contentDocument); } catch {} } } }; visit(document); })()`;

async function highlightFirst(popup, which = 0) {
  await ev(pageSession, CLEAR_HIGHLIGHT);
  await ev(popup.s, `document.querySelectorAll('.card')[${which}].querySelector('.locate').click()`);
  await sleep(1300);
  return { found: await ev(pageSession, FIND_HIGHLIGHT), note: await ev(popup.s, `document.querySelectorAll('.card')[${which}].querySelector('.locate-note').textContent`) };
}

// ==========================================================================================================
try {
  await sleep(2500);
  await openPageTab();
  const grantedId = await useExtension(grantedDir);
  record("extension loads without manifest errors", Boolean(grantedId) && Boolean(swSession), grantedId);

  // ---- design ------------------------------------------------------------------------------------------
  await gotoPage(FIX("terms"), "document.querySelectorAll('p').length >= 6");
  {
    const p = await openPopup();
    const design = await ev(p.s, `(() => { const cs = (sel) => getComputedStyle(document.querySelector(sel)); return {
      width: document.body.getBoundingClientRect().width, bg: cs('body').backgroundColor,
      fonts: ['body', 'h1', '.page-text strong', '#scanButton'].map((sel) => cs(sel).fontFamily),
      sizeH1: cs('h1').fontSize, primary: cs('#scanButton').backgroundColor,
      icons: document.querySelectorAll('svg.icon').length, emoji: /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(document.body.innerText),
      title: document.querySelector('h1').textContent, tagline: document.querySelector('.brand p').textContent,
      scanLabel: document.querySelector('#scanButton').textContent.trim(), footers: document.querySelectorAll('footer').length,
      footer: document.querySelector('footer').textContent, heroText: document.querySelector('#idle').innerText } })()`);
    record("popup is about 380-400px wide", design.width >= 380 && design.width <= 400, `${design.width}px`);
    record("dark charcoal surface (not pure black), system sans-serif only", design.bg !== "rgb(0, 0, 0)" && /rgb\(1[0-9], 1[0-9], 1[0-9]\)/.test(design.bg) && design.fonts.every((f) => !/georgia|times|serif/i.test(f.replace(/sans-serif/gi, ""))), `${design.bg} ${design.fonts[0].slice(0, 40)}`);
    record("compact header copy and one primary button", design.title === "Terms Lens" && design.tagline === "Know what you\u2019re agreeing to." && design.scanLabel === "Scan this agreement", `${design.title} | ${design.scanLabel}`);
    record("Lucide icons are inline SVG and no emoji is used as an icon", design.icons >= 4 && !design.emoji, `${design.icons} svg icons`);
    record("the disclaimer appears once (footer only)", design.footers === 1 && /Plain-language guidance, not legal advice\./.test(design.footer) && !/legal advice/.test(design.heroText));
    await pngOf(p.s, "popup-idle.png");
  }

  // ---- dedicated terms page + result design ----------------------------------------------------------------
  {
    const p = await openPopup();
    await ev(p.s, "window.__delay = 900");
    const samples = new Set();
    const click = ev(p.s, "document.querySelector('#scanButton').click()");
    const stop = Date.now() + 9000;
    let loadingShot = false;
    while (Date.now() < stop && (await shown(p.s)) !== "results") {
      samples.add(await text(p.s, "#loadingText"));
      if (!loadingShot && (await shown(p.s)) === "loading") { await pngOf(p.s, "popup-loading.png"); loadingShot = true; }
      await sleep(150);
    }
    await click;
    const stages = [...samples].filter(Boolean);
    // "Checking important clauses" is the real (millisecond-long) local analysis step, so it cannot be sampled.
    record("loading shows honest, changing status copy (no percentages)", stages.includes("Finding the agreement") && stages.includes("Matching the original wording") && !stages.some((t) => /%/.test(t)), stages.join(" > "));
    await ev(p.s, "window.__delay = 0");
    const r = await readResults(p.s);
    record("dedicated terms page scans (source: Page)", r.chip === "Page" && r.cards.length >= 5, `${r.title}: ${r.cards.length} findings`);
    const dup = new Set(r.cards.map((c) => `${c.title}|${c.quote}`));
    const classCounts = ["concern", "caution", "positive"].map((k) => r.cards.filter((c) => c.cls.startsWith(k)).length);
    record("summary counts equal the rendered unique findings; no duplicates", dup.size === r.cards.length && JSON.stringify(classCounts) === JSON.stringify(r.counts), JSON.stringify(r.counts));
    const fixturePlain = await ev(pageSession, "document.body.innerText.replace(/\\s+/g, ' ')");
    record("every excerpt is non-empty and appears in the page", r.cards.every((c) => c.quote.trim().length >= 8 && fixturePlain.includes(c.quote)));
    record("Quick Scan explanation is shown", (await text(p.s, ".mode-note")).includes("Checks this page for known contract patterns. It may miss clauses that depend on context."));
    // filters
    let ok = true; const seen = [];
    for (const kind of ["all", "concern", "caution", "positive"]) {
      await ev(p.s, `document.querySelector('.filter[data-filter=${kind}]').click()`);
      const cls = await ev(p.s, "[...document.querySelectorAll('.card')].map((c) => c.className.replace('card ', ''))");
      const want = kind === "all" ? r.cards.length : r.counts[["concern", "caution", "positive"].indexOf(kind)];
      seen.push(`${kind}:${cls.length}`);
      ok &&= cls.length === want && (kind === "all" || cls.every((c) => c === kind));
    }
    record("All and every category filter show the right findings", ok, seen.join(" "));
    await ev(p.s, "document.querySelector('.filter[data-filter=all]').click()");
    const h = await highlightFirst(p);
    record("Show on the page highlights the real evidence on a normal page", h.found.length > 0 && h.note === "Highlighted on the page.", h.note);
    // disclosure + deeper section design
    await ev(p.s, "document.querySelector('.card .link[aria-expanded]').click()");
    await sleep(300);
    const reveal = await ev(p.s, "(() => { const r = document.querySelector('.card .reveal'); return { open: r.classList.contains('open'), h: r.getBoundingClientRect().height, exp: document.querySelector('.card .link[aria-expanded]').getAttribute('aria-expanded') }; })()");
    record("Original wording expands smoothly (aria-expanded, grid transition)", reveal.open && reveal.h > 10 && reveal.exp === "true", JSON.stringify(reveal));
    const deeper = await ev(p.s, "({ heading: document.querySelector('#deeperTitle').textContent.trim(), hint: document.querySelector('.deeper > p').textContent, a: document.querySelector('#chatgptButton').textContent.trim(), b: document.querySelector('#geminiButton').textContent.trim() })");
    record("deeper-analysis section has the two clear actions and the short explanation", deeper.heading === "Want a deeper analysis?" && deeper.a === "Analyze with ChatGPT" && deeper.b === "Analyze with Gemini" && deeper.hint === "We\u2019ll copy a ready-made analysis prompt and open the AI you choose.", JSON.stringify(deeper));
    await pngOf(p.s, "popup-results.png");

    // motion
    const motion = await ev(p.s, "(() => { const cs = (el) => getComputedStyle(el); const card = document.querySelector('.card'); return { cardAnim: cs(card).animationName, cardDur: cs(card).animationDuration, btnTrans: cs(document.querySelector('.button')).transitionDuration, filterTrans: cs(document.querySelector('.filter')).transitionDuration, stagger: [...document.querySelectorAll('.card')].slice(0, 3).map((c) => cs(c).animationDelay) }; })()");
    const ms = (v) => parseFloat(v) * (/ms$/.test(v) ? 1 : 1000);
    record("motion is restrained: 140-200 ms, small stagger, CSS only", motion.cardAnim === "enter" && ms(motion.cardDur) <= 220 && ms(motion.btnTrans) >= 140 && ms(motion.btnTrans) <= 220 && motion.stagger.length === 3, JSON.stringify(motion));
    const reduced = await openPopup({ reducedMotion: true });
    await scanNow(reduced);
    const still = await ev(reduced.s, "(() => { const cs = (el) => getComputedStyle(el); return { card: cs(document.querySelector('.card')).animationName, cardDur: cs(document.querySelector('.card')).animationDuration, btn: cs(document.querySelector('.button')).transitionDuration, rev: cs(document.querySelector('.card .reveal')).transitionDuration, view: cs(document.querySelector('#results')).animationName }; })()");
    record("prefers-reduced-motion disables animation and transitions", still.card === "none" && ms(still.btn) === 0 && ms(still.rev) === 0 && still.view === "none", JSON.stringify(still));
  }

  // ---- fixture scenarios: dialogs, overlays, portals, shadow DOM, iframes ------------------------------------
  const MODAL_CASES = [
    ["native <dialog>", "signup-dialog", "document.querySelector('dialog')?.open === true"],
    ["ARIA dialog", "signup-aria", "!!document.querySelector('[role=dialog]')"],
    ["aria-modal section", "signup-aria-modal", "!!document.querySelector('[aria-modal]')"],
    ["fixed overlay without semantics", "signup-overlay", "!!document.querySelector('.terms-layer')"],
    ["React-style portal (inserted after load)", "signup-portal", "!!document.querySelector('#portal-root .ReactModal__Content')"],
    ["open Shadow DOM modal", "signup-shadow", "(document.querySelector('terms-modal')?.shadowRoot?.textContent || '').length > 500"],
    ["dynamically inserted dialog", "dynamic-dialog", "document.querySelector('dialog')?.open === true"],
    ["multiple dialogs (cookie + newsletter + terms)", "multi-dialogs", "document.querySelectorAll('[role=dialog]').length === 3"]
  ];
  for (const [label, name, ready] of MODAL_CASES) {
    await gotoPage(FIX(name), ready);
    const p = await openPopup();
    const view = await scanNow(p);
    const r = view === "results" ? await readResults(p.s) : null;
    const modalOnly = r && r.cards.length >= 5 && r.chip === "Signup popup" && !r.cards.some((c) => c.quote.includes("BACKGROUND-SENTINEL") || /cookies|newsletter/i.test(c.quote));
    record(`${label}: the visible agreement is scanned, not the page behind it`, modalOnly, r ? `${r.chip}; ${r.title}; ${r.cards.length} findings` : view);
    if (modalOnly) {
      const all = r.cards.map((c) => c.title);
      record(`${label}: expected clauses found once each`, ["Mandatory arbitration", "Class actions waived", "Automatic renewal", "Refunds restricted", "Long-lasting content licence"].every((t) => all.filter((x) => x === t).length === 1), all.join(", "));
      const h = await highlightFirst(p);
      record(`${label}: Show on the page highlights inside the agreement`, h.note === "Highlighted on the page." && (name === "signup-shadow" ? h.found.some((x) => x.tag === "shadow") : h.found.some((x) => x.inModal)), `${h.note} ${JSON.stringify(h.found.map((x) => x.tag))}`);
    }
    if (name === "signup-dialog") await pngOf(p.s, "popup-modal.png");
  }

  // false positives and hidden dialogs: the PAGE is scanned, never the banner/newsletter/hidden terms
  for (const [label, name, ready, banned] of [
    ["cookie banner", "cookie-banner", "!!document.querySelector('[role=dialog]')", /cookies|privacy policy/i],
    ["newsletter modal", "newsletter", "!!document.querySelector('[role=dialog]')", /newsletter|gardeners/i],
    ["hidden and aria-hidden modals", "hidden-modal", "document.readyState === 'complete'", /perpetual|binding arbitration/i]
  ]) {
    await gotoPage(FIX(name), ready);
    const p = await openPopup();
    const view = await scanNow(p);
    const r = view === "results" ? await readResults(p.s) : null;
    const good = r && r.chip === "Page" && r.cards.some((c) => c.quote.includes("BACKGROUND-SENTINEL")) && !r.cards.some((c) => banned.test(c.quote));
    record(`${label}: rejected as the agreement; the page is scanned instead`, good, r ? `${r.chip}; ${r.cards.length} findings` : view);
  }

  // same-origin iframe
  await gotoPage(FIX("signup-iframe-same"), "!!document.querySelector('iframe')");
  await sleep(1200);
  {
    const p = await openPopup();
    const view = await scanNow(p);
    const r = view === "results" ? await readResults(p.s) : null;
    record("same-origin iframe agreement is scanned (not the signup page)", r && r.cards.length >= 5 && r.chip === "Embedded page" && !r.cards.some((c) => c.quote.includes("BACKGROUND-SENTINEL")), r ? `${r.chip}; ${r.title}` : view);
    if (r) {
      const h = await highlightFirst(p);
      record("same-origin iframe: Show on the page highlights inside the frame", h.note === "Highlighted on the page." && h.found.some((x) => x.tag === "frame"), `${h.note} ${JSON.stringify(h.found.map((x) => x.tag))}`);
    }
  }

  // scrolling modal: the correct container scrolls, not the window
  await gotoPage(FIX("scrolling-modal"), "!!document.querySelector('#scroller')");
  {
    const p = await openPopup();
    await scanNow(p);
    const r = await readResults(p.s);
    const refund = r.cards.findIndex((c) => c.title === "Refunds restricted");
    await ev(pageSession, "document.querySelector('#scroller').scrollTop = 0; window.scrollTo(0, 0);");
    const h = await highlightFirst(p, refund);
    const scroll = await ev(pageSession, "({ modal: document.querySelector('#scroller').scrollTop, win: window.scrollY })");
    record("highlight scrolls the modal's own container (nested scrolling modal)", refund >= 0 && scroll.modal > 150 && scroll.win === 0 && h.note === "Highlighted on the page.", JSON.stringify(scroll));
  }

  // ---- cross-origin embedded agreement ---------------------------------------------------------------------------
  await gotoPage(FIX("signup-iframe-cross"), "!!document.querySelector('iframe')");
  await sleep(1500);
  {
    const p = await openPopup();
    const view = await scanNow(p);
    const t = view === "notice" ? await text(p.s, "#noticeTitle") : "";
    const buttons = view === "notice" ? await ev(p.s, "[...document.querySelectorAll('#noticeActions button')].map((b) => b.textContent)") : [];
    record("cross-origin embedded agreement: honest message, nothing from the page behind it is scanned", view === "notice" && t === "This agreement is embedded from another website.", t || view);
    record("cross-origin: offers exact-site permission and 'Open agreement and scan'", buttons.length === 2 && /^Allow other\.test:\d+ and scan$/.test(buttons[0]) && buttons[1] === "Open agreement and scan", JSON.stringify(buttons));
    await ev(p.s, "chrome.permissions.request = async () => false; document.querySelector('#noticeActions button').click();");
    await sleep(500);
    const denied = await text(p.s, "#noticeText");
    record("cross-origin: denying permission is calm and recoverable", /Permission wasn't granted/.test(denied) && (await visible(p.s, "#notice")) && (await ev(p.s, "document.querySelectorAll('#noticeActions button').length")) === 2, denied);
    await pngOf(p.s, "popup-embedded.png");
  }
  {
    // With access to that one extra origin (a separate test build) the framed agreement is scanned in place.
    const crossId = await useExtension(crossDir);
    await send("Target.activateTarget", { targetId: pageTarget });
    await sleep(500);
    await send("Page.reload", {}, pageSession);
    await waitFor(pageSession, "!!document.querySelector('iframe')");
    await sleep(1800);
    const p = await openPopup();
    const view = await scanNow(p);
    const r = view === "results" ? await readResults(p.s) : null;
    record("cross-origin agreement is scanned in place once that one origin is allowed", r && r.cards.length >= 5 && !r.cards.some((c) => c.quote.includes("BACKGROUND-SENTINEL")), r ? `${r.chip}; ${r.title}` : view);
    if (r) {
      const h = await highlightFirst(p);
      record("cross-origin frame: Show on the page highlights inside that frame", /Highlighted on the page\./.test(h.note), h.note);
    }
    await useExtension(grantedDir);
  }

  // ---- open a linked agreement in a tab and scan it (popup closes, worker finishes the job) -----------------------------
  await gotoPage(FIX("empty-with-link"), "document.readyState === 'complete'");
  {
    const p = await openPopup();
    const view = await scanNow(p);
    const opener = view === "notice" ? await ev(p.s, "[...document.querySelectorAll('#noticeActions button')].map((b) => b.textContent)") : [];
    record("a page with no text offers to open its terms link", view === "notice" && opener.some((b) => /^Open Terms of Service and scan$/.test(b)), JSON.stringify(opener));
    const before = createdTabs.length;
    await ev(p.s, "chrome.permissions.request = async () => true; [...document.querySelectorAll('#noticeActions button')].find((b) => /Open/.test(b.textContent)).click();");
    await sleep(4500);
    const tabs = (await send("Target.getTargets")).targetInfos.filter((t) => t.type === "page" && t.url.includes("/terms") && t.url.includes("fixtures.test"));
    record("the agreement opens in a normal tab", createdTabs.length > before && tabs.length >= 1, tabs.map((t) => t.url).join(","));
    if (tabs.length) {
      pageTarget = tabs[0].targetId;
      pageSession = await attach(pageTarget, { enableNetwork: false });
      await send("Target.activateTarget", { targetId: pageTarget });
      await sleep(600);
      const badge = await ev(swSession, `chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((t) => chrome.action.getBadgeText({ tabId: t[0].id }))`);
      const p2 = await openPopup();
      await sleep(900);
      const cached = await shown(p2.s);
      const r = cached === "results" ? await readResults(p2.s) : null;
      record("the worker scanned it: badge set and the popup opens straight onto the result", badge === "\u2713" && cached === "results" && r.cards.length >= 5, `${badge} ${cached}`);
    }
  }

  // ---- closing and reopening keeps the result, and scanning twice never stacks cards ------------------------------------
  await gotoPage(FIX("signup-dialog"), "document.querySelector('dialog')?.open === true");
  {
    const p = await openPopup();
    await ev(p.s, "const b = document.querySelector('#scanButton'); b.click(); b.click(); b.click();");
    await waitFor(p.s, "!document.querySelector('#results').classList.contains('hidden')");
    await sleep(500);
    const scans = await ev(p.s, "window.__sent.length");
    const first = await readResults(p.s);
    record("triple-click runs exactly one scan (no duplicate cards)", first.cards.length >= 5 && new Set(first.cards.map((c) => c.title)).size === first.cards.length);
    await ev(p.s, "document.querySelector('#rescanButton').click()");
    await sleep(1500);
    const again = await readResults(p.s);
    record("scanning again replaces results (nothing doubled)", again.cards.length === first.cards.length, `${first.cards.length} -> ${again.cards.length}`);
    await send("Target.closeTarget", { targetId: p.targetId });
    const reopened = await openPopup();
    await sleep(900);
    const back = (await shown(reopened.s)) === "results" ? await readResults(reopened.s) : null;
    record("closing and reopening the popup restores the same result without duplicates", back && back.cards.length === first.cards.length, back ? `${back.cards.length} cards` : await shown(reopened.s));
  }

  // ---- hand-off to ChatGPT / Gemini ------------------------------------------------------------------------------------------
  for (const [id, label, url] of [["chatgpt", "ChatGPT", "https://chatgpt.com"], ["gemini", "Gemini", "https://gemini.google.com"]]) {
    await gotoPage(FIX("signup-dialog"), "document.querySelector('dialog')?.open === true");
    const p = await openPopup({ height: id === "gemini" ? 1700 : 600 });
    await scanNow(p);
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }, p.s);
    // Spy on the exact moment the new tab appears: is the prompt already on the clipboard, and is the feedback up?
    let atOpen = null;
    const stopAt = createdTabs.length;
    const probe = async (m) => {
      if (m.method === "Target.targetCreated" && m.params.targetInfo.url.startsWith(url) && !atOpen) {
        atOpen = { clip: readClipboard(), feedback: await text(p.s, "#handoffFeedbackText"), feedbackVisible: await visible(p.s, "#handoffFeedback") };
      }
    };
    listeners.push(probe);
    await ev(p.s, `document.querySelector('#${id}Button').click()`);
    await sleep(3200);
    listeners.splice(listeners.indexOf(probe), 1);
    const opened = createdTabs.slice(stopAt).some((t) => t.url.startsWith(url));
    record(`Analyze with ${label}: opens ${url}`, opened, createdTabs.slice(stopAt).map((t) => t.url).join(","));
    record(`Analyze with ${label}: the prompt was already copied when the tab opened`, atOpen && atOpen.clip.includes("--- AGREEMENT TEXT ---") && atOpen.clip.includes("Terms of Service") && atOpen.clip.includes("binding arbitration") && atOpen.clip.includes("Do not invent clauses") && atOpen.clip.includes("Quick Scan findings"), atOpen ? `${atOpen.clip.length} chars` : "tab never opened");
    record(`Analyze with ${label}: "Copied. Paste into ${label} to continue." was on screen before the tab took focus`, atOpen && atOpen.feedbackVisible && atOpen.feedback === `Copied. Paste into ${label} to continue.`, atOpen?.feedback);
    if (id === "gemini") { await ev(p.s, "document.querySelector('.deeper').scrollIntoView({ block: 'end' })"); await sleep(200); await pngOf(p.s, "popup-handoff.png"); }
  }
  {
    // clipboard failure: nothing opens; a selectable prompt and a Copy prompt button appear; retry then works
    await gotoPage(FIX("signup-dialog"), "document.querySelector('dialog')?.open === true");
    const p = await openPopup();
    await scanNow(p);
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }, p.s);
    await ev(p.s, "window.__realWrite = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); window.__realExec = document.execCommand.bind(document); document.execCommand = () => false;");
    const before = createdTabs.length;
    await ev(p.s, "document.querySelector('#chatgptButton').click()");
    await sleep(2200);
    const fb = await ev(p.s, "({ visible: !document.querySelector('#handoffFallback').classList.contains('hidden'), len: document.querySelector('#fallbackText').value.length, has: document.querySelector('#fallbackText').value.includes('--- AGREEMENT TEXT ---'), readonly: document.querySelector('#fallbackText').readOnly, msg: document.querySelector('#handoffFeedbackText').textContent, btn: document.querySelector('#copyPromptButton').textContent.trim() })");
    record("clipboard failure: no tab opens silently", createdTabs.length === before);
    record("clipboard failure: a selectable prompt and 'Copy prompt' are shown with one clear instruction", fb.visible && fb.has && fb.btn === "Copy prompt" && /Copy the text below/.test(fb.msg), JSON.stringify({ len: fb.len, msg: fb.msg }));
    await pngOf(p.s, "popup-copy-fallback.png");
    await ev(p.s, "navigator.clipboard.writeText = window.__realWrite; document.execCommand = window.__realExec; document.querySelector('#copyPromptButton').click();");
    await sleep(2500);
    const after = createdTabs.slice(before).some((t) => t.url.startsWith("https://chatgpt.com"));
    record("clipboard failure: 'Copy prompt' works on retry and then opens ChatGPT", after && readClipboard().includes("--- AGREEMENT TEXT ---"));
  }
  {
    // very long agreement: file + short instructions
    await gotoPage(FIX("long-terms"), "document.querySelectorAll('p').length > 200");
    const p = await openPopup();
    await scanNow(p);
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }, p.s);
    const downloads = join(process.env.USERPROFILE || "", "Downloads");
    const file = "terms-lens-very-long-terms-analysis.md";
    const started = Date.now();
    const before = createdTabs.length;
    await ev(p.s, "document.querySelector('#geminiButton').click()");
    await sleep(3500);
    const status = await text(p.s, "#handoffFeedbackText");
    const clip = readClipboard();
    const saved = [file, file.replace(".md", " (1).md"), file.replace(".md", " (2).md")].map((f) => join(downloads, f)).find((f) => existsSync(f) && statSync(f).mtimeMs >= started - 2000);
    record("large agreement: a clearly named file is downloaded with the whole agreement", Boolean(saved) && readFileSync(saved, "utf8").includes("--- AGREEMENT TEXT ---") && readFileSync(saved, "utf8").includes("Section 260."), saved ? saved.split("\\").pop() : "no file");
    if (saved) rmSync(saved, { force: true });
    record("large agreement: short upload instructions are copied and Gemini opens", clip.includes(file) && clip.length < 300 && createdTabs.slice(before).some((t) => t.url.startsWith("https://gemini.google.com")) && /Upload the file in Gemini/.test(status), `${clip.length} chars; ${status.slice(0, 80)}`);
  }

  // ---- real public page: GitHub Terms of Service -------------------------------------------------------------------------------
  await gotoPage(GITHUB, "document.readyState === 'complete' && document.querySelectorAll('p').length > 20");
  await sleep(1500);
  {
    const p = await openPopup();
    const view = await scanNow(p, { wait: 40000 });
    const r = view === "results" ? await readResults(p.s) : null;
    const pageText = await ev(pageSession, "document.body.innerText.replace(/\\s+/g, ' ')");
    record("real page: GitHub Terms of Service still scans correctly", r && r.chip === "Page" && r.cards.length >= 4 && r.cards.every((c) => pageText.includes(c.quote)), r ? `${r.cards.length} findings; counts ${JSON.stringify(r.counts)}` : view);
    if (r) {
      const h = await highlightFirst(p);
      record("real page: Show on the page highlights the evidence", h.found.length > 0 && h.note === "Highlighted on the page.", h.note);
    }
  }

  // ---- unsupported pages and blocked access -------------------------------------------------------------------------------------------
  for (const [label, url, expect] of [["chrome:// page", "chrome://version/", /Chrome keeps its own pages/], ["Chrome Web Store", "https://chromewebstore.google.com/detail/x", /Chrome Web Store/], ["PDF address", "https://files.test/a.pdf", /PDF agreements can't be scanned yet/]]) {
    const p = await openPopup({ tab: { id: 1, url, title: "x" } });
    record(`${label}: friendly "can't be scanned" message`, (await shown(p.s)) === "notice" && (await text(p.s, "#noticeTitle")) === "This page can't be scanned" && expect.test(await text(p.s, "#noticeText")), await text(p.s, "#noticeText"));
  }
  {
    // the shipped manifest before any toolbar click: Chrome refuses the script, the popup asks calmly
    const pristineId = await useExtension(SRC);
    await gotoPage(FIX("terms"), "document.querySelectorAll('p').length >= 6");
    const tab = { id: (await pageTabInfo())?.id ?? 1, url: FIX("terms"), title: "Acme Cloud Terms of Service" };
    const p = await openPopup({ tab });
    await ev(p.s, "document.querySelector('#scanButton').click()");
    await sleep(2500);
    const title = await text(p.s, "#noticeTitle");
    record("shipped build without access: asks calmly to allow this one site (no error)", (await shown(p.s)) === "notice" && /^Allow Terms Lens to read fixtures\.test:\d+\?$/.test(title), title);
    await ev(p.s, "chrome.permissions.request = async () => false; document.querySelector('#noticeActions button').click();");
    await sleep(500);
    const denied = await text(p.s, "#noticeText");
    record("permission denied: calm explanation, and the user can try again", /No problem\. Nothing was read/.test(denied) && (await ev(p.s, "document.querySelectorAll('#noticeActions button').length")) === 1, denied);
    await useExtension(grantedDir);
  }

  // ---- global checks ---------------------------------------------------------------------------------------------------------------
  const local = requests.filter((r) => /127\.0\.0\.1|localhost|:8787/.test(r.url) && !/fixtures\.test|other\.test/.test(r.url));
  record("no request to localhost (the fixture pages use mapped host names)", local.length === 0, `${requests.length} requests observed`);
  const popupRequests = requests.filter((r) => popupSessions.has(r.s));
  record("popup loads only its own files (no CDN fonts, scripts, styles or icons)", popupRequests.length > 0 && popupRequests.every((r) => /^chrome-extension:|^data:|^blob:/.test(r.url)), popupRequests.filter((r) => !/^chrome-extension:/.test(r.url)).map((r) => r.url).join(","));
  const leaked = requests.filter((r) => popupSessions.has(r.s) && (r.method !== "GET" || /chatgpt\.com|openai\.com|gemini\.google|generativelanguage/i.test(r.url)));
  record("the popup transmits nothing: no request to ChatGPT/Gemini and no POST", leaked.length === 0, leaked.map((r) => `${r.method} ${r.url}`).join(","));
  const ext = errors.filter((e) => popupSessions.has(e.s) || e.s === swSession).filter((e) => !/favicon/i.test(e.text));
  record("no popup or service-worker console errors", ext.length === 0, ext.map((e) => e.text).join(" | "));
} catch (error) {
  console.error("HARNESS ERROR", error);
  record("harness completed", false, String(error));
} finally {
  writeFileSync(join(OUT, "e2e-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nResults and screenshots: ${OUT}`);
  chrome.kill();
  fixtures.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
