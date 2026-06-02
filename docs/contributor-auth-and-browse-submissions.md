# Contributor Login And Browse Submissions

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

Optional contributor allowlist:

- `CIVGRAPH_CONTRIBUTORS`
- `CONTRIBUTOR_EMAILS`
- `BROWSE_CONTRIBUTORS`

Any one can be used. Values are comma, semicolon, or whitespace separated email addresses.

Optional admin allowlist:

- `CIVGRAPH_ADMINS`
- `CONTRIBUTOR_ADMINS`
- `BROWSE_ADMINS`

If no allowlist is configured, any Cloudflare Access-authenticated email is treated as allowed. That is acceptable only if the Access policy itself is restrictive.

Local development override:

- `CIVGRAPH_DEV_AUTH_EMAIL`
- `BROWSE_DEV_AUTH_EMAIL`

Use only in local/dev environments. Do not configure these in production.

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
