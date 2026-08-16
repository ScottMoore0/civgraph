# Code review — `functions/`, `scripts/`, `browse/`, `app/src/`

> **Status: point-in-time review — 2026-08-16. Findings only; nothing here has
> been applied.** Each finding carries a verdict: CONFIRMED means it was checked
> against running code or live output, PLAUSIBLE means it was read but not
> executed. Verify before acting — this document will age like any other.

Companion to `docs/review/TECH-DEBT-AUDIT.md`, which covers structure and
process. This one reads the code.

## Method, and how it differs from the packaged skill

Neither the `code-review` nor the `code-simplifier` plugin is installed. Both
exist in the official marketplace and neither fits this job:

- `code-review` reviews **a pull request**. It runs eleven subagents, needs
  `gh`, and finishes by posting a comment on GitHub. There is no PR here — the
  request was to review four directories on `main`.
- `code-simplifier` autonomously **edits** code and is written around
  TypeScript/React conventions this project does not use.

So this follows their stated methodology rather than their machinery: read the
code, flag issues, then score confidence and discard anything that does not
survive scrutiny. Their false-positive list is applied as written — no
pedantic nitpicks, nothing a linter would catch, no "needs more tests".

Findings were verified where verification was cheap. One was confirmed against
production. Where a claim rests on reading alone, it says so.

## Measured shape

    functions/     26 files    2,438 lines      browse/     3 files   5,481 lines
    app/src/        8 files   11,275 lines      src/       16 files  36,028 lines
    test/src/      25 files    9,807 lines      scripts/  506 files 203,589 lines

    eslint warnings 18 (0 errors)     check: targets 31, all with a failure path
    TODO/FIXME/HACK markers in scope: 0

`scripts/` was not read line by line — 203,589 lines is not reviewable in one
pass. It was examined structurally: every `check:` target was traced to its file
and tested for a reachable failure path.

---

## Findings

| # | Finding | Area | Verdict | Severity |
|---|---|---|---|---|
| 1 | `fetchCurrentRecord` never returns a record, so every dry run is shape-only | `functions/` | **CONFIRMED** | High |
| 2 | `src/` is 36,028 lines of live code that no linter sees | config | **CONFIRMED** | High |
| 3 | The tech-debt audit's item 4 is factually wrong | docs | **CONFIRMED** | High |
| 4 | Contribution list silently truncates past 200 submissions | `functions/` | PLAUSIBLE | Medium |
| 5 | Edge search ranking is applied after truncation, so it does nothing | `functions/` | **CONFIRMED** | Medium |
| 6 | `search.js` caches the names index forever with no invalidation | `functions/` | PLAUSIBLE | Medium |
| 7 | `CLAUDE.md` cites a build script that does not exist | docs | **CONFIRMED** | Medium |
| 8 | Two proxies decode path segments differently, undocumented | `functions/` | **CONFIRMED** | Medium |
| 9 | `joinExt` is a documented contract that both callers ignore | `functions/` | **CONFIRMED** | Low |
| 10 | SQL column aliasing by string surgery | `functions/` | **CONFIRMED** | Low |
| 11 | D1 error messages returned to the client verbatim | `functions/` | **CONFIRMED** | Low |
| 12 | `matched` is a boolean on one endpoint and an integer on another | `functions/` | **CONFIRMED** | Low |
| 13 | Unauthenticated 50,000-row CSV export | `functions/` | **CONFIRMED** | Low |
| 14 | CSV export is vulnerable to formula injection | `functions/` | PLAUSIBLE | Low |
| 15 | `MAX_JSON_BYTES` counts UTF-16 units, not bytes | `functions/` | **CONFIRMED** | Low |

---

### 1. Every contribution dry run is shape-only, and reports so — but nobody read it

**CONFIRMED against production.**

`functions/_api/contributions/submit.js:170-184` fetches the current record so
the dry run can report what would actually change:

```js
const res = await fetch(`${url.origin}/_api/catalogue?id=${encodeURIComponent(entityId)}`);
const doc = await res.json();
const maps = Array.isArray(doc?.maps) ? doc.maps : [];
return maps.find((m) => m?.id === entityId) || null;
```

But `functions/_api/catalogue/index.js:58-65` returns the **bare record** for
`?id=`, not a wrapper. Only the `?category=` and no-parameter forms return
`{ maps: [...] }`. Fetched live:

    GET https://civgraph.net/_api/catalogue?id=lgd-2012
    top-level keys: id, name, slug, category, featured, provider, files,
                    style, labelProperty, keywords, dateEffective, defaultOn,
                    date, useLOD, references, sourceDownloads

`Array.isArray(doc?.maps)` is therefore always `false`, `maps` is always `[]`,
and `fetchCurrentRecord` **always returns `null`**.

Three consequences, all silent:

- `checkedAgainstCurrentRecord` is `false` on every submission ever made.
- `_schema.js:258` — "Patch is valid but changes nothing" — can never fire,
  because with no current record every field reads as changed. A contributor
  can submit a patch that proposes the values already there and it queues
  clean.
- The name/date year cross-check at `_schema.js:249-256` falls back to
  `current?.date`, so it only fires when the patch itself carries both fields.

The design here is *right*: it degrades honestly rather than reporting a pass it
did not earn, and it publishes the flag that says so. The defect is that it has
degraded 100% of the time since it shipped and the flag was never read. This is
principle 2 in its purest form — a check nobody has watched fail.

*Fix:* one line. `const record = doc?.maps ? doc.maps.find(...) : doc;`, or have
the catalogue return a consistent envelope. Then assert
`checkedAgainstCurrentRecord === true` in `check:contributions` against a known
id, so the next regression is caught by the gate rather than by a reviewer.

### 2. The largest body of live code in the project is unlinted

**CONFIRMED.** `eslint.config.mjs:28` scopes linting to:

```js
files: ['test/src/**/*.js', 'app/src/**/*.js'],
```

Nothing else has any rules applied. Measured, that leaves unlinted:

    src/          36,028 lines    live — imported by app/src/app.js
    browse/        5,481 lines    live — the Browse page
    functions/     2,438 lines    live — auth, D1, R2, every API route

`src/ui-controller.js` alone is **11,620 lines**, the largest hand-written file
in the repository, and it is imported and driven by the live homepage. The
config's comment says "Scope is the hand-written app source only" — but three of
the four directories under review are hand-written app source, and all three are
outside it.

This compounds finding 3: the reason `src/` was excluded appears to be a belief
that it is dead.

*Fix:* widen `files` to include `src/**/*.js`, `browse/**/*.js` and
`functions/**/*.js`, accept the new warning count as a baseline, then put
`lint` into `npm run check`. `lint:strict` already exists and is unused.

### 3. `docs/review/TECH-DEBT-AUDIT.md` item 4 is wrong

**CONFIRMED.** The audit — written earlier the same day — says:

> `src/ui-controller.js` is the dead Leaflet stack; `src/data-service.js` is
> live [...] A newcomer cannot tell which is which

Both halves of that are false:

- `app/src/app.js:3` imports it: `import uiController from '../../src/ui-controller.js'`
  and calls it throughout — `uiController.init()` (line 240), feature-info
  display (219-222), split-pane state (434-441), catalogue rendering (468-479),
  the whole election wiring block (734-756).
- It contains **zero** Leaflet references. Counted across all of `src/`, only
  `feature-loader.js` mentions Leaflet at all, twice.

So the item that scored 24 and was described as "the single most misleading
thing in the repository for someone arriving fresh" rests on a
mischaracterisation. There *is* a real problem in the same place, but it is a
different one: `src/` holds 36,028 lines of live, load-bearing, unlinted code in
a directory that two separate documents now describe as dead.

That a fresh review pass caught this within an hour is the argument for running
these passes separately rather than as one long sweep.

*Fix:* rewrite item 4 against what the code does. The remediation changes
completely — this is not "archive the dead half", it is "this directory is
undersold and under-defended".

### 4. The review queue goes blind after 200 submissions

PLAUSIBLE — read, not executed.

`functions/_api/contributions/list.js:44-50`:

```js
const listing = await queue.list({ prefix: 'submissions/', limit: MAX_LIMIT });
for (const key of listing.keys || []) {
  const meta = key.metadata || {};
  if (wantStatus !== 'all' && meta.status !== wantStatus) continue;
```

`MAX_LIMIT` is 200, `listing.cursor` is never read, and `list_complete` is never
checked. KV lists keys in lexicographic order, and the keys are
`submissions/YYYY-MM-DD/sub_…`, so that ordering is **oldest first**.

Once 200 submissions exist, the 201st and everything after it can never appear
in the list, whatever its status — and because the filter runs after the fetch,
the endpoint returns `ok: true` with a short list rather than any signal of
truncation. The review queue stops showing new work and looks healthy doing it.

Five submissions exist today, so this is not urgent. It is worth fixing while it
is cheap, because the failure mode is silence.

*Fix:* page with the cursor until enough matching items are found, or key by
status prefix so the filter is a list prefix rather than a post-filter. At
minimum, return `truncated: !listing.list_complete` so the caller knows.

### 5. Search ranking is computed and then thrown away

**CONFIRMED by reading.** `functions/_api/search.js:53-67`:

```js
for (const feature of names) {
  if (results.length >= limit) break;          // <- truncate
  if (name.includes(lowerQuery)) {
    results.push({ ...feature, score: name.startsWith(lowerQuery) ? 2 : 1 });
  }
}
results.sort((a, b) => b.score - a.score || ...);   // <- then rank
```

The `break` truncates at `limit` **in index order**, and the sort runs on
whatever survived. A prefix match (score 2) sitting at position 3,000 in the
names index is never seen if 25 substring matches appear before it.

So searching "Bel" returns 25 arbitrary names containing "bel" — "Annabella",
"Belleek", "Campbelltown" — and "Belfast" appears only if it happens to sit
early in the file. The scoring code runs, produces a number, and changes
nothing that matters.

*Fix:* collect all matches, sort, then slice. The index is small enough that a
full scan is already happening; only the truncation point is wrong.

### 6. The names index is cached for the life of the isolate, forever

PLAUSIBLE. `functions/_api/search.js:10` holds `cachedNames` at module scope
with no TTL and no invalidation. The comment describes the behaviour accurately
but does not address the consequence: a Workers isolate can live for hours, so
after the names index is rebuilt some edge locations serve the old one and
others the new one, with no way to tell which and no way to flush it short of a
redeploy.

This is principle 9 — the deployed artefact is not the running one — in a place
where nothing checks it. Worth at least a timestamp and a five-minute
expiry.

### 7. `CLAUDE.md` names a script that does not exist

**CONFIRMED.** `CLAUDE.md:41` gives, as an example of a build verdict to trust:

> This applies to local build scripts, R2 upload scripts, `node scripts/bundle.mjs`

`scripts/bundle.mjs` does not exist. The file is `archive/legacy-scripts/bundle.mjs`;
the live bundler is `scripts/build-test2-app.mjs`.

This matters more than an ordinary stale reference because `CLAUDE.md` is the
file whose instructions override default behaviour, and the sentence in question
is about *when to trust a result*. An instruction file that cites a command
which cannot run undermines the rule it is illustrating.

*Fix:* one word. And a validator asserting that backticked `scripts/*.mjs` paths
in `CLAUDE.md` and `docs/*.md` resolve on disk would be about twenty lines,
cheap, and would have caught this.

### 8. Two proxies decode path segments differently, and neither says why

**CONFIRMED.** `functions/data/browse/[[path]].js:42`:

```js
const key = `data/browse/${context.params.path.map(decodeURIComponent).join('/')}`;
```

`functions/data/maps/[[path]].js:16`:

```js
const key = `data/maps/${context.params.path.join('/')}`;
```

Both files carry long comments justifying the *other* deliberate differences
between them — the cache policy, the fall-through, the ETag handling. This one
is undocumented, which under principle 8 means it reads as drift.

One of them is wrong, and which one depends on whether Pages pre-decodes
`context.params`. If it does, `decodeURIComponent` is a double-decode: a browse
key containing a literal `%` breaks, and a malformed sequence such as
`/data/browse/foo%zz.json` throws `URIError` and returns a 1101 runtime error
instead of a 404. If it does not, the maps proxy cannot serve any key with a
space or a non-ASCII character.

*Fix:* determine which, make both match, and write the answer down next to both.
This is the exact case principle 8 exists for.

### 9. `joinExt` is a contract nobody honours

**CONFIRMED.** `functions/_api/proni/_query.js:57-59` documents:

> any caller that passes from/to must JOIN `ext` — signalled by the returned
> `joinExt` flag so callers can add the join only when it's needed

`buildFilters` duly returns it. Both callers ignore it —
`proni/search.js:111` and `proni/export.js:38` destructure only `where` and
`binds`, and both hard-code `LEFT JOIN ext ON ext.ref = p.ref` unconditionally.

The flag is dead, and the comment describes an architecture that was not built.
A cold reader trying to add a third caller will implement the documented
contract and find it makes no difference.

*Fix:* delete the flag and the paragraph, or use it. Deleting is safe — no
caller reads it.

### 10. SQL aliasing by string surgery

**CONFIRMED.** `functions/_api/elections/index.js:246`:

```js
`SELECT c.${CONS_COLS.split(', ').join(', c.')}, c.meta, `
```

This works today. It works only because no entry in `CONS_COLS` contains the
substring `", "`. The moment one does — `COALESCE(a, b) AS x`, or a reformat
that changes the separator — it emits invalid SQL, and the failure surfaces as a
500 at runtime rather than anywhere near the edit.

*Fix:* make `CONS_COLS` an array and derive both forms:
`COLS.join(', ')` and `COLS.map((c) => 'c.' + c).join(', ')`.

### 11. Database error messages are returned to the client

**CONFIRMED.** Three endpoints return the raw exception text:

- `catalogue/index.js:94` — `detail: String(error?.message || error)`
- `elections/index.js:263` — `String(error.message || error)`
- `proni/search.js:148` — `String(error && error.message || error)`

D1 errors carry SQL fragments and column names. This is a public,
unauthenticated surface. It is genuinely useful in development and the
disclosure is minor — schema, not data — but it should be a deliberate switch
rather than the default.

*Fix:* log the detail, return a correlation id. Or gate on an env var.

### 12. `matched` changes type between endpoints

**CONFIRMED.** In bundle mode, `elections/index.js:229` normalises:
`matched: feature.matched === 1` — a boolean. In the single-election path
(line 247) the column comes straight through the JOIN as SQLite's `0`/`1`
integer.

Both are truthy-correct, so nothing breaks today. A client doing
`matched === true` against the wrong endpoint gets silently wrong counts.

### 13. Unauthenticated bulk export

**CONFIRMED.** `functions/_api/proni/export.js` streams up to 50,000 rows in
1,000-row pages — 50 D1 queries per request — with no authentication, no rate
limit and no cache. The data is public and publishable under OGL, so this is a
cost and availability question, not a disclosure one. Worth knowing it is there.

### 14. CSV formula injection

PLAUSIBLE. `export.js:21-24` quotes correctly for RFC 4180 but does not neutralise
leading `=`, `+`, `-` or `@`. A PRONI description beginning with one of those
becomes a live formula when the export is opened in Excel — and the file is
served with a BOM specifically so Excel opens it.

The content is a public archival catalogue, not attacker-controlled, so the
realistic risk is low. The mitigation is one line: prefix such cells with `'`.

### 15. A byte limit that does not count bytes

**CONFIRMED.** `submit.js:30,43` — `MAX_JSON_BYTES = 96 * 1024`, checked as
`raw.length > MAX_JSON_BYTES`. `String.length` counts UTF-16 code units, so a
body of non-Latin text can be up to four times the nominal limit. Also, the body
is fully read by `.text()` before the check, so the limit bounds what is stored,
not what is received.

Harmless at current scale. Named wrongly, which is the part worth fixing.

---

## What holds up well

Reviews that only list defects give a false picture. These were checked and are
sound:

**Escaping in `browse/browse.js` is systematic and correct.** All 41 `innerHTML`
assignments were examined. Every interpolation of catalogue, PRONI or
contributor data passes through `escapeHtml`/`escapeAttr`; `escapeHtml`
(line 3632) covers `& < > " '`; `renderFieldValue` (2561) escapes every branch
including the JSON one, and validates `^https?://` before emitting an `href`.
No unescaped sink was found. For a 3,600-line hand-written file with no
templating library, that is unusual.

**The open-redirect guard in `login.js` is genuinely defended.** `safeReturnPath`
rejects protocol-relative `//host` and backslash variants, and the result is
re-anchored through `new URL(safePath, url.origin)` — two independent layers,
with the attack cases named in the comment. It is also exported for direct
testing, which is why it can be believed.

**Every one of the 31 `check:` targets has a reachable failure path.** Traced
mechanically: each `npm run check:*` resolves to a file that can `process.exit(1)`,
set a non-zero exit code, or throw. `test:chunked-fit` looked like an exception
and is not — it uses `node:assert/strict`.

**Zero `TODO`, `FIXME`, `HACK` or `eslint-disable` markers** across `functions/`,
`browse/` and `app/src/`.

**The contribution security model does not depend on this code being correct.**
`decide.js` records a decision and writes nothing else; enactment is a local
script producing a branch. The comment at `decide.js:12-20` states this
explicitly. It means findings 1 and 4 are correctness problems, not security
ones — the worst they can do is waste review attention.

---

## What this review could not see

It read code and made one live request. It did not execute the Functions, did
not exercise the Access flow, and did not read `scripts/` beyond tracing the
gate. Three specific gaps:

- **`scripts/` at 203,589 lines is effectively unreviewed.** Only the 31 files
  reachable from `npm run check` were inspected, and those only for a failure
  path. Whatever is in the other ~475 files, this pass did not look at it.
- **Finding 8 is unresolved, not merely unfixed.** Which proxy is right is a
  question about Cloudflare's behaviour that a live request could settle in a
  minute.
- **The client stacks were reviewed structurally, not line by line.**
  `app/src/election-manager.js` (5,303 lines) and `src/ui-controller.js`
  (11,620) were measured, and their imports traced, but not read end to end.
  `election-manager.js` imports `src/jquery-shim.js` — 556 lines emulating
  jQuery so that older DOM code need not be rewritten — which is the kind of
  thing that deserves its own pass.
