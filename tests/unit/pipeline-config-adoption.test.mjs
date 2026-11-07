// The pipeline scripts take the site and data origins and the research User-Agent from
// scripts/lib/config.mjs (REFACTOR-PLAN.md CFG-4), not from string literals. A ratchet: a new
// literal in scripts/{build,publish,check,maps,dev,i18n} fails here unless it is listed below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '@civgraph/config/node';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FOLDERS = ['scripts/build', 'scripts/publish', 'scripts/check', 'scripts/maps', 'scripts/dev', 'scripts/i18n'];
const LITERAL = /https:\/\/(data\.)?civgraph\.net|civgraph-research/;

// Literals that stay, with why: each count is the number of code lines allowed in that file.
const ALLOWED = {
  'scripts/build/agent-index.mjs': 1, // prose in the index's `about` text
  'scripts/build/app-bundle.mjs': 2, // matches the literal canonical/og:url tags in the built HTML
  'scripts/build/build-external-source-indexes.mjs': 1, // its own descriptive User-Agent
  'scripts/build/render_cited_sources.mjs': 1, // its own verification User-Agent
  'scripts/dev/dev-server.mjs': 1, // the dev preview's own User-Agent
};

function* mjsFiles(dir) {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* mjsFiles(rel);
    else if (entry.name.endsWith('.mjs')) yield rel;
  }
}

const isComment = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

test('config still has the values the scripts used to spell out', () => {
  assert.equal(SITE.origin, 'https://civgraph.net');
  assert.equal(SITE.dataOrigin, 'https://data.civgraph.net');
  assert.equal(SITE.userAgent, 'civgraph-research (+https://civgraph.net)');
});

test('no pipeline script spells out the origins or the research User-Agent', () => {
  const found = {};
  for (const folder of FOLDERS) {
    for (const rel of mjsFiles(folder)) {
      const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter((l) => !isComment(l) && LITERAL.test(l));
      if (lines.length) found[rel] = lines.length;
    }
  }
  const over = Object.entries(found).filter(([rel, n]) => n > (ALLOWED[rel] || 0));
  assert.deepEqual(over, [], `use SITE from scripts/lib/config.mjs: ${over.map(([rel, n]) => `${rel} (${n})`).join(', ')}`);
});
