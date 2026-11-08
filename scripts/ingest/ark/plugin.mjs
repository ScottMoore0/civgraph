// The ARK (Access Research Knowledge) Northern Ireland local government election results: the
// ARK spreadsheets (1985-2005) to the per-DEA election JSON.
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'ark',
  title: 'ARK Northern Ireland local government elections',
  kinds: ['elections'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidate names and results only.' },
  sources: [{ id: 'ark-elections', title: 'ARK Northern Ireland Elections: local government results spreadsheets', publisher: "ARK (Queen's University Belfast and Ulster University)", url: 'https://www.ark.ac.uk/elections/', rights: 'facts-with-citation' }],
  steps: {
    'election-json': {
      title: "Convert one year's ARK XLS files into data/elections-source local-government JSON (give YEAR [DATE] after --)",
      argv: ['python', 'scripts/ingest/ark/ark_to_election_json.py'],
      needs: ['_tmp_xls2rar_extract/xls/lgov'],
    },
  },
  research: ['convert_old26_to_markdown.py'],
  note: 'convert_old26_to_markdown.py turns the EONI SPN and agent documents into markdown under _tmp_gazette_markdown/ for reading; it writes nothing the site uses.',
});
