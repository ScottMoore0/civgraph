/**
 * A map's licence, attribution statement and source credits, as the Browse map page shows them.
 *
 * The catalogue (data/database/maps.json) spells a licence several ways ("CC-BY-4.0",
 * "CC BY 4.0", "OGL v3.0", "Open Government Licence v3.0", "CC-BY-SA-4.0") under two keys
 * (`licence`, `license`), with its link under `licenceUrl` or `licenseUrl` and a note under
 * `licenceNote` or `licenseNote`. buildMaps() in scripts/build/build-browse-indexes.mjs used to
 * drop all of them, with `attribution` and `sourceCredits`; this reads them into one shape:
 *
 *   licence        { name, url?, page }  the licence by its usual name, its own terms page,
 *                  and the section of Civgraph's Licence page (/pages/licence) for it
 *   licenceNote    the catalogue's note on how the licence applies
 *   attribution    the statement the licence asks a reuser to give
 *   sourceCredits  the bodies and people the map's sources come from
 *
 * The Licence page's sections are the source ledger's rights values (build-licence-page.mjs
 * RIGHTS), with ids "rights-<value in lower case>".
 */
import { licenceRights } from '@civgraph/core/licence-rights.mjs';
import { RIGHTS } from '../build/build-licence-page.mjs';

// Which licence a text names is the core package's (also read by the map image export).
export { licenceRights };

/** The Licence page. */
export const LICENCE_PAGE = '/pages/licence';

/**
 * The usual name of a licence written in one of its common spellings, keyed by the spelling in
 * lower case with hyphens and spaces folded to one space.
 */
const NAMES = new Map([
  ['cc by 4.0', 'CC BY 4.0'],
  ['cc by', 'CC BY 4.0'],
  ['creative commons attribution 4.0', 'CC BY 4.0'],
  ['cc by sa 4.0', 'CC BY-SA 4.0'],
  ['creative commons attribution share alike 4.0', 'CC BY-SA 4.0'],
  ['ogl', 'Open Government Licence v3.0'],
  ['ogl v3.0', 'Open Government Licence v3.0'],
  ['ogl 3.0', 'Open Government Licence v3.0'],
  ['open government licence v3.0', 'Open Government Licence v3.0'],
  ['uk open government licence (ogl)', 'Open Government Licence v3.0'],
  ['cc0', 'CC0 1.0'],
  ['cc0 1.0', 'CC0 1.0'],
  ['odbl', 'Open Database Licence (ODbL)'],
  ['odbl 1.0', 'Open Database Licence (ODbL)'],
]);

/** @param {string} text */
function fold(text) {
  return text.toLowerCase().replace(/[\s-]+/g, ' ').trim();
}

/** @param {unknown} value @returns {string} */
function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * A licence as Browse shows it.
 * @param {unknown} raw  the catalogue's licence text
 * @param {unknown} [url]  the catalogue's link to the licence terms
 * @returns {{ name: string, url?: string, page: string } | null}
 */
export function licenceDisplay(raw, url) {
  const text = clean(raw);
  if (!text) return null;
  const rights = licenceRights(text);
  const terms = clean(url) || (rights && /** @type {Record<string, { url?: string }>} */ (RIGHTS)[rights]?.url) || '';
  return {
    name: NAMES.get(fold(text)) || text,
    ...(/^https?:\/\//.test(terms) ? { url: terms } : {}),
    page: rights ? `${LICENCE_PAGE}#rights-${rights.toLowerCase()}` : `${LICENCE_PAGE}#sources`,
  };
}

/**
 * @typedef {{
 *   licence?: unknown, license?: unknown, licenceUrl?: unknown, licenseUrl?: unknown,
 *   licenceNote?: unknown, licenseNote?: unknown, attribution?: unknown, sourceCredits?: unknown
 * }} MapRightsFields
 */

/**
 * The licence, attribution and source credits of one catalogue map, each null or empty when the
 * map records none.
 * @param {MapRightsFields} map
 * @returns {{ licence: { name: string, url?: string, page: string } | null, licenceNote: string | null, attribution: string | null, sourceCredits: string[] }}
 */
export function mapRights(map) {
  const credits = Array.isArray(map.sourceCredits) ? map.sourceCredits : [map.sourceCredits];
  return {
    licence: licenceDisplay(map.licence ?? map.license, map.licenceUrl ?? map.licenseUrl),
    licenceNote: clean(map.licenceNote ?? map.licenseNote) || null,
    attribution: clean(map.attribution) || null,
    sourceCredits: [...new Set(credits.map(clean).filter(Boolean))],
  };
}
