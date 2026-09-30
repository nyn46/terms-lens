// The service worker only reads the page the user chose to scan. All analysis
// (Quick Scan and Private AI Scan) runs in the side panel, on this device.

// Clicking the toolbar icon grants "activeTab" for that page and opens the panel.
chrome.action.onClicked.addListener((tab) => {
  if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  rememberTab(tab?.id).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  rememberTab(tabId).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(message) {
  try {
    if (message?.type === "SCAN_TAB") return await readPage(message.tabId);
    if (message?.type === "HIGHLIGHT_IN_TAB") return await highlightInTab(message.tabId, message.quote);
    if (message?.type === "OPEN_AND_HIGHLIGHT") return await openAndHighlight(message.url, message.quote);
    return { error: "Unknown request." };
  } catch (error) {
    return { error: error.message || "Request failed." };
  }
}

async function rememberTab(tabId) {
  if (tabId == null) return;
  await chrome.storage.session.set({ termsLensTabId: tabId });
}

async function resolveTabId(requested) {
  if (requested != null) return requested;
  const { termsLensTabId } = await chrome.storage.session.get("termsLensTabId");
  if (termsLensTabId != null) return termsLensTabId;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active?.id ?? null;
}

async function readPage(requestedTabId) {
  const tabId = await resolveTabId(requestedTabId);
  if (tabId == null) return { needsActivation: true };
  try {
    const existing = await runInPage(tabId);
    const page = existing ?? (await injectAndRun(tabId));
    if (page?.contentType === "application/pdf") return { unsupported: "pdf" };
    if (!page?.currentDocument) return { error: "No readable page content was found." };
    return { tabId, page };
  } catch {
    // Chrome refused the script: this page is off limits, or access has not been granted yet.
    return classifyBlockedTab(tabId);
  }
}

async function classifyBlockedTab(tabId) {
  let url = "";
  try {
    url = (await chrome.tabs.get(tabId)).url || "";
  } catch {
    // The URL is only visible once the user has invoked the extension on this tab.
  }
  if (/^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i.test(url)) return { unsupported: "browser-page" };
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url)) return { unsupported: "web-store" };
  if (/\.pdf($|[?#])/i.test(url)) return { unsupported: "pdf" };
  if (/^https?:/i.test(url)) return { needsPermission: true, origin: new URL(url).origin, tabId };
  return { needsActivation: true };
}
async function injectAndRun(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
  return runInPage(tabId);
}

async function runInPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.TermsLens?.discoverPage?.() ?? null
  });
  return result;
}

async function highlightInTab(tabId, quote) {
  await chrome.tabs.update(tabId, { active: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (value) => window.TermsLens.highlightQuote(value),
    args: [quote]
  });
  return result;
}

async function openAndHighlight(url, quote) {
  const origin = new URL(url).origin;
  const hasPermission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  const tab = await chrome.tabs.create({ url, active: true });
  if (!hasPermission) return { found: false, opened: true };
  await waitForTab(tab.id);
  return highlightInTab(tab.id, quote);
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("The policy page took too long to load."));
    }, 20_000);
    function listener(updatedId, info) {
      if (updatedId !== tabId || info.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
