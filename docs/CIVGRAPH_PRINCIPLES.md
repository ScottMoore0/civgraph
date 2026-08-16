# Civgraph Principles

> **Status: current — the standard this project is built and amended against.**
> Written 2026-08-16. Every principle below is either enforced by a validator in
> `npm run check`, or marked as not yet enforced. Principles nothing checks decay
> into decoration, so the enforcement column is the point.

## Goal

Civgraph is a public reference for the historical and present geography of
Ireland, north and south: boundaries, elections, census, records and the sources
behind them. It should be maximally **verifiable, reversible, inspectable and
attributable** — a reader should be able to establish where any statement came
from, and a maintainer should be able to establish what the system is actually
doing rather than what it is believed to be doing.

Civgraph is a *published dataset with a map on top*, not an application that
happens to hold data. That ordering decides most arguments. Data correctness,
provenance and durability outrank interface polish; a wrong boundary served
quickly is worse than a right one served slowly.

It should embody **convergent engineering**: design choices should follow from
the constraints of publishing a large, slowly-changing, citable geographic
dataset from a static-first edge platform — not from framework fashion,
architectural taste, or the shape of whatever was built first. Prefer the
smallest clear system that fully expresses the required behaviour. Superfluous
machinery is technical debt unless it clearly earns its place.

Civgraph is not a GIS platform, not a CMS, and not a general mapping toolkit. It
is one site, one dataset, one maintainer, and — increasingly — a small number of
named contributors. Machinery that would only pay off at ten times the size
should be refused.

---

## Design principles

1. **Verify the property that matters, not one adjacent to it.** A status code
   does not prove which system answered; only a response header distinguishes a
   Function from a static file shadowing it. Choose the check that can only pass
   for the right reason.

2. **A check nobody has watched fail is not known to work.** Every validator
   should be negative-controlled: break the thing deliberately, confirm the check
   goes red, restore. An assertion that cannot fail is worse than none, because
   it is trusted.

3. **Derive values; do not maintain them by hand.** Cache-busting tokens,
   exclusion lists and budget counts drift the moment someone forgets. If a value
   is a function of file contents, compute it from the file contents.

4. **Fail closed.** Absent configuration means "nobody" and "no", never "anyone"
   and "yes". The dangerous moment is the one before configuration is finished.

5. **Nothing is deleted or untracked until it is proven served from its new
   home.** Prove first, remove second — and prove by fetching the new source, not
   by reasoning about it.

6. **Publication is irreversible; provenance precedes it.** Anything written to
   the public bucket is public forever. Establish where material came from and
   under what terms *before* it ships, not after.

7. **Requesting a change and enacting one are separate, and the boundary rests
   outside the application.** Contributors propose; enactment is a git merge.
   That boundary must not depend on application auth code being correct.

8. **Deliberate difference must be justified at the point of difference.** This
   codebase is full of asymmetries that look like drift and are not — one proxy
   falls through where another returns 404; one workflow uses `npm install` where
   the others use `npm ci`. Each is right, and each is only safe from a
   well-meaning tidy-up because the reason sits next to the code.

9. **The deployed artefact is not necessarily the running one.** Between a
   correct commit and a correct page sit caches, cache tokens, secrets that need
   a redeploy, and edge TTLs. When something "does nothing", check what is
   actually executing before suspecting the code.

10. **Prefer data over code, and files over services.** A record in
    `data/database/` beats a special case in a script; a static asset beats a
    Function; a Function beats a server. Move up that ladder only when the rung
    below genuinely cannot do it.

11. **The catalogue is the spine.** Layers, sources, elections and records are
    described by tracked data, and the site is a projection of it. Anything that
    cannot be expressed as catalogue data is probably in the wrong place.

12. **Large binaries live in R2, not git.** The repository holds code, catalogue
    and small tracked inputs. Build output and geometry belong in the bucket,
    with the repository holding the recipe.

13. **Documents declare their status.** Every plan, runbook and review states
    whether it is current, completed, superseded or point-in-time. An undated
    document that reads as current is a trap for the next reader — including the
    author six weeks later.

14. **Third-party content is quarantined until reviewed.** Contributor uploads
    and fetched files land somewhere private, gitignored and unserved, and are
    promoted only after inspection.

15. **Optimise for the reader who arrives cold.** The measure of a change is
    whether someone with no context can understand what the system does and why
    it does it that way. Comments explain *why*, not *what*.

---

## Core invariants

- The catalogue in `data/database/` is authoritative; D1 and the Browse indexes
  are projections of it.
- `wrangler.toml` is authoritative for bindings. Dashboard configuration that
  cannot live in the repo is recorded in `docs/cloudflare-inventory.md`.
- Everything in the public bucket passed the publication allowlist.
- Every published layer is reachable, and every catalogue reference resolves.
- `npm run check` passes on `main`, and CI runs the real build on a clean
  checkout.
- Contributors cannot enact changes. Approval records a decision; only a merge
  changes the site.
- No credential is ever committed. Secrets live in `.env.local` or Pages secrets.
- Nothing personal or private is published, whatever the mechanism.
- A clean checkout can build the site.

---

## Enforcement

The point of this file is that most of it is machine-checked. Where a principle
is not enforced, that is stated rather than hidden.

| # | Principle | Enforced by |
|---|---|---|
| 1 | Verify what matters | `npm run verify:proxies` — asserts cache-header signatures, not status codes |
| 2 | Negative controls | Convention, not automated. Applied to `check:contributions`, `check:browse-cache`, `verify:proxies` |
| 3 | Derive, don't maintain | `check:browse-cache` (content-hash tokens); `check:pages-assets` (reads `.cfignore`, distrusts globs) |
| 4 | Fail closed | `functions/_api/_auth.js`; `check:contributions` covers the empty-allowlist case |
| 5 | Prove before removing | `preflight:migration`; `check:r2-parity` |
| 6 | Provenance before publication | `check:r2-allowlist`; `check:approved-publication`; `lib/r2-publication-gate.mjs` |
| 7 | Propose ≠ enact | `check:contributions` — 39 flow checks incl. "a contributor cannot approve" |
| 8 | Justify difference | **Not enforced.** Convention only |
| 9 | Deployed ≠ running | `verify:proxies`; `check:browse-cache` |
| 10 | Data over code | **Not enforced.** Judgement |
| 11 | Catalogue is the spine | `check:catalogue-render-parity`; `check:catalogue-d1`; `check:c1-coverage` |
| 12 | Binaries in R2 | `check:pages-assets`; `check:r2-parity`; `.gitignore` |
| 13 | Documents declare status | **Not enforced.** Candidate validator — see below |
| 14 | Quarantine third-party content | `.gitignore` for `data/quarantine/`; `--tracked-only` on uploads |
| 15 | Optimise for the cold reader | **Not enforced.** Judgement |

### Candidate validators

Principles 8, 10, 13 and 15 are unenforced. Only one is mechanisable cheaply:

- **13 — document status.** A validator asserting every `docs/*.md` and
  root-level plan carries a `> **Status:` banner within its first fourteen lines.
  All of them do as of 2026-08-16; without a check, the next one added will not.

8, 10 and 15 are judgement calls. They belong in review, not in CI, and pretending
otherwise would produce a check that passes for the wrong reasons — which
principle 2 exists to prevent.

---

## How to use this file

When proposing a change, state which principles it serves and which it strains.
When a principle and a deadline conflict, say so explicitly rather than quietly
choosing. When a principle turns out to be wrong, change it here first — a rule
the codebase has already abandoned is worse than no rule.

Every principle above was learned from something that went wrong in this
repository. None is aspirational.
