// The popup does all the scanning. The service worker only exists for one job the popup cannot finish
// itself: opening an agreement in a new tab (which closes the popup) and scanning it once it has loaded.
import { forgetScan, saveScan, scanTab } from "./lib/scan-tab.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OPEN_AND_SCAN") return false;
  openAndScan(message.url, message.canRead).then(sendResponse, () => sendResponse({ ok: false }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetScan(tabId).catch(() => {});
});

async function openAndScan(url, canRead) {
  if (!/^https?:\/\//i.test(String(url))) return { ok: false };
  const tab = await chrome.tabs.create({ url, active: true });
  if (!canRead) return { ok: true, scanned: false };
  try {
    await waitForLoad(tab.id);
    const scan = await scanTab(tab.id);
    if (scan.status === "scan") {
      const { url: finalUrl } = await chrome.tabs.get(tab.id);
      await saveScan(tab.id, finalUrl || url, scan);
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#6b6fe6" });
      await chrome.action.setBadgeText({ tabId: tab.id, text: "✓" });
      return { ok: true, scanned: true };
    }
  } catch {
    // The user can still click Terms Lens on that tab; nothing else to do here.
  }
  return { ok: true, scanned: false };
}

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("timeout"));
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
