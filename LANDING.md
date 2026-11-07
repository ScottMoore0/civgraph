# rf-ingest (refactor stream 6): landing notes

Branch `rf-ingest`, worktree `C:\Users\scomo\civgraph-rf-ingest`, rebased on main `e9d48ae1ff`.
Owns `scripts/ingest/` and `scripts/intake/`; also touched `tests/intake/`, `docs/intake.md`
and the shared `package.json` and `CHECKS.md` (additive).

## Commits

| Commit | What |
|---|---|
| `d64898c8c4` | The plugin framework: `scripts/intake/lib/plugins.mjs` (definePlugin, discovery, run, parity, the Python bridge), `lib/capture.mjs` (run a script unchanged, capture what it wrote into `staged/`, put the tree back), `lib/plugin-cli.mjs` (`intake plugins / run / parity / mark`), the batch and contribution status machines, `check:types:intake` |
| `dd612c5eb6` | The statuses on the shared `scripts/lib/state-machine.mjs`; command gates (`stage --write`, `upload --yes`, `post-upload --write`); the NI council round machine and `scripts/intake/checks/ni-council-rounds.mjs`; the frozen clock for parity |
| `07bffc067f` | 15 sources as plugins; `import-intake-status.py` reports unparsed statuses on stderr (output byte-identical) |
| `9932d5b270` | Parity `volatile` keys; Python gets only a frozen `time.time()`; the contribution table follows `data/registries/statuses.json` |
| `01d44a63c6` | bna, electionsireland, facts, hop, osni, proni as plugins; PowerShell steps |
| `1f74d5b688` | The person-id rebuild loop as an explicit state machine (`rebuild-person-ids.mjs`; the `.sh` runs it); gazette-spn and persons plugins |
| `5594721fa2` | census, walker, wikipedia plugins: all 26 sources done |
| `6885d877ef` | `docs/intake.md` section; `tests/intake/ingest-plugins.test.mjs` |
| `773cae11ba` | IN-L: `scripts/intake/lib/item-status.mjs` vocabularies and their test |
| `46421e089d` | No machine paths in the datagovie, opendatani and proni plugins (check:local-paths) |
| (this commit) | LANDING.md |

(The rebase made `scripts/lib/state-machine.mjs` a no-op: main already has rf-records' copy.)

## Sources

**Migrated: all 26 folders under `scripts/ingest/`** (ark, bna, census, council-websites,
datagovie, dobih, electionsireland, eoni, facts, gazette-spn, geoportal, hansard, hills, hop,
idb-phelim, internet-archive, ni-assembly-opendata, ni-local, oireachtas, opendatani, osni,
persons, proni, tailte-osi, walker, wikipedia). Each `plugin.mjs` names its sources and rights,
its personal-data handling, and every file in the folder as a step, helper, research tool or data
(`intake plugins --check` passes; a test holds it). The scripts themselves are unchanged except
`ni-local/import-intake-status.py` (stderr warnings only) and `persons/rebuild-person-ids.sh`
(now runs the `.mjs` machine).

**Proved identical (`intake parity`: old command lines against plugin + `stage --write`, same
inputs, same frozen clock; every path either run changed compared byte for byte):**
geoportal source-records; idb-phelim lods-20260525 (16 FGBs); tailte-osi newcastle-merge,
county-eds-1924; ni-local round-status; ark election-json (1985, 98 files); ni-assembly-opendata
register-interests (128); dobih assets (79); hills domain-assets (9; `generatedAt` ignored as
volatile); hop extract, crosscheck, link-members; gazette-spn reference-names, provenance;
census religion-1971, religion-1991-lgd, gate-records, cso-carveout, source-inventory; walker
crosscheck-constituency-boxes, crosscheck-byelection-boxes, crosscheck-wikipedia-members,
crosscheck-1801-1831, import-1801-1831, import-wikipedia-boxes, stamp-wikipedia-person-ids.
**33 steps across 13 sources.**

**Wrapped but not proved** (the remaining steps):
- network steps (not run: no fetching from outside archives): council-websites, electionsireland,
  internet-archive, oireachtas, the harvests of datagovie, ni-assembly-opendata, wikipedia, walker,
  census crawls/mirrors, proni crawls, gazette crawl, bna, osni island-terrain, persons find-split,
  facts noncandidate-wikidata;
- inputs not on this machine or not found: facts elliott-flackes (facts.jsonl), idb-phelim
  ed-notes, datagovie and census catalogue emitters (harvest JSON), hansard (text dir),
  opendatani (C:\tmp paths), proni roots (records sqlite), osni hillshade (LiDAR block);
- needs the records build (`tmp/records`, not copied into the worktree per the coordinator):
  gazette-spn election-extras, census pxstat-gap, persons rebuild and its parts;
- old command fails in a worktree for want of other gitignored inputs: census table8a-1981,
  religion-common-basis, walker gallagher-ge (needs the PDF path argument);
- **census wards-1981: the old script itself ran 15+ minutes CPU-bound and was stopped**
  (`parse_1981_wards.py`, possibly the `while st in BK` loop at line 552). Worth a look.

## State machines (catalogue section "Stream 6")

| Id | Done |
|---|---|
| IN-01 batch lifecycle | Full: `BATCH_STATUS` table + guards (`committed` needs `repo.commits`; `uploaded`/`published` need the owner's approvals); `intake mark` the only writer after init/run; gates: `stage --write` refuses published/abandoned, `post-upload --write` needs committed/uploaded **and** `state/upload.json` (the HIGH risk), `upload --yes` unchanged |
| IN-02 contribution apply | Full: `CONTRIBUTION_STATUS`, same table as `data/registries/statuses.json`; `canMarkApplied` answers exactly as before |
| IN-03 NI council rounds | Full: `ROUND_STATUS` + `roundGate` (done/partial apply, held/no-election must be excluded) and a read-only report. On `ni-councils-2026-11-01/phase-b` it finds **no round that would apply wrongly**: the 7 Nov exclude-list rule publishes partial rounds on purpose, so the catalogue's "37 partial rounds would be copied" is intended; 2 partial and 4 done rounds are excluded by choice, with reasons |
| IN-04 person-id loop | Full: `REBUILD` machine; per-command output judged on its own (an earlier lock error no longer retries a later real failure); `NOT CONVERGED` printed after 6 passes (then carries on as before, exit 0); `<log>.state.json` reports a run that stopped with ids wiped |
| IN-05 NI-local import | Full vocabularies (`CALENDAR_STATES`, `WORK_STATES`); unparsed phrasing reported on stderr (16 rows today, all "verify: ..."); output byte-identical |
| IN-L item statuses (8) | Light: one frozen union per vocabulary in `scripts/intake/lib/item-status.mjs` (mirror items, agency mirror, CSO reports, Wayback recovery, layer registration, cleaning checks, PRONI snapshot/index/scan/benchmark modes, NI Assembly PHASE, Dail count results) and `tests/intake/item-status.test.mjs`, which reads the 13 scripts and fails on any literal outside its vocabulary (51 literals today, all in). The scripts' literals are unchanged (requested follow-up: import the unions when each script is next edited) |

## Tests

- `npm run test:intake`: 66 pass (38 before; new: `plugins`, `statuses`, `ingest-plugins`,
  `rebuild-person-ids`, `item-status`). `node --test tests/functions/contribution-schema.test.mjs`: pass.
- `npm run check:types:intake` (tsc over the typed intake modules): clean.
- `npm run check:fast` in the worktree: 57 of 71 pass; the 14 failures all need build output a
  worktree lacks (`tmp/records/*`, `app/build`, `data/browse`) or name files outside this branch
  (`check:local-paths`: `scripts/apply-*.mjs`, `analysis/...`). None touches a file changed here.
- `npm run check:clean` (clean export of the branch at `6885d877ef`, with the full build, the records build and its tests): **70 of 71 pass**; the one failure was `check:local-paths` on three plugins naming local drive folders, fixed in `46421e089d` and re-checked (`node scripts/check/rules/local-paths.mjs`: PASS). Not re-run in full after that one-rule fix and the IN-L commit (new files only).

## Landing steps

1. Merge `rf-ingest`. `package.json` conflicts are additive: keep main's devDependencies, keep
   `check:types:intake` in the script list and at the end of the `check` chain.
2. No regeneration, migration, R2 upload or records rebuild. No generated file is committed.
3. `npm run test:intake`, `npm run check:types:intake`.
4. Behaviour changes to know: `intake post-upload --write` now refuses a batch with no recorded
   upload (`state/upload.json`) or a status other than committed/uploaded; `intake stage --write`
   refuses published/abandoned batches; `npm run persons:rebuild` prints `NOT CONVERGED` when six
   merge passes do not converge, and writes `tmp/rebuild-person-ids.log.state.json`.

## Files others may touch

`package.json` (one script, one chain entry), `CHECKS.md` (one row), `docs/intake.md` (a new
section), `scripts/ingest/persons/rebuild-person-ids.sh` (rebuild-changed.mjs runs it; unchanged
command line).

## Requests to other streams

- **rf-registries:** once `registries/` lands, `scripts/intake/lib/statuses.mjs` should read
  `CONTRIBUTION_STATUS` from `registries/statuses.mjs` (the tables already agree) and
  `contributions.mjs` use `canMarkContributionApplied`; `import-intake-status.py`'s
  `CALENDAR_STATES`/`WORK_STATES` match `election-round.vocabularies`. Not done here because
  `registries/` is not on main yet.
- **rf-functions:** `decide.js` lets any status be re-decided, including `applied`; the shared
  table allows only pending-review -> approved/rejected (FN-04).
- **rf-pipeline:** `rebuild-changed.mjs` still calls `bash rebuild-person-ids.sh` (fine); it could
  call `node scripts/ingest/persons/rebuild-person-ids.mjs` directly.

## Remaining

- IN-L follow-up (requested): the 13 scripts could import their unions from `item-status.mjs`
  instead of repeating the literals; the test already pins them.
- Parity for the unproved steps above, when their inputs are available (or `--allow-network`
  with the owner's approval).
- IP-4 (`intake from-contribution`) was not in this brief.
