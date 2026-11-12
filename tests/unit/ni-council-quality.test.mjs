import test from 'node:test';
import assert from 'node:assert/strict';
import { citationParts, pageKeys, surnameKey } from '../../scripts/check/rules/ni-council-quality.mjs';

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
