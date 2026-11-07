// Wikipedia and Wikidata: NI local, Stormont and referendum results, party colours and facts,
// the Dail count sheets, and the sources Wikipedia cites.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

const WP = 'scripts/ingest/wikipedia';

export default definePlugin({
  id: 'wikipedia',
  title: 'Wikipedia and Wikidata election and party data',
  kinds: ['elections', 'parties'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidates and party leaders by name, with results.' },
  sources: [
    { id: 'wikipedia', title: 'Wikipedia election, party and referendum articles', publisher: 'Wikimedia Foundation', url: 'https://en.wikipedia.org/', rights: 'CC-BY-SA', licence: 'CC BY-SA 4.0' },
    { id: 'wikidata', title: 'Wikidata', publisher: 'Wikimedia Foundation', url: 'https://www.wikidata.org/', rights: 'public-domain', licence: 'CC0' },
  ],
  steps: {
    'stormont': { title: 'Stormont general election results from the constituency articles', argv: ['python', `${WP}/scrape_stormont_wikipedia.py`], network: true },
    'old-lgov': { title: 'NI local council elections 1973-2005 (the 26-council system)', argv: ['python', `${WP}/scrape_old_lgov_wikipedia.py`], network: true },
    'modern-lgov-compare': { title: 'Fetch the 2014-2023 local election wikitext and compare party labels with the LGOV export', argv: ['python', `${WP}/scrape_and_compare_lgov_wikipedia.py`], network: true },
    referendums: { title: 'Per-constituency results of the Irish constitutional referendums', argv: ['python', `${WP}/scrape_wiki_referendums.py`], network: true },
    'party-colours': { title: 'Party colours from the Wikipedia colour modules', argv: ['python', `${WP}/extract-wikipedia-party-colours.py`], network: true },
    'party-wikidata': { title: 'Match the parties to Wikidata and keep the profile facts', argv: ['node', `${WP}/fetch-party-wikidata.mjs`], network: true },
    'dail-counts': { title: 'Dail count sheets from Wikipedia into data/elections/dail-wikipedia-counts', argv: ['node', `${WP}/import-dail-wikipedia-counts.mjs`], network: true },
    categories: { title: 'Harvest every page under a set of Wikipedia categories', argv: ['python', `${WP}/harvest_wikipedia_categories.py`], network: true },
    'cited-sources': { title: 'Extract and fetch the sources the harvested articles cite', argv: ['python', `${WP}/harvest_wikipedia_cited_sources.py`], network: true },
    'stv-workbook': { title: 'Build the STV ElectionResults / Transfers workbooks from raw spreadsheets', argv: ['python', `${WP}/build_stv_workbook.py`] },
  },
  helpers: ['modern_lgov_wikipedia_common.py'],
});
