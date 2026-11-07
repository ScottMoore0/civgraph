// The British Newspaper Archive (election notices searched with the owner's permission), and
// the thumbnail renderers kept beside it.
import { definePlugin } from '../../intake/lib/plugins.mjs';

export default definePlugin({
  id: 'bna',
  title: 'British Newspaper Archive notices and catalogue thumbnails',
  kinds: ['elections', 'catalogue'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidate names from nomination notices; facts and citations, never reproduction.' },
  sources: [
    { id: 'bna', title: 'The British Newspaper Archive', publisher: 'Findmypast / The British Library', url: 'https://www.britishnewspaperarchive.co.uk/', rights: 'owner-permission', note: 'Owner permission 2026-10-31: search and cite freely; facts and citations only, no reproduction.' },
    { id: 'civgraph-catalogue', title: "Civgraph's own catalogue maps and books (thumbnail sources)", rights: 'facts-with-citation' },
  ],
  steps: {
    scrape: {
      title: 'Search the BNA for nomination notices around known election dates (logged-in Playwright session; writes _tmp_bna/)',
      argv: ['python', 'scripts/ingest/bna/scrape_bna.py'],
      network: true,
    },
    'book-thumbnails': {
      title: 'Give every catalogue book a thumbnail (first PDF page, or a title cover)',
      argv: ['python', 'scripts/ingest/bna/render-book-thumbnails.py'],
      network: true,
    },
    'catalogue-thumbnails': {
      title: 'Render a thumbnail for every catalogue map that has none, from what the site draws',
      argv: ['python', 'scripts/ingest/bna/render-catalogue-thumbnails.py'],
      network: true,
    },
  },
  data: ['bna_election_searches.json'],
});
