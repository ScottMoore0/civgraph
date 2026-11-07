# Interface languages: English, Irish, Ulster-Scots (PREVIEW, DRAFT)

Civgraph can show its interface in **Irish (Gaeilge)** and **Ulster-Scots (Ulstèr-Scotch)** as
well as English. This is a **preview**. It is hidden on the live site, and every Irish and
Ulster-Scots text is a **draft**. Nothing here should go public until a fluent speaker has
reviewed it and the owner has approved it.

## Switching the preview on and off

The language control appears only for a browser that has opted in, and nothing on the site says
how: no hint in the interface, no help text, no listing (the owner's rule, 6 November 2026).

| To | Do this |
|---|---|
| Turn the preview on | Type the phrase held in `LANGUAGE_PHRASE` (`src/catalogue/lang-reveal.js`) into the Maps page search box as the whole query (any case; surrounding spaces and punctuation ignored). The search answers with one line saying the language options are now shown, and the control appears. This sets `localStorage['civgraph.langPreview'] = '1'`, so it stays on in that browser, on every page. Only typing counts: the phrase arriving in the address (`#q=`) reveals nothing, and `?lang-preview=1` no longer does anything. |
| Pick a language | Use the **Language / Teanga** control in the header (in the menu on a phone). Or add `?lang=ga`, `?lang=sco` or `?lang=en` to the address. |
| Share a link in a language | Copy the address. It carries `?lang=ga`, which selects Irish for anyone who also has the preview on. |
| Turn the preview off | The x (Hide language options) in the control: the page returns to English, the control goes, and the flag and the saved language are cleared. Or open any page with `?lang-preview=0`, or run `civgraphI18n.hide()` in the console. |

Without the flag, the page never requests the language runtime or its files: the site-head
bootstrap is a few hundred bytes inline, and the phrase check is a few lines in the catalogue's
own chunk. `?lang=ga` on its own does nothing, so the live site is unchanged even with this code
merged (`tests/i18n/i18n.spec.cjs` checks this, and that the phrase, and only the phrase,
reveals the control).

To try it locally:

```
node tools/test-site/server.mjs --port 4177
# open http://127.0.0.1:4177/maps/ and type the phrase into the search box
```

## Going live (owner's decision, later)

1. Have every string in `review/strings-ga.tsv` (and `strings-sco.tsv`) reviewed. Record the
   reviewer in `META.<lang>.reviewedBy` in `scripts/i18n/build-i18n.mjs`.
2. Have `review/map-names.tsv` reviewed as well. Its names are machine-composed.
3. In `functions/_templates/shell.js` (`head()`, the language bootstrap), replace the flag test in the bootstrap script with
   "always load", and drop the Hide action (`assets/i18n/i18n.js`) and the phrase check
   (`src/catalogue/lang-reveal.js`). Then run `node scripts/build-site-partials.mjs`.
4. Add the Logainm attribution line (see Sources) to the About page and the map attribution.

## How it works

- **`assets/i18n/i18n.js`** is the runtime. It is a plain script that is loaded on demand.
  - It reads `en.json` (every key's English, and the fallback) and `<lang>.json`.
  - It translates the page by key:
    - `data-i18n="key"`, `data-i18n-html="key"` and `data-i18n-attr="title:key"` mark keyed elements.
    - Every other text node and every `title`, `aria-label`, `placeholder` and `alt` is looked up
      by its English wording through the keys.
  - A MutationObserver handles whatever the application renders later.
  - **Composite strings** are matched as patterns:
    - `"{n} maps"`, `"{name}: editions"` and `"01 Nov 1957 · Phelim Birch · 32 Counties"` are
      translated a part at a time (see `strings/patterns.txt`).
    - Typed placeholders (`{n}` is a number, `{year}` four digits) stop a pattern matching the
      wrong text.
  - **Fallback:**
    - A string with no translation stays English.
    - `t(key)` falls back to `en.json`, then to the key itself.
  - **Persistence:** the choice is saved in `localStorage['civgraph.lang']` (wrapped in
    try/catch) and in `?lang=` in the address.
  - **`<html lang>`** becomes `ga` or `sco-ulster`, and is restored to the page's own value for
    English.
  - **Numbers and dates:**
    - `civgraphI18n.formatNumber/formatDate` use Intl with `ga-IE` (`en-GB` for Ulster-Scots,
      which has no Intl locale data).
    - Dates written `01 Apr 1969` / `Apr 1969` get the CLDR Irish month abbreviations (Ean,
      Feabh, Márta, Aib...). These come from `strings/general.txt`, because not every browser
      build ships Irish Intl data.
    - Irish uses the same digit grouping as English, so numbers look the same.
  - **Layout:**
    - Longer Irish strings may wrap.
    - The header control takes little space: the "Draft" badge is absolutely positioned.
    - The tests check 375 px pages for horizontal scroll.
- **Map labels and feature details**
  - `render/src/labels.js` (`irishNameProperty`) puts the layer's own Irish-name property first
    when Irish is on. `render/src/map-controller.js` (`applyLabelLanguage`) re-labels when the
    language changes.
  - The feature details pane (`src/ui-controller.js`) shows the Irish name, then
    "Ainm Béarla: <English>".
  - Features with no Irish name keep their English label.
- **Bootstrap:** a few lines in the shell head (`functions/_templates/shell.js` `head()`) decide whether to load the runtime.
  Every page with the shared head has them.

### BCP-47 tags

- Irish is `ga`.
- Ulster-Scots is **`sco-ulster`**. That is `sco` (ISO 639-3, Scots) plus the IANA-registered
  variant subtag `ulster` ("Ulster dialect of Scots", registered 2010). It is the most specific
  valid tag, so screen readers and search engines are told what the text is.
- The file is `sco.json`, because file names need not carry the variant.

## Files

| Path | What |
|---|---|
| `data/i18n/strings/*.txt` | **The translations**, one per surface: chrome, catalogue, catalogue-names, app, browse, pages, general, units, patterns. Each line is `English ¦ Irish ¦ Ulster-Scots`; `@key` sets an explicit key. Edit these. |
| `data/i18n/map-name-glossary.txt` | Phrase glossary for composing Irish map names. |
| `data/i18n/map-names.overlay.json` | **Map-name overlay**, keyed by `maps.json` id (generated). `maps.json` itself is not touched. |
| `assets/i18n/en.json`, `ga.json`, `sco.json` | Built language files (`_status: "draft"`). |
| `assets/i18n/names.ga.json` | English map / layer / Dáil constituency name to Irish, from the overlay. |
| `assets/i18n/place-name-fields.json` | Layer id to the tile property holding its features' Irish names (generated). |
| `data/i18n/review/` | **Review lists:** `strings-ga.tsv`, `strings-sco.tsv`, `map-names.tsv`, `place-name-fields.tsv`, `untranslated-ui.txt`, `coverage.json`. |
| `data/i18n/place-names/` | Summary and sample of the Irish place-name crosswalk (the full crosswalk is in `E:\civgraph-i18n`). |
| `scripts/i18n/` | The build, check, harvest and fetch scripts (below). |
| `tests/i18n/` | Playwright tests (`npm run test:i18n`). |

### Scripts

```
npm run i18n:build      # place-name fields, map-name overlay, language files
npm run check:i18n      # all three --check (part of npm run check)
npm run test:i18n       # browser tests: toggle, persistence, fallback, flag off, 375px
node scripts/i18n/extract-ui-strings.mjs --missing --review   # candidate strings with no key
node scripts/i18n/harvest-untranslated.mjs                     # what still shows in English (needs a local server)
node scripts/i18n/build-place-name-crosswalk.mjs               # Irish names per feature, from local source data
LOGAINM_API_KEY=... node scripts/i18n/fetch-logainm.mjs        # Logainm API (needs the owner's key)
```

## Sources and their terms (checked 2026-11-01)

| Source | Use here | Terms |
|---|---|---|
| **téarma.ie** (National Terminology Database, Foras na Gaeilge) | Individual terms, looked up one by one. Examples: dáilcheantar/toghcheantar, toghroinn, baile fearainn, barúntacht, paróiste sibhialta, daonáireamh, iarrthóir, cuóta, toghthóirí, corrthoghchán, olltoghchán, léarscáil, sraith, catalóg, íoslódáil. | © Foras na Gaeilge. The downloadable term list is for personal use only and may not be republished. Using individual terms in a translation is ordinary use. The database is not reproduced. |
| **Logainm** (Placenames Database of Ireland) | The Irish place names already in Tailte Éireann / CSO data. Also the API pipeline `fetch-logainm.mjs`: not run, because it needs a key. | **CC BY 4.0**, © Government of Ireland. Attribution: "Irish-language placename data by Logainm © Government of Ireland and licensed under CC BY 4.0." Explanatory notes and citations are **not** CC BY and must not be reproduced. **Do not scrape the website.** Only the API is used, and it needs a per-client API key that the owner must register for. Copies must be refreshed monthly. |
| **Tailte Éireann** (ex-OSi) boundary data | `GAEILGE` and `GLE_NAME_VALUE` attributes already in our tiles (townlands, EDs, counties, constituencies). | **CC BY 4.0**, "© Tailte Éireann". |
| **CSO** boundary files | `ED_GAEILGE` / `COUNTY_GAEILGE` (EDs 2022) | **CC BY 4.0**, "© Central Statistics Office & Tailte Éireann". |
| **OpenStreetMap** / townlands.ie | `name:ga` / `name_ga` (baronies, civil parishes) | **ODbL**, © OpenStreetMap contributors. townlands.ie was last updated in April 2022. |
| **placenamesni.org** (NI Place-Name Project, QUB) | **Not used.** No licence is stated, so all rights are reserved. | Ask the project first. A permission request to Prof. Mícheál Ó Mainnín (QUB) would open up Irish forms for Northern Ireland townlands. Many NI names are also in Logainm. |
| **Dáil constituency names** | `data/database/dail-constituency-names-bilingual.json` (already on site) | Official bilingual names. |
| **Ulster-Scots** | NI Assembly Ulster-Scots leaflet (Norlin Airlan, Assemblie, waled in, Pairlament); NISRA 2001 census leaflet (coont, cooncils, wittins, leid, kintra, airt, yeir, fowk); Derry City & Strabane council logo (Cooncil, Destrick, Cittie); NILS/QUB summary endorsed by DfC (Depairtment fur Commonities); the Ulster-Scots Agency's own name, Tha Boord o Ulstèr-Scotch (Ulstèr-Scotch, o). | Individual words only. There is no settled standard. "Hame" and "Aboot" are common Scots spellings that were **not** found on an official page. They are flagged for review. **No Ulster-Scots place names**: no official source gives them. |

## Coverage (2026-11-01)

- **Interface strings:** 1,828 keys.
  - Irish: 1,828 (all keys).
  - Ulster-Scots: 34, deliberately conservative. The rest falls back to English.
- **Map names (`maps.json`):**
  - Irish: 639 of 1,104, composed from the glossary.
  - Layer names: 685 of 1,250.
  - Dáil constituency names: 93 (official).
  - Ulster-Scots: none.
- **Descriptions:** in English. Every map with one is marked `descriptionUntranslated` in the
  overlay and in `review/map-names.tsv`.
- **Place names in Irish on the map:** 291 layers pair their label with an Irish-name property.
  The local crosswalk counts:
  - about 79,000 townland and 28,000 ED feature names;
  - 337 baronies;
  - 293 civil parishes (Connacht source on disk; the other provinces' tiles carry them too);
  - counties, from the Tailte Éireann `GAEILGE` attribute.
  - Northern Ireland townlands, counties and wards have no Irish name in our data. That needs
    placenamesni.org permission or Logainm.

## Left in English, and why

- **Long prose:** the About page paragraphs and the home page story. They were too long to
  draft responsibly in one pass. They are listed in `review/untranslated-ui.txt`.
- **Map descriptions, source notes and Browse record text.** These are data, not interface.
- **Map names the glossary cannot fully compose.** Examples: "Planning Application Points -
  Roscommon", "Speed Signs (DLR)". Partial Irish would be worse than English. They are listed
  with their missing words in `review/map-names.tsv`.
- **Proper names:** people, parties, organisations and products (Tellus, OSNI, PSNI,
  Translink).
- **Text inside SVG charts** (trend charts, the home page constellation) and the MapLibre
  attribution, which are drawn by libraries.
- **PRONI Search** (`apps/proni-search/`). It has its own header and is not wired to the
  runtime yet.
- **Ulster-Scots:** everything without an attested form.
