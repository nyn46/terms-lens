const state = {
  discovery: null,
  result: null,
  selectedUrl: null,
  pendingOrigin: null,
  filter: "all",
  apiUrl: "http://127.0.0.1:8787"
};

const $ = (selector) => document.querySelector(selector);
const views = ["status", "permissionPrompt", "documentPicker", "loading", "results", "error"];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const saved = await chrome.storage.local.get("apiUrl");
  state.apiUrl = saved.apiUrl || state.apiUrl;
  $("#apiUrl").value = state.apiUrl;
  bindEvents();
  await discover();
}

function bindEvents() {
  $("#settingsButton").addEventListener("click", () => {
    const isHidden = $("#settings").classList.toggle("hidden");
    $("#settingsButton").setAttribute("aria-expanded", String(!isHidden));
  });
  $("#saveSettings").addEventListener("click", async () => {
    state.apiUrl = $("#apiUrl").value.replace(/\/$/, "");
    await chrome.storage.local.set({ apiUrl: state.apiUrl });
    $("#settings").classList.add("hidden");
    $("#settingsButton").setAttribute("aria-expanded", "false");
    announce("Analyzer URL saved.");
  });
  $("#analyzeManual").addEventListener("click", () => analyzeUrl($("#manualUrl").value));
  $("#grantSiteAccess").addEventListener("click", grantSiteAccessAndDiscover);
  $("#retry").addEventListener("click", discover);
  $("#scanAgain").addEventListener("click", () => showView("documentPicker"));
  $("#filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });
    renderFindings();
  });
  document.addEventListener("blur", syncFieldValidity, true);
  document.addEventListener("input", syncFieldValidity);
}

function showView(name) {
  if (name !== "error") $("#errorMessage").textContent = "";
  views.forEach((id) => $("#" + id).classList.toggle("hidden", id !== name));
  const labels = {
    status: "Inspecting this website.",
    permissionPrompt: "Site permission is needed before scanning.",
    documentPicker: "Legal document options are ready.",
    loading: "Reading the selected document.",
    results: "Analysis results are ready.",
    error: "The scan could not finish."
  };
  announce(labels[name] || "");
}

async function discover() {
  showView("status");
  try {
    const response = await chrome.runtime.sendMessage({ type: "DISCOVER_CURRENT_PAGE" });
    if (response?.error) throw new Error(response.error);
    if (response?.needsPermission) {
      state.pendingOrigin = response.origin;
      $("#permissionMessage").textContent = `Terms Lens needs temporary access to ${response.origin} to find legal documents on this site.`;
      showView("permissionPrompt");
      return;
    }
    state.discovery = response;
    renderDocuments(response.links || []);
    showView("documentPicker");
  } catch (error) {
    showError(error.message);
  }
}

async function grantSiteAccessAndDiscover() {
  if (!state.pendingOrigin) {
    await discover();
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [`${state.pendingOrigin}/*`] });
    if (!granted) throw new Error("Permission is needed to scan this site.");
    state.pendingOrigin = null;
    await discover();
  } catch (error) {
    showError(error.message);
  }
}

function renderDocuments(links) {
  $("#documentCount").textContent = `${links.length} found`;
  const list = $("#documentList");
  list.replaceChildren();

  if (looksLikeLegalDocument(state.discovery.currentDocument)) {
    list.append(createDocumentButton({
      label: "Analyze this page",
      url: state.discovery.currentDocument.url,
      current: true
    }));
  }
  links.forEach((link) => list.append(createDocumentButton(link)));
  if (!list.children.length) {
    list.innerHTML = '<div class="empty">No obvious legal links found. Paste the policy URL below.</div>';
  }
}

function looksLikeLegalDocument(document) {
  return /terms|privacy|legal|refund|subscription|eula/i.test(`${document.title} ${document.url}`);
}

function createDocumentButton(link) {
  const button = document.createElement("button");
  button.className = "document-button";
  button.type = "button";
  button.innerHTML = `<div><strong>${escapeHtml(link.label || "Legal document")}</strong><span>${escapeHtml(link.url)}</span></div><b>›</b>`;
  button.addEventListener("click", async () => {
    try {
      if (link.current) await analyzeDocument(state.discovery.currentDocument);
      else await analyzeUrl(link.url, link.label);
    } catch (error) {
      showError(error.message);
    }
  });
  return button;
}

async function analyzeUrl(url, label = "Terms document") {
  try {
    clearFieldError($("#manualUrl"));
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      markFieldError($("#manualUrl"));
      throw new Error("Enter a valid HTTP or HTTPS URL.");
    }
    const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
    if (!granted) throw new Error("Permission is needed to read that policy page.");
    showView("loading");
    $("#loadingMessage").textContent = "Fetching and cleaning the policy text.";
    const response = await fetch(parsed.href, { credentials: "omit", redirect: "follow" });
    if (!response.ok) throw new Error(`The policy page returned HTTP ${response.status}.`);
    const html = await response.text();
    const document = new DOMParser().parseFromString(html, "text/html");
    const blocks = extractBlocks(document);
    await analyzeDocument({ title: document.title || label, url: parsed.href, blocks });
  } catch (error) {
    showError(error.message);
  }
}

function extractBlocks(document) {
  const root = document.querySelector("main, article, [role='main']") || document.body;
  const elements = [...root.querySelectorAll("h1, h2, h3, h4, p, li, td, th")];
  let heading = "";
  const blocks = [];
  for (const element of elements) {
    const text = cleanText(element.textContent);
    if (/^H[1-4]$/.test(element.tagName)) {
      heading = text;
      continue;
    }
    if (text.length < 20 || text.length > 12_000) continue;
    blocks.push({ id: `block-${blocks.length + 1}`, heading, text });
  }
  return blocks;
}

async function analyzeDocument(document) {
  showView("loading");
  state.selectedUrl = document.url;
  $("#loadingMessage").textContent = `Reviewing ${document.blocks.length} readable sections.`;
  if (!document.blocks.length) throw new Error("No readable policy text was found on that page.");

  try {
    const response = await fetch(`${state.apiUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analysis failed.");
    state.result = data;
    state.filter = "all";
    renderResults();
    showView("results");
  } catch (error) {
    if (/Failed to fetch/i.test(error.message)) {
      throw new Error("Start the Terms Lens server with `npm start`, then try again.");
    }
    throw error;
  }
}

function renderResults() {
  const result = state.result;
  $("#modeBadge").textContent = result.analysisMode === "ai" ? "Evidence-checked AI scan" : "Quick phrase scan";
  $("#resultTitle").textContent = result.documentTitle;
  $("#resultSummary").textContent = result.summary;
  const counts = [
    ["concern", "Concerns"],
    ["caution", "Worth knowing"],
    ["positive", "Good clauses"]
  ];
  $("#summaryCounts").innerHTML = counts.map(([key, label]) => {
    const count = result.findings.filter((item) => item.classification === key).length;
    return `<div class="summary-count"><strong>${count}</strong><span>${label}</span></div>`;
  }).join("");
  document.querySelectorAll(".filter").forEach((button) => {
    const isActive = button.dataset.filter === "all";
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  renderFindings();
  $("#limitations").textContent = (result.limitations || []).join(" ");
}

function renderFindings() {
  const container = $("#findings");
  const findings = state.result.findings.filter(
    (item) => state.filter === "all" || item.classification === state.filter
  );
  container.replaceChildren();
  if (!findings.length) {
    container.innerHTML = '<div class="empty">No supported findings in this category.</div>';
    return;
  }
  findings.forEach((finding) => container.append(createFindingCard(finding)));
}

function createFindingCard(finding) {
  const article = document.createElement("article");
  article.className = `finding ${finding.classification}`;
  article.innerHTML = `
    <div class="finding-top">
      <span class="finding-label">${escapeHtml(finding.classification)} · ${escapeHtml(finding.category)}</span>
      <span class="finding-label">${Math.round(finding.confidence * 100)}% evidence match</span>
    </div>
    <h3>${escapeHtml(finding.title)}</h3>
    <p>${escapeHtml(finding.plainEnglish)}</p>
    <p class="why"><strong>Why it matters:</strong> ${escapeHtml(finding.whyItMatters)}</p>
    <details><summary>Read the original wording</summary><blockquote>“${escapeHtml(finding.originalQuote)}”</blockquote></details>
    <button class="source-button">Open and highlight source ↗</button>
  `;
  article.querySelector(".source-button").addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "OPEN_AND_HIGHLIGHT",
        url: state.selectedUrl,
        quote: finding.originalQuote
      });
      if (response?.error) throw new Error(response.error);
      if (response?.found === false) throw new Error("Could not find that exact wording on the page.");
      announce("Opened the source and highlighted the wording.");
    } catch (error) {
      announce(error.message || "Opening the source page instead.");
      chrome.tabs.create({ url: state.selectedUrl });
    }
  });
  return article;
}

function showError(message) {
  $("#errorMessage").textContent = message;
  showView("error");
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function announce(message) {
  $("#announcer").textContent = message;
}

function syncFieldValidity(event) {
  const input = event.target;
  if (!input.matches?.("input")) return;
  if (input.matches(":user-invalid")) {
    markFieldError(input);
  } else {
    clearFieldError(input);
  }
}

function markFieldError(input) {
  input.setAttribute("aria-invalid", "true");
}

function clearFieldError(input) {
  input.removeAttribute("aria-invalid");
}
