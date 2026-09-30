# Terms Lens Privacy Statement

Last updated: 2026-10-01. Applies to extension version 0.3.0.

Terms Lens is designed so that the text you scan stays on your device.

## What happens to the agreement text

- **Quick Scan** runs entirely inside the extension. The text, page address and results are not sent anywhere.
- **Analyze with ChatGPT / Analyze with Gemini** copies a prompt (the agreement title and address, the Quick Scan findings and the agreement text) to your clipboard **only when you click**, shows a confirmation, and then opens chatgpt.com or gemini.google.com in a new tab. If the text is very long, it saves a file to your Downloads folder instead and copies short upload instructions. Terms Lens sends nothing to those services. The text reaches them only if you paste or upload it yourself, and from then on it is governed by that service's own terms and privacy policy. Other software on your device can read the clipboard until you copy something else.
- **Open agreement and scan**, or scanning a linked page, opens that page in a normal tab after Chrome asks for permission for that one site. Terms Lens then reads it on your device.

## What Terms Lens reads

Only what is visible on the page you chose to scan, at the moment you press the button: dialogs, overlays and frames included. It never clicks, ticks a box, accepts terms or submits a form, and never reads passwords, form entries or cookies.

## What Terms Lens stores

The latest scan result for each open tab is kept **in memory only** (Chrome's session storage) so the popup can reopen on it. It is cleared when that tab closes or the browser closes, and it never leaves your device. Nothing is written to persistent storage.

## What Terms Lens does not do

- It has no account, sign-in, analytics or tracking, and contacts no Terms Lens server.
- It never asks for, stores or ships an API key.
- It does not read cookies, signed-in sessions or account data for Google, OpenAI or any other site, does not log you in, and does not paste into ChatGPT or Gemini for you.
- It does not sell or share data.

## Permissions

`activeTab`, `scripting`, `storage`, plus optional access to a single site at a time when you choose to scan it. See the README for what each is used for.

## Changes

If a future version sends page text to any service, it will be opt-in, clearly labelled, and this statement and the store listing will be updated first.

Terms Lens provides plain-language guidance and is not legal advice.
