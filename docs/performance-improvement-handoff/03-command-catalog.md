# Command Catalog

This file lists useful non-browser verification commands and what they are for.

These are examples, not a claim that every command must be run for every atom.

## Build and syntax

```powershell
npm run build
```

Use for:
- bundle validity
- chunk generation
- split-point verification

```powershell
node --check js\\app.js
node --check js\\map-controller.js
node --check js\\ui-controller.js
node --check js\\election-controller.js
```

Use for:
- quick syntax validation of touched startup-critical modules

## File and text inventory

```powershell
rg -n "import\\(|from '|from \"" js scripts
```

Use for:
- import graph exploration
- dynamic-import candidates

```powershell
rg -n "useLOD|chunked|chunkLoadConcurrency" data\\database\\maps.json
```

Use for:
- map metadata audit

```powershell
rg -n "_bundle|_aggregates" js data scripts
```

Use for:
- additive artifact audit

## Asset inventory

```powershell
Get-ChildItem assets -Recurse | Select-Object FullName,Length
```

Use for:
- image/font/static asset size inventory

```powershell
Get-ChildItem build -Recurse | Select-Object FullName,Length
```

Use for:
- post-build output size inventory

## JSON validity

```powershell
Get-Content data\\database\\maps.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s);console.log('maps.json ok');})"
```

Use for:
- fast JSON parse validation after metadata edits

## Suggested future scripts to add per item

- `node scripts/report-bundle-sizes.mjs`
- `node scripts/report-startup-imports.mjs`
- `node scripts/benchmark-<target>.mjs`
- `node scripts/validate-<artifact>.mjs`
- `node scripts/report-image-sizes.mjs`
- `node scripts/report-dependency-usage.mjs`

Each such script should:
- produce plain-text or JSON output
- be deterministic
- target one concern only
- be suitable for recording in `tasks/todo.md`

