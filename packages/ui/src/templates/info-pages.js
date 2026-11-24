/**
 * The information pages: Privacy, Licence, How to cite and Downloads (site/pages/*.html).
 *
 * They were drafted on 11 Nov 2026 and are held back until the owner approves them, page by
 * page. Each page's `live` flag below decides everything that makes it public:
 *
 *   live: false  the page carries <meta name="robots" content="noindex"> (its site:draft-head
 *                region) and the draft banner (its site:draft-banner region); the footer does
 *                not link it; the sitemap does not list it; no other page links it.
 *   live: true   the noindex line and the banner are gone, the footer links it, and the
 *                sitemap lists it. While the Licence page is live, the footer's meta line
 *                names the licence.
 *
 * Licence and How to cite went live on 24 Nov 2026 (owner); Downloads and Privacy are drafts.
 *
 * To put another page live: set its flag, then run
 *   node scripts/build/build-site-partials.mjs   (pages: noindex and banner out, footer links in)
 *   node scripts/build/build-sitemap.mjs         (sitemap)
 * build-site-partials --check refuses a live page that still has an OWNER TODO note
 * (class="owner-note"), and tests/unit/info-pages.test.mjs a live page that links a draft one.
 *
 * The Privacy page's "last updated" date is the day it goes live (owner decision PG9). Until
 * then it is a placeholder, <time data-placeholder="last-updated-at-go-live">; the first
 * build-site-partials run with the page live writes that day's date in its place, and --check
 * fails while a live page still holds the placeholder.
 */
import { dateText } from '@civgraph/core/format.js';

/**
 * @typedef {{ file: string, path: string, label: string, live: boolean }} InfoPage
 */

/** The pages, in footer order, each with the owner's decision whether it is public. */
export const INFO_PAGES = /** @type {readonly Readonly<InfoPage>[]} */ (Object.freeze([
  Object.freeze({ file: 'site/pages/downloads.html', path: '/pages/downloads', label: 'Downloads', live: false }),
  Object.freeze({ file: 'site/pages/cite.html', path: '/pages/cite', label: 'How to cite', live: true }),
  Object.freeze({ file: 'site/pages/licence.html', path: '/pages/licence', label: 'Licence', live: true }),
  Object.freeze({ file: 'site/pages/privacy.html', path: '/pages/privacy', label: 'Privacy', live: false }),
]));

/** The pages that are public. */
export function livePages(pages = INFO_PAGES) {
  return pages.filter((p) => p.live);
}

/**
 * Whether the page in this file is a live information page (false for any other file).
 * @param {string} file  repository path, as in INFO_PAGES (site/pages/licence.html)
 */
export function isLiveInfoPage(file, pages = INFO_PAGES) {
  return pages.some((p) => p.file === file && p.live);
}

/** Whether the Licence page is public. */
export function licencePageLive(pages = INFO_PAGES) {
  return pages.some((p) => p.path === '/pages/licence' && p.live);
}

/** The draft head line: noindex while a page is a draft, nothing once it is live. */
export function draftHead(live = false) {
  return live ? '' : '<meta name="robots" content="noindex">';
}

/** The draft banner at the top of a page's main content, nothing once it is live. */
export function draftBanner(live = false) {
  return live ? '' : '<p class="draft-banner"><strong>Draft, not yet published.</strong> This page is not linked from the site and is hidden from search engines until the owner approves it.</p>';
}

/** The footer's links to the pages: the live ones only. */
export function footerLinks(pages = INFO_PAGES) {
  return livePages(pages).map((p) => `<a href="${p.path}">${p.label}</a>`);
}

/** The footer's meta line: it names the licence once the Licence page is live. */
export function footerMeta(live = licencePageLive()) {
  return live ? '© Civgraph contributors · <a href="/pages/licence">Licence</a>' : '© Civgraph';
}

/** The marker of the "last updated" date a page gets on the day it goes live (owner decision PG9). */
export const LAST_UPDATED_PLACEHOLDER = 'last-updated-at-go-live';

const PLACEHOLDER = new RegExp(`<time data-placeholder="${LAST_UPDATED_PLACEHOLDER}">[^<]*</time>`, 'g');

/** Whether a page still holds the go-live date placeholder. @param {string} html */
export function hasLastUpdatedPlaceholder(html) {
  return new RegExp(PLACEHOLDER.source).test(html);
}

/**
 * The page with the placeholder replaced by a date.
 * @param {string} html
 * @param {string} isoDate  YYYY-MM-DD, the day the page goes live
 */
export function fillLastUpdated(html, isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`fillLastUpdated(): not a date: ${isoDate}`);
  return html.replace(PLACEHOLDER, `<time datetime="${isoDate}">${dateText(isoDate)}</time>`);
}
