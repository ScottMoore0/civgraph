// The former 26 Northern Ireland councils' websites, as archived by the Internet Archive.
import { definePlugin } from '../../intake/lib/plugins.mjs';

export default definePlugin({
  id: 'council-websites',
  title: 'Former NI council websites (statements of persons nominated)',
  kinds: ['elections'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidate and agent names; addresses are never taken into the repository.' },
  sources: [{ id: 'ni-26-council-websites', title: 'Websites of the 26 Northern Ireland district councils (1973-2015), Wayback Machine captures', publisher: 'Internet Archive', url: 'https://web.archive.org/', rights: 'facts-with-citation' }],
  steps: {
    scrape: {
      title: 'Find and download the 2005-2014 SPN and agent documents from Wayback captures',
      argv: ['python', 'scripts/ingest/council-websites/scrape_26_councils.py'],
      network: true,
    },
  },
});
