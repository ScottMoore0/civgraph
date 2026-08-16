# Contributions: proposing changes without being able to make them

> **Status: current — system built, not yet open.** The contribution path is
> implemented and Cloudflare Access is live over `/_api/contributions/*`. Two
> contributors and one admin are configured.

Written 2026-08-13. **Not yet switched on** — see *Enabling it* below.

Contributors propose changes. Only the site owner enacts them. This document is
mostly about how that separation is enforced, because the enforcement is the
interesting part.

## The design in one line

A contributor can express *any* metadata change the owner can make — including
retiring a layer — as a typed patch that a machine can apply; but the only thing
that can turn a patch into a change is a person with the repository and a
terminal, and the result arrives as a branch.

## Why enactment is not an endpoint

The obvious design is: admin clicks approve, the Function writes to the
catalogue. It is rejected here deliberately.

That design makes the boundary between *requesting* and *enacting* rest on
`functions/_api/_auth.js` being correct. In this project, that file has carried
both of the following at once:

- `allowed = authenticated && (!allowlistConfigured || ...)` — with no allowlist
  set, **any** Access-authenticated identity was a contributor, and Access
  commonly issues one-time PINs to any address that asks;
- a `CIVGRAPH_DEV_AUTH_EMAIL` variable that bypassed authentication entirely,
  active on the presence of one variable.

Both are fixed. Neither should have been load-bearing for write access to
published data. So the boundary rests on **who can push to main** instead, which
GitHub enforces and which no bug in the Functions layer can weaken.

The worst a flaw in the approval endpoint can now do is mark a submission
approved that the owner did not want. The owner still has to run the apply step,
read the diff, pass the full validator gate, and merge.

## The flow

```
contributor                    edge (Cloudflare)              owner (local)
-----------                    -----------------              -------------
POST /_api/contributions/
     intake        ──────────▶ quarantine/  (private R2)
                               never served, octet-stream

POST /_api/contributions/
     submit        ──────────▶ dry-run against live record
                               │ invalid → 422, not queued
                               ▼
                               queue, status=pending-review

                               GET  /_api/contributions/list    ◀── admin only
                               POST /_api/contributions/decide  ◀── admin only
                               status=approved   (nothing applied)

                                                          npm run contributions:apply
                                                          → new branch, catalogue edited
                                                          → npm run check
                                                          → review diff, push, merge
                                                          → Pages deploys
```

## What a contributor can propose

Three kinds:

| Kind | Carries | Applied by the script? |
|---|---|---|
| `metadata-edit` | a typed `patch` of field → value | yes, mechanically |
| `retire` | `entityId` + `reason` | yes — sets `hidden: true` |
| `map-submission` | title, geography, dates, provider, licence claim, sources | no: reviewed by hand |

`retire` sets `hidden`, never deletes. A deleted record loses its history, its
slug and any inbound link; a hidden one stops being offered and is recoverable
by flipping one boolean.

`map-submission` is deliberately not mechanically applicable. Turning a source
into a layer needs a licence determination, conversion, tiling and a catalogue
entry — it is a research lead, not a change.

## What they cannot propose, and why

`EDITABLE_FIELDS` in `functions/_api/contributions/_schema.js` is narrower than
the record. Excluded from `map`: `id`, `slug`, `files`, `style`. Changing any of
those silently repoints or unpublishes a layer, which is not a metadata
correction and should not arrive looking like one.

Nothing outside record metadata is reachable at all: not site code, build
scripts, validators, workflows, the publication allowlist, D1 schemas, or
anything served. Code contributions are what pull requests are for.

## The dry run

`submit` validates the patch against the live record and returns the result. An
invalid patch is **rejected with 422 and never queued** — a queue of known-broken
proposals costs review attention for no possible benefit.

The dry run reports `checkedAgainstCurrentRecord`. When the record cannot be
reached it says so rather than reporting a pass it did not earn; a check that
cannot distinguish "passed" from "did not run" is worse than no check.

Two rules earn their place from real incidents:

- **Line breaks are rejected** in labels, keywords and other strings. A stray
  `\n` in a label value broke the 2016 general-election fill on the live map and
  needed a client-side workaround.
- **Name/date year disagreement warns** (does not block). Six layers carried a
  wrong year until they were corrected by hand.

`scripts/test-contribution-schema.mjs` covers 28 cases and runs in `npm run
check`. It has been negative-controlled: removing the line-break rule fails
exactly the two tests that cover it.

## Enabling it

**Order matters.** Access last, because until the allowlists exist there is
nobody to let in.

1. **Queue.** Create a KV namespace and bind it as `CIVGRAPH_CONTRIBUTION_QUEUE`
   in `wrangler.toml`. Until this exists, `submit` returns 503 — a clean closed
   door.
2. **People.** Set `CIVGRAPH_CONTRIBUTORS` (may propose) and `CIVGRAPH_ADMINS`
   (may approve) to comma-separated addresses. Both are **fail-closed**: an empty
   list means nobody, including the owner. The two lists are independent — being
   allowed to propose never implies being allowed to approve.
3. **Confirm the bypass is off.** `CIVGRAPH_ALLOW_DEV_AUTH` must be unset in
   production. It now takes *two* variables to enable the dev identity, so it
   cannot happen by a single mistaken copy, but check anyway.
4. **Access.** Identity provider: **GitHub** (chosen 2026-08-13). Put Cloudflare
   Access in front of `/_api/contributions/*` with a policy naming the same
   addresses. Access is authentication; the allowlists are authorisation. Both,
   so a mistake in either one does not open anything.

   **Cover both hostnames.** The contribution endpoints answer on `civgraph.net`
   AND on `boundaries-website.pages.dev` -- verified 2026-08-13, both returning
   401. Access applications are configured per hostname, so protecting only the
   custom domain leaves the pages.dev origin as an unprotected route to the same
   Functions. Either add both, or disable the pages.dev subdomain for the project.

   **Which address to list.** GitHub asserts the account's PRIMARY VERIFIED
   EMAIL, from GitHub -> Settings -> Emails. That is not necessarily the address
   someone gives you, and it is *not* the `...@users.noreply.github.com` address
   in their commits -- Access requests the `user:email` scope, which returns the
   primary address even when the profile email is private. Ask each contributor
   for their GitHub primary specifically.

   When it still mismatches, the 403 from `requireContributor` names the address
   that actually arrived, so the fix is one line rather than a debugging session.
   `/_api/auth/status` shows the same thing.
5. **Optional, stage 3.** Bind a **private** R2 bucket as `CIVGRAPH_QUARANTINE`
   for file intake. It must not be `boundaries-data` and must not have a public
   custom domain. Absent the binding, `intake` returns 503.

## Reviewing

```bash
npm run contributions:list                      # what is waiting
npm run contributions:apply -- --apply <id> --dry-run
npm run contributions:apply -- --apply-all-approved
npm run check
```

The apply script re-reads each submission and refuses anything whose stored
status is not `approved`, even if the queue metadata says otherwise — the record
is the authority, and a mismatch means something wrote one and not the other.

## Obligations this creates

- **Personal data.** Submissions store the contributor's email address and user
  agent. That needs a privacy notice and a retention policy; KV entries otherwise
  live forever.
- **Hosting third-party files** (stage 3 only). Size cap 25 MB, extension
  allowlist, stored as `application/octet-stream` so nothing in the bucket is
  interpreted as HTML if it is ever exposed by mistake. Retention and takedown
  are still policy questions, not code ones.
- **An attended queue.** An unattended one is worse than a closed door: people
  submit, nothing happens, and the site looks abandoned.
