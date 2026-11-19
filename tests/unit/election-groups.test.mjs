// Grouped election entries (packages/map/src/election-groups.mjs; data/registries/election-bodies.json
// groups.groupedElections): one catalogue entry that opens several elections together, each keeping
// its own results. The European Parliament elections in the Republic and Northern Ireland of each
// year 1979-2019 and the three 2019 mayoral plebiscites (owner decision 3a of 19 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry, registryErrors } from '@civgraph/registries/index.mjs';
import { checkElectionBodies } from '@civgraph/registries/election-bodies.mjs';
import {
  ELECTION_GROUPS,
  ELECTION_GROUP_BODY,
  addElectionGroups,
  buildElectionGroupEntry,
  catalogueGroupRow,
  electionDay,
  electionLoadIdentity,
  groupAbout,
  groupCanonicalLayerId,
  groupsByMember,
  inGroupTimelineSeries,
  mergeMatchExpressions,
  withoutGroupMembers
} from '@civgraph/map/election-groups.mjs';

/** @typedef {import('@civgraph/map/election-groups.mjs').ElectionGroup} ElectionGroup */

const registry = loadRegistry('election-bodies');
const PLEBISCITE = 'ireland-referendum__2019-05-24-directly-elected-mayor-';

/** @type {ElectionGroup} */
const SAMPLE = {
  id: 'sample-2000',
  title: '2000 sample elections',
  members: [{ election: 'a__2000-05-02', label: 'A' }, { election: 'b__2000-05-01-x', label: 'B' }]
};

test('every member of every entry is an election the elections index holds', () => {
  const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/elections-source/data/elections_index.json'), 'utf8'));
  const keys = new Set(index.bodies.flatMap((/** @type {{ slug: string, dates: { date: string }[] }} */ b) => b.dates.map((d) => `${b.slug}__${d.date}`)));
  assert.ok(ELECTION_GROUPS.length >= 10);
  for (const group of ELECTION_GROUPS) for (const member of group.members) assert.ok(keys.has(member.election), `${group.id}: ${member.election}`);
});

test('the European elections of 1979 to 2019 are one entry a year, the Republic and Northern Ireland; 2024 is the Republic alone', () => {
  const european = ELECTION_GROUPS.filter((group) => group.id.startsWith('european-parliament-'));
  assert.deepEqual(european.map((group) => group.id.slice(-4)), ['1979', '1984', '1989', '1994', '1999', '2004', '2009', '2014', '2019']);
  for (const group of european) {
    assert.deepEqual(group.members.map((member) => member.election.split('__')[0]), ['ireland-european', 'european-parliament'], group.id);
    assert.deepEqual(group.members.map((member) => member.election.split('__')[1]?.slice(0, 4)), [group.id.slice(-4), group.id.slice(-4)], group.id);
    assert.equal(group.title, `${group.id.slice(-4)} European Parliament election`);
  }
  assert.ok(!groupsByMember().has('ireland-european__2024-06-07'));
});

test('the 2019 mayoral plebiscites are one entry of three, with Phelim Birch\'s description', () => {
  const group = ELECTION_GROUPS.find((g) => g.id === 'mayoral-plebiscites-2019');
  assert.ok(group);
  assert.deepEqual(group.members.map((m) => m.election), ['limerick', 'waterford', 'cork-city'].map((s) => `${PLEBISCITE}${s}`));
  const descriptions = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/catalogue/descriptions.json'), 'utf8')).elections;
  // His text, as each of the three records carries it.
  assert.deepEqual(group.about, descriptions[`${PLEBISCITE}cork-city`]);
});

test('the registry schema and checkElectionBodies reject a malformed entry', () => {
  const why = 'test';
  /** @param {unknown[]} groupedElections */
  const withGroups = (groupedElections) => ({ ...registry, groups: { ...registry.groups, groupedElections } });
  assert.deepEqual(checkElectionBodies(withGroups([{ ...SAMPLE, why }])), []);
  assert.deepEqual(registryErrors('election-bodies', withGroups([{ ...SAMPLE, why }])), []);
  // One member is not a group; a member is a key; the reason is required.
  assert.ok(registryErrors('election-bodies', withGroups([{ ...SAMPLE, members: SAMPLE.members.slice(0, 1), why }])).length);
  assert.ok(registryErrors('election-bodies', withGroups([{ ...SAMPLE, members: [{ election: 'not a key', label: 'A' }, SAMPLE.members[1]], why }])).length);
  assert.ok(registryErrors('election-bodies', withGroups([{ ...SAMPLE }])).length);
  assert.match(checkElectionBodies(withGroups([{ ...SAMPLE, why }, { ...SAMPLE, why }])).join('\n'), /sample-2000 is listed twice/);
  assert.match(checkElectionBodies(withGroups([{ ...SAMPLE, why }, { ...SAMPLE, id: 'other', why }])).join('\n'), /a__2000-05-02 is in sample-2000 and other/);
  assert.match(checkElectionBodies(withGroups([{ ...SAMPLE, members: [SAMPLE.members[0], { ...SAMPLE.members[1], label: 'A' }], why }])).join('\n'), /two members one label/);
  // The committed registry is clean.
  assert.deepEqual(checkElectionBodies(registry), []);
});

test('electionDay, keys and load identities', () => {
  assert.equal(electionDay('2019-05-24-directly-elected-mayor-cork-city'), '2019-05-24');
  assert.equal(electionDay('1946'), '');
  assert.equal(electionDay(undefined), '');
  assert.equal(groupCanonicalLayerId('european-parliament-2019'), 'election-group-european-parliament-2019');
  assert.deepEqual(electionLoadIdentity({ key: 'g', body: 'European', date: '2019-05-23', members: [{}] }), { body: ELECTION_GROUP_BODY, date: 'g' });
  assert.deepEqual(electionLoadIdentity({ key: 'a__2000-05-02', body: 'A', date: '2000-05-02' }), { body: 'A', date: '2000-05-02' });
});

test('buildElectionGroupEntry and addElectionGroups: the entry beside its members, dated by the first', () => {
  const elections = [{ key: 'a__2000-05-02', body: 'A', date: '2000-05-02' }, { key: 'b__2000-05-01-x', body: 'B', date: '2000-05-01-x' }, { key: 'c__2001-01-01', body: 'C', date: '2001-01-01' }];
  const entry = buildElectionGroupEntry(SAMPLE, new Map(elections.map((e) => [e.key, e])));
  assert.ok(entry);
  assert.equal(entry.key, 'sample-2000');
  assert.equal(entry.body, ELECTION_GROUP_BODY);
  assert.equal(entry.date, 'sample-2000');
  assert.equal(entry.sortDate, '2000-05-01');
  assert.equal(entry.year, 2000);
  assert.deepEqual(entry.memberKeys, ['a__2000-05-02', 'b__2000-05-01-x']);
  assert.equal(entry.displaySubtitle, 'A · B');
  // A member the catalogue lacks is left out; none, no entry.
  assert.deepEqual(buildElectionGroupEntry(SAMPLE, new Map([['a__2000-05-02', elections[0]]]))?.memberKeys, ['a__2000-05-02']);
  assert.equal(buildElectionGroupEntry(SAMPLE, new Map()), null);
  const catalogue = { elections: [...elections] };
  addElectionGroups(catalogue, [SAMPLE]);
  addElectionGroups(catalogue, [SAMPLE]);
  assert.equal(catalogue.elections.length, 4, 'added once');
  // A list shows the entry, not its members.
  assert.deepEqual(withoutGroupMembers(catalogue.elections, [SAMPLE]).map((e) => e.key), ['c__2001-01-01', 'sample-2000']);
});

test('inGroupTimelineSeries: entries and elections of the members\' bodies; a member only when it is open alone', () => {
  const members = groupsByMember([SAMPLE, { id: 'sample-2004', title: 't', members: [{ election: 'a__2004-01-01', label: 'A' }, { election: 'b__2004-01-01', label: 'B' }] }]);
  const group = { key: 'sample-2000', electionGroup: true, memberKeys: ['a__2000-05-02', 'b__2000-05-01-x'] };
  const later = { key: 'sample-2004', electionGroup: true, memberKeys: ['a__2004-01-01', 'b__2004-01-01'] };
  const alone = { key: 'a__2008-01-01' };
  const member = { key: 'a__2000-05-02' };
  const other = { key: 'z__2000-01-01' };
  assert.equal(inGroupTimelineSeries(later, group, members), true);
  assert.equal(inGroupTimelineSeries(alone, group, members), true);
  assert.equal(inGroupTimelineSeries(member, group, members), false);
  assert.equal(inGroupTimelineSeries(other, group, members), false);
  // An election open alone: the entries of its body, and itself even when an entry stands for it.
  assert.equal(inGroupTimelineSeries(group, alone, members), true);
  assert.equal(inGroupTimelineSeries(member, member, members), true);
  assert.equal(inGroupTimelineSeries({ key: 'a__2004-01-01' }, member, members), false);
});

test('mergeMatchExpressions: the members\' pairs on one layer, the first winning a shared label', () => {
  const input = ['to-string', ['get', 'name']];
  const a = ['match', input, 'Limerick', '#111111', 'Waterford', '#222222', '#eeeeee'];
  const b = ['match', input, 'Cork', '#333333', 'Limerick', '#999999', '#eeeeee'];
  assert.deepEqual(mergeMatchExpressions([a, b], '#eeeeee'), ['match', input, 'Limerick', '#111111', 'Waterford', '#222222', 'Cork', '#333333', '#eeeeee']);
  // A member with nothing on the layer is its plain fallback, and adds nothing.
  assert.deepEqual(mergeMatchExpressions(['#eeeeee', b], '#eeeeee'), ['match', input, 'Cork', '#333333', 'Limerick', '#999999', '#eeeeee']);
  assert.equal(mergeMatchExpressions(['#eeeeee', 0.1], '#eeeeee'), '#eeeeee');
});

test('groupAbout and catalogueGroupRow: one row for the members, with their links and places', () => {
  const rows = new Map([
    ['a__2000-05-02', { key: 'a__2000-05-02', title: '2000 A election', body: 'A', bodySlug: 'a', date: '2000-05-02', scope: 'Republic of Ireland', thumb: 'map-a', about: { text: ['About A.'], links: [{ label: 'A', url: 'https://example.org/a' }] } }],
    ['b__2000-05-01-x', { key: 'b__2000-05-01-x', title: '2000 B election', body: 'B', bodySlug: 'b', date: '2000-05-01-x', scope: 'Northern Ireland' }]
  ]);
  const row = catalogueGroupRow({ ...SAMPLE, shortLabel: 'Sample' }, rows);
  assert.ok(row);
  assert.equal(row.key, 'sample-2000');
  assert.equal(row.date, '2000-05-01');
  assert.equal(row.shortLabel, 'Sample');
  assert.equal(row.subtitle, 'A · B');
  assert.deepEqual(row.bodySlugs, ['a', 'b']);
  assert.deepEqual(row.scopes, ['Republic of Ireland', 'Northern Ireland']);
  assert.equal(row.scope, undefined, 'held in two places, so no single scope');
  assert.equal(row.thumb, 'map-a');
  assert.deepEqual(row.members.map((m) => [m.key, m.label, m.title]), [['a__2000-05-02', 'A', '2000 A election'], ['b__2000-05-01-x', 'B', '2000 B election']]);
  // One member described: its text as it stands. Several: each led by its label. Its own: that.
  assert.deepEqual(row.about, { text: ['About A.'], links: [{ label: 'A', url: 'https://example.org/a' }] });
  assert.deepEqual(groupAbout(SAMPLE, [{ label: 'A', about: { text: ['One.', 'Two.'] } }, { label: 'B', about: { text: ['Three.'] } }])?.text, ['A: One.', 'Two.', 'B: Three.']);
  assert.deepEqual(groupAbout({ ...SAMPLE, about: { text: ['Own.'] } }, [{ label: 'A', about: { text: ['One.'] } }]), { text: ['Own.'] });
  assert.equal(groupAbout(SAMPLE, [{ label: 'A' }]), null);
  assert.equal(catalogueGroupRow(SAMPLE, new Map()), null);
});
