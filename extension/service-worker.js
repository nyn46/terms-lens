chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  (async () => {
    await rememberPageTab(tab);
    if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
  })().catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(rememberPageTab).catch(() => {});
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    rememberPageTab(tab).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    sendResponse(await handleMessage(message));
  })();
  return true;
});

async function handleMessage(message) {
  try {
    if (message?.type === "GET_ACTIVE_TAB") {
      return { tab: await getActiveTab() };
    }

    if (message?.type === "DISCOVER_CURRENT_PAGE") {
      return await discoverOnActiveTab();
    }

    if (message?.type === "OPEN_AND_HIGHLIGHT") {
      return await openAndHighlight(message.url, message.quote);
    }

    return { error: "Unknown request." };
  } catch (error) {
    return { error: error.message || "Request failed." };
  }
}

async function getActiveTab() {
  const [focusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (isNormalPageTab(focusedTab)) {
    await rememberPageTab(focusedTab);
    return focusedTab;
  }

  const { termsLensLastPageTab } = await chrome.storage.session.get("termsLensLastPageTab");
  if (termsLensLastPageTab?.id) {
    try {
      const rememberedTab = await chrome.tabs.get(termsLensLastPageTab.id);
      if (isNormalPageTab(rememberedTab)) return rememberedTab;
    } catch {
      await chrome.storage.session.remove("termsLensLastPageTab");
    }
  }

  const tabs = await chrome.tabs.query({ active: true });
  const normalTab = tabs.find(isNormalPageTab);
  if (normalTab) {
    await rememberPageTab(normalTab);
    return normalTab;
  }

  return null;
}

async function discoverOnActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
    throw new Error("Open a normal website before scanning.");
  }
  const origin = new URL(tab.url).origin;
  const hasPermission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  if (!hasPermission) {
    return {
      needsPermission: true,
      origin,
      pageUrl: tab.url,
      pageTitle: tab.title
    };
  }
  const result = await discoverInTab(tab.id);
  return {
    ...validateDiscoveryResult(result),
    tabId: tab.id,
    pageUrl: tab.url,
    pageTitle: tab.title
  };
}

async function discoverInTab(tabId) {
  const existingResult = await runDiscoveryScript(tabId);
  if (existingResult) return existingResult;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-script.js"]
  });
  return runDiscoveryScript(tabId);
}

async function runDiscoveryScript(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.TermsLens?.discoverPage?.() ?? null
  });
  return result;
}

async function openAndHighlight(url, quote) {
  const origin = new URL(url).origin;
  const hasPermission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  if (!hasPermission) {
    throw new Error("Permission is needed to highlight that policy page.");
  }
  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTab(tab.id);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content-script.js"]
  });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (value) => window.TermsLens.highlightQuote(value),
    args: [quote]
  });
  return result;
}

function isNormalPageTab(tab) {
  return Boolean(tab?.id && /^https?:/i.test(tab.url || ""));
}

async function rememberPageTab(tab) {
  if (!isNormalPageTab(tab)) return;
  await chrome.storage.session.set({
    termsLensLastPageTab: {
      id: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title
    }
  });
}

function validateDiscoveryResult(result) {
  if (!result || typeof result !== "object") {
    throw new Error("Could not inspect this page. Reload it and try again.");
  }
  const currentDocument = result.currentDocument;
  if (!currentDocument || typeof currentDocument !== "object") {
    throw new Error("No readable page content was found.");
  }
  return {
    links: Array.isArray(result.links) ? result.links : [],
    currentDocument: {
      title: String(currentDocument.title || "Current page"),
      url: String(currentDocument.url || ""),
      blocks: Array.isArray(currentDocument.blocks) ? currentDocument.blocks : []
    }
  };
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
