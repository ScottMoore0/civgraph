// Fixtures for the intake tests: a throwaway repository and batch folder under the OS temp
// directory, so nothing here reads or writes the real tree, R2 or the network.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function tempDir(label) {
  return mkdtempSync(path.join(os.tmpdir(), `intake-test-${label}-`));
}

export function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  return full;
}

/**
 * Let the code copied into a throwaway repository import its packages by name (packages/README.md):
 * each packages/<name> it holds gets the real package.json (for its exports) and a link
 * node_modules/@civgraph/<name> to it, as npm's workspace links would.
 * @param {string} repo
 */
export function linkWorkspace(repo) {
  const base = path.join(repo, 'packages');
  if (!existsSync(base)) return;
  mkdirSync(path.join(repo, 'node_modules', '@civgraph'), { recursive: true });
  for (const name of readdirSync(base)) {
    const manifest = path.join(base, name, 'package.json');
    if (!existsSync(manifest)) copyFileSync(path.join(REPO, 'packages', name, 'package.json'), manifest);
    symlinkSync(path.join(base, name), path.join(repo, 'node_modules', '@civgraph', name), process.platform === 'win32' ? 'junction' : 'dir');
  }
}

/** A repository with a two-entry maps.json, a corrections file and the R2 allowlist. */
export function makeRepo({ eol = '\n' } = {}) {
  const repo = tempDir('repo');
  const maps = {
    classes: [{ id: 'ni-poor-law-unions', name: 'Poor Law Unions', maps: ['plu-ni-1921-04-01'] }],
    maps: [
      { id: 'plu-ni-1921-04-01', name: 'PLU 1921', description: 'Unions from 1921.' },
      { id: 'plu-ni-1924-04-01', name: 'PLU 1924', description: 'Unions until 5 Jul 1948.', references: [] },
    ],
  };
  writeFile(repo, 'data/database/maps.json', `${JSON.stringify(maps, null, 2)}\n`.replace(/\n/g, eol));
  writeFile(repo, 'data/database/r2-publication-allowlist.json', { schemaVersion: 1, prefixes: [{ prefix: 'data/maps/' }, { prefix: 'assets/thumbnails/' }] });
  writeFile(repo, 'data/elections/corrections/seat-corrections.json', {
    schemaVersion: 1,
    description: 'test',
    records: [{ electionKey: 'e1', constituency: 'A', field: 'seats', proposedValue: 1 }],
  });
  writeFile(repo, 'data/maps/health/existing.fgb', 'old bytes');
  writeFile(repo, 'scripts/publish/r2-upload-files.mjs', '// stub');
  return repo;
}

/** A batch folder with layer files and proposed maps.json patches, plus its manifest. */
export function makeBatch(overrides = {}) {
  const dir = tempDir('batch');
  writeFile(dir, 'layers/New_Layer.fgb', 'new layer bytes');
  writeFile(dir, 'layers/Lookup.csv', 'a,b\n1,2\n');
  writeFile(dir, 'proposed/entries.json', [
    { id: 'dd-1921', name: 'Dispensary districts 1921' },
    { id: 'dd-1924', name: 'Dispensary districts 1924' },
  ]);
  writeFile(dir, 'proposed/classes.json', [{ id: 'ni-dd', name: 'Dispensary Districts', maps: ['dd-1924', 'dd-1921'], _insert_after: 'ni-poor-law-unions' }]);
  writeFile(dir, 'proposed/edits.json', [
    { id: 'plu-ni-1924-04-01', op: 'replace-text', field: 'description', old: 'until 5 Jul 1948.', new: 'until 5 Jul 1948; boards abolished 30 Sep 1948.' },
    { id: 'plu-ni-1924-04-01', op: 'add-reference', ref: { label: 'S.R. & O. 1948 No. 281', url: 'https://www.legislation.gov.uk/nisro/1948/281/contents/made' } },
  ]);
  writeFile(dir, 'corrections/seats.json', [
    { electionKey: 'e1', constituency: 'A', field: 'seats', proposedValue: 2 },
    { electionKey: 'e2', constituency: 'B', field: 'seats', proposedValue: 3 },
  ]);
  writeFile(dir, 'elections/council/1923-01-15/ward-a.json', { area: 'Ward A' });
  const manifest = {
    schemaVersion: 1,
    id: 'test-batch',
    title: 'Test batch',
    date: '2026-11-06',
    status: 'draft',
    sources: [{ id: 'gazette', title: 'Belfast Gazette', licence: 'OGL v3.0' }],
    personalData: { contains: false, handling: 'none' },
    operations: [
      { id: 'copy', type: 'copy-files', sources: ['gazette'], files: [
        { from: 'layers/New_Layer.fgb', to: 'data/maps/health/New_Layer.fgb' },
        { from: 'layers/Lookup.csv', to: 'data/maps/health/Lookup.csv' },
      ] },
      { id: 'catalogue', type: 'maps-json-patch', entries: 'proposed/entries.json', insertAfter: 'plu-ni-1921-04-01', classes: 'proposed/classes.json', edits: 'proposed/edits.json' },
      { id: 'seats', type: 'corrections', target: 'data/elections/corrections/seat-corrections.json', records: 'corrections/seats.json', key: ['electionKey', 'constituency', 'field'] },
      { id: 'results', type: 'election-sources', fromDir: 'elections' },
      { id: 'fgb', type: 'r2-fgb', pairs: [{ file: 'data/maps/health/New_Layer.fgb', key: 'data/maps/health/New_Layer.fgb' }] },
      { id: 'csv', type: 'r2-tree', prefix: 'data/maps/health/', files: ['data/maps/health/Lookup.csv'], force: true },
      { id: 'cc', type: 'r2-cache-control', prefixes: ['data/maps/health/'] },
      { id: 'pmtiles', type: 'r2-pmtiles', ids: ['dd-1921-vector', 'dd-1924-vector'] },
      { id: 'tokens', type: 'stamp-cache-tokens' },
      { id: 'switch', type: 'switch-to-cdn', idsFrom: 'pmtiles' },
      { id: 'thumbs', type: 'thumbnails', mapIds: ['dd-1921', 'dd-1924'] },
    ],
    ...overrides,
  };
  writeFile(dir, 'batch.json', manifest);
  return { dir, manifest };
}
