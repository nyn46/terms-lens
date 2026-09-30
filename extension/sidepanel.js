import { sanitizeDocument } from "./lib/text.js";
import { countFindings } from "./lib/result.js";
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
  scanToken: 0
};

const $ = (selector) => document.querySelector(selector);
const views = ["idle", "activation", "loading", "results", "error"];

const MODE_TEXT = {
  quick: {
    badge: "Quick Scan",
    explainer:
      "Quick Scan checks this page for known phrase patterns, entirely on your device. It is not an AI or legal review and may miss clauses that depend on context."
  },
  "private-ai": {
    badge: "Private AI Scan",
    explainer:
      "Private AI Scan uses Chrome's on-device model, so the page text is processed on your device and not sent anywhere. It can still misread context, so check the original wording."
  }
};

init();

async function init() {
  const saved = await chrome.storage.local.get("providerPreference").catch(() => ({}));
  state.preference = normalizePreference(saved.providerPreference);
  bindEvents();
  showView("idle");
}

function bindEvents() {
  $("#settingsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#scanButton").addEventListener("click", () => scanCurrentPage());
  $("#activationRetry").addEventListener("click", () => scanCurrentPage());
  $("#scanAgain").addEventListener("click", () => scanCurrentPage());
  $("#retry").addEventListener("click", () => scanCurrentPage());
  $("#analyzeManual").addEventListener("click", () => scanUrl($("#manualUrl").value));
  $("#aiButton").addEventListener("click", () => runPrivateScan());
  $("#modeTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button && state.results[button.dataset.mode]) setMode(button.dataset.mode);
  });
  $("#filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    syncFilterButtons();
    renderFindings();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.providerPreference) {
      state.preference = normalizePreference(changes.providerPreference.newValue);
    }
  });
  // A result belongs to one page; when the user moves to another tab, start fresh.
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    if (state.busy || state.source?.kind !== "tab" || state.source.tabId === tabId) return;
    resetToIdle();
  });
}

function showView(name) {
  views.forEach((id) => $("#" + id).classList.toggle("hidden", id !== name));
  const labels = {
    idle: "Ready to scan.",
    activation: "Terms Lens needs you to click its toolbar icon on this page.",
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

// ---- Quick Scan (local, no dependencies) -------------------------------------------------

async function scanCurrentPage() {
  if (state.busy) return;
  const token = ++state.scanToken;
  state.busy = true;
  showLoading("Reading the fine print", "Checking the page on your device.");
  try {
    const response = await chrome.runtime.sendMessage({ type: "SCAN_TAB" });
    if (token !== state.scanToken) return;
    if (response?.needsActivation) return showView("activation");
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
  const token = ++state.scanToken;
  state.busy = true;
  try {
    const parsed = new URL(String(rawUrl).trim());
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Enter a valid HTTP or HTTPS address.");
    const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
    if (!granted) throw new Error("Chrome needs your permission to read that page.");
    showLoading("Fetching the page", "Downloading the page without your cookies, then scanning it on your device.");
    const response = await fetch(parsed.href, { credentials: "omit", redirect: "follow" });
    if (!response.ok) throw new Error(`That page returned HTTP ${response.status}.`);
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
  renderResults();
  showView("results");
  state.busy = false;
  offerPrivateScan();
}

// ---- Private AI Scan (optional, on-device) -----------------------------------------------

async function offerPrivateScan() {
  const offer = $("#aiOffer");
  $("#notice").classList.add("hidden");
  $("#aiProgress").classList.add("hidden");
  offer.classList.add("hidden");
  const token = state.scanToken;
  const { state: availability } = await providers["chrome-ai"].availability();
  if (token !== state.scanToken) return;

  const copy = {
    available: ["Want a deeper look?", "Private AI Scan reads the page in context using Chrome's on-device model. The text stays on this device.", "Run Private AI Scan"],
    downloadable: ["Want a deeper look?", "Private AI Scan needs a one-time model download that Chrome manages. It can be large, so nothing downloads until you click. The text stays on this device.", "Download model and scan"],
    downloading: ["Chrome is preparing the model", "Chrome is already downloading its on-device model. You can continue when you are ready; this may take a few minutes.", "Continue with Private AI Scan"]
  }[availability];

  if (!copy) {
    // Unsupported: keep the Quick Scan result clean and useful, with a quiet one-line note.
    offer.classList.remove("hidden");
    offer.classList.add("passive");
    $("#aiOfferTitle").textContent = "Quick Scan only";
    $("#aiOfferText").textContent = "Private AI Scan is not available on this device or Chrome version. Your Quick Scan results above are complete.";
    $("#aiButton").classList.add("hidden");
    return;
  }
  offer.classList.remove("hidden", "passive");
  $("#aiOfferTitle").textContent = copy[0];
  $("#aiOfferText").textContent = copy[1];
  $("#aiButton").textContent = copy[2];
  $("#aiButton").classList.remove("hidden");
  $("#aiButton").disabled = false;
  // Only an already-installed model runs automatically; a download always needs a click.
  if (state.preference === "chrome-ai" && availability === "available") runPrivateScan();
}

async function runPrivateScan() {
  if (state.busy || !state.document) return;
  const token = state.scanToken;
  state.busy = true;
  const button = $("#aiButton");
  const progress = $("#aiProgress");
  button.disabled = true;
  button.textContent = "Scanning on your device...";
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
      button.textContent = `Reading section ${Math.min(done + 1, total)} of ${total}`;
    }
  });
  state.busy = false;
  if (token !== state.scanToken) return;
  progress.classList.add("hidden");

  if (!outcome.ok) {
    button.disabled = false;
    button.textContent = "Try Private AI Scan again";
    showNotice(`Private AI Scan could not finish, so your Quick Scan results are shown. ${outcome.reason}`);
    offerPrivateScan();
    return;
  }
  state.results["private-ai"] = outcome.result;
  $("#aiOffer").classList.add("hidden");
  if (!outcome.result.findings.length) {
    showNotice("Private AI Scan found nothing it could support with the page's own wording. Your Quick Scan results are still shown.");
  }
  setMode("private-ai");
}

function showNotice(text) {
  const notice = $("#notice");
  notice.textContent = text;
  notice.classList.remove("hidden");
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
  $("#modeBadge").textContent = text.badge;
  $("#resultTitle").textContent = result.documentTitle;
  $("#resultSummary").textContent = result.findings.length
    ? result.summary
    : "No known patterns were found on this page. That does not mean its terms are safe.";
  $("#modeExplainer").textContent = text.explainer;
  const counts = countFindings(result.findings);
  $("#summaryCounts").replaceChildren(
    ...[["concern", "Concerns"], ["caution", "Worth knowing"], ["positive", "Good clauses"]].map(([key, label]) => {
      const box = document.createElement("div");
      box.className = "summary-count";
      const number = document.createElement("strong");
      number.textContent = String(counts[key]);
      const caption = document.createElement("span");
      caption.textContent = label;
      box.append(number, caption);
      return box;
    })
  );

  const hasAi = Boolean(state.results["private-ai"]);
  $("#modeTabs").classList.toggle("hidden", !hasAi);
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", String(active));
  });

  syncFilterButtons();
  renderFindings();
  $("#limitations").textContent = (result.limitations || []).join(" ");
  renderOtherDocuments();
}

function syncFilterButtons() {
  document.querySelectorAll(".filter").forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderFindings() {
  const container = $("#findings");
  const findings = state.results[state.mode].findings.filter(
    (item) => state.filter === "all" || item.classification === state.filter
  );
  container.replaceChildren();
  if (!findings.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      state.filter === "all" && state.mode === "quick"
        ? "Nothing matched Quick Scan's known patterns here. If this is not a terms page, open the site's Terms or Privacy page and scan again."
        : "No supported findings in this category.";
    container.append(empty);
    return;
  }
  findings.forEach((finding) => container.append(createFindingCard(finding)));
}

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
  quote.textContent = `“${finding.originalQuote}”`;
  details.append(summary, quote);

  const source = document.createElement("button");
  source.className = "source-button";
  source.type = "button";
  source.textContent = "Show on the page ↗";
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
