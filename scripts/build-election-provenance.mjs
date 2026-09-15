#!/usr/bin/env node
/**
 * Build data/database/election-provenance.json: one record per election contest saying where its
 * figures come from and how far that has been checked.
 *
 * Two layers go in, against the contract in data/database/election-provenance.schema.json:
 *
 *   import             the source_url recorded when the contest was imported. Present for most
 *                      Republic of Ireland contests (electionsireland.org) and the referendums;
 *                      absent from every Northern Ireland body, whose files carry no source field.
 *                      Recorded, never checked.
 *   wikipedia-citation the sources Wikipedia cites for the same contest, harvested by
 *                      scripts/harvest_wikipedia_cited_sources.py and fetched by Civgraph, which
 *                      compared each one against the candidates and votes it holds. Those that
 *                      matched are marked checked, and are the only citations this project can
 *                      stand behind.
 *
 * The second layer comes from data/review-inputs/wikipedia-cited-sources/contest-sources.json,
 * which is working material and is not committed. Only the citation fields are carried across --
 * titles, publishers, URLs, what was checked -- never text copied from a source, and never the
 * candidate lists the review file holds for comparison.
 *
 * A contest is identified by its path under data/elections-source/data/elections, the only
 * identifier every body shares. Rows in the review file whose contest could not be matched
 * (civgraph: null) are dropped, and their number is reported.
 *
 *   node scripts/build-election-provenance.mjs            write the file
 *   node scripts/build-election-provenance.mjs --check    rebuild and fail on drift; write nothing
 *
 * --check is the gate: it fails when the committed file no longer matches what the inputs produce,
 * so provenance cannot fall out of step with the data unnoticed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ELECTIONS = path.join('data', 'elections-source', 'data', 'elections');
const REVIEW = path.join('data', 'review-inputs', 'wikipedia-cited-sources', 'contest-sources.json');
const OUT = path.join('data', 'database', 'election-provenance.json');
// Per-election shards for the browser. The whole file is 10 MB, far too much to fetch, so the app
// loads only the election it is showing, keyed by the constituency name it already has.
const SHARD_DIR = path.join('render', 'metadata', 'election-provenance');
const CHECK = process.argv.includes('--check');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const hostOf = (url) => { try { return new URL(url).host; } catch { return null; } };

/** Every contest on disk, with the source_url its file carries (null where there is none). */
function contestsOnDisk() {
  const out = [];
  for (const body of readdirSync(ELECTIONS, { withFileTypes: true })) {
    if (!body.isDirectory()) continue;
    for (const date of readdirSync(path.join(ELECTIONS, body.name), { withFileTypes: true })) {
      if (!date.isDirectory()) continue;
      for (const f of readdirSync(path.join(ELECTIONS, body.name, date.name))) {
        if (!f.endsWith('.json') || f.startsWith('_')) continue;
        const rel = `${body.name}/${date.name}/${f}`;
        let doc = {};
        try { doc = readJson(path.join(ELECTIONS, body.name, date.name, f)); } catch { /* unreadable: still list it */ }
        const named = typeof doc.constituency === 'string' ? doc.constituency
          : typeof doc.Constituency === 'string' ? doc.Constituency
            : f.replace(/\.json$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        out.push({
          file: rel,
          body: body.name,
          date: date.name,
          constituency: named,
          sourceUrl: typeof doc.source_url === 'string' ? doc.source_url : null,
        });
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Add a source to a list, or upgrade the one already there for the same URL. The same URL can
 * reach us twice -- two rows of the review file can cover one contest, and one of them may cite a
 * source without having checked it. The reading that was checked has to win, or the contest loses
 * its verification to a duplicate that happened to arrive first.
 */
function addSource(list, s) {
  const at = list.findIndex((p) => p.url === s.url);
  if (at < 0) list.push(s);
  else if (s.checked && !list[at].checked) list[at] = s;
}

/** Citation rows from the review file, keyed by contest path. Returns [map, stats]. */
function wikipediaLayer() {
  if (!existsSync(REVIEW)) return [new Map(), { present: false, rows: 0, unmatched: 0, licence: null }];
  const doc = readJson(REVIEW);
  const rows = Array.isArray(doc) ? doc
    : Object.values(doc).filter(Array.isArray).sort((a, b) => b.length - a.length)[0] ?? [];
  const licence = typeof doc?.licence === 'string' ? doc.licence : null;
  const map = new Map();
  let unmatched = 0;
  for (const row of rows) {
    const file = row?.civgraph?.file;
    if (!file) { unmatched += 1; continue; }
    const match = row?.civgraph?.match ?? null;
    const sources = [];
    for (const [list, checkedDefault] of [[row.verifyingSources, true], [row.citedSources, false]]) {
      for (const s of list ?? []) {
        if (!s?.url) continue;
        addSource(sources, {
          title: s.title ?? null,
          publisher: s.publisher ?? null,
          url: s.url,
          archiveUrl: s.archiveUrl ?? null,
          host: s.host ?? hostOf(s.url),
          kind: s.kind ?? null,
          origin: 'wikipedia-citation',
          basis: s.basis ?? null,
          scope: s.scope ?? null,
          checked: typeof s.checkedByCivgraph === 'boolean' ? s.checkedByCivgraph : checkedDefault,
          check: s.check ?? null,
          match,
          document: s.document ? {
            url: s.document.url,
            archiveUrl: s.document.archiveUrl ?? null,
            label: s.document.label ?? null,
          } : null,
        });
      }
    }
    // Checked sources first, then the rest; both keep the order the harvest gave them.
    sources.sort((a, b) => Number(b.checked) - Number(a.checked));
    const related = typeof row.relatedWikipedia === 'string' ? row.relatedWikipedia
      : row.relatedWikipedia?.url ?? null;
    const prev = map.get(file);
    if (prev) { for (const s of sources) addSource(prev.sources, s); continue; }
    map.set(file, { sources, relatedWikipedia: related });
  }
  return [map, { present: true, rows: rows.length, unmatched, licence }];
}

function build() {
  const disk = contestsOnDisk();
  const [wiki, stats] = wikipediaLayer();
  const contests = disk.map((c) => {
    const extra = wiki.get(c.file);
    const sources = [];
    if (c.sourceUrl) {
      sources.push({
        title: null,
        publisher: null,
        url: c.sourceUrl,
        archiveUrl: null,
        host: hostOf(c.sourceUrl),
        kind: null,
        origin: 'import',
        basis: 'source-url',
        scope: null,
        checked: false,
        check: 'recorded when the contest was imported; not checked against the figures',
        match: null,
        document: null,
      });
    }
    sources.push(...(extra?.sources ?? []));
    const checked = sources.some((s) => s.checked);
    const status = checked ? 'verified'
      : sources.some((s) => s.origin === 'wikipedia-citation') ? 'cited'
        : sources.length ? 'recorded' : 'unsourced';
    // Anything checked outranks anything not.
    sources.sort((a, b) => Number(b.checked) - Number(a.checked));
    return {
      file: c.file,
      body: c.body,
      date: c.date,
      constituency: c.constituency,
      status,
      relatedWikipedia: extra?.relatedWikipedia ?? null,
      sources,
    };
  });

  const byBody = {};
  for (const c of contests) {
    const b = (byBody[c.body] ??= { contests: 0, withAnySource: 0, verified: 0 });
    b.contests += 1;
    if (c.sources.length) b.withAnySource += 1;
    if (c.status === 'verified') b.verified += 1;
  }
  return {
    doc: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      licence: stats.licence ?? 'Citations only: titles, publishers and URLs. No text is reproduced from the cited sources.',
      counts: {
        contests: contests.length,
        withAnySource: contests.filter((c) => c.sources.length).length,
        verified: contests.filter((c) => c.status === 'verified').length,
        byBody,
      },
      contests,
    },
    stats,
  };
}

const { doc, stats } = build();
const summary = () => {
  const { counts } = doc;
  console.log(`  contests            ${counts.contests}`);
  console.log(`  with any source     ${counts.withAnySource} (${(100 * counts.withAnySource / counts.contests).toFixed(1)}%)`);
  console.log(`  verified            ${counts.verified} (${(100 * counts.verified / counts.contests).toFixed(1)}%)`);
  if (!stats.present) console.log(`  ! ${REVIEW} is absent: the citation layer is missing from this build`);
  else console.log(`  review rows ${stats.rows}, of which ${stats.unmatched} matched no contest and were dropped`);
  for (const [body, b] of Object.entries(counts.byBody).sort((a, b) => b[1].contests - a[1].contests)) {
    console.log(`    ${body.padEnd(46)} ${String(b.contests).padStart(5)} contests  ${String(b.withAnySource).padStart(5)} sourced  ${String(b.verified).padStart(5)} verified`);
  }
};

const stable = (d) => JSON.stringify({ ...d, generatedAt: null });

/** The app renders a constituency name; this is the key both sides can compute from it. */
const nameKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * One small file per election holding the best source for each of its contests: checked before
 * unchecked, then the narrowest citation. Keyed by constituency name, so the app can look up what
 * it is showing without knowing anything about contest file paths.
 */
function buildShards(provenance) {
  const rank = { 'this contest': 3, 'same section': 2, article: 1 };
  const byKey = new Map();
  for (const c of provenance.contests) {
    if (!c.sources.length) continue;
    const key = `${c.body}__${c.date}`;
    const best = [...c.sources].sort((a, b) => Number(b.checked) - Number(a.checked)
      || (rank[b.scope] ?? 0) - (rank[a.scope] ?? 0))[0];
    const shard = byKey.get(key) ?? { schemaVersion: 1, key, contests: {} };
    shard.contests[nameKey(c.constituency)] = {
      constituency: c.constituency,
      status: c.status,
      relatedWikipedia: c.relatedWikipedia,
      source: {
        title: best.title,
        publisher: best.publisher,
        url: best.url,
        archiveUrl: best.archiveUrl,
        host: best.host,
        scope: best.scope,
        checked: best.checked,
        check: best.check,
      },
      otherSources: c.sources.length - 1,
    };
    byKey.set(key, shard);
  }
  return byKey;
}

const shardText = (shard) => `${JSON.stringify({
  ...shard,
  contests: Object.fromEntries(Object.keys(shard.contests).sort().map((k) => [k, shard.contests[k]])),
}, null, 1)}\n`;

const shards = buildShards(doc);
const shardFiles = () => (existsSync(SHARD_DIR) ? readdirSync(SHARD_DIR).filter((f) => f.endsWith('.json')) : []);

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`${OUT} does not exist. Run: node scripts/build-election-provenance.mjs`);
    process.exit(1);
  }
  const committed = readJson(OUT);
  summary();
  const staleShards = shardFiles().length !== shards.size
    || [...shards].some(([key, shard]) => {
      const p = path.join(SHARD_DIR, `${key}.json`);
      return !existsSync(p) || readFileSync(p, 'utf8') !== shardText(shard);
    });
  if (stable(committed) !== stable(doc) || staleShards) {
    console.error(`\nelection provenance is stale: the committed ${staleShards ? 'shards no longer match' : 'file no longer matches'} its inputs.`);
    console.error('Run: node scripts/build-election-provenance.mjs');
    process.exit(1);
  }
  console.log(`\nelection provenance is up to date (${shards.size} per-election shards).`);
} else {
  writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`);
  mkdirSync(SHARD_DIR, { recursive: true });
  const wanted = new Set([...shards.keys()].map((k) => `${k}.json`));
  for (const f of shardFiles()) {
    if (!wanted.has(f)) unlinkSync(path.join(SHARD_DIR, f));
  }
  for (const [key, shard] of shards) writeFileSync(path.join(SHARD_DIR, `${key}.json`), shardText(shard));
  console.log(`wrote ${OUT} and ${shards.size} per-election shards in ${SHARD_DIR}`);
  summary();
}
