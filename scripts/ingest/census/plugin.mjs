// The censuses (NISRA and its predecessors, the CSO) and the statistics catalogues beside them:
// the parsed historic tables, the cleaned 2001 and 2011 builds, the Census Explorer bundle, the
// approved-publication gate records, and the Internet Archive mirrors.
import { definePlugin } from '../../intake/lib/plugins.mjs';

const DERIVED = 'data/census/derived/';
const INVENTORY = 'data/census/source-inventory/';
const CANDIDATES = 'data/census/candidates/';

export default definePlugin({
  id: 'census',
  title: 'Censuses and statistics catalogues (NISRA, CSO, OpenDataNI)',
  kinds: ['census', 'catalogue', 'sources'],
  personalData: { contains: false, handling: 'none', note: 'Aggregate statistics only.' },
  sources: [
    { id: 'nisra-census', title: 'Census of Northern Ireland, 1926-2021 (reports, tables and small-area statistics)', publisher: 'NISRA and HMSO Belfast', url: 'https://www.nisra.gov.uk/', rights: 'OGL', licence: 'Open Government Licence' },
    { id: 'cso-census', title: 'Census of Ireland reports and PxStat tables', publisher: 'Central Statistics Office', url: 'https://www.cso.ie/', rights: 'CC-BY', licence: 'CC BY 4.0' },
    { id: 'nisra-publications', title: 'NISRA statistical publications', publisher: 'NISRA', url: 'https://www.nisra.gov.uk/publications', rights: 'OGL', licence: 'Open Government Licence' },
    { id: 'opendatani', title: 'Open Data NI datasets', publisher: 'OpenDataNI', url: 'https://www.opendatani.gov.uk/', rights: 'OGL', licence: 'Open Government Licence' },
  ],
  inputs: {
    candidates: { description: 'a census candidate file for merge-pilot' },
    harvest: { description: 'a harvest JSON for the catalogue emitters' },
  },
  steps: {
    // Parsed historic tables (local OCR markdown into data/census/derived/).
    'religion-1971': { title: '1971 religion counts from the printed County Reports', argv: ['python', 'scripts/ingest/census/parse_1971_religion.py'], outputs: [DERIVED], needs: ['data/census/census-1971.md'] },
    'table8a-1981': { title: '1981 Table 8A: the "other and not stated" decomposition', argv: ['python', 'scripts/ingest/census/parse_1981_table8a.py'], outputs: [DERIVED], needs: ['data/census/census-1981.md'] },
    'wards-1981': { title: '1981 ward populations from the Preliminary Report', argv: ['python', 'scripts/ingest/census/parse_1981_wards.py'], outputs: [DERIVED], needs: ['data/census/census-1981.md'] },
    'religion-1991-lgd': { title: '1991 religion by the 26 districts (Religion Report Table 2)', argv: ['python', 'scripts/ingest/census/parse_1991_religion_lgd.py'], outputs: [DERIVED], needs: ['data/census/1991/1991-census-religion-report.md'] },
    'religion-common-basis': { title: '1971, 1981 and 1991 Catholic share on one basis', argv: ['python', 'scripts/ingest/census/build_religion_common_basis.py'], outputs: [DERIVED] },
    'sas-1991-dz': { title: 'The full 1991 small-area statistics on the data-zone frame (give the crosswalk folder after --)', argv: ['python', 'scripts/ingest/census/build_1991_sas_dz_frame.py'], outputs: [DERIVED], needs: ['data/census/1991/sas/sas91ni_wards_full.csv.gz'] },
    'ward1972-layer': { title: 'A unique join key for the 1972 wards and their 1981 populations', argv: ['python', 'scripts/ingest/census/build_ward1972_pop_layer.py'], outputs: [DERIVED, 'data/maps/local-government/staged-w72id/'] },
    'ward1972-crosswalk': { title: 'W72_ID to civ_fid crosswalk (data/database/census-join-crosswalks/wards-1972.json)', argv: ['python', 'scripts/ingest/census/build_ward1972_civfid_crosswalk.py'], needs: ['data/census/derived/ward1972-pop-1981.csv'] },
    // Cleaned builds and the explorer.
    'cleaned-2001': { title: 'The cleaned 2001 tables (build-2001-cleaned/)', argv: ['python', 'scripts/ingest/census/build-2001-cleaned/run2001.py'], network: true },
    'cleaned-2011': { title: 'The cleaned 2011 tables (build-2011-cleaned/)', argv: ['python', 'scripts/ingest/census/build-2011-cleaned/run.py'], network: true },
    'cleaning-model': { title: 'The census cleaning model over data/census', argv: ['node', 'scripts/ingest/census/build-census-cleaning-model.mjs'], outputs: ['data/census/'] },
    'explorer-bundle': { title: 'The Census Explorer data files (explorer/ holds its table lists)', argv: ['node', 'scripts/ingest/census/build-census-explorer-bundle.mjs'], network: true },
    // Inventories and the approved-publication gate.
    'source-inventory': { title: 'The census source inventory (data/census/source-inventory/)', argv: ['node', 'scripts/ingest/census/build-census-source-inventory.mjs'], outputs: [INVENTORY] },
    'cso-failed-links': { title: 'The CSO historical reports\' failed-link report', argv: ['node', 'scripts/ingest/census/build-cso-failed-link-report.mjs'], outputs: [INVENTORY] },
    'cso-ia-manifest': { title: 'The committed manifest of the civgraph-cso-historical-reports Internet Archive item', argv: ['node', 'scripts/ingest/census/build-cso-historical-reports-ia-manifest.mjs'], outputs: [INVENTORY], network: true },
    'cso-reports': { title: 'Scrape the CSO historical census reports', argv: ['node', 'scripts/ingest/census/scrape-cso-historical-reports.mjs'], outputs: [INVENTORY], network: true },
    'gate-records': { title: 'Category-1 census records for the CSO CC-BY tranche (approved-publication gate)', argv: ['node', 'scripts/ingest/census/census-emit-gate-records.mjs'], needs: ['data/review-inputs/census-publish-ready/publish-tranche-cso-highconf.csv'] },
    'cso-carveout': { title: 'The CSO carve-out records (SPLIT-nisra-ogl.csv rows for CSO review)', argv: ['node', 'scripts/ingest/census/census-emit-cso-carveout-records.mjs'], needs: ['data/review-inputs/census-publish-ready/SPLIT-nisra-ogl.csv'] },
    'pxstat-gap': { title: 'Complete the CSO PxStat coverage in the gate', argv: ['node', 'scripts/ingest/census/cso-emit-pxstat-gap-records.mjs'] },
    'merge-pilot': { title: 'Merge a census candidate file into the gate under a named counts bucket', argv: ['node', 'scripts/ingest/census/merge-census-pilot.mjs', '{input:candidates}'] },
    'nisra-publication-records': { title: 'Catalogue records for NISRA non-census publications', argv: ['node', 'scripts/ingest/census/emit-nisra-publication-records.mjs', '{input:harvest}'], outputs: [CANDIDATES] },
    'opendatani-records': { title: 'Catalogue records for Open Data NI datasets not yet on Civgraph', argv: ['node', 'scripts/ingest/census/emit-opendatani-catalogue-records.mjs', '{input:harvest}'], outputs: [CANDIDATES] },
    'opendatani-ia-enrich': { title: 'Add each Open Data NI file\'s Internet Archive copy to its record', argv: ['node', 'scripts/ingest/census/reenrich-opendatani-with-ia.mjs'] },
    // Crawls and mirrors (outside writes: the Internet Archive uploads need the owner's approval).
    'nisra-publications': { title: 'Enumerate the NISRA publications catalogue', argv: ['node', 'scripts/ingest/census/crawl-nisra-publications.mjs'], network: true },
    'nisra-publication-files': { title: 'Find each NISRA publication\'s data-file URLs', argv: ['node', 'scripts/ingest/census/crawl-nisra-publication-files.mjs'], network: true },
    'nisra-ia-mirror': { title: 'Mirror NISRA data files to the Internet Archive (uploads)', argv: ['node', 'scripts/ingest/census/mirror-nisra-files-to-ia.mjs'], network: true },
    'opendatani-ia-mirror': { title: 'Mirror Open Data NI files to the Internet Archive (uploads)', argv: ['node', 'scripts/ingest/census/mirror-opendatani-to-ia.mjs'], network: true },
    'wayback-nisra': { title: 'Recover lost NISRA files from the Wayback Machine', argv: ['node', 'scripts/ingest/census/wayback-nisra-recover.mjs'], network: true },
  },
  research: ['probe-nisra-throttle.mjs'],
  data: ['explorer/'],
});
