# Item 02: Web Workers

## Goal

Move CPU-heavy pure processing off the main thread to improve responsiveness.

## Candidate repo targets

- geometry parsing/preprocessing
- chunk feature preprocessing
- election/table aggregation with pure inputs/outputs

## Main drawbacks to watch

- worker startup overhead
- message serialization cost
- increased code complexity

## Atom sequence

### 02-A1: worker candidate inventory

Change:
- list pure CPU-heavy functions with no DOM dependency

Automated checks:
- inventory report created

Manual checks:
- none

Rollback:
- delete report only

### 02-A2: isolate one heavy pure function

Change:
- extract one heavy computation into a standalone pure module without changing behavior

Automated checks:
- exact output parity vs old path
- benchmark harness runs

Manual checks:
- none

Rollback:
- revert extraction

### 02-A3: benchmark isolated function on main thread

Change:
- add baseline microbenchmark for the isolated function

Automated checks:
- benchmark output saved

Manual checks:
- none

Rollback:
- remove benchmark

### 02-A4: worker wrapper without default enablement

Change:
- create worker entry and protocol for the isolated function

Automated checks:
- worker build path resolves
- worker result parity holds
- fallback path still works

Manual checks:
- none

Rollback:
- remove worker wrapper

### 02-A5: config-flagged worker enablement for one code path

Change:
- enable worker for one narrow target only

Automated checks:
- result parity holds
- benchmark comparison recorded

Manual checks:
- user exercises the affected heavy path and judges smoothness

Rollback:
- disable worker by config

### 02-A6: transfer optimization if needed

Change:
- introduce transferable objects only if message-copy cost is measurable

Automated checks:
- parity still holds
- benchmark improves or stays within noise

Manual checks:
- affected path remains stable

Rollback:
- revert transfer optimization only

### 02-A7: second worker candidate only after first is accepted

Change:
- repeat the same sequence for the next pure heavy path

Automated checks:
- same as above

Manual checks:
- same as above

Rollback:
- disable second worker target only

## Accept when

- objective heavy-path cost falls or responsiveness improves
- output parity remains exact
- fallback path remains available

