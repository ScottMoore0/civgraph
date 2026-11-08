# Landing notes: nia-types (packages/types, noImplicitAny prep, 8 Nov 2026)

Branch `nia-types`, worktree `C:\Users\scomo\civgraph-types`, on main 2a059f6aa2. One commit;
nothing imports the new package, so the site is unchanged. Not pushed.

## What it adds

- `packages/types/` (`@civgraph/types`, types only): `.d.ts` declarations of the shared data
  shapes for JSDoc, imported by relative path
  (`/** @typedef {import('../../packages/types/index.js').Council} Council */`).
  - `src/generate.mjs` (dependency-free, no devDependency added) writes `generated/`:
    - `facts/*.d.ts` from `data/schemas/*.schema.json` and `registries/*.d.ts` from
      `registries/schemas/*.schema.json`: one file per schema, its root type (`OfficesDocument`,
      `CouncilsRegistry`, ...) and one export per `$defs` entry; `$ref`s across files become
      imports (offices-registry -> facts/offices, facts/* -> facts/citation). Supported: type
      (and type arrays), properties/required, items (and tuples), enum, const, $ref,
      oneOf/anyOf/allOf (constraint-only branches and if/then/else are dropped), and
      additionalProperties (absent -> `[key: string]: unknown`, false -> closed).
    - `records-db.d.ts` from `packages/schema/src/schema.mjs` TABLES: one `<Table>Row`
      interface per table (TEXT -> string, INTEGER/REAL -> number, nullable -> `| null`), the
      `Tables` map and `TableName`.
    - `api-v1.d.ts` from `functions/_lib/api/contracts/v1.js` CONTRACTS: one
      `<Route><Variant>Answer` per route and variant, `<Route>ErrorAnswer`, the `V1Routes`
      map and `V1Answer<R, V>`.
  - `hand/core.d.ts`, HAND-WRITTEN (marked in the file header and `@handwritten` on each type):
    `Election`, `Contest`, `Candidacy` (+ `Candidate`), `Count`, `Person`, `MapEntry`,
    `LayerEntry`, `CatalogueSeries`, `CatalogueClass`, `CatalogueCategory`, `MapCatalogue`,
    `ApiError`, `BrowsePage`, `RecordAnswer`, `DetailAnswer`, `Json`, `IsoDate`, `SourceLink`,
    `CoreRows`, `CoreRegistries`; and aliases of generated types: `Party` (parties $defs.entity),
    `Council` (councils $defs.council), `Office`, `Institution`, `Tenure` (offices/tenures
    documents), `ElectionManifestEntry`, `ContestAnswer`. Election/Contest/Candidacy/Count are
    written from what packages/loader/src/ingest-elections.mjs reads of a bundle;
    MapEntry/LayerEntry/catalogue from the key census of data/database/maps.json and
    render/metadata/maps-test.json (fields in every entry are required).
  - `index.d.ts`: the core shapes flat, each generated file as a namespace (`RecordsDb`, `ApiV1`,
    `CouncilsRegistryTypes`, `OfficesFacts`, ...), and the root documents flat.
  - `tsconfig.json`: strict + noImplicitAny, skipLibCheck off, for the declarations alone.
- `npm run build:types` regenerates.
- `tests/unit/types-package.test.mjs`: generated/ is up to date with its sources
  (regenerate-and-diff, CRLF-tolerant); the declarations compile under that tsconfig; every core
  name is exported; every schema the types come from is one a check validates real data against;
  the real registries (registryErrors) and facts files (facts-model schemaErrors, ajv) validate.
  The /api/v1 contracts and the records tables are held against real answers and the migrations
  by their own tests (api-v1-contracts, records/schema); the types follow by regeneration.
- `packages/README.md` row; `package-lock.json` gets the workspace's two entries by hand (the
  same shape as the other packages; no npm install was run).

## Checks run (worktree, node_modules junctioned from main)

- `test:unit`: pass (0 failures).
- `tsc -p packages/types/tsconfig.json`: clean.
- `check:fast`: lint, every `check:types:*` and test:unit ok; 13 checks fail only because the
  fresh worktree has no gitignored build outputs (tmp/records/*, app/build, data/browse/maps.json,
  build/main.css): approved-publication, asset-refs, notices, ni-register-interests,
  site-figures, test:elections-unit, test2, peatland-geoportal, status, provenance,
  election-source-enrichments, public-map-count, doc-paths. None touches packages/types.

## Landing

Merge or fast-forward onto main; no rebuild needed (no runtime file changed). When a schema,
the v1 contracts or TABLES change, run `npm run build:types` and commit generated/ with the
change (the unit test says so when it is stale).

## noImplicitAny inventory (read-only)

`D:\civgraph-intake\noimplicitany-2026-11-08\`: `worklist-<area>.md` per config, `PLAN.md`
(ten streams, landing order), `summary.json`, `nia-inventory.mjs` (the measuring script).
Findings in each area's own files: records 769, functions 641, pipeline 236, intake 0, mapapp
640, ui 973; unowned (no config includes them) packages/core/*.mjs 177, registries/*.mjs 196,
src/catalogue/search.js 43. About 3,675 distinct.
