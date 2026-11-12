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
