/**
 * URL compatibility: old share links keep working. Renamed layer ids are rewritten to their
 * current ids, and election keys whose polling date or body was corrected are rewritten in
 * the URL parameters before the state is restored.
 *
 * Moved out of packages/map/app/app.js (frontend plan section 5.2, seam A2) without changing
 * behaviour. The DOM and history parts of the URL state (pushURLState, updateURLState,
 * restoreURLState) stay in Test2App.
 *
 * Pure: no DOM, no module state. renameElectionDatesInParams edits the URLSearchParams it is
 * given, as before.
 */
import { LEGACY_LAYER_ID_PREFIXES, legacyLayerId, renameLayerId } from '../../../core/src/layer-renames.mjs';

// LEGACY_LAYER_ID_PREFIXES lives in packages/core/src/layer-renames.mjs (PKG-1: the records loader reads it too).
export { LEGACY_LAYER_ID_PREFIXES };

// Elections whose polling date was corrected, which changed their keys: old links keep working.
// [body slug, old date, new date]
export const RENAMED_ELECTION_DATES = [
  ['house-of-commons-of-the-united-kingdom', '1968-04-17', '1969-04-17'], // Mid Ulster by-election (Devlin)
  ['house-of-commons-of-the-united-kingdom', '2011-06-06', '2011-06-09'], // Belfast West by-election
  ['northern-ireland-assembly', '1983-04-27', '1983-04-20'] // Armagh by-election
];

// Elections filed under another body, which changed their keys: old links keep working.
// [old body slug, new body slug, new body name, date]. Bangor's and Lisburn's 1920 rounds moved
// from their urban district slugs to the one body each that holds their later rounds (2026-11).
export const RENAMED_ELECTION_BODIES = [
  ['bangor-urban-district-council', 'bangor-borough-council', 'Bangor Borough Council', '1920-01-15'],
  ['lisburn-urban-district-council', 'lisburn-borough-council', 'Lisburn Borough Council', '1920-01-15']
];

export function renameElectionDatesInParams(params) {
  for (const [name, value] of [...params.entries()]) {
    let next = value;
    for (const [body, from, to] of RENAMED_ELECTION_DATES) {
      next = next.split(`${body}__${from}`).join(`${body}__${to}`).split(`${body}:${from}`).join(`${body}:${to}`);
      if (name === 'electionDate' && next === from && slugifyBody(params.get('electionBody')) === body) next = to;
    }
    for (const [from, to, toName, date] of RENAMED_ELECTION_BODIES) {
      next = next.split(`${from}__${date}`).join(`${to}__${date}`).split(`${from}:${date}`).join(`${to}:${date}`)
        .split(`election-${from}-${date}`).join(`election-${to}-${date}`);
      if (name === 'electionBody' && slugifyBody(next) === from && params.get('electionDate') === date) next = toName;
    }
    if (next !== value) params.set(name, next);
  }
  return params;
}

/** An election body name as its key slug ("Bangor Urban District Council" -> "bangor-urban-district-council"). */
export function slugifyBody(value) {
  return String(value || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');
}

/**
 * The current id for a layer id from a link. Renamed prefixes are rewritten first. Then, when
 * `isKnown` is given (a test against the loaded layer index) and the id is not a layer, the
 * other spelling of its suffix is tried (site-restructure renames.csv: `-vector-test` and
 * `-vector`, `-raster-test` and `-raster`, `-alias-test` and `-alias`), so a link written with
 * either spelling opens the layer before and after the ids are renamed. Without `isKnown` only
 * the prefixes apply, as before.
 */
function rewritePrefix(value) {
  for (const [from, to] of LEGACY_LAYER_ID_PREFIXES) {
    if (value.startsWith(from)) return `${to}${value.slice(from.length)}`;
  }
  return value;
}

/**
 * @param {unknown} id
 * @param {((id: string) => boolean) | null} [isKnown]
 */
export function resolveLegacyLayerId(id, isKnown = null) {
  const original = String(id || '');
  if (!original) return original;
  const value = rewritePrefix(original);
  if (typeof isKnown === 'function' && !isKnown(value)) {
    const others = [renameLayerId(value), legacyLayerId(value), rewritePrefix(renameLayerId(original)), rewritePrefix(legacyLayerId(original))];
    for (const other of others) {
      if (other !== value && isKnown(other)) return other;
    }
  }
  return value;
}
