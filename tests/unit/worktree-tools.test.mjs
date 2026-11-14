/**
 * The worktree tools and the landing queue (npm run worktree:new, worktree:remove, worktree:own,
 * land; config/worktrees.json): which rebase conflicts land resolves by itself, which check:fast
 * steps a worktree skips for want of an artefact, the write guard that keeps a worktree's writes
 * off the shared snapshot, and that land never pushes.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { globToRegExp, parseConflicts, regenerationSteps, resolveConflict, rulesFor } from '../../scripts/dev/worktree/conflicts.mjs';
import { parseWorktreeList } from '../../scripts/dev/worktree/lib.mjs';
import { artefactPath, missingNeeds } from '../../scripts/lib/artefact-refs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = JSON.parse(readFileSync(path.join(ROOT, 'config', 'worktrees.json'), 'utf8'));
const SCRIPTS = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
const RULES = CONFIG.landing.generated;
const rule = (name) => RULES.find((r) => r.name === name);

test('WT-01 globs: * stays inside a folder, ** crosses folders', () => {
  assert.ok(globToRegExp('site/assets/i18n/*.json').test('site/assets/i18n/en.json'));
  assert.ok(!globToRegExp('site/assets/i18n/*.json').test('site/assets/i18n/x/en.json'));
  assert.ok(globToRegExp('**/api-v1-contracts.baseline.json').test('api-v1-contracts.baseline.json'));
  assert.ok(globToRegExp('**/api-v1-contracts.baseline.json').test('a/b/api-v1-contracts.baseline.json'));
  assert.ok(globToRegExp('packages/types/generated/**').test('packages/types/generated/api/v1.d.ts'));
  assert.ok(!globToRegExp('site/**/*.html').test('site/app.js'));
  assert.deepEqual(rulesFor('site/assets/i18n/ga.json', RULES).map((r) => r.name), ['the interface language files']);
  assert.deepEqual(rulesFor('packages/api/src/v1/contracts/v1.js', RULES), []);
});

const conflict = (ours, theirs, base = null) => [
  'before\n',
  '<<<<<<< HEAD\n', ...ours.map((l) => `${l}\n`),
  ...(base ? ['||||||| base\n', ...base.map((l) => `${l}\n`)] : []),
  '=======\n', ...theirs.map((l) => `${l}\n`),
  '>>>>>>> abc123 (a commit)\n',
  'after\n',
].join('');

test('WT-02 conflict blocks parse, a diff3 base dropped', () => {
  const pieces = parseConflicts(conflict(['a'], ['b'], ['o']));
  assert.deepEqual(pieces, ['before\n', { ours: ['a\n'], theirs: ['b\n'] }, 'after\n']);
  assert.throws(() => parseConflicts('<<<<<<< HEAD\nx\n'), /unterminated/);
});

test('WT-03 a wholly generated file takes main\'s whole file; a hand-written one is refused', () => {
  const en = resolveConflict('site/assets/i18n/en.json', conflict(['"a": 1'], ['"b": 2']), RULES);
  assert.ok(en.ok && en.whole);
  assert.deepEqual(en.rules, [rule('the interface language files')]);
  const deleted = resolveConflict('packages/types/generated/x.d.ts', null, RULES);
  assert.ok(deleted.ok && deleted.whole);
  const code = resolveConflict('site/apps/elections/lib/route.js', conflict(['a'], ['b']), RULES);
  assert.equal(code.ok, false);
});

const MAP_MAIN = '<script type="importmap">{"imports":{"/a.js":"/a.js?v=111111111111"}}</script>';
const MAP_BRANCH = '<script type="importmap">{"imports":{"/a.js":"/a.js?v=222222222222","/b.js":"/b.js?v=333333333333"}}</script>';

test('WT-04 a page\'s import-map line takes main\'s side; the rest of the page keeps the branch\'s edits', () => {
  const result = resolveConflict('site/apps/elections/index.html', conflict([MAP_MAIN], [MAP_BRANCH]), RULES);
  assert.ok(result.ok && !result.whole);
  assert.equal(result.text, `before\n${MAP_MAIN}\nafter\n`);
  assert.deepEqual(result.rules, [rule('the import maps')]);
});

test('WT-05 cache tokens alone take main\'s side; a token beside another change is refused', () => {
  const tokens = resolveConflict('site/browse/index.html',
    conflict(['<script src="browse.js?v=aaaaaaaaaaaa"></script>'], ['<script src="browse.js?v=bbbbbbbbbbbb"></script>']), RULES);
  assert.ok(tokens.ok);
  assert.deepEqual(tokens.rules, [rule('the cache tokens')]);
  const mixed = resolveConflict('site/browse/index.html',
    conflict(['<script src="browse.js?v=aaaaaaaaaaaa"></script>'], ['<script defer src="browse.js?v=bbbbbbbbbbbb"></script>']), RULES);
  assert.equal(mixed.ok, false);
  const mapAndText = resolveConflict('site/browse/index.html', conflict([MAP_MAIN, '<h1>Browse</h1>'], [MAP_BRANCH, '<h1>Browse all</h1>']), RULES);
  assert.equal(mapAndText.ok, false);
});

test('WT-06 each regeneration step runs once, in the rules\' order', () => {
  const steps = regenerationSteps([rule('the cache tokens'), rule('the import maps'), rule('the interface language files')], RULES);
  assert.deepEqual(steps.map((s) => s.npm), ['i18n:build', 'build:import-maps', 'build:browse-cache']);
});

test('WT-07 every npm script config/worktrees.json names exists', () => {
  const named = [
    ...Object.keys(CONFIG.checkNeeds).filter((k) => k !== '//'),
    ...CONFIG.landing.gates,
    ...CONFIG.landing.restamp.map((s) => s.npm),
    ...RULES.flatMap((r) => r.regenerate.map((s) => s.npm)),
    'worktree:new', 'worktree:remove', 'worktree:own', 'land', 'check:fast',
  ];
  for (const name of named) assert.ok(SCRIPTS[name], `package.json has no script ${name}`);
  assert.ok(CONFIG.landing.gates.includes('test:unit') && CONFIG.landing.gates.includes('check:architecture'));
});

test('WT-08 a check step names what it needs; only the absent ones count', () => {
  const records = { BROWSE_DIR: path.join('/r', 'browse'), PROVENANCE_FILE: path.join('/r', 'p.json') };
  const needs = { 'check:a': [{ records: 'BROWSE_DIR', file: 'sources.json' }, { repo: 'site/app/build/x.js' }], 'check:b': [{ records: 'PROVENANCE_FILE' }] };
  assert.equal(artefactPath({ records: 'BROWSE_DIR', file: 'sources.json' }, records, '/r'), path.join('/r', 'browse', 'sources.json'));
  const present = new Set([path.join('/r', 'site', 'app', 'build', 'x.js')]);
  const env = { records, root: '/r', exists: (p) => present.has(p) };
  assert.deepEqual(missingNeeds('check:a', needs, env), ['browse/sources.json']);
  assert.deepEqual(missingNeeds('check:c', needs, env), []);
  assert.throws(() => artefactPath({ records: 'NOPE' }, records, '/r'), /no NOPE/);
});

test('WT-09 git worktree list --porcelain parses, the main checkout first', () => {
  const list = parseWorktreeList('worktree C:/a/main\nHEAD 1111\nbranch refs/heads/main\n\nworktree C:/a/civgraph-x\nHEAD 2222\nbranch refs/heads/x\n\nworktree C:/a/d\nHEAD 3333\ndetached\n');
  assert.deepEqual(list.map((w) => [path.basename(w.path), w.branch, w.detached || false]), [['main', 'main', false], ['civgraph-x', 'x', false], ['d', undefined, true]]);
});

test('WT-10 land never pushes, publishes or deploys', () => {
  const source = readFileSync(path.join(ROOT, 'scripts', 'dev', 'land.mjs'), 'utf8')
    + readFileSync(path.join(ROOT, 'scripts', 'dev', 'worktree', 'lib.mjs'), 'utf8');
  assert.ok(!/['"]push['"]/.test(source), 'a git push');
  assert.ok(!/wrangler|publish\.sh['"]|deploy-preview/.test(source.replace(CONFIG.landing.publishCommand, '')), 'a publish or deploy');
  const pattern = new RegExp(CONFIG.landing.publishCommand);
  assert.ok(pattern.test('"C:\\Program Files\\Git\\bin\\bash.exe" -c "bash .claude/publish/publish.sh"'));
  assert.ok(pattern.test('bash scripts/publish/publish.sh --dry-run'));
  assert.ok(!pattern.test('cat .claude/publish/publish.sh'));
  assert.ok(!pattern.test('grep -n lock scripts/publish/publish.sh'));
});

test('WT-11 the write guard makes a linked folder local on the first write, leaving the snapshot as it was', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wt-guard-'));
  try {
    const snapshot = path.join(dir, 'snapshot', 'browse');
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(path.join(snapshot, 'kept.json'), '{"kept":true}');
    writeFileSync(path.join(snapshot, 'rewritten.json'), '{"old":true}');
    chmodSync(path.join(snapshot, 'rewritten.json'), 0o444);
    const wt = path.join(dir, 'wt');
    const link = path.join(wt, 'out', 'browse');
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(snapshot, link, 'junction');
    const stateDir = path.join(wt, 'state');
    mkdirSync(stateDir);
    copyFileSync(path.join(ROOT, 'scripts', 'dev', 'worktree', 'write-guard.cjs'), path.join(stateDir, 'write-guard.cjs'));
    writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({ links: [{ rel: 'out/browse', wtAbs: link, state: 'linked' }] }));

    // Without the guard the snapshot's read-only file refuses the write.
    const bare = spawnSync(process.execPath, ['--input-type=module', '-e', `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(path.join(link, 'rewritten.json'))}, 'x');`], { encoding: 'utf8' });
    assert.notEqual(bare.status, 0);

    const run = spawnSync(process.execPath, ['--require', path.join(stateDir, 'write-guard.cjs'), '--input-type=module', '-e',
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(path.join(link, 'rewritten.json'))}, '{"new":true}'); writeFileSync(${JSON.stringify(path.join(link, 'added.json'))}, '{}');`],
    { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /out\/browse is now a local folder/);
    assert.equal(lstatSync(link).isSymbolicLink(), false, 'the link is a local folder now');
    assert.equal(readFileSync(path.join(link, 'rewritten.json'), 'utf8'), '{"new":true}');
    assert.equal(readFileSync(path.join(link, 'kept.json'), 'utf8'), '{"kept":true}', 'the snapshot\'s other files came along');
    assert.equal(readFileSync(path.join(snapshot, 'rewritten.json'), 'utf8'), '{"old":true}', 'the snapshot is unchanged');
    assert.equal(existsSync(path.join(snapshot, 'added.json')), false);
    assert.equal(JSON.parse(readFileSync(path.join(stateDir, 'state.json'), 'utf8')).links[0].state, 'local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
