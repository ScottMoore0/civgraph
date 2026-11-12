// The party members view (/_api/parties?slug=&view=members, packages/api/src/handlers/parties/members.js)
// against the local records build: it finds the same people as the cards query it replaces
// (/_api/persons?party=<each name>), carries every field of their election rows the party page
// reads, costs a fraction of the bytes, and reads D1 through indexes only. Skipped without a build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { context, d1, installCaches } from './d1-shim.mjs';
import { resetDatasetMemo } from '../../packages/api/src/handlers/_records.js';
import * as parties from '../../packages/api/src/handlers/parties/index.js';
import * as persons from '../../packages/api/src/handlers/persons/index.js';
import { partyNames } from '../../packages/api/src/handlers/parties/members.js';
import { PARTIES } from '../../packages/api/src/queries/parties.js';
import { decodeMembers } from '../../packages/core/src/party-members.mjs';

const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
const built = existsSync(DB) && (() => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'person_card_parties'").get()); } finally { db.close(); }
})();
const skip = !built && 'no records build with person_card_parties (npm run records:build)';
let env;
const setup = () => {
  if (!env) {
    installCaches();
    resetDatasetMemo();
    env = { ELECTIONS_DB: d1(DB) };
  }
  return env;
};
async function get(mod, url) {
  const res = await mod.onRequestGet(context(url, setup()));
  const text = await res.text();
  return { status: res.status, bytes: Buffer.byteLength(text), body: JSON.parse(text) };
}

/** Every page of a paged answer: { rows, bytes }. */
async function allPages(mod, base, key, limit) {
  const rows = [];
  let bytes = 0;
  for (let offset = 0; ; offset += limit) {
    const r = await get(mod, `${base}&limit=${limit}&offset=${offset}`);
    assert.equal(r.status, 200, `${base} offset ${offset} -> ${r.status}`);
    bytes += r.bytes;
    rows.push(r.body);
    if (r.body[key].length < limit) break;
  }
  return { pages: rows, bytes };
}

/** An election row as the party page reads it (entity-bridge.js mapPersonAppearanceRow, groupConstituencies). */
const readRow = (row) => ({
  key: String(row.key || ''),
  date: String(row.date || ''),
  constituency: String(row.constituency || ''),
  party: String(row.party || ''),
  status: String(row.status || ''),
  elected: row.elected === true ? true : row.elected === false ? false : undefined,
  votes: row.firstPref ?? row.firstPrefs ?? row.votes ?? null,
  referendum: /referendum/i.test(String(row.title || '')) ? String(row.title) : '',
});

test('the members view finds the people the cards query found, with the fields the page reads', { skip }, async (t) => {
  const sqlite = new DatabaseSync(DB, { readOnly: true });
  // The largest parties by people, and two with many spellings.
  const slugs = sqlite.prepare(`SELECT slug FROM party_cards ORDER BY occurrences DESC, slug LIMIT 6`).all().map((r) => r.slug);
  for (const extra of ['fianna-fail', 'fine-gael', 'labour-coalition', 'ni-womens-coalition']) if (!slugs.includes(extra)) slugs.push(extra);
  sqlite.close();
  let sawLargest = false;
  for (const slug of slugs) {
    const record = await get(parties, `/_api/parties?slug=${slug}`);
    if (record.status !== 200) continue;
    const item = record.body.item;
    const names = partyNames(item);
    const legacyUrl = `/_api/persons?${names.map((n) => `party=${encodeURIComponent(n)}`).join('&')}`;
    const legacy = await allPages(persons, legacyUrl, 'persons', 200);
    const lean = await allPages(parties, `/_api/parties?slug=${slug}&view=members`, 'members', 500);
    const cards = new Map(legacy.pages.flatMap((p) => p.persons).map((card) => [card.slug, card]));
    const members = lean.pages.flatMap((p) => decodeMembers(p));
    assert.equal(lean.pages[0].total, cards.size, `${slug}: total`);
    assert.deepEqual(members.map((m) => m.slug).sort(), [...cards.keys()].sort(), `${slug}: the same people`);
    for (const m of members) {
      const card = cards.get(m.slug);
      assert.equal(m.name, card.name || card.title, `${slug} ${m.slug}: name`);
      assert.deepEqual(m.elections.map(readRow), (card.elections || []).map(readRow), `${slug} ${m.slug}: election rows`);
    }
    t.diagnostic(`${slug}: ${cards.size} people, members ${lean.bytes} bytes in ${lean.pages.length} page(s), cards ${legacy.bytes} bytes in ${legacy.pages.length}`);
    if (cards.size > 3000) {
      sawLargest = true;
      assert.ok(lean.bytes < 1024 * 1024, `${slug}: ${lean.bytes} bytes`);
      assert.ok(lean.bytes * 5 < legacy.bytes, `${slug}: ${lean.bytes} bytes against the cards' ${legacy.bytes}`);
    }
  }
  assert.ok(sawLargest, 'a party of more than 3,000 people was compared');
});

test('the members view reads D1 through indexes: no table scan', { skip }, () => {
  const sqlite = new DatabaseSync(DB, { readOnly: true });
  try {
    for (const count of [1, 3]) {
      const binds = Array.from({ length: count }, (_, i) => `name ${i}`);
      for (const [sql, args] of [[PARTIES.membersPage(count), [...binds, 500, 0]], [PARTIES.membersCount(count), binds]]) {
        const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail);
        const scans = plan.filter((line) => /^SCAN (person_cards|person_card_parties|p)\b/.test(line));
        assert.deepEqual(scans, [], `${plan.join(' | ')}`);
        assert.ok(plan.some((line) => /SEARCH person_card_parties/.test(line)), plan.join(' | '));
      }
    }
  } finally {
    sqlite.close();
  }
});

test('the members view: limits, an unknown party, a party without names', { skip }, async () => {
  const page = await get(parties, '/_api/parties?slug=fianna-fail&view=members&limit=5000');
  assert.equal(page.status, 200);
  assert.equal(page.body.limit, 1000);
  assert.ok(page.body.members.length <= 1000);
  assert.deepEqual(page.body.columns, ['key', 'date', 'constituency', 'party', 'status', 'elected', 'firstPrefs', 'title']);
  const missing = await get(parties, '/_api/parties?slug=no-such-party-at-all&view=members');
  assert.equal(missing.status, 404);
  assert.deepEqual(partyNames({ title: ' Fianna Fáil ', knownAliases: ['Fianna Fail', '', null, 'Fianna Fáil'] }), ['Fianna Fáil', 'Fianna Fail']);
  assert.deepEqual(partyNames(null), []);
});
