/**
 * The Independent QUB Catalogue app's defaults and limits (architecture rule R6: one config.js per
 * app). The server's own limits are packages/api/src/handlers/qub/_query.js LIMITS; these are what
 * the page asks for. No DOM: the unit tests import it.
 */
export const API = Object.freeze({ search: '/_api/qub/search', record: '/_api/qub/record', export: '/_api/qub/export' });

/** Rows per page of results, and the export cap the page tells the reader about. */
export const PAGE_SIZE = 25;
export const EXPORT_CAP = 50000;

/** The search the page opens with: Within Civgraph scope, any topic, by relevance. */
export const DEFAULTS = Object.freeze({ q: '', scope: 'in', tags: /** @type {string[]} */ ([]), from: '', to: '', sort: 'relevance', dir: 'asc' });

/**
 * The two catalogues every page points to: the whole QUB catalogue harvest on the Internet Archive (this app holds
 * only the records within Civgraph's scope; owner, 27 Nov 2026) and QUB Library's own catalogue.
 */
export const LINKS = Object.freeze({
  archive: 'https://archive.org/details/civgraph-qub-library-catalogue-csv',
  qub: 'https://qublibsearch.qub.ac.uk/',
});

/** The base path of the app's own addresses (/qub, /qub/<mms_id>). */
export const BASE = '/qub';
