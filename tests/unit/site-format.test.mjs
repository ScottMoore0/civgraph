/**
 * The shared formatter's numbers and dates (packages/core/src/format.js siteNumber, siteDate,
 * MONTH_NAMES; date-format.mjs SHORT_MONTHS) write exactly what the code they replaced wrote
 * (rf8-frontend, 12 Nov 2026, R10 / check C10): every `x.toLocaleString('en-GB', options)`,
 * `new Intl.NumberFormat('en-GB')`, `d.toLocaleDateString('en-GB', ...)` and month-name array in
 * the map app, Browse, the catalogue, the Elections app, Words in parliament, the homepage and
 * the PRONI page. The old expressions are spelled out here, in a test, as the reference.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MONTH_NAMES, numberText, siteDate, siteNumber } from '../../packages/core/src/format.js';
import { SHORT_MONTHS } from '../../packages/core/src/date-format.mjs';
import { formatElectionDate } from '../../src/election-utils.js';
import { formatNumber as censusNumber } from '../../src/census-overlay.mjs';
import { formatHectares } from '../../packages/map/src/app/timeline/dates.mjs';

const OLD = 'en-GB';
const NUMBERS = [0, 1, 7, 12, 999, 1000, 1234, 9999, 10000, 21912, 79894, 123456, 1234567, 37496, -1, -1234, -98765.4321,
  0.5, 0.125, 1.005, 2.5, 12.3456, 1234.5678, 99.999, 1e9, 1e21, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity];
// The option sets the replaced call sites passed (Elections app fmtInt/pivot, census overlay).
const OPTIONS = [undefined, { maximumFractionDigits: 0 }, { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  ...[0, 1, 2, 3].map((d) => ({ maximumFractionDigits: d, minimumFractionDigits: d })),
  { minimumFractionDigits: 1, maximumFractionDigits: 2 }, { minimumFractionDigits: 0, maximumFractionDigits: 2 }];

test('siteNumber writes what toLocaleString(en-GB, options) wrote, for every option set used', () => {
  for (const options of OPTIONS) {
    for (const n of NUMBERS) {
      assert.equal(siteNumber(n, options), n.toLocaleString(OLD, options), `${n} ${JSON.stringify(options)}`);
      assert.equal(siteNumber(n, options), new Intl.NumberFormat(OLD, options).format(n));
    }
  }
  // A formatter is made once per option set, and reused: the second answer is the same.
  assert.equal(siteNumber(1234, { maximumFractionDigits: 0 }), siteNumber(1234, { maximumFractionDigits: 0 }));
});

test('numberText is unchanged', () => {
  assert.equal(numberText(1234), '1,234');
  assert.equal(numberText('79894'), '79,894');
  assert.equal(numberText(null), '');
  assert.equal(numberText(''), '');
  assert.equal(numberText('n/a'), '');
});

test('siteDate writes what toLocaleDateString(en-GB, options) wrote, an invalid date included', () => {
  const options = /** @type {const} */ ({ day: '2-digit', month: 'short', year: 'numeric' });
  for (const iso of ['1801-01-01', '1918-12-14', '1921-05-24', '1969-04-01', '1983-09-13', '2022-05-05', '2024-03-08', '2024-11-29']) {
    const d = new Date(`${iso}T00:00:00`);
    assert.equal(siteDate(d, options), d.toLocaleDateString(OLD, options), iso);
  }
  const invalid = new Date('not a date');
  assert.equal(siteDate(invalid, options), invalid.toLocaleDateString(OLD, options));
});

test('formatElectionDate (src/election-utils.js) is unchanged', () => {
  const old = (/** @type {string} */ value) => {
    const iso = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
    if (!iso) return value;
    return new Date(`${iso[1]}T00:00:00`).toLocaleDateString(OLD, { day: '2-digit', month: 'short', year: 'numeric' });
  };
  for (const value of ['2024-03-08-care', '1983-09-13', '1922-06-16', '1801', 'unknown', '2024-13-45']) {
    assert.equal(formatElectionDate(value), old(value), value);
  }
  assert.equal(formatElectionDate(null), null);
});

test('the month tables are the arrays they replaced', () => {
  assert.deepEqual([...SHORT_MONTHS], ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  assert.deepEqual([...MONTH_NAMES], ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  assert.ok(Object.isFrozen(MONTH_NAMES));
});

test('the census overlay and the timeline write their numbers as before', () => {
  const oldCensus = (/** @type {number} */ n, { decimals = /** @type {number | null} */ (null), percent = false } = {}) => {
    const opts = decimals === null
      ? (Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: percent ? 1 : 0, maximumFractionDigits: 2 })
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
    const text = n.toLocaleString(OLD, opts);
    return percent ? `${text}%` : text;
  };
  for (const n of [0, 12, 1234, 56.789, 0.5, 98765.4321]) {
    assert.equal(censusNumber(n), oldCensus(n));
    assert.equal(censusNumber(n, { percent: true }), oldCensus(n, { percent: true }));
    assert.equal(censusNumber(n, { decimals: 1 }), oldCensus(n, { decimals: 1 }));
  }
  assert.equal(formatHectares(123456.7), `${Math.round(123456.7).toLocaleString(OLD)} ha`);
});

test('with the Irish or Ulster-Scots interface on, the formatter still writes English for the runtime to translate', () => {
  // site/assets/i18n/i18n.js translates the English the page renders ("01 Apr 1969" takes the
  // language's month names), so the output must not change under it: the replaced code named
  // en-GB whatever the interface language was.
  const saved = /** @type {any} */ (globalThis).civgraphI18n;
  try {
    for (const [lang, locale] of [['ga', 'ga-IE'], ['sco', 'en-GB']]) {
      /** @type {any} */ (globalThis).civgraphI18n = { lang, locale };
      assert.equal(siteNumber(21912), (21912).toLocaleString(OLD));
      assert.equal(siteNumber(12.3456, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '12.35');
      const d = new Date('1969-04-01T00:00:00');
      assert.equal(siteDate(d, { day: '2-digit', month: 'short', year: 'numeric' }), d.toLocaleDateString(OLD, { day: '2-digit', month: 'short', year: 'numeric' }));
    }
  } finally {
    /** @type {any} */ (globalThis).civgraphI18n = saved;
  }
});
