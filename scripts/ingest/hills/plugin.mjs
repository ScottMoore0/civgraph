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
      outputs: ['tmp/dobih/domain-polygons/', 'render/source-cache/vector-intake/'],
      needs: ['tmp/dobih/generated'],
    },
    'domain-metadata': {
      title: 'Register the hill-domain layers in the catalogue and the /test metadata',
      argv: ['node', 'scripts/ingest/hills/build-irish-hill-domain-metadata.mjs'],
      outputs: ['render/metadata/maps-test.json', 'render/metadata/maps-test-index.json', 'render/metadata/main-site-port-plan.json', 'render/metadata/feature-indexes/'],
      needs: ['tmp/dobih/domain-polygons/irish-hill-domain-build-report.json'],
    },
  },
});
