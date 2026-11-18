// ElectionsIreland.org: Dail and local election results (through Wayback captures) and the
// candidate ids the site publishes.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

export default definePlugin({
  id: 'electionsireland',
  title: 'ElectionsIreland.org results and candidate ids',
  kinds: ['elections', 'persons'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidate names, results and the site\'s candidate ids.' },
  sources: [{ id: 'electionsireland', title: 'ElectionsIreland.org', publisher: 'ElectionsIreland.org', url: 'https://electionsireland.org/', rights: 'facts-with-citation', note: 'Fetched through Wayback Machine captures.' }],
  steps: {
    'dail-recent': { title: 'Dail elections 2002-2024 into data/elections-source', argv: ['python', 'scripts/ingest/electionsireland/scrape_ei_dail.py'], network: true },
    'dail-old': { title: 'Dail elections 1918-1992 into data/elections-source', argv: ['python', 'scripts/ingest/electionsireland/scrape_ei_dail_old.py'], network: true },
    local: { title: 'Local elections 1979-2024 into data/elections-source/data/elections/ireland-local', argv: ['python', 'scripts/ingest/electionsireland/scrape_ei_local.py'], network: true },
    'candidate-ids': {
      title: 'Recover the per-person candidate ids (sourcePersonId) and, with --relatives, the relatives pages',
      argv: ['python', 'scripts/ingest/electionsireland/harvest_ei_candidate_ids.py'],
      network: true,
      note: 'Part of the person-id rebuild order (memory note project_ei_person_ids.md).',
    },
  },
});
