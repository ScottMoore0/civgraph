import test from 'node:test';
import assert from 'node:assert/strict';
import { citationParts, citedDates, initialsOf, initialsOnlyFindings, pageKeys, pollDateFindings, rankContests, surnameKey } from '../../scripts/check/rules/ni-council-quality.mjs';

test('surname keys fold M\', Mac and Mc together and drop punctuation', () => {
  assert.equal(surnameKey("M'Neilly"), 'mcneilly');
  assert.equal(surnameKey('McNeilly'), 'mcneilly');
  assert.equal(surnameKey('MacNeilly'), 'mcneilly');
  assert.equal(surnameKey('Mack'), 'mack');
  assert.equal(surnameKey("O'Hare"), 'ohare');
  assert.equal(surnameKey('Johnson-Smyth'), 'johnsonsmyth');
});

test('citation parts: paper, ISO date and page from the first cited item', () => {
  const parts = citationParts({ title: 'Belfast News-Letter, 16 May 1936, p. 7 ("One surprise"); Irish News, 16 May 1936, p. 7', url: 'https://irishnewsarchive.com/?a=d&d=BNL19360516.1.7' });
  assert.equal(parts.paper, 'Belfast News-Letter');
  assert.equal(parts.date, '1936-05-16');
  assert.equal(parts.page, true);
  assert.equal(parts.proni, false);
  const register = citationParts({ title: 'Belfast Corporation, Register of Members, 1912-1973 (PRONI LA/7/1/CA/1/3)' });
  assert.equal(register.proni, true);
  assert.equal(register.page, false);
});

test('page keys from INA and BNA links', () => {
  assert.deepEqual(pageKeys({ url: 'https://irishnewsarchive.com/?a=d&d=BNL19360516.1.7' }), ['ina|BNL|19360516|7']);
  assert.deepEqual(pageKeys({ urls: ['https://www.britishnewspaperarchive.com/viewer/bl/0001480/19490603/045/0005'] }), ['bna|0001480|19490603|5']);
  assert.deepEqual(pageKeys({ url: 'https://www.britishnewspaperarchive.com/image-viewer?issue=BL%2F0002318%2F19520606&page=0003' }), ['bna|0002318|19520606|3']);
});

// ---- name-initials, poll-date and the ranking (w19-council-audit) ----

/**
 * @param {string} body
 * @param {string} round
 * @param {string} area
 * @param {{ first: string, last: string, votes?: number, status?: string }[]} people
 * @param {object} [source]
 */
function contest(body, round, area, people, source = {}) {
  const cands = people.map((p) => ({
    Firstname: p.first, Surname: p.last, candidateName: `${p.first} ${p.last}`, Status: p.status || 'Elected',
    votes: p.votes ?? null, elected: (p.status || 'Elected') === 'Elected', surnameKey: surnameKey(p.last), initial: p.first[0].toLowerCase()
  }));
  return { body, round, year: round.slice(0, 4), file: `${body}/${round}/${area.toLowerCase()}.json`, data: { source }, info: {}, cands, area, seats: 1 };
}

test('initialsOf reads forenames printed only as initials', () => {
  assert.equal(initialsOf('W. J.'), 'wj');
  assert.equal(initialsOf('J'), 'j');
  assert.equal(initialsOf('Mrs. A. M.'), 'am');
  assert.equal(initialsOf('William J.'), '');
  assert.equal(initialsOf('Wm.'), '');
  assert.equal(initialsOf(''), '');
});

test('name-initials: a neighbouring round gives the forename; the registry decides the severity', () => {
  const a = contest('x-urban-district-council', '1946-09-18', 'West', [{ first: 'J.', last: 'Connellan' }]);
  const b = contest('x-urban-district-council', '1949-05-18', 'West', [{ first: 'Joseph', last: 'Connellan' }]);
  const far = contest('x-urban-district-council', '1964-05-20', 'West', [{ first: 'James', last: 'Connellan' }]);
  const other = contest('x-urban-district-council', '1952-05-21', 'West', [{ first: 'J. A.', last: 'Connellan' }]);
  const plain = initialsOnlyFindings([a, b, far, other]);
  assert.equal(plain.length, 1, 'J. A. has no Joseph A.; James is three rounds away');
  assert.equal(plain[0].contest, a);
  assert.equal(plain[0].severity, 'low');
  const ids = new Map([[a, 1], [b, 2]]);
  const split = initialsOnlyFindings([a, b], (c) => ids.get(c) ?? null);
  assert.equal(split[0].severity, 'medium');
  assert.match(split[0].detail, /two people \(1, 2\)/);
  assert.equal(initialsOnlyFindings([a, b], () => 7).length, 0, 'one person already: no lead');
});

test('poll-date: CC and RDs of a county poll together; results cannot predate the poll', () => {
  const cc = contest('tyrone-county-council', '1939-05-31', 'Omagh', [{ first: 'John', last: 'Smith' }]);
  const rd1 = contest('omagh-rural-district-council', '1939-05-31', 'Drumquin', [{ first: 'John', last: 'Brown' }]);
  const rd2 = contest('strabane-rural-district-council', '1939-05-25', 'Clady', [{ first: 'Hugh', last: 'Doherty' }]);
  const polled = contest('omagh-rural-district-council', '1939-05-31', 'Fintona', [{ first: 'A.', last: 'Kerr', votes: 300 }, { first: 'B.', last: 'Moore', votes: 200, status: 'Not Elected' }],
    { title: 'Tyrone Constitution, 26 May 1939, p. 5' });
  const out = pollDateFindings([cc, rd1, rd2, polled], () => 'Tyrone');
  const round = out.filter((f) => f.severity === 'medium');
  assert.equal(round.length, 1);
  assert.equal(round[0].contest.body, 'strabane-rural-district-council');
  const early = out.filter((f) => f.severity === 'high');
  assert.equal(early.length, 1);
  assert.equal(early[0].contest, polled);
  assert.deepEqual(citedDates({ title: 'BNL, 2 June 1939, p. 3; Ulster Herald, 10 June 1939, p. 4' }), ['1939-06-02', '1939-06-10']);
});

test('rankContests: odds combine per contest; a contest an earlier fixer passed sinks', () => {
  const a = contest('x-urban-district-council', '1955-05-18', 'Glen', [{ first: 'Ann', last: 'Foulis', votes: 400 }]);
  const b = contest('x-urban-district-council', '1955-05-18', 'Castle', [{ first: 'Ian', last: 'Hamill' }]);
  const c = contest('x-urban-district-council', '1955-05-18', 'Scrabo', [{ first: 'Ivy', last: 'Woods' }]);
  const findings = [
    { contest: a, type: 'omitted-loser', severity: 'high', detail: 'votes printed for 1 but only 1 candidate(s) for 1 seat(s)' },
    { contest: b, type: 'name-letters', severity: 'medium', detail: 'x', candidate: 'Ian Hamill' },
    { contest: b, type: 'name-not-on-page', severity: 'high', detail: 'y', candidate: 'Ian Hamill' },
    { contest: c, type: 'name-variant', severity: 'high', detail: 'z', candidate: 'Ivy Woods' }
  ];
  const plain = rankContests(findings);
  assert.deepEqual(plain.map((r) => r.area), ['Glen', 'Scrabo', 'Castle']);
  assert.equal(plain[0].confidence, 0.8);
  assert.equal(plain[0].people, 1);
  assert.equal(plain[2].confidence, Math.round((1 - (1 - 0.24) * (1 - 0.12)) * 1000) / 1000);
  const reviewed = new Map([[c.file, { file: c.file, action: 'confirmed-ok', types: new Set(['name-variant']) }]]);
  const after = rankContests(findings, reviewed);
  assert.deepEqual(after.map((r) => r.area), ['Glen', 'Castle', 'Scrabo']);
  assert.equal(after[2].prior, 'confirmed-ok');
  assert.deepEqual(after[0].reasons, ['OMIT']);
});
