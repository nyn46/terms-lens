import { createProviders, normalizePreference } from "./lib/providers/index.js";

const STATUS_TEXT = {
  available: "Chrome's on-device AI is ready on this device.",
  downloadable: "Chrome's on-device AI is supported. Its model has not been downloaded yet; Terms Lens will only start that download after you click a button in the side panel.",
  downloading: "Chrome is downloading its on-device AI model.",
  unavailable: "Chrome's on-device AI is not available on this device or Chrome version. Quick Scan works normally without it."
};

const providers = createProviders();

async function init() {
  const saved = await chrome.storage.local.get("providerPreference");
  const current = normalizePreference(saved.providerPreference);
  for (const input of document.querySelectorAll('input[name="provider"]')) {
    input.checked = input.value === current;
    input.addEventListener("change", async () => {
      await chrome.storage.local.set({ providerPreference: input.value });
      document.querySelector("#saved").textContent = "Saved.";
    });
  }
  const { state } = await providers["chrome-ai"].availability();
  document.querySelector("#aiStatus").textContent = STATUS_TEXT[state] ?? STATUS_TEXT.unavailable;
}

init();
