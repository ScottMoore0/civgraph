#!/usr/bin/env node
/**
 * Does D1 hold exactly the local build? Per table, COUNT(*) and SUM(row_hash_n) locally (node:sqlite)
 * and in D1 (one wrangler call holding a statement per table), plus the schema (sqlite_master).
 *
 *   node scripts/records/verify-load.mjs --local [--db tmp/records/civgraph-records.sqlite]
 *   node scripts/records/verify-load.mjs --remote          (only inside an approved publish)
 *
 * Exits non-zero on any difference, naming the tables. Wrangler's output is redirected to a file
 * and read back (piping wrangler through a shell on Windows loses output), and the R2 variables
 * are removed from its environment (they make D1 calls fail with "Authentication error 10000").
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT } from './paths.mjs';
import { HASHED_TABLES } from './schema.mjs';

/**
 * The D1 database behind the ELECTIONS_DB binding, read from wrangler.toml's production
 * [[d1_databases]] block, so the binding the Functions use and the database every records
 * command loads or verifies are one setting (go-live switches both by editing wrangler.toml).
 */
export function recordsDbName(tomlText) {
  const top = String(tomlText).split(/^\[env\./m)[0];
  for (const block of top.split(/^\[\[d1_databases\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\[/m)[0];
    if (/^\s*binding\s*=\s*"ELECTIONS_DB"/m.test(body)) {
      const m = body.match(/^\s*database_name\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    }
  }
  throw new Error('wrangler.toml has no production [[d1_databases]] block for ELECTIONS_DB');
}
export const D1_NAME = recordsDbName(readFileSync(path.join(REPO_ROOT, 'wrangler.toml'), 'utf8'));
export const PERSIST_DIR = '.wrangler/state';

/** wrangler's entry script: CIVGRAPH_WRANGLER_JS, the project's, the global install, or `npm root -g`. */
export const WRANGLER = (() => {
  const candidates = [
    process.env.CIVGRAPH_WRANGLER_JS,
    path.join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (found) return found;
  const root = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout?.trim();
  return root ? path.join(root, 'wrangler', 'bin', 'wrangler.js') : candidates[1];
})();

export function d1Env() {
  const env = { ...process.env };
  for (const k of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_S3_ENDPOINT']) delete env[k];
  return env;
}

const tableChecksumSql = (t) => `SELECT '${t.name}' AS t, COUNT(*) AS n, COALESCE(SUM(row_hash_n), 0) AS s FROM ${t.name}`;

/** One statement per table, all in one wrangler call (D1 limits the terms of a compound SELECT). */
export function checksumSql() {
  return HASHED_TABLES.map(tableChecksumSql).join('; ');
}

const SCHEMA_SQL = "SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name";

/** Run SQL through wrangler d1 execute and return the result rows. */
export function wranglerQuery(sql, { remote = false, cwd = REPO_ROOT } = {}) {
  const dir = path.join(REPO_ROOT, 'tmp', 'records');
  mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `wrangler-${process.pid}-${Date.now()}.json`);
  const fd = openSync(outFile, 'w');
  const target = remote ? ['--remote'] : ['--local', '--persist-to', PERSIST_DIR];
  // wrangler's own entry script under node, with no shell: a shell on Windows splits the SQL.
  const res = spawnSync(process.execPath, [WRANGLER, 'd1', 'execute', D1_NAME, ...target, '--json', '--command', sql], {
    cwd, env: d1Env(), stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  closeSync(fd);
  const text = readFileSync(outFile, 'utf8');
  if (res.status !== 0) throw new Error(`wrangler d1 execute failed (${res.status}): ${(res.stderr || text).slice(-800)}`);
  const parsed = JSON.parse(text.slice(text.indexOf('[')));
  return parsed.flatMap((r) => r.results || []);
}

export function localChecksums(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = HASHED_TABLES.map((t) => db.prepare(tableChecksumSql(t)).get());
  const schema = db.prepare(SCHEMA_SQL).all();
  db.close();
  return { tables: Object.fromEntries(rows.map((r) => [r.t, { n: Number(r.n), s: Number(r.s) }])), schema };
}

/** Compare a local database with a D1 database (or with any query function, for tests). */
export function compareLoad(local, remote) {
  const mismatches = [];
  for (const t of HASHED_TABLES) {
    const a = local.tables[t.name];
    const b = remote.tables[t.name];
    if (!b || a.n !== b.n || a.s !== b.s) mismatches.push(`${t.name}: local ${a?.n}/${a?.s}, D1 ${b?.n}/${b?.s}`);
  }
  const norm = (sql) => String(sql || '').replace(/\s+/g, ' ').trim();
  const remoteSchema = new Map(remote.schema.map((r) => [r.name, norm(r.sql)]));
  for (const r of local.schema) {
    if (remoteSchema.get(r.name) !== norm(r.sql)) mismatches.push(`schema ${r.name} differs or is missing`);
  }
  return mismatches;
}

export function verify({ file, remote = false, query = wranglerQuery }) {
  const local = localChecksums(file);
  const rows = query(checksumSql(), { remote });
  const schema = query(SCHEMA_SQL, { remote });
  const d1 = { tables: Object.fromEntries(rows.map((r) => [r.t, { n: Number(r.n), s: Number(r.s) }])), schema };
  return compareLoad(local, d1);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'verify-load.mjs') {
  const args = process.argv.slice(2);
  const remote = args.includes('--remote');
  const i = args.indexOf('--db');
  const file = path.resolve(i >= 0 ? args[i + 1] : path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite'));
  const mismatches = verify({ file, remote });
  if (mismatches.length) {
    console.error(`FAIL: ${remote ? 'remote' : 'local'} D1 differs from ${path.relative(REPO_ROOT, file)}`);
    for (const m of mismatches) console.error(`  ${m}`);
    process.exit(1);
  }
  console.log(`PASS: ${remote ? 'remote' : 'local'} D1 equals ${path.relative(REPO_ROOT, file)} (${HASHED_TABLES.length} tables, schema)`);
}
