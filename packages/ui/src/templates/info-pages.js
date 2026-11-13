/**
 * The information pages: Privacy, Licence, How to cite and Downloads (site/pages/*.html).
 *
 * They were drafted on 11 Nov 2026 and are held back until the owner approves them. One flag,
 * INFO_PAGES_LIVE, decides everything that makes them public:
 *
 *   false (now)  each page carries <meta name="robots" content="noindex"> (its site:draft-head
 *                region) and the draft banner (its site:draft-banner region); the footer does
 *                not link them; the sitemap does not list them.
 *   true         the noindex line and the banner are gone, the footer links all four (and its
 *                meta line names the licence), and the sitemap lists them.
 *
 * To go live: set it to true, then run
 *   node scripts/build/build-site-partials.mjs   (pages: noindex and banner out, footer links in)
 *   node scripts/build/build-sitemap.mjs         (sitemap)
 * build-site-partials --check refuses the flip while any page still has an OWNER TODO note
 * (class="owner-note"). LANDING.md of the `pages` stream lists the rest (short URLs, About).
 *
 * The Privacy page's "last updated" date is the day the pages go live (owner decision PG9). Until
 * then it is a placeholder, <time data-placeholder="last-updated-at-go-live">; the first
 * build-site-partials run with the flag set writes that day's date in its place, and --check
 * fails while a live page still holds the placeholder.
 */
import { dateText } from '../../../core/src/format.js';

/** Whether the information pages are public. Owner's decision; see the comment above. */
export const INFO_PAGES_LIVE = false;

/** The pages, in footer order. */
export const INFO_PAGES = Object.freeze([
  Object.freeze({ file: 'site/pages/downloads.html', path: '/pages/downloads', label: 'Downloads' }),
  Object.freeze({ file: 'site/pages/cite.html', path: '/pages/cite', label: 'How to cite' }),
  Object.freeze({ file: 'site/pages/licence.html', path: '/pages/licence', label: 'Licence' }),
  Object.freeze({ file: 'site/pages/privacy.html', path: '/pages/privacy', label: 'Privacy' }),
]);

/** The draft head line: noindex while the pages are drafts, nothing once they are live. */
export function draftHead(live = INFO_PAGES_LIVE) {
  return live ? '' : '<meta name="robots" content="noindex">';
}

/** The draft banner at the top of each page's main content, nothing once they are live. */
export function draftBanner(live = INFO_PAGES_LIVE) {
  return live ? '' : '<p class="draft-banner"><strong>Draft, not yet published.</strong> This page is not linked from the site and is hidden from search engines until the owner approves it.</p>';
}

/** The footer's links to the pages: none while they are drafts. */
export function footerLinks(live = INFO_PAGES_LIVE) {
  return live ? INFO_PAGES.map((p) => `<a href="${p.path}">${p.label}</a>`) : [];
}

/** The footer's meta line. */
export function footerMeta(live = INFO_PAGES_LIVE) {
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
 * @param {string} isoDate  YYYY-MM-DD, the day the pages go live
 */
export function fillLastUpdated(html, isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`fillLastUpdated(): not a date: ${isoDate}`);
  return html.replace(PLACEHOLDER, `<time datetime="${isoDate}">${dateText(isoDate)}</time>`);
}
