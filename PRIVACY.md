# Terms Lens Privacy Statement

Last updated: 2026-09-30. Applies to extension version 0.2.0.

Terms Lens is designed so that the text of the pages you scan stays on your device.

## What happens to page text

- **Quick Scan** runs entirely inside the extension. No page text, address or result is sent anywhere.
- **Private AI Scan** uses Chrome's built-in on-device AI. The text is processed on your device by Chrome's own model.
  If the model is not installed, Chrome downloads it only after you click **Download private AI model**. That download is performed by Chrome, not by Terms Lens, and contains no page text.
- **Continue in ChatGPT / Continue in Gemini** copies a prompt (the page title, address, Quick Scan findings and the page text) to your clipboard **only when you click**, then opens chatgpt.com or gemini.google.com in a new tab. If the text is long, it saves a file to your Downloads folder instead. Terms Lens sends nothing to those services. The text reaches them only if you paste or upload it yourself, and from then on it is governed by that service's own terms and privacy policy. Your clipboard contents can be read by other software on your device until you copy something else.
- **Scanning another page** (only when you click a listed legal page or enter a web address) downloads that page directly from its site, without your cookies, after Chrome asks for permission for that one site.

## What Terms Lens stores

Only one Settings choice (Automatic or Chrome on-device AI), in Chrome's local extension storage. Scan results, page text and addresses are not stored and are discarded when the panel resets or closes.

## What Terms Lens does not do

- It has no account, sign-in, analytics or tracking, and contacts no Terms Lens server.
- It never asks for, stores or ships an API key.
- It does not read cookies, signed-in sessions, passwords or account data for Google, OpenAI or any other site, and does not paste into ChatGPT or Gemini for you.
- It does not sell or share data.

## Permissions

`activeTab`, `scripting`, `sidePanel`, `storage`, plus optional access to one site at a time when you choose to scan it. See the README for what each one is used for.

## Changes

If a future version sends page text to any service, it will be opt-in, clearly labelled, and this statement and the store listing will be updated before release.

Terms Lens provides plain-language guidance and is not legal advice.
