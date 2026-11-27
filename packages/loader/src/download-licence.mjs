/**
 * The licence and attribution a bulk download carries inside it (citations review S15,
 * owner-approved 24 Nov 2026), so a copy that leaves the site still says on what terms it may be
 * reused: the records database's `dataset` table holds them (keys `licence` and `attribution`),
 * the graph shard archive holds them as LICENCE.txt, and the downloads manifest repeats them.
 * The wording follows the Licence page (/pages/licence). Pure: no I/O.
 */

/**
 * The statements for a download made from Civgraph at `origin`.
 * @param {string} origin  the site's origin (SITE.origin)
 * @returns {{ licence: string, attribution: string }}
 */
export function downloadLicence(origin) {
  const page = `${origin}/pages/licence`;
  return {
    licence: `Civgraph's own compiled data and original text are released under the Creative Commons Attribution 4.0 licence `
      + `(CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). Material from other bodies keeps its own licence, and a `
      + `record or map that names a licence of its own is under that licence. See ${page} for the licence of each source.`,
    attribution: `Credit "Civgraph (${origin.replace(/^https?:\/\//, '')})" and link to ${origin}, and give the credit each source asks `
      + `for (named in the records, and on ${page}). Crediting Civgraph alone is not enough for material from other bodies.`,
  };
}

/**
 * LICENCE.txt for an archive: what it is, its licence and how to credit it.
 * @param {string} origin
 * @param {string} what  what the archive holds
 * @returns {string}
 */
export function licenceText(origin, what) {
  const { licence, attribution } = downloadLicence(origin);
  return [`Civgraph: ${what}`, '', 'Licence', licence, '', 'Attribution', attribution, ''].join('\n');
}
