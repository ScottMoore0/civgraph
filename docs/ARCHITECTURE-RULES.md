# Civgraph architecture rules

> **Status: current, 11 November 2026 (owner-approved).** The rules every change follows, by any
> session or agent, in every folder. `npm run check:architecture` reports its checks now and
> fails CI on them from 19 November 2026 (`config/architecture.json` `enforceFrom`).

Each rule ends with what checks it:

- **a check** fails `npm run check` (so `check:fast`, `check:clean` and CI). C1 to C13 are the
  checks of `check:architecture` (`scripts/check/architecture.mjs`);
- **review** means the main session checks it at landing, against the LANDING.md section of R15.

A rule nothing checks decays (`docs/CIVGRAPH_PRINCIPLES.md`). If a rule is wrong, change it here,
with the owner, before working around it.

The rules protect the owner's acceptance tests: a new body type needs only config; a new source,
one plugin; a database swap, only the storage adapter; a restyle, only tokens; a new language,
only translation files.

## 1. Where code lives

**R1. Every tracked script belongs to a unit, and imports follow `config/boundaries.json`.**
Only `packages/storage` touches D1, R2 or `node:sqlite`; runtime code never imports `node:*`.
Served pages (`site/`) are not bundled: they import only `site/` files, and package code reaches
them through `packages/served.json` and its re-exporting shims.
A new folder gets a unit in the same commit.
- Checked by: `check:boundaries` (the import rules, and the engine rule `engines`: database-engine APIs only in `packages/storage`, tests apart, with a baseline that only shrinks); C1 (no unit path left empty by a move), C2 (no script in no unit).

**R2. Use the package; never copy it.** Shared logic lives in the package that owns it (pure
domain code in `packages/core`). A served page that cannot reach a package imports it through
the served mapping, or is bundled. An existing copy is marked `// copy-of: <path>`, has a parity
test, and is listed for removal.
- Checked by: C3 (a function named like a package export is a marked, tested copy), and review.

**R3. Split only at real seams.** One deployable site, no microservices. No new runtime or dev
dependency without the owner's approval.
- Checked by: review (`package.json` changes are listed at landing).

## 2. Data and contracts

**R4. Data comes through one door per layer.** Browser code reads records through its app's one
API client module (`/_api/*` or `/api/v1/*`), not ad hoc `fetch` calls in views. Functions use
`@civgraph/storage` and the named queries in `packages/api/src/queries/`. Scripts open the
records build with `recordPaths()` and the storage adapter.
- Checked by: `test:unit` (`named-queries.test`, the config-adoption ratchets), and review.

**R5. Every answer a page reads has a v1 contract, and clients use the generated types.** A new
`/_api` view gets a variant in `packages/api/src/v1/contracts/v1.js`, its fields listed, not
`object`. Browser JSDoc imports `ApiV1.*` from `packages/types`. v1 changes only by addition;
an incompatible change is v2.
- Checked by: C9 (every route, `view=` and parameter a page requests has a variant), `test:unit` (`api-v1-contracts.test` and its baseline).

**R6. Data over code.** Domain vocabularies come from `data/registries/` through the registry
views, never as literals: bodies and body types, election types and voting systems, parties
with their labels and colours, statuses, layer types. Origins, paths and the User-Agent come
from `@civgraph/config`; an app's defaults, limits and modes from its single `config.js`.
- Checked by: C4 (no literal holds two or more values of one registry vocabulary), C5 (no origin, User-Agent or records path spelled out), `test:unit` (the registry schemas and config-adoption ratchets).

## 3. State

**R7. No implicit state machines.** A value with three or more states, or more than one way in,
is a `defineMachine` table in its area's `state-machines` module, with guards at the call sites
and a test that walks every forbidden move. A two-state toggle is a `defineToggle`; a derived
kind or outcome is a JSDoc string union defined once. Status text in the DOM, a cluster of
booleans and a memoised promise are not state. Use the shared helper
(`packages/core/src/state-machine.mjs`, served as `/assets/ui/state/machine.js`; the map app's
`packages/map/src/state-helpers.mjs`).
- Checked by: C6 (string states, co-changing flags and promise-as-state on new or changed lines), C12 (every machine module is tested), `test:unit` (`ui-state-machines.test`).

**R8. Async work and views clean up after themselves.** Each run carries a run token or an
`AbortSignal`, and a stale answer changes nothing. A view gets a signal from its router and
releases what it started when the signal aborts: listeners on long-lived targets, maps, workers,
timers. One pure, tested function per view parses and serialises its URL state.
- Checked by: C7 (listeners on `document`, `window` or a view root pass `{ signal }` or are removed), and review.

## 4. Interface

**R9. Tokens and components.** Colours, spacing, type, radii and motion come from
`packages/ui/assets/tokens.css`. App stylesheets only lay out, with `cg-*` components. A reusable
element (tabs, legend, chart, notice) is a component with a gallery specimen, not an app class.
Data colours, such as party colours, are registry data, not tokens. So is any colour code draws
with on a canvas, in MapLibre paint, in an SVG it writes or exports, in a classic script's inline
style or in colour arithmetic (a contrast pick, a sanitiser's fallback): these cannot use CSS
`var()`, so the value itself is needed. Colour data held in a registry part
(`data/registries/colours.json`, the parties registry's `palettes` part) is allowed, and with the
token files it is the only place a colour literal may stand; code reads it through the registry's
browser slice (owner-approved 12 Nov 2026).
- Checked by: C8 (no colour literal in stylesheets outside the token files, or in served JS outside the registry palette parts: the generated slice modules `packages/registries/src/browser/build.mjs` lists as `PALETTE_SLICES`), `test:unit` (`design-system.test`, `registries-colours.test`).

**R10. Text and formats can be translated.** Interface text is keyed or patterned in
`site/assets/i18n/en.json`. Numbers, dates and percentages go through the shared formatter
(`packages/core/src/format.js`), which defers to `civgraphI18n`. No hard-coded locale, no
month-name arrays.
- Checked by: C10 (no locale literal or month-name array outside the formatter), and review (keys).

## 5. Quality

**R11. Types at every boundary, tightening only.** A new file joins the strict tsconfig of its
area, with its inputs and outputs typed in JSDoc. No `@ts-ignore` or `@ts-nocheck`; no new
explicit `any`.
- Checked by: `check:types:*` and their allowlist tests in `test:unit`; C11 (a per-file ratchet on `any` and suppressions).

**R12. Logic is pure and tested; the DOM only renders.** Derivations, SQL builders, projections
and URL parsing are pure modules with `test:unit` cases. Views only wire. Every view has a
browser-spec case.
- Checked by: review (a `test:browser:*` case for each new route).

**R13. The public surface is frozen.** URLs, ids, the v1 API and the download format change only
by addition; retiring one needs the owner. Nothing is published or pushed without the owner's
approval (CLAUDE.md).
- Checked by: `test:unit` (`api-v1-contracts.test` baseline), `check:routes-manifest`, `check:sitemap`, and review.

## 6. Exceptions

**R14. An exception is explicit, justified and listed.** An exception is an inline marker with
its rule and reason, on the line or the line above: `// arch-ok R6: month names are the
formatter's own table`. Known violations live in `config/architecture-baseline.json`, a count
per check per file that only shrinks. A prototype may defer R7 to R12 for one landing, if its
LANDING.md lists each deferral and its follow-up.
- Checked by: `check:architecture` (a malformed marker fails; every marker is counted and listed; a stale baseline entry fails), `test:unit` (`architecture-baseline.test`: the baseline never grows against main).

**R15. Every LANDING.md has an "Architecture rules" section.** The main session reads it before
landing.
- Checked by: review, with this checklist; C13 (this charter and its pointers in CLAUDE.md and AGENTS.md).

```markdown
## Architecture rules
- Rules touched: R.. (what changed and how it complies)
- Exceptions added: arch-ok markers (file:line, rule, reason); baseline entries added (should be none)
- check:architecture: new findings 0; baseline shrunk by .. (or unchanged)
- R2 no copies: yes/no
- R3 real seams, no new dependencies: yes/no
- R4 one data door: yes/no
- R8 cleanup beyond listeners (maps, workers, timers): yes/no
- R10 text keyed: yes/no
- R12 logic pure and tested: yes/no
- Prototype deferrals (R14): none, or each rule with its follow-up
```
