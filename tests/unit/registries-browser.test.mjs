/**
 * The registry slices the browser code imports (registries/browser/, REG-0's browser half) are
 * what the registries give today, are imported statically (so esbuild bundles them), and are
 * never published as files of their own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry } from '../../packages/registries/src/index.mjs';
import { browserSlices, sliceText, staleSlices } from '../../packages/registries/src/browser/build.mjs';
import { EXCLUDE, SITE_DIRS } from '../../scripts/build/site.mjs';
import { statusKind } from '../../packages/core/src/election-domain.mjs';
import { isNonParty, partyAbbreviation, partyFullName } from '../../packages/core/src/party-names.mjs';

const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('registries/browser: every slice matches a fresh build from data/registries', () => {
  assert.deepEqual(staleSlices(), [], 'run node packages/registries/src/browser/build.mjs');
  const slices = browserSlices();
  assert.deepEqual(Object.keys(slices), ['councils.json', 'council-search.json', 'parties.json', 'party-palettes.json', 'statuses.json', 'layer-types.json', 'election-bodies.json', 'election-types.json']);
  for (const [file, slice] of Object.entries(slices)) assert.equal(read(`packages/registries/src/browser/${file}`), sliceText(slice), file);
});

test('registries/browser: each reader imports its slice statically, through its module', () => {
  const readers = {
    'src/ni-local-groups.mjs': '../packages/registries/src/browser/councils.mjs',
    'src/catalogue/search.js': '../../packages/registries/src/browser/council-search.mjs',
    'packages/core/src/party-names.mjs': '../../registries/src/browser/parties.mjs',
    'packages/core/src/election-domain.mjs': '../../registries/src/browser/statuses.mjs',
    'packages/map/app/ni-local-view.js': '../../registries/src/browser/statuses.mjs',
    'packages/map/src/renderer/map-controller.js': '../../../registries/src/browser/layer-types.mjs',
    'src/catalogue/view-elections.js': '../../packages/registries/src/browser/election-bodies.mjs',
    'packages/map/src/app/helpers.mjs': '../../../registries/src/browser/election-bodies.mjs'
  };
  for (const [file, spec] of Object.entries(readers)) {
    assert.ok(read(file).split('\n').some((line) => /^import \w+ from '/.test(line) && line.endsWith(` from '${spec}';`)), file);
  }
  // Each module re-exports its slice through the generated plain-ES twin (<name>.data.mjs), never a
  // JSON import: Cloudflare's Pages build (wrangler 3.114.17) rejects `with { type: 'json' }`.
  for (const file of Object.keys(browserSlices())) {
    const name = file.replace('.json', '');
    const text = read(`packages/registries/src/browser/${name}.mjs`);
    assert.doesNotMatch(text, /with \{ type: 'json' \}/, `${name}.mjs must not use a JSON import attribute`);
    assert.match(text, new RegExp(`\\nimport (\\w+) from '\\./${name}\\.data\\.mjs';\\n\\nexport default \\1;\\n?$`), `${name}.mjs re-exports ${name}.data.mjs`);
  }
});

test('registries/browser: neither the slices nor data/registries are published as files', () => {
  assert.ok(!SITE_DIRS.includes('registries'));
  assert.ok(EXCLUDE.includes('data/registries/'));
});

test('registries/browser: the readers answer as the registries say', () => {
  const statuses = loadRegistry('statuses');
  const patterns = statuses.machines['candidate-count'].kindPatterns;
  assert.deepEqual(patterns.map((p) => p.kind), ['not-elected', 'elected', 'excluded']);
  for (const [status, kind] of [['Elected', 'elected'], ['Not Elected', 'not-elected'], ['Deemed elected', 'elected'],
    ['Excluded', 'excluded'], ['Eliminated', 'excluded'], ['Made quota', 'elected'], ['', ''], ['Withdrew', 'withdrew']]) {
    assert.equal(statusKind(status), kind, status);
  }
  const parties = loadRegistry('parties', { validate: false });
  for (const { abbreviation, fullName, spellings = [] } of parties.abbreviations) {
    for (const spelling of [fullName, ...spellings]) {
      // The first row naming a spelling wins (packages/registries/src/parties.mjs abbreviationIndex).
      const owner = parties.abbreviations.find((r) => [r.abbreviation, r.fullName, ...(r.spellings || [])].includes(spelling));
      if (owner.abbreviation !== abbreviation) continue;
      assert.equal(partyAbbreviation(spelling), abbreviation, spelling);
      assert.equal(partyFullName(spelling), fullName, spelling);
    }
  }
  for (const label of parties.notParties) assert.ok(isNonParty(label), label);
});

test('registries/browser: the catalogue shelves and labels the registries give (12 Nov 2026, rf8-registries)', async () => {
  const { BODY_GROUPS, BODY_SHORT, groupOfBody } = await import('../../src/catalogue/view-elections.js');
  const councils = loadRegistry('councils');
  const pre1973 = councils.councils.filter((c) => c.flags?.pre1973Council).map((c) => c.bodySlug);
  // The 82 pre-1973 council bodies the NI local shelf listed by hand until it read the flag.
  assert.equal(pre1973.length, 82);
  for (const slug of pre1973) assert.equal(groupOfBody(slug), 'ni-local', slug);
  assert.deepEqual(BODY_GROUPS.find((g) => g.id === 'ni-local').bodies.slice(0, 2), ['local-government', 'ni-local-elections']);
  // ireland-local's row label and shelf come from the election-bodies registry.
  assert.equal(BODY_SHORT['ireland-local'], 'Irish local');
  assert.equal(groupOfBody('ireland-local'), 'irish-local');
  assert.equal(BODY_SHORT['local-government'], 'NI local');
});

test('registries/browser: the party palettes are the tables the code held (12 Nov 2026, rf8-registries)', async () => {
  const { PARTY_COLOURS, ROI_MAIN_PARTY_COLOURS } = await import('../../packages/map/src/election/palette.mjs');
  const { isRegistryColourParty, partyColour, resolvePartyColour } = await import('../../packages/core/src/election-domain.mjs');
  assert.equal(PARTY_COLOURS.size, 31);
  assert.equal(ROI_MAIN_PARTY_COLOURS.size, 25);
  assert.equal(PARTY_COLOURS.get("people's democracy"), '#ff0000');
  assert.equal(ROI_MAIN_PARTY_COLOURS.get('fianna fail'), '#66BB66');
  // A name listed twice takes its later colour; the pre-1922 parties' colours win over a file's.
  assert.equal(partyColour('Conservative'), '#0087dc');
  assert.equal(resolvePartyColour('Irish Parliamentary Party', '#123456'), '#99ff66');
  assert.equal(resolvePartyColour('Fianna Fáil', '#123456'), '#123456');
  assert.equal(resolvePartyColour('Fianna Fáil', '#888888'), '#66bb66');
  for (const party of ['no label', 'unity', 'ulster popular unionist party', 'parnellite', 'liberal']) assert.ok(isRegistryColourParty(party), party);
  assert.ok(!isRegistryColourParty('fianna fail'));
});
