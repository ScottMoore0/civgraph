/**
 * The Elections app's methods notes and page (site/apps/elections/lib/methods.js,
 * views/methods.js) and its "data checked" dates (lib/checked.js), stream el-tables: each
 * worked-out figure links to the section that says how it is made, the words agree with the code
 * that makes the figures, and every word is keyed for translation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  METHODS, METHODS_URL, METHOD_NOTE, METHOD_STRINGS, methodLink, methodNote, pivotMethodLinks,
} from '../../site/apps/elections/lib/methods.js';
import { CHECKED_TEXT, checkedFact, comparedOn, latestCheck } from '../../site/apps/elections/lib/checked.js';
import { METHODS_PAGE } from '../../site/apps/elections/views/methods.js';
import { SWING_LIMIT } from '../../site/apps/elections/state-machines.js';
import { allocate } from '../../site/apps/elections/lib/project.js';
import { parseRoute } from '../../site/apps/elections/lib/route.js';
import { MEASURES } from '../../site/apps/elections/lib/pivot.js';

const method = (id) => METHODS.find((m) => m.id === id);

test('each method has its own anchor, and a figure links to it', () => {
  const ids = METHODS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of METHODS) assert.ok(m.title && m.link && m.paragraphs.length, m.id);
  assert.equal(methodLink('swing'), `<a class="el-method-link" href="${METHODS_URL}#swing">How swing is worked out</a>`);
  assert.throws(() => methodLink(/** @type {any} */ ('nope')));
  assert.equal(methodNote('turnout', [METHOD_NOTE.turnoutDerived]),
    '<p class="el-muted el-method" data-method="turnout"><span>Worked out from the total poll and the electorate.</span> <a class="el-method-link" href="/elections/methods/#turnout">How turnout is worked out</a></p>');
  assert.equal(parseRoute('/elections/methods/').view, 'methods');
  assert.equal(parseRoute('/apps/elections/methods/', '').view, 'methods');
});

test('the words agree with the code that makes the figures', () => {
  // The swingometer's sliders (state-machines.js SWING_LIMIT) and its 0.5% threshold (views/swing.js).
  const sw = method('swingometer').paragraphs.join(' ');
  assert.ok(sw.includes(`from −${SWING_LIMIT} to +${SWING_LIMIT} points`), 'the slider range');
  assert.match(readFileSync(new URL('../../site/apps/elections/views/swing.js', import.meta.url), 'utf8'), /filter\(\(\[, s\]\) => s >= 0\.5\)/);
  assert.ok(sw.includes('at least 0.5%'));
  // Seat estimates: a quota of 100 / (seats + 1) per cent, then the largest remainders.
  assert.ok(method('seat-estimates').paragraphs[0].includes('100 ÷ (seats + 1) per cent'));
  assert.deepEqual([...allocate(new Map([['A', 50], ['B', 30], ['C', 20]]), 3)].sort(), [['A', 2], ['B', 1]]);
  assert.deepEqual([...allocate(new Map([['A', 40], ['B', 35], ['C', 25]]), 2)].sort(), [['A', 1], ['B', 1]], 'B on the larger remainder');
  assert.deepEqual([...allocate(new Map([['A', 40], ['B', 60]]), 1)], [['B', 1]]);
  // The pivot's worked-out measures link to their methods; a count does not.
  assert.equal(pivotMethodLinks({ measure: 'share' }).measure, 'shares');
  assert.equal(pivotMethodLinks({ measure: 'turnout' }).measure, 'turnout');
  assert.equal(pivotMethodLinks({ measure: 'seats' }).measure, null);
  assert.equal(pivotMethodLinks({ measure: 'seats' }).limits.incumbency, 'incumbency');
  for (const m of ['share', 'seat_share', 'avg_share', 'turnout']) assert.ok(Object.hasOwn(MEASURES, m), m);
});

test('the checked date is the latest day of a source that agreed with every compared figure', () => {
  const cites = [
    { checked: 1, accessed: '2026-10-12' },
    { checked: 1, accessed: '2026-11-07' },
    { checked: 0, accessed: '2026-11-11' },
    { checked: true, accessed: 'not a day' },
    { checked: true },
  ];
  assert.equal(latestCheck(cites), '2026-11-07');
  assert.equal(latestCheck([{ checked: 0, accessed: '2026-11-11' }]), null);
  assert.equal(latestCheck([]), null);
  assert.equal(checkedFact(cites), '<dt>Data checked</dt><dd data-checked="2026-11-07"><time datetime="2026-11-07">07 Nov 2026</time> (<a href="#el-sources">see the sources</a>)</dd>');
  assert.equal(checkedFact([{ checked: 1, accessed: null }]), '');
  assert.equal(comparedOn({ accessed: '2026-10-12' }), ' <span class="el-muted el-compared"><span>Compared on</span> <time datetime="2026-10-12">12 Oct 2026</time></span>');
  assert.equal(comparedOn({ accessed: null }), '');
});

test('every word of the notes, the methods page and the checked dates is keyed for translation in en.json (R10)', () => {
  const en = JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings;
  const english = new Set(Object.values(en));
  for (const s of [...METHOD_STRINGS, ...Object.values(METHODS_PAGE), ...Object.values(CHECKED_TEXT)]) assert.ok(english.has(s), `not keyed: ${s}`);
});
