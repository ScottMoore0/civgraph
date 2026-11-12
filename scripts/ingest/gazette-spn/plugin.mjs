// The Belfast Gazette (every issue, crawled into a local data folder outside the repository) and
// the statements of persons nominated: notices extracted, checked against Civgraph, and the
// committed records they feed (election extras, reference names, checked sources).
import { DEFAULT_BUILD_DIR } from '../../../packages/config/src/node.mjs';
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'gazette-spn',
  title: 'Belfast Gazette notices and statements of persons nominated',
  kinds: ['elections', 'persons', 'sources'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidates, members and agents by name; addresses stay in the Gazette data folder and never reach the repository.' },
  sources: [
    { id: 'belfast-gazette', title: 'The Belfast Gazette, 1921 onwards', publisher: 'The Stationery Office (The Gazette)', url: 'https://www.thegazette.co.uk/Belfast', rights: 'OGL', licence: 'Open Government Licence' },
    { id: 'spn-notices', title: 'Statements of persons nominated, as printed in newspapers and on council websites', rights: 'facts-with-citation' },
  ],
  inputs: {
    gazetteDir: { env: 'CIVGRAPH_GAZETTE_DIR', description: 'the Gazette data folder (gazette.sqlite, issue PDFs, extracted/)' },
  },
  steps: {
    crawl: {
      title: 'Download every Belfast Gazette issue PDF and index its text (10 s crawl delay, resumable)',
      argv: ['python', 'scripts/ingest/gazette-spn/crawl_belfast_gazette.py', '--out', '{input:gazetteDir}'],
      network: true,
    },
    'extract-elections': {
      title: 'Parse the election notices and check them against Civgraph (writes <gazette>/extracted)',
      argv: ['python', 'scripts/ingest/gazette-spn/extract_election_notices.py', '--dir', '{input:gazetteDir}'],
    },
    'extract-boundaries': {
      title: 'Find the administrative boundary notices and propose maps.json references (writes <gazette>/extracted)',
      argv: ['python', 'scripts/ingest/gazette-spn/extract_boundary_notices.py', '--db', '{input:gazetteDir}/gazette.sqlite', '--out', '{input:gazetteDir}/extracted'],
    },
    'extract-polling': {
      title: 'Extract polling districts, places and stations (writes <gazette>/extracted)',
      argv: ['python', 'scripts/ingest/gazette-spn/extract_polling_notices.py', '--dir', '{input:gazetteDir}'],
    },
    'extract-expenses': {
      title: 'Extract the election expenses notices (writes <gazette>/extracted)',
      argv: ['python', 'scripts/ingest/gazette-spn/extract_expenses_notices.py', '--dir', '{input:gazetteDir}'],
    },
    'election-extras': {
      title: 'Turn the polling and expenses notices into the committed Browse election extras',
      argv: ['python', 'scripts/ingest/gazette-spn/build_gazette_election_extras.py', '--gazette', '{input:gazetteDir}'],
      needs: [`${DEFAULT_BUILD_DIR}/elections-test2.json`],
    },
    'reference-names': {
      title: 'Record the formal names the Gazette prints (data/elections/persons/reference-names.json)',
      argv: ['python', 'scripts/ingest/gazette-spn/build_reference_names.py', '--proposals', '{input:gazetteDir}/extracted/election-fix-proposals.json'],
    },
    provenance: {
      title: 'Record the Gazette\'s lists of members returned as checked sources (web-checked-sources.json)',
      argv: ['python', 'scripts/ingest/gazette-spn/record_gazette_provenance.py', '--gazette', '{input:gazetteDir}'],
    },
    'spns-2019': {
      title: 'Download the 2019 local government SPNs the search agent found',
      argv: ['python', 'scripts/ingest/gazette-spn/download_2019_spns.py'],
      network: true,
    },
  },
  helpers: ['civgraph_elections.py', 'gazette_crosscheck.py', 'gazette_notice_common.py'],
  research: ['crop-spn-region.py', 'reocr-spn-columns.py'],
  note: 'Order: crawl, the four extractors, then election-extras, reference-names and provenance (the three that write the repository).',
});
