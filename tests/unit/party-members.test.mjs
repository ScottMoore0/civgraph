// The party members format (packages/core/src/party-members.mjs): what the API encodes, the party
// page decodes to the same fields it reads from a whole Browse card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMBER_COLUMNS, decodeMembers, memberEncoder } from '../../packages/core/src/party-members.mjs';

const card = {
  id: '100486',
  slug: 'micheal-martin-100486',
  name: 'Micheál Martin',
  title: 'Micheál Martin',
  parties: [{ name: 'Fianna Fáil', count: 2 }],
  elections: [
    { key: 'dail-eireann__2024-11-29', title: '2024 Irish general election', date: '2024-11-29', party: 'Fianna Fáil', constituency: 'Cork South Central', status: 'Made Quota', elected: true, firstPrefs: 14526, share: 23.17, gender: 'M' },
    { key: 'cork-corporation__1985-06-20', title: 'Cork 1985', date: '1985-06-21', party: 'Fianna Fail', constituency: 'Cork South Central', elected: false, firstPrefs: '812' },
    { key: 'ireland-referendum__1992-06-18', title: 'A referendum', party: '', status: '' },
    { key: 'odd', party: 'Independent', votes: 9 },
  ],
};

test('a card encodes to rows of the columns and decodes to the fields the page reads', () => {
  const encoder = memberEncoder();
  const member = encoder.member(card);
  assert.deepEqual(MEMBER_COLUMNS, ['key', 'date', 'constituency', 'party', 'status', 'elected', 'firstPrefs', 'title']);
  assert.equal(member[0], card.slug);
  assert.equal(member[1], card.name);
  assert.equal(member[3], null);
  assert.equal(memberEncoder().member(card, 42)[3], 42);
  const rows = member[2];
  assert.deepEqual(rows[0], [0, '', 0, 0, 0, 1, 14526]);
  // A date that is not the key's own is carried; a missing one is null; a referendum keeps its title.
  assert.equal(rows[1][1], '1985-06-21');
  assert.deepEqual(rows[2], [2, null, 1, 2, 1, null, null, 'A referendum']);
  assert.deepEqual(encoder.dictionaries, {
    key: ['dail-eireann__2024-11-29', 'cork-corporation__1985-06-20', 'ireland-referendum__1992-06-18', 'odd'],
    constituency: ['Cork South Central', ''],
    party: ['Fianna Fáil', 'Fianna Fail', '', 'Independent'],
    status: ['Made Quota', ''],
  });

  const [person] = decodeMembers({ dictionaries: encoder.dictionaries, members: [member] });
  assert.equal(person.slug, card.slug);
  assert.equal(person.id, card.slug);
  assert.equal(person.name, card.name);
  assert.equal(person.ord, null);
  assert.deepEqual(person.elections, [
    { key: 'dail-eireann__2024-11-29', date: '2024-11-29', constituency: 'Cork South Central', party: 'Fianna Fáil', status: 'Made Quota', elected: true, firstPrefs: 14526 },
    { key: 'cork-corporation__1985-06-20', date: '1985-06-21', constituency: 'Cork South Central', party: 'Fianna Fail', status: '', elected: false, firstPrefs: '812' },
    { key: 'ireland-referendum__1992-06-18', date: '', constituency: '', party: '', status: '', firstPrefs: null, title: 'A referendum' },
    { key: 'odd', date: '', constituency: '', party: 'Independent', status: '', firstPrefs: 9 },
  ]);
});

test('a member is smaller than its card', () => {
  const member = memberEncoder().member(card);
  assert.ok(JSON.stringify(member).length * 3 < JSON.stringify(card).length);
});

test('decoding tolerates a missing or partial answer', () => {
  assert.deepEqual(decodeMembers({}), []);
  assert.deepEqual(decodeMembers(null), []);
  assert.deepEqual(decodeMembers({ members: [['a']] }), [{ slug: 'a', id: 'a', name: '', ord: null, elections: [] }]);
  assert.deepEqual(decodeMembers({ dictionaries: { key: ['k'] }, members: [['b', 'B', [[0]]]] })[0].elections,
    [{ key: 'k', date: '', constituency: '', party: '', status: '', firstPrefs: null }]);
});
