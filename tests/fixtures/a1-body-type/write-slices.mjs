/**
 * Writes the browser slices the registries give into the folder named by argv[2], as
 * packages/registries/src/browser/build.mjs writes them beside itself (<name>.data.mjs). Run under
 * overlay.mjs, so the registries read are the fixture's.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { browserSlices, sliceModuleText } from '../../../packages/registries/src/browser/build.mjs';

const out = String(process.argv[2]);
for (const [file, slice] of Object.entries(browserSlices())) {
  writeFileSync(path.join(out, file.replace(/\.json$/, '.data.mjs')), sliceModuleText(file, slice));
}
console.log(JSON.stringify(Object.keys(browserSlices())));
