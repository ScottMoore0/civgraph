// The Public Record Office of Northern Ireland eCatalogue: the crawl (outside the repository,
// under D:\PRONI) and the static browse landing built from the imported records.
import { definePlugin } from '../../intake/lib/plugins.mjs';

export default definePlugin({
  id: 'proni',
  title: 'PRONI eCatalogue',
  kinds: ['catalogue', 'sources'],
  personalData: { contains: false, handling: 'none', note: 'Catalogue descriptions as PRONI publishes them.' },
  sources: [{ id: 'proni-ecatalogue', title: 'PRONI eCatalogue', publisher: 'Public Record Office of Northern Ireland', url: 'https://apps.proni.gov.uk/eCatNI_IE/', rights: 'OGL', licence: 'Open Government Licence' }],
  inputs: {
    sqlite: { description: 'the imported PRONI records database' },
    out: { description: 'where the roots JSON is written' },
  },
  steps: {
    roots: {
      title: 'Emit the PRONI browse landing (top-level fonds) as a static JSON file',
      argv: ['python', 'scripts/ingest/proni/build-proni-roots.py', '--sqlite', '{input:sqlite}', '--out', '{input:out}'],
    },
    crawl: {
      title: 'Index the eCatalogue through its Browse pages (the authoritative corpus traversal)',
      argv: ['powershell', 'scripts/ingest/proni/proni-browse-corpus-crawler.ps1'],
      network: true,
    },
    'fast-index': { title: 'Fast Browse indexer (listing index)', argv: ['node', 'scripts/ingest/proni/proni-fast-indexer.mjs'], network: true },
    'detail-scan': { title: 'Record-detail scan of a listing index into JSONL under D:\\PRONI', argv: ['node', 'scripts/ingest/proni/proni-detail-quick-scan.mjs'], network: true },
    'detail-fetch': { title: 'Async detail fetch for Browse index snapshots', argv: ['node', 'scripts/ingest/proni/proni-browse-async-fetch.mjs'], network: true },
  },
  research: ['proni-browse-crawl-throttle.ps1', 'proni-dfs-benchmark.mjs', 'proni-direct-endpoint-probe.mjs', 'proni-overhead-research.ps1', 'proni-parallel-throttle.ps1'],
});
