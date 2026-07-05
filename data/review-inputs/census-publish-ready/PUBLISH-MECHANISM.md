# How a staged census/statistical record becomes live on civgraph

Investigated from `scripts/`, `package.json`, `scripts/build-browse-indexes.mjs`,
`scripts/graph/build-semantic-graph.mjs`, `scripts/apply-approved-publication-records.mjs`,
and `scripts/validate-approved-publication-path.mjs`. **No publish/build command was run** — this
documents the path only.

## 1. The live publication pipeline (as it exists today)

The site's generic "approved source" publication path is fully wired and idempotent:

1. **Gate file:** `data/database/approved-publication-sources.json`
   (schema `{ schemaVersion, generatedAt, generatedFrom, approvalPolicy, counts, sources: [...] }`).
   This is the single hand-off file that turns a staged record into a live one. It currently holds
   **6,679 Category-3 source-doc records** — zero census cubes.

2. **Emitter:** `scripts/apply-approved-publication-records.mjs`
   (`npm`-invokable as part of the Category-3 flow). Reads the Category-3 approval pack under
   `tasks/absence-integration-ready-2026-06-15/publication-approval-pack/…` plus the
   Dail alias pack, filters to explicitly **user-approved** action sets and hard-coded approved-ID
   allowlists, and writes `data/database/approved-publication-sources.json` and
   `data/elections/dail-approved-candidate-aliases.json` via `writeStableGeneratedJson`
   (deterministic → **idempotent**; re-running with the same inputs yields byte-identical output).

3. **Browse materialisation:** `node scripts/build-browse-indexes.mjs`
   reads the gate file (line 47) and merges `approvedPublicationSourcesData.sources` into the browse
   records (line 57), writing `data/browse/sources.json` and its detail shards.

4. **Graph materialisation:** `npm run build:graph` → `scripts/graph/build-semantic-graph.mjs`
   reads `data/browse/sources.json` + shards (lines 1589–1605) and builds the semantic graph.

5. **Convenience wrapper:** `npm run build:browse` =
   `build-feature-thumbnail-manifest` → `build-browse-indexes` → `build:graph`.

6. **Gate check:** `npm run check:approved-publication` →
   `scripts/validate-approved-publication-path.mjs` asserts every approved source is materialised
   into `data/browse/sources.json` (and validates the Dail alias counts). Part of `npm run check`.

So the generic command to publish an already-approved tranche is:

```
node scripts/apply-approved-publication-records.mjs   # regenerate the gate file from approved packs
npm run build:browse                                   # build-browse-indexes.mjs + build:graph
npm run check:approved-publication                     # validate materialisation
```

Reads: the approval packs + existing browse data. Writes: `data/database/approved-publication-sources.json`,
`data/browse/sources.json` (+ shards), the semantic-graph outputs. Idempotent end to end.

## 2. Where the census/statistical tranche stands in that pipeline

**The Category-1 census/statistical tranche is NOT wired into this path.** Concretely:

- `apply-approved-publication-records.mjs` has **zero** references to `category-1`,
  `census-statistical`, `statistical-cube`, or `fact-template`. It only emits Category-3 source
  docs + Dail aliases.
- The only builder that writes census data, `scripts/build-statistical-staging.mjs`, writes to
  `data/census/statistical-staging/` — a **staging** directory that **no live browse/graph builder
  reads** (grep for `statistical-staging` matches only that one script). It is not served.
- The Category-1 package under
  `tasks/absence-integration-ready-2026-06-15/category-1-census-statistical/` is referenced by no
  live builder (only by `scripts/review-already-on-site-remaining.mjs`).

Therefore, to publish this tranche, the missing mechanical step is a **census-cube emitter** that
maps approved fact-template records into `approved-publication-sources.json`-shaped entries (id,
slug, type, title, provider, keywords, `proposedBrowsePath`, `approval.stagingId`, attribution) —
i.e. the Category-1 analogue of `apply-approved-publication-records.mjs`. Once those entries land in
the gate file, steps 3–6 above publish them with no further code. (The clean tranche CSV +
`attribution.json` in this folder are exactly the inputs such an emitter needs.)

## 3. The single human gate that remains

Every staged census record carries `recommendedDefault.requiresUserApproval = true`, and the
package README states the **publication rule**: *"Do not publish arbitrary derived Census
combinations. Only expose a query if a source table or documented derived table contains all
requested dimensions."*

The remaining human decision is the **publication-approval sign-off**: a human must approve the
concept / geography / fact-template model for the tranche (analogous to the `approvalPolicy` string
and the hard-coded approved-ID allowlists baked into the Category-3 applier). Everything upstream of
that — carve-outs, confidence gating, attribution assignment — is deterministic and is completed by
the artifacts in this folder. Nothing in this task publishes to the live site.
