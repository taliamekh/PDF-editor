# PDF Text Studio

A browser-local, PDF-only text editor built using BentoPDF's PDFium WebAssembly package and engine wrapper. Open a PDF, click an existing text object, edit its content and download the edited PDF. The original document is never uploaded or overwritten.

## Preservation

Text replacement mutates the existing PDFium text object. It preserves the original font resource, font size, text matrix, paint colours and rendering mode. Prefix and suffix character positions are retained, while replacement characters use the original font's glyph widths and observed tracking. The engine exports and reopens each proposed edit, verifies font data using SHA-256, verifies size and formatting, checks nearby text collisions and compares rendered pixels outside the edited region. An unsuccessful check rolls the edit back.

There is no font substitution, whiteout rectangle, page rasterization, automatic shrinking or paid API. Download applies a pending draft first, then returns the last verified PDF. Undo retains up to 15 document revisions in memory.

## Current scope

- Visible text objects directly on a PDF page, including rotated text and mixed-font pages.
- One text object / line per edit. Longer text can grow into free space while keeping its size; collisions and page overflow are rejected.
- Missing or unencodable glyphs, procedural fonts, complex scripts, invisible OCR layers and text inside Form XObjects are not supported by this version.
- Password-protected PDFs need to be decrypted before opening. Signed documents are rejected.
- Uploaded documents are limited to 100 MB. Processing happens in a Web Worker.
- The checks enforce the supported paths, but cannot establish universal fidelity for every possible PDF. Visual inspection of the final document remains useful.

## Run locally

Use Node.js 22 or later and pnpm:

```
pnpm install
pnpm dev
pnpm build
```

The deployed app is static: serve `dist/` over HTTPS. The font engine is bundled locally and no external CDN is used.

## Validation

`scripts/create-fixtures.py` creates a two-page local test PDF using ReportLab and an installed Arial font. `node scripts/verify-engine.mjs` exercises embedded-font edits, font/size verification, rotated text, coloured backgrounds, missing glyphs, overflow, rollback, page preservation, deletion and undo. The browser download was independently checked with pypdf, pdfplumber and Poppler.

## Source and licensing

Licensed under AGPL-3.0-only; see `LICENSE`. BentoPDF source and its bundled engine are retained for reproducibility. Downloadable corresponding application source is included at `/source.zip`.

BentoPDF upstream: https://github.com/alam00000/bentopdf

Pinned upstream commit: `46bf0fbb576ae664ed65b38d3ec4b4da5cb0d240`.

Bundled engine: `bentopdf-pdfium-813903c93c75.tgz` (unmodified). The vendored JS wrapper was changed only to use a colocated WebAssembly asset and an explicit `.js` utility import. The UI and strict text-edit adapter are original code.

The hosting service may require owner sign-in to access a privately published site. PDF processing itself has no app account, payment or subscription requirement.
