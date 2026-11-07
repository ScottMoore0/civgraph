// Irish hill and mountain domain polygons, from the Database of British and Irish Hills summits.
import { definePlugin } from '../../intake/lib/plugins.mjs';

export default definePlugin({
  id: 'hills',
  title: 'Irish hill-domain polygon layers',
  kinds: ['maps'],
  personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'dobih', title: 'The Database of British and Irish Hills', publisher: 'Database of British and Irish Hills', url: 'https://www.hills-database.co.uk/', rights: 'CC-BY', licence: 'CC BY 4.0' }],
  steps: {
    'domain-assets': {
      title: 'Generate the summit- and prominence-domain polygons (tmp/dobih/domain-polygons)',
      argv: ['python', 'scripts/ingest/hills/build_irish_hill_domain_assets.py'],
      outputs: ['tmp/dobih/domain-polygons/', 'test/source-cache/vector-intake/irish-hill-summit-domains.fgb', 'test/source-cache/vector-intake/irish-hill-prominence-domains.fgb'],
      needs: ['tmp/dobih/source/hillcsv/DoBIH_v18_4.csv', 'data/maps/physical/Ireland-lod1.fgb', 'data/maps/physical/dem_tiles'],
      volatile: ['generatedAt'],
    },
    'domain-metadata': {
      title: 'Register the hill-domain layers in the catalogue and the /test metadata',
      argv: ['node', 'scripts/ingest/hills/build-irish-hill-domain-metadata.mjs'],
      outputs: ['render/metadata/maps-test.json', 'render/metadata/maps-test-index.json', 'render/metadata/main-site-port-plan.json', 'render/metadata/feature-indexes/'],
      needs: ['tmp/dobih/domain-polygons/irish-hill-domain-build-report.json'],
    },
  },
});
