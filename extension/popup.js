import { icon } from "./lib/icons.js";
import { prepareView } from "./lib/view-model.js";
import { buildHandoff, continueIn } from "./lib/handoff.js";
import { forgetScan, highlightQuote, loadScan, locateQuotes, saveScan, scanTab, unsupportedReason } from "./lib/scan-tab.js";

const $ = (selector) => document.querySelector(selector);
const views = ["idle", "loading", "results", "notice"];

const state = {
  tab: null,
  scan: null,
  located: new Map(), // original wording -> can it be shown on the page right now?
  filter: "all",
  busy: false,
  token: 0,
  handoff: null // { serviceId, payload } while a copy fallback is on screen
};

const CLASS_ICON = { concern: "triangle-alert", caution: "circle-help", positive: "badge-check", neutral: "circle-help" };
const SOURCE_LABEL = { modal: "Signup popup", frame: "Embedded page", page: "Page" };
const UNSUPPORTED = {
  "browser-page": "Chrome keeps its own pages, such as settings and the new-tab page, off limits to extensions. Open a website's terms page or signup popup and try again.",
  "web-store": "Chrome doesn't let extensions read the Chrome Web Store. Open a website's terms page or signup popup and try again.",
  pdf: "PDF agreements can't be scanned yet. If the same terms are also a web page, open that page instead."
};

hydrateIcons(document);
bindEvents();
init();

// ---- setup ---------------------------------------------------------------------------------------

function hydrateIcons(root) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon, Number(node.dataset.size) || 16);
  });
}

function bindEvents() {
  $("#scanButton").addEventListener("click", scan);
  $("#rescanButton").addEventListener("click", scan);
  $("#chatgptButton").addEventListener("click", () => startHandoff("chatgpt"));
  $("#geminiButton").addEventListener("click", () => startHandoff("gemini"));
  $("#copyPromptButton").addEventListener("click", retryCopy);
  $("#filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    renderResults();
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function init() {
  state.tab = await activeTab();
  const url = state.tab?.url ?? "";
  const reason = url ? unsupportedReason(url) : null;
  if (reason) return showUnsupported(reason);

  $("#pageTitle").textContent = state.tab?.title || "This page";
  $("#pageHost").textContent = hostOf(url);
  showView("idle");
  if (state.tab?.id != null && url) {
    chrome.action.setBadgeText({ tabId: state.tab.id, text: "" }).catch(() => {});
    const cached = await loadScan(state.tab.id, url).catch(() => null);
    if (cached) await present(cached);
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

// ---- views ---------------------------------------------------------------------------------------

function showView(name) {
  views.forEach((id) => $("#" + id).classList.toggle("hidden", id !== name));
  $("#rescanButton").classList.toggle("hidden", name !== "results");
  $("#content").scrollTop = 0;
}

function setLoading(text) {
  $("#loadingText").textContent = text;
  announce(text);
}

function announce(message) {
  $("#announcer").textContent = message;
}

function showNotice({ iconName, tone = "", title, text, actions = [] }) {
  $("#noticeIcon").className = `notice-icon ${tone}`;
  $("#noticeIcon").innerHTML = icon(iconName, 18);
  $("#noticeTitle").textContent = title;
  $("#noticeText").textContent = text;
  const box = $("#noticeActions");
  box.replaceChildren(
    ...actions.map(({ label, primary, onClick }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `button${primary ? " primary" : ""}`;
      button.textContent = label;
      button.addEventListener("click", onClick);
      return button;
    })
  );
  showView("notice");
  announce(title);
}

function showUnsupported(reason) {
  showNotice({ iconName: "shield-check", title: "This page can't be scanned", text: UNSUPPORTED[reason] });
}

// ---- scanning --------------------------------------------------------------------------------------

async function scan() {
  if (state.busy || !state.tab?.id) return;
  const token = ++state.token;
  state.busy = true;
  state.filter = "all";
  hideHandoffMessages();
  showView("loading");
  setLoading("Finding the agreement");
  try {
    const outcome = await scanTab(state.tab.id, { onStage: (text) => token === state.token && setLoading(text) });
    if (token !== state.token) return;
    if (outcome.status === "unsupported") return showUnsupported(outcome.reason);
    if (outcome.status === "embed") return showEmbedded(outcome);
    if (outcome.status === "empty") return showEmpty(outcome);
    setLoading("Matching the original wording");
    await present(outcome, true);
    if (state.tab.url) saveScan(state.tab.id, state.tab.url, outcome).catch(() => {});
  } catch {
    if (token === state.token) showBlocked();
  } finally {
    if (token === state.token) state.busy = false;
  }
}

async function showBlocked() {
  // Chrome refused the script: the page is off limits, or access was not granted for this page.
  const url = state.tab?.url ?? "";
  const reason = url ? unsupportedReason(url) : null;
  if (reason) return showUnsupported(reason);
  if (/^https?:/i.test(url)) {
    const origin = new URL(url).origin;
    return showNotice({
      iconName: "shield-check",
      tone: "accent",
      title: `Allow Terms Lens to read ${hostOf(url)}?`,
      text: "It reads the page on your device so it can find the agreement. Nothing is sent anywhere.",
      actions: [{ label: "Allow and scan", primary: true, onClick: () => allowThenScan(origin) }]
    });
  }
  showNotice({
    iconName: "circle-alert",
    tone: "warn",
    title: "Terms Lens couldn't read this page",
    text: "Close this popup, click the Terms Lens icon again while you're on the page, then press Scan.",
    actions: [{ label: "Try again", primary: true, onClick: scan }]
  });
}

async function allowThenScan(origin) {
  // permissions.request must run straight from the click, before any other await.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    granted = false;
  }
  if (!granted) {
    $("#noticeText").textContent = "No problem. Nothing was read. Press the button whenever you're ready to allow access to this site.";
    return;
  }
  scan();
}

function showEmpty({ links }) {
  state.scan = null;
  showNotice({
    iconName: "file-search",
    title: "No agreement text found here",
    text: links?.length
      ? "There isn't enough readable text on this page. These pages look like terms:"
      : "There isn't enough readable text on this page. Open the terms or privacy page, or a signup popup that shows them, and scan again.",
    actions: [
      ...(links ?? []).slice(0, 3).map((link) => ({ label: `Open ${shorten(link.label)} and scan`, onClick: () => openAndScan(link.url) })),
      { label: "Scan again", primary: !links?.length, onClick: scan }
    ]
  });
}

const shorten = (text, max = 28) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ---- agreement embedded from another website -------------------------------------------------------------

function showEmbedded({ embed }) {
  const host = hostOf(embed.src);
  showNotice({
    iconName: "app-window",
    tone: "accent",
    title: "This agreement is embedded from another website.",
    text: `It is shown from ${host}, so Terms Lens needs your permission for that site alone, or you can open it on its own.`,
    actions: [
      { label: `Allow ${host} and scan`, primary: true, onClick: () => allowEmbedThenScan(embed) },
      { label: "Open agreement and scan", onClick: () => openAndScan(embed.src) }
    ]
  });
}

async function allowEmbedThenScan(embed) {
  // permissions.request must run straight from the click, before any other await.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [`${embed.origin}/*`] });
  } catch {
    granted = false;
  }
  if (!granted) {
    $("#noticeText").textContent = "Permission wasn't granted, so nothing was read. You can still open the agreement and scan it on its own.";
    return;
  }
  scan();
}

async function openAndScan(url) {
  // Ask for exactly that site first (straight from the click), so the new tab can be scanned for you.
  let canRead = false;
  try {
    const origin = new URL(url).origin;
    canRead = await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    canRead = false;
  }
  $("#noticeText").textContent = canRead
    ? "Opening the agreement. Click Terms Lens on that tab to see the result."
    : "Opening the agreement. Click Terms Lens on that tab to scan it.";
  await new Promise((resolve) => setTimeout(resolve, 700));
  await chrome.runtime.sendMessage({ type: "OPEN_AND_SCAN", url, canRead });
}

// ---- results ---------------------------------------------------------------------------------------------

async function present(scanResult, fresh = false) {
  state.scan = scanResult;
  const view = prepareView(scanResult.result);
  const quotes = view.all.map((finding) => finding.originalQuote);
  const found = quotes.length ? await locateQuotes(state.tab.id, scanResult.frameId, quotes) : [];
  state.located = new Map(quotes.map((quote, i) => [quote, Boolean(found[i])]));
  renderResults();
  showView("results");
  announce(fresh ? "Scan results are ready." : "Showing your earlier scan of this page.");
}

function renderResults() {
  const { document: agreement, result, source } = state.scan;
  const view = prepareView(result, state.filter);
  state.filter = view.filter;

  $("#resultTitle").textContent = agreement.title;
  $("#sourceChip").textContent = SOURCE_LABEL[source] ?? "Page";
  $("#summary").replaceChildren(
    ...[["concern", "Concerns"], ["caution", "Worth knowing"], ["positive", "Good clauses"]].map(([key, label]) => {
      const stat = document.createElement("div");
      stat.className = `stat ${key}`;
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = icon(CLASS_ICON[key], 15);
      const count = document.createElement("strong");
      count.textContent = String(view.counts[key]);
      row.append(count);
      const caption = document.createElement("span");
      caption.className = "label";
      caption.textContent = label;
      stat.append(row, caption);
      return stat;
    })
  );
  document.querySelectorAll(".filter").forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const list = $("#findings");
  list.replaceChildren();
  if (!view.findings.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = icon("file-search", 18);
    empty.append(
      view.filter === "all"
        ? "Nothing matched Quick Scan's known patterns here. That doesn't mean the terms are safe."
        : "No findings in this category."
    );
    list.append(empty);
  }
  view.findings.forEach((finding, index) => list.append(createCard(finding, index)));
}

function createCard(finding, index) {
  const card = document.createElement("article");
  card.className = `card ${finding.classification}`;
  card.style.setProperty("--i", String(Math.min(index, 8)));

  const top = document.createElement("div");
  top.className = "card-top";
  const cat = document.createElement("span");
  cat.className = "cat";
  cat.innerHTML = icon(CLASS_ICON[finding.classification] ?? "circle-help", 14);
  cat.append(finding.category);
  const conf = document.createElement("span");
  conf.className = "conf";
  conf.textContent = `${Math.round(finding.confidence * 100)}% match`;
  top.append(cat, conf);

  const title = document.createElement("h3");
  title.textContent = finding.title;
  const plain = document.createElement("p");
  plain.className = "plain";
  plain.textContent = finding.plainEnglish;
  const why = document.createElement("p");
  why.className = "why";
  const whyLabel = document.createElement("b");
  whyLabel.textContent = "Why it matters ";
  why.append(whyLabel, finding.whyItMatters);

  const reveal = document.createElement("div");
  reveal.className = "reveal";
  const revealInner = document.createElement("div");
  const quote = document.createElement("blockquote");
  quote.textContent = `“${finding.originalQuote}”`;
  revealInner.append(quote);
  reveal.append(revealInner);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "link";
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = `<span>Original wording</span><span class="chev">${icon("chevron-down", 14)}</span>`;
  toggle.addEventListener("click", () => {
    const open = reveal.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const locate = document.createElement("button");
  locate.type = "button";
  locate.className = "link locate";
  locate.innerHTML = `${icon("crosshair", 14)}<span>Show on the page</span>`;
  const note = document.createElement("p");
  note.className = "locate-note hidden";
  const canLocate = state.located.get(finding.originalQuote) === true;
  if (!canLocate) {
    // Never an active button that does nothing: say why it is unavailable.
    locate.disabled = true;
    note.textContent = "This wording isn't on the page right now. Scan again to refresh.";
    note.classList.remove("hidden");
  }
  locate.addEventListener("click", async () => {
    try {
      const response = await highlightQuote(state.tab.id, state.scan.frameId, finding.originalQuote);
      note.textContent = response.found ? "Highlighted on the page." : "This wording isn't on the page right now. Scan again to refresh.";
    } catch {
      note.textContent = "Terms Lens can't reach the page any more. Scan again to refresh.";
    }
    note.classList.remove("hidden");
  });
  actions.append(toggle, locate);

  card.append(top, title, plain, why, actions, note, reveal);
  return card;
}

// ---- deeper analysis in ChatGPT or Gemini ------------------------------------------------------------------

function hideHandoffMessages() {
  $("#handoffFeedback").classList.add("hidden");
  $("#handoffFallback").classList.add("hidden");
  state.handoff = null;
}

function showFeedback(text) {
  $("#handoffFeedbackText").textContent = text;
  $("#handoffFeedback").classList.remove("hidden", "problem");
  announce(text);
}

async function legacyCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

const deps = {
  writeClipboard: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      await legacyCopy(text);
    }
  },
  downloadFile: async (name, content) => {
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  openTab: (url) => chrome.tabs.create({ url, active: true }),
  announce: (message) => {
    $("#handoffFallback").classList.add("hidden");
    showFeedback(message);
  },
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

async function startHandoff(serviceId) {
  if (!state.scan) return;
  const view = prepareView(state.scan.result);
  const payload = buildHandoff({ document: state.scan.document, findings: view.all });
  $("#handoffFeedback").classList.add("hidden");
  await runHandoff(serviceId, payload);
}

async function runHandoff(serviceId, payload) {
  const outcome = await continueIn(serviceId, payload, deps);
  if (outcome.ok) return;
  // Copying failed: nothing was opened. Show the text so it can be copied by hand.
  state.handoff = { serviceId, payload };
  $("#handoffFeedback").classList.add("hidden");
  $("#fallbackText").value = outcome.fallback.text;
  $("#handoffFallback").classList.remove("hidden");
  $("#fallbackText").focus();
  $("#fallbackText").select();
  announce(outcome.message);
  showFeedbackError(outcome.message);
}

function showFeedbackError(message) {
  const feedback = $("#handoffFeedback");
  $("#handoffFeedbackText").textContent = message;
  feedback.classList.remove("hidden");
  feedback.classList.add("problem");
}

function retryCopy() {
  if (!state.handoff) return;
  $("#handoffFeedback").classList.remove("problem");
  return runHandoff(state.handoff.serviceId, state.handoff.payload);
}
