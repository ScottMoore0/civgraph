/**
 * The catalogue pane's document (data/catalogue/catalogue.json, scripts/build/catalogue/build-catalogue.mjs)
 * in the two halves /maps/ reads: the core it draws from on first load, and the contest index
 * that only search reads (constituency names to the elections they were contested in).
 *
 *   /_api/catalogue?view=pane-core   the document without contestIndex
 *   /_api/catalogue?view=contests    { schemaVersion, contestIndex }
 *
 * ?view=pane keeps answering the whole document. The halves are written as the build writes the
 * whole (JSON.stringify(doc) + "\n"), so the core is the whole's text with one key left out, in
 * the same key order. Pure: the records load (packages/loader/src/ingest-maps.mjs) and the
 * tests call it.
 */

/** The document names the halves are stored under (document_parts), beside 'catalogue/catalogue.json'. */
export const PANE_CORE_DOCUMENT = 'catalogue/catalogue-core.json';
export const PANE_CONTESTS_DOCUMENT = 'catalogue/contests.json';

/**
 * The pane document's text split into its core and its contest index, each as document text.
 * @param {string} text  the whole pane document, as built
 * @returns {{ core: string, contests: string }}
 */
export function splitCataloguePane(text) {
  const doc = /** @type {Record<string, unknown>} */ (JSON.parse(text));
  const { contestIndex, ...core } = doc;
  const contests = { schemaVersion: doc['schemaVersion'] ?? 1, contestIndex: contestIndex ?? {} };
  return { core: `${JSON.stringify(core)}\n`, contests: `${JSON.stringify(contests)}\n` };
}
