// The all-Ireland planning applications layer: chunked and LOD files for the map.
import { definePlugin } from '../../intake/lib/plugins.mjs';

export default definePlugin({
  id: 'opendatani',
  title: 'Planning applications layer chunks',
  kinds: ['maps'],
  personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'roi-national-planning-applications', title: 'National Planning Applications', publisher: 'Department of Housing, Local Government and Heritage (data.gov.ie)', url: 'https://data.gov.ie/', rights: 'CC-BY', licence: 'CC BY 4.0' }],
  steps: {
    'planning-chunks': {
      title: 'Spatial chunks and LODs of the planning applications FGB',
      argv: ['python', 'scripts/ingest/opendatani/build_planning_chunks.py'],
      needs: ['C:/tmp/integrate-batch2a/data/maps/roi-planning/roi-national-planning-applications.fgb'],
      note: 'Reads and writes fixed folders outside the repository (C:\\tmp\\integrate-batch2a, C:\\tmp\\planning-chunks), so a run captures nothing until those paths become arguments; kept as the record of how the chunks were built.',
    },
  },
});
