# Civgraph Semantic Graph Implementation Plan

> **Status: partially executed — plan dated 2026-06-27. Banner corrected 2026-08-16.**
> The graph is built and shipped (`scripts/graph/build-semantic-graph.mjs`,
> `data/graph/`).
>
> This banner previously said `npm run check:graph` **fails** on `main` with
> 17,820 orphaned file URLs. That is no longer true: as of 2026-08-16 it passes,
> reporting 193,134 entities, 1,316,442 statements, 5,064 register records and
> 51,788 declared-interest statements. The regeneration it was waiting on has
> landed.
>
> Note also that `data/graph` is no longer tracked in git (2026-08-12). It is
> build output, served from R2 via `functions/data/graph/[[path]].js`, and
> regenerated with `npm run build:graph`. A clean checkout has no graph, and
> `check:graph` skips loudly rather than failing.
>
> Treat this plan as partly done, not as a fresh starting point.

Date: 2026-06-27

Status: execution-grade proposal

Owner: Civgraph

Scope: implement a Wikidata-style statement layer that connects Civgraph persons, elected bodies, elections, parties, map features, map layers, source records, register interests, and downloadable/source files while preserving the existing domain files and static website architecture.

## 1. Executive Summary

Civgraph should implement a semantic graph as a generated connective layer, not as a replacement for the existing map, election, source, and file stores.

The recommended model is:

```text
Civgraph = existing domain data + generated semantic claim graph + materialized Browse views
```

The graph should be Wikidata-like in the parts that matter:

- entities/items with stable IDs, labels, descriptions, aliases, and external IDs
- properties with controlled definitions, datatypes, domains, ranges, display groups, and validation rules
- statements/claims from subject to value
- qualifiers on statements for dates, bodies, constituencies, roles, amounts, status, extraction metadata, etc.
- references on statements tying facts back to source records, rows, documents, pages, URLs, checksums, and extraction runs
- ranks and confidence levels for current/preferred/deprecated/conflicting facts

The graph should not be a pure Wikibase clone. Civgraph has large spatial files, election result bundles, PDFs, PMTiles/MBTiles, GeoJSON, FlatGeobuf, CSV/XLSX, and other assets. Those should remain first-class files and domain records. The semantic graph should link to them, explain them, and expose their relationships.

The first production slice should be deliberately narrow:

1. Define the graph schema, property registry, entity registry, sharding rules, and validators.
2. Generate graph entities/statements for persons, parties, elections, constituencies/features, sources, and NI register interests.
3. Add compact Wikidata-style statement panels to Browse detail pages.
4. Preserve all current Browse indexes and routes during the transition.
5. Expand only after validators prove determinism, source coverage, no orphan references, and file-size safety.

The plan below is designed to minimize migration risk, avoid a rewrite, and let each phase ship independently.

## 2. Primary Decision

### 2.1 Adopt A Civgraph-Native Statement Graph

Use a Civgraph-native JSON model inspired by Wikidata/Wikibase, with explicit compatibility paths for RDF/JSON-LD/PROV export later.

Do not adopt Wikibase itself as the primary repository or runtime dependency in the first implementation.

Rationale:

- The current site is static and build-driven. A generated graph can fit directly into the existing `npm run build` pipeline.
- Wikibase is designed as a collaborative database/application platform. Civgraph currently needs deterministic generated public data, static assets, and controlled build-time validation.
- Static JSON shards are easier to host, diff, validate, cache, and deploy on the existing site.
- A native model can avoid Wikibase-specific complexity while retaining the useful conceptual model: entity, property, statement, qualifier, reference, rank.
- Export to Wikidata-compatible or RDF-compatible formats can be added once Civgraph's internal model is stable.

### 2.2 Keep Existing Domain Stores

The graph must not break down or replace large domain assets.

Keep these as existing/static domain data:

- map metadata in `data/database/maps.json`
- Browse indexes and detail shards under `data/browse/`
- spatial indexes and feature samples
- PMTiles/MBTiles/vector tiles
- GeoJSON, FlatGeobuf, CSV, XLSX, PDF, HTML, and raw source documents
- election bundles and `test2` election metadata
- NI register extraction shards and source documents
- source and provenance indexes

The graph should point to these assets through entities and references.

Example:

```text
Upper Bann constituency entity
  has layer-feature instance -> feature in Westminster 2023 layer
  represented by -> Carla Lockhart
  used in election -> 2024 UK general election
  source -> boundary source record
  geometry asset -> existing PMTiles/GeoJSON/static map layer
```

Do not express every polygon coordinate as statements.

## 3. External Reference Model

The implementation should borrow selectively from the following standards and systems:

- Wikidata statements: entity claims with properties and values, plus qualifiers, references, and ranks.
  - Reference: https://www.wikidata.org/wiki/Help:Statements
- Wikibase data model: item/property/value statement model.
  - Reference: https://www.mediawiki.org/wiki/Wikibase/DataModel
- W3C PROV-O: provenance vocabulary for entities, activities, agents, derivation, attribution, primary sources, and qualified relations.
  - Reference: https://www.w3.org/TR/prov-o/
- JSON-LD 1.1: optional future export/context format for web-linked data.
  - Reference: https://www.w3.org/TR/json-ld11/
- RDF concepts: optional future RDF export, not the initial runtime model.
  - Reference: https://www.w3.org/TR/rdf12-concepts/

Use these as compatibility targets, not as mandatory runtime dependencies.

## 4. Non-Goals

The first implementation must not:

- replace the existing static Browse indexes
- replace the main map runtime
- replace election result bundles
- rewrite all generated data pipelines at once
- introduce a server-side graph database into production
- require Wikibase/MediaWiki deployment
- require SPARQL for the website to function
- store huge geometries or tile payloads as claim values
- make source PDFs/CSVs/GeoJSON/PMTiles less accessible
- generate public claims without source references unless a property is explicitly allowed to be unsourced system metadata
- infer identities across persons/features without validation guardrails
- block the current site while the graph layer is incomplete

## 5. Success Criteria

The implementation is successful when:

1. The graph build is deterministic.
2. Every statement has a stable ID.
3. Every statement has a valid subject, property, value, rank, and source policy.
4. Every entity referenced by a statement exists or is explicitly external.
5. Every reference points to an existing source record, source row, file, URL, or extraction artifact.
6. Browse can render a compact statement page for at least persons, register interests, elections, map layers, features, parties, and sources.
7. Existing Browse routes still work.
8. Existing map/election/source downloads still work.
9. The graph files stay under repository and Pages file-size budgets.
10. The graph can be rebuilt from tracked source data without manual edits.
11. Validators fail on orphan entities, orphan properties, orphan references, duplicate canonical IDs, unbounded shard sizes, and unsupported datatypes.
12. A user can answer cross-domain questions from Browse, such as:
    - Which elections did this person stand in?
    - Which constituencies did this person represent?
    - Which map layers depict this constituency?
    - Which source documents support this register interest?
    - Which parties/labels are associated with this person over time?
    - Which features belong to this administrative/electoral geography?
    - Which source files are downloadable for this map layer?

## 6. Current System Summary

The current Browse system is generated by `scripts/build-browse-indexes.mjs`.

It reads:

- `data/database/maps.json`
- `data/database/data-entries.json`
- `data/database/books.json`
- source indexes under `data/database/`
- `data/database/ni-register-sources.json`
- `data/database/ni-register-interests.json`
- `data/database/spatial-index.json`
- party IDs
- `render/metadata/elections-test2.json`

It writes:

- `data/browse/index.json`
- `data/browse/maps.json`
- `data/browse/elections.json`
- `data/browse/features.json`
- `data/browse/parties.json`
- `data/browse/persons.json`
- `data/browse/register-interests.json`
- `data/browse/sources.json`
- detail shards under `data/browse/details/`

The current front-end Browse renderer is mostly in `browse/browse.js` and `browse/browse.css`.

Current Browse groups:

- maps
- elections
- features
- parties / labels
- persons
- register interests
- books / tables / sources

The current detail pages are record-centric. They render overview metadata, related tables, links, and technical data. This is useful for catalogue records but weak for connected domain knowledge.

The semantic graph should be generated alongside these outputs and gradually feed richer detail panels.

## 7. Target Architecture

### 7.1 Build-Time Architecture

```text
Raw/static domain files
  -> existing domain builders
  -> existing Browse indexes

Raw/static domain files
  -> graph extractors
  -> graph entity/statement/reference shards
  -> graph validators
  -> graph-aware Browse detail indexes
```

### 7.2 Runtime Architecture

```text
Browser
  -> data/browse/index.json
  -> existing Browse group index
  -> existing detail record
  -> optional data/graph/entity-index shard
  -> optional data/graph/entity-statement shard
  -> compact statement panels
```

No runtime server is required.

### 7.3 File Layout

Add these generated/public files:

```text
data/graph/
  manifest.json
  schema.json
  properties.json
  entity-types.json
  entity-shards/
    entities-000.json
    entities-001.json
  statement-shards/
    statements-000.json
    statements-001.json
  reference-shards/
    references-000.json
  indexes/
    entity-slugs.json
    entity-types.json
    external-ids.json
    statements-by-subject-000.json
    statements-by-value-000.json
    statements-by-source-000.json
    browse-record-to-entity.json
  quality/
    validation-summary.json
    orphan-report.json
    duplicate-report.json
    source-coverage-report.json
```

Add these scripts:

```text
scripts/graph/build-semantic-graph.mjs
scripts/graph/validate-semantic-graph.mjs
scripts/graph/lib/ids.mjs
scripts/graph/lib/schema.mjs
scripts/graph/lib/statement-builder.mjs
scripts/graph/lib/source-refs.mjs
scripts/graph/extractors/maps.mjs
scripts/graph/extractors/features.mjs
scripts/graph/extractors/elections.mjs
scripts/graph/extractors/persons.mjs
scripts/graph/extractors/parties.mjs
scripts/graph/extractors/register-interests.mjs
scripts/graph/extractors/sources.mjs
scripts/graph/export-jsonld.mjs
scripts/graph/export-rdf-ndjson.mjs
```

Add or update package scripts:

```json
{
  "build:graph": "node scripts/graph/build-semantic-graph.mjs",
  "check:graph": "node scripts/graph/validate-semantic-graph.mjs",
  "build:browse": "node scripts/build-feature-thumbnail-manifest.mjs && node scripts/build-browse-indexes.mjs && npm run build:graph",
  "check": "... && npm run check:graph"
}
```

Initially, keep graph build after existing Browse build so it can reuse generated Browse data if useful. Later, graph can become an input to Browse once stable.

## 8. Core Data Model

### 8.1 Entity

An entity is a thing Civgraph can describe and link to.

Required fields:

```json
{
  "id": "cg:person:carla-lockhart",
  "schemaVersion": 1,
  "type": "person",
  "label": "Carla Lockhart",
  "description": "Northern Ireland politician",
  "aliases": ["Carla Rebecca Lockhart"],
  "slug": "carla-lockhart",
  "browseUrl": "/browse/entities/carla-lockhart",
  "sourceRecordIds": ["person:..."],
  "sameAs": [
    {
      "scheme": "wikidata",
      "id": "Q24052782",
      "url": "https://www.wikidata.org/wiki/Q24052782",
      "matchStatus": "confirmed"
    }
  ],
  "generatedFrom": [
    {
      "dataset": "elections",
      "recordId": "..."
    }
  ]
}
```

Entity types:

```text
person
party
political-label
elected-body
office
constituency
administrative-area
map-layer
map-feature
feature-instance
election
contest
election-result
register
register-interest-record
register-interest-entry
source
source-document
source-file
dataset
provider
organization
place
time-period
concept
```

### 8.2 Property

A property defines an allowed relationship or data field.

Required fields:

```json
{
  "id": "cgprop:position-held",
  "label": "position held",
  "description": "Public office or representative position held by a person.",
  "datatype": "entity",
  "allowedSubjectTypes": ["person"],
  "allowedValueTypes": ["office"],
  "displayGroup": "Public offices",
  "displayOrder": 100,
  "sourcePolicy": "required",
  "qualifierPolicy": {
    "recommended": [
      "cgprop:elected-body",
      "cgprop:constituency",
      "cgprop:start-date",
      "cgprop:end-date",
      "cgprop:election"
    ]
  }
}
```

Property datatypes:

```text
entity
string
monolingual-text
date
year
integer
decimal
quantity
boolean
url
external-id
geo-coordinate
bbox
time-interval
file-ref
json-ref
```

### 8.3 Statement

A statement is a claim about an entity.

Required fields:

```json
{
  "id": "cgstmt:7ec36591e6d6",
  "schemaVersion": 1,
  "subjectId": "cg:person:carla-lockhart",
  "propertyId": "cgprop:position-held",
  "value": {
    "type": "entity",
    "entityId": "cg:office:mp"
  },
  "qualifiers": [
    {
      "propertyId": "cgprop:elected-body",
      "value": {
        "type": "entity",
        "entityId": "cg:body:house-of-commons"
      }
    },
    {
      "propertyId": "cgprop:constituency",
      "value": {
        "type": "entity",
        "entityId": "cg:constituency:upper-bann:westminster"
      }
    },
    {
      "propertyId": "cgprop:start-date",
      "value": {
        "type": "date",
        "date": "2019-12-12",
        "precision": "day"
      }
    }
  ],
  "references": [
    {
      "referenceId": "cgref:...",
      "sourceId": "cg:source:uk-general-election-2019-results",
      "sourceUrl": "...",
      "retrievedAt": "2026-06-27",
      "sourceRecordId": "..."
    }
  ],
  "rank": "normal",
  "confidence": "high",
  "provenance": {
    "generatedBy": "scripts/graph/extractors/elections.mjs",
    "generatedAt": "2026-06-27T00:00:00.000Z",
    "inputRecords": [
      {
        "dataset": "test2-election-detail",
        "id": "..."
      }
    ]
  }
}
```

### 8.4 Reference

A reference is source evidence for a statement.

References should support both concise UI display and audit-level traceability.

```json
{
  "id": "cgref:23a6a3489799",
  "sourceId": "cg:source:ni-register-mp-csv",
  "sourceTitle": "Northern Ireland MPs extracted from supplied Westminster register CSV",
  "sourceUrl": null,
  "sourceKind": "ni-mp-csv",
  "sourceRecordId": "ni-register:mp:csv",
  "sourceRowId": "ni-register-row:...",
  "sourcePage": null,
  "sourceQuote": "Employment and earnings - Ongoing paid employment...",
  "extractionMethod": "filtered-westminster-csv",
  "extractionConfidence": "high",
  "checksum": null
}
```

For large text quotes, keep full text in existing detail shards and store only snippets or row IDs in graph references.

### 8.5 Qualifier

Qualifiers provide context for a statement.

Examples:

```text
point in time
start date
end date
elected body
constituency
party
election
contest
source document
register date
published date
registration date
amount
currency
payment frequency
hours worked
location
office
term
jurisdiction
geometry layer
feature ID
```

### 8.6 Rank

Use ranks sparingly.

Allowed ranks:

```text
preferred
normal
deprecated
```

Rules:

- Use `preferred` for current or best display value when multiple statements are valid.
- Use `normal` for historically valid statements.
- Use `deprecated` only when a statement is retained for audit but should not be used as a current fact.
- Do not use rank as a substitute for confidence.

### 8.7 Confidence

Allowed confidence values:

```text
high
medium
low
review
rejected
```

Rules:

- `high`: direct structured source or validated exact match.
- `medium`: parsed from semi-structured text or normalized from inconsistent source.
- `low`: weak extraction retained for review-only or internal use.
- `review`: not public by default unless explicitly allowed.
- `rejected`: retained only in internal audit reports.

## 9. ID Strategy

### 9.1 Entity IDs

Entity IDs must be stable, readable where possible, and collision-resistant.

Recommended patterns:

```text
cg:person:<canonical-person-slug>
cg:party:<canonical-party-slug>
cg:label:<canonical-label-slug>
cg:body:<body-slug>
cg:office:<office-slug>
cg:election:<body-slug>:<date>
cg:contest:<election-key>:<contest-slug>
cg:constituency:<name-slug>:<system-slug>
cg:feature:<map-id>:<feature-stable-key>
cg:layer:<map-id>
cg:source:<source-id>
cg:file:<source-id>:<file-hash-or-file-key>
cg:register-record:<member-slug>:<body-slug>:<date-or-undated>
cg:register-interest:<record-id>:<category-slug>:<hash>
```

### 9.2 Statement IDs

Statement IDs should be deterministic hashes.

Hash input:

```text
subjectId
propertyId
normalized value
identity qualifiers
source row IDs when the statement only exists at source-row granularity
```

Identity qualifiers are qualifiers that distinguish one statement from another, such as:

- start date
- end date
- point in time
- election
- constituency
- register date
- source row ID for extracted statement rows

Do not include generatedAt timestamps in statement ID hashes.

### 9.3 Slug Strategy

Every public entity should have a route-safe slug.

Slug rules:

- lowercase ASCII
- punctuation normalized to hyphens
- stable suffix only when needed for collisions
- collision report generated during validation

Examples:

```text
carla-lockhart
upper-bann-westminster
house-of-commons
ni-assembly
uk-general-election-2024
westminster-constituencies-2023
```

## 10. Property Registry

Create `data/graph/properties.json` from a source registry file, preferably:

```text
data/database/graph-properties.json
```

The registry should be manually curated, not inferred ad hoc in every extractor.

Initial property groups:

### 10.1 Identity

```text
instance of
subclass of
same as
external ID
official name
short name
alias
description
```

### 10.2 Political Persons

```text
position held
member of political party
stood in election
elected in election
candidate in contest
represented constituency
served in elected body
register of interests record
```

### 10.3 Elections

```text
election type
elected body
contest
constituency
candidate
party
votes
seats
elected candidate
previous election
next election
uses boundary layer
```

### 10.4 Geography And Maps

```text
depicts
has feature
feature in layer
geometry asset
bounding box
valid from
valid to
jurisdiction
part of
overlaps
replaces
superseded by
source map
```

### 10.5 Register Interests

```text
register record
interest category
declared interest
registration date
published date
amount
currency
payment frequency
hours worked
property location
property use
nil interest
source row count
```

### 10.6 Sources And Files

```text
source document
download URL
provider
publisher
licence
format
checksum
file size
retrieved at
derived from
primary source
supports statement
```

### 10.7 Technical

```text
generated by
generated at
input dataset
source row ID
extraction method
extraction confidence
validation status
```

## 11. Entity Type Registry

Create:

```text
data/database/graph-entity-types.json
```

Each type should define:

- ID
- label
- description
- icon/display class
- allowed primary properties
- allowed detail page panels
- route policy
- source policy

Example:

```json
{
  "id": "person",
  "label": "Person",
  "description": "A person observed in Civgraph election, register, office, or source data.",
  "routePrefix": "entities",
  "primaryProperties": [
    "cgprop:position-held",
    "cgprop:stood-in-election",
    "cgprop:member-of-political-party",
    "cgprop:register-record"
  ],
  "displayGroups": [
    "Identity",
    "Public offices",
    "Elections",
    "Register interests",
    "Sources"
  ]
}
```

## 12. Source And Provenance Model

### 12.1 Provenance Layers

Civgraph should distinguish:

1. Source asset
   - PDF, CSV, XLSX, HTML page, API response, GeoJSON, PMTiles, etc.
2. Source record
   - Browse/source metadata record describing that asset or provider source.
3. Source row/extraction row
   - extracted row, PDF page parse, CSV row, election result row, feature row.
4. Statement reference
   - evidence link from claim to source record/row/asset.
5. Build activity
   - generated by a script at a time from known inputs.

This maps well to W3C PROV-O concepts:

- source files and generated graph records are `Entity`-like things
- extractor scripts/build runs are `Activity`-like things
- providers, maintainers, and Civgraph are `Agent`-like things
- references can express primary source, derivation, attribution, and generation relationships

### 12.2 Public Reference Requirements

Public statements should have references except for:

- system-generated labels
- derived slugs
- technical routing fields
- explicitly unsourced editorial descriptions

For every public non-technical statement, validator must enforce:

```text
statement.references.length > 0
```

or property must declare:

```json
{ "sourcePolicy": "optional-system" }
```

### 12.3 Reference Display

Browse should show references compactly:

```text
Source: Northern Ireland MPs extracted from supplied Westminster register CSV
Row: ni-register-row:...
Extraction: filtered-westminster-csv, high confidence
```

Expanded reference panel:

```text
Source title
Provider
URL/download
Page/row
Quote/snippet
Checksum/file metadata
Generated by script
```

## 13. Domain Modeling

### 13.1 Persons

Current source:

- `buildPersons(electionDetails)` in `scripts/build-browse-indexes.mjs`
- election result detail data
- party IDs
- register-interest member names and IDs

Target entity:

```text
cg:person:<name-or-stable-id>
```

Initial statements:

```text
instance of -> person
stood in election -> election
candidate in contest -> contest
member of political party -> party/label
represented constituency -> constituency
position held -> office
served in elected body -> body
register of interests record -> register record
same as -> Wikidata/PublicWhip/other external IDs where known
```

Risk:

- Person identity resolution is hard.
- Same names can be different people.
- Constituency/party/year context must be used.

Guardrails:

- Do not merge persons solely on normalized name.
- Use a `personIdentityKey` based on known IDs where available, then name + election history + constituency + party history.
- Emit `review` confidence when identity is uncertain.
- Keep separate entities for ambiguous names until manually resolved.
- Add duplicate-person reports.

### 13.2 Parties And Labels

Current source:

- `party-ids.json`
- election details
- `buildParties`

Target entities:

```text
cg:party:<canonical-party>
cg:label:<observed-label>
```

Initial statements:

```text
instance of -> party / political label
observed label -> string
canonical party -> party
party colour -> string/hex
appeared in election -> election
candidate count -> quantity
seat count -> quantity
same as -> external IDs if available
```

Risk:

- Labels are not always parties.
- Coalition/ticket/independent labels need careful modeling.

Guardrails:

- Keep `party` and `political-label` separate.
- Let labels point to canonical parties where known.
- Do not force all labels to canonical party entities.

### 13.3 Elections

Current source:

- `render/metadata/elections-test2.json`
- election detail files
- result entries in Browse

Target entities:

```text
cg:election:<body>:<date>
cg:contest:<election-key>:<area>
cg:election-result:<contest>:<candidate-or-party>
```

Initial statements:

```text
instance of -> election
elected body -> body
date -> date
contest -> contest
uses boundary layer -> map layer
previous comparable election -> election
candidate -> person
party -> party/label
votes -> quantity
elected candidate -> person
constituency -> constituency
source -> election source
```

Risk:

- Comparable previous elections require domain-specific logic.
- By-elections, recalls, referendums, and general elections are not interchangeable.

Guardrails:

- Reuse existing election baseline rules.
- Validator must assert Westminster general elections skip intervening by-elections/recalls where already modeled that way.
- Keep election event, contest, and result entities separate.

### 13.4 Elected Bodies And Offices

Target entities:

```text
cg:body:house-of-commons
cg:body:ni-assembly
cg:office:mp
cg:office:mla
cg:office:councillor
```

Initial statements:

```text
instance of -> elected body / office
jurisdiction -> place
office belongs to body -> body
office holder -> person
```

Risk:

- Offices change names/status over time.

Guardrails:

- Model office and body separately.
- Use date qualifiers for office-holding statements.

### 13.5 Map Layers

Current source:

- `data/database/maps.json`
- `data/database/data-entries.json`
- generated render/test2 metadata
- PMTiles/GeoJSON/source file metadata

Target entity:

```text
cg:layer:<map-id>
```

Initial statements:

```text
instance of -> map layer
depicts -> concept/geography type
valid from -> date/year
valid to -> date/year
source file -> file entity
provider -> organization
licence -> licence
interactive map URL -> URL
download URL -> URL
has feature collection -> feature group
```

Risk:

- Layers can represent different conceptual levels: source dataset, rendered layer, logical map, child layer, variant.

Guardrails:

- Keep map layer, source dataset, source file, and feature entity distinct.
- Use `derived from` and `source file` statements rather than merging them.

### 13.6 Map Features

Current source:

- spatial index
- feature shards
- map layer metadata

Target entities:

```text
cg:feature:<map-id>:<feature-key>
cg:constituency:<name>:<system>
cg:admin-area:<name>:<system>
```

Important distinction:

- Conceptual geography: "Upper Bann Westminster constituency"
- Feature instance: the feature row in a specific boundary layer

Initial statements:

```text
feature instance of -> constituency/admin area/place
feature in layer -> map layer
label -> string
bounding box -> bbox
valid from -> date/year
valid to -> date/year
part of -> higher-level geography
used in election -> election
geometry asset -> file/layer reference
```

Risk:

- Names are reused across systems and times.
- Boundary concepts and geometry instances can drift.

Guardrails:

- Never collapse all same-name features across layers.
- Use layer ID and stable feature key in feature-instance ID.
- Create conceptual geography entity only when a stable mapping is known.
- Add review reports for same-name/different-geometry cases.

### 13.7 Register Interests

Current source:

- `data/database/ni-register-interests.json`
- raw source shards
- canonical interest shards
- grouped Browse register record shards
- Browse register-interest index/detail shards

Target entities:

```text
cg:register-record:<member>:<body>:<date>
cg:register-interest:<record>:<category>:<hash>
```

Initial statements:

For person:

```text
register of interests record -> register record
```

For register record:

```text
person -> person
elected body -> body
register date -> date
constituency -> constituency
declared interest -> interest entry
source row count -> integer
```

For interest entry:

```text
interest category -> category/concept
declared interest text -> string
nil interest -> boolean
amount -> quantity when parseable
registration date -> date when parseable
published date -> date when parseable
source -> source row/reference
```

Risk:

- Interest text is semi-structured and varies across HTML, PDF, API, and CSV sources.
- Parsing fields out of interest text can create false precision.

Guardrails:

- First phase: preserve original interest text as main statement value.
- Only extract qualifiers using high-confidence regex/source fields.
- Store unparsed original text as evidence.
- Separate "declared interest text" from parsed qualifiers.
- Keep source rows merged into the grouped record but references visible per interest statement.

### 13.8 Sources And Files

Current source:

- source indexes
- books/data entries
- raw source documents
- external sources
- NI register sources
- medium-priority and approved source records

Target entities:

```text
cg:source:<source-record-id>
cg:file:<source-record-id>:<file-key-or-hash>
cg:provider:<provider-slug>
```

Initial statements:

```text
instance of -> source document / dataset / file
provider -> organization
publisher -> organization
download URL -> URL
licence -> licence
format -> string/concept
checksum -> string
file size -> quantity
retrieved at -> date
supports statement -> statement reference index
```

Risk:

- Source records are already numerous and some are provenance enrichment records.
- Some source records are about families of sources, not exact files.

Guardrails:

- Model exact file, provider dataset, source-family, and source-record separately when possible.
- Let source-family records exist as entities but do not pretend they are exact primary files.

## 14. Browse UX Target

### 14.1 Entity-First Browse

Add an "Entities" route in Browse once graph coverage is sufficient.

Possible Browse groups:

```text
Maps
Elections
Features
Parties / Labels
Persons
Register Interests
Books / Tables / Sources
Entities
```

Do not remove existing groups in the first rollout.

### 14.2 Statement Panels

Each detail page should render compact grouped statements:

```text
Carla Lockhart
Person | DUP politician | MP for Upper Bann

Public offices
  Member of Parliament
    body: House of Commons
    constituency: Upper Bann
    start: 2019-12-12
    sources: 2019 election result, House of Commons data

Elections
  2024 UK general election
    party: DUP
    constituency: Upper Bann
    result: elected
    votes: ...

Register interests
  2026-06-15 | House of Commons
    Employment and earnings
    Land and property
    Miscellaneous
```

### 14.3 Compact Wikidata-Like Layout

Statement row:

```text
property label | main value
                 qualifier chips/rows
                 references collapsed by default
```

UI rules:

- Use compact two-column property/value rows on desktop.
- Stack property above value on mobile.
- Group by display groups from property registry.
- Prefer human labels over raw IDs.
- Show "source" as a small expandable reference count.
- Show raw technical JSON only in collapsed technical data.
- Hide placeholder thumbnails on graph-first pages unless a meaningful thumbnail exists.
- Use small badges for rank/confidence only when not normal/high.
- Do not overload the Overview panel with long concatenated summaries.

### 14.4 Register Interest Page Redesign

Replace the current fragmented layout with:

```text
Header:
  Carla Lockhart
  House of Commons register record
  15 June 2026 | Upper Bann | DUP | 3 interests | 3 source rows

Interest statements:
  Employment and earnings
    Summary: ...
    Parent interest: ...
    job title: ...
    payment: ...
    registration date: ...
    published date: ...
    source: NI MP CSV row

  Land and property
    Agricultural land in County Fermanagh
    owner details: ...
    use: agricultural
    country: United Kingdom
    source: NI MP CSV row

  Miscellaneous
    Governor role...
    source: NI MP CSV row
```

Source details should live under each interest, not as a disconnected table.

### 14.5 Map Feature Page Redesign

Example:

```text
Upper Bann
Constituency

Depicted by layers
  Westminster constituencies 2023
    valid from: 2024 election
    geometry asset: layer/PMTiles
    source: Boundary Commission / source file

Used in elections
  2024 UK general election
  2019 UK general election

Represented by
  Carla Lockhart
    body: House of Commons
    start: 2019
```

## 15. Implementation Phases

### Phase 0: Baseline Inventory And Contracts

Goal: document current entity-like records and define graph boundaries.

Tasks:

- Inventory entity candidates from existing data:
  - maps
  - features
  - elections
  - result entries
  - parties
  - persons
  - register records
  - sources
- Create a mapping table:
  - source dataset
  - existing ID
  - target entity type
  - target ID pattern
  - high-confidence properties
  - risky/inferred properties
- Define file-size budgets:
  - graph shard target: <= 10 MB preferred
  - hard graph shard cap: <= 25 MB for Pages safety
  - repository warning cap: avoid > 45 MB where possible
- Decide whether `data/graph/` is public from phase 1 or internal until phase 2.

Deliverables:

```text
docs/semantic-graph-inventory.md
data/database/graph-entity-types.json
data/database/graph-properties.json
```

Verification:

```text
node --check scripts/graph/build-semantic-graph.mjs
node --check scripts/graph/validate-semantic-graph.mjs
```

Acceptance:

- Inventory covers all existing Browse groups.
- No runtime behavior changes.

### Phase 1: Schema, Registry, Builder Skeleton

Goal: create the graph framework without generating complex claims.

Tasks:

- Add `scripts/graph/lib/ids.mjs`.
- Add deterministic hash helpers.
- Add entity builder utility.
- Add statement builder utility.
- Add reference builder utility.
- Add schema validator.
- Add property registry.
- Add entity type registry.
- Add graph manifest writer.
- Add shard writer with file-size guardrails.

Initial graph outputs:

```text
data/graph/manifest.json
data/graph/schema.json
data/graph/properties.json
data/graph/entity-types.json
data/graph/entity-shards/entities-000.json
data/graph/statement-shards/statements-000.json
data/graph/indexes/entity-slugs.json
```

Validation rules:

- schema version present
- unique entity IDs
- unique property IDs
- unique statement IDs
- no orphan property IDs
- no orphan entity references
- valid datatype values
- shard sizes under budget
- deterministic output under repeated build

Commands:

```text
npm run build:graph
npm run check:graph
```

Acceptance:

- Graph builds with basic entities/properties only.
- No Browse UI changes yet.
- Existing `npm run check` still passes.

### Phase 2: Persons, Parties, Elections Statement Slice

Goal: create a useful cross-domain graph from the strongest existing structured data.

Extractors:

```text
scripts/graph/extractors/persons.mjs
scripts/graph/extractors/parties.mjs
scripts/graph/extractors/elections.mjs
```

Generate:

- person entities from election person Browse records
- party/label entities from party IDs and election observations
- election entities
- contest entities
- office/body entities for known election bodies

Statements:

- person stood in election
- person candidate in contest
- person party/label in contest
- person elected status
- party/label appeared in election
- election has contest
- contest has constituency/feature
- election date
- elected body

References:

- election detail records
- election manifest records
- source records where available

Validation:

- every person statement has election/contest context
- every candidate statement has a source detail
- no same-name automatic merge unless identity key passes rules
- Westminster general-election baseline rules remain covered by existing validation

Acceptance:

- At least all current Browse persons have graph entities.
- At least all current Browse parties/labels have graph entities.
- At least all current parent elections have graph entities.

### Phase 3: Register Interests Statement Slice

Goal: fix the Register Interests UX using graph statements.

Extractor:

```text
scripts/graph/extractors/register-interests.mjs
```

Generate:

- register record entities for politician/body/date tuples
- register interest entry entities or statement values
- person-to-register statements
- register-to-interest statements
- body/constituency/date/category/source qualifiers

Statement design:

```text
subject: person
property: register of interests record
value: register record entity
qualifiers: body, constituency, date, party, source row count

subject: register record
property: declared interest
value: interest entry entity or text
qualifiers: category, nil flag, parsed dates/amounts where high confidence
references: source rows
```

UI:

- Add `renderStatementPanel`.
- Add `renderRegisterInterestStatementPanel`.
- For register-interest detail pages, show graph statement view above old tables.
- Keep old tables temporarily behind "Raw extracted tables".

Validation:

- every grouped Browse register record has a matching graph entity
- every interest entry has at least one source reference
- sourceRefs count in graph equals sourceRefs count in grouped detail row
- nil interest flags preserved
- date/body/person tuple preserved

Acceptance:

- Carla Lockhart example page becomes readable without opening technical data.
- Existing register-interest list controls still work.
- Existing register-interest detail URLs still work.

### Phase 4: Map Layers And Source Files

Goal: connect map layers to source records, providers, files, downloads, and feature groups.

Extractor:

```text
scripts/graph/extractors/maps.mjs
scripts/graph/extractors/sources.mjs
```

Generate:

- map layer entities
- data-entry/dataset entities where distinct
- source document/file entities
- provider entities
- licence entities/concepts

Statements:

- map layer depicts concept
- map layer source file
- map layer provider
- map layer licence
- map layer has download
- map layer has interactive URL
- source file format/checksum/file size
- source record provider/publisher

Validation:

- every Browse map has a layer entity
- every map download/source file has source/file entity or explicit exclusion
- no missing download URLs for files currently exposed in Browse
- file-size metadata preserved where available

Acceptance:

- Map Browse detail page can show "Facts", "Files", "Sources", "Related features".

### Phase 5: Feature And Geography Graph

Goal: connect map features to layers, elections, geography concepts, and people.

Extractor:

```text
scripts/graph/extractors/features.mjs
```

Generate:

- feature group entities
- feature instance entities for sampled or indexed features
- conceptual geography entities where safe

Statements:

- feature in layer
- feature instance of geography concept
- feature label
- feature bounding box
- layer has feature
- feature used in election
- feature represented by person where election/office data supports it

Key design:

- Do not generate all huge feature statements if this creates excessive static payloads.
- Start with feature groups and election-linked features.
- For large feature collections, generate entity shells/index rows and lazy detail shards only.

Validation:

- no same-name feature merge across incompatible layers
- feature-to-layer references valid
- feature shard sizes under budget

Acceptance:

- Election constituency pages can connect to map layers and representatives.
- Map feature pages can connect to elections and sources.

### Phase 6: Entity Browse Route

Goal: introduce graph-first Browse pages without removing existing routes.

New route:

```text
#/entities/<slug>
```

Data:

```text
data/graph/indexes/entity-slugs.json
data/graph/indexes/statements-by-subject-*.json
```

UI functions:

```text
loadGraphManifest()
loadEntityBySlug()
loadStatementsForEntity()
renderEntityHeader()
renderStatementGroups()
renderStatementRow()
renderQualifiers()
renderReferences()
renderRelatedEntities()
```

Integration:

- Existing person pages can link to entity pages.
- Existing map/feature/election/source/register pages can show graph panels.
- Add "Open entity view" action where graph entity exists.

Acceptance:

- Entity page works for:
  - Carla Lockhart
  - DUP
  - House of Commons
  - Upper Bann
  - 2024 UK general election
  - a map layer
  - a source document

### Phase 7: Search And Cross-Linking

Goal: make graph connections discoverable.

Tasks:

- Add entity search index.
- Add reverse index by value entity.
- Add source-to-statements index.
- Add statement count summaries by property.
- Add "Related" panels:
  - people related to feature
  - features related to election
  - sources supporting entity
  - map layers depicting entity

Acceptance:

- Search for "Upper Bann" can surface:
  - constituency feature/entity
  - elections using it
  - Carla Lockhart person entity
  - map layers depicting it

### Phase 8: Exports

Goal: make Civgraph graph portable without changing runtime.

Exports:

```text
data/graph/exports/civgraph.jsonld
data/graph/exports/civgraph-rdf.ndjson
data/graph/exports/civgraph-provenance.json
```

Tasks:

- Define JSON-LD context.
- Map Civgraph properties to external vocabularies where safe:
  - `sameAs`
  - `label`
  - `description`
  - `prov:wasDerivedFrom`
  - `prov:hadPrimarySource`
  - `prov:wasGeneratedBy`
- Add export validators.

Acceptance:

- Export is optional and does not power Browse.
- Export excludes review-only or low-confidence internal data unless configured.

### Phase 9: Optional Query Backend

Goal: decide whether static JSON is enough.

Do not start here.

Possible future options:

- SQLite/DuckDB generated database for local analysis
- RDF store for public SPARQL
- property graph database for internal curation
- Wikibase instance for collaborative editing

Decision criteria:

- static JSON becomes too slow or too large
- contributors need live editing workflows
- public API/query needs exceed static indexes
- complex graph traversals become core user-facing features

Recommendation:

- Build static JSON graph first.
- Reassess after graph covers persons, elections, register interests, layers, features, and sources.

## 16. Validation Plan

### 16.1 Schema Validation

Validate:

- all graph files have `schemaVersion`
- all entity IDs match allowed patterns
- all property IDs exist
- all statement IDs are unique
- all statement values match property datatype
- qualifiers use valid properties
- references use valid source IDs or explicit external sources
- rank/confidence values are allowed

### 16.2 Referential Integrity

Validate:

- statement subject exists
- entity value exists when `value.type === "entity"`
- qualifier entity values exist
- source IDs exist
- source row IDs exist where source row coverage is required
- Browse record to entity index points to valid entities
- entity slug index has no collisions

### 16.3 Source Coverage

Validate:

- each public non-technical statement has references unless property allows optional source
- register interest source row counts are preserved
- election candidate statements have election source/detail references
- map layer file/source statements point to existing source/file metadata

### 16.4 Determinism

Run graph build twice and compare:

```text
npm run build:graph
copy data/graph to tmp/graph-a
npm run build:graph
diff tmp/graph-a data/graph
```

Automate with:

```text
node scripts/graph/validate-semantic-graph.mjs --determinism
```

### 16.5 File Budget

Validate:

- no graph shard exceeds target/hard caps
- no generated Browse index exceeds Pages cap
- no new single file exceeds GitHub warning thresholds where avoidable
- graph manifest reports largest shard

Recommended caps:

```text
preferred JSON shard cap: 10 MB
hard public shard cap: 25 MB
repository warning cap: 45 MB
```

### 16.6 UI Validation

Add browser tests:

```text
tests/browser/browse-graph.spec.js
```

Smoke pages:

- Carla Lockhart entity
- Carla Lockhart register record
- House of Commons
- Upper Bann
- DUP
- a map layer
- an election
- a source document

Assertions:

- statement groups render
- references can expand
- no huge raw JSON shown by default
- source links work
- existing Browse nav still works
- mobile layout does not overlap

### 16.7 Regression Validation

Existing checks must continue:

```text
npm run check
npm run build
npm run check:ni-register-interests
npm run check:test2
```

For graph-only changes:

```text
npm run build:graph
npm run check:graph
```

For Browse UI graph changes:

```text
npm run build:browse
npm run check:graph
npm run check:pages-assets
npm run test:browser -- browse-graph
```

## 17. Risk Register

### 17.1 Person Identity Collisions

Risk: different people with same/similar names get merged.

Prevention:

- no name-only merges
- require external ID or stable election/person ID where possible
- otherwise use name + election history + constituency + party context
- emit review reports for ambiguous identities
- keep uncertain identities separate

Verification:

- duplicate candidate report
- known collision fixtures
- validator for suspicious merges

### 17.2 Feature Identity Collisions

Risk: same-name features across different layers/times get merged.

Prevention:

- distinguish conceptual geography from layer feature instance
- use map ID in feature instance ID
- require explicit mapping to conceptual geography

Verification:

- same-name/different-layer report
- geometry hash or bbox comparison where possible

### 17.3 File Size Growth

Risk: statement graph becomes too large for GitHub/Pages/browser.

Prevention:

- shard by entity/statement
- keep full source text in existing detail shards, not graph index
- use compact references
- store heavy geometry in domain files only
- validator caps shard sizes

Verification:

- file budget report in `data/graph/quality/validation-summary.json`

### 17.4 False Precision From Parsed Text

Risk: semi-structured register interest text gets parsed into incorrect qualifiers.

Prevention:

- preserve original text
- extract only high-confidence fields
- mark parsed qualifiers with extraction method/confidence
- keep low-confidence parse output internal/review-only

Verification:

- sample fixtures for MP CSV/API/PDF/HTML rows
- false-positive tests for dates/amounts

### 17.5 Browse Confusion During Migration

Risk: users see duplicate pages or inconsistent facts.

Prevention:

- existing Browse pages remain canonical initially
- graph panels are additive
- add "entity view" only after enough coverage
- show source/confidence

Verification:

- route tests for old and new URLs
- visual smoke of old Browse groups

### 17.6 Source/Reference Drift

Risk: statements reference source IDs that later move or regenerate.

Prevention:

- stable source IDs
- references can include both `sourceId` and fallback source URL/checksum
- validator checks source IDs after every build

Verification:

- source coverage validation
- orphan reference report

### 17.7 Overengineering

Risk: graph work becomes a large abstract ontology project without improving Browse.

Prevention:

- first shipping slice must improve Register Interests and person pages
- property registry starts small
- every phase has visible Browse acceptance criteria
- export/RDF/SPARQL deferred

Verification:

- phase acceptance demos
- browser smoke pages

## 18. Implementation Details

### 18.1 Builder API

Provide helper functions:

```js
addEntity({
  id,
  type,
  label,
  description,
  aliases,
  sameAs,
  generatedFrom
});

addStatement({
  subjectId,
  propertyId,
  value,
  qualifiers,
  references,
  rank,
  confidence,
  provenance
});

refFromBrowseSource(sourceRecord);
refFromNiRegisterSourceRef(sourceRef);
refFromElectionDetail(row);
```

Helpers must:

- normalize values
- validate datatypes
- create deterministic IDs
- dedupe identical statements
- merge references for same canonical statement
- preserve source row IDs

### 18.2 Statement Deduplication

Deduping rules:

- Same subject/property/value/identity qualifiers means one statement.
- Multiple references should attach to same statement.
- Conflicting values should remain separate statements.
- Do not dedupe across different point-in-time/register-date values.

Example:

```text
Carla Lockhart -> member of political party -> DUP
  qualifier: point in time 2024 election

Carla Lockhart -> member of political party -> DUP
  qualifier: point in time 2019 election
```

These may either be separate statements or one statement with a date interval if the source supports an interval. Do not infer continuous intervals from repeated election observations unless explicitly intended.

### 18.3 Statement Grouping For UI

Each property should define:

```json
{
  "displayGroup": "Elections",
  "displayOrder": 300,
  "valueFormatter": "entity-link",
  "qualifierDisplay": "compact-list",
  "referenceDisplay": "collapsed"
}
```

Browse should sort statements by:

1. property display group order
2. property display order
3. rank
4. date qualifier descending where relevant
5. label/value

### 18.4 Entity Summary Generation

Each entity should get:

- primary label
- compact description
- type badges
- key facts
- counts by statement group
- representative source count

Generated summary examples:

```text
Carla Lockhart
Person | DUP | House of Commons | Upper Bann
```

```text
Upper Bann
Westminster constituency | used in 2024 UK general election | depicted by 3 layers
```

### 18.5 Relationship To Existing Browse Records

Add mapping:

```text
data/graph/indexes/browse-record-to-entity.json
```

Example:

```json
{
  "persons:carla-lockhart": "cg:person:carla-lockhart",
  "register-interests:ni-register-record-abc": "cg:register-record:carla-lockhart:house-of-commons:2026-06-15",
  "maps:pc-2023": "cg:layer:pc-2023"
}
```

Existing detail pages can load this mapping and show graph panels.

### 18.6 Graph Manifest

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-06-27T00:00:00.000Z",
  "counts": {
    "entities": 0,
    "statements": 0,
    "references": 0,
    "properties": 0
  },
  "shards": {
    "entities": [],
    "statements": [],
    "references": []
  },
  "indexes": {
    "entitySlugs": "/data/graph/indexes/entity-slugs.json",
    "statementsBySubject": "/data/graph/indexes/statements-by-subject-000.json"
  },
  "quality": {
    "validationSummary": "/data/graph/quality/validation-summary.json"
  }
}
```

## 19. Initial Property Set

Start with a small property set.

Required phase 1 properties:

```text
cgprop:instance-of
cgprop:same-as
cgprop:external-id
cgprop:label
cgprop:description
cgprop:source-record
```

Required phase 2 properties:

```text
cgprop:stood-in-election
cgprop:candidate-in-contest
cgprop:elected-in-election
cgprop:member-of-political-party
cgprop:elected-body
cgprop:constituency
cgprop:election-date
cgprop:contest
cgprop:votes
cgprop:elected
```

Required phase 3 properties:

```text
cgprop:register-record
cgprop:declared-interest
cgprop:interest-category
cgprop:register-date
cgprop:nil-interest
cgprop:source-row-count
```

Required phase 4/5 properties:

```text
cgprop:depicts
cgprop:feature-in-layer
cgprop:has-feature
cgprop:geometry-asset
cgprop:download-url
cgprop:format
cgprop:provider
cgprop:licence
cgprop:checksum
cgprop:valid-from
cgprop:valid-to
cgprop:part-of
```

## 20. Data Quality Tiers

Statements should be public by default only when:

- confidence is high or medium
- source policy is satisfied
- entity identity is not ambiguous
- value datatype validates
- not marked sensitive/review-only

Low/review statements:

- can be generated into internal quality reports
- should not be rendered publicly unless explicitly allowed
- should not influence summaries or preferred facts

Rejected statements:

- internal only
- used to prevent recurring bad matches

## 21. Rollout Strategy

### 21.1 Feature Flags

Add flags in `browse/browse.js`:

```js
const GRAPH_BROWSE_ENABLED = true;
const GRAPH_ENTITY_ROUTE_ENABLED = false;
const GRAPH_REGISTER_INTEREST_PANEL_ENABLED = true;
```

Or better, read from graph manifest:

```json
{
  "features": {
    "entityRoutes": false,
    "registerInterestPanels": true,
    "personPanels": false
  }
}
```

### 21.2 Additive Rendering

Initial UI integration:

- existing detail page loads
- graph panel loads if mapping exists
- if graph load fails, existing page still renders
- graph panel failures log to console but do not break Browse

### 21.3 Gradual Promotion

Promotion order:

1. Register-interest statement panel
2. Person statement panel
3. Party/election statement panel
4. Map layer/source statement panel
5. Feature/geography statement panel
6. Entity route

## 22. Testing Matrix

### 22.1 Unit/Script Checks

```text
node --check scripts/graph/build-semantic-graph.mjs
node --check scripts/graph/validate-semantic-graph.mjs
node --check scripts/graph/extractors/persons.mjs
node --check scripts/graph/extractors/register-interests.mjs
```

### 22.2 Build Checks

```text
npm run build:graph
npm run check:graph
npm run build:browse
npm run check:pages-assets
npm run check
```

### 22.3 Data Smoke Tests

Create:

```text
scripts/graph/smoke-semantic-graph.mjs
```

Assertions:

- Carla Lockhart entity exists.
- Carla Lockhart has register record statements.
- Register record has declared interest statements.
- Declared interest statements have source references.
- Upper Bann entity/feature exists where mapped.
- House of Commons body exists.
- At least one election links person, party, contest, and constituency.

### 22.4 Browser Tests

Smoke:

```text
tests/browser/browse-graph.spec.js
```

Viewports:

- desktop 1280x900
- mobile 390x844

Assertions:

- no horizontal overflow
- statement groups visible
- references expandable
- old metadata panels still accessible
- technical data collapsed

## 23. Contributor Workflow Implications

The contributor system should eventually submit proposed statement patches, not arbitrary page edits.

Future contribution shape:

```json
{
  "entityId": "cg:person:carla-lockhart",
  "operation": "add-statement",
  "propertyId": "cgprop:same-as",
  "value": {
    "type": "external-id",
    "scheme": "wikidata",
    "id": "Q24052782"
  },
  "references": [...]
}
```

Review queue should validate:

- property exists
- datatype is valid
- source policy satisfied
- no duplicate exact statement
- conflict detection result

Do not implement this in the first graph slice.

## 24. Repository Hygiene

Because this repo has many generated files and large data products, graph work must be packaged carefully.

Rules:

- Keep graph code commits separate from unrelated generated rebuilds.
- Do not stage broad `data/browse/sources.json` changes unless source graph work requires them.
- Use scoped `git status --short -- <paths>`.
- Use `git diff --cached --name-only` before commit.
- Use `git diff --cached --check`.
- Run focused validators before staging generated data.
- Avoid single generated files above 45 MB.

Recommended commit sequence:

1. Schema and registry only.
2. Builder and validator skeleton.
3. First graph generated output.
4. Register-interest graph extractor and UI panel.
5. Person/election graph extractor.
6. Entity route.

## 25. Detailed First Sprint

### Sprint Goal

Add a non-UI graph layer for persons, register-interest records, bodies, parties, elections, and sources, with validation.

### Files To Add

```text
data/database/graph-properties.json
data/database/graph-entity-types.json
scripts/graph/build-semantic-graph.mjs
scripts/graph/validate-semantic-graph.mjs
scripts/graph/lib/ids.mjs
scripts/graph/lib/statement-builder.mjs
scripts/graph/lib/schema.mjs
scripts/graph/extractors/register-interests.mjs
scripts/graph/extractors/persons.mjs
scripts/graph/extractors/elections.mjs
scripts/graph/extractors/parties.mjs
```

### Files To Generate

```text
data/graph/manifest.json
data/graph/properties.json
data/graph/entity-types.json
data/graph/entity-shards/entities-000.json
data/graph/statement-shards/statements-000.json
data/graph/indexes/entity-slugs.json
data/graph/indexes/browse-record-to-entity.json
data/graph/quality/validation-summary.json
```

### First Sprint Acceptance

- `npm run build:graph` passes.
- `npm run check:graph` passes.
- No Browse UI changes.
- Graph contains:
  - House of Commons body
  - Northern Ireland Assembly body
  - MP office
  - MLA office
  - Carla Lockhart person entity if present in source data
  - at least one Carla Lockhart register record entity
  - at least one declared-interest statement with references
  - party/label entity for DUP
- Graph validation summary includes counts and largest shard size.

## 26. Detailed Second Sprint

### Sprint Goal

Add compact graph statement panels to register-interest detail pages.

### Files To Update

```text
browse/browse.js
browse/browse.css
scripts/build-browse-indexes.mjs
```

### UI Functions To Add

```text
loadGraphForBrowseItem(type, item)
renderGraphStatementPanel(entity, statements)
renderStatementGroup(group)
renderStatementValue(statement)
renderStatementQualifiers(statement)
renderStatementReferences(statement)
```

### Register Page Changes

- Header remains.
- Statement panel appears immediately after header or overview.
- Existing tables move below statement panel.
- Raw technical data remains collapsed.
- Source rows attach to each interest statement.

### Acceptance

- Carla Lockhart register page is readable without technical data.
- Employment/property/miscellaneous interests display as separate statement rows.
- Sources are attached to rows.
- Mobile layout remains usable.
- Old register-interest Browse list still works.

## 27. Detailed Third Sprint

### Sprint Goal

Add graph panels to person pages and connect person pages to register interests/elections.

### Tasks

- Add person -> graph entity mapping.
- Add statement panel to person detail.
- Show:
  - offices
  - elections contested
  - parties/labels
  - constituencies represented
  - register records
  - related sources

### Acceptance

- Person page for Carla Lockhart shows elections and register interests in one place.
- Related register record links open existing register Browse pages or graph entity pages.

## 28. Open Design Decisions

These should be decided before implementation, but they should not block the planning document.

1. Should public entity routes be `#/entities/<slug>` or folded into current groups?
   - Recommendation: add `#/entities/<slug>` and keep current group routes.
2. Should statements be entities?
   - Recommendation: statements have IDs but are not normal entities in the first phase.
3. Should register interest entries be entities or statement values?
   - Recommendation: register records are entities; individual interest entries can be entity-like values initially and promoted to entities if cross-linking warrants it.
4. Should properties use `cgprop:*` IDs or short `P*` IDs?
   - Recommendation: use readable `cgprop:*` IDs internally; optionally add numeric aliases later.
5. Should the graph build depend on Browse output or raw data?
   - Recommendation: raw data first, Browse output only for mapping/slug compatibility.
6. Should RDF/JSON-LD export ship immediately?
   - Recommendation: no. Add once internal graph is stable.
7. Should external IDs be imported from Wikidata?
   - Recommendation: only if source data or manual mappings are available; do not fuzzy-match external entities automatically in first phase.

## 29. Recommended Initial Work Order

1. Create entity/property registry.
2. Create graph builder skeleton.
3. Create graph validator skeleton.
4. Generate body/office/source/person/register entities.
5. Generate register-interest statements with source references.
6. Generate person/election/party statements.
7. Add graph validation to `npm run check`.
8. Add register-interest statement UI panel.
9. Add person statement UI panel.
10. Add entity route.
11. Expand to map layers/features/sources.
12. Add optional exports.

## 30. Why This Is Better Than Alternatives

### 30.1 Pure Wikibase

Pros:

- mature statement model
- editing/revision ecosystem
- possible SPARQL/RDF ecosystem

Cons:

- heavy operational dependency
- not aligned with static Pages architecture
- hard to version generated static assets cleanly
- overkill before Civgraph's property/entity model stabilizes
- would not solve geospatial file/runtime needs

Recommendation:

- Do not use as first implementation.
- Reconsider only if contributor editing becomes central.

### 30.2 Pure RDF Triple Store

Pros:

- standards-based
- queryable
- interoperable

Cons:

- statement qualifiers/references require reification/named graphs/RDF-star design decisions
- difficult static front-end integration
- less ergonomic for Civgraph's current JS build pipeline
- not necessary for first Browse improvements

Recommendation:

- Export RDF later; do not use as primary internal model initially.

### 30.3 Relational Database Only

Pros:

- strong constraints
- clear joins
- good for analysis

Cons:

- less flexible for heterogeneous claims
- awkward for qualifiers/references on arbitrary relationships
- not naturally static-hosted

Recommendation:

- Consider SQLite/DuckDB export for analysis, not as primary web model.

### 30.4 Property Graph Database

Pros:

- good for graph traversal
- intuitive nodes/edges

Cons:

- runtime service dependency
- not ideal for static site deployment
- still needs source/provenance/statement semantics

Recommendation:

- Not first implementation.

### 30.5 Civgraph-Native Static Statement Graph

Pros:

- fits existing build/static deployment
- deterministic and testable
- keeps domain files intact
- improves Browse UX quickly
- can export to standards later
- can be validated with repo scripts

Cons:

- custom model must be maintained
- no off-the-shelf query UI at first
- property registry requires discipline

Recommendation:

- Best fit for Civgraph now.

## 31. Final Recommendation

Implement a Civgraph-native semantic statement graph as a generated public data layer.

Use Wikidata-style statements as the connective model:

```text
entity -> property -> value
  qualifiers
  references
  rank
  confidence
```

Keep all existing source and domain files.

Use the graph to make Browse entity-first and statement-first over time.

Start with register interests and persons because they expose the immediate UX problem and already have strong enough structured data to prove the model.

Do not introduce Wikibase, SPARQL, RDF runtime, or a database server until the static graph has proven value and the entity/property registry is stable.

