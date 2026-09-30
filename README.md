# Terms Lens

Terms Lens is a Chrome extension that points out the clauses in a website's terms worth a closer look, and shows the original wording beside each one. It does **not** give a trust score or legal advice.

## Install and use (no setup)

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the `extension` folder.
2. Open a site's Terms, Privacy or Refund page and click the **Terms Lens** toolbar icon.
3. Press **Scan this page**. Results appear immediately.

No npm, server, account or API key is needed.

## Scan modes

| Mode | What it is | Where page text goes |
| --- | --- | --- |
| **Quick Scan** (always on) | Checks the page for known phrase patterns. It is not an AI or legal review and may miss clauses that depend on context. | Never leaves your device. Runs inside the extension. |
| **Private AI Scan** (optional) | Uses Chrome's built-in on-device model (the Prompt API) for a contextual read. Shown only when Chrome supports it. If the model is not yet on the device, Chrome downloads it **only after you click** a download button. | Stays on your device. Output is validated and every finding must quote wording that really appears on the page. |
| Terms Lens Cloud | *Coming later.* Would send page text to a hosted Terms Lens API. | Not available; nothing is sent today. |
| Your own provider key | *Coming later.* | Not available; nothing is sent today. |

If Private AI Scan is unsupported or fails, Quick Scan results stay on screen and no technical error is shown. Choose how deeper scans behave under the gear icon (Settings).

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the page you chose to scan, only after you click the toolbar icon on it. |
| `scripting` | Extract the page's text and highlight a finding's wording on the page. |
| `sidePanel` | Show results in Chrome's side panel. |
| `storage` | Remember your Settings choice. |
| Optional site access | Requested at click time, for one site only, when you scan a *different* legal page from the results list or by URL. |

There is no `tabs` permission and no always-on access to websites.

## Privacy

- Quick Scan and Private AI Scan process page text locally. The extension makes no network requests for analysis.
- Fetching another legal page (only when you click it) downloads that page without your cookies.
- Scan results are not stored. Only your Settings choice is saved, in local Chrome storage.
- The extension contains no API keys and does not use your Google, Gemini or other website sessions.
- A future cloud mode would be opt-in, labelled, and would be the only case where page text leaves your device. This document and the store listing will be updated before it ships.

## Architecture

```text
side panel --SCAN_TAB--> service worker --activeTab--> content script (page text)
side panel: sanitize -> Quick Scan (local rules) -> results
                     -> optional provider (Chrome on-device AI) -> validate -> results
```

`extension/lib/providers/` defines the provider interface (`id`, `label`, `availability()`, `analyze(document)`). A hosted API or bring-your-own-key provider can be added there without touching the UI. `future.js` holds non-functional placeholders.

## Development

```bash
npm run check   # syntax-check every script and verify the manifest
npm test        # rules, evidence, counts, dedup, provider fallback, packaging guards
```

`server/` is an optional **development-only** analyzer (OpenAI-backed chunk analysis) kept for experiments. The packaged extension does not call it, and `extension/` contains no reference to localhost. `npm start` runs it on `127.0.0.1:8787` if you want to experiment.

## Limitations

- Quick Scan only recognises a fixed list of phrases.
- Some pages render text late or block extraction; PDFs are not supported yet.
- Private AI Scan depends on Chrome's on-device model being supported and downloaded, and a small model can misread context.
- After you switch tabs, click the Terms Lens icon on the new page so Chrome grants access to it.

Terms Lens provides plain-language educational guidance. It is not legal advice and does not decide whether a company is trustworthy.
