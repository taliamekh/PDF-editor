# PDF Text Studio

Canonical source: [taliamekh/PDF-editor](https://github.com/taliamekh/PDF-editor), branch `main`. Future development happens in this repository. The existing source history, including the current deployed editor, is preserved here.

A browser-local, PDF-only text editor built using BentoPDF's PDFium WebAssembly package and engine wrapper. Click a field and delete or type directly at its position on the page. Clicking away autosaves to an in-memory edited copy; Enter also saves and Escape cancels. Download copy saves a pending edit and creates a separate `-edited-copy.pdf` file. The original document is never uploaded or overwritten.

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm build` for the production build. Generate the downloadable corresponding source with `python scripts/package-source.py` before the final build when application source changes. See the validation section for synthetic PDF fixtures and regression checks.

The hosted site remains [PDF Text Studio](https://pdf-text-studio-talia.taliamekhayche.chatgpt.site/). Its existing Sites identity is retained in `.openai/hosting.json`; GitHub pushes and Sites deployments are separate operations.

Mouse-wheel scrolling over the page zooms; trackpad pinch and Ctrl/Command+wheel zoom around the pointer. Small trackpad scrolls pan the page. Zoom ranges from 35% to 600%, with higher-resolution rendering after the gesture settles.

Pinch sensitivity is reduced, event-size changes are capped, and animation eases zoom around the pointer. Coarse mouse-wheel ticks zoom more gently; ordinary pixel scrolling pans even at higher speeds. Native gesture scaling is softened too.

Choose **Move & align** to drag a text box. Guides snap its edges and center to the page center and other boxes; hold Alt to turn snapping off or Shift to constrain the drag to one axis. Choose Page or another box under **Align with**, then use Left/Center/Right or Top/Middle/Bottom. Arrow keys nudge a selected box by 1 PDF point (10 with Shift). Moves autosave, export to a separate copy, and support Undo.

Movement translates original text matrices without changing the font, size, character spacing or paint. Moving a field within a combined native object splits its visible fields using their existing font and glyph positions. Outlined fields move their original vector letter paths without substituting a font. Each move is exported, reopened, and checked for glyph/style preservation and pixel changes outside its old and new positions. Page overflow and new text-box collisions roll back safely.

## Preservation

Text replacement mutates the existing PDFium text object. It preserves the original font resource, font size, text matrix, paint colours and rendering mode. Prefix and suffix character positions are retained, while replacement characters use the original font's glyph widths and observed tracking. The engine exports and reopens each proposed edit, verifies font data using SHA-256, verifies size and formatting, checks nearby text collisions and compares rendered pixels outside the edited region. An unsuccessful check rolls the edit back.

The original-text mode never substitutes a font or shrinks text to fit. There are no whiteout rectangles, page rasterization or paid APIs. Undo retains up to 15 document revisions in memory.

## Outlined lettering

Some PDFs store every letter as a vector drawing, without any text or original font information. For these pages, bundled Tesseract.js performs English OCR locally. The editor compares the recognized lettering against PDFium's standard font families and estimates a matching size. The toolbar labels these edits as approximate, and the recognized words should be checked.

Outlined text defaults to upright fonts. Italic matching requires consistent slanted stems in the original vector shapes and a clear visual match advantage over upright fonts. The chosen style stays fixed during editing. Genuine text objects retain their existing embedded font, including genuine italics.

Bold matching also requires a clear shape advantage and ink coverage closer to bold strokes than regular strokes. Foreground contrast is normalized so gray or colored lettering keeps its weight. A near-tie in word shape cannot turn a regular name bold beside a genuine bold label.

OCR word coordinates split visible gaps into separate fields, retaining ordinary spacing within a phrase. Native text objects also split at large glyph gaps; editing a subfield locks the surrounding glyph positions. Selecting a field opens the on-page caret.

Saving removes only the selected field's original filled letter paths, inserts real PDF text with the matched font, reopens the export, checks the replacement, and verifies pixels outside that field. Before adding text, pdf-lib combines the selected page's content streams inside a balanced graphics-state wrapper so an inherited transform cannot move new text during export. The original source bytes remain untouched. Existing backgrounds and rules remain in place. Fields that cannot be isolated safely are rejected. Genuine text on mixed pages still uses the original-text mode.

A failed edit restores the last verified PDF, clears the active selection, and retains the draft in memory for retrying that field. It does not block selecting another field or opening a new document.

## Current scope

- Visible text objects directly on a PDF page, including rotated text and mixed-font pages.
- Outlined text made from filled paths directly on a page, using approximate matching. Image-based scans, strokes-only lettering and nested outlined text are not supported.
- One text field per edit. Longer text can grow into free space while keeping its size; collisions with neighboring fields and page overflow are rejected.
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

`scripts/create-spaced-fixtures.py` adds separated labels/values and a page-level flipped transform. Render `spaced-outlines.pdf` at 216 DPI, then run `node scripts/verify-spaced.mjs` to check field separation, preservation of sibling positions, multiple edits, rollback after an injected export failure, and opening another PDF afterwards. Browser checks cover clicking away, switching fields, error recovery, mouse wheel and pinch input, and a separate-copy download.

`scripts/create-font-style-fixture.py` and `node scripts/verify-font-style.mjs` verify that short upright fields remain upright, original outlined italics retain their style, and native embedded italic fonts and sizes survive edit/export.

`scripts/create-font-weight-fixture.py` and `node scripts/verify-font-weight.mjs` verify regular names beside bold labels, genuine bold, short fields, gray text, and original regular/bold embedded fonts through editing and export.

`node scripts/verify-movement.mjs` verifies native, separated, italic and outlined moves, page/box alignment and snapping, editing after a move, sibling positions, downloaded/reopened positions, undo, bounds, and rollback after an injected export failure. Browser checks cover pointer dragging, alignment controls, autosaving when changing tools, and PDF downloads.

## Source and licensing

Licensed under AGPL-3.0-only; see `LICENSE`. BentoPDF source and its bundled engine are retained for reproducibility. Downloadable corresponding application source is included at `/source.zip`.

BentoPDF upstream: https://github.com/alam00000/bentopdf

Pinned upstream commit: `46bf0fbb576ae664ed65b38d3ec4b4da5cb0d240`.

Bundled engine: `bentopdf-pdfium-813903c93c75.tgz` (unmodified). The vendored JS wrapper was changed only to use a colocated WebAssembly asset and an explicit `.js` utility import. The UI and strict text-edit adapter are original code.

Tesseract.js and Tesseract.js-core licenses are included alongside their bundled assets under `public/ocr/`; the recognition model is distributed by the Tesseract.js project. The hosting service may require owner sign-in to access a privately published site. PDF processing itself has no app account, payment or subscription requirement.
