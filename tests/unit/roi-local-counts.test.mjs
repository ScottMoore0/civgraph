// The Irish local elections' count sidecars (data/elections/roi-local-counts/<date>/<area>.json):
// the count-by-count results from the Department's results books, laid over each contest's rows by
// the election manifest build. Every count must reconcile, and every candidate must be one the
// contest itself lists, or the build would show a count nobody stood in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const COUNTS = path.join(ROOT, 'data', 'elections', 'roi-local-counts');
const SOURCE = 'data/elections-source/data/elections/ireland-local';
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

const fixes = new Map(readJson(path.join(ROOT, 'data', 'elections', 'corrections', 'source-checked-fixes.json')).records
  .map((record) => [record.sourceFile, record]));

// The contest's names as the build reads them: the imported rows, a gap-fill's list, renames.
function contestNames(date, file) {
  const sourceFile = `${SOURCE}/${date}/${file}`;
  let names = readJson(path.join(ROOT, sourceFile)).candidates.map((candidate) => candidate.name);
  for (const op of fixes.get(sourceFile)?.operations || []) {
    if (op.op === 'replaceCandidates') names = op.candidates.map((candidate) => candidate.name);
    if (op.op === 'candidate' && op.set?.name) names = names.map((name) => (norm(name) === norm(op.name) ? op.set.name : name));
  }
  return names;
}

const sidecars = existsSync(COUNTS)
  ? readdirSync(COUNTS).flatMap((date) => readdirSync(path.join(COUNTS, date)).map((file) => ({ date, file, data: readJson(path.join(COUNTS, date, file)) })))
  : [];

test('RLC-01 every 2024 area has a count file', () => {
  const areas = readdirSync(path.join(ROOT, SOURCE, '2024-06-07')).filter((file) => file !== '_index.json');
  const have = new Set(sidecars.filter((s) => s.date === '2024-06-07').map((s) => s.file));
  assert.equal(areas.length, 166);
  assert.deepEqual(areas.filter((file) => !have.has(file)), []);
});

test('RLC-02 each count file is one of the area files and names the book', () => {
  for (const { date, file, data } of sidecars) {
    const sourceFile = path.join(ROOT, SOURCE, date, file);
    assert.ok(existsSync(sourceFile), `${date}/${file} has no contest file`);
    assert.equal(data.electionDate, date);
    assert.equal(data.constituency, readJson(sourceFile).constituency, `${file}: constituency`);
    assert.match(data.pageUrl, /^https:\/\/opendata\.housing\.gov\.ie\/.+#page=\d+$/, `${file}: pageUrl`);
    assert.match(data.note, /^Every count from the Department of .+, pp?\. \d+/, `${file}: note`);
  }
});

test('RLC-03 every count adds up to the valid poll, and the poll figures agree', () => {
  for (const { file, data } of sidecars) {
    const { valid_poll: valid, total_poll: total, spoiled, quota, seats } = data.meta;
    assert.equal(total, valid + spoiled, `${file}: total poll`);
    assert.equal(quota, Math.floor(valid / (seats + 1)) + 1, `${file}: Droop quota`);
    assert.equal(data.nonTransferable.length, data.numCounts, `${file}: non-transferable per count`);
    for (let k = 0; k < data.numCounts; k += 1) {
      const sum = data.candidates.reduce((total, candidate) => total + (candidate.counts[k] ?? 0), 0) + data.nonTransferable[k];
      assert.equal(sum, valid, `${file}: count ${k + 1} adds up to ${sum}, not ${valid}`);
    }
  }
});

test('RLC-04 the members elected fill the seats, in order, at a count they could be elected at', () => {
  for (const { file, data } of sidecars) {
    const { quota, seats } = data.meta;
    const elected = data.candidates.filter((candidate) => candidate.status === 'Elected');
    assert.equal(elected.length, seats, `${file}: elected`);
    assert.deepEqual(elected.map((c) => c.electedOrder).sort((a, b) => a - b), Array.from({ length: seats }, (_, i) => i + 1), `${file}: order`);
    for (const candidate of data.candidates) {
      assert.ok(candidate.counts.length >= 1 && candidate.counts.length <= data.numCounts, `${file}: ${candidate.name} counts`);
      if (candidate.status !== 'Elected') {
        assert.equal(candidate.lastCount, candidate.counts.length, `${file}: ${candidate.name} last count`);
        continue;
      }
      assert.equal(candidate.counts.length, data.numCounts, `${file}: ${candidate.name} stays in the count`);
      const reached = candidate.counts[candidate.electedAt - 1] >= quota;
      assert.ok(reached || candidate.electedAt === data.numCounts, `${file}: ${candidate.name} elected at count ${candidate.electedAt}`);
      assert.ok(candidate.counts.slice(0, candidate.electedAt - 1).every((votes) => votes < quota), `${file}: ${candidate.name} reached the quota earlier`);
    }
  }
});

test('RLC-05 every candidate in a count file is one the contest lists', () => {
  for (const { date, file, data } of sidecars) {
    const names = contestNames(date, file);
    assert.equal(names.length, data.candidates.length, `${file}: number of candidates`);
    for (const candidate of data.candidates) assert.ok(names.includes(candidate.name), `${file}: ${candidate.name} is not in the contest`);
  }
});

test('RLC-06 the manifest build lays the local count files over the contests and keeps their person ids', () => {
  const builder = readFileSync(path.join(ROOT, 'scripts', 'build', 'build-test2-election-manifest.mjs'), 'utf8');
  assert.match(builder, /ROI_LOCAL_COUNTS_ROOT = path\.join\(ROOT, 'data', 'elections', 'roi-local-counts'\)/);
  assert.match(builder, /entry\?\.bodySlug === 'ireland-local' \? ROI_LOCAL_COUNTS_ROOT/);
  assert.match(builder, /carrySourcePersonId && localCandidate\?\.sourcePersonId \? \{ source_person_id: localCandidate\.sourcePersonId \}/);
  assert.match(builder, /\['Counts', raw\.countSourceNote\]/);
});
