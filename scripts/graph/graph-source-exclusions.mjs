/**
 * Which Browse/Sources records are deliberately kept out of the semantic graph.
 *
 * Bulk catalogue-link source tranches are published to Browse/Sources -- a sharded index
 * that scales to tens of thousands of rows -- but are NOT promoted to graph entities. They
 * are catalogue stubs with no relationships, and folding them in would push
 * entity-search.json and entity-slugs.json past the 25 MiB Cloudflare Pages per-file limit.
 *
 * THIS LIVES IN ITS OWN MODULE BECAUSE TWO SCRIPTS MUST AGREE ON IT. The builder skipped
 * these sources; the validator did not know they existed, so it required a source-file
 * entity for every download URL they carry and reported 17,820 of them missing, plus a
 * download-statement count 18,464 short. Both numbers were correct arithmetic about a rule
 * only one side had been told. check:graph failed on every run for long enough that the
 * failure stopped being read.
 *
 * Neither script can import the other -- build-semantic-graph.mjs runs its build on import
 * -- so the shared rule goes here and both import it.
 */

export const GRAPH_EXCLUDED_SOURCE_ID_PREFIXES = [
  'approved-publication:cso-pxstat-',
  'approved-publication:opendata-ie-',
  'approved-publication:nisra-pub-',
  'approved-publication:opendata-ni-'
];

export const isGraphExcludedSource = (item) =>
  GRAPH_EXCLUDED_SOURCE_ID_PREFIXES.some((prefix) => String(item?.id || '').startsWith(prefix));
