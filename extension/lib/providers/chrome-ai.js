import { buildResult, verifyAndCleanFindings } from "../result.js";
import { ProviderError } from "./errors.js";

// Model-facing instructions and schema for Chrome's on-device Prompt API.
const INSTRUCTIONS = `You explain website legal terms to ordinary consumers.
Rules:
- This is plain-language educational analysis, not legal advice.
- Analyze only the supplied blocks. Never judge whether a company is trustworthy.
- Every finding cites exactly one supplied blockId.
- originalQuote must be copied word for word from that block.
- Do not invent clauses. If evidence is unclear, omit the finding.
- "concern": wording that could materially reduce user rights, raise cost, broaden data or content use, or limit remedies.
- "caution": an important condition a user should understand.
- "positive": a clear user protection or limit on the company.
- Keep titles under 9 words and explanations short.
Reply with JSON only.`;

export const RESPONSE_SCHEMA = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        required: ["blockId", "classification", "severity", "category", "title", "originalQuote", "plainEnglish", "whyItMatters"],
        properties: {
          blockId: { type: "string" },
          classification: { type: "string", enum: ["concern", "caution", "positive", "neutral"] },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: { type: "string" },
          title: { type: "string" },
          originalQuote: { type: "string" },
          plainEnglish: { type: "string" },
          whyItMatters: { type: "string" },
          suggestedAction: { type: "string" }
        }
      }
    }
  }
};

const SESSION_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }]
};

const CHUNK_CHARS = 4500;
const MAX_CHUNKS = 8;
const CANDIDATE_PATTERN = /arbitrat|class action|renew|refund|cancel|licen[cs]e|sell|share|personal (?:data|information)|delete|terminat|liabil|indemn|change|waive|consent|track|cookie|fee|charge|dispute|governing law/i;

export function chunkBlocks(blocks, size = CHUNK_CHARS) {
  const chunks = [];
  let current = [];
  let used = 0;
  for (const block of blocks) {
    if (current.length && used + block.text.length > size) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(block);
    used += block.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function createChromeAiProvider({ languageModel = globalThis.LanguageModel, promptTimeoutMs = 90_000 } = {}) {
  async function availability() {
    if (!languageModel || typeof languageModel.availability !== "function") {
      return { state: "unavailable", reason: "This version of Chrome does not offer on-device AI." };
    }
    try {
      const state = await languageModel.availability(SESSION_OPTIONS);
      if (["available", "downloadable", "downloading", "unavailable"].includes(state)) return { state };
      // Older Chrome builds reported "readily" / "after-download".
      if (state === "readily") return { state: "available" };
      if (state === "after-download") return { state: "downloadable" };
      return { state: "unavailable", reason: "On-device AI is not ready on this device." };
    } catch {
      return { state: "unavailable", reason: "On-device AI could not be checked." };
    }
  }

  /** `download` must only be true when the user has just clicked a download/run button. */
  async function createSession({ onDownloadProgress, signal } = {}) {
    return languageModel.create({
      ...SESSION_OPTIONS,
      initialPrompts: [{ role: "system", content: INSTRUCTIONS }],
      signal,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => onDownloadProgress?.(event.loaded));
      }
    });
  }

  async function analyze(document, { onProgress, onDownloadProgress, signal } = {}) {
    const status = await availability();
    if (status.state === "unavailable") {
      throw new ProviderError("unavailable", status.reason || "On-device AI is unavailable.");
    }
    if (status.state === "downloading") {
      throw new ProviderError("downloading", "Chrome is still downloading its on-device model.");
    }

    let session;
    try {
      session = await createSession({ onDownloadProgress, signal });
      // Prioritise blocks that mention clause-like topics so a small model's window is well spent.
      const relevant = document.blocks.filter((block) => CANDIDATE_PATTERN.test(block.text));
      const chunks = chunkBlocks(relevant).slice(0, MAX_CHUNKS);
      const findings = [];
      let invalidChunks = 0;
      for (const [index, chunk] of chunks.entries()) {
        onProgress?.({ done: index, total: chunks.length });
        let raw;
        const timer = new AbortController();
        const timeout = setTimeout(() => timer.abort(), promptTimeoutMs);
        const onAbort = () => timer.abort();
        signal?.addEventListener("abort", onAbort);
        try {
          raw = await session.prompt(
            JSON.stringify({ blocks: chunk.map(({ id, heading, text }) => ({ blockId: id, heading, text })) }),
            { responseConstraint: RESPONSE_SCHEMA, signal: timer.signal }
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          if (timer.signal.aborted) throw new ProviderError("timeout", "On-device AI took too long.");
          throw new ProviderError("failed", "On-device AI could not finish this scan.");
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
        }
        const parsed = parseModelJson(raw);
        if (!parsed) {
          invalidChunks++;
          continue;
        }
        findings.push(...parseModelOutput(parsed, chunk));
      }
      onProgress?.({ done: chunks.length, total: chunks.length });
      if (chunks.length && invalidChunks === chunks.length) {
        throw new ProviderError("invalid", "On-device AI returned an answer Terms Lens could not use.");
      }
      return buildResult({
        document,
        findings: findings.map((finding) => ({ ...finding, confidence: Math.min(finding.confidence || 0.6, 0.85) })),
        mode: "private-ai",
        limitations: [
          "Private AI Scan runs on this device with a small model. Each finding is checked against the page text, but the model can still misread context. Not legal advice."
        ]
      });
    } finally {
      session?.destroy?.();
    }
  }

  return { id: "chrome-ai", label: "Private AI Scan", availability, analyze };
}

/** Returns the parsed object, or null if the model's reply is not a JSON object with a findings array. */
export function parseModelJson(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" && Array.isArray(parsed.findings) ? parsed : null;
  } catch {
    return null;
  }
}

/** Validates the model's findings against the source blocks; anything unsupported is dropped. */
export function parseModelOutput(raw, blocks) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  return verifyAndCleanFindings(parsed, blocks).map((finding) => ({
    ...finding,
    confidence: finding.confidence || 0.6
  }));
}
