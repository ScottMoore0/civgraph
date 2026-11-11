/**
 * How the PRONI endpoints read PRONI_DB: from a nearby D1 read replica (Sessions API,
 * 'first-unconstrained'; the catalogue is a static snapshot, so any replica is current), with
 * one retry on the primary when the replica fails. A cold replica answered three searches in a
 * row with errors on 11 Nov 2026 (the production benchmark in LANDING/proni-app); each was a
 * 500 the reader saw. Results are the same either way: only where they are read from differs.
 */
import { fromD1 } from '../../../../storage/src/d1.js';

/** @typedef {import('../../../../storage/src/store.js').RecordStore} RecordStore */

/**
 * The catalogue is closed: every full-text document is a record, and every Extracted Dates row
 * belongs to one record. The index was filled from proni's own rows (and since by its insert
 * trigger), ext from proni's references, and no load has ever deleted or replaced a record (the
 * import history and the read-only queries that confirm it are in LANDING/proni-app). So a count
 * with no filters reads the index alone, a year-range count reads ext alone, and a relevance page
 * cut off at its score needs no second look. False restores the joins and the second look.
 */
export const CATALOGUE_IS_CLOSED = true;

/**
 * Try `replica`, and on any error try `primary` once.
 * @template T
 * @param {() => Promise<T>} replica
 * @param {() => Promise<T>} primary
 * @returns {Promise<T>}
 */
export async function withPrimaryRetry(replica, primary) {
  try {
    return await replica();
  } catch {
    return primary();
  }
}

/**
 * A RecordStore over PRONI_DB whose reads (first, all, value, batch) go to a replica and retry
 * on the primary.
 * @param {D1Database} bound the PRONI_DB binding
 * @returns {RecordStore}
 */
export function proniReader(bound) {
  const replica = fromD1(bound, { session: 'first-unconstrained' });
  const primary = fromD1(bound);
  return {
    ...primary,
    first: (sql, params) => withPrimaryRetry(() => replica.first(sql, params), () => primary.first(sql, params)),
    all: (sql, params) => withPrimaryRetry(() => replica.all(sql, params), () => primary.all(sql, params)),
    value: (sql, params) => withPrimaryRetry(() => replica.value(sql, params), () => primary.value(sql, params)),
    batch: (statements) => withPrimaryRetry(() => replica.batch(statements), () => primary.batch(statements)),
  };
}
