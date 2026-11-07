// data.gov.ie (Open Data Portal Ireland): the mirror, its licences and the catalogue records.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

export default definePlugin({
  id: 'datagovie',
  title: 'data.gov.ie mirror, licences and catalogue records',
  kinds: ['catalogue', 'sources'],
  personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'datagovie', title: 'Open Data Portal Ireland (data.gov.ie)', publisher: 'Government of Ireland', url: 'https://data.gov.ie/', rights: 'CC-BY', licence: 'CC BY 4.0 unless the package says otherwise (see data/external/datagovie-licences.json)' }],
  inputs: { harvest: { description: 'the CKAN harvest JSON the catalogue records are emitted from' } },
  steps: {
    mirror: {
      title: 'Mirror the selected resources to the local data.gov.ie mirror folder (outside the repository)',
      argv: ['python', 'scripts/ingest/datagovie/mirror_datagovie.py'],
      network: true,
    },
    licences: {
      title: "Establish each mirrored package's licence (data/external/datagovie-licences.json and the summary)",
      argv: ['node', 'scripts/ingest/datagovie/harvest-datagovie-licences.mjs'],
      network: true,
    },
    'catalogue-records': {
      title: 'Emit the approved catalogue records for data.gov.ie datasets not yet on Civgraph',
      argv: ['node', 'scripts/ingest/datagovie/emit-datagovie-catalogue-records.mjs', '{input:harvest}'],
      outputs: ['data/census/candidates/datagovie-catalogue.approved.json'],
    },
  },
});
