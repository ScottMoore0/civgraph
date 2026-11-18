#!/usr/bin/env node
/**
 * The refactor's acceptance suite (rf-final, 18 Nov 2026): config/acceptance.json lists each
 * acceptance criterion (the owner's A1-A5 and the plan's items) with its evidence and, for an
 * open one, its gaps. This runs the evidence and measures the gaps.
 *
 *   npm run test:acceptance                   every criterion (node tests, npm checks, assertions)
 *   npm run test:acceptance -- --browser      also the browser evidence (Playwright; a local server)
 *   npm run test:acceptance -- --only A1,P2   some criteria
 *   npm run test:acceptance -- --measures     only the gap measures and assertions (no tests run)
 *
 * It fails when a piece of evidence fails, when an assertion does not hold, and when a gap's
 * measure differs from the value config/acceptance.json records (grown: a regression; shrunk:
 * write the new value down, and mark the criterion met when its last gap closes). A summary is
 * printed, and written to tmp/acceptance-report.json.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @typedef {{ measure: string, value: number, note?: string }} Gap
 * @typedef {{ tests?: string[], npm?: string[], asserts?: string[], browser?: string[] }} Evidence
 * @typedef {{ id: string, title: string, status: 'met' | 'open', note?: string, evidence: Evidence, gaps?: Gap[] }} Criterion
 * @typedef {{ testRoot?: string, criteria: Criterion[] }} AcceptanceFile
 * @typedef {{ ok: boolean, detail: string }} Outcome
 */

/** @param {string} rel */
const readText = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
/** @param {string} rel @returns {unknown} */
const readJson = (rel) => JSON.parse(readText(rel));

/** Tracked files matching git pathspecs. @param {string[]} specs */
function tracked(specs) {
  return execFileSync('git', ['ls-files', '-z', '--', ...specs], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
}

/** A source without comments. @param {string} source */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/**
 * Whether a module is only a re-export shim at an old path: nothing but `export ... from`
 * statements, and not a Pages route (a route file re-exports its handler for good).
 * @param {string} source
 */
export function isShim(source) {
  const code = stripComments(source).trim();
  if (!code || /\bonRequest/.test(code)) return false;
  const statements = code.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
  return statements.every((s) => /^export\s[\s\S]*?\sfrom\s*['"][^'"]+['"]$/.test(s));
}

/**
 * The compiler options a tsconfig ends up with, following `extends` (relative paths only).
 * @param {string} rel
 * @returns {Record<string, unknown>}
 */
export function effectiveOptions(rel) {
  const config = /** @type {{ extends?: string, compilerOptions?: Record<string, unknown> }} */ (readJson(rel));
  const base = config.extends ? effectiveOptions(path.posix.join(path.posix.dirname(rel), config.extends)) : {};
  return { ...base, ...(config.compilerOptions ?? {}) };
}

/** Every type-check config and package project (not the solution, which compiles nothing). */
function checkConfigs() {
  return tracked(['config/tsconfig*.json', 'functions/tsconfig*.json', 'scripts/intake/tsconfig.json', 'packages/*/tsconfig*.json'])
    .filter((f) => f !== 'config/tsconfig.packages.json');
}

/** The files the package projects compile, through the TypeScript API. */
async function projectFiles() {
  const ts = (await import('typescript')).default;
  /** @type {Set<string>} */
  const out = new Set();
  for (const rel of tracked(['packages/*/tsconfig.project*.json'])) {
    const abs = path.join(ROOT, rel);
    const read = ts.readConfigFile(abs, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(abs), undefined, abs);
    for (const f of parsed.fileNames) out.add(path.relative(ROOT, f).split(path.sep).join('/'));
  }
  return out;
}

/** @type {Record<string, (arg: string) => number | Promise<number>>} */
export const MEASURES = {
  // A Python scraper that spells its council list out (a literal list opening on its own line).
  'python-literal-council-lists': () => tracked(['scripts/*.py']).filter((f) => /^COUNCILS\s*=\s*\[\s*$/m.test(readText(f))).length,
  // A re-export left at a moved module's old path, which says so ("old-path shims"); the served
  // mapping's shims under site/ and package entry points are not old paths.
  'old-path-shims': () => tracked(['*.js', '*.mjs']).filter((f) => { const s = readText(f); return /old-path shims/.test(s) && isShim(s); }).length,
  'configs-without': (flag) => checkConfigs().filter((f) => effectiveOptions(f)[flag] !== true && !f.startsWith('packages/types/')).length,
  'package-files-left': async () => {
    const compiled = await projectFiles();
    return tracked(['packages/*.js', 'packages/*.mjs']).filter((f) => !compiled.has(f) && !/\/(?:build|generated)\//.test(f)).length;
  },
  'ingest-parity-blocked': () => Object.values(/** @type {{ steps: Record<string, Record<string, unknown>> }} */ (readJson('scripts/ingest/parity.json')).steps).filter((s) => 'blocked' in s).length,
};

/** @type {Record<string, (arg: string) => Outcome>} */
export const ASSERTS = {
  'architecture-baseline-empty': (check) => {
    const entries = Object.keys(/** @type {Record<string, Record<string, unknown>>} */ (readJson('config/architecture-baseline.json'))[check] ?? {});
    return { ok: entries.length === 0, detail: `${check} baseline: ${entries.length} file(s)` };
  },
  'engines-baseline-empty': () => {
    const n = (/** @type {{ engines?: { baseline?: string[] } }} */ (readJson('config/boundaries.json')).engines?.baseline ?? []).length;
    return { ok: n === 0, detail: `engine-rule baseline: ${n}` };
  },
  'boundaries-baseline-empty': () => {
    const n = (/** @type {{ baseline?: string[] }} */ (readJson('config/boundaries.json')).baseline ?? []).length;
    return { ok: n === 0, detail: `import-rule baseline: ${n}` };
  },
  file: (rel) => ({ ok: existsSync(path.join(ROOT, rel)), detail: rel }),
};

/** Split 'name:arg' into its parts. @param {string} spec */
const parts = (spec) => { const i = spec.indexOf(':'); return i < 0 ? [spec, ''] : [spec.slice(0, i), spec.slice(i + 1)]; };

/**
 * A gap's verdict: equal to the recorded value passes; anything else fails, saying which way.
 * @param {Gap} gap
 * @param {number} now
 * @returns {Outcome}
 */
export function judgeGap(gap, now) {
  if (now === gap.value) return { ok: true, detail: `${gap.measure} = ${now}` };
  if (now > gap.value) return { ok: false, detail: `${gap.measure} grew from ${gap.value} to ${now}: a regression` };
  return { ok: false, detail: `${gap.measure} shrank from ${gap.value} to ${now}: record ${now} in config/acceptance.json${now === 0 ? ' and mark the criterion met' : ''}` };
}

/**
 * A criterion's test file as a path from the repository root: the file lists test files relative
 * to its testRoot (the tests directory), so the list does not repeat the directory name.
 * @param {{ testRoot?: string }} file @param {string} t
 */
export const testPath = (file, t) => (file.testRoot ? path.posix.join(file.testRoot, t) : t);

/**
 * The file with every criterion's test files given from the repository root.
 * @template {{ testRoot?: string, criteria: Array<{ evidence: { tests?: string[] } }> }} F
 * @param {F} file @returns {F}
 */
export const withTestPaths = (file) => ({
  ...file,
  criteria: file.criteria.map((c) => (c.evidence.tests ? { ...c, evidence: { ...c.evidence, tests: c.evidence.tests.map((t) => testPath(file, t)) } } : c)),
});

/**
 * Check the file's own shape: a met criterion has no gaps, an open one has some.
 * @param {AcceptanceFile} file
 * @returns {string[]}
 */
export function shapeProblems(file) {
  const problems = [];
  const ids = new Set();
  for (const c of file.criteria) {
    if (ids.has(c.id)) problems.push(`${c.id}: listed twice`);
    ids.add(c.id);
    if (c.status === 'met' && c.gaps?.length) problems.push(`${c.id}: met, but lists gaps`);
    if (c.status === 'open' && !c.gaps?.length) problems.push(`${c.id}: open, but lists no gap`);
    for (const t of c.evidence.tests ?? []) if (!existsSync(path.join(ROOT, testPath(file, t)))) problems.push(`${c.id}: no test file ${t}`);
    for (const a of c.evidence.asserts ?? []) if (!(parts(a)[0] in ASSERTS)) problems.push(`${c.id}: unknown assertion ${a}`);
    for (const g of c.gaps ?? []) if (!(parts(g.measure)[0] in MEASURES)) problems.push(`${c.id}: unknown measure ${g.measure}`);
  }
  return problems;
}

/**
 * Run a command; resolve with its exit code and the tail of its output.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ code: number, tail: string }>}
 */
function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, shell: process.platform === 'win32' && command === 'npm', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out = (out + d).slice(-20000); });
    child.stderr.on('data', (d) => { out = (out + d).slice(-20000); });
    child.on('close', (code) => resolve({ code: code ?? 1, tail: out.split(/\r?\n/).filter(Boolean).slice(-12).join('\n') }));
  });
}

/**
 * Run jobs a few at a time.
 * @template T
 * @param {(() => Promise<T>)[]} jobs
 * @param {number} limit
 * @returns {Promise<T[]>}
 */
async function pool(jobs, limit) {
  /** @type {T[]} */
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await /** @type {() => Promise<T>} */ (jobs[i])();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const browser = argv.includes('--browser');
  const measuresOnly = argv.includes('--measures');
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? new Set((argv[onlyAt + 1] ?? '').split(',')) : null;
  const listed = /** @type {AcceptanceFile} */ (readJson('config/acceptance.json'));
  const shape = shapeProblems(listed);
  const file = withTestPaths(listed);
  for (const p of shape) console.error(`FAIL: config/acceptance.json: ${p}`);
  const criteria = file.criteria.filter((c) => !only || only.has(c.id));

  // Evidence, each test file and npm script once, however many criteria cite it.
  /** @type {Map<string, Outcome>} */
  const results = new Map();
  if (!measuresOnly) {
    const tests = [...new Set(criteria.flatMap((c) => c.evidence.tests ?? []))];
    const scripts = [...new Set(criteria.flatMap((c) => [...(c.evidence.npm ?? []), ...(browser ? c.evidence.browser ?? [] : [])]))];
    const jobs = [
      ...tests.map((t) => async () => { const r = await run(process.execPath, ['--test', t]); results.set(t, { ok: r.code === 0, detail: r.tail }); }),
      ...scripts.map((s) => async () => { const r = await run('npm', ['run', '-s', s]); results.set(`npm:${s}`, { ok: r.code === 0, detail: r.tail }); }),
    ];
    console.log(`Running ${tests.length} test files and ${scripts.length} npm scripts for ${criteria.length} criteria...`);
    await pool(jobs, 6);
  }

  const report = [];
  let failed = shape.length > 0;
  for (const c of criteria) {
    /** @type {string[]} */
    const problems = [];
    for (const key of [...(c.evidence.tests ?? []), ...(c.evidence.npm ?? []).map((s) => `npm:${s}`), ...(browser ? c.evidence.browser ?? [] : []).map((s) => `npm:${s}`)]) {
      const r = results.get(key);
      if (r && !r.ok) problems.push(`${key} failed:\n${r.detail.replace(/^/gm, '      ')}`);
    }
    for (const a of c.evidence.asserts ?? []) {
      const [name, arg] = parts(a);
      const r = /** @type {(arg: string) => Outcome} */ (ASSERTS[name])(arg);
      if (!r.ok) problems.push(`assertion ${a} does not hold (${r.detail})`);
    }
    /** @type {{ measure: string, value: number, now: number }[]} */
    const gaps = [];
    for (const g of c.gaps ?? []) {
      const [name, arg] = parts(g.measure);
      const now = await /** @type {(arg: string) => number | Promise<number>} */ (MEASURES[name])(arg);
      const verdict = judgeGap(g, now);
      if (!verdict.ok) problems.push(verdict.detail);
      gaps.push({ measure: g.measure, value: g.value, now });
    }
    if (problems.length) failed = true;
    const mark = problems.length ? 'FAIL' : c.status === 'met' ? 'MET ' : 'OPEN';
    console.log(`${mark} ${c.id} ${c.title}`);
    for (const g of c.gaps ?? []) console.log(`       gap: ${g.measure} = ${gaps.find((x) => x.measure === g.measure)?.now} (${g.note ?? ''})`);
    for (const p of problems) console.log(`       ${p}`);
    report.push({ id: c.id, title: c.title, status: c.status, ok: problems.length === 0, problems, gaps });
  }
  mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  writeFileSync(path.join(ROOT, 'tmp', 'acceptance-report.json'), `${JSON.stringify({ date: new Date().toISOString(), browser, measuresOnly, report }, null, 1)}\n`);
  const met = report.filter((r) => r.status === 'met').length;
  console.log(`\n${failed ? 'ACCEPTANCE FAILED' : 'ACCEPTANCE OK'}: ${met} of ${report.length} criteria met, ${report.length - met} open with recorded gaps${measuresOnly ? ' (measures only: no tests run)' : ''}${browser ? '' : '; browser evidence not run (--browser)'}.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
