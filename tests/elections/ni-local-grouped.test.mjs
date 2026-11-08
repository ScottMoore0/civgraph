/**
 * The pre-1973 Northern Ireland local elections, grouped by year (src/ni-local-groups.mjs,
 * scripts/build/build-ni-local-grouped.mjs, app/src/ni-local-view.js).
 *
 * Holds: every pre-1973 NI council round is in exactly one year's entry and nothing else is;
 * the year files agree with the election catalogue; hatching is decided from the published
 * rounds and the intake's status (and only those reasons); a level is offered only when it has
 * results or hatching that year, on the edition the rules choose; aldermen are told apart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  NI_COUNCIL_SLUGS,
  NI_LOCAL_LEVEL_IDS,
  buildNiLocalGroupEntry,
  councilTier,
  currentNiLocalGroupKey,
  niLocalGroupTitle,
  groupNiLocalRounds,
  isAldermanicBody,
  isAldermanicContest,
  isNiLocalCouncilRound,
  isNiLocalGroupKey,
  niLocalGroupKey,
  niLocalGroupYear,
  replaceNiLocalRoundsWithGroups
} from '../../src/ni-local-groups.mjs';
import { leadingParty, niLocalAreaName, voteShareOpacity } from '../../app/src/ni-local-view.js';
import { ELECTION_MANIFEST } from '../../packages/loader/src/paths.mjs';

const ROOT = process.cwd();
const read = (rel) => JSON.parse(fs.readFileSync(path.resolve(ROOT, rel), 'utf8'));
const manifest = read(ELECTION_MANIFEST);
const coverage = read('render/metadata/ni-local-coverage.json');
const yearFile = (year) => read(`render/metadata/ni-local/${year}.json`);

const HATCH_REASONS = [
  /^Results held back: not yet confirmed from a source$/,
  /^Results incomplete: some contests are not yet confirmed$/,
  // A round's line from data/elections/round-completeness.json.
  /^Results incomplete: .+\.$/,
  /^Result for .+ held back: no source yet names the member$/,
  /^Incomplete: the result for .+ is held back$/,
  /^Results held back in review$/,
  /^No results yet, though an election was held$/
];

test('council kinds and aldermen are read from the body slug', () => {
  assert.equal(councilTier('armagh-county-council'), 'county-council');
  assert.equal(councilTier('belfast-county-borough-council'), 'county-borough');
  assert.equal(councilTier('belfast-county-borough-council-aldermen'), 'county-borough');
  assert.equal(councilTier('bangor-borough-council'), 'borough');
  assert.equal(councilTier('portstewart-urban-district-council'), 'urban-district');
  assert.equal(councilTier('newry-no-2-rural-district-council'), 'rural-district');
  assert.equal(councilTier('antrim-town-commissioners'), 'town-commissioners');
  assert.equal(councilTier('dail-eireann'), null);
  assert.equal(isAldermanicBody('londonderry-county-borough-council-aldermen'), true);
  assert.equal(isAldermanicBody('londonderry-county-borough-council'), false);
  assert.equal(isAldermanicContest('lurgan-borough-council', 'Alderman'), true);
  assert.equal(isAldermanicContest('lurgan-borough-council', 'Councillor'), false);
  assert.equal(isAldermanicContest('belfast-county-borough-council', 'Alderman and Councillor'), false);
});

test('group keys and titles: the island before 1921, Northern Ireland from 1921', () => {
  assert.equal(niLocalGroupKey(1946), 'ni-local__1946');
  assert.equal(niLocalGroupKey(1921), 'ni-local__1921');
  assert.equal(niLocalGroupKey(1911), 'ireland-local__1911');
  assert.equal(niLocalGroupKey(1920), 'ireland-local__1920');
  assert.equal(niLocalGroupYear('ni-local__1946'), 1946);
  assert.equal(niLocalGroupYear('ireland-local__1911'), 1911);
  assert.equal(isNiLocalGroupKey('ni-local__1946'), true);
  assert.equal(isNiLocalGroupKey('ireland-local__1911'), true);
  // The Republic's local elections keep their own keys and are not year entries.
  assert.equal(isNiLocalGroupKey('ireland-local__2019-05-24'), false);
  assert.equal(isNiLocalGroupKey('belfast-county-borough-council__1946-05-15'), false);
  assert.equal(currentNiLocalGroupKey('ni-local__1911'), 'ireland-local__1911');
  assert.equal(currentNiLocalGroupKey('ni-local__1946'), 'ni-local__1946');
  assert.equal(niLocalGroupTitle(1911), '1911 Irish local elections');
  assert.equal(niLocalGroupTitle(1924), '1924 Northern Ireland local elections');
  const early = buildNiLocalGroupEntry(1911, [{ key: 'x__1911-01-15', bodySlug: 'strabane-urban-district-council', date: '1911-01-15' }]);
  assert.equal(early.body, 'Irish local elections');
  assert.equal(early.bodySlug, 'irish-local-elections');
  assert.deepEqual(early.previousKeys, ['ni-local__1911']);
  const later = buildNiLocalGroupEntry(1924, []);
  assert.equal(later.body, 'Northern Ireland local elections');
  assert.equal(later.previousKeys, undefined);
});

test('pre-1921 rounds anywhere on the island are grouped; the Republic\'s local elections are not', () => {
  const fake = [
    { key: 'cork-county-council__1911-06-01', bodySlug: 'cork-county-council', date: '1911-06-01' },
    { key: 'dublin-county-borough-council__1911-01-15', bodySlug: 'dublin-county-borough-council', date: '1911-01-15' },
    { key: 'ireland-local__1985-06-20', bodySlug: 'ireland-local', date: '1985-06-20' },
    { key: 'cork-county-council__1925-06-23', bodySlug: 'cork-county-council', date: '1925-06-23' }
  ];
  const groups = groupNiLocalRounds(fake);
  // Cork and Dublin in 1911 are the island's year; Cork in 1925 is not Northern Ireland's.
  assert.deepEqual([...groups.keys()], [1911]);
  assert.equal(groups.get(1911).length, 2);
  assert.equal(isNiLocalCouncilRound(fake[2]), false);
  assert.equal(isNiLocalCouncilRound(fake[3]), false);
});

test('every council round of 1921-72 in the catalogue is a listed Northern Ireland council', () => {
  const unlisted = manifest.elections.filter((entry) => entry.date >= '1921' && entry.date < '1973'
    && entry.bodyGroup !== 'local-government' && councilTier(entry.bodySlug)
    && !String(entry.bodySlug).startsWith('ireland-')
    && !NI_COUNCIL_SLUGS.has(String(entry.bodySlug).replace(/-aldermen$/, '')));
  assert.deepEqual(unlisted.map((entry) => entry.key), [], 'flag the council niLocalGroup in data/registries/councils.json, then run node registries/browser/build.mjs');
});

test('every pre-1973 NI council round is in exactly one year, and only those are grouped', () => {
  const rounds = manifest.elections.filter(isNiLocalCouncilRound);
  assert.ok(rounds.length > 700, `expected the council rounds, found ${rounds.length}`);
  for (const round of rounds) {
    assert.ok(round.date < '1973-01-01', round.key);
    assert.notEqual(round.bodyGroup, 'local-government', round.key);
  }
  const groups = groupNiLocalRounds(manifest.elections);
  const seen = new Map();
  for (const [year, list] of groups) {
    for (const round of list) {
      assert.equal(Number(round.date.slice(0, 4)), year, round.key);
      assert.ok(!seen.has(round.key), `${round.key} in two years`);
      seen.set(round.key, year);
    }
  }
  assert.equal(seen.size, rounds.length);
  // Post-1973 councils, Westminster, Stormont and the Dáil stay as they are.
  const others = manifest.elections.filter((entry) => !isNiLocalCouncilRound(entry));
  assert.ok(others.some((entry) => entry.bodyGroup === 'local-government'), 'the 1973- district elections are kept');
  for (const entry of others) {
    assert.ok(!(entry.date < '1973' && councilTier(entry.bodySlug) && entry.bodyGroup !== 'local-government' && !String(entry.bodySlug).startsWith('ireland-')), entry.key);
  }
  const listed = replaceNiLocalRoundsWithGroups(manifest.elections);
  assert.equal(listed.length, others.length + groups.size);
  assert.equal(listed.filter((entry) => entry.niLocalGroup).length, groups.size);
  assert.ok(listed.filter((entry) => entry.bodyGroup === 'local-government').length === others.filter((entry) => entry.bodyGroup === 'local-government').length);
});

test('the year entry names the year and counts councils without their aldermanic polls', () => {
  const rounds = [
    { key: 'a__1946-05-15', bodySlug: 'belfast-county-borough-council', date: '1946-05-15', body: 'Belfast County Borough Council' },
    { key: 'b__1946-05-15', bodySlug: 'belfast-county-borough-council-aldermen', date: '1946-05-15', body: 'Belfast County Borough Council (aldermen)' },
    { key: 'c__1946-10-03', bodySlug: 'antrim-county-council', date: '1946-10-03', body: 'Antrim County Council' }
  ];
  const entry = buildNiLocalGroupEntry(1946, rounds);
  assert.equal(entry.key, 'ni-local__1946');
  assert.equal(entry.displayTitle, '1946 Northern Ireland local elections');
  assert.equal(entry.date, '1946');
  assert.equal(entry.councilCount, 2);
  assert.equal(entry.hasAldermen, true);
  assert.deepEqual(entry.dates, ['1946-05-15', '1946-10-03']);
});

test('the year files agree with the catalogue and are up to date', () => {
  const groups = groupNiLocalRounds(manifest.elections);
  assert.equal(coverage.years.length, groups.size);
  for (const [year, rounds] of groups) {
    const file = yearFile(year);
    assert.equal(file.key, niLocalGroupKey(year));
    assert.deepEqual(file.rounds.map((round) => round.key), rounds.map((round) => round.key), `${year} rounds`);
    for (const level of NI_LOCAL_LEVEL_IDS) assert.ok(file.levels[level], `${year} ${level}`);
  }
  execFileSync(process.execPath, ['scripts/build/build-ni-local-grouped.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
});

test('hatching has a stated reason, and only the defined ones', () => {
  let hatched = 0;
  for (const { year } of coverage.years) {
    const file = yearFile(year);
    for (const [id, level] of Object.entries(file.levels)) {
      for (const view of ['councillors', 'aldermen']) {
        for (const item of level.features[view]) {
          if (!item.hatch) continue;
          hatched += 1;
          assert.ok(HATCH_REASONS.some((re) => re.test(item.why)), `${year} ${id} ${item.l}: ${item.why}`);
        }
      }
    }
  }
  assert.ok(hatched > 0, 'some areas are hatched');
});

test('a council the calendar says polled, with no published round, is hatched at its level', () => {
  const status = read('data/elections/ni-local/round-status.json');
  let checked = 0;
  for (const { year } of coverage.years) {
    const file = yearFile(year);
    for (const missing of file.missing) {
      const row = status.rounds.find((r) => r.slug === missing.bodySlug && String(r.workRound || r.round).startsWith(String(year)));
      assert.ok(row, `${missing.bodySlug} ${year} has a calendar row`);
      assert.equal(row.calendar, 'held');
      if (missing.tier !== 'rural-district' && missing.tier !== 'urban-district') continue;
      const districts = file.levels.districts;
      if (!districts.available) continue;
      const stem = missing.bodySlug.replace(/-(rural|urban)-district-council$/, '').replace(/-/g, ' ');
      const rural = missing.tier === 'rural-district';
      const item = districts.features[missing.aldermen ? 'aldermen' : 'councillors']
        .find((f) => f.l.toLowerCase().replace(/\./g, '').replace(/no(\d)/, 'no $1').startsWith(`${stem} ${rural ? 'rural' : 'urban'}`));
      if (!item) continue; // no polygon for it in this edition
      assert.equal(item.hatch, 1, `${year} ${missing.bodySlug}`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'some missing district rounds were checked');
});

test('published rounds are never reported missing, and excluded rounds are held back', () => {
  for (const { year } of coverage.years) {
    const file = yearFile(year);
    const published = new Set(file.rounds.map((round) => round.bodySlug));
    for (const missing of file.missing) {
      assert.ok(!published.has(missing.bodySlug), `${year} ${missing.bodySlug}`);
      assert.ok(['held back in review', 'not yet transcribed'].includes(missing.reason));
    }
  }
});

test('levels are offered only with results or hatching, on the edition the rules choose', () => {
  for (const { year, levels } of coverage.years) {
    const file = yearFile(year);
    for (const [id, level] of Object.entries(file.levels)) {
      const any = level.features.councillors.some((f) => f.n || f.hatch) || level.features.aldermen.some((f) => f.n);
      assert.equal(level.available, any, `${year} ${id}`);
      if (!level.available) assert.ok(level.reason, `${year} ${id} says why`);
      assert.equal(levels[id].available, level.available);
      if (id === 'ced' && level.sourceMapId) {
        assert.equal(level.sourceMapId, year < 1921 ? 'county-ed-1911' : 'county-ed-1924-06-20', `${year} CED edition`);
      }
      if (id === 'ded' && level.sourceMapId) {
        assert.ok(year < 1921 ? level.sourceMapId.startsWith('eds-ulster-') : level.sourceMapId.startsWith('ded-'), `${year} DED edition ${level.sourceMapId}`);
      }
      if (id === 'counties' && level.sourceMapId) {
        assert.equal(level.sourceMapId, year < 1921 ? 'administrative-counties-1899' : 'counties-county-boroughs-1915', `${year} counties edition`);
      }
      assert.equal(file.title, `${year} ${year < 1921 ? 'Irish' : 'Northern Ireland'} local elections`);
      assert.equal(file.key, year < 1921 ? `ireland-local__${year}` : `ni-local__${year}`);
    }
  }
  // Belfast's wards are on the DED map every year from 1923.
  const f1946 = yearFile(1946);
  const ded = f1946.levels.ded;
  assert.equal(ded.available, true);
  assert.ok(ded.features.councillors.some((f) => f.k === 'CLIFTON|ANTRIM' && f.n), 'Clifton ward, Belfast');
  assert.ok(!ded.features.councillors.some((f) => f.k === 'CLIFTON|DOWN' && f.r?.some(([ri]) => f1946.rounds[ri].bodySlug.startsWith('belfast'))), 'the Bangor Clifton is not Belfast');
});

test('aldermen: years with aldermanic polls say so, and their results stay apart', () => {
  const f1946 = yearFile(1946);
  assert.equal(f1946.hasAldermen, true);
  const aldermenRound = f1946.rounds.findIndex((round) => round.bodySlug === 'belfast-county-borough-council-aldermen');
  assert.ok(aldermenRound >= 0);
  for (const level of Object.values(f1946.levels)) {
    for (const item of level.features.councillors) {
      for (const [ri, ci] of item.r || []) {
        assert.ok(!(f1946.rounds[ri].aldermen || f1946.rounds[ri].contests[ci].aldermen), `councillor view holds an aldermanic contest: ${item.l}`);
      }
    }
    for (const item of level.features.aldermen) {
      for (const [ri, ci] of item.r || []) {
        assert.ok(f1946.rounds[ri].aldermen || f1946.rounds[ri].contests[ci].aldermen, `aldermen view holds a councillor contest: ${item.l}`);
      }
    }
  }
  const noAldermen = coverage.years.filter((y) => !y.hasAldermen);
  for (const { year } of noAldermen) {
    const file = yearFile(year);
    assert.ok(file.rounds.every((round) => !round.aldermen && round.contests.every((c) => !c.aldermen)), `${year}`);
  }
});

test('map colouring helpers', () => {
  assert.deepEqual(leadingParty({}), null);
  const lead = leadingParty({ UUP: 3, 'NI Labour': 1 });
  assert.equal(lead.party, 'UUP');
  assert.equal(lead.share, 75);
  assert.equal(lead.tie, false);
  assert.equal(leadingParty({ UUP: 2, 'Nationalist Party': 2 }).tie, true);
  assert.ok(voteShareOpacity(70) > voteShareOpacity(40));
  assert.equal(voteShareOpacity(5), 0.25);
  assert.equal(voteShareOpacity(95), 0.85);
  assert.equal(niLocalAreaName("ST. ANNE'S"), "St. Anne's");
  assert.equal(niLocalAreaName('ADMINISTRATIVE COUNTY OF DOWN'), 'Administrative County of Down');
  assert.equal(niLocalAreaName('Bangor Municipal Borough'), 'Bangor Municipal Borough');
});
