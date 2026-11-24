# PDF Text Studio

## Source repository

- The canonical repository is `https://github.com/taliamekh/PDF-editor.git`; `origin` must point there.
- Work in this checkout for all future changes. The published branch is `main`; use `codex/` branches for separate feature work unless the user requests otherwise.
- Preserve existing source history. Never force-push or overwrite other remote changes during routine synchronization.

## Files and verification

- Keep user PDFs, screenshots of private documents, OCR data, saved sessions, credentials, and temporary exports out of Git and `public/source.zip`.
- Local inputs and test artifacts belong in ignored `inputs/`, `tmp/`, or `test-output/`; do not add them with force.
- Preserve the BentoPDF licensing and bundled engine/recognition assets.
- Install dependencies with `pnpm install --frozen-lockfile`. Run `pnpm build` and checks appropriate to the change. Synthetic fixture and regression scripts are documented in `README.md`.
- When changing distributable application source, regenerate `public/source.zip` with `python scripts/package-source.py` before the final build.

## Existing hosted site

- Preserve the existing project identity in `.openai/hosting.json` and its current audience.
- GitHub synchronization and Sites deployment are separate operations; a GitHub push alone does not establish a new live version.
- Use the Sites workflow when publishing changes. Keep the GitHub `origin` intact, and ensure the final verified source commit is pushed to GitHub when completing a code change.
