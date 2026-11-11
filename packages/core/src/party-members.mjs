// @ts-check
/**
 * The party page's member list, compact (/_api/parties?slug=<slug>&view=members, 11 Nov 2026).
 *
 * The party page (packages/map/src/app/entity-bridge.js) lists everyone who stood for a party,
 * with how often they stood and won, where and when. It used to read the people's whole Browse
 * cards through /_api/persons?party=: Fianna Fáil's 3,372 people came as seventeen pages of
 * about 860 KB. The page reads a handful of fields of each election row, so the members view
 * sends only those. The page keeps its own reading of them (which rows are the party's, by its
 * aliases and the party registry), so what it shows does not change.
 *
 * Both ends are here: the API encodes (packages/api/src/handlers/parties/members.js) and the
 * page decodes, so the format has one definition.
 *
 * An answer's `members` are [slug, name, rows, ord]: ord is the person's place in the Browse
 * people list (person_cards.ord), which the page lists people in where its own order ties, as it
 * did reading the cards in that order; each row is an array of MEMBER_COLUMNS:
 *   key          the election key, as an index into the answer's dictionaries.key
 *   date         null when the row has no date; '' when it is the key's own trailing date
 *                ("dail-eireann__2024-11-29"), which is every row today; otherwise the date
 *   constituency an index into dictionaries.constituency ('' is an entry: none)
 *   party        an index into dictionaries.party ('' is an entry: no party)
 *   status       an index into dictionaries.status ('' is an entry: none)
 *   elected      1, 0, or null when the card does not say
 *   firstPrefs   the row's first-preference votes (firstPref, firstPrefs or votes), or null
 *   title        only on a row whose title names a referendum (the one case where the page's
 *                election type reads the title); absent otherwise
 * The four text columns repeat across a party's people (one election key, one council, a few
 * statuses), so each value is written once per answer and the rows point at it: the UUP's
 * people, the largest list, came to 1.2 MB with them written out in every row.
 */

export const MEMBER_COLUMNS = Object.freeze(['key', 'date', 'constituency', 'party', 'status', 'elected', 'firstPrefs', 'title']);
/** The columns written once per answer (`dictionaries`) and pointed at by index. */
export const DICTIONARY_COLUMNS = Object.freeze(['key', 'constituency', 'party', 'status']);
export const MEMBERS_SCHEMA_VERSION = 1;

/**
 * @typedef {{ key?: unknown, date?: unknown, constituency?: unknown, party?: unknown, status?: unknown,
 *   elected?: unknown, firstPref?: unknown, firstPrefs?: unknown, votes?: unknown, title?: unknown }} CardElection
 * @typedef {{ slug?: unknown, id?: unknown, name?: unknown, title?: unknown, elections?: unknown }} PersonCard
 * @typedef {(string | number | null)[]} MemberRow
 * @typedef {[string, string, MemberRow[], number | null]} Member
 * @typedef {{ key: string[], constituency: string[], party: string[], status: string[] }} MemberDictionaries
 * @typedef {{ key: string, date: string, constituency: string, party: string, status: string,
 *   elected?: boolean, firstPrefs: unknown, title?: string }} MemberElection
 * @typedef {{ slug: string, id: string, name: string, ord: number | null, elections: MemberElection[] }} DecodedMember
 */

const text = (/** @type {unknown} */ value) => (value === null || value === undefined ? '' : String(value));

/** The trailing date of an election key, or ''. */
const keyDate = (/** @type {string} */ key) => /__(\d{4}-\d{2}-\d{2})$/.exec(key)?.[1] || '';

/**
 * A members encoder: one per answer, holding the answer's dictionaries.
 * @returns {{ member: (card: PersonCard, ord?: unknown) => Member, dictionaries: MemberDictionaries }}
 */
export function memberEncoder() {
  /** @type {MemberDictionaries} */
  const dictionaries = { key: [], constituency: [], party: [], status: [] };
  /** @type {Record<keyof MemberDictionaries, Map<string, number>>} */
  const at = { key: new Map(), constituency: new Map(), party: new Map(), status: new Map() };
  const entry = (/** @type {keyof MemberDictionaries} */ column, /** @type {string} */ value) => {
    let index = at[column].get(value);
    if (index === undefined) {
      index = dictionaries[column].push(value) - 1;
      at[column].set(value, index);
    }
    return index;
  };
  /** @param {CardElection} row @returns {MemberRow} */
  const encodeRow = (row) => {
    const key = text(row.key);
    const date = row.date === null || row.date === undefined || row.date === '' ? null : String(row.date);
    const votes = row.firstPref ?? row.firstPrefs ?? row.votes ?? null;
    /** @type {MemberRow} */
    const out = [
      entry('key', key),
      date !== null && date === keyDate(key) ? '' : date,
      entry('constituency', text(row.constituency)),
      entry('party', text(row.party)),
      entry('status', text(row.status)),
      row.elected === true ? 1 : row.elected === false ? 0 : null,
      typeof votes === 'number' || typeof votes === 'string' ? votes : null,
    ];
    if (/referendum/i.test(text(row.title))) out.push(text(row.title));
    return out;
  };
  return {
    dictionaries,
    member: (card, ord = null) => [
      text(card.slug || card.id),
      text(card.name || card.title),
      (Array.isArray(card.elections) ? card.elections : [])
        .filter((row) => row && typeof row === 'object')
        .map((row) => encodeRow(/** @type {CardElection} */ (row))),
      ord === null || ord === undefined || !Number.isFinite(Number(ord)) ? null : Number(ord),
    ],
  };
}

/**
 * The members of one answer as the party page reads people: { slug, id, name, ord, elections } with
 * each election row's fields named again.
 * @param {{ dictionaries?: unknown, members?: unknown } | null | undefined} payload
 * @returns {DecodedMember[]}
 */
export function decodeMembers(payload) {
  const given = /** @type {Record<string, unknown>} */ (payload?.dictionaries && typeof payload.dictionaries === 'object' ? payload.dictionaries : {});
  const dictionary = (/** @type {string} */ column) => {
    const list = given[column];
    return Array.isArray(list) ? list.map(text) : [];
  };
  const keys = dictionary('key');
  const places = dictionary('constituency');
  const parties = dictionary('party');
  const statuses = dictionary('status');
  const look = (/** @type {string[]} */ list, /** @type {unknown} */ index) => (index === null || index === undefined ? '' : list[Number(index)] ?? '');
  const members = Array.isArray(payload?.members) ? payload.members : [];
  return members.map((member) => {
    const [slug, name, rows, ord] = Array.isArray(member) ? member : [];
    return {
      slug: text(slug),
      id: text(slug),
      name: text(name),
      ord: ord === null || ord === undefined || !Number.isFinite(Number(ord)) ? null : Number(ord),
      elections: (Array.isArray(rows) ? rows : []).map((cells) => {
        const [key, date, constituency, party, status, elected, firstPrefs, title] = Array.isArray(cells) ? cells : [];
        const k = look(keys, key);
        /** @type {MemberElection} */
        const row = {
          key: k,
          date: date === '' ? keyDate(k) : text(date),
          constituency: look(places, constituency),
          party: look(parties, party),
          status: look(statuses, status),
          firstPrefs: firstPrefs ?? null,
        };
        if (elected === 1) row.elected = true;
        else if (elected === 0) row.elected = false;
        if (title !== undefined && title !== null) row.title = text(title);
        return row;
      }),
    };
  });
}
