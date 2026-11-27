/**
 * GET /_api/qub/record?id=<mms_id>: one QUB catalogue record with its main fields, its Civgraph
 * scope label, the link to the record in QUB's catalogue and the credit (the reuse conditions,
 * _query.js). 404 for an id the catalogue does not hold, 400 for one that is not an MMS ID.
 *
 * GET /_api/qub/record (no id): the catalogue's figures (records, in and out of scope, records
 * per topic) and the topic names, for the app's home page.
 */
import { binding } from '@civgraph/config';
import { fromD1 } from '@civgraph/storage/d1.js';
import { reportError } from '../_error.js';
import { QUB } from '../../queries/qub.js';
import { isMmsId, QUB_CREDIT, QUB_TAGS, qubRecordUrl, tagList } from './_query.js';

/** @typedef {import('@civgraph/types').ApiV1.QubRecordRecordAnswer} QubRecordAnswer */
/** @typedef {import('@civgraph/storage/store.js').RecordStore} RecordStore */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };

/** @param {unknown} v */
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

/**
 * The detail JSON as build-qub-db.py writes it; every field may be missing or of the wrong shape.
 * @typedef {{ resp?: unknown, uniform?: unknown, variant?: unknown, edition?: unknown, extent?: unknown, series?: unknown,
 *   notes?: unknown, contents?: unknown, summary?: unknown, others?: unknown, isbn?: unknown, issn?: unknown, oclc?: unknown,
 *   catSource?: unknown, lc050?: unknown, ddc?: unknown, gov086?: unknown, place752?: unknown, holdings?: unknown, online?: unknown }} RawDetail
 * @typedef {{ name?: unknown, role?: unknown, library?: unknown, location?: unknown, call?: unknown, availability?: unknown, label?: unknown, url?: unknown }} RawEntry
 */

/**
 * The detail JSON (scripts/records/qub/build-qub-db.py) read defensively: a field of the wrong
 * shape is dropped, never passed on.
 * @param {unknown} raw
 */
export function readDetail(raw) {
  /** @type {RawDetail} */
  let d = {};
  try { d = JSON.parse(String(raw || '{}')) || {}; } catch { d = {}; }
  const txt = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
  const objs = (/** @type {unknown} */ v) => (Array.isArray(v) ? /** @type {RawEntry[]} */ (v.filter((x) => x && typeof x === 'object')) : []);
  return {
    responsibility: txt(d.resp), uniformTitle: txt(d.uniform), variantTitles: strings(d.variant), edition: txt(d.edition),
    extent: txt(d.extent), series: strings(d.series), notes: strings(d.notes), contents: txt(d.contents), summary: txt(d.summary),
    contributors: objs(d.others).map((o) => ({ name: txt(o.name), role: txt(o.role) })).filter((o) => o.name),
    isbn: strings(d.isbn), issn: strings(d.issn), oclc: strings(d.oclc), catalogingSource: txt(d.catSource),
    lcClass: txt(d.lc050), dewey: txt(d.ddc), govDocNumber: txt(d.gov086), places: strings(d.place752),
    holdings: objs(d.holdings).map((h) => ({ library: txt(h.library), location: txt(h.location), callNumber: txt(h.call), availability: txt(h.availability) })),
    online: objs(d.online).map((o) => ({ label: txt(o.label), url: txt(o.url) })).filter((o) => /^https?:\/\//.test(o.url)),
  };
}

/** Does the record derive from a shared cataloguing source (OCLC/WorldCat, another library)? @param {ReturnType<typeof readDetail>} d */
export const sharedSource = (d) => d.oclc.length > 0 || /\bOCLC|OCoLC|DLC|Uk\b/.test(d.catalogingSource);

/**
 * The record answer, or null when the catalogue does not hold the id.
 * @param {RecordStore} db
 * @param {string} mmsId
 * @returns {Promise<QubRecordAnswer | null>}
 */
export async function loadRecord(db, mmsId) {
  /**
   * @typedef {{ mmsId: unknown, title: unknown, author: unknown, imprint: unknown, year: unknown, dateText: unknown, format: unknown,
   *   language: unknown, shelf: unknown, subjects: unknown, scope: unknown, tags: unknown, scopeReason: unknown, scopeMethod: unknown,
   *   detail: unknown }} QubItemRow
   */
  const row = /** @type {QubItemRow | null} */ (/** @type {unknown} */ (await db.first(QUB.item, [mmsId])));
  if (!row) return null;
  const detail = readDetail(row.detail);
  const str = (/** @type {unknown} */ v) => (v == null ? '' : String(v));
  return {
    item: {
      mmsId: str(row.mmsId), title: str(row.title) || '(untitled)', author: str(row.author), imprint: str(row.imprint),
      year: row.year == null ? null : Number(row.year), dateText: str(row.dateText), format: str(row.format),
      language: str(row.language), shelfMark: str(row.shelf), subjects: str(row.subjects).split(' | ').filter(Boolean),
      inScope: Number(row.scope) === 1, tags: tagList(row.tags), scopeReason: str(row.scopeReason), scopeMethod: str(row.scopeMethod),
      ...detail,
    },
    qubUrl: qubRecordUrl(str(row.mmsId)),
    credit: QUB_CREDIT,
    sharedSource: sharedSource(detail),
  };
}

/**
 * The catalogue's figures.
 * @param {RecordStore} db
 */
export async function loadStats(db) {
  const rows = /** @type {Array<{ key: unknown, n: unknown }>} */ (/** @type {unknown} */ (await db.all(QUB.stats, [])));
  /** @type {Map<string, number>} */
  const n = new Map(rows.map((r) => [String(r.key), Number(r.n)]));
  return {
    total: n.get('all') ?? 0, inScope: n.get('in') ?? 0, outOfScope: n.get('out') ?? 0,
    tags: Object.entries(QUB_TAGS).map(([tag, name]) => ({ tag, name, count: n.get(`tag:${tag}`) ?? 0 })),
    credit: QUB_CREDIT,
  };
}

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const id = (url.searchParams.get('id') || '').trim();
  const json = (/** @type {unknown} */ body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
  const bound = binding(context.env, 'QUB_DB');
  if (!bound) return json({ error: 'QUB_DB binding not configured' }, 503);
  if (id && !isMmsId(id)) return json({ error: 'Not a QUB record id (an MMS ID: 99…)' }, 400);
  try {
    const db = fromD1(bound);
    if (!id) return json(await loadStats(db));
    const answer = await loadRecord(db, id);
    return answer ? json(answer) : json({ error: 'No such record in the QUB catalogue snapshot' }, 404);
  } catch (error) {
    return json({ error: 'Record lookup failed', ...reportError(context.env, 'qub-record', error) }, 500);
  }
}
