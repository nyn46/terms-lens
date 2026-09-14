import { ANALYSIS_INSTRUCTIONS, buildAnalysisInput } from "./prompt.js";
import { analysisSchema } from "./schema.js";

const MAX_BLOCKS = 1200;
const MAX_BLOCK_LENGTH = 12_000;
const MAX_TOTAL_CHARS = 180_000;
const CHUNK_CHARS = 38_000;

const RULES = [
  {
    pattern: /binding arbitration|mandatory arbitration|resolve.*arbitration/i,
    classification: "concern",
    severity: "high",
    category: "Disputes",
    title: "Mandatory arbitration",
    plainEnglish: "Disputes may have to be handled privately through arbitration instead of court.",
    whyItMatters: "This can limit how and where you bring a claim.",
    suggestedAction: "Check whether the document provides an arbitration opt-out window."
  },
  {
    pattern: /class action waiver|waive.*class action|individual capacity only/i,
    classification: "concern",
    severity: "high",
    category: "Disputes",
    title: "Class actions waived",
    plainEnglish: "You may be giving up the ability to join a class or collective claim.",
    whyItMatters: "Small claims can be difficult to pursue individually.",
    suggestedAction: "Look for an opt-out process and deadline."
  },
  {
    pattern: /automatically renew|auto-renew|automatic renewal|recurring subscription/i,
    classification: "caution",
    severity: "medium",
    category: "Payments",
    title: "Automatic renewal",
    plainEnglish: "The subscription may renew and charge you unless you cancel.",
    whyItMatters: "You could pay for another term without taking a new action.",
    suggestedAction: "Check the renewal date and cancellation deadline."
  },
  {
    pattern: /non-refundable|no refunds|all (?:fees|payments) are final/i,
    classification: "concern",
    severity: "medium",
    category: "Refunds",
    title: "Refunds restricted",
    plainEnglish: "Some or all payments may not be refundable.",
    whyItMatters: "You may not recover money if you stop using the service or are dissatisfied.",
    suggestedAction: "Review exceptions and local consumer rights before paying."
  },
  {
    pattern: /perpetual.{0,80}(?:license|licence)|irrevocable.{0,80}(?:license|licence)/i,
    classification: "concern",
    severity: "high",
    category: "Your content",
    title: "Long-lasting content licence",
    plainEnglish: "The service may retain broad rights to use content you upload.",
    whyItMatters: "Those rights may continue even if you stop using the service.",
    suggestedAction: "Check whether deleting content or your account ends the licence."
  },
  {
    pattern: /sell (?:your |the )?personal (?:data|information)|sale of personal (?:data|information)/i,
    classification: "concern",
    severity: "high",
    category: "Privacy",
    title: "Personal data may be sold",
    plainEnglish: "The policy discusses selling personal information.",
    whyItMatters: "Your data may be transferred for commercial benefit beyond providing the service.",
    suggestedAction: "Look for a Do Not Sell or opt-out control."
  },
  {
    pattern: /may (?:change|modify|update).{0,100}(?:terms|agreement).{0,100}(?:at any time|without notice)/i,
    classification: "caution",
    severity: "medium",
    category: "Changes",
    title: "Terms may change",
    plainEnglish: "The company may change the agreement with limited notice.",
    whyItMatters: "Your rights or obligations could change after you sign up.",
    suggestedAction: "Check how changes are announced and when they take effect."
  },
  {
    pattern: /delete your (?:account|personal data)|right to (?:delete|erasure)|request deletion/i,
    classification: "positive",
    severity: "low",
    category: "Privacy",
    title: "Deletion right described",
    plainEnglish: "The document describes a way to request deletion of your account or data.",
    whyItMatters: "This gives you more control when you leave the service.",
    suggestedAction: "Note the deletion method and any stated exceptions."
  },
  {
    pattern: /(?:30|thirty) days.{0,80}(?:notice|advance)|advance notice.{0,80}(?:price|change)/i,
    classification: "positive",
    severity: "low",
    category: "Changes",
    title: "Advance notice promised",
    plainEnglish: "The company promises advance notice for certain changes.",
    whyItMatters: "You get time to review the change or cancel before it applies.",
    suggestedAction: null
  },
  {
    pattern: /cancel at any time|may cancel your subscription at any time/i,
    classification: "positive",
    severity: "low",
    category: "Cancellation",
    title: "Cancellation is available",
    plainEnglish: "The document says you can cancel at any time.",
    whyItMatters: "You are not locked into continuing indefinitely, though billing cutoffs may still apply.",
    suggestedAction: "Confirm where cancellation is completed and when charges stop."
  }
];

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function sanitizeRequest(body) {
  if (!body || typeof body !== "object") throw new Error("Request body must be an object.");
  const url = String(body.url ?? "").slice(0, 2048);
  const title = normalizeText(body.title || "Terms document").slice(0, 300);
  if (!/^https?:\/\//i.test(url)) throw new Error("A valid HTTP or HTTPS document URL is required.");
  if (!Array.isArray(body.blocks) || body.blocks.length === 0) throw new Error("No policy text was extracted.");

  let total = 0;
  const blocks = [];
  for (const candidate of body.blocks.slice(0, MAX_BLOCKS)) {
    const id = String(candidate?.id ?? "").slice(0, 120);
    const text = normalizeText(candidate?.text).slice(0, MAX_BLOCK_LENGTH);
    const heading = normalizeText(candidate?.heading).slice(0, 300);
    if (!id || text.length < 20) continue;
    if (total + text.length > MAX_TOTAL_CHARS) break;
    blocks.push({ id, heading, text });
    total += text.length;
  }
  if (!blocks.length) throw new Error("The document did not contain enough readable text.");
  return { url, title, blocks };
}

export function verifyAndCleanFindings(result, blocks) {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const cleaned = [];

  for (const finding of findings) {
    const block = byId.get(finding?.blockId);
    const quote = normalizeText(finding?.originalQuote);
    if (!block || quote.length < 8 || !normalizeText(block.text).includes(quote)) continue;
    if (!["concern", "caution", "positive", "neutral"].includes(finding.classification)) continue;
    cleaned.push({
      ...finding,
      originalQuote: quote,
      confidence: Math.max(0, Math.min(1, Number(finding.confidence) || 0)),
      sourceText: block.text
    });
  }
  return cleaned;
}

export function analyzeWithRules(document) {
  const findings = [];
  const seen = new Set();
  for (const block of document.blocks) {
    for (const rule of RULES) {
      const match = block.text.match(rule.pattern);
      const key = `${rule.title}:${block.id}`;
      if (!match || seen.has(key)) continue;
      seen.add(key);
      findings.push({
        blockId: block.id,
        classification: rule.classification,
        severity: rule.severity,
        category: rule.category,
        title: rule.title,
        originalQuote: block.text,
        plainEnglish: rule.plainEnglish,
        whyItMatters: rule.whyItMatters,
        suggestedAction: rule.suggestedAction,
        confidence: 0.78,
        sourceText: block.text
      });
    }
  }
  const concerns = findings.filter((item) => item.classification === "concern").length;
  const cautions = findings.filter((item) => item.classification === "caution").length;
  const positives = findings.filter((item) => item.classification === "positive").length;
  return {
    documentTitle: document.title,
    effectiveDate: null,
    summary: `Found ${concerns} potential concern${concerns === 1 ? "" : "s"}, ${cautions} important condition${cautions === 1 ? "" : "s"}, and ${positives} user-friendly provision${positives === 1 ? "" : "s"}.`,
    findings: findings.slice(0, 20),
    limitations: ["Quick scan uses defined phrase patterns and may miss context-dependent clauses."],
    analysisMode: "rules",
    analyzedBlocks: document.blocks.length
  };
}

function chunkBlocks(blocks) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const block of blocks) {
    if (current.length && size + block.text.length > CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("The model returned no structured text output.");
}

async function analyzeChunkWithOpenAI(document, blocks, apiKey, model) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: ANALYSIS_INSTRUCTIONS,
      input: buildAnalysisInput({ ...document, blocks }),
      text: {
        format: {
          type: "json_schema",
          name: "terms_analysis",
          strict: true,
          schema: analysisSchema
        }
      }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return JSON.parse(extractOutputText(await response.json()));
}

export async function analyzeDocument(document, env = process.env) {
  const apiKey = env.OPENAI_API_KEY;
  const model = env.OPENAI_MODEL || "gpt-5-mini";
  if (!apiKey) return analyzeWithRules(document);

  const chunks = chunkBlocks(document.blocks);
  const chunkResults = [];
  for (const blocks of chunks) {
    chunkResults.push(await analyzeChunkWithOpenAI(document, blocks, apiKey, model));
  }

  const verified = chunkResults.flatMap((result, index) =>
    verifyAndCleanFindings(result, chunks[index])
  );
  const deduped = [];
  const seen = new Set();
  for (const finding of verified) {
    const key = `${finding.classification}:${finding.category}:${finding.originalQuote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  const concerns = deduped.filter((item) => item.classification === "concern").length;
  const cautions = deduped.filter((item) => item.classification === "caution").length;
  const positives = deduped.filter((item) => item.classification === "positive").length;
  return {
    documentTitle: chunkResults[0]?.documentTitle || document.title,
    effectiveDate: chunkResults.find((item) => item.effectiveDate)?.effectiveDate ?? null,
    summary: `Found ${concerns} potential concern${concerns === 1 ? "" : "s"}, ${cautions} important condition${cautions === 1 ? "" : "s"}, and ${positives} user-friendly provision${positives === 1 ? "" : "s"}.`,
    findings: deduped.slice(0, 30),
    limitations: [...new Set(chunkResults.flatMap((item) => item.limitations ?? []))].slice(0, 8),
    analysisMode: "ai",
    analyzedBlocks: document.blocks.length
  };
}
