# Item 09: Interaction Batching

## Goal

Reduce jank from noisy event paths by batching or throttling updates safely.

## Main drawbacks to watch

- laggy feel
- stale updates
- delayed state commits

## Atom sequence

### 09-A1: noisy interaction inventory

Change:
- identify highest-frequency handlers by path and purpose

Automated checks:
- report generated

Manual checks:
- none

Rollback:
- delete report

### 09-A2: instrumentation for one event family

Change:
- measure event count and handler cost for one path, such as hover or resize

Automated checks:
- instrumentation output recorded

Manual checks:
- none

Rollback:
- remove instrumentation

### 09-A3: requestAnimationFrame batching only

Change:
- batch visual updates into `requestAnimationFrame` without throttling semantics yet

Automated checks:
- stale-update prevention tests pass

Manual checks:
- user checks responsiveness on the target path

Rollback:
- restore previous event path

### 09-A4: throttle only if rAF batching is insufficient

Change:
- add bounded throttle/debounce only to the measured hot path

Automated checks:
- timing behavior tests pass

Manual checks:
- user confirms the path does not feel laggy

Rollback:
- remove throttle

### 09-A5: race-proof the path

Change:
- add latest-request-wins guards where async work can complete out of order

Automated checks:
- stale completion tests pass

Manual checks:
- user checks rapid repeated interaction

Rollback:
- revert race guard if it creates stuck state

## Accept when

- the target interaction path feels smoother or at least not worse
- stale or delayed updates are not observed

