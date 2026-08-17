# Contributor Login And Browse Submissions

> **Status: SUPERSEDED — 2026-08-16.** Replaced by `docs/contributions.md`, which
> describes the contribution system as it now works: typed patches, an
> admin-only review surface, and enactment behind a git merge.
>
> **This document is actively wrong about a security property.** It states that
> with no allowlist configured, any Access-authenticated email is treated as
> allowed. That was true when written; `functions/_api/_auth.js` was changed on
> 2026-08-13 to fail CLOSED, so an empty allowlist now admits nobody. Do not use
> this file to reason about who can contribute.

This document describes the implemented contributor-login path for Civgraph's `/browse/` section.

## What Exists

The public `/browse/` section remains readable by everyone.

Selected contributors can log in through Cloudflare Access. Once authenticated and allowed, Browse shows contributor tools:

- propose metadata edits for the current Browse entry
- submit a map for review by title, geography, source/provider, source URLs, and notes
- log out through Cloudflare Access

Submissions are review-queue items. They do not mutate production catalogue JSON, election JSON, PMTiles, map files, or generated Browse data directly.

## Routes

### `GET /_api/auth/status`

Returns current contributor status.

Cloudflare Access should provide:

- `CF-Access-Authenticated-User-Email`
- `CF-Access-Jwt-Assertion`

The endpoint returns:

- `auth.authenticated`
- `auth.allowed`
- `auth.isAdmin`
- `auth.email`
- `auth.loginUrl`
- `auth.logoutUrl`
- capability flags for proposing edits and submitting maps

### `POST /_api/contributions/submit`

Accepts authenticated contributor submissions as JSON.

Supported `kind` values:

- `metadata-edit`
- `map-submission`

Durable storage is required. Configure one of:

- KV binding `CIVGRAPH_CONTRIBUTION_QUEUE`
- KV binding `CONTRIBUTION_QUEUE`
- R2 binding `CIVGRAPH_SUBMISSIONS`
- R2 binding `CONTRIBUTION_SUBMISSIONS`

If no queue binding is configured, the endpoint returns `503` and explicitly says the queue is missing. This is intentional: the UI must not claim a proposal was saved when there is no durable review queue.

## Cloudflare Access Setup

Create a Cloudflare Access application for the contributor APIs, not for the whole site.

Recommended protected paths:

- `civgraph.net/_api/auth/status`
- `civgraph.net/_api/contributions/*`

Alternative: protect only `/_api/contributions/*` and allow public status checks. In that case unauthenticated users still see a login URL, while Access enforces auth when they try to submit.

Recommended policy:

- include selected contributor emails
- optionally include an admin group
- do not use broad account-wide access unless every account member should be able to submit edits

## Environment Variables

**One name each. The aliases are gone** — `CONTRIBUTOR_EMAILS`,
`BROWSE_CONTRIBUTORS`, `CONTRIBUTOR_ADMINS`, `BROWSE_ADMINS` and
`BROWSE_DEV_AUTH_EMAIL` were accepted as fallbacks and were removed on
2026-08-17 (tech-debt item 12). Nothing set them. Three accepted spellings for
one secret is not tolerance; it is three places a typo can hide.

| Variable | Purpose |
|---|---|
| `CIVGRAPH_CONTRIBUTORS` | who may propose changes |
| `CIVGRAPH_ADMINS` | who may approve them |
| `CIVGRAPH_DEV_AUTH_EMAIL` | local development identity |
| `CIVGRAPH_ALLOW_DEV_AUTH` | must be `true` as well, or the line above is ignored |

Values are comma, semicolon or whitespace separated email addresses.

**An empty allowlist means NOBODY.** An earlier version of this document said
*"if no allowlist is configured, any Cloudflare Access-authenticated email is
treated as allowed"*. That was true when written and was fixed on 2026-08-13:
`getContributorAuth` now requires the address to appear in a list. Cloudflare
Access commonly issues one-time PINs to any address that asks, so the old
behaviour made an unset allowlist equivalent to an open endpoint — and the moment
of maximum exposure was the moment Access was switched on, before anyone had got
round to setting the lists.

`/_api/auth/status` reports `contributorCount` and `adminCount` — counts only,
never addresses — because Pages secrets are write-only and setting one is
otherwise unverifiable.

The dev override is a complete authentication bypass and needs **two** variables
set together, so it cannot be enabled by a single mistakenly-copied value. Neither
belongs in production under any circumstance.

## Review Queue Shape

Submission objects are stored under:

`submissions/YYYY-MM-DD/sub_<timestamp>_<random>.json`

Each object includes:

- id
- kind
- entity type and id, for metadata edits
- title and summary
- proposed fields
- source URLs
- map request metadata, for map submissions
- submitter email
- submitted timestamp
- user agent
- pending-review status

## Publish Workflow

The intended workflow is:

1. Contributor logs in.
2. Contributor submits a proposal.
3. Proposal is stored in KV/R2.
4. Admin reviews the proposal.
5. Admin applies accepted changes to repository data or map source storage.
6. Normal generators/build run.
7. Site deploys generated static Browse/map data.

This deliberately keeps production data changes in the existing repository/build pipeline.

## Current Limits

- Binary map-file upload is not direct-to-production.
- The implemented map-submission form accepts source URLs and metadata.
- A direct R2 upload flow can be added later with stricter file validation, upload quotas, malware scanning policy, and admin approval rules.
- Admin review UI is not implemented yet; queue inspection can initially happen via Cloudflare dashboard, Wrangler, or a small future admin page.
