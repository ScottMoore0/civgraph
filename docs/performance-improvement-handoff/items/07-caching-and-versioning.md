# Item 07: Caching And Versioning

## Goal

Improve repeat-load performance while keeping cache invalidation safe and obvious.

## Main drawbacks to watch

- stale assets
- service-worker confusion
- old clients serving mixed versions

## Atom sequence

### 07-A1: asset mutability inventory

Change:
- classify assets as immutable, versioned, or frequently changing

Automated checks:
- inventory report created

Manual checks:
- none

Rollback:
- delete report

### 07-A2: fingerprint coverage report

Change:
- identify which immutable assets already have stable versioning and which do not

Automated checks:
- report generated

Manual checks:
- none

Rollback:
- delete report

### 07-A3: version immutable assets only

Change:
- add or tighten fingerprinting/versioning for immutable assets

Automated checks:
- versioned path mapping is deterministic

Manual checks:
- user refreshes and sees correct asset set

Rollback:
- revert asset version mapping

### 07-A4: conservative cache policy for immutable assets

Change:
- set long-lived cache policy only for assets proven immutable

Automated checks:
- policy generation or config validation passes

Manual checks:
- normal reload and hard reload both behave correctly

Rollback:
- revert cache policy

### 07-A5: stale-while-revalidate for low-risk JSON only

Change:
- apply SWR only to low-risk resources after explicit classification

Automated checks:
- resource class allowlist test passes

Manual checks:
- user checks reload behavior on the affected views

Rollback:
- remove SWR for that class

### 07-A6: service-worker cleanup/update hardening only if needed

Change:
- adjust service-worker behavior only if measured stale issues remain

Automated checks:
- registration/version logic tests pass

Manual checks:
- user tests update/reload path

Rollback:
- restore previous service-worker logic

## Accept when

- repeat loads improve
- versioning is explicit
- no stale/mixed-version issue is observed in manual testing

