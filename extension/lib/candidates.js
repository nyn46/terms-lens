// Chooses which visible text to scan: a signup/checkout agreement dialog if there is one, otherwise the page.
// Pure functions over the plain objects the content script returns, so they can be unit-tested.

export const MIN_AGREEMENT_CHARS = 400;
const LONG_AGREEMENT_CHARS = 1200;
const MODAL_KINDS = new Set(["dialog", "aria-dialog", "aria-modal", "overlay", "shadow"]);
const KIND_WEIGHT = { dialog: 40, "aria-dialog": 40, "aria-modal": 40, shadow: 35, overlay: 30, frame: 10, page: 0 };
const LEGAL_EMBED = /terms|privacy|legal|agreement|policy|\btos\b|eula|conditions/i;

/** Why a candidate is not a legal agreement, or null if it looks like one. */
export function rejectionReason(candidate) {
  const strong = candidate.strongCues?.length ?? 0;
  const weak = candidate.weakCues?.length ?? 0;
  if ((candidate.textLength ?? 0) < MIN_AGREEMENT_CHARS) {
    if (candidate.weakCues?.includes("cookies")) return "cookie-banner";
    if (candidate.hasEmailInput) return "newsletter-or-signup-form";
    return "too-short";
  }
  if (strong >= 2) return null;
  if (strong + weak >= 5 && candidate.textLength >= LONG_AGREEMENT_CHARS) return null;
  if (candidate.hasPasswordInput) return "login-form";
  if (candidate.weakCues?.includes("cookies")) return "cookie-banner";
  if (candidate.hasEmailInput) return "newsletter-or-signup-form";
  return "not-legal";
}

export const looksLikeAgreement = (candidate) => rejectionReason(candidate) === null;

export function scoreCandidate(candidate) {
  const base = KIND_WEIGHT[candidate.kind] ?? 0;
  const inDialog = candidate.kind === "frame" && candidate.inDialog ? 25 : 0;
  return base + inDialog + (candidate.strongCues?.length ?? 0) * 6 + (candidate.weakCues?.length ?? 0) * 2 + Math.min(10, (candidate.textLength ?? 0) / 800);
}

function legalEmbed(embed) {
  if (embed.sameOrigin) return false;
  return embed.inModal || LEGAL_EMBED.test(`${embed.src} ${embed.title}`);
}

/**
 * frameResults: [{ frameId, result: { frame, candidates, embeds, links, contentType } }]
 * Returns one of
 *   { type: "scan", candidate, frameId, frame, source: "modal" | "frame" | "page", rejected }
 *   { type: "embed", embed, links }       (legal text is embedded from another site we cannot read)
 *   { type: "empty", links }
 */
export function chooseAgreement(frameResults) {
  const all = [];
  let top = null;
  let embeds = [];
  let links = [];
  for (const { frameId, result } of frameResults) {
    if (!result) continue;
    if (result.frame?.isTop) {
      top = result.frame;
      embeds = result.embeds ?? [];
      links = result.links ?? [];
    }
    for (const candidate of result.candidates ?? []) all.push({ candidate, frameId, frame: result.frame });
  }
  const rejected = [];
  const qualified = [];
  for (const item of all) {
    if (item.candidate.kind === "page") continue;
    const reason = rejectionReason(item.candidate);
    if (reason) rejected.push({ kind: item.candidate.kind, label: item.candidate.label, reason });
    else qualified.push(item);
  }
  qualified.sort((a, b) => scoreCandidate(b.candidate) - scoreCandidate(a.candidate));
  if (qualified.length) {
    const best = qualified[0];
    return { type: "scan", ...best, top, source: MODAL_KINDS.has(best.candidate.kind) ? "modal" : "frame", rejected };
  }

  const page = all.find((item) => item.candidate.kind === "page");
  // A dialog that only embeds another site's terms must not be replaced by the unrelated signup page behind it.
  const pageIsThin = !page || page.candidate.textLength < MIN_AGREEMENT_CHARS;
  const embed = embeds.find((item) => legalEmbed(item) && (item.inModal || pageIsThin));
  if (embed) return { type: "embed", embed, links, rejected };
  if (page && page.candidate.textLength > 0) return { type: "scan", ...page, top, source: "page", rejected };
  return { type: "empty", links, rejected };
}

/** The text the Quick Scan should read, in the shape the analyzer expects. */
export function toDocument(choice, fallbackTitle = "Agreement") {
  const { candidate, frame, top } = choice;
  const title = (choice.source === "page" ? frame?.title || candidate.label : candidate.label) || fallbackTitle;
  return { title, url: top?.url || frame?.url || "", blocks: candidate.blocks };
}
