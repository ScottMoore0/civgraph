#!/usr/bin/env node
/**
 * Enumerate the NISRA publications catalogue (nisra.gov.uk/publications, a
 * paginated Drupal listing — no data API is reachable). Emits a compact
 * inventory of { slug, title } for every publication, which feeds
 * emit-nisra-publication-records.mjs. Non-census filtering happens at emit time.
 *
 * Politeness: one GET at a time, with no User-Agent of ours (crawlHeaders(): the fetch default
 * applies, owner rule 13 Nov 2026) and at least MIN_DELAY_MS between requests, retries included. It stops after two
 * empty pages in a row, and stops the whole run (writing nothing) on a 403 or 429 or a bot
 * challenge: those are never retried or worked around.
 *
 * Usage: node scripts/ingest/census/crawl-nisra-publications.mjs <outPath> [maxPage] [delayMs]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlHeaders } from '../../../packages/config/src/node.mjs';

export const BASE = 'https://www.nisra.gov.uk/publications';
export const MIN_DELAY_MS = 1500;
export const DEFAULT_DELAY_MS = 2000;
const ATTEMPTS = 4;
const TIMEOUT_MS = 40_000;

/** A response the crawl must stop on: refused, rate-limited or challenged. */
export class CrawlRefused extends Error {
  /** @param {string} message @param {number} status @param {string} url */
  constructor(message, status, url) {
    super(message);
    this.name = 'CrawlRefused';
    this.status = status;
    this.url = url;
  }
}

const CHALLENGE_RE = /cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|<title>\s*(?:just a moment|attention required)/i;

/** @param {string} html */
export function looksLikeChallenge(html) {
  return CHALLENGE_RE.test(html);
}

/** @param {string} s */
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/**
 * The publication cards on one listing page, in page order.
 * @param {string} html
 * @returns {{ slug: string, title: string }[]}
 */
export function parseCards(html) {
  const cardRe = /href="\/publications\/([a-z0-9-]+)">\s*<h3 class="card__title"><span>([^<]+)</g;
  /** @type {{ slug: string, title: string }[]} */
  const out = [];
  let m;
  while ((m = cardRe.exec(html))) out.push({ slug: /** @type {string} */ (m[1]), title: decode(/** @type {string} */ (m[2])) });
  return out;
}

/**
 * @typedef {object} CrawlDeps
 * @property {(url: string, init: { headers: Record<string, string>, redirect: 'follow', signal: AbortSignal }) => Promise<{ status: number, ok: boolean, text: () => Promise<string> }>} fetch
 * @property {(ms: number) => Promise<void>} sleep
 * @property {(line: string) => void} [log]
 */

/**
 * Crawl pages 0..maxPage, one request at a time, waiting `delayMs` before every request but the
 * first. A page whose fetch fails after every attempt counts as empty (as the curl version did).
 * @param {{ maxPage?: number, delayMs?: number, base?: string }} opts
 * @param {CrawlDeps} deps
 * @returns {Promise<{ publications: { slug: string, title: string }[], requests: number, pages: number }>}
 */
export async function crawl({ maxPage = 200, delayMs = DEFAULT_DELAY_MS, base = BASE } = {}, deps) {
  const wait = Math.max(MIN_DELAY_MS, delayMs);
  const log = deps.log ?? (() => {});
  let requests = 0;

  /** @param {string} url */
  async function get(url) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      if (requests > 0) await deps.sleep(wait);
      requests += 1;
      try {
        const res = await deps.fetch(url, {
          headers: crawlHeaders({ Accept: 'text/html' }),
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status === 403 || res.status === 429) throw new CrawlRefused(`HTTP ${res.status}`, res.status, url);
        const html = await res.text();
        if (looksLikeChallenge(html)) throw new CrawlRefused('bot challenge or CAPTCHA in the answer', res.status, url);
        if (res.ok) return html;
        log(`${url}: HTTP ${res.status} (attempt ${attempt})`);
      } catch (e) {
        if (e instanceof CrawlRefused) throw e;
        log(`${url}: ${e instanceof Error ? e.message : String(e)} (attempt ${attempt})`);
      }
    }
    return '';
  }

  /** @type {Map<string, string>} */
  const bySlug = new Map();
  let emptyStreak = 0;
  let pages = 0;
  for (let page = 0; page <= maxPage; page += 1) {
    const cards = parseCards(await get(`${base}?page=${page}`));
    pages += 1;
    for (const { slug, title } of cards) if (!bySlug.has(slug)) bySlug.set(slug, title);
    log(`page ${page}: +${cards.length} (total ${bySlug.size}, requests ${requests})`);
    if (cards.length === 0) { emptyStreak += 1; if (emptyStreak >= 2) break; } else emptyStreak = 0;
  }
  return { publications: [...bySlug].map(([slug, title]) => ({ slug, title })), requests, pages };
}

/** The harvest file, byte for byte as the curl version wrote it. @param {{ slug: string, title: string }[]} publications */
export function harvestJson(publications) {
  return JSON.stringify({ generatedFrom: 'nisra.gov.uk/publications', count: publications.length, publications }, null, 0) + '\n';
}

async function main() {
  const OUT = process.argv[2] || 'data/census/candidates/nisra-publications.json';
  const MAX_PAGE = Number(process.argv[3] || 200);
  const DELAY = Number(process.argv[4] || DEFAULT_DELAY_MS);
  try {
    const { publications, requests, pages } = await crawl({ maxPage: MAX_PAGE, delayMs: DELAY }, {
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (line) => process.stderr.write(`${line}\n`),
    });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, harvestJson(publications));
    console.log(`Wrote ${OUT}: ${publications.length} publications (${pages} pages, ${requests} requests)`);
  } catch (e) {
    if (e instanceof CrawlRefused) {
      console.error(`STOPPED: ${e.message} at ${e.url}. Nothing written; do not retry or work around it.`);
      process.exit(2);
    }
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
