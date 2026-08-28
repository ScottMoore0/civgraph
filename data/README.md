# `data/` — catalogue, sources and generated indexes

> **Status: mixed. 28 GB on disk, 8,860 files tracked. Most of this directory is
> not in git and not deployed.**

Read this before assuming a missing directory is a broken checkout.

## The authoritative files — tracked, hand-edited or generated

| Path | What it is |
|---|---|
| `database/maps.json` | **The catalogue.** 1,031 map entries, 44 classes, 17 time-series chains. The source of truth for what Civgraph holds. |
| `database/external-sources.json` | Sources cited but not hosted — Wikipedia articles, Internet Archive items, third-party datasets. Where attribution obligations are recorded. |
| `database/books.json` | 67 scanned books. `file` and `markdownFile` point at `data.civgraph.net`; `check:book-files` enforces that. |
| `database/elections-schema.sql` | Generated dump of the live `civgraph-elections` D1 schema, so the database shape exists somewhere other than the database. |
| `database/*-baseline.json` | Pinned known-offender lists for validators that cannot be made clean yet. Each names the script that owns it. |
| `elections-source/` | **The canonical election data**, 7,401 JSON bundles read by 42 scripts. Uses ElectionsNI's `countGroup` schema. |

## Generated, untracked, served from R2

`browse/` is build output — roughly 2,400 JSON files, 350 MB. `npm run build:browse`
creates it; `functions/data/browse/[[path]].js` serves it from R2. A clean checkout
has no `data/browse/`, and validators that need it say so and skip rather than
reporting false defects.

## Not deployed

`books/markdown/` and `books/legislation/` are **untracked deliberately** — 365 MB
that lived in git until August and made every clone expensive. They are on R2 and
mirrored to Internet Archive. `.cfignore` alone did not keep them out of the
deployment, which is why they were untracked instead.

`census/` is source material except for `census/explorer-bundle.json`, the one file
the Census Explorer fetches at runtime; `clean-for-pages.sh` keeps that and drops
the rest.

## Adding to the catalogue

Nothing is published without going through the approved-publication gate — see
`database/approved-publication-sources.json` and the `check:approved-publication`
validator. Roughly 45 offline validators run under `npm run check`, and they are
fail-closed by design.
