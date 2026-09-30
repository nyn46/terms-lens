# Chrome Web Store Listing - Terms Lens

> Last Updated: 2026-10-01

## Store Listing

**Extension Name**  
Terms Lens

**Short Description**  
Spot the clauses worth a closer look in terms pages and signup popups. Scans run on your device.

**Detailed Description**  
Terms Lens helps you understand an agreement before you accept it.

Open a terms page, or the terms popup in a signup or checkout flow, click the Terms Lens icon and press "Scan this agreement". Terms Lens reads the agreement that is visible, checks it for known contract patterns, and explains each match in plain English next to the original wording. Filter by concerns, things worth knowing and good clauses, and jump to the exact wording on the page.

It never clicks "Accept", ticks a box or submits a form, and it ignores cookie banners and newsletter popups.

Quick Scan runs entirely on your device. No account, no sign-in, no API key, and the agreement text is not sent anywhere. It checks for known contract patterns and may miss clauses that depend on context.

For a deeper review, choose "Analyze with ChatGPT" or "Analyze with Gemini". Terms Lens copies a ready-made analysis prompt to your clipboard when you click, then opens the service so you can paste it yourself. Very long agreements are saved as a file with short upload instructions instead. Terms Lens sends nothing to those services, does not log you in and never asks for an API key.

Terms Lens is plain-language guidance, not legal advice. It does not score or rate companies.

**Category**  
Productivity

**Single Purpose**  
Terms Lens reads the agreement the user chooses to scan and highlights important clauses in plain English with the original wording.

**Primary Language**  
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|------------|--------|----------|
| Extension icons | 16, 32, 48, 128 PNG | Created | `extension/icons/` |
| Screenshot 1 | 1280x800 or 640x400 | Not created | |
| Screenshot 2 | 1280x800 or 640x400 | Not created | |
| Screenshot 3 | 1280x800 or 640x400 | Not created | |
| Small Promo Tile | 440x280 | Not created | |
| Marquee Promo Tile | 1400x560 | Not created | |

### Screenshot Notes

Screenshot 1: the start screen on a public terms page. Screenshot 2: Quick Scan results for an agreement shown in a signup popup (use a demo page, not a real company's). Screenshot 3: the "Want a deeper analysis?" section with the "Copied. Paste into ChatGPT to continue." message. Screenshot 4 (optional): a finding highlighted inside the popup.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Lets Terms Lens read the page the user is on, only after the user clicks the toolbar icon on it. |
| `scripting` | permissions | Runs the reader that extracts the visible agreement text (including inside dialogs, shadow DOM and frames) and highlights a finding's original wording. Used only on the page the user chose to scan. |
| `storage` | permissions | Keeps the latest scan result for each open tab in session storage (memory only) so the popup can reopen on it. Cleared when the tab or browser closes. |
| `https://*/*`, `http://*/*` | optional_host_permissions | Requested at click time, for a single origin, only when Chrome has not already granted access to the page or when an agreement is embedded from, or linked on, another site and the user chooses to scan it. Never requested at install. |

The extension does not use `tabs`, `history`, `cookies`, `webRequest`, `clipboardWrite`, `downloads` or broad `host_permissions`. Copying the prompt and saving a file happen from the user's click in the extension's own popup, and opening ChatGPT or Gemini in a new tab needs no permission.

## Privacy & Data Use

### Data Handling

Quick Scan processes the visible agreement text locally in the popup. The extension sends no text, addresses or usage data to the developer or any third party, makes no analytics calls, loads no remote code, fonts or icons, and contains no API keys. It does not read cookies, passwords, form entries or sign-in sessions. The latest result per tab is kept in memory only (session storage); nothing is written to persistent storage.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|------------|-------------------------|---------|----------------------------|
| Personally identifiable info | No | No | Not collected. | No |
| Health info | No | No | Not collected. | No |
| Financial info | No | No | Not collected. | No |
| Authentication info | No | No | Not collected. | No |
| Personal communications | No | No | Not collected. | No |
| Location | No | No | Not collected. | No |
| Web history | No | No | The page address is used in memory to label and restore a scan; it is not stored persistently or sent. | No |
| User activity | No | No | Not collected. | No |
| Website content | Processed locally only | No | The visible agreement text is analysed on the device to produce findings. | No |

"Analyze with ChatGPT" and "Analyze with Gemini" copy text to the user's clipboard (or save a file in Downloads) only after a click, and then open chatgpt.com or gemini.google.com in a new tab. The extension does not transmit the text, does not paste it into those sites, and does not read those sites' cookies or sessions. The text reaches those services only if the user pastes or uploads it. Scanning a linked or embedded agreement ("Open agreement and scan") opens that page in a normal tab after Chrome asks for permission for that single site.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**  
Required before submission. Publish the contents of `PRIVACY.md` at a public URL. It states that scans run locally, results are held in memory only, nothing is sent to Terms Lens or any third party, the hand-off buttons only copy text to the clipboard or save a file after a click, and the text reaches ChatGPT or Gemini only if the user pastes or uploads it.

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
| 0.2.0 | 2026-09-30 | Zero-setup Quick Scan, side panel, ChatGPT/Gemini hand-off. | Superseded |
| 0.3.0 | 2026-10-01 | New compact popup design; scans agreements shown in signup dialogs, overlays, shadow DOM and frames; cross-origin embedded agreements handled honestly; simplified "Analyze with ChatGPT / Gemini" hand-off with copy fallback; built-in browser AI removed; `sidePanel` permission removed. | Draft |

## Review Notes

### Known Issues / Limitations

Quick Scan recognises fixed contract patterns and may miss clauses that depend on context. The agreement must be visible when the user presses scan; pages behind a login that Chrome will not let an extension read, PDFs, closed Shadow DOM, Chrome's own pages and the Chrome Web Store are not supported. An agreement embedded from another website needs permission for that one site, or can be opened on its own. Terms Lens provides educational guidance and is not legal advice.

### Packaging

Upload only the contents of the `extension/` folder as the ZIP root. `server/`, `tests/` (including the fixtures and the real-Chrome test), `scripts/`, `.git`, `node_modules`, `.env` files and this document are development material and must not be included. The `extension/` folder contains no reference to localhost.
