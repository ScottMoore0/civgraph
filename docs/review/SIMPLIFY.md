# Simplification pass

> **Status: completed experiment - 2026-08-16. The changes exist on the branch
> `scratch/simplify-2026-08-16` and have NOT been merged.** One commit, 14 files,
> +120/-79. The full gate passes on that branch. Merging is a decision, not a
> formality - read "What was rejected" first, because most of what a
> simplification pass would normally do is wrong here.

Third of three review passes, alongside `docs/review/TECH-DEBT-AUDIT.md` and
`docs/review/CODE-REVIEW.md`.

## Method

The `code-simplifier` plugin is not installed, and would not have fitted: it
edits autonomously, targets TypeScript/React idioms this project does not use,
and scopes itself to "recently modified code". This pass followed its stated
principles - preserve functionality exactly, reduce nesting and duplication,
prefer explicit over compact, do not remove helpful abstractions - on a scratch
branch, so that nothing lands until the diff has been read.

Every change was verified three ways: `node --check` on each file, the project's
own gate (`npm run check`, all 31 targets), and a purpose-written
behaviour-equivalence harness for the one refactor that touched a live code
path.

## The headline number is the interesting one

    code lines removed        73
    code lines added          50
    net code                 -23

    comment and blank lines  +47
    net total                +24

    functions/ before     2,438 lines
    functions/ after      2,462 lines

**The code got smaller and the files got bigger.** That is not a failure of the
pass; it is the finding. In three of the four changes, what was missing was
never lines of code - it was the reason. The method guard had been copied into
nine files and not one of them said why it existed, which left it reading as
ceremony and one tidy-up away from deletion. Replacing nine copies with one
helper saved twenty lines of code and gave the reason somewhere to live, and the
reason is longer than the code.

Anyone measuring this pass on lines removed would conclude it failed.

---

## What changed

### 1. The method guard, nine copies to one helper

Nine routes each carried an identical six-line block:

```js
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' },
                        { status: 405, headers: { Allow: 'POST' } });
  }
  return onRequestPost(context);
}
```

Now `functions/_api/_method.js` holds `methodGuard(method, handler, notAllowed)`
and each route reads:

```js
export const onRequest = methodGuard('POST', onRequestPost, jsonNotAllowed);
```

The 405 body differs between the JSON routes and the two plain-text ones, which
is why the responder is a parameter rather than baked in. `jsonNotAllowed` sits
in `_auth.js` beside the `jsonResponse` envelope it uses, so `_method.js` stays
dependency-free.

**This was nearly rejected.** Nine copies of six lines is 54 lines; the helper
plus nine imports is not obviously less. What tipped it was that the guard is
load-bearing and undocumented: a Pages module exporting only `onRequestPost` has
no handler for a GET, so the request falls through to the static asset layer -
which on this project has an SPA-shaped fallback that answers 200. That is the
"a missing thing answered with `index.html` at HTTP 200" trap this codebase has
already been bitten by twice. Nine files were each defending against it in
silence. Now one file explains it.

*Verification.* `scripts/` has no coverage of the 405 path, so a harness was
written for this pass: every one of the nine routes, called with the wrong verb,
must return 405 with the right `Allow` header and the right content type - plus
a negative control confirming the correct verb still passes through (login still
302s). All ten assertions pass. The harness is throwaway; if this branch is
merged, it should become a permanent check, because otherwise the refactor is
protected by nothing.

### 2. `joinExt` - a documented contract nobody honoured

`functions/_api/proni/_query.js` returned a `joinExt` flag and documented it:

> signalled by the returned `joinExt` flag so callers can add the join only when
> it's needed

Both callers ignore it and hard-code `LEFT JOIN ext` unconditionally. The flag
was dead and the comment described an architecture that was never built - the
worst kind of stale, because a cold reader would implement it and find it makes
no difference. Flag and paragraph removed; the comment now records that the join
is unconditional and why the flag went. See `CODE-REVIEW.md` finding 9.

### 3. SQL aliasing by string surgery

`functions/_api/elections/index.js` built the aliased column list by splitting a
string on `", "` and re-joining with `", c."`. Correct today, and correct only
while no column expression contains that substring - `COALESCE(a, b) AS x` would
emit invalid SQL, surfacing as a 500 nowhere near the edit. Now a list, with
both forms derived from it. The generated SQL is byte-identical.

### 4. ESLint config

Removed a duplicated `'archive/**'` ignore entry, corrected a cross-reference to
a tech-debt item number that no longer means what it did, and replaced the scope
comment with the measured truth: three live hand-written trees totalling 43,947
lines have no rules applied. See `CODE-REVIEW.md` finding 2.

---

## What was rejected, and why that matters more

A simplification pass on this codebase mostly consists of deciding *not* to
simplify. The reason is principle 8 - deliberate difference must be justified at
the point of difference - and this project has spent a lot of comment budget
earning the right to be asymmetric.

**The proxy asymmetries.** `functions/data/graph/` falls through on a miss;
`functions/data/maps/` returns 404; `functions/data/browse/` returns 404 and
handles ETags. Three prefixes, three cache policies, three miss behaviours. A
naive pass unifies them and breaks the staged migration, the Browse freshness
guarantee, or both. Each file already explains itself. Left alone. (The one
undocumented difference between them - path decoding - is `CODE-REVIEW.md`
finding 8, and it is a question to answer, not a thing to tidy.)

**`onRequestPost` alongside `onRequest`.** The inner `return onRequestPost(context)`
is unreachable, because Pages dispatches POST to the method-specific export
directly. Removing it is a one-line "simplification" that depends entirely on
Cloudflare's dispatch order never changing. Kept.

**`browse/browse.js`, 3,647 lines in one file.** The obvious target, and it
survives inspection: no function exceeds 120 lines, all 41 `innerHTML` sinks are
escaped, `escapeHtml` is complete. Splitting it into modules means introducing a
build step for a page that currently has none. That is an architecture decision,
not a simplification, and it belongs in the tech-debt plan.

**`src/ui-controller.js`, 11,620 lines.** The largest hand-written file in the
project and the biggest genuine prize. Out of reach of any safe mechanical pass,
and - per `CODE-REVIEW.md` finding 3 - currently described by two separate
documents as dead code, which it is not. Fix the description before touching the
file.

**`src/jquery-shim.js`, 556 lines.** Imported by `app/src/election-manager.js`:
half a thousand lines emulating jQuery so that older DOM code need not be
rewritten. A real removal candidate and a real piece of debt, but removing it
means rewriting the call sites, which is a project rather than a pass.

**100 npm scripts.** Consolidating them without a forcing need is precisely the
"superfluous machinery" principle 10 warns against, and the tech-debt audit
already parks this. Unchanged.

**The behavioural fixes found along the way.** `search.js` sorting after
truncation, `fetchCurrentRecord` always returning null, the contribution list
truncating at 200 - all real, none of them simplifications. They are
`CODE-REVIEW.md` findings 5, 1 and 4, and they should be fixed as fixes, with
tests, not smuggled in under a refactor.

---

## Two things the gate did on its own

**The dir-names ratchet caught this pass.** The first full run of `npm run check`
on the branch failed:

    FAIL: references grew 468 -> 469.

The offender was a comment written *by this pass* - the rewritten ESLint scope
note named one of the three directories whose rename `check:dir-names` ratchets
(tech-debt item 15). It caught the new reference within minutes of the line
being added, from the person who added it, in a comment. That is a check being
watched fail, which principle 2 says is the only way to know it works. It cost a
reword.

It then fired a second time, on `docs/review/CODE-REVIEW.md`, which quotes two
real paths as evidence: the measured line counts per directory, and the verbatim
`files` glob from the ESLint config that finding 2 rests on. Those references are
legitimate - fuzzing them to appease the ratchet would have made the review less
accurate, which is the defect finding 7 is about. The baseline was therefore
**re-pinned deliberately, 468 to 470**, which is the escape hatch the validator's
own failure message offers. Both new references are DOC-class: after a rename
they leave a stale document, not a 404. Reverse with
`git checkout data/database/directory-name-references-baseline.json` if that
call is wrong.

**`check:doc-status` was not checking the review documents.** Written earlier the
same day, it read only the top level of `docs/`. `docs/review/` is a
subdirectory, so all three review outputs - including this one - were exempt by
accident, and the check reported `PASS: all 21` without looking at them. It now
recurses, reports 24, and has been negative-controlled: stripping a banner turns
it red, restoring it turns it green.

Recursing exposed 35 pre-existing documents in `docs/performance-improvement-handoff/`
and `docs/advanced-styling/` with no status banner. Rather than bulk-stamping
banners onto documents nobody has read, those two directories are named in an
explicit `EXEMPT_DIRS` list with the count and the reason. An exemption someone
must delete a line to remove is a decision; a directory that merely happens not
to be scanned is the accident that just happened.

Both of these are the same lesson in different clothes: a validator that has
never been watched fail is not known to work, and the cheapest moment to find
that out is while you are already looking.

---

## Recommendation

Merge items 2, 3 and 4 - they are small, verified, and remove things that are
actively misleading.

Item 1, the method guard, is the judgement call. It is verified and it passes,
but it touches nine files on the auth path to save twenty lines. Take it **only
together with a permanent version of the 405 harness** in `npm run check`. A
refactor of a security-adjacent guard, protected by a test that was deleted
after it passed once, is a worse position than the duplication it replaced.

The `check:doc-status` fix is not part of that branch - it was made on `main`,
because a validator that silently skips the documents it exists for is a defect
rather than a proposal.

To inspect the branch:

    git diff main..scratch/simplify-2026-08-16
