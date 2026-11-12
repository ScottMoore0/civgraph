/**
 * Link previews: the tags a page carries so a pasted link shows a title, a description and a
 * picture (Open Graph for Facebook, LinkedIn, Slack, WhatsApp, Bluesky, Mastodon; the Twitter
 * card for X).
 *
 * WHY ONE MODULE
 *
 * The QA pass of 11 Nov 2026 (docs/tasks/qa-launch-readiness-2026-11-11.md, H1 and L3) found
 * every Browse record with og:title but no og:image or twitter:card, /browse/ with none at all,
 * About, Words and every PRONI record with no Open Graph, and the homepage and map page each
 * with their own partial set. Every server-rendered head (functions/_browse-page.js,
 * functions/_proni-shell.js, page() in shell.js) now takes its tags from here, and
 * tests/unit/share-meta.test.mjs holds the static pages to the same set.
 *
 * No file system, no DOM: this runs in Pages Functions and in Node.
 */
import { SITE } from '../../../config/src/config.js';

/**
 * The default share image: 1200x630, the Open Graph size X also takes for summary_large_image.
 * Rebuilt by scripts/build/og-preview.mjs; it carries no counts, so it cannot go stale.
 *
 * ?v= is the first 12 hex digits of the file's SHA-256. Facebook, X, LinkedIn and Slack keep a
 * shared image by its URL for days, so a new picture needs a new URL; after rebuilding the image,
 * set SHARE_IMAGE_VERSION to the hash og-preview.mjs prints (tests/unit/share-meta.test.mjs fails
 * until it matches) and re-stamp the static pages' heads.
 */
export const SHARE_IMAGE_VERSION = '96771fe39997';
export const SHARE_IMAGE = Object.freeze({
  url: `${SITE.origin}/assets/images/og-preview.png?v=${SHARE_IMAGE_VERSION}`,
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Civgraph, the civic record of Ireland: the name and logo beside a map of Ireland with its county boundaries.',
});

const escapeAttr = (/** @type {unknown} */ value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * @typedef {object} ShareHead
 * @property {string} title          the page's title, as in <title>
 * @property {string | undefined} [description]
 * @property {string} url            the canonical, absolute URL
 * @property {string | undefined} [type]         og:type: 'website' (default), 'profile', 'article'
 * @property {{ url: string, width: number, height: number, type?: string, alt?: string }} [image]
 */

/**
 * The tags as [attribute, key, content] triples, in the order they are written: Open Graph
 * (property=) then the Twitter card (name=).
 * @param {ShareHead} head
 * @returns {Array<['property' | 'name', string, string]>}
 */
export function shareTagList({ title, description, url, type = 'website', image = SHARE_IMAGE }) {
  /** @type {Array<['property' | 'name', string, string]>} */
  const tags = [
    ['property', 'og:type', type],
    ['property', 'og:site_name', SITE.name],
    ['property', 'og:url', url],
    ['property', 'og:title', title],
  ];
  if (description) tags.push(['property', 'og:description', description]);
  tags.push(
    ['property', 'og:image', image.url],
    ['property', 'og:image:width', String(image.width)],
    ['property', 'og:image:height', String(image.height)],
  );
  if (image.type) tags.push(['property', 'og:image:type', image.type]);
  if (image.alt) tags.push(['property', 'og:image:alt', image.alt]);
  tags.push(['property', 'og:locale', 'en_GB']);
  tags.push(
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
  );
  if (description) tags.push(['name', 'twitter:description', description]);
  tags.push(['name', 'twitter:image', image.url]);
  if (image.alt) tags.push(['name', 'twitter:image:alt', image.alt]);
  return tags;
}

/**
 * The tags as HTML, one per line.
 * @param {ShareHead} head
 * @param {string} [indent]  put before every line after the first
 * @returns {string}
 */
export function shareTagsHtml(head, indent = '') {
  return shareTagList(head)
    .map(([attr, key, content]) => `<meta ${attr}="${key}" content="${escapeAttr(content)}">`)
    .join(`\n${indent}`);
}

// Every Open Graph and Twitter meta tag, whichever attribute order or quoting it was written in,
// with the newline after it; and the canonical link.
const SHARE_META = /[ \t]*<meta\s+(?:[^>]*?\s)?(?:property|name)\s*=\s*["'](?:og|twitter):[^"']*["'][^>]*>[ \t]*\r?\n?/gi;
const CANONICAL = /<link\s+rel="canonical"[^>]*>/i;

/**
 * Write a page's canonical link and share tags into an HTML document (a static shell served by
 * a Function): every og:* and twitter:* tag already there goes, and the new set is written in
 * place of the canonical link, or before </head> when there is none. String edits, so the same
 * code runs in a Function and under Node; a document with no <head> comes back unchanged.
 * @param {string} html
 * @param {ShareHead} head
 * @returns {string}
 */
export function withShareTags(html, head) {
  const end = html.search(/<\/head>/i);
  if (end < 0) return html;
  const block = `<link rel="canonical" href="${escapeAttr(head.url)}">\n  ${shareTagsHtml(head, '  ')}`;
  // Only the head is rewritten: a page's body may quote such tags (the design-system gallery).
  const top = html.slice(0, end).replace(SHARE_META, '');
  const rest = html.slice(end);
  if (CANONICAL.test(top)) return top.replace(CANONICAL, () => block) + rest;
  return `${top}  ${block}\n${rest}`;
}

/**
 * The share tags a document carries, read back: { 'og:title': '...', 'twitter:card': '...' }.
 * The first of each wins. For tests and checks.
 * @param {string} html
 * @returns {Record<string, string>}
 */
export function readShareTags(html) {
  /** @type {Record<string, string>} */
  const out = {};
  const head = html.split(/<\/head>/i)[0] ?? ''; // split always gives at least one part
  for (const match of head.matchAll(/<meta\s+([^>]*)>/gi)) {
    const attrs = match[1] ?? '';
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const content = /content\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /content\s*=\s*'([^']*)'/i.exec(attrs)?.[1];
    if (!key || content === undefined || key in out) continue;
    out[key] = content.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  const canonical = /<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(head)?.[1];
  if (canonical) out['canonical'] = canonical.replace(/&amp;/g, '&');
  const title = /<title>([^<]*)<\/title>/i.exec(head)?.[1];
  if (title !== undefined) out['title'] = title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return out;
}
