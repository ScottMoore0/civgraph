// The NISRA publications crawler (scripts/ingest/census/crawl-nisra-publications.mjs): it sends no
// User-Agent of ours (owner rule, 13 Nov 2026) and nothing else that identifies anyone, waits at least 1.5 s before every
// request after the first (retries included), stops after two empty pages, and stops the whole run
// on a 403, a 429 or a bot challenge. No network: fetch and sleep are injected.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  crawl, parseCards, harvestJson, looksLikeChallenge, CrawlRefused, MIN_DELAY_MS, DEFAULT_DELAY_MS,
} from '../../scripts/ingest/census/crawl-nisra-publications.mjs';

/** @param {[string, string][]} cards */
const page = (cards) => `<main>${cards.map(([slug, title]) => `<a href="/publications/${slug}">\n  <h3 class="card__title"><span>${title}</span></h3></a>`).join('')}</main>`;

/**
 * @param {Record<number, string | { status: number, body?: string } | Error>} pages
 */
function fakeDeps(pages) {
  /** @type {{ url: string, headers: Record<string, string> }[]} */
  const calls = [];
  /** @type {number[]} */
  const sleeps = [];
  /** @type {string[]} */
  const timeline = [];
  return {
    calls, sleeps, timeline,
    deps: {
      /** @param {string} url @param {{ headers: Record<string, string> }} init */
      fetch: async (url, init) => {
        calls.push({ url, headers: init.headers });
        timeline.push('get');
        const n = Number(new URL(url).searchParams.get('page'));
        const p = pages[n] ?? page([]);
        if (p instanceof Error) throw p;
        const { status, body } = typeof p === 'string' ? { status: 200, body: p } : { status: p.status, body: p.body ?? '' };
        return { status, ok: status >= 200 && status < 300, text: async () => body };
      },
      /** @param {number} ms */
      sleep: async (ms) => { sleeps.push(ms); timeline.push('sleep'); },
    },
  };
}

test('parseCards reads slug and decoded title in page order', () => {
  assert.deepEqual(parseCards(page([['a-b', 'Tom &amp; Jerry&#039;s  &quot;x&quot;'], ['c', 'C']])), [
    { slug: 'a-b', title: 'Tom & Jerry\'s "x"' }, { slug: 'c', title: 'C' },
  ]);
  assert.deepEqual(parseCards(''), []);
});

test('no request carries a User-Agent or any other identifying header', async () => {
  const f = fakeDeps({ 0: page([['a', 'A']]) });
  await crawl({ maxPage: 3 }, f.deps);
  assert.ok(f.calls.length > 0);
  for (const { headers, url } of f.calls) {
    assert.deepEqual(Object.keys(headers), ['Accept']);
    assert.doesNotMatch(JSON.stringify(headers) + url, /@|mailto|from:|civgraph|user-agent/i);
    assert.match(url, /^https:\/\/www\.nisra\.gov\.uk\/publications\?page=\d+$/);
  }
});

test('waits at least 1.5 s before every request but the first, never two GETs back to back', async () => {
  const f = fakeDeps({ 0: page([['a', 'A']]), 1: new Error('reset'), 2: page([['b', 'B']]) });
  await crawl({ maxPage: 10, delayMs: 10 }, f.deps);
  assert.equal(f.timeline[0], 'get');
  for (let i = 1; i < f.timeline.length; i += 1) {
    if (f.timeline[i] === 'get') assert.equal(f.timeline[i - 1], 'sleep', `request ${i} not preceded by a wait`);
  }
  assert.ok(f.sleeps.every((ms) => ms >= MIN_DELAY_MS));
  assert.ok(DEFAULT_DELAY_MS >= MIN_DELAY_MS);
});

test('stops after two empty pages in a row; one empty page does not stop it', async () => {
  const f = fakeDeps({ 0: page([['a', 'A']]), 1: page([]), 2: page([['b', 'B'], ['a', 'A again']]), 3: page([]), 4: page([]), 5: page([['c', 'C']]) });
  const out = await crawl({ maxPage: 200 }, f.deps);
  assert.deepEqual(out.publications, [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }]);
  assert.equal(out.pages, 5);
  assert.equal(out.requests, 5);
  assert.deepEqual(f.calls.map((c) => c.url.split('=')[1]), ['0', '1', '2', '3', '4']);
});

test('stops at maxPage (201 GETs at most for the default 200)', async () => {
  const all = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i, page([[`p${i}`, `P${i}`]])]));
  const f = fakeDeps(all);
  const out = await crawl({}, f.deps);
  assert.equal(out.requests, 201);
  assert.equal(out.publications.length, 201);
});

test('a page that fails every attempt counts as empty, after four polite attempts', async () => {
  const f = fakeDeps({ 0: page([['a', 'A']]), 1: { status: 500 }, 2: page([]) });
  const out = await crawl({ maxPage: 10 }, f.deps);
  assert.equal(f.calls.filter((c) => c.url.endsWith('=1')).length, 4);
  assert.equal(out.pages, 3);
  assert.equal(out.publications.length, 1);
});

for (const status of [403, 429]) {
  test(`HTTP ${status} stops the whole run at once, with no retry`, async () => {
    const f = fakeDeps({ 0: page([['a', 'A']]), 1: { status } });
    await assert.rejects(crawl({ maxPage: 10 }, f.deps), (e) => e instanceof CrawlRefused && e.status === status);
    assert.equal(f.calls.length, 2);
  });
}

test('a bot challenge or CAPTCHA stops the run, even with HTTP 200', async () => {
  const challenge = '<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div></body></html>';
  assert.ok(looksLikeChallenge(challenge));
  assert.ok(looksLikeChallenge('<div class="g-recaptcha" data-sitekey="x"></div>'));
  assert.ok(!looksLikeChallenge(page([['a', 'A']])));
  const f = fakeDeps({ 0: challenge });
  await assert.rejects(crawl({ maxPage: 10 }, f.deps), CrawlRefused);
  assert.equal(f.calls.length, 1);
});

test('harvestJson writes the same bytes as the curl version', () => {
  const pubs = [{ slug: 'a', title: 'A' }];
  assert.equal(harvestJson(pubs), `${JSON.stringify({ generatedFrom: 'nisra.gov.uk/publications', count: 1, publications: pubs }, null, 0)}\n`);
});
