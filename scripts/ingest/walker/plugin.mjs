// B. M. Walker's Parliamentary Election Results in Ireland (1801-1922, 1918-92), Michael
// Gallagher's Irish Elections 1922-44, and the Wikipedia election boxes and lists they are
// checked against. Scans are read from WALKER_DIR (with TESSERACT_CMD for OCR), set in the
// environment as the scripts have always read them.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

const W = 'scripts/ingest/walker';

export default definePlugin({
  id: 'walker',
  title: 'Walker and Gallagher election results, with the Wikipedia checks',
  kinds: ['elections', 'persons'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidates and members by name, with results.' },
  sources: [
    { id: 'walker-1801-1922', title: 'B. M. Walker, Parliamentary Election Results in Ireland, 1801-1922 (Royal Irish Academy, 1978)', rights: 'facts-with-citation' },
    { id: 'walker-1918-92', title: 'B. M. Walker, Parliamentary Election Results in Ireland, 1918-92 (Royal Irish Academy, 1992)', rights: 'facts-with-citation' },
    { id: 'gallagher-1922-44', title: 'Michael Gallagher, Irish Elections 1922-44: Results and Analysis (PSAI Press, 1993)', rights: 'facts-with-citation' },
    { id: 'wikipedia', title: 'Wikipedia election and constituency articles', publisher: 'Wikimedia Foundation', url: 'https://en.wikipedia.org/', rights: 'CC-BY-SA', licence: 'CC BY-SA 4.0' },
  ],
  inputs: {
    gallagherPdf: { description: 'the Gallagher 1922-44 PDF' },
    articles: { description: 'the constituency article list JSON' },
  },
  steps: {
    // Walker's scans (OCR, local).
    'pre1885': { title: 'Harvest the 1802-1880 elections from Walker', argv: ['python', `${W}/harvest_pre1885.py`] },
    'constituency-section': { title: 'Harvest the constituency section of the 1801-1922 volume (give --pages after --)', argv: ['python', `${W}/harvest_constituency_section.py`] },
    byelections: { title: 'Harvest the 1885-1922 by-election tables', argv: ['python', `${W}/harvest_byelections.py`] },
    electorates: { title: 'Harvest the pre-1918 elector counts (give --pages and --out after --)', argv: ['python', `${W}/harvest_electorates.py`] },
    'record-verified': { title: 'Record which contests were checked against Walker and agreed', argv: ['python', `${W}/record_verified.py`] },
    'check-civgraph': { title: 'Compare Civgraph\'s figures with Walker\'s printed tables (give --volume and --pages after --)', argv: ['python', `${W}/check_against_civgraph.py`] },
    'import-1801-1831': { title: 'Import the 1801-1831 results read from Walker (with the HoP overlay)', argv: ['python', `${W}/import_walker_1801_1831.py`, '--write'] },
    'crosscheck-1801-1831': { title: 'Check the 1801-1831 results against Wikipedia', argv: ['python', `${W}/crosscheck_walker_1801_1831.py`] },
    // Gallagher.
    gallagher: { title: 'Harvest Gallagher 1922-44 into Civgraph', argv: ['python', `${W}/harvest_gallagher.py`, '{input:gallagherPdf}'] },
    'gallagher-ge': { title: 'Gallagher\'s general-election tables compared with Civgraph (a review deliverable)', argv: ['python', `${W}/harvest_gallagher_ge.py`] },
    'crosscheck-gallagher-byelections': { title: 'Check Gallagher\'s by-elections against ElectionsIreland and Wikipedia', argv: ['python', `${W}/crosscheck_gallagher_byelections.py`, '--write'], network: true },
    // Wikipedia: harvests (network) and the local checks and imports.
    'wikipedia-elections': { title: 'Harvest the Wikipedia UK general election articles for Ireland', argv: ['python', `${W}/harvest_wikipedia_elections.py`], network: true },
    'wikipedia-full': { title: 'Harvest everything usable from those articles', argv: ['python', `${W}/harvest_wikipedia_full.py`], network: true },
    'wikipedia-mp-lists': { title: 'Harvest the Irish seats from the lists of MPs elected, 1802-1918', argv: ['python', `${W}/harvest_wikipedia_mp_lists.py`], network: true },
    'wikipedia-constituency-boxes': { title: 'Harvest the constituency articles\' election boxes, 1832-1922', argv: ['python', `${W}/harvest_wikipedia_constituency_boxes.py`, '{input:articles}'], network: true },
    'wikipedia-byelection-lists': { title: 'Harvest the Irish rows of the UK by-election lists, 1832-1922', argv: ['python', `${W}/harvest_wikipedia_byelection_lists.py`], network: true },
    'wikipedia-byelection-lists-pre1832': { title: 'Harvest the Irish rows of the UK by-election lists, 1801-1831', argv: ['python', `${W}/harvest_wikipedia_byelection_lists_pre1832.py`], network: true },
    'wikipedia-member-links-pre1832': { title: 'Harvest the Wikipedia article each 1801-1831 member links to', argv: ['python', `${W}/harvest_wikipedia_member_links_pre1832.py`], network: true },
    'crosscheck-constituency-boxes': { title: 'Check the constituency boxes against Walker and the MP lists', argv: ['python', `${W}/crosscheck_constituency_boxes.py`] },
    'crosscheck-byelection-boxes': { title: 'Pair each by-election on the lists with its constituency box and check it', argv: ['python', `${W}/crosscheck_byelection_boxes.py`] },
    'crosscheck-wikipedia-members': { title: 'Check the 1802-1880 winners against the MP lists', argv: ['python', `${W}/crosscheck_wikipedia_members.py`] },
    'import-wikipedia-boxes': { title: 'Import the cross-checked Wikipedia boxes as source files', argv: ['python', `${W}/import_wikipedia_boxes.py`, '--write'] },
    'stamp-wikipedia-person-ids': { title: 'Give each 1832-1922 candidacy its Wikipedia article as source person id', argv: ['python', `${W}/stamp_wikipedia_person_ids.py`, '--write'] },
  },
  helpers: ['extract.py', 'gallagher.py', 'wiki_tables.py'],
  research: ['spot_check.py'],
  data: ['README.md'],
});
