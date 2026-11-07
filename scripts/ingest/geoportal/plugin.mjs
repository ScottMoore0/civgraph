// The Peatlands Geoportal (Queen's University Belfast): source records for its layers.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

export default definePlugin({
  id: 'geoportal',
  title: 'Peatlands Geoportal source records',
  kinds: ['sources'],
  personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'peatland-geoportal', title: 'Peatlands Geoportal', publisher: "Queen's University Belfast", url: 'https://peatlands-geoportal-queensub.hub.arcgis.com/', rights: 'facts-with-citation', note: 'Catalogue records linking to the portal; no layer data is copied.' }],
  steps: {
    'source-records': {
      title: 'Build data/database/peatland-geoportal-sources.json from the duplicate review',
      argv: ['node', 'scripts/ingest/geoportal/build-peatland-geoportal-sources.mjs'],
      needs: ['data/review-inputs/peatland-geoportal-duplicate-review-2026-06-25.csv'],
    },
  },
});
