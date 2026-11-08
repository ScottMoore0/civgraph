/**
 * Party abbreviations for results tables: the table shows the abbreviation, and the full
 * name appears on hover (<abbr title>).
 *
 * The election data spells parties many ways -- "DUP" beside "Sinn Féin", "Alliance" beside
 * "Alliance Party", "Fianna Fail" beside "Fianna Fáil", ballot-paper "... Lozenge" artefacts,
 * "Independent (Alan Chambers)" -- so every spelling found in
 * data/elections-source/data/elections is listed against one abbreviation and one full name.
 * A party with no entry is shown as it is spelled in the data.
 */
import parties from '../../../registries/browser/parties.mjs';

// [abbreviation, full name, ...other spellings in the data]: the parties registry's abbreviations
// (data/registries/parties.json; the slice in registries/browser/parties.json).
const PARTIES = parties.abbreviations;

/**
 * Labels that turn up in the party column but are not parties. "Non-transferable" is STV
 * count bookkeeping -- 2,928 rows of it in the source data -- and it is already dropped
 * before the built summaries, so nothing downstream treats it as a party. It is named here
 * so an audit of unabbreviated parties stops offering it and nobody gives it an
 * abbreviation by mistake. The parties registry lists it (notParties).
 */
const NOT_PARTIES = parties.notParties;

function key(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+lozenge$/i, '')
    .replace(/&/g, ' and ')
    .replace(/[.'’`]/g, '')
    .replace(/[–—\-_/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const BY_KEY = new Map();
for (const [abbreviation, fullName, ...spellings] of PARTIES) {
  for (const spelling of [abbreviation, fullName, ...spellings]) {
    const k = key(spelling);
    if (k && !BY_KEY.has(k)) BY_KEY.set(k, { abbreviation, fullName });
  }
}

const NOT_PARTY_KEYS = new Set(NOT_PARTIES.map(key));

/** True for a label that is not a party at all, so callers can leave it out of party lists. */
export function isNonParty(value) {
  return NOT_PARTY_KEYS.has(key(value));
}

/** {abbreviation, fullName} for a party as spelled in the data, or null if unlisted. */
export function partyInfo(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const direct = BY_KEY.get(key(text));
  if (direct) return direct;
  // "Independent (Alan Chambers)", "Nationalist Party (Northern Ireland)"
  const withoutQualifier = key(text.replace(/\s*\([^)]*\)\s*$/, ''));
  return BY_KEY.get(withoutQualifier) || null;
}

export function partyAbbreviation(value) {
  return partyInfo(value)?.abbreviation || String(value ?? '').trim();
}

export function partyFullName(value) {
  return partyInfo(value)?.fullName || String(value ?? '').trim();
}

/**
 * The party label as the source printed it ("HR (P)", "Rep Clubs"), when it says something the
 * party shown does not: not the party itself, its abbreviation or full name, or the ballot
 * description already shown. Empty otherwise. Printed labels are shown as printed.
 */
export function partyAsPrintedLabel(candidate) {
  const printed = String(candidate?.partyAsPrinted || '').trim();
  const party = String(candidate?.party || '').trim();
  if (!printed || printed === party || printed === String(candidate?.ballotDescription || '').trim()) return '';
  if (party && (printed === partyAbbreviation(party) || printed === partyFullName(party))) return '';
  return printed;
}

/**
 * HTML for a party name in a table cell: the abbreviation, with the full name on hover.
 * `escape` is the caller's HTML escaper.
 */
export function partyLabelHtml(value, escape) {
  const text = String(value ?? '').trim();
  const info = partyInfo(text);
  if (!info || info.abbreviation === info.fullName) return escape(text);
  return `<abbr class="party-abbr" title="${escape(info.fullName)}">${escape(info.abbreviation)}</abbr>`;
}
