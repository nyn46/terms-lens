import { ProviderError } from "./errors.js";

/**
 * Placeholders that define the boundary for remote providers. Nothing here
 * sends data anywhere. A real implementation must:
 *   - implement { id, label, availability(), analyze(document, options) };
 *   - return the same result shape as quickScan(), with verified evidence;
 *   - only run after the user explicitly selected it in Settings;
 *   - never embed an owner API key in the extension.
 */
function comingSoon(id, label) {
  return {
    id,
    label,
    async availability() {
      return { state: "coming-soon", reason: `${label} is not available yet.` };
    },
    async analyze() {
      throw new ProviderError("not-implemented", `${label} is not available yet.`);
    }
  };
}

export const createCloudProvider = () => comingSoon("cloud", "Terms Lens Cloud");
export const createByokProvider = () => comingSoon("byok", "Your own provider key");
