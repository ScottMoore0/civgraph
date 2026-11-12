// The browser's slice of data/registries/parties/palettes.json (generated: node packages/registries/src/browser/build.mjs).
// Readers import this module, not the JSON. It re-exports the generated party-palettes.data.mjs (plain ES, no
// JSON import attribute, so Node, every esbuild incl. Cloudflare's wrangler 3.114, and TypeScript read it).
import partyPalettes from './party-palettes.data.mjs';

export default partyPalettes;
