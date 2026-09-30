# Third-party notices

## Lucide icons

The interface icons are taken from [Lucide](https://lucide.dev) (`lucide-static` v1.49.0) and are bundled locally in
[`extension/lib/icons.js`](extension/lib/icons.js). Nothing is loaded from a CDN. The toolbar icon is also drawn from
Lucide's `shield-check`.

Lucide is licensed under the **ISC License**. Icons that Lucide derived from the Feather project are under the
**MIT License**; Terms Lens uses several of them (for example `check`, `chevron-down`, `crosshair` and
`external-link`). Both licences therefore apply, exactly as stated in the full text reproduced unchanged in
[`extension/vendor/LUCIDE-LICENSE.txt`](extension/vendor/LUCIDE-LICENSE.txt).

Copyright (c) 2026 Lucide Icons and Contributors. Feather icons: Copyright (c) 2013-2023 Cole Bemis.

To regenerate the bundled icon module: `npm pack lucide-static`, extract it, and run
`node scripts/build-icons.mjs <path-to-extracted-folder> extension/lib/icons.js`.

## Design

The interface is inspired by the restrained, compact style of modern developer tools. It does not use any third-party
branding, fonts or proprietary assets.
