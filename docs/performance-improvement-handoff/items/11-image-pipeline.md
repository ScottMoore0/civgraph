# Item 11: Image Pipeline

## Goal

Reduce image transfer and decode cost without harming visible quality.

## Main drawbacks to watch

- visible quality loss
- missing fallbacks
- unexpected layout shifts

## Atom sequence

### 11-A1: image inventory

Change:
- list thumbnails and other shipped images by format, size, and usage surface

Automated checks:
- report generated

Manual checks:
- none

Rollback:
- delete report

### 11-A2: choose one image surface only

Change:
- select one thumbnail surface for the pilot

Automated checks:
- target scope documented

Manual checks:
- none

Rollback:
- none

### 11-A3: generate modern format additively

Change:
- emit modern image versions while keeping current files as fallback

Automated checks:
- generated files exist
- dimensions match expectation
- bytes fall for the pilot assets

Manual checks:
- quality remains acceptable

Rollback:
- stop using generated format

### 11-A4: wire responsive delivery for one surface

Change:
- use `srcset`/responsive delivery for the pilot surface only

Automated checks:
- generated markup resolves to expected files

Manual checks:
- no broken images
- no layout shift

Rollback:
- restore previous image markup

### 11-A5: prioritize only truly above-the-fold images

Change:
- add higher priority only where justified

Automated checks:
- asset priority rules stay narrow

Manual checks:
- first view remains correct

Rollback:
- remove priority hint

## Accept when

- pilot image bytes fall
- no unacceptable quality loss or layout shift is observed

