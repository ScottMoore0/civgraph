/**
 * Parliamentary divisions and votes from the Browse votes tree that scripts/build/build_browse_votes.py
 * writes (index.json, divisions/<shard>.json, persons/<id>.json, parties/<slug>.json).
 *
 * The division dataset itself stays outside the repository (CIVGRAPH_VOTES_DIR, pinned by
 * checksum in data/database/votes-source.json); records:build runs the Python build into
 * tmp/records/browse/votes when the variable is set and otherwise carries the previous build's
 * rows forward (build-records-db.mjs transformVotes).
 *
 * A division's record keeps its key order with its votes replaced by "$votes"; each vote
 * (the tuple [name, personId, vote, ..., party]) is a division_votes row, verbatim in `entry`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TableWriter, readJson, transaction, txt, withPlaceholders } from './db.mjs';

/**
 * @param {import('../../storage/src/sqlite.mjs').SqliteHandle} db
 * @param {{ votesDir: string }} options
 */
export function ingestVotes(db, { votesDir }) {
  const index = readJson(path.join(votesDir, 'index.json'));
  const out = transaction(db, () => {
    const div = new TableWriter(db, 'divisions');
    const votes = new TableWriter(db, 'division_votes');
    const dir = path.join(votesDir, 'divisions');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const shard = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      const shardNo = Number(shard.shard ?? file.slice(0, -5));
      Object.entries(shard.divisions || {}).forEach(([id, record], ord) => {
        div.add({
          division_id: id, shard: shardNo, ord, body: txt(record.body), date: txt(record.date),
          number: txt(record.number), title: txt(record.title),
          record: JSON.stringify(withPlaceholders(record, { votes: '$votes' })),
        });
        (record.votes || []).forEach((/** @type {unknown} */ v, /** @type {number} */ i) => votes.add({
          division_id: id, ord: i,
          person_id: Array.isArray(v) && v[1] !== null && v[1] !== undefined ? String(v[1]) : null,
          vote: Array.isArray(v) ? txt(v[2]) : null,
          party: Array.isArray(v) ? txt(v[v.length - 1]) : null,
          entry: JSON.stringify(v),
        }));
      });
    }
    const persons = new TableWriter(db, 'vote_persons');
    const pdir = path.join(votesDir, 'persons');
    if (existsSync(pdir)) {
      for (const file of readdirSync(pdir).filter((f) => f.endsWith('.json')).sort()) {
        persons.add({ person_id: file.slice(0, -5), record: JSON.stringify(JSON.parse(readFileSync(path.join(pdir, file), 'utf8'))) });
      }
    }
    const parties = new TableWriter(db, 'vote_parties');
    const qdir = path.join(votesDir, 'parties');
    if (existsSync(qdir)) {
      for (const file of readdirSync(qdir).filter((f) => f.endsWith('.json')).sort()) {
        parties.add({ slug: file.slice(0, -5), record: JSON.stringify(JSON.parse(readFileSync(path.join(qdir, file), 'utf8'))) });
      }
    }
    return { divisions: div.finish(), division_votes: votes.finish(), vote_persons: persons.finish(), vote_parties: parties.finish() };
  });
  return { counts: out, docs: [{ name: 'votes/index.json', body: JSON.stringify(index) }] };
}
