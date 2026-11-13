# `pages/` — standalone HTML pages

> **Status: current, but small and inconsistently tracked.**

Pages that are not the map application and not `/browse/`.

| File | Tracked | Serves |
|---|---|---|
| `about.html` | yes | `/about` |
| `api.html` | yes | `/pages/api`: the Civgraph API (version 1), linked from About, the footer, `llms.txt` and the agent guide |
| `census-explorer.html` | yes | The Census Explorer, which fetches `data/census/explorer-bundle.json` at runtime |
| `*-mock.html` | **no** — `.gitignore` excludes `pages/*-mock.html` | Nothing. Local design mocks. |

## Why the mocks are ignored

`election-history-header-mock.html` and `results-table-header-mock.html` are
throwaway layout experiments. They are excluded rather than deleted so they can
sit beside the real page while a design is being worked out, without ever being
deployed or reviewed.

## Styling

Every page here wears the shared shell (`packages/ui/src/templates/shell.js`, stamped by
`scripts/build/build-site-partials.mjs`): the token set (`assets/ui/tokens.css`,
`tokens-legacy.css`, `base.css`) loads from the shell head before the page's own
stylesheet in `assets/pages/css/`, and the header and footer are styled by
`assets/site/site-chrome.css`.
