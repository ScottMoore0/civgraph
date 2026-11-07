// The grouped pre-1973 Northern Ireland local elections: the committed snapshots the grouped
// build reads (round status from the council intake, the boundary layers' feature lists).
import { definePlugin } from '../../intake/lib/plugins.mjs';

export default definePlugin({
  id: 'ni-local',
  title: 'Pre-1973 Northern Ireland local elections snapshots',
  kinds: ['elections'],
  personalData: { contains: false, handling: 'none', note: 'Round statuses and area names only; the intake\'s free-text notes and citations are not copied.' },
  sources: [
    { id: 'ni-councils-intake', title: 'The NI councils transcription intake (calendar, authorities, review exclusions, per-round work files)', rights: 'facts-with-citation' },
    { id: 'civgraph-boundary-layers', title: "Civgraph's NI boundary layers (DEDs, wards, administrative areas)", rights: 'CC-BY', licence: 'CC BY 4.0' },
  ],
  inputs: {
    intake: { env: 'CIVGRAPH_NI_INTAKE', description: 'the council intake folder' },
    cache: { default: 'render/source-cache/vector-intake', description: 'folder of the converted layers\' source FGBs' },
  },
  steps: {
    'round-status': {
      title: 'Snapshot the intake\'s round statuses into data/elections/ni-local/round-status.json',
      argv: ['python', 'scripts/ingest/ni-local/import-intake-status.py', '--intake', '{input:intake}'],
    },
    'layer-features': {
      title: 'List the boundary layers\' features into data/elections/ni-local/layer-features.json (needs geopandas)',
      argv: ['python', 'scripts/ingest/ni-local/build-layer-features.py', '--cache', '{input:cache}'],
      needs: ['render/source-cache/vector-intake'],
    },
  },
});
