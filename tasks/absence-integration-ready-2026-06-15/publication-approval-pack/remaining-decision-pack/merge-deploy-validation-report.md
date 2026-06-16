# Merge And Deploy Validation

- Branch: `unknown`
- Upstream: `none`
- Head: `unknown`
- Working tree dirty: false
- Merge readiness: clean

## Validation Commands

- `node scripts/build-remaining-publication-decision-pack.mjs`
- `npm run check:approved-publication`
- `npm run check:external-sources`
- `npm run build:browse`
- `npm run build:test2:elections`
- `npm run check:test2`

## Deployment Dry Run

- Live publication: not performed
- R2 uploads: not performed
- Cloudflare Pages deployment: not performed
- Reason: This pass prepares review/approval outputs only.

## Blockers Before Merge

- 17 Dail candidate review groups remain withheld from automatic application.
- 31 Category 3 rows remain excluded from approved publication.
- Provider mirror audit scratch remains untracked and should be ignored, moved, or generalized before merging if a perfectly clean tree is required.
