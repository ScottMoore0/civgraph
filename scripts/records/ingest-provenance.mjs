/**
 * Election provenance as rows: what was data/database/election-provenance.json (25.9 MB, 270 KB
 * under Cloudflare Pages' 25 MiB file limit) becomes one contest_provenance row per contest,
 * one citations row per source, and the legislation map. The per-election shards the map app
 * reads are kept as built (provenance_shards), so /render/metadata/election-provenance/<key>.json
 * and /_api/elections?view=provenance answer them exactly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TableWriter, bool, readJson, transaction, txt, withPlaceholders } from './db.mjs';

const SOURCE_PREFIX = 'data/elections-source/data/elections/';

export function ingestProvenance(db, { provenanceFile, shardDir }) {
  const doc = readJson(provenanceFile);
  // contests.source_file is the path from the repository root; provenance files are relative to
  // data/elections-source/data/elections/.
  const contestByFile = new Map();
  for (const row of db.prepare('SELECT election_key, seq, source_file FROM contests WHERE source_file IS NOT NULL ORDER BY election_key, seq').all()) {
    const rel = String(row.source_file).startsWith(SOURCE_PREFIX) ? String(row.source_file).slice(SOURCE_PREFIX.length) : String(row.source_file);
    if (!contestByFile.has(rel)) contestByFile.set(rel, row);
  }
  let unmatched = 0;
  const out = transaction(db, () => {
    const cp = new TableWriter(db, 'contest_provenance');
    const cit = new TableWriter(db, 'citations');
    const el = new TableWriter(db, 'election_legislation');
    (doc.contests || []).forEach((contest, ord) => {
      const match = contestByFile.get(contest.file);
      if (!match) unmatched += 1;
      cp.add({
        source_file: contest.file,
        election_key: match?.election_key ?? null,
        contest_seq: match?.seq ?? null,
        body: txt(contest.body), date: txt(contest.date), constituency: txt(contest.constituency),
        status: txt(contest.status), ord,
        record: JSON.stringify(withPlaceholders(contest, { sources: '$citations', legislation: '$legislation' })),
      });
      (contest.sources || []).forEach((s, i) => cit.add({
        subject_type: 'contest', subject_key: contest.file, ord: i,
        title: txt(s.title), publisher: txt(s.publisher), url: txt(s.url), archive_url: txt(s.archiveUrl),
        host: txt(s.host), kind: txt(s.kind), origin: txt(s.origin), basis: txt(s.basis), scope: txt(s.scope),
        checked: bool(s.checked), match: txt(s.match), document: txt(s.document), citation: JSON.stringify(s),
      }));
      (Array.isArray(contest.legislation) ? contest.legislation : []).forEach((id, i) => el.add({ source_file: contest.file, ord: i, legislation_id: String(id) }));
    });
    const leg = new TableWriter(db, 'legislation');
    Object.entries(doc.legislation || {}).forEach(([id, value], ord) => leg.add({
      legislation_id: id, title: txt(value?.label ?? value?.title), url: txt(value?.url), ord, meta: JSON.stringify(value),
    }));
    const shards = new TableWriter(db, 'provenance_shards');
    for (const file of readdirSync(shardDir).filter((f) => f.endsWith('.json')).sort()) {
      const shard = JSON.parse(readFileSync(path.join(shardDir, file), 'utf8'));
      shards.add({ election_key: shard.key || file.slice(0, -5), shard: JSON.stringify(shard) });
    }
    return {
      contest_provenance: cp.finish(), citations: cit.finish(), election_legislation: el.finish(),
      legislation: leg.finish(), provenance_shards: shards.finish(),
    };
  });
  const { contests: _c, legislation: _l, ...head } = doc;
  const { generatedAt: _g, ...headNoTime } = head;
  return { counts: out, unmatched, docs: [{ name: 'provenance/head', body: JSON.stringify(headNoTime) }] };
}
