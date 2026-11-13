// The browser's slice of data/registries/source-kinds.json (generated: node packages/registries/src/browser/build.mjs).
// Readers import this module, not the JSON. It re-exports the generated source-kinds.data.mjs (plain ES, no
// JSON import attribute, so Node, every esbuild incl. Cloudflare's wrangler 3.114, and TypeScript read it).
import sourceKinds from './source-kinds.data.mjs';

export default sourceKinds;
