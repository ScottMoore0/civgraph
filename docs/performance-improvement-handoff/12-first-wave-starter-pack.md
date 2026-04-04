# First Wave Starter Pack

This file is for the later agent that wants to begin immediately with the safest, highest-confidence work.

## First recommended wave

Do these atoms first, in order:

1. `01-A1` startup import inventory only
2. `01-A2` startup bundle size report
3. `03-A1` first-load asset inventory
4. `03-A2` font usage inventory
5. `12-A1` capture current baselines
6. `12-A2` choose a minimal budget set

## Why this wave first

- no user-visible behavior needs to change yet
- it creates the evidence needed for later tradeoff decisions
- it reduces the chance of a bad split or unnecessary asset work
- it creates the first non-browser automation layer without yet needing browser automation

## Suggested outputs from the first wave

- startup import report
- build bundle size report
- first-load asset report
- font usage report
- initial baseline report
- draft budget config or threshold note

## Files likely touched in the first wave

- `scripts/bundle.mjs`
- `package.json`
- `scripts/` for new report scripts
- possibly no product runtime files at all for the earliest atoms

## Definition of success for the first wave

- there is now a repeatable non-browser baseline for startup and asset cost
- later item decisions can be made from evidence rather than guesswork
- no user-facing functionality has changed yet

## Strong advice

- do not start workerization, virtualization, or caching before the first wave exists
- do not start hard performance-budget enforcement before at least one reporting script exists

