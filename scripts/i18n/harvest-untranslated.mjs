#!/usr/bin/env node
/**
 * Open the site in a headless browser with Irish switched on and list the visible text that
 * is still English, page by page: what en.json / data/i18n/strings still lack.
 *
 *   node tools/dev-site/server.mjs --port 4177 &      (or any server of the working tree)
 *   node scripts/i18n/harvest-untranslated.mjs [--base http://127.0.0.1:4177] [--lang ga]
 *
 * Writes tmp/i18n/untranslated-runtime.json: [{text, pages, count}] sorted by count. Data
 * (map, place, party and person names, numbers) is in the list too; it is a worklist, not a
 * verdict. Nothing is sent anywhere except to the local server.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * The browser globals the page callbacks below use. This script is type-checked with Node's
 * library and no DOM (config/tsconfig.pipeline.json), and each callback runs in the page, so it
 * casts globalThis to this shape itself (a callback cannot reach this module's names).
 * @typedef {{ closest(selector: string): PageElement | null, getBoundingClientRect(): { width: number, height: number }, getAttribute(name: string): string | null }} PageElement
 * @typedef {{ nodeValue: string | null, parentElement: PageElement | null }} PageText
 * @typedef {{
 *   localStorage: { setItem(key: string, value: string): void },
 *   civgraphI18n?: object,
 *   NodeFilter: { SHOW_TEXT: number },
 *   document: {
 *     body: unknown,
 *     documentElement: { dataset: Record<string, string | undefined> },
 *     createTreeWalker(root: unknown, whatToShow: number): { nextNode(): PageText | null },
 *     querySelectorAll(selector: string): Iterable<PageElement>
 *   }
 * }} PageGlobals
 */

/**
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? String(process.argv[i + 1]) : fallback; };
const BASE = arg('--base', 'http://127.0.0.1:4177');
const LANG = arg('--lang', 'ga');
const PAGES = [
  '/', '/maps/', '/maps/#cat=elections', '/browse/', '/browse/#/maps', '/browse/#/elections', '/browse/#/persons',
  '/browse/#/parties', '/browse/#/sources', '/apps/', '/pages/about.html', '/pages/census-explorer.html', '/pages/status.html', '/no-such-page'
];

const browser = await chromium.launch();
/** @type {Map<string, { text: string, pages: Set<string>, count: number }>} */
const found = new Map();
for (const path of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // The preview flag the Maps search phrase sets (src/catalogue/lang-reveal.js), set directly.
  await page.addInitScript(() => { try { /** @type {PageGlobals} */ (/** @type {unknown} */ (globalThis)).localStorage.setItem('civgraph.langPreview', '1'); } catch { /* none */ } });
  const sep = path.includes('?') ? '&' : '?';
  const [p, hash] = path.split('#');
  const url = `${BASE}${p}${sep}lang=${LANG}${hash ? `#${hash}` : ''}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
      const g = /** @type {PageGlobals} */ (/** @type {unknown} */ (globalThis));
      return g.civgraphI18n && g.document.documentElement.dataset.uiLang;
    }, null, { timeout: 15000 });
    await page.waitForTimeout(4000);
    const texts = await page.evaluate(() => {
      const g = /** @type {PageGlobals} */ (/** @type {unknown} */ (globalThis));
      /** @type {string[]} */
      const out = [];
      const walker = g.document.createTreeWalker(g.document.body, g.NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('script,style,svg,code,pre,[translate="no"],[data-i18n-skip]')) continue;
        const s = String(n.nodeValue).replace(/\s+/g, ' ').trim();
        if (!/[A-Za-z]{3}/.test(s)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        out.push(s);
      }
      for (const el of g.document.querySelectorAll('[title],[aria-label],[placeholder]')) {
        for (const a of ['title', 'aria-label', 'placeholder']) {
          const v = el.getAttribute(a);
          if (v && /[A-Za-z]{3}/.test(v)) out.push(`@${a}: ${v}`);
        }
      }
      return out;
    });
    for (const t of texts) {
      const rec = found.get(t) || { text: t, pages: new Set(), count: 0 };
      rec.pages.add(path);
      rec.count += 1;
      found.set(t, rec);
    }
  } catch (error) {
    console.error(`${path}: ${/** @type {Error} */ (error).message.split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();

// Anything identical in English and the target counts as untranslated; a later step filters
// what is genuinely data.
const list = [...found.values()].map((r) => ({ text: r.text, pages: [...r.pages], count: r.count })).sort((a, b) => b.count - a.count);
mkdirSync('tmp/i18n', { recursive: true });
writeFileSync('tmp/i18n/untranslated-runtime.json', JSON.stringify(list, null, 1));
console.log(`${list.length} distinct visible strings still in their original form (tmp/i18n/untranslated-runtime.json)`);
