/** Named queries: party cards, their aliases and the label map (storage slice ST-6). */

/** `?1, ?2, ...`: one placeholder per party name. */
const names = (/** @type {number} */ count) => Array.from({ length: count }, (_, i) => `?${i + 1}`).join(', ');

export const PARTIES = Object.freeze({
  /** [slug] -> { slug } a live party */
  live: 'SELECT slug FROM party_cards WHERE slug = ?1',
  /** [alias] -> { slug } the party a retired slug now belongs to */
  alias: 'SELECT slug FROM party_aliases WHERE alias = ?1',
  /** [] -> { label, party_slug } */
  labelMap: 'SELECT label, party_slug FROM party_label_map ORDER BY ord, label',
  /** [slug] -> { card, detail, profile } */
  detail: 'SELECT card, detail, profile FROM party_cards WHERE slug = ?1',
  /** [slug] -> { detail, profile } (data/browse/details/parties) */
  detailProfile: 'SELECT detail, profile FROM party_cards WHERE slug = ?1',
  /** [slug] -> { card, detail }: the party record without its profile (the members view) */
  record: 'SELECT card, detail FROM party_cards WHERE slug = ?1',
  /** [] -> { card } every party in list order */
  cards: 'SELECT card FROM party_cards ORDER BY ord, slug',
  /**
   * [...party names] -> { n }: how many people's cards list any of these party names. Read from
   * person_card_parties' primary key (party, slug): the index entries of these names, no card.
   */
  membersCount: (/** @type {number} */ count) =>
    `SELECT COUNT(DISTINCT slug) AS n FROM person_card_parties WHERE party IN (${names(count)})`,
  /**
   * [...party names, limit, offset] -> { slug, ord, card }: one page of those people, by slug. The
   * page is chosen from the index first, so only its own cards are read.
   */
  membersPage: (/** @type {number} */ count) =>
    `SELECT p.slug, p.ord, p.card FROM (
       SELECT DISTINCT slug FROM person_card_parties WHERE party IN (${names(count)})
       ORDER BY slug LIMIT ?${count + 1} OFFSET ?${count + 2}
     ) m JOIN person_cards p ON p.slug = m.slug
     ORDER BY p.slug`,
});
