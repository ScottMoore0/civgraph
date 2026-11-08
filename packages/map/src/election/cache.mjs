/**
 * Election caching: the small in-memory caches the map's election pane keeps (results bundles,
 * feature indexes, trend summaries and rendered trends), how big each may grow, and the helpers
 * that fill them.
 *
 * Moved out of packages/map/app/election-manager.js (frontend plan section 5.1, seam E3) without changing
 * behaviour. A cache is a plain Map kept in insertion order: storing a key moves it to the end,
 * and once a cache holds more than its limit the oldest entries go. Pure: no DOM, no network.
 */

/** How many of each a session keeps: a bundle can be megabytes, a trend summary a few rows. */
export const ELECTION_CACHE_LIMITS = Object.freeze({
  bundles: 4,
  featureIndexes: 3,
  trendSummaries: 160,
  trendRenders: 40
});

/** The manager's caches, empty. */
export function createElectionCaches() {
  return {
    bundleCache: new Map(),
    trendSummaryCache: new Map(),
    trendSummaryPromiseCache: new Map(),
    trendRenderCache: new Map(),
    featureIndexCache: new Map()
  };
}

/**
 * Store `value` under `key` as the newest entry, dropping the oldest beyond `limit`. A falsy key is not stored.
 * @template K, V
 * @param {Map<K, V> | null | undefined} cache
 * @param {K} key
 * @param {V} value
 * @param {number} limit
 * @returns {V}
 */
export function rememberLimitedCache(cache, key, value, limit) {
  if (!cache || !key) return value;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = /** @type {K} */ (cache.keys().next().value);
    cache.delete(oldestKey);
  }
  return value;
}

/**
 * The cached value for `key`, or `load()`'s, stored for next time. A null or undefined result
 * (nothing there) is returned but not stored, so the next call asks again.
 * @template K, V
 * @param {Map<K, V>} cache
 * @param {K} key
 * @param {number} limit
 * @param {() => V | null | undefined | Promise<V | null | undefined>} load
 * @returns {Promise<V | null | undefined>}
 */
export async function cachedLoad(cache, key, limit, load) {
  if (cache.has(key)) return cache.get(key);
  const value = await load();
  if (value == null) return value;
  return rememberLimitedCache(cache, key, value, limit);
}

/**
 * One load at a time per key: a call while `run()` for the same key is still in flight gets
 * that call's promise instead of starting another. `inflight` is a Map of the running promises.
 * @template K, V
 * @param {Map<K, Promise<V>>} inflight
 * @param {K} key
 * @param {() => Promise<V>} run
 * @returns {Promise<V>}
 */
export async function sharedLoad(inflight, key, run) {
  if (inflight.has(key)) return /** @type {Promise<V>} */ (inflight.get(key));
  const promise = run();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

/**
 * `mapper` over `items`, at most `limit` at a time, the results in the items' order.
 * @template T, R
 * @param {readonly T[] | null | undefined} items
 * @param {unknown} limit
 * @param {(item: T, index: number) => R | Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, mapper) {
  const values = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(limit) || 1);
  /** @type {R[]} */
  const results = new Array(values.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(size, values.length) }, async () => {
    while (index < values.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(values[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}
