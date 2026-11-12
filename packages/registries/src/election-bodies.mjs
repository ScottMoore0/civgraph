/**
 * The election-bodies registry (data/registries/election-bodies.json): what the site needs to know
 * about a body it files elections under, so that a new body is added as data rather than in each
 * builder and view. Pure: the views take the loaded value, so the browser slice
 * (packages/registries/src/browser/election-bodies.json) is computed by the same functions.
 */

/** @typedef {import('../../types/index.js').ElectionBodiesRegistry} ElectionBodiesRegistry */
/** @typedef {ElectionBodiesRegistry['bodies'][number]} ElectionBody */
/** @typedef {NonNullable<ElectionBody['geography']>[number]} ElectionBodyGeographyRule */
/** @typedef {NonNullable<ElectionBody['areaResults']>} ElectionBodyAreaResults */

/**
 * The body with this slug, or null.
 * @param {ElectionBodiesRegistry} registry
 * @param {unknown} id
 * @returns {ElectionBody | null}
 */
export function electionBody(registry, id) {
  return registry.bodies.find((body) => body.id === String(id ?? '')) || null;
}

/**
 * The geography rule an election of the body is drawn by: the latest whose `from` is on or before
 * its date. null when the body states no geography (the code's own rules then apply) or the
 * election is older than its first rule.
 * @param {ElectionBody | null | undefined} body
 * @param {unknown} date  the election's date (a referendum's carries a suffix; the first ten characters count)
 * @returns {ElectionBodyGeographyRule | null}
 */
export function geographyRuleFor(body, date) {
  const day = String(date ?? '').slice(0, 10);
  const rules = [...(body?.geography || [])].sort((a, b) => b.from.localeCompare(a.from));
  return rules.find((rule) => day >= rule.from) || null;
}

/**
 * A title template with {year} filled in.
 * @param {string | undefined} template
 * @param {unknown} date
 * @returns {string | null}
 */
export function fillYear(template, date) {
  if (!template) return null;
  const year = String(date ?? '').slice(0, 4);
  return /^\d{4}$/.test(year) ? template.replace(/\{year\}/g, year) : null;
}

/**
 * Errors the schema cannot state: a repeated id, two geography rules from one date.
 * @param {ElectionBodiesRegistry} registry
 * @returns {string[]}
 */
export function checkElectionBodies(registry) {
  /** @type {string[]} */
  const errors = [];
  const seen = new Set();
  for (const body of registry.bodies) {
    if (seen.has(body.id)) errors.push(`bodies: ${body.id} is listed twice`);
    seen.add(body.id);
    const froms = (body.geography || []).map((rule) => rule.from);
    if (new Set(froms).size !== froms.length) errors.push(`${body.id}: two geography rules start on one date`);
  }
  return errors;
}

/**
 * The browser's slice: the facts the catalogue and the map app read, by body id.
 * @param {ElectionBodiesRegistry} registry
 */
export function browserElectionBodies(registry) {
  return Object.fromEntries(registry.bodies.map((body) => [body.id, Object.fromEntries(Object.entries({
    name: body.name,
    jurisdiction: body.jurisdiction,
    typeLabel: body.typeLabel,
    shortLabel: body.shortLabel,
    shelf: body.shelf,
    searchTerms: body.searchTerms,
  }).filter(([, value]) => value !== undefined))]));
}

/** How the site names each jurisdiction where it says where an election was held. */
export const JURISDICTION_LABELS = Object.freeze({ ireland: 'Republic of Ireland', 'northern-ireland': 'Northern Ireland', island: 'Ireland' });

/**
 * Where a body's elections were held, as the catalogue and Browse say it, or null.
 * @param {ElectionBody | null | undefined} body
 * @returns {string | null}
 */
export function jurisdictionLabel(body) {
  return body ? JURISDICTION_LABELS[body.jurisdiction] || null : null;
}
