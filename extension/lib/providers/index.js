import { quickScan } from "../quick-scan.js";
import { createChromeAiProvider } from "./chrome-ai.js";

// Preferences: "automatic" offers Private AI Scan after Quick Scan; "chrome-ai" also runs it
// automatically when Chrome's model is already on the device. There is deliberately no
// option that requires an account, API key or remote service.
export const PREFERENCES = ["automatic", "chrome-ai"];
export const DEFAULT_PREFERENCE = "automatic";

/** Quick Scan is a provider too, but it is always local and can never be unavailable. */
export const quickScanProvider = {
  id: "quick",
  label: "Quick Scan",
  async availability() {
    return { state: "available" };
  },
  async analyze(document) {
    return quickScan(document);
  }
};

export function createProviders(overrides = {}) {
  return {
    quick: quickScanProvider,
    "chrome-ai": overrides["chrome-ai"] ?? createChromeAiProvider()
  };
}

export function normalizePreference(value) {
  return PREFERENCES.includes(value) ? value : DEFAULT_PREFERENCE;
}

/** Quick Scan never depends on anything else and never throws because of a provider. */
export async function runQuickScan(document, providers = createProviders()) {
  return providers.quick.analyze(document);
}

/**
 * Runs a deeper provider. On any failure the caller keeps the Quick Scan result:
 * { ok: true, result } or { ok: false, reason, code }.
 */
export async function runDeeperScan(providerId, document, providers, options) {
  const provider = providers[providerId];
  if (!provider || providerId === "quick") return { ok: false, code: "unavailable", reason: "No deeper scan is available." };
  try {
    const status = await provider.availability();
    if (status.state === "unavailable") {
      return { ok: false, code: "unavailable", reason: status.reason || "This scan is not available." };
    }
    const result = await provider.analyze(document, options);
    return { ok: true, result };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, code: "aborted", reason: "Scan cancelled." };
    return { ok: false, code: error?.code || "failed", reason: error?.message || "The deeper scan could not finish." };
  }
}
