/**
 * Sample data for rendering the map app's components in isolation: unit tests, and the design
 * system's gallery specimens (stream rf9-ui; packages/ui/src/gallery). Each sample is the input of a
 * pure renderer, shaped as the app hands it over; the colours come from the registries, as on the
 * map. Nothing in the app imports this module.
 */
import partyPalettes from '../../registries/src/browser/party-palettes.mjs';
import { CENSUS_RAMPS, MAP_COLOURS } from './colours.mjs';

/** A party's colour in the map's Republic of Ireland palette (the registry's mapRoi part). */
const roi = (/** @type {string} */ party) => (partyPalettes.mapRoi.find(([name]) => name === party) || [party, MAP_COLOURS.partyGrey])[1];
const ramp = CENSUS_RAMPS.viridis || [];

/**
 * The legend (packages/map/src/app/legend-view.mjs legendBodyHtml): an election's winners with 15
 * rows (so "and 1 more" shows), a census statistic, two editions of one series and an
 * approximate stretch.
 * @type {import('./app/legend-view.mjs').LegendParts}
 */
export const LEGEND_SAMPLE = {
  election: {
    title: 'Winner',
    unit: 'constituency',
    election: 'Dáil Éireann general election, 29 November 2024',
    items: [
      { party: 'fianna fail', abbreviation: 'FF', name: 'Fianna Fáil', colour: roi('fianna fail'), count: 12 },
      { party: 'sinn fein', abbreviation: 'SF', name: 'Sinn Féin', colour: roi('sinn fein'), count: 11 },
      { party: 'fine gael', abbreviation: 'FG', name: 'Fine Gael', colour: roi('fine gael'), count: 9 },
      { party: 'labour', abbreviation: 'Lab', name: 'Labour Party', colour: roi('labour'), count: 3 },
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((letter) => ({
        party: `independent ${letter}`, abbreviation: `Ind${letter}`, name: `Independent ${letter}`, colour: MAP_COLOURS.partyGrey, count: 1,
      })),
    ],
    ramp: null,
    keyNotes: [{ kind: 'hatch', text: 'Results not available or incomplete', count: 2 }],
    seats: true,
    bars: false,
  },
  statistics: [{
    id: 'census-1911-population',
    entry: { name: 'Population, 1911', source: { title: 'Census of Ireland, 1911' }, noFigureNote: 'No figure printed for this area.' },
    classes: ramp.slice(0, 4).map((colour, i) => ({ colour, label: `${i * 500}–${i * 500 + 499}`, count: 10 + i })),
    licence: { short: 'OGL', name: 'Open Government Licence' },
  }],
  layers: [
    { id: 'townlands-1911', name: 'Townlands, 1911', colour: MAP_COLOURS.layerLine, role: 'older' },
    { id: 'townlands-2020', name: 'Townlands, 2020', colour: MAP_COLOURS.layerLine, role: 'newer' },
  ],
  showLayers: true,
  approximate: [{ name: 'Townlands, 1911', colour: MAP_COLOURS.olderEdition, note: 'Traced from the six-inch sheets; some stretches are approximate.' }],
  electionMapId: 'election-dil-ireann-2024-11-29',
};

/**
 * The election results tables (packages/map/src/election-renderer.mjs renderElectionSummaryFromViewModel):
 * a two-constituency STV election. `RESULTS_SAMPLE` draws the party table; with `selectedResult`
 * set to one of its results and `view` 'counts', the count table of that constituency.
 */
const candidate = (/** @type {string} */ name, /** @type {string} */ party, /** @type {number[]} */ totals, /** @type {boolean} */ elected) => ({
  name, party, elected, firstPrefs: totals[0], votes: totals[0], finalVotes: totals[totals.length - 1],
  status: elected ? 'Elected' : 'Excluded',
  counts: totals.map((total, i) => ({
    count: i + 1, total, transfers: i ? total - totals[i - 1] : null,
    status: elected && total >= totals[totals.length - 1] && i === totals.length - 1 ? 'Elected' : '',
  })),
});
const SAMPLE_RESULTS = [
  {
    constituency: 'Northborough', matched: true, seatsTotal: 3, validPoll: 40000, quota: 10001, turnoutPct: 61.2,
    winnerParty: 'Fianna Fáil', leadingParty: 'Fianna Fáil', countNumbers: [1, 2, 3],
    candidates: [
      candidate('Áine Byrne', 'Fianna Fáil', [11200, 11200, 11200], true),
      candidate('Ciarán Walsh', 'Sinn Féin', [9800, 10150, 10420], true),
      candidate('Deirdre Kelly', 'Fine Gael', [8700, 9300, 10050], true),
      candidate('Eoin Doyle', 'Labour Party', [6100, 6450, 6450], false),
      candidate('Fionn Ryan', 'Independent', [4200, 4200, 4200], false),
    ],
  },
  {
    constituency: 'Southwick', matched: true, seatsTotal: 3, validPoll: 36000, quota: 9001, turnoutPct: 58.4,
    winnerParty: 'Sinn Féin', leadingParty: 'Sinn Féin', countNumbers: [1, 2],
    candidates: [
      candidate('Gráinne Murphy', 'Sinn Féin', [10400, 10400], true),
      candidate('Hugh Nolan', 'Fine Gael', [9100, 9100], true),
      candidate('Íde Quinn', 'Fianna Fáil', [8300, 9050], true),
      candidate('John Power', 'Green Party', [8200, 8200], false),
    ],
  },
];
/** @type {Parameters<typeof import('./election-renderer.mjs').renderElectionSummaryFromViewModel>[0]} */
export const RESULTS_SAMPLE = {
  bundle: { displayTitle: 'Sample general election, 2024', results: SAMPLE_RESULTS },
  results: SAMPLE_RESULTS,
  previousResults: [],
  view: 'party',
  localGovernment: false,
};

/**
 * The trend chart (packages/map/src/election-trend-chart.mjs buildTrendChartModel, then
 * layoutTrendChart and renderTrendChartSvg, or mountTrendChart): four parties' shares across
 * four general elections.
 * @type {import('./election-trend-chart.mjs').TrendPoint[]}
 */
export const TREND_POINTS_SAMPLE = (() => {
  // The first four parties of the registry's Republic of Ireland palette, and their shares (%) at
  // each election, in that order.
  const parties = [...new Set(partyPalettes.mapRoi.map(([name]) => name))].slice(0, 4);
  /** @type {[string, number[]][]} */
  const elections = [
    ['2011-02-25', [17.4, 36.1, 9.9, 19.5]],
    ['2016-02-26', [24.3, 25.5, 13.8, 6.6]],
    ['2020-02-08', [22.2, 20.9, 24.5, 4.4]],
    ['2024-11-29', [21.9, 20.8, 19.0, 4.6]],
  ];
  return elections.flatMap(([date, shares]) => parties.map((party, i) => ({
    party, share: shares[i], colour: roi(party), entry: { key: `dail|${date}`, body: 'Dáil Éireann', date },
  })));
})();

/**
 * The timeline: its ticks and year labels (packages/map/src/app/timeline/timeline-view.mjs
 * timelineTicksHtml, with `year` as its yearOf) and the list of changes between two editions
 * (timelineChangesPanelHtml).
 */
export const TIMELINE_ITEMS_SAMPLE = ['1921-05-24', '1925-04-03', '1929-05-22', '1933-11-30', '1938-02-09', '1945-06-14', '1949-02-10', '1953-10-22']
  .map((date, i) => ({ date, minor: i % 3 === 2 }));
/** @param {{ date?: unknown }} item */
export const timelineSampleYear = (item) => Number(String(item?.date ?? '').slice(0, 4)) || NaN;
/** @type {import('./app/timeline/timeline-view.mjs').TimelineChangeView} */
export const TIMELINE_CHANGES_SAMPLE = {
  fromLabel: '1973', toLabel: '1985', reversed: false, skipped: 1,
  parts: [{ label: '1973 to 1985', text: '3 areas changed' }],
  changes: [
    { type: 'created', text: 'Carnmoney formed from Newtownabbey', key: 'a:1' },
    { type: 'renamed', text: 'Larne Lough renamed Larne', key: 'a:2' },
    { type: 'transfer', text: '120 ha from Antrim to Ballyclare', key: 'a:3', step: '1977' },
  ],
  note: 'The 1977 review moved several ward boundaries.',
};
