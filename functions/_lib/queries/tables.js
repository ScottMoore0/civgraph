/**
 * The records tables' names where they are not yet final, for every named query
 * (functions/_lib/queries/, storage slice ST-6). Re-exported by functions/_api/_records.js as T.
 */

/** The two tables whose final names are still taken by live legacy tables (stage H renames them). */
export const T = Object.freeze({ elections: 'r_elections', counts: 'r_counts' });
