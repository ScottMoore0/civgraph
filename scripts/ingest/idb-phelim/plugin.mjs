// Phelim Birch's Irish boundary deliveries: LODs for the 25 May 2026 delivery and his per-year
// ED build-spec notes.
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

const LOD_TARGETS = [
  'data/maps/baronies-parishes/Counties_Ireland_1922',
  'data/maps/baronies-parishes/Counties_Ireland_1927',
  'data/maps/local-government/ROI_Local_Authorities_1930',
  'data/maps/local-government/ROI_Local_Authorities_1931',
  'data/maps/local-government/ROI_Local_Authorities_1941',
  'data/maps/local-government/ROI_Local_Authorities_1942',
  'data/maps/local-government/ROI_Local_Authorities_1944',
  'data/maps/local-government/ROI_Local_Authorities_1950',
];

export default definePlugin({
  id: 'idb-phelim',
  title: "Phelim Birch's Irish boundary deliveries",
  kinds: ['maps'],
  personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'phelim-birch-deliveries', title: "Phelim Birch's Irish administrative boundary files and ED build-spec notes", rights: 'owner-permission', note: 'Delivered to the owner for publication on Civgraph.' }],
  inputs: { notesDir: { description: "the folder of Phelim's per-year ED notes from a delivery's media" } },
  steps: {
    'lods-20260525': {
      title: 'Write the -lod0 and -lod1 FGBs of the 25 May 2026 delivery\'s eight layers',
      argv: ['node', 'scripts/ingest/idb-phelim/build-idb-20260525-lods.mjs'],
      outputs: LOD_TARGETS.flatMap((t) => [`${t}-lod0.fgb`, `${t}-lod1.fgb`]),
      needs: LOD_TARGETS.map((t) => `${t}.fgb`),
    },
    'ed-notes': {
      title: 'Parse the ED build-spec notes into data/intake/2026-07-26-ed-composition-specs.json',
      argv: ['node', 'scripts/ingest/idb-phelim/parse-phelim-ed-notes.mjs', '{input:notesDir}'],
    },
  },
});
