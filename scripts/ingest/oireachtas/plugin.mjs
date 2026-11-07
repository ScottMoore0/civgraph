// The Houses of the Oireachtas: the open-data API harvest and the official Dail election archive.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

export default definePlugin({
  id: 'oireachtas',
  title: 'Houses of the Oireachtas open data and Dail election results',
  kinds: ['elections', 'persons'],
  personalData: { contains: true, handling: 'names-only', note: 'Members and candidates by name only.' },
  sources: [
    { id: 'oireachtas-open-data', title: 'Houses of the Oireachtas Open Data API', publisher: 'Houses of the Oireachtas', url: 'https://api.oireachtas.ie/', rights: 'CC-BY', licence: 'Oireachtas (Open Data) PSI Licence (CC BY 4.0)' },
    { id: 'dail-official-results', title: 'Dail election results, official archive', publisher: 'Houses of the Oireachtas', rights: 'facts-with-citation' },
  ],
  inputs: { harvestDir: { description: 'folder for the raw API harvest (outside the repository)' } },
  steps: {
    harvest: {
      title: 'Harvest the Oireachtas API endpoints into a local folder',
      argv: ['node', 'scripts/ingest/oireachtas/harvest-oireachtas-opendata.mjs', '--out', '{input:harvestDir}'],
      network: true,
    },
    'dail-official': {
      title: 'Import the official Dail election archive into data/elections/dail-official-results.json and missing by-election stubs',
      argv: ['python', 'scripts/ingest/oireachtas/import-dail-official-zip.py'],
      network: true,
    },
  },
});
