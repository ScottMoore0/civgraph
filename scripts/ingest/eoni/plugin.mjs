// The Electoral Office for Northern Ireland's statements of persons nominated and agent notices:
// only a coverage survey lives here.
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'eoni',
  title: 'Electoral Office for Northern Ireland notices (coverage survey)',
  kinds: ['research-only'],
  personalData: { contains: true, handling: 'names-only', note: 'The survey reads candidate and agent names; it writes only _tmp_eoni_pdf_analysis.json at the repository root, which is gitignored.' },
  sources: [{ id: 'eoni-notices', title: 'EONI statements of persons nominated and notices of election agents', publisher: 'Electoral Office for Northern Ireland', url: 'https://www.eoni.org.uk/', rights: 'facts-with-citation' }],
  research: ['parse_eoni_pdfs.py'],
});
