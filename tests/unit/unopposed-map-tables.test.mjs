// Unopposed returns in the map app's result tables (QA launch-readiness H4, 11 Nov 2026):
// packages/map/app/election-manager.js is bundled here with maplibre-gl stubbed out, and its
// table methods are called on a bare instance, as the pane calls them.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function loadManager() {
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'packages/map/app/election-manager.js')],
    bundle: true, write: false, format: 'esm', platform: 'neutral', absWorkingDir: ROOT, logLevel: 'error',
    plugins: [{
      name: 'stub-maplibre',
      setup(build) {
        build.onResolve({ filter: /^maplibre-gl$/ }, () => ({ path: 'maplibre-gl', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
      },
    }],
  });
  const url = `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`;
  const { Test2ElectionManager } = await import(url);
  const manager = Object.create(Test2ElectionManager.prototype);
  Object.assign(manager, { app: {}, activeBundle: { results: [] }, activeEntry: {}, previousBundle: null, selectedResultKey: null });
  return manager;
}

const manager = await loadManager();
const textCells = (html) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
const FALLS = [
  { name: 'Patrick B. Gregory', party: 'Nationalist Party', firstPrefs: null, finalVotes: null, elected: true, status: 'Elected unopposed' },
  { name: 'John P. Hayes', party: 'NI Labour', firstPrefs: null, finalVotes: null, elected: true, status: 'Elected unopposed' },
];

test('plurality contest with no poll: Unopposed, no share and no vote bars', () => {
  const html = manager.renderSingleSeatFptpResultsTable(FALLS, { constituency: 'Falls', seatsTotal: 2, votingSystem: 'block-vote', candidates: FALLS });
  const cells = textCells(html);
  assert.equal(cells.filter((c) => c === 'Unopposed').length, 2, cells.join('|'));
  assert.ok(cells.includes('Elected unopposed'));
  assert.doesNotMatch(html, /test2-fptp-vote-graphic/, 'no bar chart of zeros');
});

test('STV candidate table: an unopposed or automatically returned seat shows no 0 votes', () => {
  const candidates = [
    { name: 'CC', party: 'Ceann Comhairle', firstPrefs: null, elected: true, status: 'Elected (auto returned)', autoReturnedCeannComhairle: true },
    { name: 'A', party: 'FF', firstPrefs: 600, finalVotes: 600, elected: true, status: 'Elected' },
  ];
  const cells = textCells(manager.renderConstituencyCandidateTable(candidates, { constituency: 'Kildare South', validPoll: 600, votingSystem: 'stv', candidates }));
  assert.ok(cells.includes('Returned automatically'), cells.join('|'));
  assert.ok(cells.includes('600'));
  const unopposed = [{ name: 'U', party: 'SF', firstPrefs: 0, elected: true, status: 'Elected unopposed' }];
  const cellsU = textCells(manager.renderConstituencyCandidateTable(unopposed, { constituency: 'X', votingSystem: 'stv', candidates: unopposed }));
  assert.ok(cellsU.includes('Unopposed') && cellsU.includes('Elected unopposed') && !cellsU.includes('0'), cellsU.join('|'));
});

test('party table: an all-unopposed party shows dashes, and the table says unopposed seats add no votes', () => {
  const rows = [
    { party: 'UUP', stood: 2, seats: 1, votes: 6148, share: 75.45 },
    { party: 'Nationalist Party', stood: 2, seats: 2, votes: 0, share: null, unopposedSeats: 2 },
  ];
  const html = manager.renderMainParityPartyTable(rows, [], { ignoreMainLikeTotals: true, previousRows: [] });
  assert.match(html, /2 seats were returned unopposed\. Seats returned unopposed count as seats but add no votes/);
  const natRow = html.split('<tr>').find((part) => part.includes('Nationalist Party'));
  assert.ok(natRow && !/0\.00%/.test(natRow) && natRow.includes('–'), natRow);
  const uupRow = html.split('<tr>').find((part) => part.includes('UUP'));
  assert.match(uupRow, /6,148/);
});
