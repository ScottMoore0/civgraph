# r3-ui (refactor round 3, UI tightening part 1): landing notes

Branch `r3-ui`, worktree `C:\Users\scomo\civgraph-r3-ui`, on main `c17cb4db37` (main had not moved
at the end, so the rebase was a no-op). Nothing in src/ or app/src/ was touched.

## Commits

| Commit | What |
|---|---|
| 35749bdffe | `check:types:ui` runs with **strictNullChecks**. 181 findings fixed (browse.js 125, PRONI 30, words 26; the 2 in gallery.js had already gone). `tests/unit/ui-types.test.mjs` pins the flag. |
| 292910a206 | **MA-14, worker half**: the root `sw.js` lifecycle is an explicit table, its take-over policy and cache-version standing are named; new `tests/unit/service-worker-lifecycle.test.mjs`. `/build/main.css` token re-stamped (the salt covers sw.js's policy text), plus the browse.js and PRONI app.js tokens. |
| 4ef98abe68 | **UI-L contributorEditor.hidden**: light toggle `CONTRIBUTOR_EDITOR` (browse/state-machines.js). Import-map tokens re-stamped. |

## 1. strictNullChecks: how the findings were fixed (no suppressions, no behaviour change)

No `@ts-ignore`, `@ts-expect-error` or `any` cast was added. The kinds of fix:

- **Page lookups typed as present.** `$`/`byId` in the three scripts return the element type, not
  `| null`, with one documented JSDoc assertion each: every looked-up id is in the page's HTML
  (checked for browse/, records/ and catalogue/index.html, which all load browse.js; PRONI and
  Words index.html). A missing element still throws a TypeError at first use, as before. Input and
  select fields use `$input`/`$select` (`HTMLInputElement`/`HTMLSelectElement`) instead of the
  `UiElement` partial, whose `value` is `string | undefined`.
- **State typed by JSDoc.** Browse `state` (manifest, activeId, serverList, personFacets, the
  feature map ids, auth, currentDetail), the votes view, Words' `WordsState`, PRONI's `total` and
  `levels`, the Words suggestion rows. Payloads straight from JSON keep loadJson's type under a named
  alias, `Json` (`ReturnType<JSON['parse']>`), where they had been inferred as `any[]` before; the
  shapes that are read (auth, manifest counts/groups, facets maps) got real types.
- **Throw stays throw.** Where a null used to throw (`x.querySelector(...).textContent`,
  `link.getAttribute('href').replace`, the status line of a form the script has just written),
  `present()` (browse.js) or `child()` (PRONI) throws a TypeError at the same statement.
- **Coercion stays coercion.** Where a null or undefined was coerced (an `encodeURIComponent`
  argument, a property key, `URLSearchParams.set`, an input's `value` setter, `decodeURIComponent`),
  `String(...)` coerces it the same way. Values read from `dataset` of an element matched by that
  attribute's selector are always strings; those lines say so.
- Rewrites with identical results: Words `readUrl` reads each parameter once into a variable before
  testing it; the chart's "highest" label uses `reduce` instead of `forEach` (same pick, no holes);
  `niceMax` wraps `steps.find` in `Number()` (always found, since 10 x magnitude > value).

`noImplicitAny` remains the one strict-family flag off in tsconfig.ui.json (about 1,031 findings).

## 2. MA-14, the service worker's own lifecycle (full weight, inline)

`sw.js` (classic worker script, cannot import) now has:

- `LIFECYCLE_TRANSITIONS`: `parsed -> installing | activating`, `installing -> installed`,
  `installed -> activating`, `activating -> active`, `active` final. `parsed -> activating` is a
  stopped, installed worker woken in a fresh global to activate; a worker woken for a fetch or a
  message stays `parsed` (it is already active). `lifecycleMove(next)` checks the table; a move it
  does not list is `console.warn`ed and still taken, because the browser runs the lifecycle and
  throwing in an install/activate handler would change what the browser does. Valid paths log
  nothing, so behaviour is identical.
- `ACTIVATION_POLICY = { skipWaitingOnInstall: true, claimOnActivate: true }`: the policy the
  catalogue asked to make explicit (both were unconditional before; both stay on).
- `cacheVersionOf(name)`: `current` (this VERSION's two caches), `retired` (root or legacy prefix,
  another version: deleted at activate) or `foreign` (never touched). Activate deletes exactly the
  set its two filters deleted before (the test checks the equivalence).
- `VERSION` is unchanged in form and position; `scripts/build/app-bundle.mjs` still rewrites it
  (the test checks the line, and `npm run build:test2:app` stamped it in the worktree).

`tests/unit/service-worker-lifecycle.test.mjs` builds the inline table with
`assets/ui/state/machine.js` `defineMachine` (so it must be a well-formed table), checks
`lifecycleMove` against the helper's `can()` for all 25 pairs (warns exactly on refused moves),
walks install -> activate and activate-only in a fake worker scope (skipWaiting, claim, which caches
go) and pins the VERSION line.

## 3. DOM `hidden` light items in my folders

Of catalogue UI-L, the PRONI modal/kids/note and the Words tip were done in rounds 1-2. The one
left, Browse `contributorEditor.hidden`, is now `CONTRIBUTOR_EDITOR` (`defineToggle`, hidden |
shown) settled by showInlineEditor/closeInlineEditor, which set the attribute from it; Escape and
isEditorDirty read the toggle (only those two functions ever wrote the attribute, and the markup
starts hidden, so they agree). Added to the table walk in `tests/unit/ui-state-machines.test.mjs`.
Other `hidden` writes in apps/ and pages/census-explorer.html are not catalogue items; left.

## Landing steps

1. Merge `r3-ui`. Shared files outside my folders: `tsconfig.ui.json` (flag + comment),
   `tests/unit/ui-types.test.mjs`, `tests/unit/ui-state-machines.test.mjs` (one line), new
   `tests/unit/service-worker-lifecycle.test.mjs`, and generated tokens in `maps/index.html`,
   `maps/classic/index.html`, `catalogue/index.html`, `records/index.html`.
2. **Run `npm run build` on main after merging** (not committed here): the app bundle is
   gitignored and its hash differs per checkout (main's at c17cb4 hashed to `46ff2006d552`, this
   worktree's build to `0fe172b2fac1`, different esbuild chunk names), so I left sw.js VERSION and
   the app.bundle.js tokens at main's values. The build re-stamps them; the `/build/main.css` token
   (`8bcd73e7e549`, salted on sw.js minus VERSION) is already right and the build will keep it.
   If src/ landed meanwhile, also `node scripts/check/rules/browse-cache-tokens.mjs` for any token
   conflict in browse/records/catalogue/PRONI index.html.
3. No data regeneration, no R2 upload, no D1 migration, no records rebuild.

## Tests (on the branch)

- `npm run check:types:ui`: OK, 9 files (ui, now with strictNullChecks) + 6 files (ui-strict).
- `npm run test:unit`: 428 pass, 0 fail (432 tests, 4 skipped), including the new lifecycle test,
  ui-types, ui-state-machines, ui-module-tokens, ui-theme, retired-service-worker.
- `npm run check:fast`: 64 of 75 pass. The 11 failures are environmental: 10 need the gitignored
  `tmp/records` build (17 GB in main; not copied): peatland-geoportal, election-source-enrichments,
  status, site-figures, approved-publication, public-map-count, ni-register-interests, provenance,
  test2, test:elections-unit. The 11th, check:app-shell-cache, is VERSION vs this worktree's own
  bundle hash (step 2), which main's rebuild resolves.
- Browser, port 5050: `site-shell.spec.js`, `ui-state-machines.spec.js` (both in light and dark,
  375 and 1280 px, axe), `words-explorer.spec.js`, `retired-service-worker.spec.js`: 78 passed.
- `browse-records.spec.js` against `wrangler pages dev` on port 8798 served from the worktree, with
  `.wrangler/state` and `data/browse` COPIED from main (robocopy; nothing junctioned, main's
  copies not opened for writing): 10 of 10 passed. Server stopped after.
- No browser spec opens the inline contributor editor (it needs a signed-in record page); its
  toggle is covered by the unit table walk and the unchanged call order.
- `npm run check:clean` (once, at the end): CLEAN-EXPORT CHECKS OK, 75 of 75 steps, exit 0 (it
  builds its own bundle and records in the export, so the step-2 and tmp/records failures do not
  arise there).
