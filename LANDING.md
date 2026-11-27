# w24-qub-app: the Independent QUB Catalogue (local only) and its Civgraph scope labels

Branch w24-qub-app from main 9d5d924e9e. Owner-approved 27 Nov 2026. **Not pushed, published, deployed or
uploaded; no Cloudflare resource was created; QUB was not contacted.**

## What it is

An app at `/qub` and `/qub/<mms_id>`, modelled on the Independent PRONI Search, over the QUB Library catalogue
harvest (private intake, E:\civgraph-qub-catalogue; working copy D:\civgraph-intake\qub-app\):

- search (FTS5 over title, author, subjects, notes/series/contents) with the filters **Within Civgraph scope**
  (default on; "All records" and "Outside of Civgraph scope" also offered) and the topic tags A–H (a record must
  have every tag ticked), a year range, and sort by relevance, year or title;
- record pages with the main fields (title, responsibility, author and other names, uniform and variant titles,
  edition, imprint, date, extent, format, language, series, notes, contents, summary, subjects, ISBN/ISSN,
  government document number, LC and Dewey class, shelf mark, QUB holdings, online links), the Civgraph scope
  label with its tags, reason and method;
- **every record links to its record in QUB's catalogue** (Primo VE full display,
  `https://qub.primo.exlibrisgroup.com/discovery/fulldisplay?docid=alma<MMS ID>&context=L&vid=44QSUB_INST:QUB&lang=en`;
  qublibsearch.qub.ac.uk redirects to that view), on the result card, the record page and every CSV row, and
  carries the credit to QUB Library, noting that some records derive from shared sources such as OCLC WorldCat
  (the reuse condition of QUB's metadata reuse policy: not-for-profit reuse with a link back to each record);
- CSV export of a search, capped at 50,000 rows as PRONI's is, ending with the credit.

Pages are `noindex`, unlinked from the site's navigation and not in any sitemap.

## Safe to land: nothing goes live

`QUB_DB` is declared in packages/config (optional, `environments: []`) and **not bound** in wrangler.toml, so
on Pages `/qub` and `/qub/*` answer 404 and `/_api/qub/*` answer 503 until the owner approves a deployment.
site/_routes.json includes `/qub` and `/qub/*` (check:routes-manifest requires every Function to be routed).

## Files

- packages/api/src/handlers/qub/: `_query.js` (pure: parameters, FTS match, filters, the QUB permalink, the
  credit, the topic names), `search.js`, `record.js` (a record; with no id the figures), `export.js`, `page.js`
  (the /qub shell with a record's own title and description; 404 for an unknown id).
- packages/api/src/queries/qub.js: the named SQL.
- functions/qub.js, functions/qub/[[path]].js, functions/_api/qub/{search,record,export}.js: route entry points.
- site/apps/qub-catalogue/: index.html, app.css, app.js (wiring only), api.js (the one data door), config.js,
  url-state.js (pure URL state), views.js (pure markup), state-machines.js (RESULTS, VIEW).
- scripts/records/qub/build-qub-db.py: builds the app database from the parsed harvest and the scope labels.
- scripts/dev/qub-server.mjs: the local server (static site + the real handlers over a local SQLite file).
- API v1: routes and contracts `qub/search`, `qub/record` (variants record, stats), `qub/export`; schema documents,
  openapi.json and the contract baseline regenerated; site/llms.txt's route line names them as "not yet live"
  (tests/functions/api-v1-docs.test.mjs requires every v1 route there). **If this lands before the owner approves
  deployment, the public /api/v1/ index and llms.txt list three routes that answer 503.** Drop the llms.txt clause
  (and the test's qub group) if that is not wanted.
- packages/config: binding `QUB_DB` (d1, `qub-catalogue`, environments [], optional). Because /pkg/config/src/config.js
  changed, npm run build re-stamped the import-map tokens of Words, Browse, Catalogue and Records, the map bundle
  token in site/maps/*.html and the service-worker version (commit 550a194691).
- Tests: tests/unit/qub-app.test.mjs, tests/functions/qub-api.test.mjs (+ qub-fixture.mjs).
- Registered in build-site-partials PAGES, site-navigation PAGES, browse-cache-tokens HTML_FILES, the UI tsconfigs.

## Run it locally

```
python -E -X utf8 scripts/records/qub/build-qub-db.py --records tmp/qub/qub-full.sqlite --labels tmp/qub/labels.sqlite ^
  --out tmp/qub/qub-catalogue.sqlite                              # 4 min; 1.67 GB
node scripts/dev/qub-server.mjs --db tmp/qub/qub-catalogue.sqlite --port 8796      # http://localhost:8796/qub
```

The built database is at D:	vgraph-intakequb-appppqub-catalogue.sqlite (copy) and in this worktree's
tmp/qub/ (gitignored, with the parsed harvest qub-full.sqlite and labels.sqlite: D: was too full and too slow to
work on). Screenshots: D:\civgraph-intake\qub-app\screenshots\.

## Scope labels (private, D:\civgraph-intake\qub-app\scope\)

SCOPE.md (the definition and the working interpretations for the owner), SUMMARY.md (counts, accuracy, the rule
iterations), labels.sqlite (mms_id, label, tags, reason, method, rule_band), rules.sqlite, review\ (the batches the
Claude subagents judged). Scripts in D:\civgraph-intake\qub-app\scripts\. 30,500 of 1,673,714 records within scope.
```

## What deployment would need (owner approval first; nothing here was created)

1. A D1 database, e.g. `qub-catalogue` (separate from civgraph-records, as PRONI's is: FTS5 tables block D1 export).
   Size about 1.7 GB (the local file is 1.67 GB): 1,673,714 rows in `qub`, a contentless FTS5 `qub_fts`, `qub_stats`.
   Under D1's 10 GB limit. Load: `sqlite3 qub-catalogue.sqlite .dump`, split into files under D1's import limits,
   `wrangler d1 execute qub-catalogue --remote --file <part>`; check first that D1 accepts the contentless FTS5 table
   (`content=''`) and `optimize`; if not, rebuild with an external-content table (as PRONI's) at about +0.6 GB.
   Alternative: publish only the 30,500 in-scope records (about 60 MB) and keep the "All records" option local.
2. wrangler.toml: `[[d1_databases]] binding = "QUB_DB"` for production (and preview if wanted); packages/config
   QUB_DB `environments` set to match (config:check compares them).
3. Optional, as PRONI: read replication and a KV cache tier; not needed for a first release.
4. Publish: the usual approved publish run. Then /qub and /qub/<mms_id> serve, /_api/qub/* and /api/v1/qub/* answer.
5. Before going public: the owner's decisions on SCOPE.md's interpretations (above all the B "government
   publications" rule), the site navigation entry and sitemap (the page is noindex now), and a browser spec.
   Rights: QUB's reuse policy (not-for-profit, link back to each record) is met by the QUB link on every card,
   page and CSV row and the credit on every page; no commercial use.

## Architecture rules
- Rules touched: R1 (handlers in packages/api, routes thin in functions/, SQLite only via packages/storage in the
  local server and tests; site/apps/qub-catalogue imports only /pkg/ and /assets/ui/ served modules); R4 (the app
  reads through api.js only; Functions through @civgraph/storage and the named queries in queries/qub.js); R5 (v1
  contracts for every /_api/qub view, generated ApiV1 types used by api.js and views.js); R6 (limits and defaults in
  the app's config.js and the handlers' LIMITS; the topic names come from the server's one list, QUB_TAGS); R7
  (RESULTS and VIEW machines, every forbidden move tested); R8 (one AbortController per search run and per record
  load; every listener takes the page's signal; URL state in url-state.js, tested); R9 (app.css lays out on tokens
  only); R11 (all new JS in the strict function and UI tsconfigs, no explicit any); R12 (parameters, match text,
  filters, URL state and markup are pure and unit-tested; handlers tested over a fixture database).
- Exceptions added: none; baseline entries added: none
- check:architecture: new findings 0; baseline unchanged
- R2 no copies: yes
- R3 real seams, no new dependencies: yes (no package.json change)
- R4 one data door: yes
- R8 cleanup beyond listeners (maps, workers, timers): yes (none started; fetches carry AbortSignals)
- R10 text keyed: no, deferred (prototype): the page's English text is literal, as PRONI Search's is; follow-up:
  key it in site/assets/i18n/en.json before it goes public
- R12 logic pure and tested: yes for the logic; the browser spec case for /qub is deferred (prototype): it needs a
  QUB_DB fixture served by the test server; follow-up with the deployment work
- Prototype deferrals (R14): R10 and R12's browser case, as above

## Checks

- `npm run -s build`: exit 0.
- `node scripts/check/run.mjs`: CHECKS OK, 76 steps (10 skipped in this worktree for want of main's generated
  artefacts: approved-publication, peatland-geoportal, ni-register-interests, election-source-enrichments,
  provenance, site-figures, status, public-map-count, test:elections-unit, check:test2).
- New tests: tests/unit/qub-app.test.mjs (8), tests/functions/qub-api.test.mjs (9), named-queries "every QUB
  catalogue query prepares on the QUB schema".
