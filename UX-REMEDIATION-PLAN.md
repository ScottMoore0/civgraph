# Civgraph UX Remediation Plan

> **Status: point-in-time audit — 2026-08-01. Not a live worklist.** Derived from
> a single adversarial UI/UX audit (49 probe iterations, 220 findings) on that
> date. An unknown number of items have since been implemented, and the Browse
> contributor UI was substantially rebuilt in August 2026. Verify each item
> against the running site before acting on it.

Derived from the adversarial UI/UX audit of 2026-08-01 (49 probe iterations, 220 findings).
Every item below is grounded in a measurement or a line of source read during that audit.

**Ordering:** descending by *impact ÷ difficulty*. Tier 0 items are near-one-line changes with
site-wide consequences. Later tiers cost more per unit of benefit. Within a tier, order is by
absolute impact.

---

## How to use this document

### Ground rules

1. **One item = one commit.** Every item has an ID (`T0-01`). Use it in the commit subject.
2. **Do not batch across tiers.** Tier 0 items are individually shippable and individually
   revertible. That is the point of them.
3. **Run the item's own verification before the global gate.** The global gate (`npm run check`)
   is slow; the per-item check is fast and catches the thing you actually changed.
4. **Build artifacts are tracked.** Per project convention, edits under `app/src/` or `test/src/`
   require a rebuild and the rebuilt `app/build/*` committed in the same commit. Items below say
   `REBUILD: yes` where this applies.
5. **Nothing is deployed without explicit approval.** These items land as commits; publication is
   a separate, explicitly-approved step.

### Global gates

```bash
npm run check          # full validator suite — before any push
npm run build          # only when app/src or test/src changed
```

### Standing rollback

Each item is a single commit touching a small number of files. Rollback is `git revert <sha>`.
Items that change data or delete files record an explicit restore step instead.

### Verification harness

The audit's Playwright probes live in the session scratchpad and are disposable. For items that
need a browser check, this plan gives a **minimal inline probe** you can paste into a scratch
`.mjs` file. They all use:

```js
import { createRequire } from 'module';
const require = createRequire('C:/Users/scomo/boundaries-website/package.json');
const { chromium } = require('playwright');
```

and launch with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

### Risk legend

| Risk | Meaning |
|------|---------|
| **None** | Additive file or pure CSS. Cannot break an existing path. |
| **Low** | Single well-understood expression; failure mode is visible immediately. |
| **Medium** | Touches shared logic or state; needs the listed regression check. |
| **High** | Changes behaviour many users depend on; needs staged rollout or a flag. |

---

# TIER 0 — one-line changes with site-wide consequences

These five are, collectively, a few hours of work and they resolve the top of the audit.

---

## T0-01 · Make search scoring require an actual match

**Impact: critical · Difficulty: trivial · Risk: Low**

### Root cause (confirmed by source read)

`js/ui-controller.js:2458` `scoreCatalogueSearchRecord()` ends with:

```js
const typeBoost = { map: 90, election: 85, feature: 80, party: 70, person: 60, source: 40 };
score += typeBoost[record.type] || 0;
return score;
```

`typeBoost` is applied **unconditionally**. Every record in the index therefore scores ≥ 40,
the caller's `if (score > 0)` admits all of them, and the list is sorted and sliced to 80.

`js/ui-controller.js:2536` compounds it for features:

```js
const score = this.scoreCatalogueSearchRecord(record, terms, normalizedQuery, mapOrder) + 120;
```

`+120` is likewise unconditional.

**Consequence:** the empty state at `js/ui-controller.js:2552` —
`'<div class="catalogue-search__empty">No matching maps, elections, features, people, parties, or sources found.</div>'`
— **already exists and can never render**, because `results.length` is never 0. The audit's
"80 results for qqzzxwvnothing" (finding #1) and "Ballymena also returns exactly 80" (#209) are
both this single defect.

### Change

In `scoreCatalogueSearchRecord`, track whether any term or phrase actually matched, and return
`0` when nothing did. Apply boosts only to matched records.

```js
scoreCatalogueSearchRecord(record, terms, normalizedQuery, mapOrder) {
    if (!record?.searchText) return 0;
    const title = this.normalizeCatalogueSearchText(record.title);
    let score = 0;
    let matched = false;

    if (title === normalizedQuery) { score += 1000; matched = true; }
    if (title.startsWith(normalizedQuery)) { score += 650; matched = true; }
    if (record.searchText.includes(normalizedQuery)) { score += 240; matched = true; }
    terms.forEach(term => {
        if (!term) return;
        if (title.split(' ').includes(term)) { score += 170; matched = true; }
        else if (title.includes(term)) { score += 100; matched = true; }
        if (record.searchText.includes(term)) { score += 40; matched = true; }
    });

    if (!matched) return 0;                       // <-- the fix

    if (record.type === 'map' && mapOrder?.has(record.mapId || record.id)) {
        score += Math.max(0, 450 - mapOrder.get(record.mapId || record.id));
    }
    const typeBoost = { map: 90, election: 85, feature: 80, party: 70, person: 60, source: 40 };
    score += typeBoost[record.type] || 0;
    return score;
}
```

And at the feature branch (~line 2536), gate the `+120`:

```js
featureResults.slice(0, 60).forEach(result => {
    const record = this.featureSearchResultToCatalogueRecord(result);
    const base = this.scoreCatalogueSearchRecord(record, terms, normalizedQuery, mapOrder);
    if (base <= 0) return;              // feature search already matched upstream, but
    scored.push({ record, score: base + 120 });
});
```

> **Decision required.** The feature-search path (`this.searchFeatures(query)`) has already
> performed its own matching upstream, so a strict `base <= 0` gate may drop legitimate feature
> hits whose *title* doesn't contain the query. **Safer variant:** keep features unconditional but
> mark them matched, i.e. `scored.push({ record, score: Math.max(base, 1) + 120 })`. Choose the
> safer variant unless a probe shows feature results are noisy.

### Files

- `js/ui-controller.js` (2 hunks, ~8 lines)

### REBUILD: no *(js/ui-controller.js is served directly; confirm with `git show --stat` of commit 44395eb which shipped it unbuilt)*

### Verification

```js
// probe-search.mjs
const page = /* … goto https://civgraph.net/ or local, wait 8s … */;
const inp = page.locator('input[placeholder*="Search"]').first();
for (const q of ['qqzzxwvnothing', 'Ballymena', 'Townlands', 'Derry', 'BT1']) {
  await inp.click(); await inp.fill(''); await page.waitForTimeout(300);
  await inp.type(q, { delay: 35 }); await page.waitForTimeout(3500);
  console.log(q, await page.evaluate(() => ({
    n: document.querySelectorAll('article.catalogue-search__result').length,
    empty: !!document.querySelector('.catalogue-search__empty'),
    summary: document.querySelector('.catalogue-search__summary')?.innerText.slice(0,40)
  })));
}
```

**Pass criteria**
- `qqzzxwvnothing` → `n: 0`, `empty: true`
- `Ballymena` → `n` is a plausible number **and not exactly 80**
- `Townlands`, `Derry` → still return their expected relevant hits (regression guard)

### Regression risk

The one thing that can go wrong is over-filtering: a query that previously surfaced a record via
type boost alone now returns nothing. Mitigate by checking the four real queries above return
non-zero. If any legitimate query regresses, the cause will be a record whose `searchText` doesn't
contain the term — a **data** problem, to be fixed by enriching `searchText`, not by restoring the
unconditional boost.

### Rollback

`git revert`. Behaviour returns to "80 results for anything".

---

## T0-02 · Add a real 404 page

**Impact: critical · Difficulty: trivial · Risk: None**

### Root cause

No `404.html`, no `_redirects`, no `_routes.json` in the repo. Cloudflare Pages therefore falls
back to serving `index.html` with **HTTP 200** for every unmatched path.

Confirmed downstream consequences, all from this one gap:

| Symptom | Finding |
|---|---|
| `/about`, `/census` serve the homepage with "Home" highlighted | #3 |
| `sitemap.xml` returns 85,366 bytes of homepage HTML | #3 |
| `og:image` returns homepage HTML → every social card broken | #130 |
| 5 book PDFs return homepage HTML → PDF viewer renders Civgraph inside itself | #122–124 |
| No missing asset can ever surface in logs or monitoring | passim |

### Change

Create `404.html` at the repo root. Cloudflare Pages serves it automatically, with a 404 status,
for any path that matches no static asset and no Function route.

Content requirements:
- Site header/branding consistent with the rest of the site
- `<title>Page not found — Civgraph</title>`
- An `<h1>` (the main app has none; this page should model the right pattern)
- Plain explanation + links to `/`, `/browse`, `/apps`
- No JS dependency — it must render if the bundle is what's missing

### Files

- `404.html` (new, ~60 lines)

### REBUILD: no

### Verification

```bash
for u in nope-xyz-999 about sitemap.xml assets/images/og-preview.png; do
  printf "%-40s " "/$u"
  curl -s -o /dev/null -w "HTTP %{http_code} %{content_type}\n" "https://civgraph.net/$u"
done
```

**Pass criteria**
- `/nope-xyz-999` → **HTTP 404**, `text/html`
- Existing real routes (`/`, `/browse`, `/apps`, `/proni`, `/proni/T3703/1/8`) → still **200**

### Critical regression check (do not skip)

`/proni/<ref>` is client-routed and *must* keep returning 200 with the app shell. Verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://civgraph.net/proni/T3703/1/8   # expect 200
curl -s -o /dev/null -w "%{http_code}\n" https://civgraph.net/browse/           # expect 200
```

If adding `404.html` breaks these, add an explicit `_redirects` entry preserving the SPA fallback
for `/proni/*` and `/browse/*` **before** the catch-all.

### Rollback

Delete `404.html`. Instant.

### Dependency

**T0-03, T0-04 and T1-02 become verifiable only after this lands** — until unknown paths 404,
you cannot tell a missing asset from a working one.

---

## T0-03 · Ship the missing `og-preview.png` and complete the OG tags

**Impact: high · Difficulty: trivial · Risk: None**

### Root cause

`index.html` declares `og:image → https://civgraph.net/assets/images/og-preview.png`. That file
does not exist (returns homepage HTML, 85,366 bytes). Additionally `og:title` is the bare word
"Civgraph", there is no `og:description`, and `og:url` is hardcoded to the site root — so every
shared deep link previews as the homepage.

### Change

1. Produce `assets/images/og-preview.png` at **1200×630**, < 1 MB. Suggested content: the map with
   a recognisable Ireland outline, the wordmark, and the tagline from T1-05.
2. In `index.html` add:
   ```html
   <meta property="og:description" content="Interactive maps of the administrative geography and history of Ireland and Northern Ireland — 1,011 map layers, elections back to 1885, and 1.5 million PRONI archive records.">
   <meta name="twitter:description" content="…same…">
   <meta property="og:site_name" content="Civgraph">
   ```
3. Change `og:title` to something descriptive, e.g.
   `Civgraph — maps of Irish administrative geography and history`.
4. Leave `og:url` hardcoded for now; making it dynamic is T2-07.

> The description text above is lifted almost verbatim from the site's own `<noscript>` block,
> which is already the clearest description of the project anywhere (#37). Reuse it deliberately.

### Files

- `assets/images/og-preview.png` (new binary)
- `index.html` (3–4 meta lines)

### REBUILD: no

### Verification

```bash
curl -sI https://civgraph.net/assets/images/og-preview.png | grep -iE "^(HTTP|content-type|content-length)"
# expect: 200, image/png, < 1000000
```

Then validate the card with any OG debugger, or:

```bash
curl -s https://civgraph.net/ | grep -oiE '<meta[^>]*og:[^>]*>'
```

**Pass criteria**: image resolves as `image/png`; `og:description` present; `og:title` descriptive.

### Rollback

`git revert`. Cards return to broken, no functional impact.

---

## T0-04 · Stop advertising downloads and documents that don't exist

**Impact: high · Difficulty: low · Risk: Low**

Two separate defects, same shape, same commit is acceptable — or split if you prefer strict
atomicity (`T0-04a`, `T0-04b`).

### T0-04a — "Download FGB"

**Root cause.** `app/src/app.js:832`:

```js
const url = mapConfig?.downloads?.fgb || mapConfig?.files?.fgb;
```

In the catalogue index there is **no `downloads` key at all**, and `files` is an **integer**
tile-count (values like `28`, `759`, present 687 times). `(28)?.fgb` is `undefined`, so `url` is
undefined for every one of 1,011 maps. The handler runs and reaches no network call — the audit
measured **zero requests of any kind** on click.

Meanwhile the real file exists and is exposed elsewhere: the sources panel renders
`DATA FILE → https://data.civgraph.net/data/maps/baronies-parishes/Counties_Ireland.fgb`
(verified: 200, `application/octet-stream`, 35,051,896 bytes, magic `fgb\x03fgb\x01`).

**Also:** only **29 `.fgb` files exist** across the 1,011 maps (817 are `.pmtiles`), so ~97% of
rows have no vector download even in principle.

**Change — two parts, both required.**

1. **Wire the button to the field that actually holds the URL.** Locate the field the sources
   panel reads (the index exposes `sourceFile` on 50 entries) and extend the lookup:
   ```js
   const url = mapConfig?.downloads?.fgb
             || mapConfig?.sourceFile
             || (typeof mapConfig?.files === 'object' ? mapConfig.files.fgb : null);
   ```
   Note the `typeof` guard — without it the integer `files` silently wins again.

2. **Do not render the button when there is no URL.** In the row/overflow renderers in
   `js/ui-controller.js`, omit `.download-fgb-btn` when the resolved URL is falsy. This removes
   ~950 dead controls per catalogue view and is the larger UX win.

3. **Show the size.** Where a URL exists, render the byte size from the index (or a `HEAD` at
   render time is too expensive — prefer a build-time size field). Minimum: append the format
   expansion, e.g. `Download FlatGeobuf (33 MB)`.

**Verification**

```js
// after loading a catalogue section
await page.evaluate(() => ({
  buttons: document.querySelectorAll('.download-fgb-btn').length,
  withUrl: [...document.querySelectorAll('.download-fgb-btn')]
             .filter(b => b.dataset.url || b.getAttribute('href')).length
}));
```
Pass: `buttons === withUrl`, and clicking one produces a `download` event whose URL ends `.fgb`.

### T0-04b — Missing book PDFs

**Root cause.** 5 of 6 sampled book PDFs return `text/html` (the homepage):

| File | Result |
|---|---|
| `data/books/boundary-reports/dea-prov-1992.pdf` | missing |
| `data/books/boundary-reports/dublin-reorganisation-1992.pdf` | missing |
| `data/books/boundary-reports/lgb-revised-1992.pdf` | missing |
| `data/books/boundary-reports/dea-final-1992.pdf` | missing |
| `data/books/boundary-reports/harrison-1984.pdf` | missing |
| `data/books/legislation/northern-ireland-acts-1921.pdf` | **present**, 1,774,867 bytes |

The Markdown derivatives *do* exist and serve as `text/markdown`.

**Change — pick one, in preference order:**

- **(A) Deploy the missing PDFs.** They exist on the Internet Archive (each card links there).
  This is the correct fix. Add them to the R2/Pages asset set and re-verify.
- **(B) If they cannot be deployed**, suppress the PDF tab, "Open PDF", "Download PDF" and the
  iframe for documents whose PDF is absent, and default those cards to the Markdown view. Add a
  build-time manifest of which formats exist so the UI never guesses.

Either way, **the iframe must not be pointed at a URL that can return HTML** — that is what
produces the recursive site-inside-itself render (#123). Guard it:

```js
// only mount the PDF iframe if a HEAD (build-time or cached) confirmed application/pdf
```

**Verification**

```bash
for f in dea-prov-1992 dublin-reorganisation-1992 lgb-revised-1992 dea-final-1992 harrison-1984; do
  printf "%-34s " "$f"
  curl -sI "https://civgraph.net/data/books/boundary-reports/$f.pdf" | grep -i content-type
done
```
Pass (route A): all `application/pdf`. Pass (route B): all still `text/html` **but** no PDF iframe
or PDF button renders for those documents.

### Files

- `app/src/app.js` (download URL resolution) — **REBUILD: yes**
- `js/ui-controller.js` (conditional button render, book card formats)
- possibly a new build script emitting a format/size manifest

### Rollback

`git revert`. Buttons return to being inert but visible.

---

## T0-05 · Distinguish "loaded" from "failed" and "gave up"

**Impact: critical · Difficulty: low–medium · Risk: Medium**

### Root cause

`waitUntilSettled()` in `app/src/maplibre-main-adapter.js` waits for map `idle` **and**
`areTilesLoaded()`. When tile requests **fail**, there are no pending requests, so
`areTilesLoaded()` is immediately true and the promise resolves in ~2 s. When tiles **stall**, the
20 s cap fires. Both paths resolve to the same value, and the caller renders the same
"Unload / in hash / in panel" success state.

Measured:

| Condition | Time to "success" | What the user sees |
|---|---|---|
| Tiles fail | ~2 s | "Unload", layer in hash + panel, **empty map**, no error |
| Tiles stall | 20 s (cap) | identical |
| Tiles arrive | 14–16 s | identical, layer visible |

This is the mechanism that would make a CDN outage invisible.

### Change

1. **Make `waitUntilSettled` return a verdict, not `void`:**
   ```js
   // { settled: true }            – idle && areTilesLoaded() && at least one tile arrived
   // { settled: false, timedOut: true }  – 20 s cap fired
   // { settled: false, errored: true, error } – source/tile error observed
   ```
2. **Subscribe to MapLibre's `error` event** scoped to the source id for the duration of the wait,
   and to `sourcedata` to confirm at least one successful tile/metadata load. `error` is the signal
   that distinguishes case 1; the cap firing distinguishes case 2.
3. **Render three outcomes** in the load button and the Active Layers row:
   - success → `Unload`
   - timed out → `Still loading…` (keep the layer, keep a subdued spinner, allow unload)
   - errored → `Failed — retry`, and **do not** write the layer into the hash or the panel
4. **Announce the outcome** in an `aria-live="polite"` region (see T1-03, which this shares).

### Files

- `app/src/maplibre-main-adapter.js` (~40 lines) — **REBUILD: yes**
- `js/ui-controller.js` (button state mapping)

### Verification

```js
// FAIL case
await ctx.route('**/*.pmtiles*', r => r.abort('failed'));
// … click Load, sample every 2 s for 30 s …
// expect: button never reads "Unload"; reads "Failed — retry"; hash has NO layers=
```
```js
// STALL case
await ctx.route('**/*.pmtiles*', async r => { await new Promise(x=>setTimeout(x,40000)); r.continue(); });
// expect: spinner to 20 s, then "Still loading…", NOT "Unload"
```
```js
// HAPPY case — regression guard, run last, no route interception
// expect: spinner ~14–16 s then "Unload", layer in hash and panel
```

### Regression risk — **Medium, read this**

The happy path currently works and is the most-used path in the app. Two specific hazards:

- **False negatives.** MapLibre emits `error` for benign conditions (a 404 on a single missing
  tile at the edge of coverage). Scope the error listener to *source-level* failures, or require
  N consecutive tile errors, or require *zero* successful `sourcedata` events before declaring
  failure. Do **not** fail the load on the first `error` event.
- **The 20 s cap must remain.** It is the only thing preventing an infinite spinner and it was
  verified working to the second. Do not replace it — only change what it resolves *to*.

Run the happy-path regression on at least three layers of different types (vector polygon, raster,
point cloud) before merging.

### Rollback

`git revert`. Returns to over-reporting success.

---

# TIER 1 — high impact, contained effort

---

## T1-01 · Restore focus after a layer load

**Impact: high · Difficulty: low · Risk: Low**

**Root cause.** Loading re-renders the catalogue; the focused button node is discarded and
replaced; nothing restores focus. Measured: `document.activeElement` is `<body>` during and after
the load. A keyboard user is thrown to the top of a ~198-stop tab order (#53).

This is a direct consequence of the `MutationObserver` re-application strategy in commit
`44395eb122` — that commit correctly re-applies the *spinner* to replaced buttons but not focus.

**Change.** In the same place the observer re-applies spinner state, also restore focus:

```js
// before the toggle, if the activating element was the load button:
const hadFocus = document.activeElement === btn;
// in the observer, when re-applying spinner state to a replacement node:
if (hadFocus && replacement.isConnected) replacement.focus({ preventScroll: true });
```

Use `preventScroll: true` — without it the pane will jump.

**Files:** `js/ui-controller.js`

**Verification**
```js
// tab to a load button, press Enter, sample focus at 2s and after settle
// expect: activeElement is the same row's load button (now "Unload"), NOT BODY
```

**Regression guard:** confirm mouse-driven loads do not steal focus to the button (only restore
focus if the element *had* focus before the toggle).

---

## T1-02 · Announce load start and completion

**Impact: high · Difficulty: low · Risk: None**

**Root cause.** The `aria-live` regions are byte-identical before, during and after a 16-second
load — they contain only "View changed to Split 50/50" and the performance dashboard text (#54).
A screen-reader user gets total silence.

**The pattern already exists in this codebase**: the copy-URL button announces
"URL copied to clipboard" correctly (#71). Reuse that region and that mechanism.

**Change.** Emit short, atomic announcements:
- on click → `Loading Townlands…`
- on success → `Townlands loaded`
- on failure (from T0-05) → `Townlands failed to load`
- on unload → `Townlands removed`

Keep them short and use `aria-atomic="true"`. Do **not** put the layer list in the live region.

**Files:** `js/ui-controller.js`

**Verification:** poll `[aria-live]` innerText at 1 s intervals across a load; expect three
distinct values.

---

## T1-03 · Fix the search live region

**Impact: high · Difficulty: low · Risk: None**

**Root cause.** `js/ui-controller.js:2553` wraps the *entire results markup* in
`<section class="catalogue-search" aria-live="polite">`. Its content is the whole 80-result list,
concatenated without separators (`BallymenaFeatureBallymenaFeature - District Electoral Areas…`).
Typing "Ballymena" fires nine progressive searches, each re-announcing up to 80 results (#137).

**Change.** Move `aria-live` off the results container and onto the **summary only**:

```js
container.innerHTML =
  '<section class="catalogue-search">' +
    '<div class="catalogue-search__summary" aria-live="polite" aria-atomic="true">' +
      /* "N results for X" */ +
    '</div>' +
    '<div class="catalogue-search__results">' + resultHtml + '</div>' +
  '</section>';
```

Additionally **debounce** the search (250–300 ms) so nine keystrokes produce one or two
announcements rather than nine.

**Files:** `js/ui-controller.js` (1 hunk + debounce)

**Verification:** type a 9-character query; count distinct live-region updates. Expect ≤ 3, each a
short summary string.

**Interaction:** land **after T0-01**, so the summary being announced is truthful.

---

## T1-04 · Fix the contrast failures

**Impact: high · Difficulty: trivial · Risk: None**

Measured with a WCAG-formula probe, not by eye:

| Element | Foreground | Background | Ratio | Needs |
|---|---|---|---|---|
| "Support Us" button | `#FFFFFF` | `#22C55E` | **2.28:1** | 4.5 |
| Donate CTA — Substack | `#FFFFFF` | `#22C55E` | **2.28:1** | 4.5 |
| Donate CTA — Ko-fi | `#FFFFFF` | `#FF5E5B` | **3.00:1** | 4.5 |
| Catalogue metadata (16 instances) | `#718096` | `#F7FAFC` | **3.83:1** | 4.5 |
| MapLibre attribution link (dark) | `#8FD3FF` | `#FFFFFF` | **1.62:1** | 4.5 |

**Change.** In `assets/css/main.css`:
- Darken the green to ≈ `#15803D` (white on it ≈ 4.9:1) or switch the label to near-black.
- Darken the Ko-fi red to ≈ `#C2410C`, or use dark text.
- Darken the metadata grey from `#718096` to ≈ `#5A6678` (≈ 4.6:1 on `#F7FAFC`).
- The attribution link case is a **symptom of the un-themed map** — it resolves under T1-06. Until
  then, pin the attribution bar's link colour so it doesn't inherit the dark-theme blue.

**Files:** `assets/css/main.css`

**Verification:** re-run the contrast probe from the audit; expect 0 failures at AA for normal text
in both light and dark.

**Note:** darkening the brand green changes the most visually prominent element on the site. If
the exact hue is a brand decision, the alternative — dark text on the existing green — also passes
and preserves the colour.

---

## T1-05 · Give the site a heading, a title, and a sentence saying what it is

**Impact: high · Difficulty: low · Risk: None**

**Root cause.** No visible heading in any of five sampled application states; the sole `<h1>` is
the wordmark with empty `innerText`; `<title>` is "Civgraph" in every state; there is no footer;
and the only clear descriptions of the project live in `<noscript>` (#37) and behind the donate
button (#109) — i.e. only where users won't see them.

**Change (three parts):**

1. **A real `<h1>`** on the homepage, visually styled as the catalogue heading, e.g.
   *"Maps of Irish administrative geography and history"*. Keep the wordmark as an image with
   `alt="Civgraph"` inside the header, not as the `h1`.
2. **A one-sentence lede** under it, reusing the `<noscript>` copy verbatim.
3. **Per-view `document.title`.** At minimum:
   - default → `Civgraph — maps of Irish administrative geography and history`
   - search → `"Ballymena" — search — Civgraph`
   - feature → `Ballymena (District Electoral Areas 2012) — Civgraph`
   - document → `Provisional Recommendations: District Electoral Areas — Civgraph`
   - books/tables → `Books — Civgraph`

   **`/proni` already does this correctly** (`T3703/1/8 — Independent PRONI Search`). Copy the
   mechanism.

**Files:** `index.html`, `js/ui-controller.js`

**Verification:** sample `document.title` across the five states; expect five distinct values.
Assert exactly one `h1` with non-empty `innerText`.

---

## T1-06 · Wire the dark theme to the dark basemap

**Impact: high · Difficulty: trivial · Risk: Low**

**Root cause.** In dark mode the UI goes to `#0F1419` while the basemap stays fully light — a
white landmass beside a black panel. **The fix is already shipped**: the Map Settings panel offers
14 basemaps including *CartoDB Dark* and *CartoDB Dark (No Labels)* (#77). They are simply not
connected to the theme toggle.

**Change.** When `documentElement.dataset.theme` changes, switch the basemap to the dark variant —
**unless the user has explicitly chosen a basemap this session**. Persist that "user chose" flag so
the theme never overrides a deliberate choice.

```js
// pseudo
onThemeChange(theme) {
  if (this.userPickedBasemap) return;
  this.setBasemap(theme === 'dark' ? 'cartodb-dark' : 'openstreetmap');
}
```

Also theme the map control chrome (zoom cluster, attribution bar) — currently they stay white,
which is what drops the attribution link to 1.62:1 (T1-04).

**Files:** `app/src/app.js` or the basemap controller — **REBUILD: yes**; `assets/css/main.css`

**Verification:** load with `colorScheme: 'dark'`; assert the active basemap id is the dark variant
and that the attribution bar background is dark. Then pick a basemap manually, toggle theme, and
assert the manual choice survives.

---

## T1-07 · Make the header reflow at 320px

**Impact: high · Difficulty: low · Risk: Low**

**Root cause.** Header controls are absolutely positioned and do not reflow. At a 320px viewport
`mobile-menu-btn` has a right edge at **394px** — 74px off-screen — with
`document.scrollWidth === clientWidth`, so there is no scroll to reach it. **The navigation is
unreachable.** Still clipped at 360px (34px off-screen), a live iPhone SE / Galaxy S width. (#100)

**Change.** Convert the header to a flex row with `min-width: 0` on the wordmark and
`flex-shrink: 0` on the controls, so the wordmark truncates before the buttons clip. Below ~360px,
drop the "Support Us" label to its heart icon only.

**Files:** `assets/css/main.css`

**Verification:**
```js
for (const w of [320, 360, 390, 414]) {
  // assert: no element has right > innerWidth + 1
  // assert: .mobile-menu-btn is fully within the viewport and clickable
}
```

**Also fixes:** the OSM attribution being partly covered by the `Aa` button at narrow widths
(#101) — an attribution-compliance issue, not just cosmetic. Give the attribution bar a higher
stacking order or shift the settings button.

---

## T1-08 · Give the three nameless chrome controls accessible names

**Impact: medium-high · Difficulty: trivial · Risk: None**

**Root cause.** `History`, `Active Layers` and `Map Settings` carry only a `title` attribute — no
`aria-label`, no text. Two of them *do* set `aria-expanded`, so a screen reader announces
"button, collapsed" with no indication of what is collapsed (#78).

**Change.** Add `aria-label` to each, matching the tooltip. While in the file, also add:
- `aria-haspopup="dialog"` (or `"menu"`) where appropriate
- `aria-controls` pointing at the panel id
- `aria-pressed` on the **Load/Unload**, **Show/Hide** and **Show variants** toggles (#66, #169,
  #178) — these currently express state only through `title`
- `role="menu"` / `role="menuitem"` on the overflow menu, plus `aria-expanded` and
  `aria-haspopup` on its trigger (#181)

**Files:** `js/ui-controller.js`

**Verification:** assert every visible `<button>` has a non-empty accessible name; assert every
toggle exposes `aria-pressed`; assert every disclosure exposes `aria-expanded`.

---

## T1-09 · Make Escape close overlays

**Impact: medium-high · Difficulty: low · Risk: Low**

**Root cause.** Of six overlays, only the donate modal closes on Escape. The overflow menu also
ignores click-outside — the most universal dismissal convention there is. Worse, `aria-expanded`
stays `"true"` after a failed Escape, so AT is told the panel is open after the user tried to
close it (#82, #180).

| Overlay | Escape | Click outside |
|---|---|---|
| Donate modal | closes | – |
| Map Settings | ignored | – |
| Active Layers | ignored | – |
| Feature Details | ignored | – |
| Overflow menu | ignored | **ignored** |
| Mobile menu | ignored | – |

**Change.** One shared dismissal helper, applied to all six: Escape closes the topmost overlay;
click-outside closes menus and popovers; `aria-expanded` is reset on close; focus returns to the
trigger.

**Files:** `js/ui-controller.js`

**Verification:** for each of the six, open → Escape → assert closed and `aria-expanded="false"`
and `document.activeElement === trigger`.

---

## T1-10 · Add a legend

**Impact: high · Difficulty: medium · Risk: Low**

**Root cause.** There is no legend anywhere in the application, for any layer type. Measured
absent with polygons, lines, rasters, point clouds and election choropleths loaded. Consequences,
in ascending severity:

- two Counties layers render in identical blue with no way to tell 1957 from 1977 (#21)
- an election choropleth's party colours have no on-map key (#97)
- **a quantitative geophysics raster has no colour bar, no units and no value range** — which
  turns published survey data into an abstract image (#175)

**Change.** A collapsible legend panel, one block per loaded layer:
- vector → the swatch (the app already stores `STYLE: Color: #00A9E6, Weight: 2`) + layer name
- election → party swatches with names (reuse the results-table swatch data)
- raster → a colour bar with min/max and **units** from the layer metadata
- point cloud → the elevation/RGB ramp

Default open when ≥ 1 layer is loaded. The detail pane already renders a single swatch beside a
feature name (#—) — that is the visual vocabulary to extend.

**Files:** `js/ui-controller.js`, `assets/css/main.css`, possibly layer metadata for raster units

**Verification:** load one of each layer type; assert a legend block exists per layer, with a
swatch, and for rasters a min/max and unit string.

**Prerequisite for full value:** T2-02 (party colours), else the election legend shows many
identical greys.

---

# TIER 2 — significant fixes, larger surface

---

## T2-01 · Fix the PRONI export filter mismatch

**Impact: high · Difficulty: medium · Risk: Medium**

**Root cause.** For `Templepatrick Barr` the UI shows **18 results**; `GET /_api/proni/export?q=…`
returns **10,284 rows** (1.13 MB) — 571×. Only 25 rows contain "Templepatrick" and 71 contain
"Barr", so >99% match neither term. The endpoint *does* filter (`q=zzzznothing` → 197 bytes,
headers only), so the two paths use **different query semantics**. Two terms return fewer rows
(10,284) than one term alone (18,927), so it isn't a naive OR either.

Scale hazard: `q=Barr` → **275,508 rows / 39.1 MB** from a single click, with no size warning, no
confirmation and no progress (#195).

**Change.**
1. **Unify the query.** `functions/_api/proni/export.js` and `functions/_api/proni/search.js`
   should share a single query builder in `functions/_api/proni/_query.js` (which already exists —
   verify whether both currently use it).
2. **Add a pre-flight count.** Before exporting, call `/_api/proni/count` (exists) and show
   *"Export 18 records (~4 KB)?"* with a confirm for anything over, say, 5,000 rows or 5 MB.
3. **Announce completion** via `role="status"` (#194).

**Verification**
```bash
for q in "Templepatrick+Barr" "Barr" "Templepatrick"; do
  ui=$(…count via /_api/proni/count?q=$q…)
  rows=$(curl -s "https://civgraph.net/_api/proni/export?q=$q" | wc -l)
  echo "$q ui=$ui export=$((rows-1))"
done
```
**Pass:** `ui == export` for all three.

**Risk note.** Changing export semantics changes what existing users receive. If anyone depends on
the current broad export, ship the narrow export as the default and keep the broad behaviour behind
an explicit "export all matching any term" option.

---

## T2-02 · Fix the party colour fallback

**Impact: medium-high · Difficulty: low–medium · Risk: Low**

**Root cause.** `app/src/app.js:1519`:

```js
colour: item.colour || item.color || item.partyColour || '#6b7280',
```

`#6b7280` is a single shared fallback. Named colours live in two hardcoded maps —
`PARTY_COLOURS` (**30 entries**, `app/src/election-manager.js:67`) and `ROI_MAIN_PARTY_COLOURS`
(**25 entries**, `:101`), overlapping — against **780 party/label records**. So ~95% of parties
render as one grey. On a 1922–2024 trends chart, every defunct party collapses into one
indistinguishable line, and the effect **worsens the further back you look** (#213–215).

Keys are lowercased **name strings** (`'sinn fein'`, `'the labour party'`), so any name variant,
merger, rename or diacritic difference silently falls through — the `'labour'` / `'irish labour'` /
`'the labour party'` triple shows the team already patching this one alias at a time.

**Change.**
1. **Move colours into the party data** (`/browse` Parties holds 780 records) so the lookup is by
   stable id, not by name string.
2. **Generate a deterministic distinct colour** for any party still unmapped — hash the party id
   into an OKLCH hue with fixed lightness/chroma. Two unknown parties then differ from each other,
   which is the property that actually matters on a chart.
3. **Keep `#6b7280`** only for genuinely unknown/blank party values.

**Verification:** load the 1929 election; assert the results table has no two distinct parties
sharing a swatch colour. Load Trends; assert ≥ 7 distinct series colours for 8 series.

---

## T2-03 · Surface unmatched-geography before the click

**Impact: high · Difficulty: medium · Risk: Low**

**Root cause.** **265 of 282 elections (94%)** carry unmatched constituencies. The severe ones
render almost nothing: 1929 UK general is *10 constituencies; 9 unmatched* — you wait 20 s and get
a basemap. The disclosure exists at three levels and none is a warning: the row metadata says
"9 unmatched" in the same grey italic as the provider credit; the post-load message is excellent
text with no `role="status"`; the "+" button looks identical to one that works (#216–220).

**Change.**
1. **Badge the row** where unmatched exceeds a threshold (say > 20% of constituencies):
   *"⚠ 9 of 10 areas unmapped — will draw partially"*, styled as a warning, not metadata.
2. **Disable or visually de-emphasise "+"** where unmatched is ≥ ~90%, with the reason in the
   tooltip and accessible name.
3. **Give the post-load message `role="status"`** so it is announced.
4. Keep the message text — it is the best error copy on the site.

**Verification:** assert every election row whose metadata contains "unmatched" renders the badge;
assert the post-load message has `role="status"`.

---

## T2-04 · Restore `/about` and `/census`, or remove them

**Impact: medium-high · Difficulty: low (remove) / medium (build) · Risk: Low**

Two of five primary nav items are dead — they serve the homepage with "Home" highlighted, and
after T0-02 they will serve a 404, which is *worse* for a nav link.

**This item must land in the same release as T0-02.**

- **`/about`** — build it. The content already exists, written, in the donate modal and the
  `<noscript>` block: what Civgraph is, who makes it, why, and the CC BY-SA 4.0 licence. Move that
  copy to a real page and link it from a real footer (the site has none; `/proni` has the only
  one).
- **`/census`** — decide. If it was meant to be a filtered catalogue view, wire it to the Census
  Data category. If not, remove the nav item.

**Verification:** every `.app-header__link` resolves to a 200 with a distinct `<title>` and sets
its own active state.

---

## T2-05 · Make the census layers load, or mark them clearly

**Impact: medium · Difficulty: medium–high · Risk: Low**

**Root cause.** Census Data is the **only** one of 16 categories that fails (15/16 load fine). The
failure is inconsistent: one run produced *"…is not supported for the MapLibre route yet"* — a
developer-facing message, partly hidden behind the Map Settings button, transient — and another
produced **nothing at all for 28 seconds**, with the button never leaving "Load" (#157–164).

**Change (in order of preference):**
- **(A)** Implement census layers on the MapLibre path.
- **(B)** Until then: mark every census row as unavailable *before* the click (disabled "+", reason
  in the accessible name), replace the message with user-facing wording
  (*"Census layers aren't available on the new map yet."*), give it `role="status"`, make it
  persistent rather than transient, and **fix the z-order so the Map Settings button doesn't cover
  it** (#158).

---

## T2-06 · Tame the default view of huge layers

**Impact: high · Difficulty: medium · Risk: Medium**

**Root cause.** Loading Townlands (Ireland) — the first entry under the first category — renders
~60,000 polygons in solid orange with thousands of overlapping ALL-CAPS labels at z6.3, 14 seconds
after the click. The basemap's own labels are not suppressed, so `LIMERICK` prints over `Limerick`
(#5, #22).

**Change.**
1. **`minzoom` for labels** on dense layers — suppress feature labels below a per-layer threshold.
2. **Suppress basemap labels** (or switch to a no-labels basemap variant — *CartoDB Dark (No
   Labels)* already exists, add a light equivalent) when a labelled layer is active.
3. **Default fill opacity < 100%** for area layers so the basemap remains legible.
4. **A "zoom in to see detail" hint** when a layer is loaded below its label threshold.

**Risk:** changing default styling affects every existing share link's appearance. Ship behind the
existing per-layer style metadata rather than as a global override where possible.

---

## T2-07 · Per-view URLs and titles for the remaining views

**Impact: medium · Difficulty: medium · Risk: Low**

The URL schema is genuinely good — `layers`, `layerOrder`, `hidden`, `lng/lat/zoom`, `q`,
`featureId`, `electionBody` all round-trip. The gaps:

| View | Linkable? | Finding |
|---|---|---|
| Documents (book viewer) | no | #126 |
| Catalogue tabs (Elections/Maps/Books/Tables) | no (Books writes a wrong hash) | #52, #116 |
| Election sub-views (By Party/Candidate/Local Party/Trends) | no | #152 |
| `/proni` searches | no (records **are** linkable) | #59 |
| `/browse` searches | no | #211 |

**Change.** Extend the existing hash schema for the first three; add `?q=` to `/proni` and
`/browse` searches. Also fix `og:url` to reflect the current path (T0-03 deferred this).

**Sub-item T2-07a — stop the anchor hash clobbering the map hash.** Clicking a TOC row writes
`#flat-card-flat-counties`, destroying `lng/lat/zoom`, and if the user copies the share URL in that
window they get `#flat-card-flat-counties=&layers=…` with no viewport (#7, #70). Namespace the
scroll anchors separately from the state hash, or scroll via JS without writing to `location.hash`.

---

## T2-08 · Keyboard-operable search

**Impact: medium-high · Difficulty: medium · Risk: Low**

**Root cause.** The field has a correct `aria-label` and nothing else: no `role="combobox"`, no
`aria-expanded`, no `aria-controls`, no `aria-activedescendant`; results have no `role="option"`
and no ids. Arrow keys do nothing, Enter selects nothing, and Tab goes into the page chrome rather
than the results (#185–188). Mouse users get an excellent result-activation flow (#87); keyboard
users get a text field.

**Change.** Implement the standard combobox/listbox pattern: `role="combobox"` +
`aria-expanded` + `aria-controls` on the input; `role="listbox"` on the container; `role="option"`
+ ids on results; `aria-activedescendant` following ArrowUp/ArrowDown; Enter activates the
highlighted option; Escape closes.

**Verification:** type, ArrowDown ×3, assert `aria-activedescendant` advances and the highlighted
option changes; Enter, assert the same outcome as a mouse click (layer loads, map flies, deep link
written).

---

## T2-09 · Paginate the `/browse` section listings

**Impact: medium · Difficulty: medium · Risk: Low**

**Root cause.** Register Interests renders **3,072 rows / 74,607px**; Persons **4,047 rows /
84,937px desktop and 146,302px on mobile — 220 viewport-heights**. No pagination, no A–Z index, no
back-to-top. The truncation notice sits at the very bottom, so you must scroll 220 screens to learn
the list was capped (#204, #207).

Caps are inconsistent: Parties shows **780 of 780**; Persons **500 of 13,113**; PRONI **800 of
9,404**; Register Interests **500 of an undisclosed total** (#205, #212).

**Change.** Real pagination (or windowed virtual scrolling), a consistent cap, a **count at the
top** stating "showing X of Y" in every section, and a back-to-top control. Adopt the Parties
page's phrasing — "780 of 780 records" — everywhere, since it states both numbers even when
nothing is truncated.

**Note:** performance is *fine* (61 fps, 48 MB heap, 6,598 nodes). This is purely information
architecture.

---

## T2-10 · Give record listings table semantics

**Impact: medium · Difficulty: medium · Risk: None**

3,072 register-of-interests rows and 4,047 person rows are rendered without `<table>`, so
structured data — member, date, payment, hours, registration date — is presented as unstructured
text runs with no column headers and no programmatic relationships (#206). The catalogue similarly
has zero list semantics (`ul`/`ol`/`li` count: 0) for 1,011 entries.

The Tables view *does* use a `<table>` but with **no `<caption>`, no `aria-label`, and zero
`scope` attributes** on its five `<th>`s, is not sortable while the election table is, and its
scroll wrapper has `overflow-x: auto` with **no `tabindex="0"`** so keyboard users can't scroll it
(#134).

**Change.** Use `<table>` with `<caption>`, `scope="col"`, and a focusable scroll container for
tabular content; use `<ul>/<li>` for the catalogue list.

---

# TIER 3 — polish, consistency, hygiene

Grouped; each bullet is individually atomic.

## T3-01 · Copy and labelling

- `1011 maps` → `1,011 maps` — the only unformatted number on the site (#111)
- `Dáil Eireann` → `Dáil Éireann` (#112)
- Expand or gloss `EONI`, `TÉ`, `CSO`, `NUTS 2/3`, `FGB` (#113, #16)
- Remove bracketed internal codes `[all] [com] [his] [gov] [svc] [geo] [built]` from the UI (#51)
- Fix raw slugs leaking as labels: `fire-stations`, `heritage`, `landscape`, `museums`, `parking`,
  `planning`, `regional-divides` (#12)
- `Organizations` → `Organisations` — the only Americanism (#142)
- Unify `Close` / `Close panel` / `Close settings`; disambiguate the four controls whose tooltip is
  just `Show` (#115)
- Fix `"…in Northern Ireland contests in Northern Ireland"` (#155)
- Reconcile `1011 maps` (homepage) vs `992` (/browse) (#14)
- Reconcile Explore facet sums (751 and ~478) against "All 1011" (#140)
- Rename the "Filter by Provider" facet — its values are jurisdictions (#141)
- Remove `SHOW n TO BE ADDED` roadmap buttons from production (#98)
- Card date ranges that contradict contents: Counties says `1899-1977`, contains 1915–1977 (#30)

## T3-02 · Production hygiene

- Rename `*-vector-test.pmtiles` → drop `-test`; likewise `test/metadata/*` (#146, #150)
- Remove `leaflet-control-*` and `test2-*` class names from the MapLibre map (#17)
- Remove the performance dashboard and its "Refresh performance status" button from user-facing
  Map Settings, or move it behind a debug flag (#18, #81)
- Migrate `localStorage` keys `ni-boundaries.*` → `civgraph.*` with a one-time read-through
  migration (#110)
- Add `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security` to `_headers`
  (`_headers` already exists) (#20)

## T3-03 · Target sizes and focus indicators

- Raise all controls to ≥ 24×24 (WCAG 2.2 AA): panel buttons at 22×22, the sources `ⓘ` at 22×22,
  election view tabs at 23px tall, section tabs at 49×15, A–Z buttons at 34×32 (#27, #57, #63,
  #148, #152)
- Raise mobile targets to ≥ 44px — 14 controls fail on the homepage, 35 on `/proni` (#4, #63)
- Add visible focus rings to the five primary nav links, the theme toggle, and **the search input**
  (currently no outline and no box-shadow) (#12/#57)
- Make the skip links visible on focus — they remain 1×1 and off-screen even when focused (#12)

## T3-04 · Print

Print output is **104 characters**: an empty basemap with the zoom buttons burned in, plus the two
skip links and the live-region text as the only prose (#35, #36).

- Hide interactive chrome and screen-reader-only text in `@media print`
- Print the catalogue/detail content, the loaded layer list, the legend, the date, and attribution
- Consider a dedicated print stylesheet for the feature/record detail views, which are the things
  people actually want on paper

## T3-05 · Offline

The service worker serves a fallback that is the single word **"Offline"** with an **empty
`<title>`**, no branding, no retry and no explanation (#38). Give it the 404 page's treatment.

## T3-06 · Dialog semantics and focus management

- `role="dialog"` + `aria-modal` + accessible name on the donate modal, the record modal
  (`.ps-modal`), Feature Details and Active Layers (#56, #106, #199)
- Focus trap + focus-on-open + focus-return-on-close for true modals
- `inert` or `aria-hidden` on the background while a modal is open (#106)
- Restore focus after the PRONI `⧉ Copy` button, which currently drops it to `<body>` (#200)

## T3-07 · Layer panel and layer types

- Show which layer is hidden in the Active Layers list — hidden and visible entries look identical
  (#179)
- Name layers consistently in the panel: Townlands appears as `Ireland`, Counties 1957 as
  `Counties of Ireland 1957 1957` (#29)
- Keyboard alternative to drag-to-reorder (currently a 16px drag handle only) — WCAG 2.1.1 (#25)
- Accessible names on the opacity range/number inputs (currently empty) (#26)
- Per-type styling controls: `Stroke %`/`Fill %` are meaningless for rasters, lines and point
  clouds; rasters need a single opacity slider, point clouds need point size (#172, #176)
- Add pitch/tilt controls and `pitch`/`bearing` to the URL for 3D layers (#170, #171)
- Resolve the "Fill Transparency 100%" label that renders an opaque fill (#80)
- Stop layer loads from hijacking the viewport (#28)
- Invalidate the Feature Details panel when layers change; clear accumulated selection highlights
  (#24)

## T3-08 · Election view

- Sync the timeline to the loaded election — it reads `15 Nov 1922` for a 2024 election (#95)
- Refit the map when the results panel takes half the screen — currently 12 of 18 constituencies
  are below the fold (#96)
- Give the Trends chart enough height to show its own x-axis (#154)
- Unique column names in the results table (four columns named `+/-`, three `No.`, two `%`) (#99)
- `role="tablist"`/`role="tab"`/`aria-selected` on the four election view buttons (#152)

## T3-09 · Miscellaneous correctness

- The **History** button records nothing and does nothing — no storage key is written after three
  searches. Either implement search history or remove the control (#168)
- Fix the "Books" tab, which selects nothing and leaves `aria-selected` on Tables (#49)
- Fix the Tables tab leaving the hash at `#flat-section-books` (#116)
- Remove or populate the empty "Contributor submission" section on `/browse` (#202)
- Make the Explore tab visible — it is 0×0 yet keyboard-focusable, hiding a faceted browser with
  provider filtering that exists nowhere else (#64, #65)
- Point the contributor login `redirect_url` back to `/browse` rather than `/_api/auth/status`
  (#75)
- Move the `CONTRIBUTOR` `<h2>` below the `<h1>` on `/browse` (#40)
- Label the six unlabelled fields in the PRONI advanced panel; validate inverted date ranges (#189,
  #190)
- Add `lang="ga"` to Irish-language text (#138)
- Add skip links to `/browse`, `/apps`, `/proni` (#41)
- Label the duplicate `<header>`/`<nav>` landmarks on `/browse` (#42)
- Fix the two `Show catalogue` / `Show or hide catalogue` mobile toggles to one wording (#104)
- Dismiss the mobile catalogue after a load so the user can see the result (#105)
- Add a theme toggle to the mobile menu — dark mode is currently unreachable on mobile (#183)
- Generate thumbnails for the 62 of 131 entries showing placeholders; fix the one broken image
  (#114)
- De-duplicate the book cards' twin thumbnails; state the Markdown disclaimer once per section
  (#119, #120)
- Consistent document date formats — `August 1992` / `25 November 1992` / `January 1984` (#121)
- Add a copy-link affordance to PRONI record pages (#191) and make the record `h1` the record, not
  the app name (#192)

---

# Sequencing

```
Release 1  (Tier 0)          T0-01 → T0-02 → T0-03 → T0-04 → T0-05
                             plus T2-04 (nav links) — MUST ship with T0-02
Release 2  (a11y core)       T1-01, T1-02, T1-03, T1-08, T1-09, T3-03
Release 3  (visual/theme)    T1-04, T1-06, T1-07, T1-05, T1-10
Release 4  (data integrity)  T2-01, T2-02, T2-03, T2-05
Release 5  (IA + keyboard)   T2-06, T2-07, T2-08, T2-09, T2-10
Rolling                      Tier 3
```

**Hard ordering constraints**

- `T0-02` before `T0-03`, `T0-04`, `T2-04` — you cannot verify a missing asset until 404s exist
- `T2-04` **with** `T0-02` — otherwise two nav links go from wrong to 404
- `T0-01` before `T1-03` — announce a truthful count
- `T2-02` before `T1-10` — otherwise the election legend is a column of identical greys
- `T0-05` before `T1-02` — the announcement needs a real verdict to announce

---

# Do not "fix" these — they are correct

Verified working during the audit. Changes near them need a regression check.

- **The load control's concurrency handling.** Triple-clicks, mid-flight re-clicks and concurrent
  loads produce no double-loading, no stuck spinners, no state divergence. The 20 s cap fires to
  the second. Only its *resolution value* is wrong (T0-05).
- **URL state.** `layers`, `layerOrder`, `hidden`, `lng/lat/zoom`, `q`, `featureId`, `electionBody`
  all round-trip; `replaceState` keeps panning out of history; reload restores exactly.
- **Search-result activation** (mouse): loads the layer, flies to the feature, writes a complete
  deep link.
- **`/proni` record URLs**: `/proni/T3703/1/8` loads cold with a per-record `<title>` and the full
  archival hierarchy.
- **Homepage landmarks**: "Main navigation", "Map catalogue and information", "Map" as
  `role="region"`, "Layer sources".
- **The mobile menu**: real `aria-label`, correct `aria-expanded`, 45–46px targets.
- **The copy-URL button**: correct feedback and a correct `aria-live` announcement — the model for
  T1-02.
- **Data plane**: 11/11 sampled tile and data files resolve correctly.
- **Performance**: zero console errors and zero 4xx across 49 iterations; 61 fps on an 85,000px
  page; no memory growth across load/unload cycles.
- **Editorial quality**: the sources panel's citations, the `<noscript>` fallback, the donate
  modal's copy, the PRONI footer disclosure, and the unstyled-rows message are all well written.
  Several fixes above consist of *moving this existing good copy somewhere users can see it*.

---

# Corrections carried forward from the audit

Six audit claims were wrong and were retracted before this plan was written. Do not act on them:

1. The catalogue is **not** server-rendered (inline JSON was miscounted as text).
2. Feature clicks **do** work — the panel is custom, not `.maplibregl-popup`.
3. A basemap switcher and opacity controls **do** exist, behind the `Aa` button.
4. The mobile catalogue **is** reachable via a properly-labelled toggle.
5. `/proni` **does** have URL state — for records, though not for searches.
6. One load flipping three buttons to "Unload" is **correct** — they are three entry points to one
   layer.
