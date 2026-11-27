/**
 * The Independent QUB Catalogue app's one door to its API (architecture rule R4). The answer
 * types are generated from the v1 contracts (packages/api/src/v1/contracts/v1.js ->
 * packages/types/generated/api-v1.d.ts), not written here.
 *
 * @typedef {import('../../../packages/types/index.js').ApiV1.QubSearchResultsAnswer} SearchAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.QubRecordRecordAnswer} RecordAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.QubRecordStatsAnswer} StatsAnswer
 * @typedef {SearchAnswer['results'][number]} ResultRow
 */
import { API, PAGE_SIZE } from './config.js';
import { searchQuery } from './url-state.js';

/** @typedef {import('./url-state.js').SearchState} SearchState */

/**
 * GET a JSON answer; an HTTP error rejects with the answer's `error` text when there is one.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<unknown>}
 */
async function getJson(url, signal) {
  const response = await fetch(url, signal ? { signal } : {});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String(body.error) : `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body;
}

/** The API's query for a search page. @param {SearchState} s @param {number} offset */
export function searchUrl(s, offset) {
  const base = searchQuery(s);
  const sep = base ? '&' : '?';
  return `${API.search}${base}${sep}limit=${PAGE_SIZE}&offset=${offset}`;
}

/** @param {SearchState} s @param {number} offset @param {AbortSignal} [signal] */
export const search = async (s, offset, signal) => /** @type {SearchAnswer} */ (await getJson(searchUrl(s, offset), signal));

/** @param {string} id @param {AbortSignal} [signal] */
export const record = async (id, signal) => /** @type {RecordAnswer} */ (await getJson(`${API.record}?id=${encodeURIComponent(id)}`, signal));

/** @param {AbortSignal} [signal] */
export const stats = async (signal) => /** @type {StatsAnswer} */ (await getJson(API.record, signal));

/** The CSV export's address for a search. @param {SearchState} s */
export const exportUrl = (s) => `${API.export}${searchQuery(s)}`;
