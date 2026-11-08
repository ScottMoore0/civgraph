/**
 * Election map palette: the party colour tables, the map style labels and the colour helpers
 * the election pane and map fill use.
 *
 * Moved out of packages/map/app/election-manager.js (frontend plan section 5.1, seam E2) without
 * changing behaviour. The class methods that read the active election (colourForMode,
 * usesMainRoiPartyPalette, mainPanePartyColour, knownPartyColour, partyColourForResult) became
 * functions that take what they used to read from `this` as arguments: the active bundle and
 * catalogue entry, or the `roi` flag usesMainRoiPartyPalette derives from them.
 * Test2ElectionManager keeps one-line methods that delegate here.
 *
 * Pure: no DOM, no network, no module state.
 */
import {
  isPlaceholderPartyColour,
  isRegistryColourParty,
  normalizeName,
  partyColour as electionPartyColour
} from '../../../core/src/election-domain.mjs';

/** @typedef {import('../../../core/src/election-view-model.mjs').ElectionRecord} ElectionRecord */
/** @typedef {import('../../../core/src/election-view-model.mjs').ElectionResult} ElectionResult */

/** Labels for the map style selector, keyed by mode. */
export const MODE_LABELS = {
  winner: 'Winner',
  leadingParty: 'Leading party',
  voteShare: 'Vote share',
  turnout: 'Turnout',
  majority: 'Majority',
  seats: 'Seats',
  quota: 'Quota'
};

/** The local palette (Northern Ireland and general), keyed by normalised party name. */
export const PARTY_COLOURS = new Map([
  ['alliance', '#f6cb2f'],
  ['aontu', '#44532a'],
  ['conservative', '#0087dc'],
  ['dup', '#d46a4c'],
  ['fianna fail', '#66bb66'],
  ['fine gael', '#6699ff'],
  ['green', '#22ac6f'],
  ['green party', '#22ac6f'],
  ['independent', '#b8b8b8'],
  ['independent ireland', '#3bee56'],
  ['independent unionist', '#aadfff'],
  ['independent labour', '#ff9999'],
  ['independent nationalist', '#cdffab'],
  ['irish labour', '#cc0000'],
  ['labour', '#cc0000'],
  ['nationalist party', '#32cd32'],
  ['northern ireland labour party', '#dc241f'],
  ['pbp', '#ff0090'],
  ['people\'s democracy', '#ff0000'],
  ['republican clubs', '#930c1a'],
  ['republican labour party', '#85de59'],
  ['sdlp', '#2aa82c'],
  ['sinn fein', '#326760'],
  ['social democrats', '#752f8b'],
  ['solidarity pbp', '#8e2420'],
  ['solidarity-pbp', '#8e2420'],
  ['tuv', '#0c3a6a'],
  ['unionist party of northern ireland', '#ffa07a'],
  ['uup', '#48a5ee'],
  ['yes', '#2aa82c'],
  ['no', '#d46a4c']
]);

/** The palette for Republic of Ireland elections (Dail, presidential, referendums, locals). */
export const ROI_MAIN_PARTY_COLOURS = new Map([
  ['fianna fail', '#66BB66'],
  ['fine gael', '#6699FF'],
  ['sinn fein', '#326760'],
  ['labour', '#CC0000'],
  ['irish labour', '#CC0000'],
  ['the labour party', '#CC0000'],
  ['green comhaontas glas', '#22AC6F'],
  ['green party', '#22AC6F'],
  ['green', '#22AC6F'],
  ['social democrats', '#752F8B'],
  ['people before profit solidarity', '#FF0090'],
  ['pbp solidarity', '#FF0090'],
  ['solidarity people before profit', '#8E2420'],
  ['solidarity pbp', '#8E2420'],
  ['people before profit', '#FF0090'],
  ['aontu', '#44532A'],
  ['independent ireland', '#3BEE56'],
  ['progressive democrats', '#1251A2'],
  ['workers party republican clubs', '#930C1A'],
  ['independents 4 change', '#FFC0CB'],
  ['renua', '#FFA500'],
  ['independent', '#DCDCDC'],
  ['non party independent', '#DCDCDC'],
  ['yes', '#43A047'],
  ['no', '#E53935']
]);

/**
 * The local palette's colour for a party, or grey.
 * @param {unknown} value
 */
export function partyColour(value) {
  return PARTY_COLOURS.get(normalizeName(value)) || '#6b7280';
}

/**
 * A colour safe to put in a style attribute (hex or rgb/rgba), otherwise the fallback.
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function safeCssColour(value, fallback = '#6b7280') {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return fallback;
}

/**
 * The five-step amber ramp for numeric modes (turnout, share, majority, seats, quota); grey for
 * a value that is not a number. Same ramp as numericColour in src/election-renderer.mjs.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 */
export function numericColour(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '#9ca3af';
  const t = Math.max(0, Math.min(1, (number - min) / (max - min || 1)));
  if (t < 0.2) return '#fef3c7';
  if (t < 0.4) return '#fde68a';
  if (t < 0.6) return '#f59e0b';
  if (t < 0.8) return '#d97706';
  return '#92400e';
}

/**
 * Whether an election takes the Republic of Ireland palette, judged from the active bundle and
 * its catalogue entry (body, body group, jurisdiction, region, id, key).
 * @param {ElectionRecord | null} [bundle]
 * @param {ElectionRecord | null} [entry]
 */
export function usesMainRoiPartyPalette(bundle = null, entry = null) {
  const values = [
    bundle?.body,
    entry?.body,
    bundle?.bodyGroup,
    entry?.bodyGroup,
    bundle?.jurisdiction,
    entry?.jurisdiction,
    bundle?.region,
    entry?.region,
    bundle?.id,
    entry?.id,
    entry?.key
  ].map((value) => normalizeName(value));
  const joined = values.join(' ');
  if (joined.includes('dail')) return true;
  if (joined.includes('president of ireland')) return true;
  if (joined.includes('referendum ireland')) return true;
  if (joined.includes('european parliament ireland')) return true;
  if (joined.includes('republic of ireland') && joined.includes('european parliament')) return true;
  if (joined.includes('irish local')) return true;
  return false;
}

/**
 * The colour a party has in the route palette (ROI or local), the registry or the local palette; '' if none.
 * @param {unknown} party
 * @param {boolean} [roi]
 */
export function knownPartyColour(party, roi = false) {
  const normalizedParty = normalizeName(party);
  if (!normalizedParty) return '';
  const routePalette = roi ? ROI_MAIN_PARTY_COLOURS : PARTY_COLOURS;
  return routePalette.get(normalizedParty) || electionPartyColour(party, '') || PARTY_COLOURS.get(normalizedParty) || '';
}

/**
 * The colour the election pane shows for a party: a file's explicit colour unless it is a
 * placeholder grey hiding a known colour, then the route palette, the shared registry and the
 * local palette. `roi` is usesMainRoiPartyPalette() for the active election.
 * @param {unknown} party
 * @param {unknown} [explicit]  the file's own colour
 * @param {boolean} [roi]
 */
export function mainPanePartyColour(party, explicit = '', roi = false) {
  const explicitColour = String(explicit || '').trim();
  const normalizedParty = normalizeName(party);
  // The pre-1922 parties always take the shared registry's colour: their files' colours
  // were assigned by an old party code and are wrong (src/election-domain.mjs). A file's
  // placeholder grey never hides a colour the party has.
  if (normalizedParty && isRegistryColourParty(party)) return electionPartyColour(party);
  if (explicitColour && !(isPlaceholderPartyColour(explicitColour) && knownPartyColour(party, roi))) return explicitColour;
  if (!normalizedParty) return explicitColour || '#6b7280';
  const routePalette = roi ? ROI_MAIN_PARTY_COLOURS : PARTY_COLOURS;
  const routeColour = routePalette.get(normalizedParty);
  const sharedColour = electionPartyColour(party, '');
  const localColour = PARTY_COLOURS.get(normalizedParty);
  if (routeColour || sharedColour || localColour) return routeColour || sharedColour || localColour;
  if (roi) {
    return ROI_MAIN_PARTY_COLOURS.get(normalizedParty) || electionPartyColour(party) || partyColour(party) || '#b0bec5';
  }
  return electionPartyColour(party) || partyColour(party) || '#6b7280';
}

/**
 * A party's colour within one result: the colour a candidate of that party carries (an elected
 * one first when options.preferElected, then the leader, the winner, any), through
 * mainPanePartyColour. options.roi is usesMainRoiPartyPalette() for the active election.
 * @param {ElectionResult} [result]
 * @param {unknown} [party]
 * @param {unknown} [explicit]
 * @param {{ preferElected?: boolean, roi?: boolean }} [options]
 */
export function partyColourForResult(result = {}, party = '', explicit = '', options = {}) {
  const normalizedParty = normalizeName(party);
  const candidates = Array.isArray(result?.candidates) ? /** @type {NonNullable<ElectionResult['candidates']>} */ (result.candidates) : [];
  const byParty = candidates.filter((candidate) => normalizeName(candidate.party) === normalizedParty);
  const preferredCandidate = options.preferElected
    ? byParty.find((candidate) => candidate.elected && candidate.colour)
    : null;
  const colourCandidate = preferredCandidate
    || byParty.find((candidate) => candidate.name === result.leadingName && candidate.colour)
    || byParty.find((candidate) => candidate.name === result.winnerName && candidate.colour)
    || byParty.find((candidate) => candidate.colour);
  return mainPanePartyColour(party, colourCandidate?.colour || explicit, Boolean(options.roi));
}

/**
 * The map fill colour for a result in a style mode.
 * @param {string} mode
 * @param {ElectionResult} result
 * @param {boolean} [roi]
 */
export function colourForMode(mode, result, roi = false) {
  if (mode === 'winner') return partyColourForResult(result, result.winnerParty, result.colour, { preferElected: true, roi }) || '#6b7280';
  if (mode === 'leadingParty') return partyColourForResult(result, result.leadingParty, result.leadingColour, { roi }) || '#6b7280';
  if (mode === 'turnout') return numericColour(result.turnoutPct, 35, 80);
  if (mode === 'voteShare') return numericColour(result.leadingPct, 10, 70);
  if (mode === 'majority') return numericColour(result.majorityPct, 0, 45);
  if (mode === 'seats') return numericColour(result.seatsWon ?? result.seatsTotal, 1, 6);
  if (mode === 'quota') return numericColour(result.quota, 1_000, 120_000);
  return '#6b7280';
}
