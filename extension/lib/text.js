export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const MAX_BLOCKS = 1200;
const MAX_BLOCK_LENGTH = 12_000;
const MAX_TOTAL_CHARS = 180_000;

/** Validates and trims extracted page text into traceable blocks. */
export function sanitizeDocument(input) {
  if (!input || typeof input !== "object") throw new Error("No page content was provided.");
  const url = String(input.url ?? "").slice(0, 2048);
  const title = normalizeText(input.title || "Terms document").slice(0, 300);
  if (!/^https?:\/\//i.test(url)) throw new Error("A valid HTTP or HTTPS document URL is required.");
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    throw new Error("No policy text was extracted.");
  }

  let total = 0;
  const blocks = [];
  for (const candidate of input.blocks.slice(0, MAX_BLOCKS)) {
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
