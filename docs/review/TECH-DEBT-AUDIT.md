# Technical debt audit

> **Status: point-in-time audit — 2026-08-16, partially applied.** Findings are
> scored against `docs/CIVGRAPH_PRINCIPLES.md`. Verify each item before acting:
> several were fixed the same week this was written, and this document will age
> the same way.
>
> **Item 4 was factually wrong and has been rewritten** — see the note on it.
> That is worth reading before trusting anything else here: it was caught by a
> separate review pass, not by re-reading this file, and an audit is exactly the
> kind of document whose errors get inherited rather than checked.
>
> Applied since writing: items 1, 2, 3 and 5 (elections schema recorded, deploy
> watcher no longer reports green when unconfigured, Node pinned, `labelProperty`
> set). Item 12 landed with the simplification merge.

Scope: the GitHub repository and the Cloudflare deployment. Written to be
synthesised with other review outputs into a single remediation plan.

**Scoring.** `Priority = (Impact + Risk) × (6 − Effort)`, each 1–5. Impact is how
much it slows work; Risk is what happens if it is left; Effort is inverted, so
cheap fixes rank higher. Scores are judgement, not measurement — the *ordering*
is the useful output, not the arithmetic.

## Measured shape

    tracked files        14,973          scripts (js/mjs)     223
    .git pack            5.86 GiB        scripts (python)     227
    npm scripts          100             validators in check   31
    playwright specs     15              unit-test scripts      6
    tracked src/ files   16              engines pin          none

---

## Priority order

| # | Item | Type | I | R | E | Score |
|---|---|---|---|---|---|---|
| 1 | Elections D1 has no schema in the repo | Architecture | 3 | 4 | 1 | **35** |
| 2 | No deploy failure alerting | Infrastructure | 2 | 4 | 1 | **30** |
| 3 | No Node version pinned | Dependency | 2 | 3 | 1 | **25** |
| 4 | `src/` is the least-understood directory in the repo | Architecture | 4 | 2 | 2 | **24** |
| 5 | `labelProperty` unset on 4 published layers | Code | 2 | 2 | 1 | **20** |
| 6 | `.git` is 5.86 GiB | Infrastructure | 3 | 3 | 3 | **18** |
| 7 | `proni-roots.json` has no generator | Architecture | 2 | 4 | 3 | **18** |
| 8 | Dependencies uniformly behind | Dependency | 1 | 3 | 2 | **16** |
| 9 | `data/books` provenance unresolved | Documentation | 1 | 4 | 3 | **15** |
| 10 | 220 UX findings of unknown status | Documentation | 3 | 2 | 3 | **15** |
| 11 | `browse/` is hand-written, not built | Architecture | 2 | 3 | 3 | **15** |
| 12 | Triple-named binding tolerance in `_auth.js` | Code | 1 | 2 | 1 | **15** |
| 13 | 450 scripts, 100 npm entries | Code | 4 | 2 | 4 | **12** |
| 14 | 1,196 thumbnails deployed unnecessarily | Infrastructure | 1 | 2 | 2 | **12** |
| 15 | `test/` `test2/` `tests/` naming | Architecture | 4 | 3 | 4 | **14** |
| 16 | 371 baselined parity findings | Test | 2 | 3 | 4 | **10** |
| 17 | Timeline rebuild race | Code | 2 | 3 | 4 | **10** |
| 18 | Quarantine intake bound to nothing | Infrastructure | 1 | 1 | 1 | **10** |
| 19 | No `_routes.json` | Infrastructure | 1 | 2 | 3 | **9** |
| 20 | 98 hidden maps with orphaned Browse details | Code | 1 | 1 | 2 | **8** |

---

## The items that matter most

### 1. Elections D1 has no schema in the repository — 35

`docs/cloudflare-inventory.md` records that the shape of `civgraph-elections` is
*inferred from the queries in `functions/_api/elections/index.js`*. There is no
DDL anywhere in the repo. The database holds 40.3 MB of election data.

If that database were lost or corrupted, its structure would have to be
reverse-engineered from four SQL queries before anything could be restored.

Violates **principle 11** (the catalogue is the spine — projections should be
reproducible) and **principle 5** in spirit: nothing should exist only in one
place without a recorded way to rebuild it.

*Proposal:* dump the schema to `data/database/elections-schema.sql`, tracked, and
add a validator asserting the live D1 still matches it. Half a day.

### 2. No deploy failure alerting — 30

`pages-deploy-watch.yml` is dormant by choice and reports a **green tick when
unconfigured**, which is worse than absent: a passing check that means "not
configured" invites exactly the misreading that let 18 consecutive deploy
failures go unnoticed in August.

Violates **principle 1** (verify the property that matters) and **principle 2**
(a check that cannot fail).

*Proposal:* enable the Cloudflare dashboard notification — thirty seconds, no
token — or add the two secrets. Then make the dormant workflow report a *neutral*
or failing status when unconfigured rather than green.

### 3. No Node version pinned — 25

No `engines` field, no `.nvmrc`. CI runs Node 24; the local machine runs 24;
Cloudflare Pages runs whatever it defaults to. This already bit twice this week:
`execFileSync` refusing to spawn `.cmd` (a Node 20+ change) and `canvas` failing
to compile on the runner.

*Proposal:* add `engines.node` and `.nvmrc`. Under an hour, and it converts a
class of confusing runtime failure into an install-time error.

### 4. `src/` is the least-understood directory in the repository — 24

> **Corrected 2026-08-16.** This item previously read *"`src/` mixes live and
> dead code"* and asserted that `src/ui-controller.js` was the dead Leaflet
> stack. Both halves were false, and the remediation that followed from them was
> wrong. `docs/review/CODE-REVIEW.md` finding 3 caught it. The original text is
> in git history; what follows replaces it.

Nothing in `src/` is dead. Measured:

    src/ (excluding vendored libs)   36,028 lines across 14 files
    src/ui-controller.js             11,620 lines — the largest hand-written
                                     file in the repository
    Leaflet references in src/       2, both in feature-loader.js

`app/src/app.js` imports `ui-controller.js` on line 3 and drives it throughout —
`uiController.init()`, feature-info display, split-pane state, catalogue
rendering, the entire election wiring block. It is not merely live; it is the
UI layer of the public homepage.

The real problem is narrower than the one recorded, and worse in one respect.
A directory named `src/` sitting at the repository root reads as *the source of
the site*. It is not: the site is built from `app/src/`. Yet `src/` holds the
largest live modules in the project, and two separate documents described it as
dead — this audit and the ESLint config, which excluded it *on that basis*, so
36,028 lines of load-bearing code went unlinted for as long as the belief
survived.

That is principle 15 failing in the way that costs most: not a confusing name on
its own, but a confusing name that everyone downstream then reasons from.

*Already done:* the ESLint exclusion is lifted (`src/` is linted as of
2026-08-16 — 32 warnings, zero errors), and `CODE-REVIEW.md` finding 2 records
the measurement.

*Proposal, in cost order:*

1. A `src/README.md`, twenty lines, stating what the directory is, what imports
   it, and that it is neither dead nor the site's entry point. This removes most
   of the confusion for the price of an afternoon and should not wait for 2.
2. Rename or relocate so the name stops lying. This invalidates clones and
   touches every import, so it belongs with the other deferred rename rather
   than on its own.
3. Separately: `src/jquery-shim.js` is 556 lines emulating jQuery so that older
   DOM code in `app/src/election-manager.js` need not be rewritten. That is real
   debt, but it is a rewrite of the call sites rather than a directory question,
   and it should be its own item rather than smuggled in here.

Verify any of this with a real browser, not static analysis —
`docs/src-orphan-runtime-check.md` records why.

### 5. `labelProperty` unset on four published layers — 20

`roi-local-authorities-1915`, `-1920-06-19`, `-1920-06-25`, `-1920-10-04` have no
`labelProperty`. Their geometry carries `ENGLISH`, `GAEILGE` and `COUNTYNAME`, so
they currently render without labels.

*Proposal:* one editorial decision — English or Irish — then four catalogue
edits. The decision is yours; the change is trivial. Consider a validator warning
when a polygon layer has no `labelProperty` and its geometry offers candidates.

---

## Notable, lower priority

**`.git` at 5.86 GiB (6).** A newcomer clones six gigabytes to get a 14,973-file
repository. `filter-repo` would reclaim most of it, including the 2.48 GB
untracked this week — but it rewrites every SHA, invalidates clones, and eight
commit SHAs are cited in `docs/`. Do it once, after the remaining data migrations
settle, alongside any history redaction.

**`proni-roots.json` has no generator (7).** 1.39 MB, fetched by `browse.js` with
a silent `.catch(() => null)`, and nothing in `scripts/` produces it. If lost, a
Browse section empties with no error. Currently protected only by a `.gitignore`
negation and a comment. Either write the generator or document its provenance as
source material.

**450 scripts and 100 npm entries (13).** Scored low only because the effort is
high and the risk is diffuse. But for the stated goal — an outside developer
making sense of this — a hundred npm scripts with no grouping is a real barrier.
A `scripts/README.md` mapping them to purposes would cost an afternoon and help
more than most items above it.

**`test/`, `test2/`, `tests/` (15).** Already fully de-risked: runbook written,
461 references inventoried and ratcheted, CI now proven green. This is *ready*,
not blocked — it scores mid-table only because the effort is genuinely large.

**371 baselined parity findings (16).** Ratcheted so they cannot grow. The debt
is that nobody has decided whether the remaining 371 are acceptable-forever or a
backlog. A baseline with no expiry is a decision deferred indefinitely.

---

## Phased plan

**Phase 1 — a day, no coordination needed.** Items 1, 2, 3, 5, 12, 18. Schema
dump, deploy alert, Node pin, labelProperty decision, drop the legacy binding
aliases, decide whether file intake is wanted. These are independent, cheap, and
each closes a real gap.

**Phase 2 — a week, alongside feature work.** Items 4, 7, 9, 10, 11, 14.
Disentangle `src/`; resolve `proni-roots.json`; settle `data/books` provenance;
triage the 220 UX findings; give `browse/` a build step; drop the thumbnails from
the deploy.

**Phase 3 — deliberate, scheduled.** Items 6, 15, 16, 17. The `.git` rewrite and
the directory rename both invalidate clones, so do them together, once, and
announce them. Then the parity baseline and the timeline race.

**Explicitly not scheduled.** Item 13 (script sprawl) and item 19 (`_routes.json`)
should stay open until there is a reason. Consolidating 450 scripts without a
forcing need is the kind of superfluous machinery **principle 10** warns against,
and `_routes.json` would change which requests reach Functions — with
`functions/data/maps/[[path]].js` owning the prefix every layer loads from, a
mistake takes out map serving site-wide.

---

## What this audit could not see

It read files. The Cloudflare control plane — Access policies, live bindings, DNS,
cache rules, whether a secret has propagated — is invisible to it, and that is
where most of this month's actual failures lived. `docs/cloudflare-inventory.md`
plus `npm run verify:proxies` remain the only instruments for that half, and both
depend on someone choosing to run them.
