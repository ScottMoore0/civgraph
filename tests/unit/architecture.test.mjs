// check:architecture (scripts/check/architecture.mjs, docs/ARCHITECTURE-RULES.md): each check on
// in-memory fixtures (one that must be found, one that must not), the escape hatch, the baseline
// arithmetic and the report-only date; and the real charter's structure (C13 without the pointers,
// which the main session adds to CLAUDE.md and AGENTS.md).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { baselineGrowth, CHECKS, compare, enforcing, nextBaseline, runChecks } from '../../scripts/check/architecture.mjs';
import { C1, C2 } from '../../scripts/check/architecture/boundary-checks.mjs';
import { C13, charterProblems } from '../../scripts/check/architecture/charter.mjs';
import { C3 } from '../../scripts/check/architecture/copies.mjs';
import { C9, parseApiUrl } from '../../scripts/check/architecture/contracts.mjs';
import { createContext, excusedBy, markerOn, parseDiff } from '../../scripts/check/architecture/lib.mjs';
import { C7 } from '../../scripts/check/architecture/lifecycle.mjs';
import { C10, C5, C8, PALETTE_MODULES, cssColours } from '../../scripts/check/architecture/literals.mjs';
import { C12, C6 } from '../../scripts/check/architecture/state.mjs';
import { anyLines, C11 } from '../../scripts/check/architecture/types.mjs';
import { buildVocabulary, C4 } from '../../scripts/check/architecture/vocabulary.mjs';

const ALL = { include: ['site/', 'packages/'] };
/** @param {Record<string, string>} sources @param {Record<string, unknown>} [config] @param {Record<string, unknown>} [extra] */
const ctxOf = (sources, config = {}, extra = {}) => createContext({ root: '/fixture', sources, config, ...extra });
/** @param {{ run: Function }} check @param {ReturnType<typeof ctxOf>} ctx */
const lines = async (check, ctx) => (await check.run(ctx)).map((/** @type {{ file: string, line: number }} */ f) => `${f.file}:${f.line}`);

test('arch-ok: a marker needs its rule and a reason, and covers its line and the next', () => {
  assert.deepEqual(markerOn("x(); // arch-ok R6: month names are the formatter's own table"), { rule: 'R6', reason: "month names are the formatter's own table" });
  assert.deepEqual(markerOn('/* arch-ok R9: print colours */'), { rule: 'R9', reason: 'print colours' });
  assert.deepEqual(markerOn('// arch-ok'), { malformed: true });
  assert.deepEqual(markerOn('// arch-ok R6'), { malformed: true });
  assert.deepEqual(markerOn('// arch-ok R6: ok'), { malformed: true }, 'a reason is more than a word of two letters');
  assert.equal(markerOn('plain code'), null);
  const src = ['// arch-ok R6: kept', 'a();', 'b(); // arch-ok R7: dispatch', 'c();'];
  assert.equal(excusedBy(src, 2, 'R6')?.line, 1);
  assert.equal(excusedBy(src, 3, 'R7')?.line, 3);
  assert.equal(excusedBy(src, 3, 'R6'), null, 'another rule does not excuse');
  assert.equal(excusedBy(src, 4, 'R7')?.line, 3, 'the line above counts');
});

test('parseDiff: the added and changed lines per file', () => {
  const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -1,0 +2,3 @@', '+a', '+b', '+c', '@@ -10 +12 @@', '-old', '+new', '+++ /dev/null'].join('\n');
  assert.deepEqual([...(parseDiff(diff).get('x.js') || [])], [2, 3, 4, 12]);
});

test('C1 and C2: empty unit paths, imports outside the rules, scripts in no unit, stale unowned entries', async () => {
  const boundaries = {
    edges: () => [{ file: 'site/a.js', target: 'packages/api/x.js', from: 'site', to: 'api', ok: false }, { file: 'site/b.js', target: 'site/c.js', from: 'site', to: 'site', ok: true }, { file: 'p/q.js', target: 'site/r.js', from: 'api', to: 'site', ok: false }],
    trackedScripts: () => ['site/a.js', 'loose/x.js'],
    unownedFiles: () => ({ missing: ['loose/x.js'], stale: ['docs/'] }),
    emptyUnitPaths: () => ['frontend: browse/'],
    baseline: ['p/q.js -> site/r.js'],
  };
  const ctx = ctxOf({}, {}, { boundaries });
  assert.deepEqual((await C1.run(ctx)).map((f) => f.file), ['config/boundaries.json', 'site/a.js']);
  assert.deepEqual((await C2.run(ctx)).map((f) => f.file), ['loose/x.js', 'config/boundaries.json']);
});

test('C3: a function named like a package export is a marked copy with a parity test', async () => {
  const sources = {
    'packages/core/src/html.js': 'export function escapeHtml(s) { return s; }\nexport const slug = (a, b) => a;',
    'site/x.js': 'function escapeHtml(s) { return s; }\nfunction slug(a) { return a; }',
    'site/y.js': '// copy-of: packages/core/src/html.js\nfunction escapeHtml(t) { return t; }',
    'site/z.js': '// copy-of: packages/core/src/html.js\nconst escapeHtml = (t) => t;',
    'tests/unit/z.test.mjs': "import '../../site/z.js'; // escapeHtml parity",
    'site/w.js': "import { esc } from '../pkg/core/html.js';\nexport function escapeHtml(s) { return String(esc(s)); }", // a thin adapter: none
    'site/v.js': "import { esc } from '../pkg/core/html.js';\nfunction escapeHtml(s) { const t = String(s); return esc(t).trim(); }", // more than an adapter: hit
  };
  const ctx = ctxOf(sources, { C3: { include: ['site/'], packages: ['packages/core/src/'], tests: ['tests/'] } });
  const found = await C3.run(ctx);
  assert.deepEqual(found.map((f) => `${f.file}:${f.line}`), ['site/x.js:1', 'site/y.js:2', 'site/v.js:2'], 'slug has another arity; z is marked and tested; w only adapts an import');
  assert.match(found[1].message, /no parity test/);
});

test('C4: two values of one registry vocabulary in one literal', async () => {
  const vocabulary = buildVocabulary({
    parties: { abbreviations: [{ abbreviation: 'DUP', fullName: 'Democratic Unionist Party', spellings: [] }, ['UUP', 'Ulster Unionist Party']] },
    councils: { councils: [{ id: 'belfast-city-council', bodySlug: 'belfast-city-council' }, { id: 'derry-city-council' }], types: { borough: {}, 'urban-district': {} } },
    statuses: { machines: { contest: { values: ['contested', 'uncontested'] }, other: { transitions: { held: [], partial: [] } } } },
    statusMachines: ['contest'],
    extra: { 'voting system': ['fptp', 'stv-hare'] },
  });
  assert.equal(vocabulary.get('dup'), 'party');
  assert.equal(vocabulary.has('held'), false, 'machines the config leaves out are not vocabulary');
  const sources = {
    'site/a.js': [
      "const parties = ['DUP', 'UUP'];",                                // 1 array: hit
      "const one = ['DUP', 'other'];",                                   // 2 one value: none
      "const label = { fptp: 'First past the post', 'stv-hare': 'STV' };", // 3 object keys: hit
      "const t = new Map([['belfast-city-council', 1], ['derry-city-council', 2]]);", // 4 table: hit
      "if (/^(borough|urban-district)$/.test(x)) {}",                    // 5 regex: hit
      "switch (s) { case 'contested': break; case 'uncontested': break; }", // 6 switch: hit
      "const mixed = ['DUP', 'fptp'];",                                  // 7 two vocabularies, one each: none
      "// arch-ok R6: fixture's own list",
      "const kept = ['DUP', 'UUP'];",                                    // 9 excused by the runner
    ].join('\n'),
  };
  const ctx = ctxOf(sources, { C4: ALL }, { vocabulary });
  assert.deepEqual(await lines(C4, ctx), ['site/a.js:1', 'site/a.js:3', 'site/a.js:4', 'site/a.js:5', 'site/a.js:6', 'site/a.js:9']);
  const [result] = await runChecks(ctx, [C4]);
  assert.equal(result.findings.filter((f) => f.excused).length, 1);
});

test('C5: origins, the User-Agent and records paths spelled out in code, not comments', async () => {
  const ctx = ctxOf({ 'site/a.js': "// see https://civgraph.net\nconst u = 'https://data.civgraph.net/x';\nconst db = 'tmp/records/civgraph-records.sqlite';" }, { C5: ALL });
  assert.deepEqual(await lines(C5, ctx), ['site/a.js:2', 'site/a.js:3']);
});

test('C6: string states, co-changing flags and promise-as-state, only on changed lines', async () => {
  const source = [
    "let mode = 'a';",                                     // 1
    "function f() { if (mode === 'b') mode = 'c'; }",      // 2  mode: a|b|c -> hit
    "/** @type {'p'|'q'|'r'} */ let phase = 'p';",          // 3  declared in a JSDoc union: none
    "function g() { phase = 'q'; phase = 'r'; }",           // 4
    "const M = defineMachine({ name: 'm', initial: 'idle', transitions: { idle: ['busy'], busy: ['done'], done: [] } });",
    "let runState = 'idle'; runState = 'busy'; runState = 'done';", // 6 declared by the machine: none
    "function h() { this.loading = true; this.ready = false; this.loading = false; this.ready = true; }", // 7 flags: hit
    'let cached = null;',                                   // 8
    "function load() { cached = fetch('/x').catch(() => { cached = null; }); return cached; }", // 9 promise-as-state: hit
    "function route(view) { if (view === 'x') return 1; if (view === 'y') return 2; if (view === 'z') return 3; }", // 10 only compared (a dispatch): none
    "const tab = params.get('t') || 'maps'; if (tab === 'books' || tab === 'elections') {}", // 11 a fallback is an assignment: hit
  ].join('\n');
  const all = ctxOf({ 'site/s.js': source }, { C6: ALL }, { all: true });
  assert.deepEqual(await lines(C6, all), ['site/s.js:1', 'site/s.js:11', 'site/s.js:7', 'site/s.js:8']);
  const diffOnly = ctxOf({ 'site/s.js': source }, { C6: ALL }, { changedLines: new Map([['site/s.js', new Set([2, 3])]]) });
  assert.deepEqual(await lines(C6, diffOnly), ['site/s.js:2'], 'only the finding with a changed line, reported there');
  const untouched = ctxOf({ 'site/s.js': source }, { C6: ALL }, { changedLines: new Map() });
  assert.deepEqual(await lines(C6, untouched), []);
  const [skipped] = await runChecks(ctxOf({ 'site/s.js': source }, { C6: ALL }), [C6]);
  assert.match(String(skipped.skipped), /no base branch/, 'no diff base and no --all: skipped, not read whole');
  const refined = [
    '/** @type {SheetKind} */',                                                // 1
    "let kind = 'single';",                                                     // 2 typed by a union defined elsewhere: none
    "function k() { if (x) kind = 'stages'; else kind = 'order'; }",            // 3
    "const status = p === 'polled' ? LABELS.contested : 'Votes not recorded';", // 4 a label, not a state: none
    "function s() { if (status === 'complete' || status === 'held') {} }",      // 5 two tokens only
    '/** @type {string} */',                                                    // 6
    "let stage = 'a';",                                                         // 7 typed only as string: hit
    "function t() { stage = 'b'; stage = 'c'; }",                               // 8
    'let ready = null;',                                                        // 9
    "function load() { ready = start().catch((e) => { engine.to('failed'); ready = null; throw e; }); }", // 10 the cache of a machine: none
  ].join('\n');
  assert.deepEqual(await lines(C6, ctxOf({ 'site/r.js': refined }, { C6: ALL }, { all: true })), ['site/r.js:7']);
});

test('C7: listeners on long-lived targets inside functions need { signal } or a removal', async () => {
  const source = [
    "document.addEventListener('keydown', top);",                              // 1 module top level: none
    'export function view(root, { signal }) {',
    "  root.addEventListener('input', onInput);",                               // 3 hit
    "  root.addEventListener('change', onChange, { signal });",                 // 4 none
    "  window.addEventListener('resize', onResize);",                           // 5 removed below: none
    "  window.removeEventListener('resize', onResize);",
    "  document.addEventListener('click', onClick, { once: true });",           // 7 none
    "  document.addEventListener('scroll', onScroll);",                         // 8 hit
    "  el.addEventListener('click', onClick);",                                 // 9 not long-lived: none
    '}',
  ].join('\n');
  assert.deepEqual(await lines(C7, ctxOf({ 'site/v.js': source }, { C7: ALL })), ['site/v.js:3', 'site/v.js:8']);
  const named = [
    'export function view(root, ctx) {',
    '  const listen = { signal: ctx.signal };',
    '  const opts = { passive: true };',
    "  root.addEventListener('input', onInput, listen);",                        // 4 declared with signal: none
    "  root.addEventListener('change', onChange, opts);",                        // 5 hit: no signal in it
    '}',
  ].join('\n');
  assert.deepEqual(await lines(C7, ctxOf({ 'site/w.js': named }, { C7: ALL })), ['site/w.js:5'], 'an options variable declared as { signal } counts');
});

test('C8: colour literals in stylesheets and served JS', async () => {
  assert.deepEqual(cssColours('a:hover { color: #fff; }\n#abc { background: var(--cg-bg); }\n.x {\n  border: 1px solid rgba(0, 0, 0, .2);\n  fill: rgb(var(--c));\n}').map((c) => `${c.line} ${c.value}`), ['1 #fff', '4 rgba(0']);
  const sources = {
    'site/a.css': '/* #000 in a comment */\n.a { color: #123456 }',
    'packages/ui/assets/tokens.css': ':root { --cg-ink: #111; }',
    'site/b.js': "const ink = '#ff0000';\nconst id = '#map';\nconst css = `fill: rgb(1, 2, 3)`;",
  };
  const cfg = { C8: { css: { include: ['site/', 'packages/'], exclude: ['packages/ui/assets/tokens.css'] }, js: { include: ['site/'] } } };
  assert.deepEqual(await lines(C8, ctxOf(sources, cfg)), ['site/a.css:2', 'site/b.js:1', 'site/b.js:3']);
});

test('C8: a registry palette part (its generated slice module) may hold colours, and nothing else may', async () => {
  const dir = 'packages/registries/src/browser/';
  const header = (/** @type {string} */ slice) => `// Generated by packages/registries/src/browser/build.mjs from ${slice}; do not edit.`;
  assert.deepEqual([...PALETTE_MODULES.keys()], [`${dir}party-palettes.data.mjs`, `${dir}colours.data.mjs`], 'the palette slices build.mjs lists');
  const sources = {
    [`${dir}colours.data.mjs`]: `${header('colours.json')}\nexport default { "map": { "layer": "#3388ff" } };\n`,
    [`${dir}party-palettes.data.mjs`]: "export default { neutral: '#6b7280' };\n",
    [`${dir}statuses.data.mjs`]: `${header('statuses.json')}\nexport default { "x": "#ffffff" };\n`,
    'site/colours.data.mjs': `${header('colours.json')}\nexport default { "x": "#ffffff" };\n`,
  };
  const cfg = { C8: { css: { include: [] }, js: { include: ['site/', dir] } } };
  assert.deepEqual(await lines(C8, ctxOf(sources, cfg)), [
    `${dir}party-palettes.data.mjs:1`, // a palette slice's path without the generator's header
    `${dir}statuses.data.mjs:2`, // a generated slice that is not a palette part
    'site/colours.data.mjs:2', // the name elsewhere
  ]);
});

test('C9: every route, view and parameter a page requests has a v1 variant', async () => {
  const contracts = {
    elections: { variants: [{ name: 'detail', when: { view: 'detail' }, schema: { properties: { item: { type: 'object' } } } }, { name: 'contest', when: { key: '*', constituency: '*' } }, { name: 'index', when: { key: '' } }] },
    'proni/node': { variants: [{ name: 'node', when: { ref: '*' } }, { name: 'roots', when: {} }] },
  };
  assert.deepEqual(parseApiUrl('/_api/proni/node?ref=\u0000', Object.keys(contracts)), { route: 'proni/node', path: 'proni/node', params: { ref: '*' } });
  const sources = {
    'site/a.js': [
      "fetch('/_api/elections?view=detail&key=x');",          // 1 covered (a note: item is only object)
      "fetch(`/_api/elections?view=citations&key=${k}`);",     // 2 no variant
      "fetch('/_api/nothing');",                               // 3 no contract
      "fetch('/_api/elections?body=x');",                      // 4 parameter in no when
      "fetch('/_api/elections?key=a&limit=5');",               // 5 limit is a modifier
      "fetch('/_api/auth/status');",                           // 6 ignored route
    ].join('\n'),
    'site/b.js': "const API = '/_api/elections';\ngetJson({ view: 'summary', key });\ngetJson({ key, constituency: 1 });",
  };
  const cfg = { C9: { include: ['site/'], clientCalls: ['getJson'], ignoreRoutes: { auth: 'sign-in' }, modifiers: { '*': ['limit'] } } };
  const found = await C9.run(ctxOf(sources, cfg, { contracts }));
  assert.deepEqual(found.map((f) => `${f.file}:${f.line}`), ['site/a.js:2', 'site/a.js:3', 'site/a.js:4', 'site/b.js:2']);
  assert.equal(/** @type {{ notes?: string[] }} */ (found).notes?.length, 1);
});

test('C10: hard-coded locales and month-name arrays', async () => {
  const ctx = ctxOf({ 'site/a.js': "n.toLocaleString('en-GB');\nconst M = ['Jan', 'Feb', 'Mar'];\nconst lang = 'en';" }, { C10: ALL });
  assert.deepEqual(await lines(C10, ctx), ['site/a.js:1', 'site/a.js:2']);
});

test('C11: explicit any in JSDoc types and type-check suppressions', async () => {
  assert.deepEqual(anyLines('/** @param {any} a\n * @returns {Promise<Array<any>>} many things */\n// @ts-ignore\nconst x = 1; // mentions @ts-nocheck in prose').map((x) => `${x.line} ${x.what}`), ['1 explicit any', '2 explicit any', '3 @ts-ignore']);
  assert.deepEqual(await lines(C11, ctxOf({ 'site/a.js': '/** @type {any} */ let a;\n/** @type {Company} */ let b;' }, { C11: ALL })), ['site/a.js:1']);
});

test('C12: machine modules are imported by a test that names each machine', async () => {
  const sources = {
    'site/x/state-machines.js': "export const LOAD = defineMachine({});\nexport const VIEW = defineToggle('v', ['a', 'b']);",
    'site/y/state-machines.js': 'export const OTHER = defineMachine({});',
    'tests/unit/x.test.mjs': "import { LOAD } from '../../site/x/state-machines.js';",
  };
  const cfg = { C12: { include: ['site/'], tests: ['tests/'], modules: '(^|/)state-machines\\.js$' } };
  assert.deepEqual(await lines(C12, ctxOf(sources, cfg)), ['site/x/state-machines.js:2', 'site/y/state-machines.js:1']);
});

test('C13: the charter states each rule and what checks it; CLAUDE.md and AGENTS.md point to it', async () => {
  const good = ['# Rules', '', '> **Status: current.**', '', '**R1. One.**', '- Checked by: `check:boundaries`, C1.', '', '**R2. Two.**', '- Checked by: review.'].join('\n');
  const known = { scripts: { 'check:boundaries': 'x', 'check:types:ui': 'y' }, checkIds: ['C1'], ruleCount: 2 };
  assert.deepEqual(charterProblems(good, known), []);
  assert.deepEqual(charterProblems(good.replace('review', 'nothing'), known).map(([, m]) => m), ["R2's \"Checked by\" names no check and does not say review"]);
  assert.deepEqual(charterProblems(good.replace('`check:boundaries`, C1', '`check:gone`, C9, `check:types:*`'), known).map(([, m]) => m), ['R1 names check:gone, which is not an npm script', 'R1 names C9, which check:architecture does not run']);
  assert.match(charterProblems(good.replace('**R2. Two.**', '**R3. Two.**'), known)[0][1], /expected R1 to R2/);
  const sources = { 'docs/RULES.md': good, 'package.json': JSON.stringify({ scripts: known.scripts }), 'CLAUDE.md': 'read docs/RULES.md', 'AGENTS.md': 'nothing' };
  const found = await C13.run(ctxOf(sources, { C13: { path: 'docs/RULES.md', pointers: ['CLAUDE.md', 'AGENTS.md'], ruleCount: 2 } }, { checkIds: ['C1'] }));
  assert.deepEqual(found.map((f) => f.file), ['AGENTS.md']);
});

test('the real charter: R1 to R15, each with an enforcement line that names real checks', () => {
  const config = JSON.parse(readFileSync(new URL('../../config/architecture.json', import.meta.url), 'utf8'));
  const text = readFileSync(new URL(`../../${config.checks.C13.path}`, import.meta.url), 'utf8');
  const scripts = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts;
  assert.deepEqual(charterProblems(text, { scripts, checkIds: CHECKS.map((c) => c.id), ruleCount: config.checks.C13.ruleCount }), []);
  assert.ok(scripts.check.includes('npm run check:architecture'), 'check:architecture is a step of npm run check (so check:fast and CI run it)');
  assert.match(config.enforceFrom, /^\d{4}-\d{2}-\d{2}$/);
});

test('runner: baseline comparison, shrinking, growth and the enforcement date', () => {
  const check = { id: 'C4', rule: 'R6', title: 't', run: () => [] };
  const finding = (/** @type {string} */ file, excused = false) => ({ file, line: 1, message: 'm', excused: excused ? { line: 1, reason: 'r' } : null });
  const results = [{ check, findings: [finding('a.js'), finding('a.js'), finding('b.js'), finding('c.js', true)], notes: [] }];
  const [row] = compare(results, { C4: { 'a.js': 1, 'b.js': 1, 'd.js': 2 } }, []);
  assert.equal(row.newCount, 1, 'a.js has one more than its count');
  assert.deepEqual(row.stale.map((s) => s.file), ['d.js']);
  assert.equal(row.excused, 1);
  assert.deepEqual(compare(results, {}, ['C4'])[0].newCount, 3, 'a check with no baseline counts every unexcused finding');
  assert.deepEqual(nextBaseline(results, { C4: { 'a.js': 5, 'b.js': 1 } }, []), { C4: { 'a.js': 2, 'b.js': 1 } }, 'never grows: c.js is excused, nothing new is taken in');
  assert.deepEqual(nextBaseline(results, null, []), { C4: { 'a.js': 2, 'b.js': 1 } }, '--init-baseline takes what is there');
  assert.deepEqual(baselineGrowth({ C4: { 'a.js': 2 } }, { C4: { 'a.js': 3, 'b.js': 1 }, C7: {} }), ['C4 a.js: 2 -> 3', 'C4 b.js: 0 -> 1']);
  assert.deepEqual(baselineGrowth({ C4: { 'a.js': 2, 'b.js': 1 } }, { C4: { 'a.js': 1 } }), []);
  assert.equal(enforcing('2026-11-18', '2026-11-19'), false);
  assert.equal(enforcing('2026-11-19', '2026-11-19'), true);
});
