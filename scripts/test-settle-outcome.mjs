#!/usr/bin/env node
/**
 * T0-05 — a load that never drew must not be announced as loaded.
 *
 * WHY THIS EXISTS
 *
 * The catalogue announced the outcome of a layer load from isLayerLoaded(), which
 * reports style membership. A layer is in the style the instant addLayer returns and
 * stays there whether or not a single tile arrives, so a twenty-second stall over an
 * empty map was announced to the user as "<layer> loaded". A false success is worse
 * than silence: it tells the user not to retry.
 *
 * waitForMapSettle now returns WHICH way the wait ended, and that value is what the
 * announcement branches on. These cases pin the three outcomes and the two ways the
 * distinction could quietly rot: a late event flipping a decided answer, and the
 * wiring between the adapter and the catalogue being dropped.
 *
 * Run: node scripts/test-settle-outcome.mjs
 */
import { readFileSync } from 'node:fs';
import {
  waitForMapSettle, SETTLE_SETTLED, SETTLE_TIMEOUT, SETTLE_UNAVAILABLE
} from '../app/src/settle.js';

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`);
}

/** Smallest thing that behaves like the parts of a MapLibre map this reads. */
function fakeMap({ tilesLoaded = true } = {}) {
  const handlers = new Map();
  return {
    handlers,
    on(ev, fn) { (handlers.get(ev) || handlers.set(ev, []).get(ev)).push(fn); },
    off(ev, fn) {
      const list = handlers.get(ev) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    areTilesLoaded: () => (typeof tilesLoaded === 'function' ? tilesLoaded() : tilesLoaded),
    emit(ev) { [...(handlers.get(ev) || [])].forEach((fn) => fn()); },
    listenerCount(ev) { return (handlers.get(ev) || []).length; }
  };
}

console.log('waitForMapSettle:');

// 1. Idle with tiles drawn is the only success.
{
  const map = fakeMap({ tilesLoaded: true });
  const p = waitForMapSettle(map, { timeoutMs: 5000 });
  map.emit('idle');
  check('idle + tiles loaded -> settled', await p, SETTLE_SETTLED);
  check('  listener removed on success', map.listenerCount('idle'), 0);
}

// 2. THE CASE THAT CAUSED THIS. Idle arrives -- MapLibre goes idle whenever it is not
//    moving -- but no tile ever does. Before, this resolved indistinguishably from
//    success. It must now say it gave up.
{
  const map = fakeMap({ tilesLoaded: false });
  const p = waitForMapSettle(map, { timeoutMs: 40 });
  map.emit('idle');
  map.emit('idle');
  check('idle + tiles never loaded -> timeout', await p, SETTLE_TIMEOUT);
  check('  listener removed on timeout', map.listenerCount('idle'), 0);
}

// 3. Tiles arrive late: keep waiting through the useless idles rather than reporting
//    the first one.
{
  let loaded = false;
  const map = fakeMap({ tilesLoaded: () => loaded });
  const p = waitForMapSettle(map, { timeoutMs: 5000 });
  map.emit('idle');
  loaded = true;
  map.emit('idle');
  check('idle before tiles, then after -> settled', await p, SETTLE_SETTLED);
}

// 4. No map to watch is NOT success. If this ever returns 'settled', every caller
//    silently starts claiming layers loaded on a torn-down page.
check('no map -> unavailable', await waitForMapSettle(null), SETTLE_UNAVAILABLE);
check('map without on/off -> unavailable', await waitForMapSettle({}), SETTLE_UNAVAILABLE);

// 5. A late idle must not overturn a decided timeout. This is the leak that would
//    reintroduce the bug in the other direction: user told "gave up", then told
//    "loaded" thirty seconds later.
{
  const map = fakeMap({ tilesLoaded: false });
  const p = waitForMapSettle(map, { timeoutMs: 20 });
  const first = await p;
  map.areTilesLoaded = () => true;
  map.emit('idle');
  check('late idle does not overturn timeout', first, SETTLE_TIMEOUT);
  check('  no listener left to overturn it', map.listenerCount('idle'), 0);
}

// 6. Structural, and weak on purpose -- it cannot prove the announcement is right, only
//    that the wire between the adapter and the catalogue is still connected. The three
//    outcomes are worthless if nobody reads them, and that is a deletion no other check
//    here would notice.
console.log('wiring:');
const appSrc = readFileSync('app/src/app.js', 'utf8');
const uiSrc = readFileSync('src/ui-controller.js', 'utf8');
check('app.js records the outcome', /recordSettleOutcome\(mapId, await this\.mapController\.waitUntilSettled\(\)\)/.test(appSrc), true);
check('app.js exposes onCheckMapSettled', /onCheckMapSettled\s*=/.test(appSrc), true);
check('ui-controller reads onCheckMapSettled', /this\.onCheckMapSettled\(mapId\)/.test(uiSrc), true);
check('ui-controller branches on timeout', /outcome === 'timeout'/.test(uiSrc), true);

console.log('');
if (failures) {
  console.error(`FAIL: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('PASS: settle outcomes distinguish drawn, gave up, and could-not-tell.');
