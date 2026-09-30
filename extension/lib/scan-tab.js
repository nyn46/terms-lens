import { chooseAgreement, toDocument } from "./candidates.js";
import { sanitizeDocument } from "./text.js";
import { quickScan } from "./quick-scan.js";

const CACHE_PREFIX = "scan:";

/** Injects the reader into every frame we are allowed to read and collects what each one sees. */
export async function discoverFrames(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content-script.js"] });
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => window.TermsLens?.discover?.() ?? null
  });
  return results.map(({ frameId, result }) => ({ frameId, result }));
}

/**
 * Reads the page, picks the agreement (signup dialog first, page as fallback) and runs Quick Scan locally.
 * Resolves to { status: "scan" | "embed" | "empty" | "unsupported", ... }; throws if Chrome refuses the script.
 */
export async function scanTab(tabId, { onStage } = {}) {
  const frames = await discoverFrames(tabId);
  const top = frames.find((item) => item.result?.frame?.isTop)?.result;
  if (top?.contentType === "application/pdf") return { status: "unsupported", reason: "pdf" };

  onStage?.("Checking important clauses");
  const choice = chooseAgreement(frames);
  if (choice.type === "embed") return { status: "embed", embed: choice.embed, links: choice.links };
  if (choice.type === "empty") return { status: "empty", links: choice.links };

  let document;
  try {
    document = sanitizeDocument(toDocument(choice));
  } catch {
    return { status: "empty", links: top?.links ?? [] };
  }
  const result = quickScan(document);
  return {
    status: "scan",
    tabId,
    frameId: choice.frameId,
    source: choice.source,
    rejected: choice.rejected,
    links: top?.links ?? [],
    document,
    result
  };
}

/** Which of these quotes can be found on the page right now? Returns booleans in the same order. */
export async function locateQuotes(tabId, frameId, quotes) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content-script.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (list) => window.TermsLens.locateAll(list),
      args: [quotes]
    });
    return Array.isArray(result) ? result : quotes.map(() => false);
  } catch {
    return quotes.map(() => false);
  }
}

export async function highlightQuote(tabId, frameId, quote) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content-script.js"] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: (value) => window.TermsLens.highlight(value),
    args: [quote]
  });
  return result ?? { found: false };
}

// Results are kept in memory only (session storage) so the popup can be reopened; they never leave the device.
export async function saveScan(tabId, url, scan) {
  await chrome.storage.session.set({
    [CACHE_PREFIX + tabId]: { url, frameId: scan.frameId, source: scan.source, document: scan.document, result: scan.result, links: scan.links }
  });
}

export async function loadScan(tabId, url) {
  const cached = (await chrome.storage.session.get(CACHE_PREFIX + tabId))[CACHE_PREFIX + tabId];
  return cached && cached.url === url ? { status: "scan", tabId, ...cached } : null;
}

export const forgetScan = (tabId) => chrome.storage.session.remove(CACHE_PREFIX + tabId);

/** What Chrome will not let an extension read, judged from the tab's address. */
export function unsupportedReason(url) {
  if (/^(chrome|chrome-extension|edge|about|devtools|view-source|file|chrome-search|chrome-untrusted):/i.test(url)) return "browser-page";
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url)) return "web-store";
  if (/\.pdf($|[?#])/i.test(url)) return "pdf";
  return null;
}
