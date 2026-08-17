# UX remediation plan — triage

> **Status: current as of 2026-08-17.** Reconciles `UX-REMEDIATION-PLAN.md`
> (audited 2026-08-01, 220 findings, 35 items) against the code and the running
> site. Each verdict below carries the evidence it rests on. This is tech-debt
> item 10 — the debt was never the findings, it was that nobody could say which
> were outstanding.

## Result

    DONE          15
    PARTIAL        4
    NOT DONE       5
    UNVERIFIED    11
                  --
                  35

**Nineteen of thirty-five items are done or substantially done.** The plan's own
banner said "an unknown number of items have since been implemented"; that
unknown was most of the work.

## How counting was getting this wrong

The plan mandates *"One item = one commit. Every item has an ID (`T0-01`). Use it
in the commit subject."* Three different measurements, on the same repository:

| Method | Items found complete |
|---|---|
| Item ID in a commit subject | 7 |
| Item ID anywhere in source comments | 10 |
| **Actually verifying against the code** | **15 done + 4 partial** |

So the convention was followed for 7 of 19 completed items. Anyone auditing this
by commit history — as I did first — would conclude two thirds of the finished
work was outstanding.

The most instructive case is `T1-04`. No commit names it. But
`assets/css/main.css:2044` carries the comment *"T1-04 so it still clears
4.5:1"* — the ID lives in the CSS, not the commit. `T0-05` and `T2-07` are the
same: implemented, ID in a code comment, invisible to `git log`.

**Do not batch-verify this plan again by grepping commits.**

---

## DONE — 15

| ID | Item | Evidence |
|---|---|---|
| `T0-01` | Search scoring requires an actual match | `src/ui-controller.js:2504` — `if (!matched) return 0;` with a comment naming the exact failure ("every record scores at least typeBoost") |
| `T0-02` | Real 404 page | `404.html` exists; `civgraph.net/<missing>` returns 404 |
| `T0-03` | `og-preview.png` + OG tags | `assets/images/og-preview.png` serves 200; `check:og-preview` is in the gate |
| `T0-04a` | Stop offering downloads that don't exist | `src/ui-controller.js:2431` `syncDownloadButtons()` hides the button when `resolveMapDownloadUrl` returns nothing — comment: "renders hundreds of controls that silently do nothing when clicked" |
| `T1-01` | Restore focus after a layer load | 10 source references; Playwright coverage |
| `T1-02` | Announce load start and completion | 8 source references; test coverage |
| `T1-03` | Fix the search live region | 5 source references; test coverage |
| `T1-05` | Site heading, title, description | 6 source references; test coverage |
| `T1-09` | Escape closes overlays | 2 source references; test coverage |
| `T2-01` | PRONI export filter mismatch | `functions/_api/proni/export.js:10` imports the same `buildMatch`/`buildFilters` as `search.js`, so the two cannot diverge |
| `T2-02` | Party colour fallback | `src/election-domain.mjs:77` — `partyColour(value, fallback = '#6b7280')` |
| `T2-04` | Restore `/about` and `/census` | both serve 200 |
| `T2-07` | Per-view URLs and titles | `app/src/app.js:3023` `syncDocumentTitle()`, called from `updateURLState` so title and URL cannot drift |
| `T2-08` | Keyboard-operable search | 2 source references; test coverage |
| `T3-03` | Target sizes and focus indicators | 4 source references; test coverage |

## PARTIAL — 4

**`T0-05` · Distinguish loaded / failed / gave up.** The user-visible half is
done: `src/ui-controller.js:9004` announces `"${label} failed to load"` based on
settled state rather than assumption. The code says so itself — *"gives the
user-visible half of T0-05 without depending on `map.on('error')`, which the
PMTiles protocol never fires."* Missing: any distinction between **failed** and
**gave up / timed out**, which was the third state the item asked for.

**`T1-04` · Contrast failures.** At least two fixes landed —
`assets/css/main.css:1150` a dark-mode `--color-primary` hotfix (was ~1.33:1),
and line 2044 tagged `T1-04` for a 4.5:1 clearance. The audit listed several
failures including the attribution bar at 1.62:1, which is tied to `T1-06` and
therefore still open. No evidence of a full re-measure.

**`T1-10` · Add a legend.** Two legends exist — `test2ElectionLegend` for
election results and `.cs-legend` for conditional styling. Neither is the general
layer legend the item asked for.

**`T2-03` · Surface unmatched geography before the click.** `browse/browse.js`
shows *Matched / unmatched* counts in election listings (lines 1173, 1424, 1477).
Whether the map-side catalogue warns before a user loads an unmatched layer is
unverified.

## NOT DONE — 5

**`T0-04b` · Book PDFs that don't exist are still advertised.** Measured:
**5 of the 18** entries in `data/database/books.json` with a `file` field point at
a PDF absent from disk — `dea-prov-1992`, `dublin-reorganisation-1992`,
`lgb-revised-1992`, `dea-final-1992`, `harrison-1984`. Two of those are in
`.cfignore`, so they are deliberately undeployed *and* still offered.

One thing did improve: the audit found these returning `text/html` (the homepage)
at HTTP 200. They now return honest 404s — a side effect of `T0-02`.

`check:asset-refs` passes with *"every referenced asset exists"* and never reads
`books.json`. A validator over that file is the fix, not a one-time cleanup.

**`T1-06` · Dark theme not wired to the dark basemap.** The plan noted the
basemaps already shipped, and they have:
`app/src/maplibre-main-adapter.js:10-11` defines `cartodb-dark` and
`cartodb-dark-nolabels`. There is **no theme wiring at all** — no
`userPickedBasemap` flag, no `onThemeChange`, no reference to `dark` outside those
two URLs. In dark mode the basemap still goes white beside a black panel. This
also holds the attribution-contrast half of `T1-04` open.

**`T1-07` · Header does not reflow at 320px.** The narrowest `@media` breakpoint
in `assets/css/main.css` is **480px**; the others are 640 and 768. Nothing targets
320.

**`T2-06` · Huge layers' default view untamed.** No feature budget, LOD guard or
`maxFeatures` ceiling found in `src/ui-controller.js` or `src/feature-loader.js`.

**`T2-09` · Browse section listings not paginated.** `browse/browse.js:655` still
renders `filtered.slice(0, 500)` — a hard cap with no pagination and no notice
that anything was dropped. There is a `data-feature-load-more` control, but it
serves feature lists, not section listings.

## UNVERIFIED — 11

These need a browser or per-sub-item reading, not a grep. Listed so the gap is
visible rather than implied.

| ID | Item | Why it could not be settled here |
|---|---|---|
| `T1-08` | Accessible names for three chrome controls | `src/ui-controller.js` has 10 `aria-label`s; attributing them to the three the audit identified needs the original probe output |
| `T2-05` | Census layers load, or are marked | 14 census layers, none flagged `placeholder` or `hidden` — so either they load or they are unmarked. A browser settles it in a minute |
| `T2-10` | Table semantics for record listings | 8 `<table>`/`role=` markers in `browse/browse.js`; likely done, but which listings were in scope is unclear |
| `T3-01` | Copy and labelling | grab-bag of sub-items |
| `T3-02` | Production hygiene | 8 `console.log`/`debug` calls remain in `src/ui-controller.js` |
| `T3-04` | Print | needs rendering |
| `T3-05` | Offline | needs a service-worker exercise |
| `T3-06` | Dialog semantics and focus management | needs keyboard interaction |
| `T3-07` | Layer panel and layer types | grab-bag |
| `T3-08` | Election view | grab-bag |
| `T3-09` | Miscellaneous correctness | grab-bag by definition |

The eight T3 grab-bags are the weakest part of the original plan: each bundles
several unrelated findings under one ID, so none can be marked done or not done
as a unit. If they are to be worked, they should be split first.

---

## What to do with this

**Highest value, and cheap:** `T1-06`. The dark basemaps are already defined and
the theme toggle already exists; the item is wiring two things that both ship.
It also closes half of `T1-04`.

**Next:** `T0-04b`, as a validator over `books.json` rather than a cleanup — the
same shape as `check:asset-refs`, pointed at the file it does not currently read.
Then `T2-09`'s silent 500-item truncation, which is the same class of defect as
the contribution queue going blind at 200.

**Then:** `T1-07` (one media query) and `T2-06`.

**Before any more T3 work:** split the eight grab-bags into individually
verifiable items, or drop them. An ID that cannot be marked done is not a
worklist entry.

**Process, worth more than any single item:** the plan's one-commit-per-ID rule
was followed for 7 of 19 completed items, and no check enforces it. Either drop
the convention or enforce it — a convention followed a third of the time produces
exactly the "unknown status" this triage existed to resolve.
