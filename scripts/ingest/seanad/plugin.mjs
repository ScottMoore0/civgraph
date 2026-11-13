// Seanad Eireann: the general elections' panel and university counts (IrelandElection.com's parsed
// contests), each winner joined to the Houses of the Oireachtas member list of that Seanad.
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'seanad',
  title: 'Seanad Eireann general elections',
  kinds: ['elections', 'persons'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidates and senators by name, with their counts and official member codes.' },
  sources: [
    { id: 'oireachtas-open-data', title: 'Houses of the Oireachtas Open Data API: houses and members', publisher: 'Houses of the Oireachtas', url: 'https://api.oireachtas.ie/', rights: 'CC-BY', licence: 'Oireachtas (Open Data) PSI Licence (CC BY 4.0)' },
    { id: 'irelandelection', title: 'IrelandElection.com Seanad election results', publisher: 'IrelandElection.com', url: 'https://irelandelection.com/', rights: 'facts-with-citation', note: 'Read from the parsed copy of an earlier crawl, kept outside the repository (input ieDir).' },
    { id: 'wikipedia', title: 'Wikipedia articles on each Seanad and its election', publisher: 'Wikimedia Foundation', url: 'https://en.wikipedia.org/', rights: 'CC-BY-SA', licence: 'CC BY-SA 4.0' },
  ],
  inputs: { ieDir: { env: 'CIVGRAPH_IRELANDELECTION_DIR', description: "IrelandElection.com's parsed contests (the folder holding index.jsonl and contests/), kept outside the repository" } },
  steps: {
    harvest: {
      title: 'Fetch the Seanad terms and members (Oireachtas API) and the Seanad articles (Wikipedia) into .cache/seanad/',
      argv: ['python', 'scripts/ingest/seanad/harvest_seanad.py'],
      network: true,
    },
    build: {
      title: 'Write the seanad-eireann election files, its elections index entry and the winners\' Oireachtas member codes',
      argv: ['python', 'scripts/ingest/seanad/build_seanad.py', '--ie', '{input:ieDir}'],
      note: 'Then the person-id rebuild order (memory note project_ei_person_ids.md) and the records build.',
    },
  },
});
