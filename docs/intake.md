# Intake batches

> **Status: current, 2026-11-06.** The standard way to describe and apply a data batch.
> Replaces the hand-written `upload.ps1`, `UPLOAD.txt`, `post-upload.txt`, `HANDOFF.md`
> and `apply.py` each batch in `D:\civgraph-intake\` used to carry.

A batch is a folder holding the batch's data and one manifest, `batch.json`, which says
what the batch adds to the repository, what it sends to R2, what follows the upload, and
which checks should pass or fail on the way. One CLI reads the manifest and does each
step with the repository's existing scripts:

```sh
node scripts/intake/intake.mjs validate    <batch-dir>
node scripts/intake/intake.mjs plan        <batch-dir> [--json] [--verbose]
node scripts/intake/intake.mjs stage       <batch-dir> [--write]
node scripts/intake/intake.mjs upload      <batch-dir> (--dry-run | --yes)
node scripts/intake/intake.mjs post-upload <batch-dir> [--write]
node scripts/intake/intake.mjs report      <batch-dir> [--out <file>]
```

`npm run intake -- <command> <batch-dir>` is the same thing. Every command also takes
`--manifest <file>` (a `batch.json` kept somewhere other than the batch folder; the
examples below use it) and `--repo <root>` (default: this checkout).

Nothing here pushes, deploys or runs `.claude/publish/`. The order is always: stage,
build and check, commit locally, **stop and ask the owner**, then upload, post-upload,
commit, and publish only with the owner's approval.

## The manifest

The schema is `scripts/intake/batch.schema.json`. Paths that name batch files are
relative to the batch folder; paths that name repository files, and R2 keys, are
relative to the repository root.

| field | |
|---|---|
| `schemaVersion` | `1` |
| `id`, `title`, `date`, `status` | `status` is one of draft, staged, committed, uploaded, published, abandoned. A real upload needs `committed` (or `uploaded`, to re-run). |
| `summary`, `notes` | free text, copied into the report |
| `repo` | `baseCommit` and `commits`: where the batch was applied |
| `sources` | `id`, `title`, `publisher`, `url`, `licence`, `citation`, `accessed`, `note`. Operations cite them by id. |
| `operations` | the steps, below, run in the order listed within each phase |
| `expectedChecks` | `beforeUpload` and `afterPostUpload`: `{command, expect: pass/fail, details, note}` |

### Operations

Each has an `id` (unique), a `type`, and optionally `note` and `sources`.

**Repository side** (`stage`):

| type | does |
|---|---|
| `copy-files` | `files: [{from, to, sha256?}]`. Adds a missing file, replaces a differing one (`onConflict: refuse` makes that a conflict). `sha256` is checked by `validate`. |
| `maps-json-patch` | `entries` (a JSON array of map entries; a new id goes after `insertAfter`, each later new one after the one before), `classes` (catalogue series, each placed after its own `_insert_after`), `edits` (`replace-text`, `add-reference`, `set-field` on existing entries). `target` defaults to `data/database/maps.json`. |
| `election-sources` | `fromDir`: a tree mirroring `data/elections-source/data/elections/`. Every file must parse; a differing repository file is a conflict (never overwritten unless `onConflict: replace`); `excludeRounds` names a `{rounds: [{slug, folder}]}` file of rounds held back. |
| `corrections` | `target` under `data/elections/corrections/`, `records` (array or `{records}`), `key` fields: upserts the records. |

**R2** (`upload`), each through the script that already does it:

| type | runs |
|---|---|
| `r2-fgb` | `scripts/upload-fgb-r2.mjs <file>=<key> ...` (`pairs`, or `pairsFile` of `local=key` lines; split into commands of `chunkSize`, default 40) |
| `r2-tree` | `scripts/upload-tree-r2.mjs --prefix <sub-prefix>` with `files` (repository paths under the prefix; the tool writes the `[{local, rel}]` manifest), `manifest` (an existing one) or `dir`; `force`; then `--verify-only` unless `verify: false` |
| `r2-cache-control` | `scripts/set-r2-cache-control.mjs --prefix <p> [--ext e] --apply` for each of `prefixes` |
| `r2-pmtiles` | `scripts/write-test-cdn-upload-manifest.mjs` (unless `refreshCdnManifest: false`; new layers are otherwise never uploaded), `scripts/upload-test-pmtiles-r2.mjs --ids`, then `scripts/verify-test-pmtiles-cdn.mjs --ids` (unless `verifyCdn: false`) |
| `stamp-cache-tokens` | `scripts/stamp-map-cache-tokens.mjs --write [--id ...]`, then `--check` |

**After the upload** (`post-upload`):

| type | runs |
|---|---|
| `switch-to-cdn` | `scripts/switch-test-pmtiles-to-cdn.mjs --ids` (`ids`, `idsFile`, or `idsFrom` an `r2-pmtiles` op) |
| `thumbnails` | `python scripts/regen-thumbnails.py --download --ids`, then the thumbnail sync (`npm run sync:thumbnails` with credentials) unless `sync: false` |
| `command` | anything else: `phase` (upload or post-upload) and `argv` (`node`/`python` on a script under `scripts/` or in the batch folder, or `npm run <script>`); `credentials: true` adds `--env-file=.env.local`. |

## The commands

**validate** checks the manifest against the schema; that operation and source ids are
unique and cited sources exist; that every batch file exists (and matches its `sha256`);
that map ids, layer ids and R2 keys are not repeated; that every file an upload sends is in
the repository or copied in by the batch; that no R2 prefix is so broad it would list or
rewrite the whole of `data/maps/`; that every R2 key is covered by
`data/database/r2-publication-allowlist.json`; that an id list is never empty (an empty
`--ids` means every layer to the PMTiles scripts); that commands stay inside the
repository's scripts, never touch `.claude/publish/` and carry no email address; and that
no credentials file or key assignment sits in the batch folder. Every other command runs
`validate` first and stops if it fails.

**plan** prints the repository changes (from a dry run of `stage`), the R2 objects with their
sizes, the Cache-Control prefixes, and every upload and post-upload command in order.
`--json` gives the same as data.

**stage** applies the repository side. It is a dry run unless `--write`, it computes every
operation before writing anything (a conflict or error writes nothing), and it is
idempotent: a second run reports no changes. JSON files keep their line endings and final
newline, so `maps.json` is not reformatted.

**upload** needs exactly one of `--dry-run` or `--yes`. `--dry-run` runs each script's own
dry form (`--dry-run`, `--dry`, no `--apply`): these list R2 but write nothing, and steps
with no dry form (the CDN check, the token stamp, the manifest refresh) are listed and
skipped. A failing step in a dry run is reported and passed over, as upload-tree-r2 exits 1
when it has files to send; in a real run the first failure stops everything. Every step that
needs R2 runs as `node --env-file=.env.local ...`, so the keys go from the gitignored
`.env.local` into that process only; the tool refuses to start without it. Listings are
always limited to a sub-prefix.

**post-upload** prints its steps; `--write` runs them.

**report** writes `REPORT.md` (into the batch folder, or `--out`): the sources, the
repository changes, the R2 objects and commands, the post-upload steps and the expected
check results, all generated from the manifest. It replaces `UPLOAD.txt`,
`post-upload.txt` and the handoff list.

## Worked examples

`docs/intake-examples/` describes two past batches in this format:

- `ni-plu-dispensary-towns-2026-11-02/batch.json`: the dispensary districts, Towns
  Improvement Act towns and Poor Law Union end date, whose `apply.py` was applied in
  2fc8ce45e1. Planned against `maps.json` as of the commit before (7d9a2ad556), it lists the
  same 24 changes `apply.py` reported (10 files, 9 entries, 2 classes, 3 PLU edits), and
  `stage --write` into a scratch copy of that tree produces a `maps.json` byte-identical to
  the one committed in 2fc8ce45e1. A second `stage` reports no changes.
- `batch-2026-11-05/batch.json`: the upload and post-upload of those nine editions. Its
  plan gives the commands of that batch's `upload.ps1`, in the same order, with the same
  arguments (and with `--dry-run`, the same dry forms), and the steps of its
  `post-upload.txt`. `tests/intake/upload.test.mjs` pins that equivalence.

```sh
node scripts/intake/intake.mjs plan D:/civgraph-intake/batch-2026-11-05 \
  --manifest docs/intake-examples/batch-2026-11-05/batch.json
```

Each has its generated `REPORT.md` beside it.

## Tests

`npm run test:intake` (`node --test "tests/intake/*.test.mjs"`) covers validation, plan,
stage idempotency and the upload and post-upload command construction, with the child
processes mocked: nothing touches R2 or the network.

## Starting a new batch

1. Make the batch folder under `D:\civgraph-intake\` and put the data in it.
2. Write `batch.json` (copy an example; add `"$schema"` pointing at
   `scripts/intake/batch.schema.json` for editor completion).
3. `validate`, `plan`, `stage`, then `stage --write`; build (`npm run rebuild`) and check.
4. `report`, set `status` to `committed`, commit locally, and ask the owner.
5. After approval: `upload --dry-run`, `upload --yes`, `post-upload --write`, commit, and
   the owner's publish.

Never put the owner's email or other identifiers into a command, header or query.
