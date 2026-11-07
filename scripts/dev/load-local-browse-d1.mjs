#!/usr/bin/env node
/**
 * Load the browse_* tables (persons, sources, register-interests) into the LOCAL D1 that
 * `npm run dev:records` serves, so the server-rendered record pages run against real rows.
 *
 *   node scripts/dev/load-local-browse-d1.mjs [--sql-dir <dir>] [--persist-to <dir>] [--only persons]
 *
 * It reads the import SQL that scripts/build/build-browse-index-d1-import.mjs writes
 * (data/database/<type>-d1-import.sql, gitignored). A worktree without a data build can point
 * --sql-dir at another checkout's data/database. Each file drops and recreates its tables,
 * so a rerun is a clean reload.
 *
 * LOCAL ONLY: every call carries --local and --persist-to; there is no flag that reaches the
 * remote database. Publishing D1 is .claude/publish/'s job, with the owner's approval.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = ['persons', 'register-interests', 'sources'];

export function parseArgs(argv) {
  const opts = { sqlDir: path.join(ROOT, 'data', 'database'), persistTo: path.join(ROOT, '.wrangler', 'state'), only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--sql-dir') opts.sqlDir = path.resolve(argv[++i]);
    else if (a === '--persist-to') opts.persistTo = path.resolve(argv[++i]);
    else if (a === '--only') opts.only = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (opts.only && !TYPES.includes(opts.only)) throw new Error(`--only must be one of ${TYPES.join(', ')}`);
  return opts;
}

/** The wrangler argv for one file. Always local. */
export function wranglerArgs(file, persistTo) {
  return ['wrangler', 'd1', 'execute', 'civgraph-elections', '--local', '--persist-to', persistTo, '--file', file, '--yes'];
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`load-local-browse-d1: ${e.message}`);
    return 2;
  }
  const types = opts.only ? [opts.only] : TYPES;
  const files = types.map((t) => path.join(opts.sqlDir, `${t}-d1-import.sql`));
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    console.error(`load-local-browse-d1: missing ${missing.join(', ')}`);
    console.error('  Build them with: node scripts/build/build-browse-index-d1-import.mjs --all (needs data/browse), or pass --sql-dir.');
    return 1;
  }
  for (const file of files) {
    console.log(`Loading ${path.basename(file)} (${(statSync(file).size / 1048576).toFixed(1)} MB) into the local D1 at ${opts.persistTo}`);
    const res = spawnSync('npx', wranglerArgs(file, opts.persistTo), { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
    if (res.status !== 0) {
      console.error(`load-local-browse-d1: wrangler failed on ${file}`);
      return 1;
    }
  }
  console.log('Done. Start the site with: npm run dev:records');
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
