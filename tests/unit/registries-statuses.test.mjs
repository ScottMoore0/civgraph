/**
 * The statuses registry (data/registries/statuses.json, catalogue RG-01 to RG-06) is valid, says
 * what the code and data say, and its machines refuse every move their tables do not list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry, registryErrors } from '../../registries/index.mjs';
import { evalDeclarations } from '../../registries/legacy-sources.mjs';
import {
  candidateCountState, candidateStatusKind, canTransition, enumValues, isContested, missingRoundReason, siteRoundStatus, statesOf
} from '../../registries/statuses.mjs';
import { statusKind } from '../../src/election-domain.mjs';

const registry = loadRegistry('statuses');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const clone = () => structuredClone(registry);
const HELPER = path.join(REPO_ROOT, 'scripts/lib/state-machine.mjs');
const helperMissing = existsSync(HELPER) ? false : 'scripts/lib/state-machine.mjs lands with rf-records; rebase brings it';

test('statuses: valid', () => {
  assert.deepEqual(registryErrors('statuses', registry), []);
});

test('statuses: the checks reject open tables, unreachable states and stray labels', () => {
  const open = clone();
  open.machines.contribution.transitions.approved.push('archived');
  assert.ok(registryErrors('statuses', open).some((e) => /approved -> archived names no state/.test(e)));
  const island = clone();
  island.machines.correction.transitions.orphan = [];
  assert.ok(registryErrors('statuses', island).some((e) => /orphan cannot be reached/.test(e)));
  const label = clone();
  label.machines.contest.labels.void = 'Void';
  assert.ok(registryErrors('statuses', label).some((e) => /unknown value void/.test(e)));
  const noTable = clone();
  delete noTable.machines.correction.transitions;
  assert.ok(registryErrors('statuses', noTable).some((e) => /missing required property transitions/.test(e)));
});

test('RG-04 contribution: the table is the queue\'s rule (contributions.mjs, submit.js, decide.js)', () => {
  const { canMarkApplied } = evalDeclarations('scripts/intake/contributions.mjs', 'export const TERMINAL_STATUS', 'const argv', ['canMarkApplied']);
  for (const s of [...statesOf(registry, 'contribution'), 'unknown', '']) {
    assert.deepEqual({ ...canMarkApplied(s) }, { ok: canTransition(registry, 'contribution', s, 'applied'), ...(canMarkApplied(s).reason ? { reason: canMarkApplied(s).reason } : {}) }, s);
  }
  assert.match(read('functions/_api/contributions/submit.js'), /status "pending-review"/);
  assert.equal(registry.machines.contribution.initial, 'pending-review');
  assert.match(read('functions/_api/contributions/decide.js'), /decision must be "approved" or "rejected"/);
  assert.deepEqual(registry.machines.contribution.decisions, ['approved', 'rejected']);
});

test('RG-03 election round: every published round\'s site status is the registry rule\'s', () => {
  const status = readJson('data/elections/ni-local/round-status.json');
  const completeness = readJson('data/elections/round-completeness.json').rounds || {};
  assert.deepEqual([...new Set(status.rounds.map((r) => r.work).filter(Boolean))].sort(), [...registry.machines['election-round'].vocabularies.work.values].sort());
  assert.deepEqual([...new Set(status.rounds.map((r) => r.calendar))].sort(), [...registry.machines['election-round'].vocabularies.calendar.values].sort());
  const byYear = new Map();
  for (const row of status.rounds) {
    const year = Number(String(row.workRound || row.round).slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(row);
  }
  let rounds = 0;
  let missing = 0;
  const dir = path.join(REPO_ROOT, 'render/metadata/ni-local');
  for (const file of readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f))) {
    const doc = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    const rows = byYear.get(doc.year) || [];
    for (const round of doc.rounds) {
      const folder = String(round.date);
      const row = rows.find((r) => r.slug === round.bodySlug && (r.round === folder || r.workRound === folder))
        || rows.find((r) => r.slug === round.bodySlug) || null;
      assert.equal(siteRoundStatus(registry, row, completeness[round.key]).status, round.status, `${round.key}`);
      rounds += 1;
    }
    for (const item of doc.missing || []) {
      const row = rows.find((r) => r.slug === item.bodySlug && r.calendar === 'held' && r.work !== 'no-election');
      assert.equal(missingRoundReason(registry, row).reason, item.reason, `${doc.year} ${item.bodySlug}`);
      missing += 1;
    }
  }
  assert.ok(rounds > 500 && missing > 0, `${rounds} rounds, ${missing} missing`);
  const view = read('app/src/ni-local-view.js');
  const m = registry.machines['election-round'];
  assert.ok(view.includes(`round.status === 'held' ? '${m.siteLabels.held}' : '${m.siteLabels.partial}'`));
  assert.ok(view.includes(`item.reason === '${m.missingReasons.excluded.reason}' ? '${m.missingReasons.excluded.label}' : '${m.missingReasons.otherwise.label}'`));
});

test('RG-01 candidate count: every Status in the data has a meaning, folded as statusKind folds it', () => {
  const seen = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) {
        const text = readFileSync(p, 'utf8');
        for (const match of text.matchAll(/"Status":\s*"((?:[^"\\]|\\.)*)"/g)) seen.add(JSON.parse(`"${match[1]}"`));
      }
    }
  };
  walk(path.join(REPO_ROOT, 'data/elections-source/data/elections'));
  const spellings = registry.machines['candidate-count'].spellings;
  assert.deepEqual([...seen].sort(), Object.keys(spellings).sort());
  const probes = [...seen, ...Object.keys(registry.machines['candidate-count'].derived), 'Unelected', 'Made quota', 'Deemed elected',
    'Not deemed elected', 'Eliminated', 'Counted as elected', 'Withdrawn', 'ELECTED', 'élu'];
  for (const s of probes) assert.equal(candidateStatusKind(registry, s), statusKind(s), s);
  for (const [s, state] of Object.entries(spellings)) assert.equal(candidateCountState(registry, s), state, s);
});

test('RG-05 correction: every walker correction record has a registered status; only applied is applied', () => {
  const dir = 'data/elections/corrections';
  const states = statesOf(registry, 'correction');
  for (const file of readdirSync(path.join(REPO_ROOT, dir)).filter((f) => /^walker-.*\.json$/.test(f))) {
    for (const record of readJson(`${dir}/${file}`).records || []) {
      if (record.status !== undefined) assert.ok(states.includes(record.status) && record.status !== 'review', `${file}: ${record.status}`);
    }
  }
  const builder = read('scripts/build/build-test2-election-manifest.mjs');
  assert.ok(builder.includes(`r.status === '${registry.machines.correction.appliedValue}'`));
});

test('RG-02 contest: the audit\'s values and default, the map\'s labels', () => {
  const { VALID_CONTEST_STATUSES } = evalDeclarations('scripts/check/rules/election-data-audit.mjs', 'const VALID_CONTEST_STATUSES', '\n', ['VALID_CONTEST_STATUSES']);
  assert.deepEqual([...VALID_CONTEST_STATUSES].sort(), enumValues(registry, 'contest').sort());
  assert.match(read('scripts/check/rules/election-data-audit.mjs'), /contestStatus \|\| 'contested'/);
  assert.ok(isContested(registry, undefined) && isContested(registry, 'contested') && !isContested(registry, 'uncontested'));
  const { labels } = registry.machines.contest;
  assert.ok(read('app/src/ni-local-view.js').includes(`contest.contested ? '${labels.contested}' : '${labels.uncontested}'`));
});

/** Every string literal assigned to `key` in a source file (ternaries included). */
function literalsOfKey(text, key) {
  const out = new Set();
  for (const m of text.matchAll(new RegExp(`\\b${key}:\\s*([^,\\n]*(?:\\n\\s*[?:][^,\\n]*)*)`, 'g'))) {
    for (const lit of m[1].matchAll(/'([^'\\]*)'/g)) out.add(lit[1]);
  }
  return [...out].sort();
}

test('RG-06 enums: each is exactly the values its file writes', () => {
  const batch = readJson('scripts/intake/batch.schema.json');
  assert.deepEqual(enumValues(registry, 'intake-batch'), batch.properties.status.enum);
  for (const name of ['register-interests-availability', 'peatland-publication', 'peatland-link', 'dobih-archive', 'dobih-publication']) {
    const e = registry.enums[name];
    assert.deepEqual(literalsOfKey(read(e.source), e.key), [...e.values].sort(), name);
  }
});

test('statuses: the machines run on the shared helper and refuse unlisted moves', { skip: helperMissing }, async () => {
  const { statusMachines, canMarkContributionApplied } = await import('../../registries/status-machines.mjs');
  const machines = statusMachines(registry);
  for (const [name, entry] of Object.entries(registry.machines)) {
    const machine = machines[name];
    const states = statesOf(registry, name);
    assert.deepEqual([...machine.states].sort(), [...states].sort(), name);
    for (const from of states) {
      for (const to of states) {
        const legal = entry.weight === 'full' ? canTransition(registry, name, from, to) : from !== to;
        assert.equal(machine.can(from, to), legal, `${name}: ${from} -> ${to}`);
        if (!legal) assert.throws(() => machine.assertTransition(from, to), /is not a transition/);
      }
    }
  }
  machines.contribution.assertPath(['approved', 'applied']);
  assert.throws(() => machines.contribution.assertPath(['applied']), /pending-review -> applied/);
  assert.throws(() => machines.contribution.assertPath(['rejected', 'applied']), /rejected -> applied/);
  assert.deepEqual(canMarkContributionApplied(registry, 'approved'), { ok: true });
  assert.equal(canMarkContributionApplied(registry, 'pending-review').ok, false);
  const run = machines['election-round'].start();
  for (const step of siteRoundStatus(registry, { work: 'held' }).walk) run.to(step);
  assert.equal(run.state(), 'held');
  assert.ok(run.done());
});
