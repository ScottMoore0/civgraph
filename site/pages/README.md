# `pages/` — standalone HTML pages

> **Status: current, but small and inconsistently tracked.**

Pages that are not the map application and not `/browse/`.

| File | Tracked | Serves |
|---|---|---|
| `about.html` | yes | `/about` |
| `api.html` | yes | `/pages/api`: the Civgraph API (version 1), linked from About, the footer, `llms.txt` and the agent guide |
| `census-explorer.html` | yes | The Census Explorer, which fetches `data/census/explorer-bundle.json` at runtime |
| `status.html` | yes | `/status`: progress figures, body stamped by `scripts/build/build-status.mjs` |
| `licence.html`, `cite.html` | yes | `/pages/licence`, `/pages/cite`: public since 24 Nov 2026 (owner), linked from the footer and About and in the sitemap. `licence.html`'s per-source list is stamped from `data/database/source-ledger.json` by `scripts/build/build-licence-page.mjs` (`npm run check:licence-page`). Styles: `assets/pages/css/info.css` |
| `privacy.html`, `downloads.html` | yes | DRAFTS (11 Nov 2026), noindex and unlinked until the owner approves them. Each information page has a `live` flag in `packages/ui/src/templates/info-pages.js` that decides its noindex line and draft banner (the `site:draft-head` and `site:draft-banner` regions, stamped by `build-site-partials.mjs`), its footer link and its sitemap entry; no public page may link a draft (the `info-pages.test.mjs` unit test). |
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
