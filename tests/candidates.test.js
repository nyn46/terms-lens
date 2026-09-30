import test from "node:test";
import assert from "node:assert/strict";
import { chooseAgreement, looksLikeAgreement, rejectionReason, scoreCandidate, toDocument } from "../extension/lib/candidates.js";

const LEGAL = {
  textLength: 2400,
  strongCues: ["terms", "conditions", "arbitration", "liability", "refund"],
  weakCues: ["privacy", "agreement"],
  blocks: [{ id: "block-1", heading: "", text: "All disputes will be resolved through binding arbitration on an individual basis." }]
};
const candidate = (kind, extra = {}) => ({ kind, label: kind, width: 500, height: 600, hasEmailInput: false, hasPasswordInput: false, blocks: [], strongCues: [], weakCues: [], textLength: 0, ...extra });
const top = (candidates, extra = {}) => ({ frameId: 0, result: { frame: { isTop: true, url: "https://shop.example/signup", title: "Sign up" }, candidates, embeds: [], links: [], contentType: "text/html", ...extra } });
const PAGE = candidate("page", { textLength: 900, strongCues: [], weakCues: [], blocks: [{ id: "block-1", heading: "", text: "Welcome to our shop. Create an account to start saving your favourite items." }] });

test("a legal dialog is chosen instead of the page behind it", () => {
  for (const kind of ["dialog", "aria-dialog", "aria-modal", "overlay", "shadow"]) {
    const choice = chooseAgreement([top([candidate(kind, LEGAL), PAGE])]);
    assert.equal(choice.type, "scan", kind);
    assert.equal(choice.source, "modal", kind);
    assert.equal(choice.candidate.kind, kind);
  }
});

test("a cookie banner is rejected and the page is scanned instead", () => {
  const banner = candidate("aria-dialog", { textLength: 210, weakCues: ["cookies", "privacy"], strongCues: [], label: "Cookies" });
  assert.equal(rejectionReason(banner), "cookie-banner");
  const choice = chooseAgreement([top([banner, PAGE])]);
  assert.equal(choice.source, "page");
  assert.deepEqual(choice.rejected.map((r) => r.reason), ["cookie-banner"]);
});

test("a long cookie consent banner without contract language is still not an agreement", () => {
  const long = candidate("dialog", { textLength: 1500, weakCues: ["cookies", "privacy", "consent"], strongCues: ["terms"] });
  assert.equal(looksLikeAgreement(long), false);
});

test("a newsletter popup and a login form are rejected", () => {
  const newsletter = candidate("dialog", { textLength: 180, hasEmailInput: true, weakCues: [], strongCues: [] });
  const login = candidate("aria-modal", { textLength: 700, hasPasswordInput: true, weakCues: ["privacy"], strongCues: ["terms"] });
  assert.equal(rejectionReason(newsletter), "newsletter-or-signup-form");
  assert.equal(rejectionReason(login), "login-form");
  const choice = chooseAgreement([top([newsletter, login, PAGE])]);
  assert.equal(choice.source, "page");
  assert.equal(choice.rejected.length, 2);
});

test("with several dialogs the real agreement wins", () => {
  const cookie = candidate("dialog", { textLength: 240, weakCues: ["cookies"] });
  const newsletter = candidate("aria-dialog", { textLength: 200, hasEmailInput: true });
  const summary = candidate("aria-dialog", { ...LEGAL, textLength: 620, strongCues: ["terms", "conditions"], weakCues: ["privacy"], label: "Short summary" });
  const full = candidate("dialog", { ...LEGAL, label: "Terms of Service" });
  const choice = chooseAgreement([top([cookie, newsletter, summary, full, PAGE])]);
  assert.equal(choice.candidate.label, "Terms of Service");
  assert.ok(scoreCandidate(full) > scoreCandidate(summary));
  assert.equal(choice.rejected.length, 2);
});

test("a hidden modal never reaches the scanner, so the page is used", () => {
  // The content script drops invisible dialogs before reporting; with none reported the page is chosen.
  const choice = chooseAgreement([top([PAGE])]);
  assert.equal(choice.source, "page");
  assert.equal(choice.candidate.kind, "page");
});

test("a legal page with no dialog is scanned as the page", () => {
  const page = candidate("page", { ...LEGAL });
  assert.equal(chooseAgreement([top([page])]).source, "page");
});

test("a same-origin iframe inside a dialog beats the signup page", () => {
  const frame = { frameId: 7, result: { frame: { isTop: false, url: "https://shop.example/terms-frame" }, candidates: [candidate("frame", { ...LEGAL, inDialog: true, label: "Terms frame" })], embeds: [], links: [] } };
  const choice = chooseAgreement([top([PAGE]), frame]);
  assert.equal(choice.source, "frame");
  assert.equal(choice.frameId, 7);
});

test("a cross-origin terms iframe inside a modal produces the embedded fallback, not a scan of the signup page", () => {
  const embed = { src: "https://legal.other.example/terms", origin: "https://legal.other.example", title: "", sameOrigin: false, inModal: true, width: 600, height: 500 };
  const modalShell = candidate("aria-dialog", { textLength: 60 });
  const choice = chooseAgreement([top([modalShell, PAGE], { embeds: [embed] })]);
  assert.equal(choice.type, "embed");
  assert.equal(choice.embed.origin, "https://legal.other.example");
});

test("an unrelated cross-origin iframe (an ad, say) does not hijack a normal page", () => {
  const ad = { src: "https://ads.example/slot", origin: "https://ads.example", title: "Advertisement", sameOrigin: false, inModal: false, width: 300, height: 250 };
  assert.equal(chooseAgreement([top([PAGE], { embeds: [ad] })]).type, "scan");
});

test("a cross-origin iframe that looks like terms is offered only when the page itself has little text", () => {
  const embed = { src: "https://x.example/terms", origin: "https://x.example", title: "Terms", sameOrigin: false, inModal: false, width: 800, height: 600 };
  assert.equal(chooseAgreement([top([candidate("page", { textLength: 40 })], { embeds: [embed] })]).type, "embed");
  assert.equal(chooseAgreement([top([PAGE], { embeds: [embed] })]).type, "scan");
});

test("an empty page yields the empty result with links to try", () => {
  const links = [{ label: "Terms", url: "https://shop.example/terms", score: 9 }];
  const choice = chooseAgreement([top([candidate("page", { textLength: 0 })], { links })]);
  assert.equal(choice.type, "empty");
  assert.deepEqual(choice.links, links);
});

test("toDocument uses the dialog's own title and text, and the page's address", () => {
  const choice = chooseAgreement([top([candidate("dialog", { ...LEGAL, label: "Terms of Service" }), PAGE])]);
  const doc = toDocument(choice);
  assert.equal(doc.title, "Terms of Service");
  assert.equal(doc.url, "https://shop.example/signup");
  assert.equal(doc.blocks, LEGAL.blocks);
});
