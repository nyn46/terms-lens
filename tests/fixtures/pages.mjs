// Controlled fixture pages for the real-Chrome tests. Test-only: nothing here ships in the extension.
// Every page puts a sentinel sentence in the BACKGROUND that would trigger Quick Scan if it were read,
// so a test can prove that a scan of a dialog did not read the page behind it.

export const BACKGROUND = `<main><h1>Join Acme Cloud</h1>
<p>BACKGROUND-SENTINEL Create your free account today and explore our gardening blog for spring and summer.</p>
<p>BACKGROUND-SENTINEL Our loyalty club uses automatic renewal every spring for members who opt in.</p>
<form><label>Email <input type="email" name="email" /></label><label>Password <input type="password" name="pw" /></label>
<label><input type="checkbox" name="agree" /> I agree to the terms</label><button type="button">Create account</button></form></main>`;

const CLAUSES = [
  "These Terms of Service and Conditions form an agreement between you and Acme Cloud.",
  "All disputes will be resolved through binding arbitration on an individual basis. You waive any class action rights.",
  "Your subscription will automatically renew each month unless you cancel before the renewal date.",
  "We may change these terms at any time without notice, and continued use means you accept the changes.",
  "To the maximum extent permitted by law our liability is limited and we disclaim all warranties.",
  "You grant Acme Cloud a perpetual, irrevocable licence to use content you upload."
];
const REFUND = "Fees are non-refundable once charged.";
const CANCEL = "You may cancel your subscription at any time from your account settings.";

/** The agreement text as heading + paragraphs. `filler` adds neutral paragraphs before the final clauses. */
export function termsBody({ filler = 0, heading = "Terms of Service" } = {}) {
  const paragraphs = [...CLAUSES];
  for (let i = 1; i <= filler; i++) {
    paragraphs.push(`Section ${i}. The parties acknowledge the general conditions that apply to use of the service, including account security, acceptable use and the handling of support requests in section ${i}.`);
  }
  paragraphs.push(REFUND, CANCEL);
  return `<h2>${heading}</h2>${paragraphs.map((text) => `<p>${text}</p>`).join("\n")}`;
}

const STYLE = `<style>
body{font-family:system-ui,sans-serif;margin:0;padding:24px;line-height:1.5}
.backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:grid;place-items:center;z-index:1000}
.box{background:#fff;color:#111;width:560px;max-width:92vw;max-height:80vh;overflow:auto;padding:20px;border-radius:8px}
.box.scroll{max-height:300px}
.banner{position:fixed;left:0;right:0;bottom:0;background:#222;color:#fff;padding:14px;z-index:900}
</style>`;

const page = (title, body, script = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${STYLE}</head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;

export const pages = {
  // 1. Dedicated terms page
  "terms": () => page("Acme Cloud Terms of Service", `<main><h1>Acme Cloud Terms of Service</h1>${termsBody()}</main>`),

  // 2. Native <dialog>
  "signup-dialog": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<dialog id="terms" aria-label="Terms and Conditions"><div class="box">${termsBody()}<button type="button">Accept</button></div></dialog>`,
      "document.getElementById('terms').showModal();"),

  // 3. ARIA dialog
  "signup-aria": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<div class="backdrop"><div role="dialog" aria-modal="false" aria-label="Terms and Conditions" class="box">${termsBody()}<button type="button">Accept</button></div></div>`),

  // aria-modal only (no role)
  "signup-aria-modal": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<div class="backdrop"><section aria-modal="true" class="box"><h2>Agreement</h2>${termsBody({ heading: "Your agreement" })}</section></div>`),

  // 4. Fixed overlay with no dialog semantics at all
  "signup-overlay": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<div class="terms-layer" style="position:fixed;inset:10% 15%;background:#fff;color:#111;overflow:auto;padding:20px;z-index:50;border:1px solid #999">${termsBody()}</div>`),

  // 5. React-style portal mounted at the end of <body>, inserted after first paint
  "signup-portal": () =>
    page("Sign up | Acme Cloud", `<div id="root">${BACKGROUND}</div>`,
      `setTimeout(() => { const portal = document.createElement('div'); portal.id = 'portal-root';
        portal.innerHTML = '<div class="ReactModal__Overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:grid;place-items:center;z-index:999"><div class="ReactModal__Content box">${termsBody().replace(/'/g, "\\'").replace(/\n/g, "")}</div></div>';
        document.body.appendChild(portal); }, 300);`),

  // 6. Open shadow DOM
  "signup-shadow": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<terms-modal></terms-modal>`,
      `class TermsModal extends HTMLElement { connectedCallback() { const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<style>.wrap{position:fixed;inset:0;background:rgba(0,0,0,.5);display:grid;place-items:center;z-index:999}.box{background:#fff;color:#111;width:560px;max-height:80vh;overflow:auto;padding:20px}</style><div class="wrap"><div role="dialog" aria-label="Terms and Conditions" class="box">${termsBody().replace(/'/g, "\\'").replace(/\n/g, "")}</div></div>'; } }
       customElements.define('terms-modal', TermsModal);`),

  // 7. Same-origin iframe inside a modal
  "signup-iframe-same": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<div class="backdrop"><div role="dialog" aria-label="Terms" class="box" style="width:640px"><iframe src="/frame-terms" title="Terms" style="width:100%;height:420px;border:0"></iframe></div></div>`),

  // 8. Cross-origin iframe inside a modal (other.test is a different origin)
  "signup-iframe-cross": ({ port }) =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<div class="backdrop"><div role="dialog" aria-label="Terms" class="box" style="width:640px"><iframe src="http://other.test:${port}/frame-terms" title="Terms" style="width:100%;height:420px;border:0"></iframe></div></div>`),

  "frame-terms": () => page("Embedded Terms of Service", `<main>${termsBody({ filler: 4 })}</main>`),

  // 10. Cookie banner over an ordinary article
  "cookie-banner": () =>
    page("Gardening blog", `${BACKGROUND}<div role="dialog" aria-label="Cookies" class="banner"><p>We use cookies to improve your experience. Accept all cookies or manage your choices. Read our privacy policy to learn more.</p><button type="button">Accept all</button></div>`),

  // 11. Newsletter modal
  "newsletter": () =>
    page("Gardening blog", `${BACKGROUND}<div class="backdrop"><div role="dialog" aria-label="Newsletter" class="box" style="width:380px"><h2>Get our newsletter</h2><p>Join 20,000 gardeners and get one tip every Friday.</p><input type="email" placeholder="you@example.com" /><button type="button">Subscribe</button></div></div>`),

  // 12. Hidden modal (display:none) and aria-hidden modal; both carry the full terms
  "hidden-modal": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<div role="dialog" aria-label="Terms" class="box" style="display:none">${termsBody()}</div><div class="backdrop" aria-hidden="true" style="visibility:hidden"><div role="dialog" class="box">${termsBody()}</div></div>`),

  // 13. Several dialogs at once: cookie banner, newsletter, short privacy note and the real terms
  "multi-dialogs": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}
      <div role="dialog" aria-label="Cookies" class="banner"><p>We use cookies. Accept all or manage choices.</p></div>
      <div role="dialog" aria-label="Newsletter" class="box" style="position:fixed;top:10px;right:10px;width:260px;z-index:1200"><p>Subscribe to our newsletter.</p><input type="email" /></div>
      <div class="backdrop" style="z-index:1100"><div role="dialog" aria-label="Terms of Service" class="box">${termsBody()}</div></div>`),

  // 14. Dialog inserted long after load
  "dynamic-dialog": () =>
    page("Sign up | Acme Cloud", BACKGROUND,
      `setTimeout(() => { const d = document.createElement('dialog'); d.setAttribute('aria-label', 'Terms and Conditions'); d.innerHTML = '<div class="box">${termsBody().replace(/'/g, "\\'").replace(/\n/g, "")}</div>'; document.body.appendChild(d); d.showModal(); }, 700);`),

  // 15. Scrolling modal: the clause we highlight is far below the fold inside the modal
  "scrolling-modal": () =>
    page("Sign up | Acme Cloud", `${BACKGROUND}<div class="backdrop"><div role="dialog" aria-label="Terms and Conditions" class="box scroll" id="scroller">${termsBody({ filler: 40 })}</div></div>`),

  // very long agreement (file hand-off)
  "long-terms": () =>
    page("Very Long Terms", `<main><h1>Very Long Terms</h1>${termsBody({ filler: 260 })}</main>`),

  // no text at all, but a link to the terms
  "empty-with-link": ({ port }) =>
    page("Acme Cloud", `<main><p>Hi.</p><footer><a href="http://fixtures.test:${port}/terms">Terms of Service</a></footer></main>`)
};
