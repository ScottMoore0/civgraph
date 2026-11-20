/**
 * Grouped election entries: one catalogue entry that opens several elections together on one map,
 * each election keeping its own results (no merged figures). The European Parliament elections in
 * the Republic and in Northern Ireland of one year, and the three 2019 mayoral plebiscites (Phelim
 * Birch's comments of 22 Oct and 17 Nov 2026; owner decision 3a of 19 Nov 2026).
 *
 * The entries are data: data/registries/election-bodies.json groups.groupedElections (members are
 * existing election keys, each with the label its tab and legend section show; a title; an optional
 * badge and description), read here through the registry's browser slice. The members keep their
 * records, Browse pages, API answers and addresses; the catalogue's list and the map's timeline
 * show the entry in their place. Opening an entry is packages/map/src/election/election-group-methods.js;
 * the catalogue's row is built by scripts/build/catalogue/build-catalogue.mjs with catalogueGroupRow.
 *
 * Pure: no DOM, no network. Used by the build (Node), the catalogue and the map's election manager.
 */
import electionGroupSlice from '../../registries/src/browser/election-groups.mjs';

/**
 * A member of an entry: an election's key and what its tab and legend section are called.
 * @typedef {{ election: string, label: string }} ElectionGroupMember
 */
/**
 * An entry as the registry describes it.
 * @typedef {{
 *   id: string,
 *   title: string,
 *   shortLabel?: string,
 *   members: ElectionGroupMember[],
 *   about?: { text: string[], links?: { label: string, url: string }[] }
 * }} ElectionGroup
 */
/**
 * An election as these functions read it: the map's manifest entry or the catalogue's row.
 * @typedef {{ key: string, body?: string, bodySlug?: string, date?: string, [field: string]: unknown }} GroupableElection
 */
/**
 * The entry as the map's election catalogue holds it, beside the elections (addElectionGroups).
 * Opened by its body and date like any election: the body is ELECTION_GROUP_BODY, the date its id.
 * @typedef {{
 *   key: string, body: string, bodySlug: string, date: string, sortDate: string, year: number | null,
 *   electionGroup: true, memberKeys: string[], memberLabels: string[],
 *   displayTitle: string, displayProvider: string, displaySubtitle: string,
 *   kind: string, isByElection: false, contestType: string,
 *   loadable: true, resultsOnly: false, placeholder: false, sourceMapId: null, stylingModes: string[]
 * }} ElectionGroupEntry
 */
/**
 * A member as the catalogue's row lists it: its key, label and title (for its results page link).
 * @typedef {{ key: string, label: string, title: string, date: string }} CatalogueGroupMember
 */
/** @typedef {{ text?: string[], links?: { label: string, url: string }[] }} GroupAbout */
/**
 * What the catalogue build reads of an election's row.
 * @typedef {{ key: string, title: string, body: string, bodySlug: string, date: string, scope?: string, thumb?: string, about?: GroupAbout }} GroupMemberRow
 */

/** The body an entry is opened under (with its id as the date): `electionBody=Group&electionDate=<id>`. */
export const ELECTION_GROUP_BODY = 'Group';

/** Every entry the registry describes. */
export const ELECTION_GROUPS = /** @type {ElectionGroup[]} */ (/** @type {{ groupedElections?: ElectionGroup[] }} */ (electionGroupSlice).groupedElections || []);

/**
 * The entry each member election belongs to, by its key.
 * @param {readonly ElectionGroup[]} [groups]
 * @returns {Map<string, ElectionGroup>}
 */
export function groupsByMember(groups = ELECTION_GROUPS) {
  /** @type {Map<string, ElectionGroup>} */
  const out = new Map();
  for (const group of groups) for (const member of group.members) if (!out.has(member.election)) out.set(member.election, group);
  return out;
}

/**
 * An election's day (YYYY-MM-DD) from its date, which for a referendum carries a suffix
 * ("2019-05-24-directly-elected-mayor-cork-city"); '' when it has none.
 * @param {unknown} date
 */
export function electionDay(date) {
  return /^(\d{4}-\d{2}-\d{2})/.exec(String(date ?? ''))?.[1] || '';
}

/** The body of an election's key (dail-eireann__2024-11-29 -> dail-eireann). @param {unknown} key */
export const keyBody = (key) => String(key ?? '').split('__')[0] || '';

/** The canonical layer id an entry's address carries (`layers=election-group-<id>`). @param {string} id */
export const groupCanonicalLayerId = (id) => `election-group-${id}`;

/**
 * What a catalogue row opens: an entry by its group body and id, an election by its body and date.
 * @param {{ key: string, body: string, date: string, members?: unknown[] }} row
 * @returns {{ body: string, date: string }}
 */
export function electionLoadIdentity(row) {
  return Array.isArray(row.members) && row.members.length ? { body: ELECTION_GROUP_BODY, date: row.key } : { body: row.body, date: row.date };
}

/**
 * The entry for the map's election catalogue, from the members it holds; null when it holds none.
 * A member the catalogue does not have is left out.
 * @param {ElectionGroup} group
 * @param {ReadonlyMap<string, GroupableElection>} byKey
 * @returns {ElectionGroupEntry | null}
 */
export function buildElectionGroupEntry(group, byKey) {
  const members = group.members.filter((member) => byKey.has(member.election));
  if (!members.length) return null;
  const days = members.map((member) => electionDay(byKey.get(member.election)?.date)).filter(Boolean).sort();
  const first = days[0] || '';
  return {
    key: group.id,
    body: ELECTION_GROUP_BODY,
    bodySlug: 'group',
    date: group.id,
    sortDate: first,
    year: Number(first.slice(0, 4)) || null,
    electionGroup: true,
    memberKeys: members.map((member) => member.election),
    memberLabels: members.map((member) => member.label),
    displayTitle: group.title,
    displayProvider: group.title,
    displaySubtitle: members.map((member) => member.label).join(' · '),
    kind: 'general',
    isByElection: false,
    contestType: 'election',
    loadable: true,
    resultsOnly: false,
    placeholder: false,
    sourceMapId: null,
    stylingModes: []
  };
}

/**
 * Add the grouped entries to the map's election catalogue, once (a list that has them is left
 * alone). The members stay in it, so their own addresses and links still open them alone.
 * @param {{ elections?: GroupableElection[] } | null | undefined} catalogue
 * @param {readonly ElectionGroup[]} [groups]
 */
export function addElectionGroups(catalogue, groups = ELECTION_GROUPS) {
  const elections = catalogue?.elections;
  if (!Array.isArray(elections) || elections.some((entry) => entry['electionGroup'])) return;
  const byKey = new Map(elections.map((entry) => [entry.key, entry]));
  for (const group of groups) {
    const entry = buildElectionGroupEntry(group, byKey);
    if (entry) elections.push(entry);
  }
}

/**
 * The elections a list shows: an entry in place of its members.
 * @template {GroupableElection} E
 * @param {E[]} elections
 * @param {readonly ElectionGroup[]} [groups]
 * @returns {E[]}
 */
export function withoutGroupMembers(elections, groups = ELECTION_GROUPS) {
  const members = groupsByMember(groups);
  return elections.filter((entry) => !members.has(entry.key));
}

/**
 * The bodies an election or an entry stands for: an entry's are its members'.
 * @param {GroupableElection & { memberKeys?: unknown }} entry
 * @returns {string[]}
 */
export function entryBodies(entry) {
  return Array.isArray(entry.memberKeys) ? entry.memberKeys.map(keyBody) : [keyBody(entry.key)];
}

/**
 * Whether `entry` is a stop on the timeline of the open `active` entry or election, where an entry
 * is open or might be one (the caller decides the other cases): the stops share a body, and an
 * election an entry stands for is a stop only when it is the one open (opened alone by its address).
 * @param {GroupableElection & { electionGroup?: unknown, memberKeys?: unknown }} entry
 * @param {GroupableElection & { electionGroup?: unknown, memberKeys?: unknown }} active
 * @param {ReadonlySet<string> | ReadonlyMap<string, unknown>} memberKeys every grouped election's key
 */
export function inGroupTimelineSeries(entry, active, memberKeys) {
  if (!entry.electionGroup && memberKeys.has(entry.key) && entry.key !== active.key) return false;
  const bodies = entryBodies(active);
  return entryBodies(entry).some((body) => bodies.includes(body));
}

/**
 * One fill (or line, or opacity) expression for a layer several members are drawn on: their
 * `match` pairs together, the first member's pair winning a label two members name. A member with
 * no match (nothing of it on the layer) adds nothing.
 * @param {unknown[]} expressions each a ['match', input, ...label, value, fallback] or a plain value
 * @param {unknown} [fallback] what the layer shows where no member has a result: by default the
 *   first expression's own (every member's is the same where the layer is the same)
 * @returns {unknown}
 */
export function mergeMatchExpressions(expressions, fallback = fallbackOf(expressions[0])) {
  /** @type {unknown} */
  let input = null;
  /** @type {unknown[]} */
  const pairs = [];
  const seen = new Set();
  for (const expression of expressions) {
    if (!Array.isArray(expression) || expression[0] !== 'match' || expression.length < 5) continue;
    input ??= expression[1];
    for (let i = 2; i < expression.length - 1; i += 2) {
      const label = JSON.stringify(expression[i]);
      if (seen.has(label)) continue;
      seen.add(label);
      pairs.push(expression[i], expression[i + 1]);
    }
  }
  return pairs.length ? ['match', input, ...pairs, fallback] : fallback;
}

/** A match expression's fallback, or a plain value itself. @param {unknown} expression */
function fallbackOf(expression) {
  return Array.isArray(expression) && expression[0] === 'match' ? expression[expression.length - 1] : expression;
}

/**
 * The description an entry shows: its own, else its members' (one member's as it stands; several
 * each led by its label).
 * @param {ElectionGroup} group
 * @param {{ label: string, about?: GroupAbout | undefined }[]} members
 * @returns {GroupAbout | null}
 */
export function groupAbout(group, members) {
  if (group.about) return group.about;
  const described = members.filter((member) => member.about?.text?.length);
  if (!described.length) return null;
  if (described.length === 1) return /** @type {GroupAbout} */ (described[0]?.about);
  return {
    text: described.flatMap((member) => (member.about?.text || []).map((paragraph, i) => (i ? paragraph : `${member.label}: ${paragraph}`))),
    links: described.flatMap((member) => member.about?.links || [])
  };
}

/**
 * The catalogue's row for an entry, from its members' rows; null when none is in the catalogue.
 * Dated by its first member, placed on the shelves of its members' bodies, and where its members
 * were held (each "Where" filter finds it).
 * @param {ElectionGroup} group
 * @param {ReadonlyMap<string, GroupMemberRow>} rowsByKey
 */
export function catalogueGroupRow(group, rowsByKey) {
  const present = group.members.filter((member) => rowsByKey.has(member.election));
  if (!present.length) return null;
  const rows = present.map((member) => /** @type {GroupMemberRow} */ (rowsByKey.get(member.election)));
  const first = /** @type {GroupMemberRow} */ (rows[0]);
  const days = rows.map((row) => electionDay(row.date)).filter(Boolean).sort();
  const scopes = [...new Set(rows.map((row) => row.scope || '').filter(Boolean))];
  const about = groupAbout(group, present.map((member, i) => ({ label: member.label, about: rows[i]?.about })));
  const thumb = rows.find((row) => row.thumb)?.thumb;
  return {
    key: group.id,
    title: group.title,
    body: first.body,
    bodySlug: first.bodySlug,
    bodySlugs: [...new Set(rows.map((row) => row.bodySlug))],
    ...(group.shortLabel ? { shortLabel: group.shortLabel } : {}),
    date: days[0] || first.date,
    kind: 'general',
    subtitle: present.map((member) => member.label).join(' · '),
    members: present.map((member, i) => ({ key: member.election, label: member.label, title: rows[i]?.title || member.election, date: rows[i]?.date || '' })),
    ...(scopes.length === 1 ? { scope: /** @type {string} */ (scopes[0]) } : {}),
    scopes,
    ...(thumb ? { thumb } : {}),
    ...(about ? { about } : {})
  };
}
