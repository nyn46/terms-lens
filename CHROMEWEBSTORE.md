# Chrome Web Store Listing - Terms Lens

> Last Updated: 2026-09-30

## Store Listing

**Extension Name**  
Terms Lens

**Short Description**  
Spot the clauses worth a closer look in a site's terms and privacy pages. Scans run on your device.

**Detailed Description**  
Terms Lens helps you review a website's legal terms before you agree.

Open a Terms, Privacy, Subscription or Refund page, click the Terms Lens icon, and press "Scan this page". Quick Scan checks the page for known phrase patterns and explains each match in plain English beside the original wording, so you can judge it yourself. You can filter by concerns, things worth knowing and user-friendly clauses, and jump to the wording on the page.

Quick Scan runs entirely on your device. No account, no sign-in and no API key is needed, and the page text is never sent anywhere. Quick Scan checks the page for known contract patterns and may miss clauses that depend on context.

If your version of Chrome supports its built-in on-device AI, Terms Lens can also offer an optional Private AI Scan for a more contextual read. It also runs on your device. If Chrome's model has not been downloaded yet, it is downloaded only after you click a download button.

For a deeper review you can choose "Continue in ChatGPT" or "Continue in Gemini". Terms Lens copies a ready-made analysis prompt to your clipboard when you click, then opens the site so you can paste it yourself. If the document is too long to paste, it saves a file and copies upload instructions instead. Terms Lens sends nothing to those services and never asks for an API key or reads your sign-in sessions.

Terms Lens is educational guidance, not legal advice. It does not assign trust scores or decide whether a company is safe to use.

**Category**  
Productivity

**Single Purpose**  
Terms Lens reads the website legal page you choose and highlights important clauses in plain English with the original wording.

**Primary Language**  
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|------------|--------|----------|
| Store Icon | 128x128 PNG | Not created | |
| Screenshot 1 | 1280x800 or 640x400 | Not created | |
| Screenshot 2 | 1280x800 or 640x400 | Not created | |
| Screenshot 3 | 1280x800 or 640x400 | Not created | |
| Small Promo Tile | 440x280 | Not created | |
| Marquee Promo Tile | 1400x560 | Not created | |

### Screenshot Notes

Screenshot 1: the "Scan this page" start screen. Screenshot 2: Quick Scan results on a public terms page with concerns, cautions and good clauses. Screenshot 3: the optional Private AI Scan offer and its result. Screenshot 4: the Continue in ChatGPT / Gemini buttons with the "Prompt copied" message. Screenshot 5 (optional): a finding highlighted on the page.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Lets Terms Lens read the text of the page the user is on, only after the user clicks the toolbar icon on that page. |
| `scripting` | permissions | Injects the content script that extracts readable page text and highlights a finding's original wording. Used only on the page the user chose to scan. |
| `sidePanel` | permissions | Shows the scan button, results, filters and optional Private AI Scan in Chrome's side panel. |
| `storage` | permissions | Saves the user's Settings choice (automatic or Chrome on-device AI) locally. |
| `https://*/*`, `http://*/*` | optional_host_permissions | Requested at click time, for a single origin, only if Chrome has not already granted access to the page the user is scanning, or when the user scans a different legal page from the results list or by URL. Fetched pages are requested without cookies. Never requested at install. |

The extension does not use `tabs`, `history`, `cookies`, `webRequest`, `clipboardWrite`, `downloads` or broad `host_permissions`. Copying the prompt and saving a file happen from the user's click in the extension's own page, and opening ChatGPT or Gemini in a new tab needs no permission.

## Privacy & Data Use

### Data Handling

Quick Scan and Private AI Scan process page text locally in the side panel. The extension sends no page text, URLs or usage data to the developer or any third party, makes no analytics calls, and contains no API keys. It does not read a user's Google, Gemini or other website sign-in sessions. Scan results are not stored. Only the Settings choice is stored, locally.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|------------|-------------------------|---------|----------------------------|
| Personally identifiable info | No | No | Not collected. | No |
| Health info | No | No | Not collected. | No |
| Financial info | No | No | Not collected. | No |
| Authentication info | No | No | Not collected. | No |
| Personal communications | No | No | Not collected. | No |
| Location | No | No | Not collected. | No |
| Web history | No | No | The page URL is used in memory to label the scan; it is not stored or sent. | No |
| User activity | No | No | Not collected. | No |
| Website content | Processed locally only | No | Page text is analysed on the device to produce findings. Not stored, not transmitted. | No |

The extension makes one kind of network request: fetching a different legal page the user explicitly clicks, directly from that site, without cookies. Private AI Scan may trigger Chrome to download its own on-device model; that download is performed by Chrome, only after the user clicks. "Continue in ChatGPT" and "Continue in Gemini" copy text to the user's clipboard (or save a file in Downloads) only after a click and open chatgpt.com or gemini.google.com in a new tab; the extension does not transmit the text, does not paste it into those sites and does not read those sites' cookies or sessions. The text reaches those services only if the user pastes or uploads it.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**  
Required before submission. It should state: (1) Quick Scan and Private AI Scan run locally and page text is not transmitted; (2) results are not stored; (3) only a Settings preference is stored locally; (4) fetching another legal page the user clicks contacts that site directly without cookies; (5) Chrome, not Terms Lens, downloads and runs its on-device model; (6) "Continue in ChatGPT/Gemini" only copies text to the clipboard or saves a file after a click, and the text reaches those services only if the user pastes or uploads it. Publish PRIVACY.md (or equivalent text) at a public URL.

## Distribution

**Visibility**: Unlisted during review, then Public when ready  
**Regions**: All regions

## Developer Info

**Publisher Name**  
Required before submission.

**Contact Email**  
Required before submission.

**Support URL / Email**  
Required before submission.

**Homepage URL**  
Recommended before submission.

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-09-13 | MVP with local analyzer server. | Superseded |
| 0.2.0 | 2026-09-30 | Zero-setup Quick Scan inside the extension, optional Chrome on-device Private AI Scan, Continue in ChatGPT / Gemini via clipboard or file, Settings page, `activeTab` replaces `tabs`, localhost dependency removed, stricter evidence and de-duplication. | Draft |

## Review Notes

### Known Issues / Limitations

Quick Scan recognises fixed contract patterns and may miss context-dependent clauses. Private AI Scan needs Chrome's Prompt API, a supported device and a downloaded model, and a small model can misread context. After switching tabs the user must click the toolbar icon on the new page before scanning it. PDF policies and text rendered very late are not yet supported. Terms Lens provides educational guidance and is not legal advice.

### Packaging

Upload only the contents of the `extension/` folder as the ZIP root. `server/`, `tests/` (including the real-Chrome test), `scripts/`, `.git`, `node_modules`, `.env` files and this document are development material and must not be included. The `extension/` folder contains no reference to localhost.
