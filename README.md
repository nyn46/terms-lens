# Terms Lens

Terms Lens is an evidence-first Chrome extension that finds website legal documents, explains important clauses in plain English, and lets the user open the original wording.

It deliberately does **not** assign a website trust score or claim to provide legal advice.

## What works in this MVP

- Finds Terms, Privacy, Subscription, Refund and EULA links on the current website
- Lets the user paste a policy URL when discovery fails
- Extracts readable policy paragraphs and preserves traceable block IDs
- Runs immediately with a transparent phrase-based quick scan
- Upgrades to structured AI analysis when `OPENAI_API_KEY` is configured
- Rejects AI findings whose quoted evidence cannot be matched to the source block
- Filters findings into concerns, worth knowing and user-friendly clauses
- Opens the original policy and attempts to highlight the supporting wording

## 1. Requirements

- Node.js 20 or newer
- Google Chrome 114 or newer
- Optional: an OpenAI API key for AI analysis

## 2. Start the analyzer

From this directory:

```bash
npm start
```

The server starts at `http://127.0.0.1:8787`. Without an API key it uses the built-in quick scan, so the project is usable immediately.

For structured AI analysis:

```bash
export OPENAI_API_KEY="your_api_key"
export OPENAI_MODEL="gpt-5-mini"
npm start
```

Use any text model available to your OpenAI API project that supports Structured Outputs. The API key stays on the server and is never stored in the Chrome extension.

## 3. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `extension` directory inside this project.
5. Open a normal website and click the Terms Lens toolbar icon.

## 4. Use it

1. Select a discovered legal document or paste its URL.
2. Approve temporary access to that website when Chrome asks.
3. Review the evidence-backed findings in the side panel.
4. Click **Open and highlight source** to inspect the original wording.

## Commands

```bash
npm test
npm run check
npm start
```

## Privacy defaults

- Scanning begins only after a user opens the extension and chooses a document.
- The extension requests access to the selected policy origin at runtime.
- Page credentials are omitted when fetching a policy URL.
- Policy text is not stored by this server.
- OpenAI Responses requests set `store: false`.
- The production server should restrict CORS to the published extension ID.

## Current limitations

- Some websites block extension fetches or require login.
- PDF policies are not yet supported.
- JavaScript-rendered policies may return incomplete HTML when fetched.
- Exact quote highlighting can fail when the live page text differs from the fetched document.
- The quick scan only recognizes defined phrase patterns.
- AI analysis is educational and can still misunderstand legal context.

## Recommended next improvements

1. Add a fallback that opens blocked policies in a tab and extracts the rendered DOM.
2. Add PDF extraction.
3. Add jurisdiction and user-context settings.
4. Build a reviewed policy benchmark and track precision, recall and quote accuracy.
5. Add encrypted, opt-in scan history.
6. Deploy the server and restrict allowed extension origins.

## Architecture

```text
Website -> link discovery -> policy fetch -> block extraction
        -> local analyzer server -> evidence verification -> side panel
        -> original policy source highlighting
```

## Important disclaimer

Terms Lens provides plain-language educational guidance. It is not legal advice and does not determine whether a company or website is trustworthy.
