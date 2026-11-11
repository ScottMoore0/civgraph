/**
 * Party colours and chips in the Elections app, from the packages (served at /pkg/, packages/served.json):
 * the neutral colour from packages/core/src/election-domain.mjs, the chip from the shared UI
 * templates (packages/ui/src/templates/components/index.js). Loaded by the views that draw
 * parties, not by the home page. Pure: tests/unit/elections-app-lib.test.mjs.
 */
import { NEUTRAL_PARTY_COLOUR } from '../../../pkg/core/src/election-domain.mjs';
import { partyChip as chip } from '../../../pkg/ui/src/templates/components/index.js';

export { NEUTRAL_PARTY_COLOUR };

/** A party colour from the records, or the neutral colour. @param {unknown} colour */
export const partyColour = (colour) => (/^#[0-9a-f]{3,8}$/i.test(String(colour || '')) ? String(colour) : NEUTRAL_PARTY_COLOUR);

/**
 * A party chip (the shared .cg-party component) as HTML; a candidacy with no party reads "No
 * party recorded", in the neutral colour.
 * @param {unknown} name
 * @param {unknown} colour
 */
export function partyChip(name, colour) {
  return String(chip(String(name || 'No party recorded'), partyColour(colour)));
}
