# Terms Lens

Terms Lens is a Chrome extension that points out the clauses in a website's agreement worth a closer look, and shows the original wording next to each one. It works on a terms page **and on the terms shown inside a signup or checkout popup**. It is plain-language guidance, **not legal advice**, and it never gives a trust score.

## 1. Normal-user installation (no setup)

No npm, server, account, API key or environment variable is needed.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `extension` folder of this project.
3. Open a terms page, or open the terms popup in a signup or checkout flow.
4. Click the **Terms Lens** toolbar icon (pin it from the puzzle-piece menu if you cannot see it) and press **Scan this agreement**.

Quick Scan runs entirely inside the extension. It needs no server, login or internet connection.

### What gets scanned

Terms Lens reads what is visible and never clicks, ticks or submits anything, so it never accepts terms for you. It looks for the agreement in this order: an open `<dialog>`, an ARIA dialog or `aria-modal` element, a fixed-position overlay (including React/Vue portals), an open Shadow DOM dialog, a same-origin iframe, then the page itself. Candidates are scored by legal wording and size, so a cookie banner, newsletter popup, login form or hidden dialog is ignored and never scanned by mistake.

If the agreement is embedded from **another website** (a cross-origin iframe), Terms Lens says so and offers two choices: allow access to that one site and scan it in place, or **Open agreement and scan** in a normal tab. It never asks for access to every site.

### Deeper analysis in ChatGPT or Gemini

After a scan, **Analyze with ChatGPT** and **Analyze with Gemini** copy a ready-made analysis prompt to your clipboard, show "Copied. Paste into ChatGPT to continue.", and then open the service. You paste it yourself.

- The prompt holds the agreement title and address, the Quick Scan findings with exact evidence, the agreement text and instructions not to invent clauses, to quote the exact wording for every claim, and to separate definite findings from uncertainty.
- Prompts up to **40,000 characters** (about 10,000 tokens) are copied directly. Longer agreements are never truncated: a clearly named `.md` file is saved to Downloads, short upload instructions are copied, and the service opens so you can upload the file.
- If copying fails, nothing opens. A selectable copy of the prompt and a **Copy prompt** button appear instead.
- Terms Lens does not log you in, read provider cookies, use API keys, paste for you or send anything itself. Your existing ChatGPT or Gemini session is simply whatever your browser already has.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the page you chose to scan, after you click the toolbar icon on it. |
| `scripting` | Read the agreement text (including inside dialogs and frames) and highlight a finding on the page. |
| `storage` | Keep the latest result in memory for the browser session so the popup can reopen on it. |
| Optional site access | Asked for at click time, for one site only, when Chrome has not already granted access or an agreement is embedded from another site. |

There is no `tabs`, `clipboardWrite`, `downloads`, `cookies` or always-on website access. Copying and saving happen from your click, and opening a tab needs no permission.

## Privacy

Scans run locally and nothing leaves your device unless you paste it into ChatGPT or Gemini yourself. See [PRIVACY.md](PRIVACY.md).

## 2. Developer setup

```bash
npm run check     # syntax-check every script and verify the manifest
npm test          # unit tests: rules, ranking, evidence, dedupe, counts, hand-off, packaging guards
npm run test:e2e  # real Chrome: popup, modal fixtures, hand-off, motion (needs Google Chrome; throwaway profile)
```

```text
extension/        the packaged extension (load or zip this folder)
  popup.*         the popup (HTML, CSS, JS)
  content-script.js   reads the page, dialogs, shadow DOM and frames; locates and highlights wording
  service-worker.js   opens a linked agreement in a tab and scans it
  lib/            Quick Scan rules and analyzer, agreement ranking, view model, hand-off, bundled icons
server/           development-only (section 3)
tests/            unit tests; tests/e2e and tests/fixtures are development only
scripts/          check script, icon generator
```

```text
popup -> content script in every readable frame -> candidates (dialogs, overlays, shadow DOM, frames, page)
      -> rank and choose -> Quick Scan (local) -> view model (evidence, dedupe, counts) -> results
      -> Analyze with ChatGPT / Gemini: build prompt -> copy -> feedback -> open tab
```

The end-to-end test serves controlled fixture pages from a small test-only server and maps them to `fixtures.test` and `other.test`, so the extension itself is still checked for any localhost request.

## 3. Optional development server

`server/` is an experiment harness that can call a hosted model with your own API key. **Normal users never need it, and the packaged extension does not call it.** `extension/` contains no reference to localhost, and a test enforces that. To try it: copy `server/.env.example` to `server/.env`, add a key, and run `npm start`.

## Limitations

- Quick Scan only recognises a fixed list of patterns and may miss clauses that depend on context.
- Text that loads only after you expand or scroll must be visible when you scan; press scan again after opening a section.
- PDFs, pages behind a login that Chrome will not let an extension read, Chrome's own pages and the Chrome Web Store are not supported.
- A closed Shadow DOM cannot be read by any extension.
- Wording can only be highlighted while it is on the page; if the page changes, scan again.

## Third-party software

Icons are from [Lucide](https://lucide.dev) and bundled locally. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Terms Lens provides plain-language guidance. It is not legal advice and does not decide whether a company is trustworthy.
