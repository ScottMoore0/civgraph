/** Named queries: party cards, their aliases and the label map (storage slice ST-6). */

export const PARTIES = Object.freeze({
  /** [slug] -> { slug } a live party */
  live: 'SELECT slug FROM party_cards WHERE slug = ?1',
  /** [alias] -> { slug } the party a retired slug now belongs to */
  alias: 'SELECT slug FROM party_aliases WHERE alias = ?1',
  /** [] -> { label, party_slug } */
  labelMap: 'SELECT label, party_slug FROM party_label_map ORDER BY ord, label',
  /** [slug] -> { card, detail, profile } */
  detail: 'SELECT card, detail, profile FROM party_cards WHERE slug = ?1',
  /** [] -> { card } every party in list order */
  cards: 'SELECT card FROM party_cards ORDER BY ord, slug',
});
