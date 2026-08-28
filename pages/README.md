# `pages/` — standalone HTML pages

> **Status: current, but small and inconsistently tracked.**

Pages that are not the map application and not `/browse/`.

| File | Tracked | Serves |
|---|---|---|
| `about.html` | yes | `/about` |
| `census-explorer.html` | yes | The Census Explorer, which fetches `data/census/explorer-bundle.json` at runtime |
| `*-mock.html` | **no** — `.gitignore` excludes `pages/*-mock.html` | Nothing. Local design mocks. |

## Why the mocks are ignored

`election-history-header-mock.html` and `results-table-header-mock.html` are
throwaway layout experiments. They are excluded rather than deleted so they can
sit beside the real page while a design is being worked out, without ever being
deployed or reviewed.

## Styling

`about.html` uses `build/about.css`, which is **generated from
`assets/css/main.css`** by `scripts/build-shared-shell-assets.mjs`. Editing
`build/about.css` directly will be overwritten by the next build. Note that
`/browse/` does *not* share these styles — it carries its own copy of the header
in `browse/browse.css`.
