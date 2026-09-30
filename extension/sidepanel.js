import { sanitizeDocument } from "./lib/text.js";
import { hasEvidence } from "./lib/result.js";
import { prepareView } from "./lib/view-model.js";
import { buildHandoff, continueIn } from "./lib/handoff.js";
import {
  createProviders,
  normalizePreference,
  runDeeperScan,
  runQuickScan
} from "./lib/providers/index.js";

const providers = createProviders();

const state = {
  preference: "automatic",
  document: null,
  source: null, // { kind: "tab", tabId } or { kind: "url", url }
  links: [],
  results: { quick: null, "private-ai": null },
  mode: "quick",
  filter: "all",
  busy: false,
  scanToken: 0,
  pendingOrigin: null,
  ignoreTabSwitchUntil: 0
};

const $ = (selector) => document.querySelector(selector);
const views = ["idle", "access", "loading", "results", "error"];

const MODE_TEXT = {
  quick: {
    badge: "Quick Scan",
    explainer: "Checks this page for known contract patterns. It may miss clauses that depend on context."
  },
  "private-ai": {
    badge: "Private AI Scan",
    explainer: "Uses Chrome's on-device AI. The document stays on this device. It can still misread context, so check the original wording."
  }
};

const UNSUPPORTED_TEXT = {
  "browser-page": "Chrome's own pages (such as settings or the new-tab page) can't be scanned. Open a website's Terms or Privacy page and try again.",
  "web-store": "Chrome doesn't let extensions read the Chrome Web Store. Open a website's Terms or Privacy page and try again.",
  pdf: "PDF documents can't be scanned yet. If the same terms are available as a web page, open that page instead."
};

bindEvents();
init();

async function init() {
  const saved = await chrome.storage.local.get("providerPreference").catch(() => ({}));
  state.preference = normalizePreference(saved.providerPreference);
  showView("idle");
}

function bindEvents() {
  $("#settingsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#scanButton").addEventListener("click", () => scanCurrentPage());
  $("#accessButton").addEventListener("click", onAccessButton);
  $("#scanAgain").addEventListener("click", () => scanCurrentPage());
  $("#retry").addEventListener("click", () => scanCurrentPage());
  $("#analyzeManual").addEventListener("click", () => scanUrl($("#manualUrl").value));
  $("#aiButton").addEventListener("click", onAiButton);
  $("#chatgptButton").addEventListener("click", () => handoff("chatgpt"));
  $("#geminiButton").addEventListener("click", () => handoff("gemini"));
  $("#modeTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button && state.results[button.dataset.mode]) setMode(button.dataset.mode);
  });
  $("#filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    renderResults();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.providerPreference) {
      state.preference = normalizePreference(changes.providerPreference.newValue);
    }
  });
  // A result belongs to one page; when the user moves to another tab, start fresh.
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    if (Date.now() < state.ignoreTabSwitchUntil) return; // the tab we just opened for ChatGPT or Gemini
    if (state.busy || state.source?.kind !== "tab" || state.source.tabId === tabId) return;
    resetToIdle();
  });
}

function showView(name) {
  views.forEach((id) => $("#" + id).classList.toggle("hidden", id !== name));
  const labels = {
    idle: "Ready to scan.",
    access: "Terms Lens needs your go-ahead to read this page.",
    loading: "Scanning.",
    results: "Scan results are ready.",
    error: "The scan could not finish."
  };
  announce(labels[name] || "");
}

function resetToIdle() {
  state.scanToken++;
  state.document = null;
  state.source = null;
  state.results = { quick: null, "private-ai": null };
  showView("idle");
}

// ---- Access and unsupported pages ---------------------------------------------------------

function showAccess({ title, text, button, origin = null }) {
  state.pendingOrigin = origin;
  $("#accessTitle").textContent = title;
  $("#accessText").textContent = text;
  $("#accessButton").textContent = button;
  showView("access");
}

async function onAccessButton() {
  if (!state.pendingOrigin) return scanCurrentPage();
  // permissions.request must run straight from the click, before any other await.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [`${state.pendingOrigin}/*`] });
  } catch {
    granted = false;
  }
  if (!granted) {
    $("#accessText").textContent =
      "No problem. Nothing was read and nothing has changed. Press the button again whenever you are ready to allow access to this site.";
    return;
  }
  state.pendingOrigin = null;
  scanCurrentPage();
}

// ---- Quick Scan (local, no dependencies) -------------------------------------------------

async function scanCurrentPage() {
  if (state.busy) return;
  const token = ++state.scanToken;
  state.busy = true;
  showLoading("Reading the fine print", "Checking the page on your device.");
  try {
    const response = await chrome.runtime.sendMessage({ type: "SCAN_TAB" });
    if (token !== state.scanToken) return;
    if (response?.unsupported) {
      return showAccess({ title: "This page can't be scanned", text: UNSUPPORTED_TEXT[response.unsupported], button: "Try again" });
    }
    if (response?.needsPermission) {
      const host = new URL(response.origin).host;
      return showAccess({
        title: `Allow Terms Lens to read ${host}?`,
        text: "Terms Lens needs your permission to read this site so it can scan it on your device. Nothing is sent anywhere.",
        button: "Allow and scan",
        origin: response.origin
      });
    }
    if (response?.needsActivation) {
      return showAccess({
        title: "Let Terms Lens read this page",
        text: "Chrome only lets Terms Lens read a page after you click its toolbar icon while you are on that page. Click the Terms Lens icon in the toolbar (pin it from the puzzle-piece menu if you cannot see it), then press the button below.",
        button: "Scan this page"
      });
    }
    if (response?.error) throw new Error(response.error);

    const { currentDocument, links } = response.page;
    state.links = Array.isArray(links) ? links : [];
    state.source = { kind: "tab", tabId: response.tabId };
    await completeQuickScan(currentDocument, token);
  } catch (error) {
    if (token === state.scanToken) showError(friendly(error));
  } finally {
    if (token === state.scanToken) state.busy = false;
  }
}

async function scanUrl(rawUrl) {
  if (state.busy) return;
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
    if (!/^https?:$/.test(parsed.protocol)) throw new Error();
  } catch {
    return showError("Enter a web address that starts with http:// or https://.");
  }
  // permissions.request must run straight from the click, before any other await.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
  } catch {
    granted = false;
  }
  if (!granted) return showError("Chrome needs your permission to read that page. Nothing was read. You can try again whenever you like.");

  const token = ++state.scanToken;
  state.busy = true;
  try {
    showLoading("Fetching the page", "Downloading the page without your cookies, then scanning it on your device.");
    const response = await fetch(parsed.href, { credentials: "omit", redirect: "follow" });
    if (!response.ok) throw new Error(`That page returned HTTP ${response.status}.`);
    if (/pdf/i.test(response.headers.get("content-type") || "")) {
      return showAccess({ title: "This page can't be scanned", text: UNSUPPORTED_TEXT.pdf, button: "Try again" });
    }
    const parsedDocument = new DOMParser().parseFromString(await response.text(), "text/html");
    state.links = [];
    state.source = { kind: "url", url: parsed.href };
    await completeQuickScan(
      { title: parsedDocument.title || parsed.hostname, url: parsed.href, blocks: extractBlocks(parsedDocument) },
      token
    );
  } catch (error) {
    if (token === state.scanToken) showError(friendly(error));
  } finally {
    if (token === state.scanToken) state.busy = false;
  }
}

async function completeQuickScan(rawDocument, token) {
  let pageDocument;
  try {
    pageDocument = sanitizeDocument(rawDocument);
  } catch {
    throw new Error("There is not enough readable text on this page to scan. Try the site's Terms or Privacy page.");
  }
  const quick = await runQuickScan(pageDocument, providers);
  if (token !== state.scanToken) return;
  state.document = pageDocument;
  state.results = { quick, "private-ai": null };
  state.mode = "quick";
  state.filter = "all";
  $("#handoffStatus").classList.add("hidden");
  renderResults();
  showView("results");
  state.busy = false;
  offerPrivateScan();
}

// ---- Private AI Scan (optional, on-device) -----------------------------------------------

let aiAvailability = "unavailable";

async function offerPrivateScan() {
  const offer = $("#aiOffer");
  $("#notice").classList.add("hidden");
  $("#aiProgress").classList.add("hidden");
  offer.classList.add("hidden");
  const token = state.scanToken;
  aiAvailability = (await providers["chrome-ai"].availability()).state;
  if (token !== state.scanToken) return;

  const button = $("#aiButton");
  const text = $("#aiOfferText");
  const SAME = "Uses Chrome's on-device AI. The document stays on this device.";
  switch (aiAvailability) {
    case "available":
      text.textContent = `${SAME} Private AI Scan reads the page in context.`;
      button.textContent = "Run Private AI Scan";
      button.disabled = false;
      break;
    case "downloadable":
      text.textContent = `${SAME} It needs a one-time download of Chrome's AI model, which can be large and take a while. Nothing downloads until you click.`;
      button.textContent = "Download private AI model";
      button.disabled = false;
      break;
    case "downloading":
      text.textContent = "Chrome is downloading its on-device AI model. Private AI Scan isn't ready yet; this can take a while.";
      button.textContent = "Check again";
      button.disabled = false;
      break;
    default:
      // Unsupported: no error, just the always-available alternatives below.
      return;
  }
  offer.classList.remove("hidden");
  // Only an already-installed model runs automatically; a download always needs a click.
  if (state.preference === "chrome-ai" && aiAvailability === "available") runPrivateScan();
}

function onAiButton() {
  if (aiAvailability === "downloading") return offerPrivateScan();
  return runPrivateScan();
}

async function runPrivateScan() {
  if (state.busy || !state.document) return;
  const token = state.scanToken;
  state.busy = true;
  const button = $("#aiButton");
  const progress = $("#aiProgress");
  button.disabled = true;
  button.textContent = "Starting...";
  $("#notice").classList.add("hidden");
  const outcome = await runDeeperScan("chrome-ai", state.document, providers, {
    onDownloadProgress(loaded) {
      progress.classList.remove("hidden");
      progress.value = loaded;
      button.textContent = `Downloading model ${Math.round(loaded * 100)}%`;
    },
    onProgress({ done, total }) {
      progress.classList.remove("hidden");
      progress.value = total ? done / total : 0;
      button.textContent = total ? `Reading section ${Math.min(done + 1, total)} of ${total}` : "Reading...";
    }
  });
  state.busy = false;
  if (token !== state.scanToken) return;
  progress.classList.add("hidden");

  if (!outcome.ok) {
    showNotice(
      "Private AI Scan couldn't finish on this device, so your Quick Scan results are still shown. You can try again, or continue in ChatGPT or Gemini below."
    );
    offerPrivateScan();
    return;
  }
  if (!prepareView(outcome.result).total) {
    // Nothing the model said could be backed by the page's own wording, so show none of it.
    showNotice("Private AI Scan did not return anything it could back up with the page's own wording, so your Quick Scan results are shown. You can try again, or continue in ChatGPT or Gemini below.");
    offerPrivateScan();
    return;
  }
  state.results["private-ai"] = outcome.result;
  $("#aiOffer").classList.add("hidden");
  setMode("private-ai");
}

function showNotice(text) {
  const notice = $("#notice");
  notice.textContent = text;
  notice.classList.remove("hidden");
}

// ---- Continue in ChatGPT / Gemini --------------------------------------------------------

async function handoff(serviceId) {
  if (!state.document || !state.results.quick) return;
  const status = $("#handoffStatus");
  const view = prepareView(state.results.quick);
  const payload = buildHandoff({ document: state.document, findings: view.all });
  state.ignoreTabSwitchUntil = Date.now() + 5000;
  const outcome = await continueIn(serviceId, payload, {
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    openTab: (url) => chrome.tabs.create({ url, active: true }),
    downloadFile: async (name, content) => {
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  });
  status.textContent = outcome.message;
  status.classList.remove("hidden");
  announce(outcome.message);
}

// ---- Rendering ---------------------------------------------------------------------------

function setMode(mode) {
  state.mode = mode;
  state.filter = "all";
  renderResults();
}

function renderResults() {
  const result = state.results[state.mode];
  const text = MODE_TEXT[state.mode];
  const view = prepareView(result, state.filter);
  state.filter = view.filter;

  $("#modeBadge").textContent = text.badge;
  $("#resultTitle").textContent = result.documentTitle;
  $("#resultSummary").textContent = view.total
    ? `Found ${view.counts.concern} potential concern${s(view.counts.concern)}, ${view.counts.caution} important condition${s(view.counts.caution)}, and ${view.counts.positive} user-friendly provision${s(view.counts.positive)}.`
    : "No known patterns were found on this page. That does not mean its terms are safe.";
  $("#modeExplainer").textContent = text.explainer;
  $("#summaryCounts").replaceChildren(
    ...[["concern", "Concerns"], ["caution", "Worth knowing"], ["positive", "Good clauses"]].map(([key, label]) => {
      const box = document.createElement("div");
      box.className = "summary-count";
      const number = document.createElement("strong");
      number.textContent = String(view.counts[key]);
      const caption = document.createElement("span");
      caption.textContent = label;
      box.append(number, caption);
      return box;
    })
  );

  $("#modeTabs").classList.toggle("hidden", !state.results["private-ai"]);
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(".filter").forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const container = $("#findings");
  container.replaceChildren();
  if (!view.findings.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      view.filter === "all" && state.mode === "quick"
        ? "Nothing matched Quick Scan's known patterns here. If this is not a terms page, open the site's Terms or Privacy page and scan again."
        : "No findings in this category.";
    container.append(empty);
  }
  view.findings.forEach((finding) => container.append(createFindingCard(finding)));

  $("#limitations").textContent = (result.limitations || []).join(" ");
  renderOtherDocuments();
}

const s = (n) => (n === 1 ? "" : "s");

function renderOtherDocuments() {
  const list = $("#documentList");
  list.replaceChildren();
  const links = state.links.filter((link) => link.url !== state.document.url).slice(0, 6);
  $("#otherDocs").classList.toggle("hidden", links.length === 0);
  for (const link of links) {
    const button = document.createElement("button");
    button.className = "document-button";
    button.type = "button";
    const wrap = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = link.label || "Legal document";
    const url = document.createElement("span");
    url.textContent = link.url;
    wrap.append(label, url);
    const arrow = document.createElement("b");
    arrow.textContent = "›";
    button.append(wrap, arrow);
    button.addEventListener("click", () => scanUrl(link.url));
    list.append(button);
  }
}

function createFindingCard(finding) {
  const article = document.createElement("article");
  article.className = `finding ${finding.classification}`;

  const top = document.createElement("div");
  top.className = "finding-top";
  const kind = document.createElement("span");
  kind.className = "finding-label";
  kind.textContent = `${finding.classification} · ${finding.category}`;
  const confidence = document.createElement("span");
  confidence.className = "finding-label";
  confidence.textContent = `${Math.round(finding.confidence * 100)}% confidence`;
  top.append(kind, confidence);

  const title = document.createElement("h3");
  title.textContent = finding.title;
  const plain = paragraph(finding.plainEnglish);
  const why = paragraph("");
  why.className = "why";
  const whyLabel = document.createElement("strong");
  whyLabel.textContent = "Why it matters: ";
  why.append(whyLabel, document.createTextNode(finding.whyItMatters));

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Read the original wording";
  const quote = document.createElement("blockquote");
  quote.textContent = `\u201C${finding.originalQuote}\u201D`;
  details.append(summary, quote);

  const source = document.createElement("button");
  source.className = "source-button";
  source.type = "button";
  source.textContent = "Show on the page \u2197";
  // Only clickable when there is genuine evidence and a page to find it on.
  source.disabled = !hasEvidence(finding) || !state.source;
  source.addEventListener("click", () => showSource(finding));

  article.append(top, title, plain, why, details, source);
  return article;
}

function paragraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

async function showSource(finding) {
  try {
    const message = state.source?.kind === "tab"
      ? { type: "HIGHLIGHT_IN_TAB", tabId: state.source.tabId, quote: finding.originalQuote }
      : { type: "OPEN_AND_HIGHLIGHT", url: state.source?.url, quote: finding.originalQuote };
    const response = await chrome.runtime.sendMessage(message);
    if (response?.error) throw new Error(response.error);
    announce(response?.found === false ? "Opened the page, but could not locate that exact wording." : "Highlighted the wording on the page.");
  } catch {
    announce("Click the Terms Lens icon on that page, then try again.");
  }
}

function showLoading(title, message) {
  $("#loadingTitle").textContent = title;
  $("#loadingMessage").textContent = message;
  showView("loading");
}

function showError(message) {
  $("#errorMessage").textContent = message;
  showView("error");
}

function friendly(error) {
  const message = String(error?.message || "");
  if (/Failed to fetch|NetworkError/i.test(message)) return "That page could not be downloaded. Open it in a tab and scan it from there.";
  return message || "Something went wrong. Please try again.";
}

function extractBlocks(parsedDocument) {
  const root = parsedDocument.querySelector("main, article, [role='main']") || parsedDocument.body;
  const elements = [...root.querySelectorAll("h1, h2, h3, h4, p, li, td, th")];
  let heading = "";
  const blocks = [];
  for (const element of elements) {
    const text = String(element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (/^H[1-4]$/.test(element.tagName)) {
      heading = text;
      continue;
    }
    if (text.length < 20 || text.length > 12_000) continue;
    blocks.push({ id: `block-${blocks.length + 1}`, heading, text });
  }
  return blocks;
}

function announce(message) {
  $("#announcer").textContent = message;
}
