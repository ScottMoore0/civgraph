# Project instructions — civgraph.net

## Publishing

Nothing is pushed, deployed or published without the owner's explicit approval in
chat. Commit locally, then stop and ask.

## Architecture rules (apply always)

- Before writing or moving code, read `docs/ARCHITECTURE-RULES.md` (15 rules, each naming the check that holds it); `npm run check:architecture` runs the mechanical ones.
- Don't work around a rule: amend the charter first, with the owner. An exception is `// arch-ok R<n>: reason`; `config/architecture-baseline.json` only shrinks.
- Every LANDING.md has an "Architecture rules" section (the R15 checklist at the end of the charter).

## Token discipline (apply always)

### 1. Pipe noisy Bash output

Anything beyond a trivial `echo`/`pwd` should be piped to a slice that answers
the question:

- `npm install 2>&1 | tail -5` (or `--silent`)
- build runs: `... 2>&1 | tail -15`
- `git log --oneline -20` (never bare `git log`)
- `... 2>&1 | grep -E "error|warning"` for compile output

If you can't predict a useful slice, capture to a tmp file and `tail` it. Never
let an unfiltered multi-thousand-line dump land in context.

### 2. Grep before Read; Read with `offset`+`limit`

For any file over 2,000 lines, do not call `Read` without `offset`+`limit`
unless you genuinely need the whole file (rare): `Grep -n` for the symbol, then
`Read` about 60–100 lines around it.

Files where this matters most:

- `render/metadata/maps-test.json` (~270,000 lines)
- `data/database/maps.json` (~52,000 lines)
- `site/browse/browse.js`, `packages/map/app/app.js`, `scripts/build/build-browse-indexes.mjs`
  (3,700–5,400 lines each)

### 3. Build only what changed; trust verdicts

- `npm run rebuild` (`scripts/build/rebuild-changed.mjs`) builds and checks only what
  the working-tree changes need; `--plan` previews it.
- `npm run check:fast` runs the checks in parallel.

After a build, check or upload script reports success, treat the verdict as a
fact for the rest of that logical step. Re-run only when new evidence (a later
failure, a baseline that may have masked a regression) requires it.

### Anti-patterns to avoid

- Reading whole large files reflexively.
- Re-running gates after each tiny change.
- Spawning subagents for tasks doable in a few tool calls.
- Reading tool output that's just `OK` / `done` — the exit code already said so.

## Delegation to Flash

Suspended: the OpenCode model it used has been withdrawn and its replacement is
not yet enabled. Don't use it until this note is removed.
