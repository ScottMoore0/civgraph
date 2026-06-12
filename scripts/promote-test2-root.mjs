#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TEST2_INDEX = 'test2/index.html';
const ROOT_INDEX = 'index.html';
const MAIN_CSS = 'build/main.css';
const ARCHIVE_TAG = 'leaflet-main-before-maplibre-root-20260612';

function hashFile(path, length = 12) {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, length);
}

function extractMainCssVersion(html) {
  const match = html.match(/\/?build\/main\.css\?v=([^"'>\s]+)/);
  return match?.[1] || null;
}

function main() {
  if (!existsSync(TEST2_INDEX)) {
    throw new Error(`Missing MapLibre source shell: ${TEST2_INDEX}`);
  }

  const currentRoot = existsSync(ROOT_INDEX) ? readFileSync(ROOT_INDEX, 'utf8') : '';
  const mainCssVersion = extractMainCssVersion(currentRoot) || hashFile(MAIN_CSS) || 'root';

  let html = readFileSync(TEST2_INDEX, 'utf8');
  html = html.replace(
    /<title>Civgraph<\/title>/,
    `<title>Civgraph</title>\n  <!-- Root MapLibre shell promoted from /test2. Leaflet root archived at git tag ${ARCHIVE_TAG}. -->`
  );
  html = html.replace(/\/build\/main\.css\?v=[^"'>\s]+/g, `/build/main.css?v=${mainCssVersion}`);
  html = html.replace(
    /\/\/ \/test2 keeps production cache ownership isolated from this MapLibre prototype\./,
    '// Root service-worker migration is handled separately; /test2 remains as a compatibility route.'
  );

  if (!html.includes('/test2/build/test2.bundle.js')) {
    throw new Error('Promoted root HTML must load the MapLibre /test2 runtime bundle.');
  }
  if (/build\/app\.bundle\.js|leaflet-1\.9\.4/i.test(html)) {
    throw new Error('Promoted root HTML still references the archived Leaflet runtime.');
  }

  writeFileSync(ROOT_INDEX, html);
  console.log(`Promoted ${TEST2_INDEX} to ${ROOT_INDEX} with /build/main.css?v=${mainCssVersion}`);
}

main();
