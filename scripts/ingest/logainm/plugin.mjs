// Irish place names from the Placenames Database of Ireland (Logainm) API, for the Irish
// place-name fields. The script stays in scripts/i18n/ beside the crosswalk it reads.
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'logainm',
  title: 'Logainm Irish place names',
  kinds: ['research-only'],
  personalData: { contains: false, handling: 'none' },
  sources: [{
    id: 'logainm', title: 'The Placenames Database of Ireland (Logainm) API', publisher: 'Government of Ireland (the Placenames Branch, with Fiontar & Scoil na Gaeilge, DCU)',
    url: 'https://www.logainm.ie/', rights: 'CC-BY', licence: 'CC BY 4.0 (names, ids and categories only; the notes and citations are not, and are never kept)',
  }],
  inputs: {
    cache: { env: 'CIVGRAPH_I18N_CACHE', default: 'tmp/i18n-cache', description: 'the i18n cache: place-name-crosswalk.tsv in, logainm-cache/ and logainm-names.tsv out' },
  },
  steps: {
    names: {
      title: 'Record the current Logainm Irish name of each crosswalk id (LOGAINM_API_KEY; one request a second, every answer cached)',
      argv: ['node', 'scripts/i18n/fetch-logainm.mjs', '--cache', '{input:cache}'],
      outputs: ['tmp/i18n-cache/logainm-names.tsv', 'tmp/i18n-cache/logainm-cache/'],
      needs: ['tmp/i18n-cache/place-name-crosswalk.tsv'],
      network: true,
      note: 'Fetches only ids not yet cached, so `intake parity logainm --offline` replays it from the cache. The outputs are the default cache; with --input cache=<elsewhere> they fall outside the repository and a run captures nothing. Without LOGAINM_API_KEY (the owner registers for it) the script stops before any request.',
    },
  },
  note: 'Nothing here is published: the names are checked against the boundary data\'s GAEILGE fields, which scripts/i18n/build-place-name-fields.mjs builds.',
});
