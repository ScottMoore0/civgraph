// The Northern Ireland Assembly: open data services and the registers of members' interests.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

export default definePlugin({
  id: 'ni-assembly-opendata',
  title: 'Northern Ireland Assembly open data and registers of interests',
  kinds: ['interests', 'persons'],
  personalData: { contains: true, handling: 'names-only', note: "Members by name and their registered interests as the Assembly publishes them; no addresses." },
  sources: [
    { id: 'niassembly-open-data', title: 'Northern Ireland Assembly Open Data web services', publisher: 'Northern Ireland Assembly', url: 'https://data.niassembly.gov.uk/', rights: 'OGL', licence: 'Open Government Licence' },
    { id: 'ni-register-of-interests', title: "Northern Ireland Assembly Register of Members' Interests", publisher: 'Northern Ireland Assembly', url: 'https://www.niassembly.gov.uk/', rights: 'OGL', licence: 'Open Government Licence' },
  ],
  steps: {
    harvest: {
      title: "Harvest the Assembly's ASMX services",
      argv: ['node', 'scripts/ingest/ni-assembly-opendata/harvest-niassembly-opendata.mjs'],
      network: true,
    },
    'register-interests': {
      title: 'Build the register source and interest records (data/database/ni-register-*) from the local register PDFs',
      argv: ['node', 'scripts/ingest/ni-assembly-opendata/build-ni-register-interests.mjs'],
      needs: ['tmp/ni-assembly-registers/register-document-inventory.json'],
    },
  },
});
