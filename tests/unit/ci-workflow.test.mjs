/**
 * scripts/validate-ci-workflow.mjs: the real ci.yml passes, and each way CI has gone wrong
 * here turns it red (the negative controls the house rule asks for).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeLines, jobSteps, validateCi, validateWorkflow } from '../../scripts/validate-ci-workflow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const SCRIPTS = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

const errorsFor = (text) => [...validateWorkflow('ci.yml', text), ...validateCi(text, SCRIPTS)];

test('the committed ci.yml passes', () => {
  assert.deepEqual(errorsFor(CI), []);
});

test('comments do not count: the header may name production and verify', () => {
  assert.deepEqual(codeLines('# see https://civgraph.net and npm run verify\nname: CI').map((l) => l.trim()), ['', 'name: CI']);
});

test('the check job steps are read in order', () => {
  const steps = jobSteps(codeLines(CI), 'check');
  const order = ['/usr/share/dotnet', 'npm run check:ci', 'npm run test:browser:maps'].map((s) => steps.findIndex((step) => step.includes(s)));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('a path filter is refused (the docs/** gap)', () => {
  const text = CI.replace('  pull_request:\n', '  pull_request:\n    paths:\n      - "scripts/**"\n');
  assert.notEqual(text, CI);
  assert.ok(errorsFor(text).some((e) => /paths\/paths-ignore filter/.test(e)));
  const ignore = CI.replace('    branches: [main]\n', '    branches: [main]\n    paths-ignore:\n      - "docs/**"\n');
  assert.ok(errorsFor(ignore).some((e) => /paths\/paths-ignore filter/.test(e)));
});

test('a schedule, a secret, a production URL or a remote step is refused', () => {
  const schedule = CI.replace('  workflow_dispatch:\n', "  workflow_dispatch:\n  schedule:\n    - cron: '17 5 * * *'\n");
  assert.ok(errorsFor(schedule).some((e) => /schedule trigger/.test(e)));
  const withStep = (line) => CI.replace('      - run: npm run check:ci\n', `      - run: npm run check:ci\n      - run: ${line}\n`);
  assert.ok(errorsFor(withStep('echo ${{ secrets.CLOUDFLARE_API_TOKEN }}')).some((e) => /a secret/.test(e)));
  assert.ok(errorsFor(withStep('curl -sI https://civgraph.net/maps/')).some((e) => /production host/.test(e)));
  assert.ok(errorsFor(withStep('npx wrangler d1 execute civgraph-records --remote --command "select 1"')).some((e) => /--remote/.test(e)));
  assert.ok(errorsFor(withStep('npm run verify:deploy')).some((e) => /opt-in remote tier/.test(e)));
});

test('the disk must be freed before the records build, and the browser specs run after it', () => {
  const noFree = CI.replace(/sudo rm -rf \/usr\/share\/dotnet[^\n]*\n/, '');
  assert.ok(errorsFor(noFree).some((e) => /does not free disk/.test(e)));
  const browserFirst = CI
    .replace('      - run: npm run check:ci\n', '      - run: npm run test:browser:maps\n      - run: npm run check:ci\n')
    .replace(/(npm run check:ci\n[\s\S]*?)      - run: npm run test:browser:maps\n/, '$1');
  assert.ok(errorsFor(browserFirst).some((e) => /browser specs run before/.test(e)));
  const noBrowser = CI.replace('      - run: npm run test:browser:maps\n', '');
  assert.ok(errorsFor(noBrowser).some((e) => /does not run the map app browser specs/.test(e)));
});

test('an npm script ci.yml names must exist', () => {
  const text = CI.replace('- run: npm run test:browser:maps', '- run: npm run test:browser:gone');
  assert.ok(errorsFor(text).some((e) => /test:browser:gone, which package.json does not define/.test(e)));
});
