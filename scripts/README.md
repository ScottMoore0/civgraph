# `scripts/` — build, validation and data pipelines

> **Status: current — 2026-08-17.** An index, not a specification. Each script's
> own header comment is authoritative; this exists so you can find the right one.

**Nothing here is deployed.** `.cfignore` excludes the directory. That matters
more than it sounds: `src/` **is** served as unbundled ES modules, so a module the
browser imports cannot be moved into `scripts/` without breaking at runtime. If
you are deciding where a file goes, that is the line.

506 tracked files and 114 npm entries. Tech-debt item 13 scores consolidating them
low and says so — the sprawl is diffuse rather than dangerous, and reorganising
450 files without a forcing need is the "superfluous machinery" principle 10 warns
against. What was missing was a map, which is this.

## The npm entries, by prefix

| Prefix | Count | What it means |
|---|---|---|
| `check:` | 42 | Offline validators. Every one runs in `npm run check`. |
| `build:` | 28 | Produce tracked or deployed artefacts. |
| `test:` | 10 | Unit-ish node tests, not Playwright. |
| `verify:` | 4 | **Network-dependent** checks. Deliberately NOT in `npm run check`. |
| `contributions:` | 5 | The submission queue: list, apply, mark applied, fetch attachments. |
| `census:`, `deploy:`, `monitor:`, `audit:`, `lint:` | 12 | As named. |

The `check:` / `verify:` split is the one to understand. **`npm run check` is
entirely offline** — it must pass on a clean checkout with no credentials and no
network. Anything that reads R2, D1 or the live site goes under `npm run verify`
instead. Putting a network call into `check:` breaks CI on a runner without
secrets, and putting an offline check into `verify:` means it never runs.

## Finding a script by what you want to do

| I want to… | Start at |
|---|---|
| understand why a validator exists | its own header comment — they record the incident that caused them |
| add a map layer | `validate-c1-coverage.mjs` (explains at length why a layer can be invisible) |
| change catalogue data | `build-catalogue-d1-import.mjs`, then load it into D1 |
| change render metadata | `build-test2-metadata-shards.mjs` — the client reads the generated shards |
| publish to R2 | `upload-tile-pyramid-s3.mjs` (S3 endpoint; the REST path is rate-limited) |
| set cache headers on R2 | `set-r2-cache-control.mjs` |
| rebuild the app | `build-shared-shell-assets.mjs`, then `build-test2-app.mjs` |
| rebuild Browse | `build-browse-indexes.mjs` |
| work the contribution queue | `apply-contributions.mjs` |
| inspect or diff a FlatGeobuf | `inspect-fgb.mjs`, `diff-fgb.mjs` |

## Naming, and what the prefixes tell you

| Prefix | Files | Convention |
|---|---|---|
| `validate-` | 45 | Exits non-zero on failure. Most are wired to a `check:` entry. |
| `build-` | 45 | Writes an artefact. Usually idempotent; several have a `--check` mode. |
| `upload-` / `upload_` | 27 | R2 publication. **Only `upload-tile-pyramid-s3.mjs` is wired into npm**; the other 26 are one-off historical uploads that will not run again. |
| `patch-` | 16 | One-off data corrections, kept for provenance. |
| `proni-`, `census-`, `harvest-` | 16 | Source-specific ingest. |

The underscore/hyphen split in `upload_*` versus `upload-*` is not meaningful —
it is age. Do not read anything into it.

## Two conventions worth knowing before you add one

**Validators are negative-controlled.** The house rule (principle 2) is that a
check nobody has watched fail is not known to work: break the thing deliberately,
confirm it goes red, restore. Several scripts here have a comment recording that
they were caught passing for the wrong reason — `validate-doc-paths.mjs` reported
a clean pass while checking 6 of 21 things it matched, and says so.

**A `--check` mode beats a separate validator.** Where a script generates an
artefact, giving it `--check` means the generator and the checker cannot drift.
`build-proni-roots.mjs` and `validate-elections-schema.mjs` both do this.
