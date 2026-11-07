#!/usr/bin/env node
/**
 * npm run records:build -- the one loader: source files in git -> tmp/records/civgraph-records.sqlite.
 *
 * Steps (data design phase2-plan.md stage C):
 *   1. transforms   the existing generators, with their output directed at tmp/records through
 *                   CIVGRAPH_BUILD_DIR: the election manifest, its summaries, the person-id and
 *                   name-id stamping (read-only for committed files), provenance, the Browse
 *                   indexes, party profiles, office pages and the semantic graph. Skipped when the inputs hash
 *                   equals the last build's and its outputs are present (or with --no-transform).
 *   2. votes        built from CIVGRAPH_VOTES_DIR (checked against its committed pin) when set;
 *                   else read from --votes-tree <dir>; else carried over from the last build.
 *   3. a fresh civgraph-records.next.sqlite from migrations/*.sql, then every ingest
 *   4. stable order: the sort keys (`ord`) of the tables with `stableOrder` keep their values from
 *      the seed (scripts/records/stable-order.mjs), so the delta of a change is about its own
 *      size. The seed is --ord-seed <file>; else the publish's last-loaded snapshot
 *      (.claude/publish/work/last-loaded.sqlite: what D1 holds); else the previous build; with
 *      --no-ord-seed, or none of them, the positions the ingests wrote are kept.
 *   5. validate (scripts/records/validate.mjs); errors stop the build
 *   graph_files is not rebuilt: it is carried forward from the last-loaded snapshot, else the
 *      previous build (frozen, scripts/records/graph-files-freeze.mjs); --fresh-graph-files
 *      builds it from the graph tree.
 *   6. dataset rows: version (hash of every table's count and checksum), git_commit, inputs_hash,
 *      table checksums; then the file is renamed into place.
 *
 * The person-registry curation loop (npm run persons:rebuild) rewrites committed files and stays a
 * separate step; this build only stamps from the committed registry.
 *
 *   node scripts/records/build-records-db.mjs [--no-transform] [--force-transform] [--votes-tree DIR]
 *                                             [--skip graph,votes] [--no-source-checks]
 *                                             [--ord-seed FILE | --no-ord-seed] [--fresh-graph-files]
 *   node scripts/records/build-records-db.mjs --only maps [--browse-dir DIR] [--out FILE]
 *
 * --only maps (development): a database with every table but only the maps group filled
 * (ingest-maps.mjs: maps.json, maps-test.json, the catalogue documents and, from --browse-dir or
 * the last build's Browse output, the Browse map files). No transforms, no seed, no source
 * checks; it is written to --out (default tmp/records/civgraph-records.maps.sqlite) and never
 * replaces the full build. Used by the local phase-3 rehearsal and the dev site.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, tableChecksums, TableWriter, transaction } from './db.mjs';
import { ingestBrowse } from './ingest-browse.mjs';
import { ingestElections } from './ingest-elections.mjs';
import { ingestGraph } from './ingest-graph.mjs';
import { DRIFT_FILE, frozenSource } from './graph-files-freeze.mjs';
import { ingestMaps } from './ingest-maps.mjs';
import { ingestProvenance } from './ingest-provenance.mjs';
import { ingestRegistries } from './ingest-registries.mjs';
import { ingestVotes } from './ingest-votes.mjs';
import { recordPaths, REPO_ROOT, rel } from './paths.mjs';
import { HASHED_TABLES } from './schema.mjs';
import { stabiliseOrder } from './stable-order.mjs';
import { validateDatabase } from './validate.mjs';
import { verifyVotesPin } from './votes-pin.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const skip = new Set(String(option('--skip') || '').split(',').filter(Boolean));

export const BUILD_REL = 'tmp/records';
const BUILD_ENV = { ...process.env, CIVGRAPH_BUILD_DIR: BUILD_REL };
const P = recordPaths(BUILD_ENV);
const OUT = path.join(REPO_ROOT, BUILD_REL, 'civgraph-records.sqlite');
const NEXT = path.join(REPO_ROOT, BUILD_REL, 'civgraph-records.next.sqlite');
const STATE = path.join(REPO_ROOT, BUILD_REL, 'transforms.json');
const LAST_LOADED = path.join(REPO_ROOT, '.claude', 'publish', 'work', 'last-loaded.sqlite');

/** The database whose sort keys this build keeps (see step 4), or null. */
function orderSeed() {
  if (flag('--no-ord-seed')) return null;
  if (option('--ord-seed')) {
    const file = path.resolve(option('--ord-seed'));
    if (!existsSync(file)) throw new Error(`--ord-seed: no database at ${file}`);
    return file;
  }
  return [LAST_LOADED, OUT].find((file) => existsSync(file)) || null;
}

const t0 = Date.now();
const timings = {};
const step = (name, fn) => {
  const start = Date.now();
  const result = fn();
  timings[name] = Date.now() - start;
  console.log(`  ${name}: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return result;
};

function run(cmd, cmdArgs, { env = BUILD_ENV } = {}) {
  const res = spawnSync(cmd, cmdArgs, { cwd: REPO_ROOT, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) {
    const tail = `${res.stdout || ''}\n${res.stderr || ''}`.trim().split('\n').slice(-12).join('\n');
    const error = new Error(`${cmd} ${cmdArgs.join(' ')} exited ${res.status}\n${tail}`);
    error.status = res.status;
    throw error;
  }
  return res.stdout || '';
}

/** A hash of every input the transforms read: committed blobs plus uncommitted changes. */
function inputsHash() {
  const dirs = ['data', 'scripts', 'src', 'render/metadata/maps-test.json', 'render/metadata/feature-indexes', 'migrations'];
  const h = createHash('sha256');
  h.update(run('git', ['ls-files', '-s', '--', ...dirs], { env: process.env }));
  h.update(run('git', ['diff', 'HEAD', '--', ...dirs], { env: process.env }));
  h.update(run('git', ['ls-files', '--others', '--exclude-standard', '--', ...dirs], { env: process.env }));
  return h.digest('hex').slice(0, 32);
}

function readPrior() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return null; }
}

function transformsPresent() {
  return [P.ELECTION_MANIFEST, P.ELECTION_BUNDLE_DIR, P.PROVENANCE_FILE, path.join(P.BROWSE_DIR, 'index.json'), path.join(P.GRAPH_DIR, 'manifest.json')]
    .every((p) => existsSync(p));
}

function transformElections() {
  run(process.execPath, ['scripts/build-test2-election-manifest.mjs']);
  run(process.execPath, ['scripts/build-test2-election-summaries.mjs']);
  run('python', ['scripts/ingest/persons/apply_person_ids_v2.py']);
  run('python', ['scripts/ingest/persons/build_name_registry.py', '--stamp-only']);
}
const transformProvenance = () => run(process.execPath, ['scripts/build-election-provenance.mjs']);
function transformBrowse() {
  run(process.execPath, ['scripts/build-browse-indexes.mjs']);
  run(process.execPath, ['scripts/build-party-profiles.mjs']);
  run(process.execPath, ['scripts/build-office-pages.mjs']);
}
const transformGraph = () => run(process.execPath, ['scripts/graph/build-semantic-graph.mjs']);

/** Where this build's votes come from: 'built' | 'tree' | 'previous' | 'none'. */
function transformVotes() {
  const votesOut = path.join(P.BROWSE_DIR, 'votes');
  if (process.env.CIVGRAPH_VOTES_DIR) {
    verifyVotesPin(process.env.CIVGRAPH_VOTES_DIR);
    run('python', ['scripts/build_browse_votes.py', '--votes-dir', process.env.CIVGRAPH_VOTES_DIR, '--out', votesOut]);
    return { from: 'built', dir: votesOut };
  }
  if (option('--votes-tree')) return { from: 'tree', dir: path.resolve(option('--votes-tree')) };
  if (existsSync(path.join(votesOut, 'index.json'))) return { from: 'tree', dir: votesOut };
  if (existsSync(OUT)) return { from: 'previous', dir: null };
  return { from: 'none', dir: null };
}

const VOTE_TABLES = ['divisions', 'division_votes', 'vote_persons', 'vote_parties'];

/** --only maps: the maps group alone, into its own file (see the header). */
function mainMapsOnly() {
  const out = path.resolve(option('--out') || path.join(REPO_ROOT, BUILD_REL, 'civgraph-records.maps.sqlite'));
  const next = `${out}.next`;
  const browseDir = option('--browse-dir') ? path.resolve(option('--browse-dir')) : P.BROWSE_DIR;
  console.log(`records:build --only maps (Browse map files from ${existsSync(browseDir) ? rel(browseDir) : 'nowhere'})`);
  const db = createDatabase(next);
  const result = step('ingest maps', () => ingestMaps(db, { browseDir }));
  step('documents', () => transaction(db, () => {
    const w = new TableWriter(db, 'documents');
    for (const d of result.docs.sort((a, b) => a.name.localeCompare(b.name))) w.add(d);
  }));
  const checked = validateDatabase(db);
  for (const w of checked.warnings) console.warn(`  warning: ${w}`);
  if (checked.errors.length) {
    for (const e of checked.errors) console.error(`  ERROR: ${e}`);
    db.close();
    process.exit(1);
  }
  const checksums = tableChecksums(db, HASHED_TABLES);
  const version = createHash('sha256').update(JSON.stringify(HASHED_TABLES.map((t) => [t.name, checksums[t.name].n, checksums[t.name].s]))).digest('hex').slice(0, 16);
  const ins = db.prepare('INSERT OR REPLACE INTO dataset (key, value) VALUES (?, ?)');
  transaction(db, () => {
    ins.run('version', version);
    ins.run('git_commit', run('git', ['rev-parse', 'HEAD'], { env: process.env }).trim());
    ins.run('table_checksums', JSON.stringify(checksums));
  });
  db.close();
  for (const suffix of ['', '-journal']) rmSync(out + suffix, { force: true });
  renameSync(next, out);
  console.log(`records:build (maps) ${version} -> ${rel(out)}`);
  for (const [name, n] of Object.entries(result.counts)) console.log(`  ${name.padEnd(26)} ${n}`);
}

function main() {
  if (option('--only') === 'maps') return mainMapsOnly();
  console.log('records:build');
  const inputs = step('inputs hash', inputsHash);
  const prior = readPrior();
  const reuse = flag('--no-transform') || (!flag('--force-transform') && prior?.inputs === inputs && transformsPresent());
  if (reuse) console.log('  transforms: reused (inputs unchanged)');
  else {
    step('transform elections', transformElections);
    step('transform provenance', transformProvenance);
    step('transform browse', transformBrowse);
    if (!skip.has('graph')) step('transform graph', transformGraph);
    writeFileSync(STATE, `${JSON.stringify({ inputs, builtAt: new Date().toISOString() }, null, 2)}\n`);
  }
  const votes = skip.has('votes') ? { from: 'none' } : step('transform votes', transformVotes);
  if (votes.from === 'previous') console.warn('  WARNING: CIVGRAPH_VOTES_DIR is unset: votes carried over from the last build.');
  if (votes.from === 'none') console.warn('  WARNING: no votes dataset and no previous build: the votes tables are empty.');

  const db = createDatabase(NEXT);
  const counts = {};
  const docs = [];
  const merge = (r) => { Object.assign(counts, r.counts || r); if (r.docs) docs.push(...r.docs); };
  const elections = step('ingest elections', () => ingestElections(db, { bundleDir: P.ELECTION_BUNDLE_DIR, manifestFile: P.ELECTION_MANIFEST, summaryDir: P.ELECTION_SUMMARY_DIR }));
  Object.assign(counts, elections.counts);
  docs.push({ name: 'elections-test2.json', body: JSON.stringify(elections.stats.manifestHead) });
  step('ingest registries', () => merge(ingestRegistries(db)));
  const prov = step('ingest provenance', () => ingestProvenance(db, { provenanceFile: P.PROVENANCE_FILE, shardDir: P.PROVENANCE_SHARD_DIR }));
  merge(prov);
  step('ingest browse', () => merge(ingestBrowse(db, { browseDir: P.BROWSE_DIR, paths: P })));
  if (votes.dir) step('ingest votes', () => merge(ingestVotes(db, { votesDir: votes.dir })));
  else if (votes.from === 'previous') {
    step('carry votes', () => {
      db.exec(`ATTACH DATABASE '${OUT.replace(/'/g, "''")}' AS prev`);
      transaction(db, () => {
        for (const t of VOTE_TABLES) db.exec(`INSERT INTO ${t} SELECT * FROM prev.${t}`);
        db.exec("INSERT INTO documents SELECT * FROM prev.documents WHERE name = 'votes/index.json'");
      });
      db.exec('DETACH DATABASE prev');
    });
  }
  if (!skip.has('graph')) {
    // graph_files is frozen as loaded at the data phase 4 go-live (graph-files-freeze.mjs).
    const frozenFrom = flag('--fresh-graph-files') ? null : frozenSource([LAST_LOADED, OUT]);
    const graph = step('ingest graph', () => ingestGraph(db, { graphDir: P.GRAPH_DIR, frozenFrom }));
    merge(graph);
    const gf = graph.graphFiles;
    writeFileSync(DRIFT_FILE, `${JSON.stringify({ ...gf, frozenFrom: gf.frozenFrom && rel(gf.frozenFrom) }, null, 2)}
`);
    if (gf.frozenFrom) console.log(`  graph_files: carried from ${rel(gf.frozenFrom)} (frozen); ${gf.drifted.length} file(s) differ from this graph, ${gf.retired} gone from it`);
    else console.warn('  WARNING: graph_files built from the graph tree (no frozen copy, or --fresh-graph-files): a publish would load it whole');
  }
  step('ingest maps', () => merge(ingestMaps(db, { browseDir: P.BROWSE_DIR })));
  step('documents', () => transaction(db, () => {
    const w = new TableWriter(db, 'documents');
    for (const d of docs.sort((a, b) => a.name.localeCompare(b.name))) w.add(d);
  }));

  const seed = orderSeed();
  let seedVersion = '';
  if (seed) {
    try {
      const s = new DatabaseSync(seed, { readOnly: true });
      seedVersion = s.prepare("SELECT value FROM dataset WHERE key = 'version'").get()?.value || '';
      s.close();
    } catch { /* a seed without a dataset table still seeds */ }
    console.log(`  stable order: seeded from ${rel(seed)}${seedVersion ? ` (${seedVersion})` : ''}`);
    step('stable order', () => stabiliseOrder(db, seed, { log: (line) => console.log(line) }));
  } else console.log('  stable order: no seed, positions kept');

  const result = step('validate', () => validateDatabase(db, { sourceValidators: !flag('--no-source-checks') }));
  for (const w of result.warnings) console.warn(`  warning: ${w}`);
  if (prov.unmatched) console.warn(`  warning: ${prov.unmatched} provenance contest(s) match no contest by source file`);
  if (prior?.unstamped !== undefined && result.facts.unstampedCandidacies > prior.unstamped) {
    console.warn(`  warning: ${result.facts.unstampedCandidacies - prior.unstamped} more candidacies without a person id than the last build: run npm run persons:rebuild`);
  }
  if (result.errors.length) {
    for (const e of result.errors) console.error(`  ERROR: ${e}`);
    db.close();
    console.error(`FAIL: ${rel(NEXT)} not published (${result.errors.length} error(s))`);
    process.exit(1);
  }

  const checksums = tableChecksums(db, HASHED_TABLES);
  const version = createHash('sha256').update(JSON.stringify(HASHED_TABLES.map((t) => [t.name, checksums[t.name].n, checksums[t.name].s]))).digest('hex').slice(0, 16);
  const gitCommit = run('git', ['rev-parse', 'HEAD'], { env: process.env }).trim();
  const ins = db.prepare('INSERT OR REPLACE INTO dataset (key, value) VALUES (?, ?)');
  transaction(db, () => {
    ins.run('version', version);
    ins.run('git_commit', gitCommit);
    ins.run('inputs_hash', inputs);
    ins.run('votes_from', votes.from);
    ins.run('ord_seed', seedVersion);
    ins.run('table_checksums', JSON.stringify(checksums));
    ins.run('unstamped_candidacies', String(result.facts.unstampedCandidacies));
  });
  db.close();
  for (const suffix of ['', '-journal']) rmSync(OUT + suffix, { force: true });
  renameSync(NEXT, OUT);
  writeFileSync(STATE, `${JSON.stringify({ inputs, unstamped: result.facts.unstampedCandidacies, version, gitCommit, builtAt: new Date().toISOString(), timings }, null, 2)}\n`);

  console.log(`\nrecords:build ${version} -> ${rel(OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const [name, n] of Object.entries(counts)) console.log(`  ${name.padEnd(26)} ${n}`);
  console.log(`  largest value: ${JSON.stringify(result.facts.largestValue)}`);
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  if (error.status === 2) console.error('NEEDS RELATIVES HARVEST: stop and report; do not guess.');
  process.exit(1);
}

