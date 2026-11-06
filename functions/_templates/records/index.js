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
import { toHtmlString } from '../../_lib/html.js';
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
  // rows (functions/_templates/records/election.js loadElectionPage), a party from party_cards.
  elections: { body: electionBody, crumb: 'Elections', listHash: '#/elections' },
  parties: { body: partyBody, crumb: 'Parties', listHash: '#/parties' },
};

/**
 * Whether this request gets the server-rendered page, and whether as a preview.
 * @returns {{ ssr: boolean, preview: boolean }}
 */
export function ssrMode(env, type, url) {
  if (!SSR_RECORD_TYPES[type]) return { ssr: false, preview: false };
  const listed = String(env?.CIVGRAPH_SSR_RECORDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (listed.includes('all') || listed.includes(type)) return { ssr: true, preview: false };
  const previewAllowed = String(env?.CIVGRAPH_SSR_PREVIEW || '') === '1';
  if (previewAllowed && url?.searchParams?.get('ssr') === '1') return { ssr: true, preview: true };
  return { ssr: false, preview: false };
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
  const config = SSR_RECORD_TYPES[type];
  if (!config) throw new Error(`no server-rendered template for ${type}`);
  const { body, jsonLd } = config.body(record, { canonical });
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
