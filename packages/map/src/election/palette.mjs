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
import partyPalettes from '../../../registries/src/browser/party-palettes.mjs';
import { MAP_COLOURS, NUMERIC_SCALE } from '../colours.mjs';

/** @typedef {import('../../../core/src/election-view-model.mjs').ElectionRecord} ElectionRecord */
/** @typedef {import('../../../core/src/election-view-model.mjs').ElectionResult} ElectionResult */

/** Labels for the map style selector, keyed by mode. */
/** @type {Record<string, string>} */
export const MODE_LABELS = {
  winner: 'Winner',
  leadingParty: 'Leading party',
  voteShare: 'Vote share',
  turnout: 'Turnout',
  majority: 'Majority',
  seats: 'Seats',
  quota: 'Quota'
};

/**
 * The local palette (Northern Ireland and general), keyed by normalised party name: the parties
 * registry's (data/registries/parties/palettes.json `mapLocal`, through registries/browser/party-palettes.json).
 */
export const PARTY_COLOURS = new Map(/** @type {Array<[string, string]>} */ (partyPalettes.mapLocal));

/**
 * The palette for Republic of Ireland elections (Dail, presidential, referendums, locals): the
 * parties registry's `mapRoi` (data/registries/parties/palettes.json).
 */
export const ROI_MAIN_PARTY_COLOURS = new Map(/** @type {Array<[string, string]>} */ (partyPalettes.mapRoi));

/**
 * The local palette's colour for a party, or grey.
 * @param {unknown} value
 */
export function partyColour(value) {
  return PARTY_COLOURS.get(normalizeName(value)) || MAP_COLOURS.partyGrey;
}

/**
 * A colour safe to put in a style attribute (hex or rgb/rgba), otherwise the fallback.
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function safeCssColour(value, fallback = MAP_COLOURS.partyGrey) {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return fallback;
}

/**
 * The five-step amber ramp for numeric modes (turnout, share, majority, seats, quota); grey for
 * a value that is not a number. Same ramp as numericColour in packages/map/src/election-renderer.mjs.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 */
export function numericColour(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MAP_COLOURS.noFigure;
  const t = Math.max(0, Math.min(1, (number - min) / (max - min || 1)));
  if (t < 0.2) return NUMERIC_SCALE[0];
  if (t < 0.4) return NUMERIC_SCALE[1];
  if (t < 0.6) return NUMERIC_SCALE[2];
  if (t < 0.8) return NUMERIC_SCALE[3];
  return NUMERIC_SCALE[4];
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
  // were assigned by an old party code and are wrong (packages/core/src/election-domain.mjs). A file's
  // placeholder grey never hides a colour the party has.
  if (normalizedParty && isRegistryColourParty(party)) return electionPartyColour(party);
  if (explicitColour && !(isPlaceholderPartyColour(explicitColour) && knownPartyColour(party, roi))) return explicitColour;
  if (!normalizedParty) return explicitColour || MAP_COLOURS.partyGrey;
  const routePalette = roi ? ROI_MAIN_PARTY_COLOURS : PARTY_COLOURS;
  const routeColour = routePalette.get(normalizedParty);
  const sharedColour = electionPartyColour(party, '');
  const localColour = PARTY_COLOURS.get(normalizedParty);
  // One of the three is set (tested): the first that is, a string.
  if (routeColour || sharedColour || localColour) return /** @type {string} */ (routeColour || sharedColour || localColour);
  if (roi) {
    return ROI_MAIN_PARTY_COLOURS.get(normalizedParty) || electionPartyColour(party) || partyColour(party) || MAP_COLOURS.noResult;
  }
  return electionPartyColour(party) || partyColour(party) || MAP_COLOURS.partyGrey;
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
  if (mode === 'winner') return partyColourForResult(result, result.winnerParty, result.colour, { preferElected: true, roi }) || MAP_COLOURS.partyGrey;
  if (mode === 'leadingParty') return partyColourForResult(result, result.leadingParty, result.leadingColour, { roi }) || MAP_COLOURS.partyGrey;
  if (mode === 'turnout') return numericColour(result.turnoutPct, 35, 80);
  if (mode === 'voteShare') return numericColour(result.leadingPct, 10, 70);
  if (mode === 'majority') return numericColour(result.majorityPct, 0, 45);
  if (mode === 'seats') return numericColour(result.seatsWon ?? result.seatsTotal, 1, 6);
  if (mode === 'quota') return numericColour(result.quota, 1_000, 120_000);
  return MAP_COLOURS.partyGrey;
}
