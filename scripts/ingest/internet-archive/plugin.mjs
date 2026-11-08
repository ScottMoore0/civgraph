// Internet Archive mirrors of agency map layers, one item per agency.
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'internet-archive',
  title: 'Internet Archive agency mirrors',
  kinds: ['sources'],
  personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'agency-map-layers', title: 'Agency map layers published on Civgraph, as mirrored to the Internet Archive', publisher: 'Internet Archive', url: 'https://archive.org/', rights: 'facts-with-citation', note: 'Each mirrored file keeps its agency licence; the batch carries only the mirror register.' }],
  steps: {
    mirror: {
      title: "Mirror one agency's layers to its Internet Archive item and record them in data/database/agency-ia-mirrors.json",
      argv: ['node', 'scripts/ingest/internet-archive/build-agency-ia-mirror.mjs'],
      network: true,
      note: "Downloads from R2 and UPLOADS to the Internet Archive: an outside write, so it needs the owner's approval as well as --allow-network.",
    },
  },
});
