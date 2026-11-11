// @ts-check
/**
 * Every row of a paged records answer (/_api/persons?party=...&limit=&offset=), for the party
 * pages' candidate lists.
 *
 * The pages were asked one after another. Fianna Fáil has 3,372 candidates, so its party page
 * made seventeen requests in a row and stayed busy for about three and a half seconds on a
 * quiet machine, longer on a busy one (app.spec "election party and person links", 11 Nov 2026).
 * The first page gives the total; the rest are now asked a few at a time and kept in order.
 *
 * Partial answers are still reported: an endpoint that does not page (a later page repeating the
 * first, as the party query did before it took an offset), a page that fails, or more rows than
 * maxPages can hold marks the result capped, and the page says its list is partial.
 */

/**
 * @template T
 * @param {(page: number) => Promise<{ rows: T[], total?: number } | null>} fetchPage
 *   one page (0-based), or null when it could not be had
 * @param {{ pageSize: number, maxPages: number, concurrency?: number, idOf: (row: T) => string }} options
 * @returns {Promise<{ rows: T[], capped: boolean }>}
 */
export async function loadAllPages(fetchPage, { pageSize, maxPages, concurrency = 4, idOf }) {
  const rows = [];
  const seen = new Set();
  /** @param {T[]} pageRows @returns {T[]} the rows not seen before */
  const fresh = (pageRows) => pageRows.filter((row) => {
    const id = String(idOf(row) || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const first = await fetchPage(0);
  if (!first || !Array.isArray(first.rows)) return { rows: [], capped: true };
  rows.push(...fresh(first.rows));
  if (first.rows.length < pageSize) return { rows, capped: false };

  const total = Number(first.total);
  if (Number.isFinite(total) && total > 0) {
    // The pages the total needs, up to maxPages, fetched a few at a time.
    const pages = Math.min(maxPages, Math.ceil(total / pageSize));
    /** @type {Array<{ rows: T[], total?: number } | null>} */
    const results = new Array(pages).fill(null);
    let next = 1;
    const worker = async () => {
      while (next < pages) {
        const page = next;
        next += 1;
        results[page] = await fetchPage(page).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.max(0, Math.min(concurrency, pages - 1)) }, worker));
    for (let page = 1; page < pages; page += 1) {
      const result = results[page];
      if (!result || !Array.isArray(result.rows)) return { rows, capped: true };
      const added = fresh(result.rows);
      if (!added.length && result.rows.length) return { rows, capped: true };
      rows.push(...added);
    }
    // Capped only when maxPages could not hold the total (rows found under two aliases are
    // counted once, so fewer rows than the total is not by itself a partial list).
    return { rows, capped: pages * pageSize < total };
  }

  // No total: one page after another until a short one.
  for (let page = 1; page < maxPages; page += 1) {
    const result = await fetchPage(page).catch(() => null);
    if (!result || !Array.isArray(result.rows)) return { rows, capped: true };
    const added = fresh(result.rows);
    if (!added.length && result.rows.length) return { rows, capped: true };
    rows.push(...added);
    if (result.rows.length < pageSize) return { rows, capped: false };
  }
  return { rows, capped: true };
}
