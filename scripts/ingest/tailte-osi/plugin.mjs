// Tailte Eireann / Ordnance Survey boundary derivations: the 1920s NI DED files and the county
// electoral divisions drawn from them.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

const ED = 'data/maps/electoral-divisions';
const CACHE = 'render/source-cache/vector-intake';

export default definePlugin({
  id: 'tailte-osi',
  title: 'NI DED and county electoral division derivations',
  kinds: ['maps'],
  personalData: { contains: false, handling: 'none' },
  sources: [
    { id: 'civgraph-deds-1920s', title: "Civgraph's 1920s Northern Ireland DED layers (deds-ni-1926, ded-1930-04-01)", rights: 'CC-BY', licence: 'CC BY 4.0 (from Tailte Eireann / OSi electoral divisions)' },
    { id: 'belfast-gazette-128', title: 'Belfast Gazette issue 128, 7 Dec 1923, pp. 536-540 (county electoral division orders)', publisher: 'The Belfast Gazette', url: 'https://www.thegazette.co.uk/Belfast/issue/128', rights: 'OGL', licence: 'Open Government Licence' },
    { id: 'census-ni-1926', title: 'Census of Northern Ireland 1926, Topographical Index and General Report', publisher: 'HMSO Belfast', rights: 'facts-with-citation' },
  ],
  inputs: { srcDir: { default: ED, description: 'folder holding the published DED files' } },
  steps: {
    'newcastle-merge': {
      title: 'Merge Newcastle North and South into one DED in the 1920s NI DED files and their LODs',
      argv: ['python', 'scripts/ingest/tailte-osi/ni_deds_newcastle_merge.py', '--src-dir', '{input:srcDir}'],
      outputs: [`${ED}/NorthernIrelandDEDs1926.fgb`, `${ED}/NorthernIrelandDEDs1926-lod0.fgb`, `${ED}/NorthernIrelandDEDs1926-lod1.fgb`, `${ED}/NI_DEDs_1930.fgb`, `${ED}/NI_DEDs_1930-lod0.fgb`, `${ED}/NI_DEDs_1930-lod1.fgb`, `${CACHE}/deds-ni-1926.fgb`, `${CACHE}/ded-1930-04-01.fgb`],
      needs: [`${ED}/NI_DEDs_1930.fgb`],
    },
    'county-eds-1924': {
      title: 'Draw the county electoral divisions of the December 1923 schemes from the 1930 DEDs',
      argv: ['python', 'scripts/ingest/tailte-osi/ni_county_eds_1924.py'],
      outputs: [`${ED}/NI_County_Electoral_Divisions_1924-06-20.fgb`, `${CACHE}/county-ed-1924-06-20.fgb`],
      needs: [`${ED}/NI_DEDs_1930.fgb`, 'data/maps/local-government/Admin_Areas_01-04-1930.fgb'],
    },
  },
});
