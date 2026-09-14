(() => {
  if (window.TermsLens) return;

  const LEGAL_PATTERNS = [
    [/terms(?: of (?:use|service))?|terms and conditions/i, 8],
    [/privacy(?: policy| notice)?/i, 7],
    [/subscription(?: terms)?/i, 5],
    [/refund(?: policy)?|cancellation(?: policy)?/i, 5],
    [/end.user.licen[cs]e|eula/i, 6],
    [/legal/i, 2]
  ];

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function discoverLinks() {
    const links = [...document.querySelectorAll("a[href]")].map((anchor) => {
      const label = cleanText(anchor.innerText || anchor.getAttribute("aria-label"));
      let url;
      try {
        url = new URL(anchor.getAttribute("href"), location.href);
      } catch {
        return null;
      }
      if (!/^https?:$/.test(url.protocol)) return null;
      const haystack = `${label} ${url.pathname}`;
      let score = LEGAL_PATTERNS.reduce(
        (sum, [pattern, weight]) => sum + (pattern.test(haystack) ? weight : 0),
        0
      );
      if (anchor.closest("footer")) score += 2;
      if (url.origin === location.origin) score += 1;
      return score > 0 ? { label: label || url.pathname, url: url.href, score } : null;
    }).filter(Boolean);

    const unique = new Map();
    for (const link of links) {
      if (!unique.has(link.url) || unique.get(link.url).score < link.score) unique.set(link.url, link);
    }
    return [...unique.values()].sort((a, b) => b.score - a.score).slice(0, 12);
  }

  function extractBlocksFrom(root = document) {
    const contentRoot = root.querySelector("main, article, [role='main']") || root.body || root;
    const elements = [...contentRoot.querySelectorAll("h1, h2, h3, h4, p, li, td, th")];
    let heading = "";
    const blocks = [];
    for (const element of elements) {
      const text = cleanText(element.textContent);
      if (/^H[1-4]$/.test(element.tagName)) {
        heading = text;
        continue;
      }
      if (text.length < 20 || text.length > 12_000) continue;
      blocks.push({ id: `block-${blocks.length + 1}`, heading, text });
    }
    return blocks;
  }

  function discoverPage() {
    return {
      links: discoverLinks(),
      currentDocument: {
        title: document.title,
        url: location.href,
        blocks: extractBlocksFrom(document)
      }
    };
  }

  function highlightQuote(quote) {
    const target = cleanText(quote);
    if (!target) return { found: false };
    const candidates = [...document.querySelectorAll("p, li, td, div")];
    const element = candidates.find((candidate) => cleanText(candidate.textContent).includes(target));
    if (!element) return { found: false };
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const originalOutline = element.style.outline;
    const originalBackground = element.style.backgroundColor;
    element.style.outline = "3px solid #f59e0b";
    element.style.backgroundColor = "rgba(245, 158, 11, 0.2)";
    element.style.borderRadius = "6px";
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.backgroundColor = originalBackground;
    }, 7000);
    return { found: true };
  }

  window.TermsLens = { discoverPage, extractBlocksFrom, highlightQuote };
})();
