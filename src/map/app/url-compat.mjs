/**
 * URL compatibility: old share links keep working. Renamed layer ids are rewritten to their
 * current ids, and election keys whose polling date or body was corrected are rewritten in
 * the URL parameters before the state is restored.
 *
 * Moved out of app/src/app.js (frontend plan section 5.2, seam A2) without changing
 * behaviour. The DOM and history parts of the URL state (pushURLState, updateURLState,
 * restoreURLState) stay in Test2App.
 *
 * Pure: no DOM, no module state. renameElectionDatesInParams edits the URLSearchParams it is
 * given, as before.
 */
import { legacyLayerId, renameLayerId } from '../../../scripts/lib/layer-renames.mjs';

/**
 * Layer ids that have been renamed, mapped old -> new.
 *
 * A layer id is not private. It appears in `#layers=` share links, so renaming one
 * breaks every link anyone has posted, bookmarked or cited -- silently, as an empty map
 * rather than an error. This is the cost that makes id renames worth avoiding, and the
 * reason to accept a slightly wrong id is usually stronger than it looks.
 *
 * `roi-local-authorities-*` was renamed to `local-authorities-*` on 2026-08-22. The
 * prefix was wrong for four of the 26 layers outright -- 1915 and the three 1920 dates
 * cover the whole island, before partition -- and anachronistic for a dozen more, since
 * there was no republic before 1949. The fix was not a better jurisdiction prefix but
 * none at all: the display name carries the scope, and encoding a jurisdiction that
 * changes over the life of a series is what went wrong in the first place.
 *
 * Kept as a prefix rewrite rather than 26 entries so the table cannot fall out of step
 * with the rename.
 */
export const LEGACY_LAYER_ID_PREFIXES = [
  ['roi-local-authorities-', 'local-authorities-'],
  // NI editions re-dated to the census date on 2026-11-01 (the id carries the date): Newtownards RD
  // was renamed North Down RD on 1 Aug 1954, not 1 Apr (Census 1961); Londonderry's wards were
  // reduced on 15 May 1938, not 16 May (Census 1951). The 1939 edition became a layer of its own
  // (Ballymena made a borough), and the 1957 "CED" edition was the county map counties-ireland-1957.
  ['admin-areas-1954-04-01', 'admin-areas-1954-08-01'],
  ['ded-1954-04-01', 'ded-1954-08-01'],
  ['county-ed-1954-04-01', 'county-ed-1954-08-01'],
  ['admin-areas-1938-05-16', 'admin-areas-1938-05-15'],
  ['ded-1938-05-16', 'ded-1938-05-15'],
  ['county-ed-1938-05-16', 'county-ed-1938-05-15'],
  ['admin-areas-1939-05-23-alias-test', 'admin-areas-1939-05-23-vector-test'],
  ['county-ed-1957-04-01-vector-test', 'counties-ireland-1957-vector-test']
];

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
