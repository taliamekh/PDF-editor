# PDF Text Studio

A browser-local, PDF-only text editor built using BentoPDF's PDFium WebAssembly package and engine wrapper. Click text and delete or type directly at its position on the page. Enter saves, Escape cancels, and Download saves a pending edit before exporting. The original document is never uploaded or overwritten.

## Preservation

Text replacement mutates the existing PDFium text object. It preserves the original font resource, font size, text matrix, paint colours and rendering mode. Prefix and suffix character positions are retained, while replacement characters use the original font's glyph widths and observed tracking. The engine exports and reopens each proposed edit, verifies font data using SHA-256, verifies size and formatting, checks nearby text collisions and compares rendered pixels outside the edited region. An unsuccessful check rolls the edit back.

The original-text mode never substitutes a font or shrinks text to fit. There are no whiteout rectangles, page rasterization or paid APIs. Undo retains up to 15 document revisions in memory.

## Outlined lettering

Some PDFs store every letter as a vector drawing, without any text or original font information. For these pages, bundled Tesseract.js performs English OCR locally. The editor compares the recognized lettering against PDFium's standard font families and estimates a matching size. The toolbar labels these edits as approximate, and the recognized words should be checked.

Selecting a recognized line opens the same on-page caret. Saving removes its original filled letter paths, inserts real PDF text with the matched font, reopens the export, checks the replacement, and verifies that pixels outside the edited region did not change. Existing backgrounds and rules remain in place. Lines that cannot be isolated safely are rejected. Genuine text on mixed pages still uses the original-text mode.

## Current scope

- Visible text objects directly on a PDF page, including rotated text and mixed-font pages.
- Outlined text made from filled paths directly on a page, using approximate matching. Image-based scans, strokes-only lettering and nested outlined text are not supported.
- One text object / line per edit. Longer text can grow into free space while keeping its size; collisions and page overflow are rejected.
- Missing or unencodable glyphs, procedural fonts, complex scripts, invisible OCR layers and text inside Form XObjects are not supported by this version.
- Password-protected PDFs need to be decrypted before opening. Signed documents are rejected.
- Uploaded documents are limited to 100 MB. Processing happens in a Web Worker.
- The checks enforce the supported paths, but cannot establish universal fidelity for every possible PDF. Visual inspection of the final document remains useful.

## Run locally

Use Node.js 22 or later and pnpm:

```
pnpm install
node scripts/setup-ocr.mjs
pnpm dev
pnpm build
```

The deployed app is static: serve `dist/` over HTTPS. The font engine, OCR worker, OCR cores and English recognition model are bundled locally. The setup script fetches the model during development; PDF processing makes no external CDN or upload requests. pnpm intentionally disables Tesseract's optional sponsorship postinstall script.

## Validation

`scripts/create-fixtures.py` creates a two-page local test PDF using ReportLab and an installed Arial font. `node scripts/verify-engine.mjs` exercises embedded-font edits, font/size verification, rotated text, coloured backgrounds, missing glyphs, overflow, rollback, page preservation, deletion and undo. The browser download was independently checked with pypdf, pdfplumber and Poppler.

`scripts/create-outlined-fixture.py` uses ReportLab and FontTools to create synthetic vector lettering. Render it to `test-output/outlined-fixture.png` at 216 DPI, then run `node scripts/verify-outlined.mjs` to check recognition, font matching, path removal, repeated edits, surrounding pixel preservation, undo, and reopening mixed text/outline PDFs. Browser QA also checks an active caret, keyboard deletion/typing, and downloading a pending edit.

## Source and licensing

Licensed under AGPL-3.0-only; see `LICENSE`. BentoPDF source and its bundled engine are retained for reproducibility. Downloadable corresponding application source is included at `/source.zip`.

BentoPDF upstream: https://github.com/alam00000/bentopdf

Pinned upstream commit: `46bf0fbb576ae664ed65b38d3ec4b4da5cb0d240`.

Bundled engine: `bentopdf-pdfium-813903c93c75.tgz` (unmodified). The vendored JS wrapper was changed only to use a colocated WebAssembly asset and an explicit `.js` utility import. The UI and strict text-edit adapter are original code.

Tesseract.js and Tesseract.js-core licenses are included alongside their bundled assets under `public/ocr/`; the recognition model is distributed by the Tesseract.js project. The hosting service may require owner sign-in to access a privately published site. PDF processing itself has no app account, payment or subscription requirement.
