// The all-Ireland planning applications layer: chunked and LOD files for the map.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

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
      note: 'Give the source FGB and the output folder after -- (without them it reads and writes the folders outside the repository where the chunks were first built, named at the top of the script, and a run captures nothing).',
    },
  },
});
