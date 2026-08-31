# Reconciling the unallowlisted R2 prefixes

> **Status: point-in-time.** Object counts, sizes and licence findings were measured against
> the live bucket on 2026-08-31 and will drift as it changes. Before acting on any figure
> here, re-measure with `GET /_api/contributions/r2-index` (Access-gated), which reports the
> current contents and flags anything outside the publication allowlist. The recommendations
> stand until the decisions they name have been taken; this becomes *completed* when
> `data/polling/` is resolved and the remaining prefixes are either allowlisted or withdrawn.

Measured 2026-08-31 against `boundaries-data` via the S3 endpoint.

Six key prefixes are publicly readable on `data.civgraph.net` without appearing in
`data/database/r2-publication-allowlist.json`. Everything under them has been on the open
internet for as long as it has been in the bucket. Nothing here is a proposal to publish:
it is a reconciliation of what is *already* published against what was ever *approved*.

## How they got there

`scripts/lib/r2-publication-gate.mjs` refuses uploads outside the allowlist, but the check is
skippable and at least one upload path skips it by default:

- `scripts/upload-feature-thumbnails-r2.mjs` defaults its key prefix to `data/thumbnails/features`
- its documented usage is `--skip-check`
- `package.json` wires that in: `"deploy:feature-thumbnails:r2": "... --skip-check --concurrency 3"`

So the gate did not fail. It was told not to run. That is worth fixing regardless of what is
decided about the prefixes themselves, because it means the allowlist is advisory for any
script that opts out.

## What is actually there

| Prefix | Objects | Size | Contents |
|---|---:|---:|---|
| `data/pointclouds/` | 393,355 | 32.95 GB | 3D Tiles point clouds (`a26-corridor`, Newry) |
| `data/nisra-files/` | 33,593 | 7.52 GB | NISRA source mirror |
| `data/thumbnails/` | 47,521 | 0.20 GB | rendered per-feature PNG thumbnails |
| `data/nisra-portal/` | 1,115 | 0.05 GB | cleaned NISRA portal CSVs (gzipped) |
| `data/polling/` | 116 | 0.04 GB | LucidTalk / Belfast Telegraph poll tables |
| `data/deprivation/` | 6 | 0.01 GB | NIMDM 2001/2005 source spreadsheets |

All six are referenced by live code, so none can simply be withdrawn without breaking
something. Total: **475,706 objects, 40.8 GB** outside the allowlist — against 11 approved
prefixes covering everything else.

## Rights position, per prefix

**`data/deprivation/`, `data/nisra-files/`, `data/nisra-portal/`** — NISRA material, Crown
copyright under OGL v3.0. The gate already carries 4,044 NISRA records and 231
deprivation/NIMDM records, and OGL v3.0 is the licence recorded on them. The basis exists;
it was simply never written into the allowlist. *Mechanical to record.*

**`data/pointclouds/`** — 347 gate records match, carrying OGL v3.0 and CC BY 4.0. The clouds
derive from OpenDataNI releases, which are OGL. *Mechanical to record, with the caveat below.*

**`data/thumbnails/`** — renders Civgraph produced from its own map layers. Rights follow the
source maps rather than existing independently, the same position `data/maps/` already takes
("per-source; recorded on the individual Browse source records"). Note the allowlist already
contains `assets/thumbnails/` — a different prefix from the one the uploader actually writes
to, which is likely how this went unnoticed. *Mechanical to record.*

**`data/polling/` — NOT mechanical. This is the one to look at.**

116 objects of LucidTalk polling tables, filenames referencing Belfast Telegraph
commissions (`120530BelfTelCommNResTbles`, `BelTeleResBTPoll`). **No record anywhere in the
approved-publication gate mentions LucidTalk** — zero, against 36,127 records. LucidTalk is a
commercial polling company and the Belfast Telegraph is a commercial newspaper; neither is a
public body, so no open-government licence reaches this material by default, and none has
been recorded. It is republished on `data.civgraph.net` today with no identified basis.

Of the six, this is the only one where the exposure is of a third party's commercial work
rather than of public-sector data whose licence merely went unrecorded.

## Recommended actions

1. **Decide `data/polling/` first.** Either establish a licence or permission from LucidTalk,
   or withdraw the prefix and adjust the three files that reference it. It is 36 MB and 116
   objects — the smallest thing here and the only one with a real rights question.
2. **Record the other five in the allowlist**, in the manner of the existing `seedNote`:
   entries that document observed production state and the licence already relied on, rather
   than a retrospective grant of approval.
3. **Remove `--skip-check` from `deploy:feature-thumbnails:r2`** and point the uploader at an
   approved prefix, so the allowlist stops being optional. Either move the objects to
   `assets/thumbnails/`, which is already approved, or approve `data/thumbnails/` and drop
   the unused entry.
4. **Audit for other skip paths.** `--skip-check` exists as a flag; this reconciliation found
   one script wiring it in by default and did not look for others.

One caveat on 2: some gate records in each group carry `(none)` as their licence alongside
the OGL/CC ones. Recording a prefix does not resolve those individual records, and the count
of them was not established here.
