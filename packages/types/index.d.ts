// The shared data shapes, for JSDoc. Import by relative path (packages/README.md), e.g.
//   /** @typedef {import('../../packages/types/index.js').Council} Council */
// generated/ is written by src/generate.mjs (npm run build:types) from its sources and checked
// by tests/unit/types-package.test.mjs; hand/core.d.ts is hand-written.

// The hand-written core shapes (Election, Contest, Candidacy, Count, Person, Party, Council,
// Office, MapEntry, LayerEntry, CatalogueSeries, envelopes): flat, the names most code wants.
export * from './hand/core.js';

// The intake batch (batch.json, scripts/intake/batch.schema.json), hand-written.
export * from './hand/intake.js';

// Generated: one namespace per source.
export * as RecordsDb from './generated/records-db.js';
export * as ApiV1 from './generated/api-v1.js';
export * as AffiliationsFacts from './generated/facts/affiliations.js';
export * as CitationFacts from './generated/facts/citation.js';
export * as HonoursFacts from './generated/facts/honours.js';
export * as NonCandidatePersonsFacts from './generated/facts/non-candidate-persons.js';
export * as OfficesFacts from './generated/facts/offices.js';
export * as PartyEventsFacts from './generated/facts/party-events.js';
export * as TenuresFacts from './generated/facts/tenures.js';
export * as CouncilsRegistryTypes from './generated/registries/councils.js';
export * as LayerTypesRegistryTypes from './generated/registries/layer-types.js';
export * as OfficesRegistryTypes from './generated/registries/offices-registry.js';
export * as PartiesRegistryTypes from './generated/registries/parties.js';
export * as StatusesRegistryTypes from './generated/registries/statuses.js';
export * as ElectionBodiesRegistryTypes from './generated/registries/election-bodies.js';
export * as ElectionTypesRegistryTypes from './generated/registries/election-types.js';
export * as ColoursRegistryTypes from './generated/registries/colours.js';
export * as LanguagesRegistryTypes from './generated/registries/languages.js';
export * as CatalogueKindsRegistryTypes from './generated/registries/catalogue-kinds.js';
export * as SourceKindsRegistryTypes from './generated/registries/source-kinds.js';

// The generated root documents and the records table map, flat.
export type { Tables, TableName } from './generated/records-db.js';
export type { V1Routes, V1Route, V1Answer } from './generated/api-v1.js';
export type { CouncilsRegistry } from './generated/registries/councils.js';
export type { PartiesRegistry } from './generated/registries/parties.js';
export type { StatusesRegistry } from './generated/registries/statuses.js';
export type { LayerTypesRegistry } from './generated/registries/layer-types.js';
export type { ElectionBodiesRegistry } from './generated/registries/election-bodies.js';
export type { ElectionTypesRegistry } from './generated/registries/election-types.js';
export type { ColoursRegistry } from './generated/registries/colours.js';
export type { LanguagesRegistry } from './generated/registries/languages.js';
export type { CatalogueKindsRegistry } from './generated/registries/catalogue-kinds.js';
export type { SourceKindsRegistry } from './generated/registries/source-kinds.js';
export type { OfficesRegistryRegistry } from './generated/registries/offices-registry.js';
export type { OfficesDocument } from './generated/facts/offices.js';
export type { TenuresDocument } from './generated/facts/tenures.js';
export type { AffiliationsDocument } from './generated/facts/affiliations.js';
export type { HonoursDocument } from './generated/facts/honours.js';
export type { PartyEventsDocument } from './generated/facts/party-events.js';
export type { NonCandidatePersonsDocument } from './generated/facts/non-candidate-persons.js';
export type { CitationDocument } from './generated/facts/citation.js';
