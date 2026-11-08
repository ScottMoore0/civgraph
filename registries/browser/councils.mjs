// The browser's slice of data/registries/councils.json (generated: node registries/browser/build.mjs).
// Readers import this module, not the JSON, so a file Node or TypeScript takes for CommonJS needs no
// import attributes; esbuild inlines the slice into the app bundle.
import councils from './councils.json' with { type: 'json' };

export default councils;
