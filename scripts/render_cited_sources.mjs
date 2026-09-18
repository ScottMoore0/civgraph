#!/usr/bin/env node
/**
 * Render cited sources that only show their content in a real browser.
 *
 * The plain fetch in scripts/harvest_wikipedia_cited_sources.py got near-empty pages from
 * ElectionsIreland, irelandelection.com and some BBC results pages: the results are drawn
 * by JavaScript after load. This opens each one in headless Chromium, waits for the network
 * to settle, and saves the rendered HTML beside the fetched files.
 *
 * Polite: robots.txt checked for every host before starting (these hosts allow it), one
 * page at a time, at least 3 s between requests to the same host, and an identifying
 * suffix on the browser's user agent.
 *
 * Input:  .cache/wikipedia-sources/render-targets.json  [{key, url, host}]
 * Output: .cache/wikipedia-sources/files/<sha1(url)>.rendered.html
 *         .cache/wikipedia-sources/rendered.jsonl  one row per target (resumable), in the
 *         fetch.jsonl row shape with source "rendered"; merge into fetch.jsonl afterwards.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = '.cache/wikipedia-sources';
const FILES = path.join(OUT, 'files');
const LOG = path.join(OUT, 'rendered.jsonl');
const HOST_GAP_MS = 3000;
const IDENT = ' civgraph.net-source-verification (+https://civgraph.net)';

const targets = JSON.parse(readFileSync(path.join(OUT, 'render-targets.json'), 'utf8'));
const done = new Set(existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
const todo = targets.filter((t) => !done.has(t.key));
console.log(`render: ${targets.length} targets, ${done.size} done, ${todo.length} to go`);

async function robotsAllows(origin, pathname) {
  try {
    const res = await fetch(`${origin}/robots.txt`);
    if (!res.ok) return true;
    let applies = false;
    const disallow = [];
    for (const raw of (await res.text()).split('\n')) {
      const line = raw.replace(/#.*/, '').trim();
      const [field, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      if (/^user-agent$/i.test(field)) applies = value === '*';
      else if (applies && /^disallow$/i.test(field) && value) disallow.push(value);
    }
    return !disallow.some((prefix) => pathname.startsWith(prefix));
  } catch {
    return true;
  }
}

const browser = await chromium.launch();
const baseUa = (await browser.newPage()).evaluate(() => navigator.userAgent);
const context = await browser.newContext({ userAgent: (await baseUa).replace('HeadlessChrome', 'Chrome') + IDENT, serviceWorkers: 'block' });
const page = await context.newPage();
const lastByHost = new Map();
const robotsCache = new Map();
let ok = 0;

for (const [n, target] of todo.entries()) {
  const url = new URL(target.url);
  const row = { key: target.key, url: target.url };
  if (!robotsCache.has(url.origin)) robotsCache.set(url.origin, null);
  const allowed = await robotsAllows(url.origin, url.pathname + url.search);
  if (!allowed) {
    appendFileSync(LOG, `${JSON.stringify({ ...row, source: null, outcome: 'robots-disallowed' })}\n`);
    continue;
  }
  const wait = (lastByHost.get(url.host) || 0) + HOST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastByHost.set(url.host, Date.now());
  try {
    const response = await page.goto(target.url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);
    const htmlText = await page.content();
    const textLength = await page.evaluate(() => document.body?.innerText?.length || 0);
    const name = `${createHash('sha1').update(target.url).digest('hex')}.rendered.html`;
    const file = path.join(FILES, name).replace(/\\/g, '/');
    writeFileSync(file, htmlText);
    const status = response?.status() ?? null;
    const good = status !== null && status < 400;
    appendFileSync(LOG, `${JSON.stringify({
      ...row, source: good ? 'rendered' : null, outcome: good ? 'ok' : 'http-error', status, finalUrl: page.url(),
      contentType: 'text/html; rendered', bytes: Buffer.byteLength(htmlText), textLength,
      sha256: createHash('sha256').update(htmlText).digest('hex'), file, truncated: false,
    })}\n`);
    ok += good ? 1 : 0;
  } catch (error) {
    appendFileSync(LOG, `${JSON.stringify({ ...row, source: null, outcome: 'render-error', error: String(error.message || error).slice(0, 200) })}\n`);
  }
  if ((n + 1) % 25 === 0 || n + 1 === todo.length) console.log(`  rendered ${n + 1}/${todo.length} | ok ${ok}`);
}
await browser.close();
