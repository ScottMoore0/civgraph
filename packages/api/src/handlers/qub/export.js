/**
 * GET /_api/qub/export: the matches of a QUB catalogue search as CSV (same parameters as
 * /_api/qub/search), streamed page by page, capped at LIMITS.exportRows rows as the PRONI
 * app's export is. Each row carries its QUB catalogue link (the reuse condition) and the file
 * ends with the credit.
 */
import { binding } from '@civgraph/config';
import { fromD1 } from '@civgraph/storage/d1.js';
import { QUB } from '../../queries/qub.js';
import { buildFilters, buildMatch, csvRow, LIMITS, QUB_CREDIT, qubRecordUrl, readParams } from './_query.js';

export const HEADER = ['MMS ID', 'Title', 'Author', 'Imprint', 'Year', 'Format', 'Language', 'Shelf mark', 'Subjects',
  'Within Civgraph scope', 'Topics', 'Scope reason', 'QUB catalogue record', 'Civgraph page'];

/**
 * One CSV row from an export row.
 * @param {{ mms_id?: unknown, title?: unknown, author?: unknown, imprint?: unknown, year?: unknown, format?: unknown, language?: unknown,
 *   shelf?: unknown, subjects?: unknown, scope?: unknown, tags?: unknown, scope_reason?: unknown }} r
 * @param {string} origin
 */
export function exportCells(r, origin) {
  const id = String(r.mms_id);
  return [id, r.title, r.author, r.imprint, r.year, r.format, r.language, r.shelf, r.subjects,
    Number(r.scope) === 1 ? 'yes' : 'no', String(r.tags || '').split('').join(' '), r.scope_reason,
    qubRecordUrl(id), `${origin}/qub/${id}`];
}

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const p = readParams(url.searchParams);
  const bound = binding(context.env, 'QUB_DB');
  if (!bound) return new Response('QUB_DB binding not configured', { status: 503 });
  const match = buildMatch(p);
  const { where, binds } = buildFilters(p);
  if (!match && !where.length) return new Response('Give a search or a filter to export', { status: 400 });
  const db = fromD1(bound);
  const sql = QUB.exportPage(Boolean(match), where);
  const lead = match ? [match, ...binds] : binds;
  const encoder = new TextEncoder();
  let sent = 0;
  let done = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('﻿' + csvRow(HEADER)));
    },
    async pull(controller) {
      if (done) return;
      const take = Math.min(LIMITS.exportPage, LIMITS.exportRows - sent);
      const rows = take > 0 ? await db.all(sql, [...lead, take, sent]) : [];
      if (rows.length) controller.enqueue(encoder.encode(rows.map((r) => csvRow(exportCells(r, url.origin))).join('')));
      sent += rows.length;
      if (rows.length < take || sent >= LIMITS.exportRows) {
        const note = sent >= LIMITS.exportRows ? `Capped at ${LIMITS.exportRows} rows. ` : '';
        controller.enqueue(encoder.encode(csvRow([]) + csvRow([`${note}${QUB_CREDIT}`])));
        done = true;
        controller.close();
      }
    },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="qub-catalogue-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
