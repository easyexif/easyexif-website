# EasyEXIF website

Static site (no build step, no dependencies) with browser-based photo metadata tools that drive traffic to the EasyEXIF Chrome extension.

- `index.html`: EXIF viewer (privacy check, search, JSON export)
- `edit.html`, `remove.html`, `copy.html`, `extract.html`: the other tools
- `js/exif-core.js`: the EXIF/XMP/IPTC reader and JPEG/PNG/WebP writer. Everything runs client-side.
- `js/site.js`: shared header, footer, extension promo, and the **`EXTENSION_URL`** constant. Leave it empty to show "coming soon" buttons; set it to the Chrome Web Store listing once published.

Preview locally: `python3 -m http.server 8765` in this folder, then open http://localhost:8765.
Deploy: upload the folder to any static host (Cloudflare Pages, Netlify, GitHub Pages).
Fonts in `fonts/` are Instrument Sans and IBM Plex Mono (SIL OFL), copied from the extension.
