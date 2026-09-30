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

Quick Scan runs entirely on your device. No account, no sign-in and no API key is needed, and the page text is never sent anywhere. Quick Scan is not an AI or legal review and may miss clauses that depend on context.

If your version of Chrome supports its built-in on-device AI, Terms Lens can also offer an optional Private AI Scan for a more contextual read. It also runs on your device. If Chrome's model has not been downloaded yet, it is downloaded only after you click a download button.

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

Screenshot 1: the "Scan this page" start screen. Screenshot 2: Quick Scan results on a public terms page with concerns, cautions and good clauses. Screenshot 3: the optional Private AI Scan offer and its result. Screenshot 4 (optional): a finding highlighted on the page.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Lets Terms Lens read the text of the page the user is on, only after the user clicks the toolbar icon on that page. |
| `scripting` | permissions | Injects the content script that extracts readable page text and highlights a finding's original wording. Used only on the page the user chose to scan. |
| `sidePanel` | permissions | Shows the scan button, results, filters and optional Private AI Scan in Chrome's side panel. |
| `storage` | permissions | Saves the user's Settings choice (automatic or Chrome on-device AI) locally. |
| `https://*/*`, `http://*/*` | optional_host_permissions | Requested at click time, for a single origin, only when the user scans a different legal page from the results list or by URL. The page is fetched without cookies. Never requested at install. |

The extension does not use `tabs`, `history`, `cookies`, `webRequest` or broad `host_permissions`.

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

The one network request the extension can make is fetching a different legal page the user explicitly clicks, directly from that site, without cookies. Private AI Scan may trigger Chrome to download its own on-device model; that download is performed by Chrome, only after the user clicks.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

### Future Cloud Mode (not shipped)

"Terms Lens Cloud" and "Use my own provider key" appear in Settings as **coming later** and are disabled. No code path sends page text anywhere today. If a hosted or bring-your-own-key mode ships, it must be opt-in and labelled, would transmit the page text of scanned pages to the named service, and this listing, the privacy policy and the Data Handling answers above must be updated (and Chrome Web Store review re-done) before release. The extension must never contain an owner API key.

## Privacy Policy

**Privacy Policy URL**  
Required before submission. It should state: (1) Quick Scan and Private AI Scan run locally and page text is not transmitted; (2) results are not stored; (3) only a Settings preference is stored locally; (4) fetching another legal page the user clicks contacts that site directly without cookies; (5) Chrome, not Terms Lens, downloads and runs its on-device model; (6) any future cloud mode is opt-in and will transmit page text to the named provider.

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
| 0.2.0 | 2026-09-30 | Zero-setup Quick Scan inside the extension, optional Chrome on-device Private AI Scan, Settings page, provider interface for future modes, `activeTab` replaces `tabs`, localhost dependency removed. | Draft |

## Review Notes

### Known Issues / Limitations

Quick Scan recognises fixed phrase patterns and may miss context-dependent clauses; it is not an AI or legal review. Private AI Scan needs Chrome's Prompt API, a supported device and a downloaded model, and a small model can misread context. After switching tabs the user must click the toolbar icon on the new page before scanning it. PDF policies and text rendered very late are not yet supported. Terms Lens provides educational guidance and is not legal advice.

### Packaging

Upload only the contents of the `extension/` folder as the ZIP root. `server/`, `tests/`, `scripts/`, `.git`, `node_modules`, `.env` files and this document are development material and must not be included. The `extension/` folder contains no reference to localhost.
