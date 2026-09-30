// Development-only analyzer. The shipped extension does not use this server.
import { ANALYSIS_INSTRUCTIONS, buildAnalysisInput } from "./prompt.js";
import { analysisSchema } from "./schema.js";
import { quickScan } from "../extension/lib/quick-scan.js";
import { sanitizeDocument } from "../extension/lib/text.js";
import { buildResult, verifyAndCleanFindings } from "../extension/lib/result.js";

const CHUNK_CHARS = 38_000;

export const sanitizeRequest = sanitizeDocument;
export const analyzeWithRules = quickScan;
export { verifyAndCleanFindings };
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

  const findings = chunkResults.flatMap((result, index) =>
    verifyAndCleanFindings(result, chunks[index])
  );
  return buildResult({
    document,
    findings,
    mode: "ai",
    limit: 30,
    limitations: [...new Set(chunkResults.flatMap((item) => item.limitations ?? []))].slice(0, 8)
  });
}
