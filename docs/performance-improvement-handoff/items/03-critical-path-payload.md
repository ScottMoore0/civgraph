# Item 03: Critical-Path Payload Reduction

## Goal

Reduce first-load bytes and render-blocking cost.

## Primary repo targets

- `index.html`
- font delivery
- icon delivery
- critical CSS scope

## Main drawbacks to watch

- visual drift
- missing fonts/icons
- accidental blocking introduced by new delivery strategy

## Atom sequence

### 03-A1: first-load asset inventory

Change:
- record current head assets, sizes, and which are render-blocking

Automated checks:
- report generated

Manual checks:
- none

Rollback:
- delete report only

### 03-A2: font usage inventory

Change:
- record exactly which font families and weights are actually used

Automated checks:
- usage report generated

Manual checks:
- none

Rollback:
- delete report only

### 03-A3: self-host one font family additively

Change:
- self-host one used family while keeping fallback stack safe

Automated checks:
- build/package includes the hosted files
- startup asset inventory updated

Manual checks:
- typography looks acceptable
- no missing font flash beyond acceptable level

Rollback:
- restore previous font source

### 03-A4: subset one font family

Change:
- ship only the weights/styles actually needed

Automated checks:
- total font bytes fall

Manual checks:
- no obvious missing glyph/weight usage

Rollback:
- restore full font files

### 03-A5: replace or remove broad icon CSS if low-usage

Change:
- remove heavy icon library only if exact usage inventory proves low ROI

Automated checks:
- icon references still resolve
- CSS bytes fall

Manual checks:
- all icons still render correctly

Rollback:
- restore icon library

### 03-A6: extract minimal critical CSS only

Change:
- keep only above-the-fold shell styling blocking first paint

Automated checks:
- CSS split output valid

Manual checks:
- first render looks correct
- no severe flash or layout jump

Rollback:
- restore prior stylesheet loading

## Accept when

- first-load bytes and blocking assets fall
- visual quality remains acceptable

