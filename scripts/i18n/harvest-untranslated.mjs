#!/usr/bin/env node
/**
 * Open the site in a headless browser with Irish switched on and list the visible text that
 * is still English, page by page: what en.json / data/i18n/strings still lack.
 *
 *   node tools/test-site/server.mjs --port 4177 &      (or any server of the working tree)
 *   node scripts/i18n/harvest-untranslated.mjs [--base http://127.0.0.1:4177] [--lang ga]
 *
 * Writes tmp/i18n/untranslated-runtime.json: [{text, pages, count}] sorted by count. Data
 * (map, place, party and person names, numbers) is in the list too; it is a worklist, not a
 * verdict. Nothing is sent anywhere except to the local server.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg('--base', 'http://127.0.0.1:4177');
const LANG = arg('--lang', 'ga');
const PAGES = [
  '/', '/maps/', '/maps/#cat=elections', '/browse/', '/browse/#/maps', '/browse/#/elections', '/browse/#/persons',
  '/browse/#/parties', '/browse/#/sources', '/apps/', '/pages/about.html', '/pages/census-explorer.html', '/pages/status.html', '/no-such-page'
];

const browser = await chromium.launch();
const found = new Map();
for (const path of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // The preview flag the Maps search phrase sets (src/catalogue/lang-reveal.js), set directly.
  await page.addInitScript(() => { try { localStorage.setItem('civgraph.langPreview', '1'); } catch { /* none */ } });
  const sep = path.includes('?') ? '&' : '?';
  const [p, hash] = path.split('#');
  const url = `${BASE}${p}${sep}lang=${LANG}${hash ? `#${hash}` : ''}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.civgraphI18n && document.documentElement.dataset.uiLang, null, { timeout: 15000 });
    await page.waitForTimeout(4000);
    const texts = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('script,style,svg,code,pre,[translate="no"],[data-i18n-skip]')) continue;
        const s = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (!/[A-Za-z]{3}/.test(s)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        out.push(s);
      }
      for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
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
    console.error(`${path}: ${error.message.split('\n')[0]}`);
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
