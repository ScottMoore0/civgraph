/**
 * The shared formatter's numbers and dates (packages/core/src/format.js siteNumber, siteDate,
 * MONTH_NAMES; date-format.mjs SHORT_MONTHS) write exactly what the code they replaced wrote
 * (rf8-frontend, 12 Nov 2026, R10 / check C10): every `x.toLocaleString('en-GB', options)`,
 * `new Intl.NumberFormat('en-GB')`, `d.toLocaleDateString('en-GB', ...)` and month-name array in
 * the map app, Browse, the catalogue, the Elections app, Words in parliament, the homepage and
 * the PRONI page. The old expressions are spelled out here, in a test, as the reference.
 * Since 12 Nov 2026 (rf9-i18n, acceptance test A5) the formatter follows the interface language's
 * locale (siteLocale); with no language runtime, or the runtime in English, it is still en-GB.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MONTH_NAMES, numberText, siteDate, siteLocale, siteNumber } from '../../packages/core/src/format.js';
import { SHORT_MONTHS } from '../../packages/core/src/date-format.mjs';
import { formatElectionDate } from '../../packages/map/src/election-utils.js';
import { formatNumber as censusNumber } from '../../packages/map/src/census-overlay.mjs';
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

/**
 * Runs `fn` with globalThis.civgraphI18n set to `runtime` (as site/assets/i18n/i18n.js sets it),
 * restoring what was there.
 * @param {{ lang: string, locale: string | undefined } | undefined} runtime
 * @param {() => void} fn
 */
function withRuntime(runtime, fn) {
  const g = /** @type {{ civgraphI18n?: unknown }} */ (globalThis);
  const saved = g.civgraphI18n;
  try {
    if (runtime) g.civgraphI18n = runtime;
    else delete g.civgraphI18n;
    fn();
  } finally {
    if (saved === undefined) delete g.civgraphI18n;
    else g.civgraphI18n = saved;
  }
}

const DATE_OPTIONS = /** @type {const} */ ({ day: '2-digit', month: 'short', year: 'numeric' });
const DATES = ['1801-01-01', '1918-12-14', '1921-05-24', '1969-04-01', '1983-09-13', '2022-05-05', '2024-03-08', '2024-11-29'];

test('English pages write exactly what en-GB wrote: no runtime, the runtime in English, the runtime still loading', () => {
  // The runtime is absent on every page without the preview; in English it reports en-GB; before
  // languages.json has loaded its locale is undefined. All three are byte-identical to en-GB.
  for (const runtime of [undefined, { lang: 'en', locale: 'en-GB' }, { lang: '', locale: undefined }]) {
    withRuntime(runtime, () => {
      assert.equal(siteLocale(), OLD);
      for (const options of OPTIONS) {
        for (const n of NUMBERS) assert.equal(siteNumber(n, options), n.toLocaleString(OLD, options), `${n} ${JSON.stringify(options)}`);
      }
      for (const iso of DATES) {
        const d = new Date(`${iso}T00:00:00`);
        assert.equal(siteDate(d, DATE_OPTIONS), d.toLocaleDateString(OLD, DATE_OPTIONS), iso);
        assert.equal(formatElectionDate(iso), d.toLocaleDateString(OLD, DATE_OPTIONS), iso);
      }
    });
  }
});

test('the formatter follows the interface language: Ulster-Scots writes en-GB, Irish its own dates and the same numbers', () => {
  withRuntime({ lang: 'sco', locale: 'en-GB' }, () => {
    for (const options of OPTIONS) for (const n of NUMBERS) assert.equal(siteNumber(n, options), n.toLocaleString(OLD, options));
    const d = new Date('1969-04-01T00:00:00');
    assert.equal(siteDate(d, DATE_OPTIONS), d.toLocaleDateString(OLD, DATE_OPTIONS));
  });
  withRuntime({ lang: 'ga', locale: 'ga-IE' }, () => {
    assert.equal(siteLocale(), 'ga-IE');
    // Irish groups and points numbers as English does, for every option set the site uses: the
    // runtime never rewrites a number, so it matters that they agree. Only "not a number" is
    // written in Irish ("Nuimh"), as Intl ga-IE has it.
    for (const options of OPTIONS) {
      for (const n of NUMBERS) {
        if (Number.isNaN(n)) assert.equal(siteNumber(n, options), new Intl.NumberFormat('ga-IE', options).format(n));
        else assert.equal(siteNumber(n, options), n.toLocaleString(OLD, options), `${n} ${JSON.stringify(options)}`);
      }
    }
    // Dates take the Irish month: what the runtime made of the English before ("01 Apr 1969" ->
    // "01 Aib 1969", Intl ga-IE; site/assets/i18n/i18n.js months()).
    const d = new Date('1969-04-01T00:00:00');
    assert.equal(siteDate(d, DATE_OPTIONS), d.toLocaleDateString('ga-IE', DATE_OPTIONS));
    const month = new Intl.DateTimeFormat('ga-IE', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 3, 15))).replace(/\.$/, '');
    assert.equal(siteDate(d, DATE_OPTIONS), `01 ${month} 1969`);
  });
  // An engine without the language's locale data writes the source's, as before: the runtime
  // then translates the months from the language file. (Node has every locale; a tag no engine
  // knows stands in for Irish in a browser build without it.)
  withRuntime({ lang: 'xx', locale: 'zz-ZZ' }, () => {
    assert.equal(siteLocale(), OLD);
    assert.equal(siteDate(new Date('1969-04-01T00:00:00'), DATE_OPTIONS), '01 Apr 1969');
  });
  withRuntime({ lang: 'xx', locale: 'not a tag' }, () => assert.equal(siteLocale(), OLD));
  // A formatter is cached per locale: English after Irish is English again.
  withRuntime({ lang: 'en', locale: 'en-GB' }, () => assert.equal(siteDate(new Date('1969-04-01T00:00:00'), DATE_OPTIONS), '01 Apr 1969'));
});
