/**
 * The Elections app's components for the component gallery (/design-system/, packages/ui/src/
 * gallery/route.js APP_SPECIMENS): the app's own chart functions (lib/charts.js) and party chips
 * (lib/party.js), drawn with sample data into the gallery's frame for them, which has the app's stylesheet.
 * Nothing on the app's pages loads this module.
 */
import { hbars, parliamentArc, quotaBars, seatBar, transferFlow } from './lib/charts.js';
import { partyChip } from './lib/party.js';
/**
 * The gallery's sample colours (data/registries/colours.json gallery.specimens, passed in by the
 * gallery page), so no real party is shown with made-up figures.
 * @typedef {{ partyOne: string, partyTwo: string, other: string }} SampleColours
 */

/** @type {Record<string, (sample: SampleColours) => string>} */
const DRAW = {
  'elections-seats': (sample) => {
    const { one, two, three } = parties(sample);
    const chamber = [{ ...one, seats: 38 }, { ...two, seats: 27 }, { ...three, seats: 15 }];
    return `<div class="el-grid"><figure class="cg-chart el-seatchart">${parliamentArc(chamber, { title: 'Sample chamber: 80 seats' })}<figcaption>Parliament arc (30 seats or more)</figcaption></figure>`
      + `<figure class="cg-chart">${seatBar([{ ...one, seats: 9 }, { ...two, seats: 6 }, { ...three, seats: 3 }], { title: 'Sample council: 18 seats' })}<figcaption>Seat bar (fewer seats)</figcaption></figure></div>`;
  },
  'elections-shares': (sample) => `<figure class="cg-chart">${hbars([
    { label: 'Party one', value: 41230, colour: sample.partyOne },
    { label: 'Party two', value: 30112, colour: sample.partyTwo },
    { label: 'Party three', value: 9876 },
  ], { title: 'Sample first-preference votes' })}<figcaption>Bars</figcaption></figure>`,
  'elections-count': (sample) => {
    const { one, two } = parties(sample);
    const quota = 6001;
    const rows = [
      { name: 'Candidate A', colour: one.colour, first: 7012, total: 7012, ratio: 7012 / quota, elected: true },
      { name: 'Candidate B', colour: two.colour, first: 5210, total: 6001, ratio: 1, elected: true },
      { name: 'Candidate C', first: 3120, total: 4380, ratio: 4380 / quota, elected: false },
    ];
    const flow = { stage: 2, kind: 'surplus', from: [{ name: 'Candidate A', colour: one.colour, amount: 1011 }],
      to: [{ name: 'Candidate B', colour: two.colour, amount: 640 }, { name: 'Candidate C', amount: 301 }], nonTransferable: 70, distributed: 1011 };
    return `<figure class="cg-chart">${quotaBars(rows, quota)}<figcaption>Progress to the quota</figcaption></figure>`
      + `<figure class="cg-chart">${transferFlow(flow)}<figcaption>A count's transfers</figcaption></figure>`;
  },
  'elections-chips': (sample) => `<p>${partyChip('Party one', sample.partyOne)} ${partyChip('Party two', sample.partyTwo)} ${partyChip('Independent', null)}</p>`,
};

/** Three sample parties; the third has no colour (the app's neutral fallback). @param {SampleColours} sample */
function parties(sample) {
  return { one: { party: 'Party one', colour: sample.partyOne }, two: { party: 'Party two', colour: sample.partyTwo }, three: { party: 'Party three', colour: '' } };
}

export const SPECIMEN_NAMES = Object.freeze(Object.keys(DRAW));

/**
 * Draw one specimen into `root` (the #specimen element of the gallery's frame).
 * @param {string} name
 * @param {HTMLElement} root
 * @param {SampleColours} sample
 */
export function drawSpecimen(name, root, sample) {
  const draw = DRAW[name];
  if (!draw) throw new Error(`no Elections specimen ${name}`);
  root.innerHTML = draw(sample);
}
