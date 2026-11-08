// The browser's slice of data/registries/councils.json (generated: node packages/registries/src/browser/build.mjs).
// Readers import this module, not the JSON. It re-exports the generated councils.data.mjs (plain ES, no
// JSON import attribute, so Node, every esbuild incl. Cloudflare's wrangler 3.114, and TypeScript read it).
import councils from './councils.data.mjs';

export default councils;
