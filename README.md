# Terms Lens

Terms Lens is a Chrome extension that points out the clauses in a website's terms worth a closer look, and shows the original wording beside each one. It is plain-language guidance, **not legal advice**, and it never gives a trust score.

## 1. Normal-user installation (no setup)

No npm, server, account, API key or environment variable is needed.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `extension` folder of this project.
3. Open a site's Terms, Privacy or Refund page and click the **Terms Lens** toolbar icon (pin it from the puzzle-piece menu if you cannot see it).
4. Press **Scan this page**. Quick Scan results appear immediately.

After switching to another tab, click the Terms Lens icon on that page again; Chrome only lets an extension read a page after you invoke it there.

## 2. What you can do with a result

| Option | What it is | Where the page text goes |
| --- | --- | --- |
| **Quick Scan** (default, always on) | Checks the page for known contract patterns. It may miss clauses that depend on context. It is not an AI and not a legal review. | Stays on your device. It runs inside the extension; no server, account or internet connection is needed. |
| **Private AI Scan** (optional) | Uses Chrome's built-in on-device AI for a more contextual read, shown only when your Chrome supports it. If Chrome's model is not on the device yet, the button says **Download private AI model** and nothing downloads until you click it. | Stays on your device. Every finding must quote wording that really appears on the page, or it is dropped. |
| **Continue in ChatGPT** / **Continue in Gemini** | When you click, Terms Lens copies a ready-made analysis prompt to your clipboard and opens the site. You paste it yourself. If the document is too long to paste, it saves a file in your Downloads folder and copies short upload instructions instead. | Nothing is sent by Terms Lens. Text only reaches ChatGPT or Gemini if **you** paste or upload it. Terms Lens does not read your cookies or signed-in sessions and never asks for an API key. |

If Private AI Scan is unavailable, slow or fails, the Quick Scan result stays on screen, no technical error is shown, and the ChatGPT and Gemini buttons remain available.

Open **Settings** (gear icon) to choose whether Private AI Scan only appears as an option (Automatic) or also starts by itself when Chrome's model is already installed.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the page you chose to scan, after you click the toolbar icon on it. |
| `scripting` | Extract the page text and highlight a finding's wording on the page. |
| `sidePanel` | Show results in Chrome's side panel. |
| `storage` | Remember one Settings choice. |
| Optional site access | Asked for at click time, for one site only, if Chrome has not already granted access, or when you scan a different legal page from the list or by web address. |

There is no `tabs`, `clipboardWrite`, `downloads`, `cookies` or always-on website access. Copying and saving happen from your click, and opening a tab needs no permission.

## Privacy

Short version: scans run locally; nothing leaves your device unless you paste it into ChatGPT or Gemini yourself. See [PRIVACY.md](PRIVACY.md) for the full statement.

## 3. Developer setup

```bash
npm run check     # syntax-check every script and verify the manifest
npm test          # unit tests: rules, evidence, dedupe, counts, providers, hand-off, packaging guards
npm run test:e2e  # real-Chrome test of the side panel (needs Google Chrome; uses a throwaway profile)
```

Layout:

```text
extension/        the packaged extension (this folder is what you load or zip)
  lib/            analyzer, evidence checks, view model, hand-off, providers
server/           development-only, see section 4
tests/            unit tests and tests/e2e (development only)
scripts/          check script
```

```text
side panel --SCAN_TAB--> service worker --activeTab--> content script (page text)
side panel: sanitize -> Quick Scan (local rules) -> view model (evidence + dedupe + counts) -> results
            -> optional provider: Chrome on-device AI -> validate -> same view model
            -> hand-off: build prompt -> clipboard (or file) -> open ChatGPT / Gemini on click
```

The on-device model runs in the side panel (an extension document), never in the service worker. `extension/lib/providers/` holds the provider interface (`id`, `label`, `availability()`, `analyze(document)`).

## 4. Optional development server

`server/` is an experiment harness that can call a hosted model with your own API key. **Normal users never need it, and the packaged extension does not call it.** `extension/` contains no reference to localhost, and a test enforces that. To try it: copy `server/.env.example` to `server/.env`, add a key, and run `npm start`.

## Limitations

- Quick Scan only recognises a fixed list of patterns.
- Text that a site renders very late, pages behind a login, and PDFs are not supported yet. Chrome's own pages and the Chrome Web Store cannot be read by any extension.
- Private AI Scan needs a supported device and Chrome's downloaded model, and a small model can misread context.
- Exact-wording highlighting can fail if the live page differs from the text that was scanned.

Terms Lens provides plain-language guidance. It is not legal advice and does not decide whether a company is trustworthy.
