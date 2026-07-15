# Dance Library

A build-free dance practice library designed for GitHub Pages. It includes 795 streamed lessons, focused playback controls, chapter jumps, bookmarks and notes, favorites, watch history, import/export, and a large theme collection.

## Run locally

Serve the repository root with any static web server so service workers and streamed media behave like production:

```sh
python -m http.server 4176
```

Then open `http://127.0.0.1:4176/`.

## Project structure

- `index.html` — static app shell and dialogs
- `style.css` — themes, components, and responsive layouts
- `app.js` — catalog navigation, player, storage, dialogs, and hash routing
- `data.js` — compact lesson metadata needed at startup
- `summaries/` — lesson-analysis chunks loaded only when a lesson is opened
- `salsa_course.js` — Salsa Masterclass course metadata
- `sw.js` — offline shell and runtime asset cache
- `scripts/validate-site.mjs` — deterministic pre-deploy checks
- `scripts/split-catalog.mjs` — repeatable catalog/summary splitter

The app uses relative URLs and `#video=...` routes so it works from the `/dance-library/` GitHub Pages project path without a framework or build step.

## Validate a release

```sh
node --check app.js
node --check sw.js
node scripts/validate-site.mjs
```

The validator checks the complete lesson and summary inventory, duplicate HTML IDs, relative Pages assets, PWA scope, cache-version alignment, HLS pinning/integrity, and accessible contrast correction for every theme.

When a full catalog containing inline `summary` fields is available in `data.js`, regenerate the compact catalog and lazy chunks with:

```sh
node scripts/split-catalog.mjs
```

The command is deterministic and safe to repeat against the generated compact catalog.

## Deployment

Pushes to `main` run the validation gate and deploy the repository through the GitHub Pages workflow in `.github/workflows/deploy.yml`.

Progress, bookmarks, notes, favorites, theme choice, and playback positions stay in the browser's local storage. Video media is streamed and intentionally excluded from the service-worker cache.
