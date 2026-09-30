import { normalizeText } from "./text.js";

export const SERVICES = {
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com/" },
  gemini: { label: "Gemini", url: "https://gemini.google.com/app" }
};

// Above this many characters the prompt is saved as a file instead of pasted. 40,000 characters is about
// 10,000 tokens: comfortably inside both services' message limits and still quick to paste, so ordinary
// agreements go straight to the clipboard and only very long ones need a file upload. Nothing is truncated.
export const MAX_CLIPBOARD_CHARS = 40_000;

// How long "Copied. Paste into ..." stays on screen before the new tab takes focus and closes the popup.
export const FEEDBACK_MS = 900;

const INSTRUCTIONS = `You are helping an ordinary person understand a website's legal agreement in plain English.

Rules:
- Base every statement on the agreement text below. Do not invent clauses or consequences that are not there.
- For every finding, quote the exact agreement wording it relies on.
- Clearly separate definite findings (what the text plainly says) from uncertainty (what is ambiguous, depends on context, or depends on where the reader lives). Say "the agreement does not say" when it is silent.
- Do not judge whether the company is trustworthy.
- This is plain-language guidance, not legal advice.

Please produce:
1. A short plain-English summary of what the reader is agreeing to.
2. Concerns: wording that could reduce the reader's rights, raise their costs, broaden use of their data or content, or limit their remedies.
3. Important conditions: things a reasonable person should understand before agreeing.
4. User-friendly provisions: protections or limits on the company.
5. Questions the reader should investigate or ask before agreeing.
6. Anything in the Quick Scan findings below that looks wrong or lacks context.`;

function documentText(document) {
  return document.blocks
    .map((block) => (block.heading ? `[${block.heading}] ${block.text}` : block.text))
    .join("\n\n");
}

function quickFindingsText(findings) {
  if (!findings.length) return "(Quick Scan matched no known patterns.)";
  return findings
    .map((f, i) => `${i + 1}. [${f.classification}] ${f.title}\n   Evidence: "${normalizeText(f.originalQuote)}"`)
    .join("\n");
}

/**
 * Builds everything needed for a hand-off. Nothing is sent anywhere here; the
 * text only leaves the device if the user pastes or uploads it themselves.
 */
export function buildHandoff({ document, findings, date = new Date() }) {
  const header = [
    `Agreement title: ${document.title}`,
    `Source URL: ${document.url}`,
    `Date analysed: ${date.toISOString().slice(0, 10)}`
  ].join("\n");
  const quick = `Quick Scan findings (automatic pattern matching; it may miss clauses that depend on context):\n${quickFindingsText(findings)}`;
  const full = `${INSTRUCTIONS}\n\n${header}\n\n${quick}\n\n--- AGREEMENT TEXT ---\n${documentText(document)}\n--- END OF AGREEMENT ---\n`;

  if (full.length <= MAX_CLIPBOARD_CHARS) {
    return { mode: "clipboard", clipboardText: full, fileName: null, fileContent: null };
  }
  const slug = (document.title || "agreement").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "agreement";
  return {
    mode: "file",
    fileName: `terms-lens-${slug}-analysis.md`,
    fileContent: `# Terms Lens analysis request\n\n${full}`,
    clipboardText: null
  };
}

const uploadInstructions = (fileName) =>
  `I have attached the file "${fileName}" from Terms Lens. Please follow the instructions inside it and analyse the agreement it contains.`;

/**
 * Must be called from a user click. The order is fixed:
 *   1. copy to the clipboard (and, for long documents, save the file first)
 *   2. only if that worked: tell the user, wait briefly, then open the service
 * If copying fails, NOTHING is opened and a fallback (text to copy by hand) is returned.
 *
 * deps: { writeClipboard(text), downloadFile(name, content), openTab(url), announce(message), delay(ms) }
 */
export async function continueIn(serviceId, handoff, deps) {
  const service = SERVICES[serviceId];
  if (!service) return { ok: false, message: "That service is not supported.", fallback: null };

  const textToCopy = handoff.mode === "file" ? uploadInstructions(handoff.fileName) : handoff.clipboardText;
  try {
    if (handoff.mode === "file") await deps.downloadFile(handoff.fileName, handoff.fileContent);
    await deps.writeClipboard(textToCopy);
  } catch {
    return {
      ok: false,
      message: `Copying did not work automatically. Copy the text below, then open ${service.label} and paste it.`,
      fallback: { text: textToCopy, serviceId, fileName: handoff.mode === "file" ? handoff.fileName : null }
    };
  }

  const message = handoff.mode === "file"
    ? `Saved ${handoff.fileName} to your Downloads folder and copied upload instructions. Upload the file in ${service.label} to continue.`
    : `Copied. Paste into ${service.label} to continue.`;
  deps.announce?.(message);
  await deps.delay?.(FEEDBACK_MS);
  try {
    await deps.openTab(service.url);
  } catch {
    return { ok: true, mode: handoff.mode, message: `${message} Open ${service.label} yourself: ${service.url}`, opened: false };
  }
  return { ok: true, mode: handoff.mode, message, opened: true };
}
