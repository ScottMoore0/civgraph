// The Database of British and Irish Hills: point layers and catalogue records.
import { definePlugin } from '../../intake/lib/plugins.mjs';

export default definePlugin({
  id: 'dobih',
  title: 'Database of British and Irish Hills layers',
  kinds: ['maps', 'sources'],
  personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'dobih', title: 'The Database of British and Irish Hills v18.4', publisher: 'Database of British and Irish Hills', url: 'https://www.hills-database.co.uk/', rights: 'CC-BY', licence: 'CC BY 4.0' }],
  steps: {
    assets: {
      title: 'Source manifest, FGB point layers, catalogue, /test and spatial-search records from the local Hill Bagging downloads',
      argv: ['node', 'scripts/ingest/dobih/build-dobih-assets.mjs'],
      outputs: ['tmp/dobih/generated/', 'render/source-cache/vector-intake/', 'render/metadata/maps-test.json', 'render/metadata/main-site-port-plan.json', 'render/metadata/feature-indexes/'],
      needs: ['tmp/hill-bagging/downloads'],
    },
  },
});
