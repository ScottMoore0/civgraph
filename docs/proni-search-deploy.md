# PRONI catalogue search — Cloudflare D1 deploy runbook

The PRONI search box (`/browse/#/proni`) calls the Pages Function
`functions/_api/proni/search.js`, which queries a Cloudflare **D1** database
(SQLite + FTS5) bound as **`PRONI_DB`**. The code ships with the site; the D1
database is provisioned once in the Cloudflare account.

Requires the **Workers Paid plan** ($5/mo) for the import only — free tier caps
D1 at 100k row-writes/day, and the import is ~1.5M rows. Search itself is
read-only and runs within free-tier read limits, so the plan can be dropped
after import if the data is static (see "Downgrading" below).

## Build the artifacts (from the combined detail set)

```bash
# 1. Build the local SQLite (external-content FTS5) from the combined JSONL
python scripts/build-proni-d1.py \
  --src D:/PRONI/eCatalogue/detail-combined-with-containers-20260701.jsonl \
  --sqlite D:/PRONI/eCatalogue/proni.sqlite \
  --sql D:/PRONI/eCatalogue/proni-d1.sql.gz

# 2. Emit small, retry-safe D1 import parts from that SQLite
python scripts/build-proni-d1-parts.py \
  --sqlite D:/PRONI/eCatalogue/proni.sqlite \
  --outdir D:/PRONI/eCatalogue/d1-parts
# -> 000-schema.sql (table + FTS + AFTER INSERT trigger) + numbered insert parts
```

Why parts, not one file: D1 rejects a single SQL statement over ~100 KB
(`SQLITE_TOOBIG`) and a single `d1 execute --file` of the whole 190 MB dump
exceeds the server execution window. The parts use ≤100 rows per statement,
~60k rows per file, `INSERT OR IGNORE` (retry-safe), and a trigger that builds
the FTS index incrementally (no heavy one-shot rebuild). `wrangler d1 import`
does **not** exist — the load path is `wrangler d1 execute --file`.

## Create + import

```bash
npx wrangler d1 create proni-catalogue          # note the database_id

# Run every part in order, retrying transient "fetch failed" blips:
for f in $(ls D:/PRONI/eCatalogue/d1-parts/*.sql | sort); do
  for attempt in 1 2 3 4 5; do
    npx wrangler d1 execute proni-catalogue --remote --yes --file="$f" && break
  done
done

# Verify
npx wrangler d1 execute proni-catalogue --remote --command "SELECT count(*) FROM proni;"
npx wrangler d1 execute proni-catalogue --remote --command \
  "SELECT ref,title FROM proni WHERE ref='BG/1';"
npx wrangler d1 execute proni-catalogue --remote --command \
  "SELECT p.ref,p.title FROM proni_fts f JOIN proni p ON p.rowid=f.rowid WHERE proni_fts MATCH 'antrim minute*' ORDER BY bm25(proni_fts) LIMIT 3;"
```

## Bind the database to the Pages project (dashboard)

The `civgraph` Pages project uses git-integration deploys (no `wrangler.toml`),
so bindings are set in the dashboard, not in config:

**Workers & Pages → civgraph → Settings → Bindings → Add → D1 database**
- Variable name: `PRONI_DB`  (must match `context.env.PRONI_DB`)
- D1 database: `proni-catalogue`
- Add it to **both Production and Preview**.

Search goes live once (a) this binding exists and (b) the Function is deployed
(on the next git deploy / PR merge).

## Downgrading after import (optional, keeps search live)

Once imported and verified, the DB (~0.4 GB) sits well within the Free tier's
5 GB storage and 5M reads/day, and search never writes — so you can drop back to
Workers Free and search keeps working. Re-importing new data later needs the
paid plan again (writes). After downgrading, re-run the two verify queries above
to confirm the DB still answers.

## Local end-to-end test (optional)

```bash
npx wrangler d1 execute proni-catalogue --local --file=D:/PRONI/eCatalogue/d1-parts/000-schema.sql
for f in $(ls D:/PRONI/eCatalogue/d1-parts/0[0-9][0-9].sql | sort); do
  npx wrangler d1 execute proni-catalogue --local --file="$f"; done
npx wrangler pages dev . --d1 PRONI_DB=proni-catalogue
```

## Schema / query notes

- Base table `proni` with `UNIQUE(ref)` + external-content FTS5 `proni_fts`
  (over `ref`, `title`, `dates`), kept in sync by an `AFTER INSERT` trigger.
- `buildMatch` (Function): free text is tokenised on non-alphanumerics, ANDed,
  last term prefixed for search-as-you-type; `BG/1` → terms `bg AND 1`.
- Exact-reference fast path: whitespace-free queries are also looked up as a
  literal reference via the unique index and returned first.
