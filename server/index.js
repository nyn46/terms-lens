import http from "node:http";
import { analyzeDocument, sanitizeRequest } from "./analyzer.js";

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = 1_000_000;

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method === "GET" && request.url === "/health") {
    return sendJson(response, 200, {
      ok: true,
      aiConfigured: Boolean(process.env.OPENAI_API_KEY)
    });
  }
  if (request.method === "POST" && request.url === "/api/analyze") {
    try {
      const document = sanitizeRequest(await readJson(request));
      const result = await analyzeDocument(document);
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Analysis failed." });
    }
  }
  return sendJson(response, 404, { error: "Not found." });
});

server.listen(PORT, "127.0.0.1", () => {
  const mode = process.env.OPENAI_API_KEY ? "AI analysis" : "quick scan";
  console.log(`Terms Lens server running at http://127.0.0.1:${PORT} (${mode}).`);
});
