/**
 * Server-rendered record pages (frontend-plan.md section 4, step F3a): persons, sources and
 * register-of-interests entries, rendered completely on the server from their browse_* D1
 * rows, in the shared shell. Elections, contests and parties follow with D2, maps with D3.
 *
 * BEHIND A FLAG. The live /browse/<type>/<slug> routes keep serving the Browse app shell
 * with the record's head (functions/_browse-page.js) unless the deployment says otherwise:
 *
 *   CIVGRAPH_SSR_RECORDS = "persons,sources,register-interests" (or "all")
 *       serve these types server-rendered to everyone: the switch-over, one type at a time.
 *   CIVGRAPH_SSR_PREVIEW = "1"
 *       additionally honour ?ssr=1 on any of them, as a noindex, uncached preview.
 *
 * Neither variable is set in wrangler.toml, so production is unchanged until the owner
 * sets one. `npm run dev:records` sets both locally.
 */
import { runtimeVar } from '../../../../config/src/config.js';
import { toHtmlString } from '../../../../core/src/html.js';
import { page, sectionNav } from '../shell.js';
import { electionBody } from './election.js';
import { partyBody } from './party.js';
import { personBody } from './person.js';
import { registerInterestBody } from './register-interest.js';
import { sourceBody } from './source.js';

export const SSR_RECORD_TYPES = {
  persons: { body: personBody, crumb: 'People', listHash: '#/persons' },
  sources: { body: sourceBody, crumb: 'Sources', listHash: '#/sources' },
  'register-interests': { body: registerInterestBody, crumb: 'Register of interests', listHash: '#/register-interests' },
  // From the records tables (data design phase 2): an election page is assembled from several
  // rows (packages/api/src/pages/election.js loadElectionPage), a party from party_cards.
  elections: { body: electionBody, crumb: 'Elections', listHash: '#/elections' },
  parties: { body: partyBody, crumb: 'Parties', listHash: '#/parties' },
};

/**
 * How a record page is served (refactor FN-L, a mode, not a machine: chosen per request from
 * the environment, with no transitions):
 *   legacy        the Browse shell, rendered in the browser
 *   ssr           the server-rendered page (the type is listed in CIVGRAPH_SSR_RECORDS, or 'all')
 *   ssr-preview   the server-rendered page as a preview (CIVGRAPH_SSR_PREVIEW=1 and ?ssr=1)
 * @typedef {'legacy' | 'ssr' | 'ssr-preview'} SsrMode
 */
export const SSR_MODES = Object.freeze(/** @type {SsrMode[]} */ (['legacy', 'ssr', 'ssr-preview']));

/** The two flags each mode means; no mode is a preview that is not server-rendered. */
const SSR_MODE_FLAGS = Object.freeze(/** @type {Record<SsrMode, { ssr: boolean, preview: boolean }>} */ ({
  legacy: Object.freeze({ ssr: false, preview: false }),
  ssr: Object.freeze({ ssr: true, preview: false }),
  'ssr-preview': Object.freeze({ ssr: true, preview: true }),
}));

/**
 * The mode of this request.
 * @param {{ CIVGRAPH_SSR_RECORDS?: string, CIVGRAPH_SSR_PREVIEW?: string } | null | undefined} env  the Function's env
 * @param {string} type
 * @param {URL} [url]
 * @returns {SsrMode}
 */
export function ssrModeName(env, type, url) {
  if (!SSR_RECORD_TYPES[/** @type {keyof typeof SSR_RECORD_TYPES} */ (type)]) return 'legacy';
  const listed = runtimeVar(env, 'CIVGRAPH_SSR_RECORDS').split(',').map((s) => s.trim()).filter(Boolean);
  if (listed.includes('all') || listed.includes(type)) return 'ssr';
  const previewAllowed = String(env?.CIVGRAPH_SSR_PREVIEW || '') === '1';
  if (previewAllowed && url?.searchParams?.get('ssr') === '1') return 'ssr-preview';
  return 'legacy';
}

/**
 * Whether this request gets the server-rendered page, and whether as a preview.
 * @param {Parameters<typeof ssrModeName>[0]} env  the Function's env
 * @param {string} type
 * @param {URL} [url]
 * @returns {{ ssr: boolean, preview: boolean }}
 */
export function ssrMode(env, type, url) {
  return { ...SSR_MODE_FLAGS[ssrModeName(env, type, url)] };
}

/**
 * The whole page as a string.
 * @param {object} p
 * @param {string} p.type        persons | sources | register-interests
 * @param {object} p.record      the browse_* record JSON
 * @param {{title: string, description: string}} p.meta   the head the Browse page already computes
 * @param {string} p.pageTitle   <title>
 * @param {string} p.canonical
 * @param {boolean} [p.preview]
 */
export function renderRecordPage({ type, record, meta, pageTitle, canonical, preview = false }) {
  const config = SSR_RECORD_TYPES[/** @type {keyof typeof SSR_RECORD_TYPES} */ (type)];
  if (!config) throw new Error(`no server-rendered template for ${type}`);
  // Each type's body takes that type's record; the caller passes the record of `type`.
  const { body, jsonLd } = /** @type {(record: object, options: { canonical?: string }) => { body: import('../../../../core/src/html.js').SafeHtml, jsonLd: object }} */ (config.body)(record, { canonical });
  const crumbs = sectionNav({
    items: [
      { href: '/browse/', label: 'Browse' },
      { href: `/browse/${config.listHash}`, label: config.crumb },
      { label: meta.title },
    ],
  });
  return toHtmlString(page({
    title: pageTitle,
    description: meta.description,
    canonical,
    section: 'browse',
    robots: preview ? 'noindex' : undefined,
    jsonLd,
    body: [crumbs, body],
  }));
}
