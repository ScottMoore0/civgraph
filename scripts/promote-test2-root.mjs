#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const ROOT_INDEX = 'index.html';
const MAIN_CSS = 'build/main.css';
const APP_JS = 'app/build/app.bundle.js';
const APP_CSS = 'app/build/app.bundle.css';
const ARCHIVE_TAG = 'leaflet-main-before-maplibre-root-20260612';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, 'utf8');
}

function main() {
  const html = read(ROOT_INDEX);
  assert(existsSync(MAIN_CSS), `Missing shared CSS output: ${MAIN_CSS}`);
  assert(existsSync(APP_JS), `Missing MapLibre app JS output: ${APP_JS}`);
  assert(existsSync(APP_CSS), `Missing MapLibre app CSS output: ${APP_CSS}`);
  assert(html.includes('/app/build/app.bundle.js'), 'Root HTML must load the MapLibre runtime from /app.');
  assert(html.includes('/app/build/app.bundle.css'), 'Root HTML must load the MapLibre CSS from /app.');
  assert(html.includes('/app/election-viewer-package/css/election-viewer.css'), 'Root HTML must load election viewer CSS from /app.');
  assert(!html.includes('/test2/build/') && !html.includes('/test2/src/') && !html.includes('/test2/js/'), 'Root HTML must not load runtime assets from /test2.');
  assert(!/(?:src|href)=["']\/build\/app\.bundle\.js|leaflet-1\.9\.4/i.test(html), 'Root HTML must not load the archived Leaflet runtime.');
  console.log(`Root MapLibre shell already uses /app assets. Leaflet root archive tag: ${ARCHIVE_TAG}.`);
}

main();
