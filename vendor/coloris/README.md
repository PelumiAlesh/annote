# Vendored Coloris v0.25.0

Source: https://github.com/mdbassit/Coloris (MIT © Momo Bassit)
Pinned files, downloaded 2026-09-03:

- `coloris.min.js` (14,295 bytes) from `https://cdn.jsdelivr.net/gh/mdbassit/Coloris@v0.25.0/dist/coloris.min.js`
- `coloris.min.css` (8,506 bytes) from `https://cdn.jsdelivr.net/gh/mdbassit/Coloris@v0.25.0/dist/coloris.min.css`

Subresource Integrity (sha384):

- js: `sha384-olpkBKjEFqOOAAUzqL1y4xnKDCVmmXNaoRDWmHnRTutomMnUySX9hqDgVQVcvMdc`
- css: `sha384-DY3umZptOgjUNshBFbvu1+3RVFPoD1/CgGcc1yyJ77/aFOJ7jtN4BORnz/D/xF0n`

Purpose: frozen audit copy of the exact bytes Annote loads at runtime.
`src/annotator.ts` pins the same versioned CDN URLs and enforces these
hashes via `integrity` + `crossorigin="anonymous"`, so a compromised or
changed CDN payload fails closed (color text editing still works).
Full bundling (zero network) is a deferred follow-up; see docs.
