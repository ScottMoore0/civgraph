// The all-Ireland planning applications layer: chunked and LOD files for the map.
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

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
      note: 'Reads and writes fixed folders outside the repository (the integration and planning-chunks folders named at the top of the script), so a run captures nothing until those paths become arguments; kept as the record of how the chunks were built.',
    },
  },
});
