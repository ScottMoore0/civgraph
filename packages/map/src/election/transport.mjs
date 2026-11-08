/**
 * Election transport: where the map's election pane gets its data, and nothing else. The
 * election manifest, each election's results bundle (from the D1-backed /_api/elections, or the
 * static file when the API is switched off), its provenance, one constituency's count detail and
 * a layer's feature index.
 *
 * Moved out of packages/map/app/election-manager.js (frontend plan section 5.1, seam E3) without changing
 * behaviour: the same URLs, the same request options, the same errors and the same beacons.
 * Caching stays with the caller (packages/map/src/election/cache.mjs). Every function takes its fetch (and,
 * where it reads the page, the global object) as an option, so the tests run it in Node.
 */

export const ELECTION_MANIFEST_URL = '/render/metadata/elections-test2.json?v=test-023';

/** @typedef {import('../../../types/index.js').ElectionManifestEntry} ElectionManifestEntry */
/** @typedef {import('../../../types/index.js').ApiV1.ElectionsManifestAnswer} ElectionsManifestAnswer */
/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} FetchImpl */
/**
 * The parts of the page's global object (window) the transport reads; a test passes its own.
 * @typedef {{
 *   location: { search: string, pathname: string },
 *   localStorage?: { getItem: (key: string) => string | null } | null,
 *   navigator?: { sendBeacon?: (url: string, data: Blob) => boolean },
 *   fetch: FetchImpl
 * }} TransportEnv
 */
/**
 * An election as the transport needs it: its key, its static file, and the names its errors use.
 * @typedef {Pick<ElectionManifestEntry, 'key' | 'body' | 'date'> & { resultUrl?: unknown }} BundleEntry
 */

/** @type {FetchImpl} */
const defaultFetch = (url, init) => fetch(url, init);

/**
 * Read election results from the D1-backed API instead of the static bundles.
 *
 * Off by default: the static files remain the live path until this has been exercised
 * properly. Enable per-session with ?electionsApi=1 (or ?electionsApi=0 to force it
 * off), or persistently by setting localStorage 'civgraph.electionsApi' to '1'.
 *
 * The API's bundle mode returns the same shape as the static file, so nothing
 * downstream of loadBundle changes. It is not smaller -- it returns every
 * constituency, exactly as the file does. What it fixes is provenance: the static
 * bundles are regenerated at deploy time from sources the deploy environment does not
 * have, which is how production came to serve matchedCount 0 for 223 elections. D1 is
 * not rewritten by a deploy.
 *
 * `env` is the page's global object (window); a test passes its own.
 * @param {TransportEnv} [env]
 */
export function useElectionsApi(env = globalThis) {
  try {
    const param = new URLSearchParams(env.location.search).get('electionsApi');
    if (param === '1' || param === 'true') return true;
    if (param === '0' || param === 'false') return false;
    // Default ON. localStorage 'civgraph.electionsApi' = '0' opts out, as does
    // ?electionsApi=0, so the static path stays reachable without a deploy.
    const stored = env.localStorage?.getItem('civgraph.electionsApi');
    if (stored === '0') return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * @param {BundleEntry} entry
 * @param {boolean} [useApi]
 */
export function electionBundleUrl(entry, useApi = useElectionsApi()) {
  return useApi
    ? `/_api/elections?key=${encodeURIComponent(entry.key)}&format=bundle&lite=1`
    : `${entry.resultUrl}?v=test-023`;
}

/** @param {string} key */
export function provenanceUrl(key) {
  return `/_api/elections?key=${encodeURIComponent(key)}&view=provenance`;
}

/**
 * @param {string} key
 * @param {number | string} seq
 */
export function constituencyDetailUrl(key, seq) {
  return `/_api/elections?key=${encodeURIComponent(key)}&constituency=${seq}`;
}

/**
 * Where each result in an election came from, and how far that was checked.
 *
 * One small file per election, written by scripts/build/build-election-provenance.mjs and keyed by the
 * constituency name as rendered. Only 213 elections have any attribution yet, so a miss is the
 * normal case and must never disturb the results themselves: every failure returns null and the
 * pane simply shows no source line.
 * @param {string} key
 * @param {FetchImpl} [fetchImpl]
 */
export async function loadProvenanceShard(key, fetchImpl = defaultFetch) {
  try {
    // From D1 (data design phase 2); the old shard URL answers the same from the same rows.
    const response = await fetchImpl(provenanceUrl(key), { cache: 'default' });
    if (!response.ok) return null;
    const shard = await response.json();
    return shard?.contests || null;
  } catch {
    return null;
  }
}

/**
 * Report an elections-API problem so it is visible outside one user's console.
 *
 * The API is the default path and falls back to the static bundles on failure, which
 * means a broken API looks like a working site. Without a beacon the only trace is a
 * console.warn in a tab nobody is watching. /_api/rum structured-logs what it receives,
 * so these show up in `wrangler pages tail civgraph` and the Functions log.
 *
 * Fire-and-forget: telemetry must never break a page that is otherwise working.
 * @param {string} metric
 * @param {unknown} reason
 * @param {unknown} key
 * @param {TransportEnv} [env]
 */
export function reportElectionsApiIssue(metric, reason, key, env = globalThis) {
  try {
    const body = JSON.stringify({
      source: 'elections',
      metric,
      value: 1,
      path: (env.location && env.location.pathname) || '',
      event: { reason: String(reason).slice(0, 240), layerId: String(key || '') }
    });
    const endpoint = '/_api/rum';
    if (env.navigator && env.navigator.sendBeacon) {
      env.navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    } else {
      env.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      });
    }
  } catch {
    /* never throw from telemetry */
  }
}

/**
 * The election catalogue the pane lists and opens.
 * @param {{ fetchImpl?: FetchImpl }} [options]
 * @returns {Promise<ElectionsManifestAnswer>}
 */
export async function fetchElectionManifest({ fetchImpl = defaultFetch } = {}) {
  const response = await fetchImpl(ELECTION_MANIFEST_URL, { cache: 'default' });
  if (!response.ok) throw new Error(`Failed to load the MapLibre election catalogue: ${response.status}`);
  return response.json();
}

/**
 * An election's results bundle, with its provenance attached (null when it has none).
 * @param {BundleEntry} entry
 * @param {{ fetchImpl?: FetchImpl, env?: TransportEnv }} [options]
 */
export async function fetchResultsBundle(entry, { fetchImpl = defaultFetch, env = globalThis } = {}) {
  const response = await fetchImpl(electionBundleUrl(entry, useElectionsApi(env)), { cache: 'default' });
  // No static fallback: the bundles are no longer deployed as files. The API keeps a
  // last-good copy of every answer and serves it if D1 is unavailable
  // (functions/_api/_records.js cachedJson), which is what the fallback was for.
  if (!response.ok && useElectionsApi(env)) {
    console.warn(`[test2 elections] elections API returned ${response.status} for ${entry.key}`);
    reportElectionsApiIssue('elections-api-error', `bundle fetch returned ${response.status}`, entry.key, env);
  }
  if (!response.ok) throw new Error(`Failed to load election results for ${entry.body} ${entry.date}: ${response.status}`);
  const bundle = await response.json();
  bundle.provenance = await loadProvenanceShard(entry.key, fetchImpl);
  return bundle;
}

/**
 * An election's results bundle for the trends chart: no provenance, its own error.
 * @param {BundleEntry} entry
 * @param {{ fetchImpl?: FetchImpl, env?: TransportEnv }} [options]
 */
export async function fetchTrendBundle(entry, { fetchImpl = defaultFetch, env = globalThis } = {}) {
  const response = await fetchImpl(electionBundleUrl(entry, useElectionsApi(env)), { cache: 'default' });
  if (!response.ok) throw new Error(`Failed to load trend data for ${entry.body} ${entry.date}: ${response.status}`);
  return response.json();
}

/**
 * One constituency's full record (its count detail and animation payload), by its position in
 * the bundle. A failure is reported and answers null: the pane keeps what the bundle had.
 * @param {string} key
 * @param {number | string} seq
 * @param {{ fetchImpl?: FetchImpl, env?: TransportEnv }} [options]
 */
export async function fetchConstituencyDetail(key, seq, { fetchImpl = defaultFetch, env = globalThis } = {}) {
  try {
    const response = await fetchImpl(constituencyDetailUrl(key, seq), { cache: 'default' });
    if (!response.ok) {
      reportElectionsApiIssue('elections-api-animation-failed', `constituency fetch returned ${response.status}`, `${key}#${seq}`, env);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn('[test2 elections] Could not load animation payload:', error);
    const message = error && /** @type {{ message?: string }} */ (error).message;
    reportElectionsApiIssue('elections-api-animation-failed', message ? message : String(error), key, env);
    return null;
  }
}

/**
 * A layer's feature index (names, centres, bounds), its items under `items`; null if it is missing.
 * @param {string} url
 * @param {{ fetchImpl?: FetchImpl }} [options]
 */
export async function fetchFeatureIndex(url, { fetchImpl = defaultFetch } = {}) {
  const response = await fetchImpl(url, { cache: 'default' });
  if (!response.ok) return null;
  const raw = await response.json();
  return {
    ...raw,
    items: raw.items || raw.features || (Array.isArray(raw) ? raw : [])
  };
}
