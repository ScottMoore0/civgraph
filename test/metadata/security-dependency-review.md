# /test Security and Dependency Review

This note records the non-data security checks for the MapLibre rewrite.

## Dependency Policy

Run `npm audit` during release review, but do not apply `npm audit fix`
automatically. The project includes native and geospatial dependencies where
transitive upgrades can change build behaviour. Record the decision in the PR
if a vulnerability is accepted temporarily.

Current audit state on 2026-05-28 after applying the
`protocol-buffers-schema` override:

- `xlsx` has high-severity advisories and no npm-audit fix available from the
  current registry metadata. Treat this as accepted only if spreadsheet import
  paths remain trusted/offline; otherwise replace or isolate SheetJS usage.
- `protocol-buffers-schema` was lifted to the fixed range through
  `package.json` overrides; the moderate transitive advisory is no longer
  present in `npm audit`.

## Runtime Guardrails

- `/test/index.html` must not add third-party scripts.
- External links opened in a new tab must use `noopener noreferrer`.
- Clipboard writes must go through the guarded `copyText` helper.
- Runtime telemetry must sanitize fields and send only to same-origin
  Civgraph endpoints.
- Diagnostics must avoid logging tokens, cookies, authorization headers, or
  full CDN signed URLs.

## Automated Evidence

Run:

```bash
npm run check:test
```

This includes `scripts/validate-test-security.mjs`, which writes
`test/metadata/security-dependency-report.json`.
