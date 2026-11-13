# `scripts/` — build, validation and data pipelines

> **Status: current — 2026-11-07.** An index, not a specification. Each script's
> own header comment is authoritative; this exists so you can find the right one.

**Nothing here is deployed.** `.cfignore` excludes the directory. That matters
more than it sounds: `src/` **is** served as unbundled ES modules, so a module the
browser imports cannot be moved into `scripts/` without breaking at runtime. If
you are deciding where a file goes, that is the line.

Since the script reorganisation (November 2026) the folders say what a script does:

| Folder | What lives there |
|---|---|
| `ingest/<source>/` | fetch, parse and normalise one source into `data/` (census, walker, gazette-spn, proni, wikipedia, persons, electionsireland, hop, bna, datagovie, osni and others) |
| `records/` | the records loader: source files to local SQLite to the D1 delta (`records:build`, `records:deploy`), and the PRONI D1 builders in `records/proni/` |
| `build/` | generated artefacts: the app bundle and shell, Browse and election files, the catalogue (`build/catalogue/`), tiles (`build/tiles/`), thumbnails (`build/thumbnails/`), the semantic graph (`build/graph/`), `site.mjs` (the Pages output in `dist/`) and `rebuild-changed.mjs` |
| `publish/` | `publish.sh`, R2 uploads, cache headers, CDN switches and live verification |
| `check/` | `run.mjs` (`check:fast`), `clean.mjs` (`check:clean`), the validators in `check/rules/` and the browser measurements in `check/browser/` |
| `intake/` | the intake CLI, its delivery and source-path checks, and the contribution queue |
| `maps/`, `i18n/` | layer-id renames and catalogue patches; translations and place names |
| `dev/` | local servers (the Playwright test server included) |
| `lib/` | shared modules |

The files left at the top level are one-month shims from the first move (wave 1, 6
November 2026): each runs the publish-layer script or tool it names, so older notes
and commands keep working. Script-style tests moved to `tests/`, and archived scripts
are listed in `docs/ARCHIVE.md`.

## The npm entries, by prefix

| Prefix | Count | What it means |
|---|---|---|
| `check:` | 44 | Offline validators. Every one runs in `npm run check`. |
| `build:` | 28 | Produce tracked or deployed artefacts. |
| `test:` | 12 | Unit-ish node tests, not Playwright. |
| `verify:` | 6 | **Network-dependent** checks. Deliberately NOT in `npm run check`. |
| `contributions:` | 5 | The submission queue: list, apply, mark applied, fetch attachments. |
| `census:`, `deploy:`, `monitor:`, `audit:`, `lint:` | 12 | As named. |

The `check:` / `verify:` split is the one to understand. **`npm run check` is
entirely offline** — it must pass on a clean checkout with no credentials and no
network. Anything that reads R2, D1 or the live site goes under `npm run verify`
instead. Putting a network call into `check:` breaks CI on a runner without
secrets, and putting an offline check into `verify:` means it never runs.

That rule was being broken by `check:catalogue-d1`, which fetched the live
`/_api/catalogue` from inside `npm run check` until 2026-08-20. It is now split, and
the split is worth copying when you hit the same shape: the mistake it actually caught
was almost always local — *you edited the catalogue and did not regenerate the SQL* —
and it was diagnosing that by a round trip to production. (Since data phase 3 both
halves are gone: the records build writes the catalogue's rows, and the bounded
`verify:records` is the remote half.)

| | Runs | Asserts |
|---|---|---|
| `verify:records` | network, bounded | the loaded records database (the catalogue included, since data phase 3) matches the build |

Ask which half of a check is genuinely remote. Usually most of it is not.

## Finding a script by what you want to do

| I want to… | Start at |
|---|---|
| understand why a validator exists | its own header comment — they record the incident that caused them |
| add a map layer | `check/rules/c1-coverage.mjs` (explains at length why a layer can be invisible) |
| change catalogue data | edit `data/database/maps.json`; `records:build` loads it (`packages/loader/src/ingest-maps.mjs`) |
| change render metadata | `build/build-test2-metadata-shards.mjs` — the client reads the generated shards |
| publish to R2 | `publish/r2-upload-tree.mjs` (S3 endpoint; the REST path is rate-limited) |
| publish the bulk downloads | `publish/r2-upload-downloads.mjs` (keeps every snapshot version; refuses to overwrite one with different content) |
| set cache headers on R2 | `publish/r2-cache-control.mjs` |
| rebuild the app | `build/shell-assets.mjs`, then `build/app-bundle.mjs` |
| rebuild Browse | `build/build-browse-indexes.mjs` |
| work the contribution queue | `intake/contributions.mjs` |
| inspect or diff a FlatGeobuf | `tools/inspect-fgb.mjs`, `tools/diff-fgb.mjs` |

## Two conventions worth knowing before you add one

**Validators are negative-controlled.** The house rule (principle 2) is that a
check nobody has watched fail is not known to work: break the thing deliberately,
confirm it goes red, restore. Several scripts here have a comment recording that
they were caught passing for the wrong reason — `check/rules/doc-paths.mjs` reported
a clean pass while checking 6 of 21 things it matched, and says so.

**A `--check` mode beats a separate validator.** Where a script generates an
artefact, giving it `--check` means the generator and the checker cannot drift.
`ingest/proni/build-proni-roots.py` and `build/build-election-provenance.mjs` both do this.
