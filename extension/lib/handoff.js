import { normalizeText } from "./text.js";

export const SERVICES = {
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com/" },
  gemini: { label: "Gemini", url: "https://gemini.google.com/app" }
};

// Above this size a pasted prompt becomes unreliable, so a file is offered instead.
export const MAX_CLIPBOARD_CHARS = 24_000;

const INSTRUCTIONS = `You are helping an ordinary person understand a website's legal terms in plain English.

Rules:
- Base every statement on the document text below. Do not invent clauses or consequences that are not there.
- For every finding, quote or precisely identify the source wording.
- Clearly separate what the document says (facts) from what is uncertain, depends on context, or depends on where the reader lives. Say "the document does not say" when it is silent.
- Do not judge whether the company is trustworthy.
- This is plain-language guidance, not legal advice.

Please produce:
1. A short plain-English summary of what the reader is agreeing to.
2. Concerns: wording that could reduce the reader's rights, raise their costs, broaden use of their data or content, or limit their remedies.
3. Important conditions: things a reasonable person should understand before agreeing.
4. Positive or user-friendly provisions.
5. Questions the reader should investigate or ask before agreeing.
6. Anything in the Quick Scan findings below that looks wrong or missing context.`;

function documentText(document) {
  return document.blocks
    .map((block) => (block.heading ? `[${block.heading}] ${block.text}` : block.text))
    .join("\n\n");
}

function quickFindingsText(findings) {
  if (!findings.length) return "(Quick Scan found no known patterns on this page.)";
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
    `Document title: ${document.title}`,
    `Source URL: ${document.url}`,
    `Date analysed: ${date.toISOString().slice(0, 10)}`
  ].join("\n");
  const quick = `Quick Scan findings (automatic pattern matching, may miss context):\n${quickFindingsText(findings)}`;
  const body = documentText(document);
  const full = `${INSTRUCTIONS}\n\n${header}\n\n${quick}\n\n--- DOCUMENT TEXT ---\n${body}\n--- END OF DOCUMENT ---\n`;

  if (full.length <= MAX_CLIPBOARD_CHARS) {
    return { mode: "clipboard", clipboardText: full, fileName: null, fileContent: null };
  }
  const slug = (document.title || "terms").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "terms";
  return {
    mode: "file",
    fileName: `terms-lens-${slug}-analysis.md`,
    fileContent: `# Terms Lens analysis request\n\n${full}`,
    clipboardText: null
  };
}

/**
 * Must be called from a user click. deps: { writeClipboard(text), openTab(url), downloadFile(name, content) }.
 * Returns { ok, message, mode }; it never throws.
 */
export async function continueIn(serviceId, handoff, deps) {
  const service = SERVICES[serviceId];
  if (!service) return { ok: false, message: "That service is not supported." };
  try {
    if (handoff.mode === "file") {
      await deps.downloadFile(handoff.fileName, handoff.fileContent);
      await deps.writeClipboard(
        `I have attached the file "${handoff.fileName}" from Terms Lens. Please follow the instructions inside it and analyse the document it contains.`
      );
      await deps.openTab(service.url);
      return {
        ok: true,
        mode: "file",
        message: `The document was too long to paste, so it was saved as ${handoff.fileName} in your Downloads folder, and short instructions were copied. Upload the file in ${service.label} and paste the instructions.`
      };
    }
    await deps.writeClipboard(handoff.clipboardText);
    await deps.openTab(service.url);
    return { ok: true, mode: "clipboard", message: `Prompt copied. Paste it into ${service.label} to continue.` };
  } catch {
    return {
      ok: false,
      message: `Terms Lens could not copy the prompt, so nothing was shared. Please try again.`
    };
  }
}
