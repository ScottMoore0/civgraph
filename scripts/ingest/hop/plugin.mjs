// The History of Parliament (Irish Westminster seats from 1801): facts from the local archive,
// the cross-check against Walker, and the links to Civgraph's people. Facts and citations only,
// never the Trust's narrative text (owner permission, 2026-10-01).
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'hop',
  title: 'History of Parliament (Irish seats)',
  kinds: ['elections', 'persons'],
  personalData: { contains: true, handling: 'names-only', note: 'Members by name, with birth and death years as the History of Parliament prints them.' },
  sources: [{ id: 'history-of-parliament', title: 'The History of Parliament: the House of Commons 1790-1820, 1820-1832 and 1832-1868', publisher: 'The History of Parliament Trust', url: 'https://www.historyofparliamentonline.org/', rights: 'owner-permission', note: 'Facts with citations only; the narrative text is never copied.' }],
  inputs: {
    archive: { env: 'HOP_ARCHIVE', description: 'the local archive.sqlite of History of Parliament Online pages' },
    savedPages: { description: 'folder of pages saved by hand from a browser' },
    urls: { description: 'list of the URLs the saved pages came from' },
  },
  steps: {
    extract: {
      title: 'Extract the Irish constituency and member facts into data/elections/hop/',
      argv: ['python', 'scripts/ingest/hop/extract_hop_ireland.py', '--archive', '{input:archive}'],
    },
    crosscheck: {
      title: 'Pair the HoP contests of 1801-1832 with Walker\'s (data/elections/hop/hop-crosscheck-1801-1832.json)',
      argv: ['python', 'scripts/ingest/hop/crosscheck_hop_1801_1832.py'],
    },
    'link-members': {
      title: 'Link the HoP members to Civgraph person ids (run after the person-id rebuild)',
      argv: ['python', 'scripts/ingest/hop/link_hop_members.py'],
    },
    'saved-pages': {
      title: 'Add pages saved by hand in a browser to the local archive (writes the archive, outside the repository)',
      argv: ['python', 'scripts/ingest/hop/ingest_saved_pages.py', '--archive', '{input:archive}', '--urls', '{input:urls}', '{input:savedPages}'],
    },
  },
  helpers: ['hop_overlay.py'],
  note: 'Order: extract, crosscheck, then walker import-1801-1831 (which reads hop_overlay.py), the person-id rebuild, then link-members.',
});
