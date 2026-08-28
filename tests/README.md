# `tests/` — Playwright browser tests

> **Status: current. 111 passing, 5 skipped, 0 failing as of 2026-08-28.**

Everything here is a Playwright spec driving a real browser against a locally
served build. There are no unit tests; the things worth protecting in this
project are end-to-end behaviours.

## Running them

```bash
npx playwright test                       # everything
npx playwright test tests/browser/app.spec.js
```

The suite serves the site with `scripts/test-server.py`, **not**
`python -m http.server`. That matters: the stdlib server has a listen backlog of
5, and under the suite's parallel load it refused connections, producing
`ECONNREFUSED` failures that looked like application bugs. The replacement sets
`request_queue_size = 128`.

## What is covered

Catalogue loading and history, election panes and API parity, accessibility
(`accessible-names`, `contrast-audit`, `catalogue-load-a11y`), mobile layout,
the header brand across six phone widths, and specific past regressions such as
`eds-1931-1936.spec.js`.

## Writing one

Prefer waiting on a condition over waiting on a duration. A flake in the
wheel-zoom test was originally "fixed" by polling, when the real cause was drag
inertia still consuming the wheel event; the correct fix was to wait for the map
to stop moving. A test that sleeps is usually hiding the fact that nobody knows
what it is waiting for.

## Not deployed

`tests/` is in `.cfignore` and removed by `scripts/clean-for-pages.sh`.
