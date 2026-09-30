// Runs inside the page (and inside frames) only when the user scans. It reads text and never clicks,
// ticks, submits or changes anything. Injected as a classic script, so it cannot import modules.
(() => {
  const VERSION = 3;
  if (window.TermsLens?.version === VERSION) return;

  const STRONG_CUES = {
    terms: /\bterms\b/i,
    conditions: /\bconditions\b/i,
    arbitration: /arbitrat/i,
    liability: /liabilit/i,
    indemnity: /indemnif/i,
    governingLaw: /governing law|jurisdiction/i,
    refund: /\brefund/i,
    renewal: /\brenew/i,
    cancellation: /cancell?ation|terminat/i,
    licence: /licen[cs]e/i,
    warranty: /warrant(?:y|ies)/i,
    disclaimer: /disclaim/i
  };
  const WEAK_CUES = {
    privacy: /\bprivacy\b/i,
    agreement: /\bagree(?:ment)?\b/i,
    consent: /\bconsent/i,
    data: /personal (?:data|information)|data use/i,
    cookies: /\bcookies?\b/i
  };
  const LEGAL_LINK_PATTERNS = [
    [/terms(?: of (?:use|service))?|terms and conditions/i, 8],
    [/privacy(?: policy| notice)?/i, 7],
    [/subscription(?: terms)?/i, 5],
    [/refund(?: policy)?|cancellation(?: policy)?/i, 5],
    [/end.user.licen[cs]e|eula/i, 6],
    [/legal/i, 2]
  ];

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "IFRAME", "NAV", "CANVAS", "VIDEO", "AUDIO"]);
  const BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SECTION", "ARTICLE", "HEADER", "FOOTER", "ASIDE", "MAIN", "FORM", "BLOCKQUOTE", "PRE", "DL", "DT", "DD", "FIELDSET", "DETAILS", "SUMMARY", "DIALOG", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6"]);
  const OVERLAY_NAME = /modal|dialog|popup|pop-up|overlay|lightbox|drawer|sheet|layer/i;
  const MAX_BLOCKS = 1200;

  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

  // ---- visibility ----------------------------------------------------------------------------

  function parentOf(node) {
    return node.parentElement || node.parentNode?.host || null;
  }

  function hiddenByAttribute(el) {
    for (let node = el; node; node = parentOf(node)) {
      if (node.nodeType !== 1) continue;
      if (node.getAttribute("aria-hidden") === "true" && !node.matches("dialog[open]")) return true;
      if (node.hasAttribute("inert") || node.hasAttribute("hidden")) return true;
    }
    return false;
  }

  function isVisible(el, { minWidth = 1, minHeight = 1 } = {}) {
    if (!el || hiddenByAttribute(el)) return false;
    const view = el.ownerDocument.defaultView;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } else {
      const style = view.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= minWidth && rect.height >= minHeight;
  }

  // Text inside a closed <details> is in the page but not displayed; it is still part of the agreement.
  const insideClosedDetails = (el) => Boolean(el.closest?.("details:not([open])"));
  const showable = (el) => isVisible(el) || insideClosedDetails(el);

  // ---- roots (document + open shadow roots) ----------------------------------------------------

  function collectRoots(doc) {
    const roots = [doc];
    for (let i = 0; i < roots.length && roots.length < 60; i++) {
      for (const el of roots[i].querySelectorAll("*")) {
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    return roots;
  }

  // ---- text extraction ---------------------------------------------------------------------------

  const isBlockLevel = (el) => BLOCK_TAGS.has(el.tagName) || Boolean(el.shadowRoot);

  function extractBlocks(root) {
    const blocks = [];
    let heading = "";
    const push = (text) => {
      if (blocks.length >= MAX_BLOCKS) return;
      blocks.push({ id: `block-${blocks.length + 1}`, heading, text });
    };

    function visit(el) {
      if (blocks.length >= MAX_BLOCKS || SKIP_TAGS.has(el.tagName) || el.getAttribute("role") === "button") return;
      if (!showable(el)) return;
      if (/^H[1-6]$/.test(el.tagName)) {
        const text = clean(el.textContent);
        if (text) heading = text.slice(0, 300);
        return;
      }
      const kids = [...(el.shadowRoot ? el.shadowRoot.children : []), ...el.children];
      if (!kids.some(isBlockLevel)) {
        const text = clean(el.textContent);
        if (text.length >= 20 && text.length <= 12_000) push(text);
        return;
      }
      for (const node of el.shadowRoot ? [...el.shadowRoot.childNodes, ...el.childNodes] : el.childNodes) {
        if (node.nodeType === 3) {
          const text = clean(node.textContent);
          if (text.length >= 20) push(text);
        } else if (node.nodeType === 1) {
          visit(node);
        }
      }
    }

    if (root.nodeType === 1) visit(root);
    else for (const child of root.children) visit(child);
    return blocks;
  }

  function cueNames(table, text) {
    return Object.keys(table).filter((name) => table[name].test(text));
  }

  // ---- candidate agreements ----------------------------------------------------------------------

  function labelOf(el, fallback) {
    const aria = clean(el.getAttribute?.("aria-label"));
    if (aria) return aria.slice(0, 120);
    const labelledBy = el.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const text = clean(labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent || "").join(" "));
      if (text) return text.slice(0, 120);
    }
    const heading = el.querySelector?.("h1, h2, h3, [role='heading']");
    const headingText = clean(heading?.textContent);
    return (headingText || fallback).slice(0, 120);
  }

  function describe(el, kind, extra = {}) {
    const blocks = extractBlocks(el);
    const text = blocks.map((block) => block.text).join(" ");
    const rect = el.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    return {
      kind,
      label: labelOf(el, document.title || location.hostname),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      textLength: text.length,
      blocks: blocks.length ? blocks : [],
      strongCues: cueNames(STRONG_CUES, text),
      weakCues: cueNames(WEAK_CUES, text),
      hasEmailInput: Boolean(el.querySelector?.("input[type='email'], input[name*='email' i]")),
      hasPasswordInput: Boolean(el.querySelector?.("input[type='password']")),
      ...extra
    };
  }

  function overlayCandidates(root) {
    const found = [];
    const scope = root.nodeType === 9 ? root.body : root;
    if (!scope) return found;
    const view = (root.ownerDocument || root).defaultView;
    const viewportArea = Math.max(1, view.innerWidth * view.innerHeight);
    let inspected = 0;
    for (const el of scope.querySelectorAll("*")) {
      if (++inspected > 4000) break;
      if (!el.firstElementChild || SKIP_TAGS.has(el.tagName)) continue;
      const style = view.getComputedStyle(el);
      const positioned = style.position === "fixed" || (style.position === "absolute" && OVERLAY_NAME.test(`${el.id} ${el.className}`) && Number(style.zIndex) > 0);
      if (!positioned) continue;
      const rect = el.getBoundingClientRect();
      const large = rect.width * rect.height >= viewportArea * 0.15;
      if (!(large || OVERLAY_NAME.test(`${el.id} ${el.className}`))) continue;
      if (!isVisible(el, { minWidth: 160, minHeight: 120 })) continue;
      found.push(el);
    }
    return found;
  }

  function discoverCandidates() {
    const elements = new Map(); // element -> kind
    const order = ["dialog", "aria-dialog", "aria-modal", "overlay"];
    const add = (el, kind) => {
      if (!el || !isVisible(el, { minWidth: 160, minHeight: 120 })) return;
      const existing = elements.get(el);
      if (!existing || order.indexOf(kind) < order.indexOf(existing)) elements.set(el, kind);
    };
    for (const root of collectRoots(document)) {
      root.querySelectorAll("dialog[open]").forEach((el) => add(el, "dialog"));
      root.querySelectorAll("[role='dialog'], [role='alertdialog']").forEach((el) => add(el, "aria-dialog"));
      root.querySelectorAll("[aria-modal='true']").forEach((el) => add(el, "aria-modal"));
      overlayCandidates(root).forEach((el) => add(el, "overlay"));
    }

    let list = [...elements].map(([el, kind]) => ({ el, kind, info: describe(el, kindFor(el, kind)) }));
    // A fixed backdrop around a dialog repeats the dialog's text; keep the tighter element.
    list = list.filter((a) => !list.some((b) => b !== a && a.el.contains(b.el) && b.info.textLength >= a.info.textLength * 0.5));
    return list.slice(0, 6).map((item) => item.info);
  }

  // Shadow-DOM elements report "shadow" so the popup can tell where the agreement came from.
  function kindFor(el, kind) {
    return el.getRootNode() instanceof ShadowRoot ? "shadow" : kind;
  }

  function pageCandidate() {
    const root = document.querySelector("main, article, [role='main']") || document.body || document.documentElement;
    const isTop = window === window.top;
    let inDialog = false;
    let frameVisible = true;
    if (!isTop) {
      try {
        const frameEl = window.frameElement;
        if (frameEl) {
          frameVisible = isVisible(frameEl, { minWidth: 120, minHeight: 80 });
          inDialog = Boolean(frameEl.closest("dialog[open], [role='dialog'], [aria-modal='true'], [class*='modal' i], [class*='dialog' i]"));
        } else {
          frameVisible = window.innerWidth >= 120 && window.innerHeight >= 80;
        }
      } catch {
        frameVisible = window.innerWidth >= 120 && window.innerHeight >= 80;
      }
    }
    if (!frameVisible) return null;
    return describe(root, isTop ? "page" : "frame", { label: document.title || location.hostname, inDialog });
  }

  function discoverEmbeds() {
    const embeds = [];
    for (const root of collectRoots(document)) {
      for (const frame of root.querySelectorAll("iframe")) {
        if (!isVisible(frame, { minWidth: 160, minHeight: 100 })) continue;
        let sameOrigin = false;
        try {
          sameOrigin = Boolean(frame.contentDocument);
        } catch {
          sameOrigin = false;
        }
        let origin = "";
        try {
          origin = new URL(frame.src, location.href).origin;
        } catch {
          continue;
        }
        if (!/^https?:/.test(origin)) continue;
        embeds.push({
          src: frame.src,
          origin,
          title: clean(frame.title || frame.getAttribute("aria-label")).slice(0, 120),
          sameOrigin,
          inModal: Boolean(frame.closest("dialog[open], [role='dialog'], [aria-modal='true'], [class*='modal' i], [class*='dialog' i]")),
          width: Math.round(frame.getBoundingClientRect().width),
          height: Math.round(frame.getBoundingClientRect().height)
        });
      }
    }
    return embeds.slice(0, 6);
  }

  function discoverLinks() {
    const links = [];
    for (const root of collectRoots(document)) {
      for (const anchor of root.querySelectorAll("a[href]")) {
        const label = clean(anchor.innerText || anchor.getAttribute("aria-label"));
        let url;
        try {
          url = new URL(anchor.getAttribute("href"), location.href);
        } catch {
          continue;
        }
        if (!/^https?:$/.test(url.protocol) || url.href === location.href) continue;
        const haystack = `${label} ${url.pathname}`;
        let score = LEGAL_LINK_PATTERNS.reduce((sum, [pattern, weight]) => sum + (pattern.test(haystack) ? weight : 0), 0);
        if (anchor.closest("footer")) score += 2;
        if (url.origin === location.origin) score += 1;
        if (score > 0) links.push({ label: label || url.pathname, url: url.href, score });
      }
    }
    const unique = new Map();
    for (const link of links) {
      if (!unique.has(link.url) || unique.get(link.url).score < link.score) unique.set(link.url, link);
    }
    return [...unique.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  }

  /** Everything the popup needs to choose what to scan. Read-only. */
  function discover() {
    const candidates = [];
    if (window === window.top) candidates.push(...discoverCandidates());
    const page = pageCandidate();
    if (page) candidates.push(page);
    return {
      frame: { isTop: window === window.top, url: location.href, origin: location.origin, title: document.title },
      contentType: document.contentType,
      candidates,
      embeds: window === window.top ? discoverEmbeds() : [],
      links: window === window.top ? discoverLinks() : []
    };
  }

  // ---- locating and highlighting ------------------------------------------------------------------

  /** One pass over the page: the smallest displayed element containing each quote (or null). */
  function locate(quotes) {
    const targets = quotes.map((quote) => clean(quote).toLowerCase());
    const best = targets.map(() => null);
    const bestLength = targets.map(() => Infinity);
    for (const root of collectRoots(document)) {
      for (const el of root.querySelectorAll("*")) {
        if (SKIP_TAGS.has(el.tagName)) continue;
        const raw = el.textContent;
        if (!raw || raw.length < 8 || raw.length > 20_000) continue;
        let text = null;
        for (let i = 0; i < targets.length; i++) {
          if (!targets[i] || raw.length < targets[i].length || raw.length >= bestLength[i] * 4 + 400) continue;
          text ??= clean(raw).toLowerCase();
          if (text.length < bestLength[i] && text.includes(targets[i]) && showable(el)) {
            best[i] = el;
            bestLength[i] = text.length;
          }
        }
      }
    }
    return best;
  }

  /** Dry run for the popup: which quotes can be shown on this page right now? */
  function locateAll(quotes) {
    return locate(quotes).map(Boolean);
  }

  function highlight(quote) {
    const [element] = locate([quote]);
    if (!element) return { found: false };
    // scrollIntoView scrolls every scrollable ancestor (modal bodies, nested panes, parent frames).
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const original = { outline: element.style.outline, background: element.style.backgroundColor, radius: element.style.borderRadius };
    element.style.outline = "2px solid #f5b301";
    element.style.backgroundColor = "rgba(245, 179, 1, 0.22)";
    element.style.borderRadius = "4px";
    setTimeout(() => {
      element.style.outline = original.outline;
      element.style.backgroundColor = original.background;
      element.style.borderRadius = original.radius;
    }, 7000);
    return { found: true, inShadow: element.getRootNode() instanceof ShadowRoot };
  }
  window.TermsLens = { version: VERSION, discover, highlight, locateAll };
})();
