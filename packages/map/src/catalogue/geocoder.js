/**
 * Address search for the map's search box ("Search maps or addresses…"), which until 2026-10-31
 * had no geocoder behind it in the rebuilt catalogue: postcodes and streets found nothing (UX
 * review 2026-10-30, #6).
 *
 *   - As the reader types: Photon (photon.komoot.io), an OpenStreetMap geocoder built for
 *     search-as-you-type, limited to the island of Ireland.
 *   - A Northern Ireland postcode, whole ("BT7 1NN") or its outward half ("BT7"): postcodes.io,
 *     which knows every BT postcode; Photon only where postcodes.io has no answer.
 *   - If Photon fails, is slow (4s) or turns us away (429, 5xx), suggestions pause for this
 *     visitor for ten minutes (kept in sessionStorage) and the box searches on Enter instead,
 *     with ONE request to Nominatim. Nominatim's usage policy forbids autocomplete, so it is
 *     never asked per keystroke, and never more than once a second.
 *
 * Requests carry no headers of ours: the browser's own User-Agent and Referer identify the site,
 * and nothing personal (no email address, no account) is ever sent.
 *
 * Results: { name, detail, lat, lon, source } with source 'photon' | 'nominatim' | 'postcodes.io'.
 * Tested by tests/browser/address-search.spec.js with the network mocked.
 */

// The island of Ireland, west, south, east, north.
export const IRELAND_BBOX = [-10.7, 51.3, -5.3, 55.5];
const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const POSTCODES_URL = 'https://api.postcodes.io';
const PHOTON_TIMEOUT_MS = 4000;
const PAUSE_MS = 10 * 60 * 1000;
const NOMINATIM_GAP_MS = 1000;
const PAUSE_KEY = 'civgraph.addressSuggestionsPausedUntil';
const LIMIT = 6;

const FULL_POSTCODE = /^\s*(BT\d{1,2})\s*(\d[A-Z]{2})\s*$/i;
const OUTWARD_CODE = /^\s*(BT\d{1,2})\s*$/i;

/** @typedef {{ kind: 'full' | 'outward', code: string }} Postcode */
/** @typedef {{ name: string, detail: string, lat: number, lon: number, source: string }} AddressResult */
/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} FetchLike */

/**
 * A Northern Ireland postcode in the query: { kind: 'full'|'outward', code }, or null.
 * @param {unknown} query
 * @returns {Postcode | null}
 */
export function parsePostcode(query) {
  let m = FULL_POSTCODE.exec(String(query || ''));
  if (m) return { kind: 'full', code: `${m[1]} ${m[2]}`.toUpperCase() };
  m = OUTWARD_CODE.exec(String(query || ''));
  if (m) return { kind: 'outward', code: m[1].toUpperCase() };
  return null;
}

const safeStorage = () => {
  try { return window.sessionStorage; } catch { return null; }
};

export class AddressGeocoder {
  /** @param {{ fetchImpl?: FetchLike, storage?: Storage | null, now?: () => number }} [options] */
  constructor({ fetchImpl = (...args) => fetch(...args), storage = safeStorage(), now = () => Date.now() } = {}) {
    this.fetch = fetchImpl;
    this.storage = storage;
    this.now = now;
    this.lastNominatim = 0;
  }

  /** True while Photon is paused for this visitor: the box searches on Enter instead. Kept in
   * sessionStorage, so the next page of the visit honours it too; in memory as well, for a
   * browser that refuses storage. */
  get paused() {
    let until = this.pausedUntil || 0;
    try { until = Math.max(until, Number(this.storage?.getItem(PAUSE_KEY) || 0)); } catch { /* blocked storage */ }
    return until > this.now();
  }

  pause() {
    this.pausedUntil = this.now() + PAUSE_MS;
    try { this.storage?.setItem(PAUSE_KEY, String(this.pausedUntil)); } catch { /* private mode: this page only */ }
  }

  /**
   * Suggestions while typing. Never Nominatim. Returns { results, source, paused }.
   * `signal` aborts a request a newer keystroke has made stale.
   * @param {unknown} query
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<{ results: AddressResult[], source: string, paused: boolean }>}
   */
  async suggest(query, { signal } = {}) {
    const q = String(query || '').trim();
    if (q.length < 3 && !parsePostcode(q)) return { results: [], source: '', paused: this.paused };
    const postcode = parsePostcode(q);
    if (postcode) {
      const results = await this.postcode(postcode, { signal }).catch(() => []);
      if (results.length) return { results, source: 'postcodes.io', paused: this.paused };
    }
    if (this.paused) return { results: [], source: '', paused: true };
    try {
      return { results: await this.photon(q, { signal }), source: 'photon', paused: false };
    } catch (error) {
      if ((/** @type {{ name?: unknown } | null | undefined} */ (error))?.name === 'AbortError' && signal?.aborted) throw error;
      // Failed, slow or refused: stop asking Photon for a while, and say press Enter.
      this.pause();
      return { results: [], source: '', paused: true };
    }
  }

  /**
   * One search on Enter, by Nominatim, at most once a second. Returns { results, source }.
   * @param {unknown} query
   * @returns {Promise<{ results: AddressResult[], source: string }>}
   */
  async search(query) {
    const q = String(query || '').trim();
    if (!q) return { results: [], source: '' };
    const postcode = parsePostcode(q);
    if (postcode) {
      const results = await this.postcode(postcode).catch(() => []);
      if (results.length) return { results, source: 'postcodes.io' };
    }
    const wait = this.lastNominatim + NOMINATIM_GAP_MS - this.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastNominatim = this.now();
    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      countrycodes: 'gb,ie',
      viewbox: `${IRELAND_BBOX[0]},${IRELAND_BBOX[3]},${IRELAND_BBOX[2]},${IRELAND_BBOX[1]}`,
      bounded: '1',
      limit: String(LIMIT),
    });
    const response = await this.fetch(`${NOMINATIM_URL}?${params}`);
    if (!response.ok) throw new Error(`Address search failed (${response.status})`);
    const rows = await response.json();
    return {
      source: 'nominatim',
      results: (Array.isArray(rows) ? rows : []).map((/** @type {{ display_name?: string, name?: string, lat?: unknown, lon?: unknown }} */ row) => {
        const [name, ...rest] = String(row.display_name || row.name || '').split(', ');
        return { name: row.name || name, detail: rest.slice(0, 3).join(', '), lat: Number(row.lat), lon: Number(row.lon), source: 'nominatim' };
      }).filter((/** @type {AddressResult} */ r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)),
    };
  }

  /**
   * @param {string} q
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<AddressResult[]>}
   */
  async photon(q, { signal } = {}) {
    const params = new URLSearchParams({ q, lang: 'en', limit: String(LIMIT), bbox: IRELAND_BBOX.join(',') });
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), PHOTON_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.fetch(`${PHOTON_URL}?${params}`, { signal: timeout.signal });
      if (!response.ok) throw new Error(`Photon returned ${response.status}`);
      const doc = await response.json();
      const seen = new Set();
      return (doc?.features || []).map((/** @type {{ properties?: Record<string, string | undefined>, geometry?: { coordinates?: unknown[] } }} */ feature) => {
        const p = feature.properties || {};
        const [lon, lat] = feature.geometry?.coordinates || [];
        const street = [p.housenumber, p.street].filter(Boolean).join(' ');
        const name = p.name || street || p.city || p.county || '';
        const detail = [p.name && street ? street : '', p.locality, p.district, p.city !== name ? p.city : '', p.county, p.postcode]
          .filter(Boolean).filter((part, i, all) => all.indexOf(part) === i).slice(0, 4).join(', ');
        return { name, detail, lat: Number(lat), lon: Number(lon), source: 'photon' };
      }).filter((/** @type {AddressResult} */ r) => {
        const key = `${r.name}|${r.detail}`;
        if (!r.name || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * @param {Postcode} postcode
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<AddressResult[]>}
   */
  async postcode({ kind, code }, { signal } = {}) {
    const path = kind === 'full' ? `/postcodes/${encodeURIComponent(code)}` : `/outcodes/${encodeURIComponent(code)}`;
    const response = await this.fetch(`${POSTCODES_URL}${path}`, { signal });
    if (!response.ok) return [];
    const { result } = await response.json();
    if (!result || !Number.isFinite(Number(result.latitude))) return [];
    const district = Array.isArray(result.admin_district) ? result.admin_district.join(', ') : result.admin_district;
    return [{
      name: kind === 'full' ? result.postcode : `${result.outcode} postcode district`,
      detail: [district, kind === 'full' ? result.admin_ward : ''].filter(Boolean).join(', '),
      lat: Number(result.latitude),
      lon: Number(result.longitude),
      source: 'postcodes.io',
    }];
  }
}
