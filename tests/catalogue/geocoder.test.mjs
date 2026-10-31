// Unit tests for the map search's address lookup (src/catalogue/geocoder.js), with fetch
// replaced: no request leaves the machine. node --test tests/catalogue/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressGeocoder, parsePostcode } from '../../src/catalogue/geocoder.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('BT postcodes are recognised whole or by outward code, and nothing else is', () => {
  assert.deepEqual(parsePostcode('bt7 1nn'), { kind: 'full', code: 'BT7 1NN' });
  assert.deepEqual(parsePostcode('BT71NN'), { kind: 'full', code: 'BT7 1NN' });
  assert.deepEqual(parsePostcode(' BT48 '), { kind: 'outward', code: 'BT48' });
  assert.equal(parsePostcode('SW1A 1AA'), null);
  assert.equal(parsePostcode('Botanic'), null);
});

test('a refused Photon request pauses suggestions for ten minutes, and typing never reaches Nominatim', async () => {
  const urls = [];
  let now = 1_000_000;
  const g = new AddressGeocoder({
    storage: memoryStorage(),
    now: () => now,
    fetchImpl: async (url) => { urls.push(url); return url.includes('photon') ? json({}, 429) : json([]); },
  });
  const first = await g.suggest('Royal Avenue');
  assert.equal(first.paused, true);
  assert.equal(g.paused, true);
  await g.suggest('Royal Avenue Belfast');
  assert.equal(urls.filter((u) => u.includes('photon')).length, 1, 'no second Photon request while paused');
  assert.equal(urls.filter((u) => u.includes('nominatim')).length, 0);
  now += 10 * 60 * 1000 + 1;
  assert.equal(g.paused, false, 'Photon is tried again after ten minutes');
});

test('Enter searches Nominatim once a second at most', async () => {
  const times = [];
  const g = new AddressGeocoder({ storage: memoryStorage(), fetchImpl: async () => { times.push(Date.now()); return json([]); } });
  await g.search('Royal Avenue');
  await g.search('Royal Avenue Belfast');
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 950, `${times[1] - times[0]}ms apart`);
});
