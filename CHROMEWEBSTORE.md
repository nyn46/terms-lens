# Chrome Web Store Listing - Terms Lens

> Last Updated: 2026-09-13

## Store Listing

**Extension Name**  
Terms Lens

**Short Description**  
Find and explain important clauses in website terms, privacy, refund, and subscription policies.

**Detailed Description**  
Terms Lens helps you review website legal documents before you agree.

It finds terms, privacy, subscription, refund, and EULA links on the current site, extracts readable policy text, explains notable clauses in plain English, and keeps each finding tied to original wording so you can inspect the source.

Open a website, click the Terms Lens toolbar icon, allow temporary access to that site, choose a discovered document or paste a policy URL, then review the findings in the side panel. You can filter findings and open the source page to highlight the supporting wording.

Terms Lens is educational guidance, not legal advice. It does not assign trust scores or decide whether a company is safe to use.

By default, analysis runs through the configured local Terms Lens analyzer. Without an OpenAI API key on that local server, it uses a phrase-based quick scan. If the local server is configured with an OpenAI API key, policy text is sent from the local server to OpenAI for structured analysis with request storage disabled.

**Category**  
Productivity

**Single Purpose**  
Terms Lens finds website legal documents and explains important clauses in plain English with source evidence.

**Primary Language**  
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|------------|--------|----------|
| Store Icon | 128x128 PNG | Not created | |
| Screenshot 1 | 1280x800 or 640x400 | Not created | |
| Screenshot 2 | 1280x800 or 640x400 | Not created | |
| Screenshot 3 | 1280x800 or 640x400 | Not created | |
| Screenshot 4 | 1280x800 or 640x400 | Not created | |
| Screenshot 5 | 1280x800 or 640x400 | Not created | |
| Small Promo Tile | 440x280 | Not created | |
| Marquee Promo Tile | 1400x560 | Not created | |

### Screenshot Notes

Screenshot 1 should show the side panel asking to scan a site. Screenshot 2 should show discovered legal documents on a safe public website. Screenshot 3 should show analysis results with concerns, cautions, and positive clauses. Screenshot 4 should show the source page highlight after selecting a finding.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `scripting` | permissions | Lets Terms Lens read selected policy text from pages the user has chosen to scan and highlight the original wording for a finding. |
| `storage` | permissions | Saves the analyzer URL setting locally so the user does not need to re-enter it every time. |
| `sidePanel` | permissions | Displays the document picker, scan progress, findings, filters, and source actions in Chrome's side panel. |
| `tabs` | permissions | Reads the active tab URL and title so Terms Lens can confirm it is a normal website, request access for the correct site, and label the scanned document. |
| `https://*/*` | optional_host_permissions | Allows Terms Lens to request access only for the specific HTTPS site or policy origin the user chooses to scan, so it can fetch policy text or inspect the selected page. |
| `http://*/*` | optional_host_permissions | Allows Terms Lens to request access only for the specific HTTP site or policy origin the user chooses to scan, for sites that still publish legal documents over HTTP. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|------------|-------------------------|---------|----------------------------|
| Personally identifiable info | No | No | Not collected. | No |
| Health info | No | No | Not collected. | No |
| Financial info | No | No | Not collected. | No |
| Authentication info | No | No | Not collected. | No |
| Personal communications | No | No | Not collected. | No |
| Location | No | No | Not collected. | No |
| Web history | Limited | Yes, to the configured analyzer URL | The active page URL and selected policy URL are sent to the analyzer to label the scan and verify source evidence. | Only if the user configures or runs an analyzer service outside their own device. |
| User activity | Limited | No | The extension stores the analyzer URL setting locally. It does not store scan history. | No |
| Website content | Yes | Yes, to the configured analyzer URL | Policy text from the selected document is sent to the analyzer so Terms Lens can produce findings. | If the analyzer is configured with an OpenAI API key, the analyzer sends policy text to OpenAI with request storage disabled. |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**  
Required before Chrome Web Store submission. The policy must disclose that selected policy text and document URLs are sent to the configured analyzer, and that the analyzer may send policy text to OpenAI when AI analysis is enabled.

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
| 0.1.0 | 2026-09-13 | MVP side-panel scan flow, per-site permission request, local analyzer integration, source highlighting, and Web Store readiness notes. | Draft |

## Review Notes

### Known Issues / Limitations

The analyzer server is separate from the extension and must be running for analysis. Some websites block extension fetches or require login. PDF policies are not yet supported. JavaScript-rendered policies may return incomplete text when fetched directly. Exact quote highlighting can fail when the live page text differs from the fetched document. The quick scan recognizes defined phrase patterns and may miss context-dependent clauses. Terms Lens provides educational guidance and is not legal advice.

### Chrome Web Store Listing Requirements

Before submission, prepare a 128x128 PNG store icon, at least one 1280x800 or 640x400 screenshot, a public privacy policy URL, publisher name, contact email, and support contact. The submission ZIP should exclude `.git`, `node_modules`, `.env`, local logs, and `CHROMEWEBSTORE.md`.
