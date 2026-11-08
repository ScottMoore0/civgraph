// Facts about people, parties and offices: the Elliott & Flackes (1999) directory extraction and
// the Wikidata links for non-candidate persons.
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'facts',
  title: 'Elliott & Flackes facts and non-candidate person links',
  kinds: ['persons', 'parties'],
  personalData: { contains: true, handling: 'names-only', note: 'Names, offices, parties and dates; birth and death years from Wikidata.' },
  sources: [
    { id: 'elliott-flackes-1999', title: 'Sydney Elliott and W. D. Flackes, Northern Ireland: A Political Directory 1968-1999 (Blackstaff, 1999)', rights: 'facts-with-citation', note: 'Names, offices, parties and dates only, each cited to its page; no text is copied.' },
    { id: 'wikidata', title: 'Wikidata', publisher: 'Wikimedia Foundation', url: 'https://www.wikidata.org/', rights: 'public-domain', licence: 'CC0' },
  ],
  inputs: {
    facts: { env: 'CIVGRAPH_EF_FACTS', description: 'the staged extraction (facts.jsonl)' },
    unmapped: { env: 'CIVGRAPH_FACTS_UNMAPPED', description: 'where the unmapped office strings are written for review' },
  },
  steps: {
    'elliott-flackes': {
      title: 'Load the offices, tenures, party events and affiliations (data/offices, data/elections/persons, data/elections/parties)',
      argv: ['python', 'scripts/ingest/facts/import_elliott_flackes_facts.py', '--facts', '{input:facts}', '--unmapped', '{input:unmapped}', '--write'],
    },
    'noncandidate-wikidata': {
      title: 'Attach Wikidata and UK Parliament ids to the non-candidate persons',
      argv: ['python', 'scripts/ingest/facts/link_noncandidates_wikidata.py', '--write'],
      network: true,
    },
  },
  helpers: ['ef_offices.py'],
});
