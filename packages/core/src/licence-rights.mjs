/**
 * Which licence a catalogue text names, and the licence of an image drawn from several maps.
 *
 * The catalogue (data/database/maps.json) spells a licence several ways ("CC-BY-4.0", "CC BY 4.0",
 * "OGL v3.0", "Open Government Licence v3.0", "CC-BY-SA-4.0"); licenceRights reads any of them as
 * the source ledger's rights value. The Browse map page (scripts/lib/map-licence.mjs) and the map
 * image export (packages/map/app/map-image-export.js) both read licences through here. Pure.
 */

/**
 * The licences a text names, as source-ledger rights values, each found by its usual spellings.
 * Order matters only for reading: CC BY-SA is tested before CC BY so that it is not also CC BY.
 * @type {[string, RegExp][]}
 */
const RIGHTS_PATTERNS = [
  ['CC-BY-SA', /\bcc by sa\b|attribution share alike/],
  ['CC-BY-4.0', /\bcc by\b(?! (sa|nc|nd)\b)|creative commons attribution\b(?! (share|non))/],
  ['OGL-3.0', /\bogl\b|open government licen[cs]e/],
  ['OPL-3.0', /open parliament licen[cs]e/],
  ['CC0', /\bcc0\b|\bcc zero\b/],
  ['ODbL', /\bodbl\b|open database licen[cs]e/],
];

/** @param {string} text */
function fold(text) {
  return text.toLowerCase().replace(/[\s-]+/g, ' ').trim();
}

/**
 * The source-ledger rights value of the one licence a text names, or null when it names none or
 * more than one ("OGL and CC BY 4.0").
 * @param {string} text
 * @returns {string | null}
 */
export function licenceRights(text) {
  const folded = fold(text);
  const found = RIGHTS_PATTERNS.filter(([, pattern]) => pattern.test(folded)).map(([rights]) => rights);
  return found.length === 1 ? /** @type {string} */ (found[0]) : null;
}

/** The Licence page, which a reader is sent to when an image's licence cannot be worked out. */
export const LICENCE_PAGE_URL = 'https://civgraph.net/pages/licence';

/** The licences an exported image can carry. */
export const IMAGE_LICENCES = Object.freeze({
  'CC-BY-SA': { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
});

/**
 * The licence of an image drawn from some maps, worked out from the licences of the maps shown
 * (citations review S26, owner-approved 24 Nov 2026), rather than CC BY-SA 4.0 whatever was drawn:
 *   - a map under CC BY-SA 4.0 makes the image CC BY-SA 4.0 (ShareAlike);
 *   - otherwise, when every map names a licence that permits it (CC BY 4.0, the Open Government
 *     Licence, the Open Parliament Licence, CC0, or ODbL data drawn as an image), CC BY 4.0;
 *   - otherwise (a map with no recorded licence, or one that names two), no licence is claimed:
 *     the image points at the Licence page and carries the maps' credits.
 * @param {readonly (string | null | undefined)[]} licences  the recorded licence text of each map shown
 * @returns {{ rights: string, name: string, url: string } | null}  null: see the Licence page
 */
export function imageLicence(licences) {
  if (!licences.length) return null;
  const rights = licences.map((text) => (typeof text === 'string' && text.trim() ? licenceRights(text) : null));
  if (rights.includes('CC-BY-SA')) return { rights: 'CC-BY-SA', ...IMAGE_LICENCES['CC-BY-SA'] };
  if (rights.some((r) => r === null)) return null;
  return { rights: 'CC-BY-4.0', ...IMAGE_LICENCES['CC-BY-4.0'] };
}
