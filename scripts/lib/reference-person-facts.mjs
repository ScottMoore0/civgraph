/**
 * Offices and family relations from published reference works, filed by Civgraph person id
 * in data/elections/persons/reference-offices.json and reference-relations.json.
 *
 * Today the one work is Henry Boylan's Dictionary of Irish Biography (3rd edition, 1998),
 * which is in copyright: the files hold FACTS ONLY (an office, its years, a relation),
 * each cited to the work and page, never the work's text.
 *
 * Same rule as reference-dates.json: a reference work fills in what Civgraph's better
 * sources do not show and never replaces them. The data files already leave out seats
 * Civgraph's own election results show; here a Commons seat is also dropped when the
 * person has a History of Parliament biography, whose seat list is the better source.
 */

const COMMONS = 'House of Commons of the United Kingdom';

/** "Henry Boylan, A Dictionary of Irish Biography (3rd edition, 1998), pp. 1–2, s.v. Frank Aiken" */
export function referenceCitation(source) {
  if (!source?.title) return '';
  const page = source.page ? String(source.page) : '';
  const pages = page ? (/[-–]/.test(page) ? `pp. ${page.replace('-', '–')}` : `p. ${page}`) : '';
  const work = [source.author, source.title].filter(Boolean).join(', ');
  const edition = [source.edition, source.year].filter(Boolean).join(', ');
  return [`${work}${edition ? ` (${edition})` : ''}`, pages, source.entry ? `s.v. ${source.entry}` : '']
    .filter(Boolean).join(', ');
}

export function referenceOffices(doc, personId, { hasHop = false } = {}) {
  const rows = doc?.people?.[personId];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row?.value && !(hasHop && row.body === COMMONS))
    .map((row) => ({
      office: row.value,
      ...(row.start ? { start: String(row.start) } : {}),
      ...(row.end ? { end: String(row.end) } : {}),
      ...(row.body ? { body: row.body } : {}),
      ...(row.constituency ? { constituency: row.constituency } : {}),
      source: referenceCitation(row.source),
    }));
}

/**
 * `lookup(id)` returns { title, slug } for a Civgraph person, or null. A link to an id the
 * person index no longer holds (merged or renumbered) is dropped and reported, not shown.
 */
export function referenceRelatives(doc, personId, lookup, missing = new Set()) {
  const rows = doc?.people?.[personId];
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const other = row?.person ? lookup(String(row.person)) : null;
    if (!other) { missing.add(String(row?.person)); continue; }
    out.push({ relation: row.value, personId: String(row.person), name: other.title, slug: other.slug, source: referenceCitation(row.source) });
  }
  return out;
}
