/**
 * Embeds (el-context, 14 Nov 2026): the widget's address for an election or one contest, the
 * HTML snippet a reader copies, whether the app offers it, and the licences the widget names.
 * Pure (no DOM): unit test elections-app-embed.test.mjs.
 *
 * SWITCHED OFF until the owner approves the app going public. Two switches, both off:
 *   1. config.js EMBED.offered: false. The app shows no "Embed this" panel. On a local server
 *      (localhost, 127.0.0.1) the panel can be previewed with localStorage
 *      `civgraph.electionsEmbedPreview` = '1'; never on any other host.
 *   2. site/_headers, the /apps/elections/embed/* block: frame-ancestors 'self', so only
 *      civgraph.net itself may frame the widget.
 * To switch embeds on: set EMBED.offered to true, and change that frame-ancestors directive to
 * `*` (or to the sites allowed); elections-app-prep's "embedding is off" test changes with it.
 *
 * Licences: Civgraph's own compilation is CC BY 4.0; each source keeps its own licence, named from
 * the source ledger's slice (embed/licences.json, scripts/build/elections-app/embed-licences.mjs)
 * by the host of the source's link.
 */

/** The widget's own words (embed/embed.js). */
export const WIDGET_TEXT = Object.freeze({
  loading: 'Loading…',
  failed: 'This result could not be loaded.',
  party: 'Party',
  seats: 'Seats',
  share: 'Share',
  candidate: 'Candidate',
  votes: 'Votes',
  firstPrefs: 'First preferences',
  outcome: 'Outcome',
  elected: 'Elected',
  unopposed: 'Returned unopposed',
  notElected: 'Not elected',
  source: 'Source:',
  sourceTail: 'Civgraph Elections, with the source of every figure.',
  own: "Civgraph's compilation:",
  sourcesOwn: 'Its sources keep their own licences:',
  sourcesOther: 'and other sources under their own terms (listed on the page).',
  sourcesListed: 'Its sources keep their own licences, listed on the page.',
  licencePage: 'Licences',
  /** A pattern: {n} is a number. */
  nSeats: '{n} seats',
});

/** The widget's path on this site. */
export const EMBED_PATH = '/apps/elections/embed/';

/**
 * The widget's URL for an election (its slug) and, optionally, one contest.
 * @param {string} origin @param {string} election @param {string | null} [contest]
 */
export function embedUrl(origin, election, contest = null) {
  const q = new URLSearchParams({ e: election });
  if (contest) q.set('c', contest);
  return `${String(origin).replace(/\/$/, '')}${EMBED_PATH}?${q}`;
}

/** The widget's parameters from its query string. @param {string} search */
export function embedParams(search) {
  const q = new URLSearchParams(search);
  const clean = (/** @type {string | null} */ v) => (v && /^[a-z0-9][a-z0-9-]*$/i.test(v) ? v : null);
  return { election: clean(q.get('e')), contest: clean(q.get('c')) };
}

/** HTML-escape for an attribute or text (the snippet is built before any page escaping). @param {unknown} s */
const attr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The snippet a reader pastes into their page: an iframe of the widget, titled, with a plain link
 * back for readers whose page strips iframes.
 * @param {{ origin: string, election: string, contest?: string | null, title: string, height?: number }} o
 */
export function embedSnippet({ origin, election, contest = null, title, height = contest ? 460 : 420 }) {
  const src = embedUrl(origin, election, contest);
  const page = `${String(origin).replace(/\/$/, '')}/elections/${encodeURIComponent(election)}/${contest ? `${encodeURIComponent(contest)}/` : ''}`;
  return `<iframe src="${attr(src)}" title="${attr(title)}" width="100%" height="${height}" style="border:0;max-width:36rem" loading="lazy"></iframe>\n`
    + `<p><a href="${attr(page)}">${attr(title)}</a> (Civgraph Elections, CC BY 4.0)</p>`;
}

/** Hosts where the embed panel may be previewed by localStorage (development only). */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.localhost)$/;
/** localStorage key that previews the embed panel on a local server. */
export const EMBED_PREVIEW_KEY = 'civgraph.electionsEmbedPreview';

/**
 * Whether the app offers the embed panel: the config switch, or a local preview.
 * @param {boolean} offered config.js EMBED.offered @param {string} hostname @param {string | null} preview the localStorage value
 */
export function embedOffered(offered, hostname, preview) {
  if (offered) return true;
  return preview === '1' && LOCAL_HOST.test(String(hostname || ''));
}

/**
 * The licence slice's shape (embed/licences.json).
 * @typedef {{ id: string, publisher: string, rights: string, title: string, url?: string, hosts: string[] }} LicenceSource
 * @typedef {{ own: { title: string, url: string }, licencePage: string, sources: LicenceSource[] }} LicenceSlice
 */

/** The host of a URL, lower case, without "www."; '' when it is not one. @param {unknown} url */
export function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/**
 * The licences of a result's sources: each ledger source matched by its links' hosts (a host or a
 * subdomain of one), once each, and how many links matched none.
 * @param {readonly unknown[]} urls the sources' links
 * @param {LicenceSlice} slice
 * @returns {{ named: LicenceSource[], unmatched: number }}
 */
export function sourceLicences(urls, slice) {
  /** @type {Map<string, LicenceSource>} */
  const named = new Map();
  let unmatched = 0;
  for (const url of urls) {
    const host = hostOf(url);
    if (!host) continue;
    // The most specific match wins (data.gov.ie over gov.ie).
    /** @type {LicenceSource | null} */
    let src = null;
    let best = 0;
    for (const s of slice.sources) {
      for (const h of s.hosts) if ((host === h || host.endsWith(`.${h}`)) && h.length > best) { src = s; best = h.length; }
    }
    if (src) named.set(src.id, src);
    else unmatched += 1;
  }
  return { named: [...named.values()], unmatched };
}
