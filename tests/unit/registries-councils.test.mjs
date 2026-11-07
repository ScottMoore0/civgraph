/**
 * The councils registry (data/registries/councils.json) is valid and says exactly what the
 * scattered lists it replaces say. The parity half goes when the last literal does (registries/
 * legacy-sources.mjs, LANDING.md of rf-registries).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry, registryErrors } from '../../registries/index.mjs';
import { councilSources } from '../../registries/legacy-sources.mjs';
import { seedCouncils } from '../../registries/seed/councils.mjs';
import {
  catalogueBodyAliases, catalogueCouncilNames, councilNameOn, councilsById, eraTitles, manifestCouncilSets,
  niCouncils1923to67BodySlugs, niLocalGroupSlugs, normalizeCouncilName, plainTitleBodies, pre1973CouncilBodyNames
} from '../../registries/councils.mjs';
import { councilTier } from '../../src/ni-local-groups.mjs';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';

const registry = loadRegistry('councils');
const src = councilSources();
const sorted = (x) => [...x].sort();
const clone = () => structuredClone(registry);

test('councils: the registry passes its schema and checks', () => {
  assert.deepEqual(registryErrors('councils', registry), []);
  assert.equal(registry.councils.length, 155);
});

test('councils: the file is exactly what its sources give (a fresh seed equals it)', () => {
  assert.deepEqual(seedCouncils(), registry);
});

test('councils: the manifest builder sets', () => {
  const m = src.manifest;
  const sets = manifestCouncilSets(registry);
  assert.deepEqual(sorted(niCouncils1923to67BodySlugs(registry)), sorted(m.NI_COUNCILS_1923_67_BODY_SLUGS));
  assert.deepEqual(sorted(sets.pre1973), sorted(m.PRE1973_COUNCIL_BODY_SLUGS));
  assert.deepEqual(sorted(sets.resultsOnly1923to67), sorted(m.NI_COUNCILS_1923_67_RESULTS_ONLY_BODY_SLUGS));
  assert.deepEqual(sorted(sets.pr1920Only), sorted(m.PR1920_ONLY_COUNCIL_BODY_SLUGS));
  assert.deepEqual(sorted(sets.armaghPilot), sorted(m.ARMAGH_PILOT_RESULTS_ONLY_BODY_SLUGS));
  assert.deepEqual(sorted(sets.localGovernmentBodies), sorted(m.LOCAL_GOVERNMENT_BODIES));
});

test('councils: src/ni-local-groups.mjs (NI_COUNCIL_SLUGS, NI_LOCAL_TIERS, councilTier)', () => {
  assert.deepEqual(sorted(niLocalGroupSlugs(registry)), sorted(src.niCouncilSlugs));
  for (const [type, tier] of Object.entries(src.niLocalTiers)) {
    assert.equal(registry.types[type].label, tier.label);
    assert.deepEqual(registry.types[type].levels, [...tier.levels]);
  }
  for (const c of registry.councils.filter((x) => x.generation === 'pre-1973')) {
    assert.equal(councilTier(c.bodySlug), c.type, c.id);
  }
});

test('councils: scripts/lib/election-names.mjs (era titles, plain titles, pre-1973 bodies)', () => {
  const e = src.electionNames;
  const want = new Map([...e.NI_COUNCIL_ERA_TITLES].map(([k, v]) => [k, Array.from(v, (x) => [...x])]));
  assert.deepEqual(eraTitles(registry), want);
  assert.deepEqual(sorted(plainTitleBodies(registry)), sorted(e.NI_COUNCILS_1923_67_PLAIN_TITLES));
  assert.deepEqual(sorted(pre1973CouncilBodyNames(registry)), sorted(e.PRE1973_COUNCIL_BODIES));
});

test('councils: a council\'s name on each poll date is the one canonicalElectionTitle uses', () => {
  const byId = councilsById(registry);
  let checked = 0;
  for (const body of src.electionsIndex.bodies) {
    const c = byId.get(body.slug);
    if (!c?.names) continue;
    for (const { date } of body.dates) {
      const year = String(date).slice(0, 4);
      assert.equal(canonicalElectionTitle({ body: body.name, date, bodySlug: body.slug }), `${year} ${councilNameOn(c, date)} election`, `${c.id} ${date}`);
      checked += 1;
    }
  }
  assert.ok(checked > 200, `checked ${checked} polls`);
});

test('councils: src/catalogue/search.js (council names by generation, body aliases)', () => {
  const s = src.search;
  assert.deepEqual(catalogueCouncilNames(registry, { generation: '1973' }), [...s.NI_COUNCILS_1973]);
  assert.deepEqual(catalogueCouncilNames(registry, { generation: '2014' }), [...s.NI_COUNCILS_2014]);
  assert.deepEqual(catalogueCouncilNames(registry, { generation: '2014', jurisdiction: 'ireland' }), [...s.IRISH_COUNCILS]);
  const councilAliases = Object.fromEntries(Object.entries(s.BODY_ALIASES).filter(([slug]) => councilTier(slug)));
  assert.deepEqual(catalogueBodyAliases(registry), councilAliases);
});

test('councils: counties, offices institutions and the scrapers\' lists', () => {
  for (const c of registry.councils) {
    if (c.generation === 'pre-1973') assert.deepEqual(c.counties, src.counties.pre1973Councils[c.id], c.id);
    if (c.generation === '1973') assert.deepEqual(c.counties, src.counties.districts1973[c.name], c.id);
  }
  const institutions = new Set(src.offices.institutions.map((i) => i.id));
  const linked = registry.councils.filter((c) => c.officesInstitution);
  for (const c of linked) assert.ok(institutions.has(c.officesInstitution), c.id);
  assert.equal(new Set(linked.map((c) => c.officesInstitution)).size, linked.length, 'one council per institution');

  const byWebKey = new Map(registry.councils.filter((c) => c.websites).map((c) => [c.websites.key, c.websites.hosts]));
  assert.deepEqual(new Map(src.councilWebsites.map(([k, hosts]) => [k, hosts])), byWebKey);
  const wiki = (gen) => new Map(registry.councils.filter((c) => c.generation === gen && c.wikipedia).map((c) => [c.wikipedia.key, c.wikipedia.titleVariants]));
  assert.deepEqual(wiki('1973'), new Map(src.wikipedia1973.map((w) => [w.key, w.variants])));
  assert.deepEqual(wiki('2014'), new Map(src.wikipedia2014.map((w) => [w.key, w.variants])));
  // The comparison scraper's lists are subsets (same council keys, fewer "District Council" forms).
  for (const w of src.wikipedia1973Compare) {
    for (const v of w.variants) assert.ok(wiki('1973').get(w.key).includes(v), `${w.key}: ${v}`);
  }
  for (const [stem, [name, aliases]] of Object.entries(src.officesCouncils)) {
    const c = registry.councils.find((x) => x.officialName === name && x.officesInstitution === `council-${stem}`)
      || registry.councils.find((x) => x.officialName === name);
    if (['belfast', 'dublin', 'cork'].includes(stem)) continue; // one institution, several councils
    assert.ok(c, `ef_offices ${stem}`);
    assert.deepEqual(c.officialNameAliases, aliases);
  }
});

test('councils: every 1973 and 2014 council is accounted for with relations', () => {
  const ni1973 = registry.councils.filter((c) => c.generation === '1973');
  const ni2014 = registry.councils.filter((c) => c.generation === '2014' && c.jurisdiction === 'northern-ireland');
  assert.equal(ni1973.length, 26);
  assert.equal(ni2014.length, 11);
  // Every 1973 council but Belfast has a 2014 successor (Belfast to Belfast is the same name in
  // both maps, which neither source can state as a change).
  for (const c of ni1973) {
    if (c.name === 'Belfast') continue;
    assert.ok(c.successors?.some((s) => s.id.startsWith('ni-2014-')), c.id);
  }
  for (const c of ni2014) {
    if (c.name === 'Belfast') continue;
    assert.ok(c.predecessors?.length, c.id);
  }
});

test('councils: the checks reject what the schema cannot', () => {
  const dup = clone();
  dup.councils.push({ ...dup.councils[0] });
  assert.ok(registryErrors('councils', dup).some((e) => /duplicate id|also on/.test(e)));

  const oneSided = clone();
  const c = oneSided.councils.find((x) => x.successors);
  c.successors.push({ id: 'ni-2014-belfast', basis: [{ type: 'overlap', source: 'data/x.json' }] });
  assert.ok(registryErrors('councils', oneSided).some((e) => /does not list it/.test(e)));

  const badType = clone();
  badType.councils[0].type = 'parish';
  assert.ok(registryErrors('councils', badType).some((e) => /not declared/.test(e)));

  const badRef = clone();
  badRef.councils.find((x) => x.aldermenOf).aldermenOf = 'nowhere-council';
  assert.ok(registryErrors('councils', badRef).some((e) => /aldermenOf/.test(e)));

  const badSchema = clone();
  badSchema.councils[0].generation = '1898';
  assert.ok(registryErrors('councils', badSchema).some((e) => /generation/.test(e)));
});

test('councils: councilNameOn picks the era a date falls in', () => {
  const byId = councilsById(registry);
  const kilkeel = byId.get('kilkeel-urban-district-council');
  assert.equal(councilNameOn(kilkeel, '1936-05-15'), 'Kilkeel Town Commissioners');
  assert.equal(councilNameOn(kilkeel, '1937-04-01'), 'Kilkeel Urban District Council');
  assert.equal(councilNameOn(kilkeel, '1920-01-15'), 'Kilkeel Urban District Council');
  const strabane = byId.get('strabane-urban-district-council');
  assert.equal(councilNameOn(strabane, '1899'), 'Strabane Town Commissioners');
  assert.equal(councilNameOn(strabane, '1902-01-15'), 'Strabane Urban District Council');
  assert.equal(councilNameOn(byId.get('ni-1973-derry'), '1990'), 'Derry');
  assert.equal(normalizeCouncilName('Newry No. 2 Rural District Council'), 'newry no 2 rural district council');
});
