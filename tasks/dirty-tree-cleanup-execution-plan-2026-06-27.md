# Dirty Tree Cleanup Execution Plan

Date: 2026-06-27

Scope: clean the current dirty tree in place without creating another branch or worktree.

This is an execution runbook. It does not ask the operator to rediscover decisions. It separates the dirty tree into packages, defines what belongs in each package, and names the safety checks that must pass before moving to the next package.

## Non-Negotiable Safety Rules

1. Do not create another branch or worktree.
2. Do not delete, move, rename, compress, or alter any private source file on `C:\`, `D:\`, `G:\`, or any other drive.
3. Do not run cleanup commands against drive roots or private source directories.
4. Sensitive private address-level material must remain private and must not appear in public website files, generated public JSON, CDN/IA manifests, source records, audit reports, task logs, or commits.
5. Only touch files under `C:\Users\scomo\boundaries-website` during repo cleanup.
6. Before deleting any untracked repo file, run a dry run and inspect exact paths.
7. Do not delete untracked repo leftovers during this cleanup. Move them to an external archive folder instead.
8. Do not run broad `git restore .`, `git clean -fd`, `git clean -f`, `git reset --hard`, or recursive deletion commands for this cleanup.
9. Use path-scoped staging and path-scoped restore only.
10. Before any path-scoped restore, create a patch/archive snapshot of the tracked changes being discarded.

## Starting Inventory

Known dirty-tree shape at research time:

- 754 tracked files modified.
- 488,593 insertions and 297,792 deletions after the latest task-log updates.
- Dirty groups: `test/`, `data/`, `scripts/`, `tasks/`, generated build files, and untracked sidecars/scripts.

Refresh before execution:

```powershell
git status --short --untracked-files=all
git diff --stat
git ls-files --others --exclude-standard
```

Mandatory safety snapshots inside ignored `tmp/` before any restore, archive move, or cleanup action:

```powershell
git status --short --untracked-files=all > tmp/dirty-tree-status-2026-06-27.txt
git diff --stat > tmp/dirty-tree-stat-2026-06-27.txt
git diff > tmp/dirty-tree-tracked-2026-06-27.patch
git ls-files --others --exclude-standard > tmp/dirty-tree-untracked-2026-06-27.txt
```

These snapshots are required before any restore or archive move. They preserve an inventory and patch of the dirty state before cleanup.

Create an external archive folder before moving any untracked leftovers out of the repo. Use a folder outside `C:\Users\scomo\boundaries-website`, for example:

```powershell
$ArchiveRoot = "D:\boundaries-website-dirty-tree-archive\2026-06-27"
New-Item -ItemType Directory -Force -Path $ArchiveRoot
```

If `D:\` is unavailable, choose another external/non-repo folder and record the path in the cleanup notes. Do not use any folder that contains private source data.

## Package 1: Already-On-Site And Sensitive-Source Redaction

Decision: keep and stage first.

Reason: this package contains the highest-risk correctness work: public redaction/withholding of the sensitive address-level source, row 521/1005 source fixes, and already-on-site validation updates.

Stage these files:

```powershell
git add data/database/maps.json
git add data/database/already-on-site-enrichments.json
git add scripts/build-already-on-site-enrichment-records.mjs
git add scripts/validate-already-on-site-enrichments.mjs
git add scripts/review-already-on-site-remaining.mjs
git add data/browse/sources.json
git add data/browse/details/source-shards
git add data/browse/details/maps/roi-local-authorities-2024.json
git add data/browse/details/maps/dcc-dcc-public-cycle-parking-stands.json
git add data/browse/maps.json
git add data/browse/index.json
git add tasks/todo.md
git add tasks/lessons.md
git add tasks/dirty-tree-cleanup-execution-plan-2026-06-27.md
```

Handle mixed file with patch staging:

```powershell
git add -p scripts/build-browse-indexes.mjs
```

Only stage hunks related to:

- already-on-site source enrichment,
- source/provenance summary wording,
- provider dataset URL references,
- licence/source-reference enrichment,
- source Browse output generation needed by the already-on-site package.

Do not stage NI register hunks from `scripts/build-browse-indexes.mjs` in this package unless intentionally combining Package 1 and Package 2.

Do not stage:

```text
scripts/build-d-drive-blocker-review.mjs
scripts/build-d-drive-remaining-decision-packs.mjs
```

Verification:

```powershell
node scripts/validate-already-on-site-enrichments.mjs
node scripts/validate-external-sources.mjs
node scripts/validate-pages-file-budget.mjs
rg -n "D:\\\\" data/database/already-on-site-enrichments.json data/browse/sources.json data/browse/details/source-shards scripts/build-already-on-site-enrichment-records.mjs scripts/validate-already-on-site-enrichments.mjs scripts/review-already-on-site-remaining.mjs
node scripts/validate-already-on-site-enrichments.mjs
git diff --cached --stat
git diff --cached
```

Expected sensitive-source scan result: no private local-path matches in public generated data or relevant already-on-site scripts. The already-on-site validator also checks that the sensitive held row and sensitive schema markers are absent from public output without writing those markers into this runbook.

Package can be committed when the staged diff is reviewed and verification passes.

## Package 2: NI Register Browse Grouping

Decision: keep and stage separately.

Reason: this is intentional data-publication work. It is large, but coherent: source rows, canonical rows, grouped Browse records, register-interest Browse shards, and validator updates.

Stage these files:

```powershell
git add scripts/build-ni-register-interests.mjs
git add scripts/validate-ni-register-interests.mjs
git add data/database/ni-register-sources.json
git add data/database/ni-register-interests.json
git add data/database/ni-register-interests
git add data/database/ni-register-canonical-interests
git add data/database/ni-register-browse-records
git add data/browse/register-interests.json
git add data/browse/register-interest-shards
```

Handle mixed file:

```powershell
git add -p scripts/build-browse-indexes.mjs
```

Only stage remaining NI register hunks if Package 1 did not already stage them.

Verification:

```powershell
npm run check:ni-register-interests
npm run build:browse
npm run check:ni-register-interests
node scripts/validate-pages-file-budget.mjs
git diff --cached --stat
git diff --cached
```

Expected result: NI register validation passes and generated Browse register-interest files stay under file-budget limits.

Package can be committed when verification passes.

## Package 3: Test2 Route, CDN, Election Audit, And Metadata

Decision: keep as an intentional package, stage separately.

Reason: the diffs add and verify two Irish hill PMTiles CDN objects, update route/audit validation for root promotion/current selectors, and regenerate required metadata. CDN reports show:

- two PMTiles objects uploaded successfully,
- `573/573` CDN byte-range assets verified,
- zero CDN manifest warnings/errors,
- zero test2 CDN validation warnings/errors.

Stage these code/report files:

```powershell
git add scripts/audit-test2-election-data.mjs
git add scripts/audit-test2-general-parity.mjs
git add scripts/validate-test2-route.mjs
git add test/metadata/cdn-upload-manifest.json
git add test/metadata/cdn-upload-report.json
git add test/metadata/cdn-range-report.json
git add test/metadata/cdn-manifest-validation-report.json
git add test/metadata/test2-cdn-validation-report.json
git add test/metadata/maps-test.json
git add test/metadata/maps-test-index.json
git add test/metadata/layer-details-test2
git add test/metadata/duplicate-feature-ids
```

Important: all 48 untracked DOBIH files under these directories are referenced by `maps-test-index.json` or `maps-test.json`. If keeping the regenerated test2 metadata, they must be included.

Election audit generated output decision:

Default recommendation: do not stage timestamp-only generated audit output unless deliberately refreshing the audit baseline.

Leave unstaged or revert later:

```text
tasks/test2-election-data-audit.json
tasks/test2-election-data-audit.md
```

If the package owner chooses to refresh the baseline, stage both files with Package 3. Otherwise, after Package 3 code/metadata is protected, archive a patch for only those files and then restore only those two files:

```powershell
git diff -- tasks/test2-election-data-audit.json tasks/test2-election-data-audit.md > tmp/test2-election-audit-baseline-before-restore.patch
git restore -- tasks/test2-election-data-audit.json tasks/test2-election-data-audit.md
```

Verification:

```powershell
npm run check:test2
npm run check:test
node scripts/validate-test-cdn-manifest.mjs
node scripts/validate-test2-pmtiles-cdn.mjs
node scripts/validate-pages-file-budget.mjs
git diff --cached --stat
git diff --cached
```

Expected result:

- `check:test2` passes.
- CDN validation reports remain at zero errors/warnings.
- If `npm run check:test` regenerates `tasks/test2-election-data-audit.*` with only timestamp changes and known non-blocking election warnings, do not treat that as part of CDN cleanup unless intentionally refreshing the audit baseline.

Package can be committed when verification passes.

## Package 4: Generated Browse Features, Thumbnails, Performance Dashboard, And Final Build Marker

Decision: split generated data artifacts from final build/release marker.

Keep with data/test2 packages:

```powershell
git add data/browse/features.json
git add assets/thumbnails/manifest.json
git add data/database/feature-thumbnails/_manifest.json
git add app/build/performance-dashboard.json
```

Reason:

- `data/browse/features.json` adds the two Irish hill domain feature groups.
- `data/database/feature-thumbnails/_manifest.json` carries the visible `roi-local-authorities-2024` title correction.
- `assets/thumbnails/manifest.json` reflects generated thumbnail manifest refresh.
- `app/build/performance-dashboard.json` reflects current generated performance budget state.

Caveat:

The feature-thumbnail manifest also changes some zero-rendered fallback base paths to the current script default. Runtime only uses rendered asset URLs when rendered IDs are present, so this churn is low risk. The stronger reason to keep the file is the Local Authorities 2024 correction.

Final build/release marker:

```text
index.html
```

Decision: keep only in the final build/release package, not in a data-only package.

Reason: `index.html` hash-only diff is generated by `scripts/build-shared-shell-assets.mjs`, while `build/` is ignored. This is expected after `npm run build`, but it should be the final package after data/code packages are settled.

Stage at the end:

```powershell
git add index.html
```

Verification:

```powershell
npm run build
npm run check
node scripts/validate-pages-file-budget.mjs
git diff --cached --stat
git diff --cached
```

Expected result: build and checks pass; root `index.html` points to the current generated shared CSS cache key.

## Files Not To Stage By Default

Do not stage as part of website cleanup:

```text
scripts/build-d-drive-blocker-review.mjs
scripts/build-d-drive-remaining-decision-packs.mjs
```

Reason: these are research tooling, not runtime/build website code. One has generic `D:\`/local-source handling. It should not be included in a public package without deliberate review.

Do not stage unless deliberately refreshing election audit baseline:

```text
tasks/test2-election-data-audit.json
tasks/test2-election-data-audit.md
```

Do not stage `browse/browse.js` or `browse/browse.css` unless a fresh `git diff -- browse/browse.js browse/browse.css` shows real content diffs. At research time these had no content diffs.

## Cleanup After Packages Are Protected

After the intentional packages are staged/committed, inspect remaining tracked dirt:

```powershell
git status --short --untracked-files=all
git diff --name-only
```

For tracked files that are confirmed unwanted, restore only exact paths:

```powershell
git diff -- path/to/file > tmp/path-to-file-before-restore.patch
git restore -- path/to/file
```

For untracked files, use `git clean` only as an inventory dry run:

```powershell
git clean -n -- path/to/file-or-directory
```

Do not run `git clean -f`. Move selected untracked leftovers to the external archive folder instead. Preserve relative paths so files can be restored if needed:

```powershell
$ArchiveRoot = "D:\boundaries-website-dirty-tree-archive\2026-06-27"
$RepoRoot = (Get-Location).Path
$RelativePath = "path/to/file-or-directory"
$SourcePath = Join-Path $RepoRoot $RelativePath
$ArchivePath = Join-Path $ArchiveRoot $RelativePath
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ArchivePath)
Move-Item -LiteralPath $SourcePath -Destination $ArchivePath
Test-Path -LiteralPath $ArchivePath
```

Never use:

```powershell
git clean -fd
git clean -f
git restore .
git reset --hard
```

If the path is a directory, first list its contents and confirm every resolved path is under `C:\Users\scomo\boundaries-website`:

```powershell
$Resolved = (Resolve-Path -LiteralPath $SourcePath).Path
if (-not $Resolved.StartsWith($RepoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to move path outside repo: $Resolved"
}
Get-ChildItem -LiteralPath $SourcePath -Recurse -Force | Select-Object FullName,Length,LastWriteTime
```

## Final Verification

Run these after all intended packages are committed or staged and unwanted leftovers are removed:

```powershell
git status --short --untracked-files=all
npm run check
npm run build
npm run check
node scripts/validate-pages-file-budget.mjs
rg -n "D:\\\\" data/database/already-on-site-enrichments.json data/browse/sources.json data/browse/details/source-shards scripts/build-already-on-site-enrichment-records.mjs scripts/validate-already-on-site-enrichments.mjs scripts/review-already-on-site-remaining.mjs
node scripts/validate-already-on-site-enrichments.mjs
```

Expected final state:

- No unintended dirty tracked files.
- Only deliberately retained untracked local research files remain, or none remain.
- Checks pass.
- Build passes.
- Sensitive-source scan has no public-output hits and does not write sensitive schema markers into tracked notes.
- No private source file outside the repo has been altered.

## Recommended Commit Order

If committing, use this order:

1. Already-on-site source enrichment and sensitive-source redaction.
2. NI register grouped Browse publication.
3. Test2 route/CDN/election metadata package.
4. Generated Browse/features/thumbnail/performance refresh.
5. Final root build/cache-key refresh.

If the operator chooses fewer commits, do not combine Package 1 with unrelated work unless the staged diff has been reviewed for sensitive-source leakage.
