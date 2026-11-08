#!/usr/bin/env node
/**
 * The registry slices the browser code imports (REG-0's browser half).
 *
 * src/, app/src/ and packages/core/src/ read registry facts from the small JSON files beside this
 * script, each through its module (councils.mjs imports councils.json `with { type: 'json' }` and
 * re-exports it), a static import that esbuild bundles into the app and Node runs as it is. Each file holds only the views the code reads, computed here by the registry
 * views (registries/*.mjs) from the full registries in data/registries/, so the app bundle carries
 * those views and nothing else. Neither data/registries/ (scripts/build/site.mjs EXCLUDE) nor
 * registries/ (not in SITE_DIRS) is published: the values reach browsers only inside the bundle
 * (owner, 8 Nov 2026).
 *
 * The slices are generated, never edited: change data/registries/*.json, then run
 *
 *   node registries/browser/build.mjs           rewrite the slices
 *   node registries/browser/build.mjs --check   exit 1 if a slice differs from a fresh build
 *
 * tests/unit/registries-browser.test.mjs fails when a slice is stale.
 *
 *   councils.json        src/ni-local-groups.mjs (NI_COUNCIL_SLUGS, NI_LOCAL_TIERS)
 *   council-search.json  src/catalogue/search.js (council names by generation, council aliases)
 *   parties.json         packages/core/src/party-names.mjs (PARTIES, NOT_PARTIES)
 *   statuses.json        packages/core/src/election-domain.mjs (statusKind, RG-01),
 *                        app/src/ni-local-view.js (round badges, missing rounds, contests: RG-02, RG-03)
 *   layer-types.json     src/map/renderer/map-controller.js (the behaviour flags' source types)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, REPO_ROOT } from '../index.mjs';
import { catalogueBodyAliases, catalogueCouncilNames, niLocalGroupSlugs } from '../councils.mjs';
import { typesWithBehaviour } from '../layers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** file name -> slice, from the registries under `root`. */
export function browserSlices(root = REPO_ROOT) {
  const councils = loadRegistry('councils', { root });
  const parties = loadRegistry('parties', { root });
  const statuses = loadRegistry('statuses', { root });
  const layers = loadRegistry('layers', { root });
  const round = statuses.machines['election-round'];
  return {
    'councils.json': {
      niLocalGroupSlugs: [...niLocalGroupSlugs(councils)],
      // The kinds of council that are drawn at levels (NI_LOCAL_TIERS), in registry order.
      tiers: Object.fromEntries(Object.entries(councils.types)
        .filter(([, type]) => type.levels)
        .map(([id, { label, levels }]) => [id, { label, levels }]))
    },
    // Apart from councils.json, so that each lands in the one app chunk that reads it (the map's
    // election code, the catalogue) and neither adds a chunk of its own.
    'council-search.json': {
      catalogueCouncilNames: {
        ni1973: catalogueCouncilNames(councils, { generation: '1973' }),
        ni2014: catalogueCouncilNames(councils, { generation: '2014' }),
        ireland: catalogueCouncilNames(councils, { generation: '2014', jurisdiction: 'ireland' })
      },
      catalogueBodyAliases: catalogueBodyAliases(councils)
    },
    'parties.json': {
      // [abbreviation, full name, ...other spellings], as the table was written.
      abbreviations: parties.abbreviations.map(({ abbreviation, fullName, spellings = [] }) => [abbreviation, fullName, ...spellings]),
      notParties: [...parties.notParties]
    },
    'statuses.json': {
      candidateKindPatterns: statuses.machines['candidate-count'].kindPatterns.map(({ kind, pattern }) => [kind, pattern]),
      roundSiteLabels: { ...round.siteLabels },
      missingReasons: structuredClone(round.missingReasons),
      contestLabels: { ...statuses.machines.contest.labels }
    },
    'layer-types.json': {
      behaviour: Object.fromEntries(Object.keys(layers.behaviourFlags).map((flag) => [flag, typesWithBehaviour(layers, flag)]))
    }
  };
}

/** The text a slice file holds. */
export const sliceText = (slice) => `${JSON.stringify(slice, null, 1)}\n`;

/** Slice files that differ from a fresh build (names), reading the files in `dir`. */
export function staleSlices(root = REPO_ROOT, dir = HERE) {
  return Object.entries(browserSlices(root)).filter(([file, slice]) => {
    let current = '';
    try { current = readFileSync(path.join(dir, file), 'utf8'); } catch { /* missing */ }
    return current !== sliceText(slice);
  }).map(([file]) => file);
}

// Also run through the re-export at registries/browser/build.mjs (kept until 8 Dec 2026).
const isMain = Boolean(process.argv[1]) && /registries[\\/](?:src[\\/])?browser[\\/]build\.mjs$/.test(path.resolve(process.argv[1]));
if (isMain) {
  if (process.argv.includes('--check')) {
    const stale = staleSlices();
    if (stale.length) {
      console.error(`registries/browser: stale ${stale.join(', ')}; run node registries/browser/build.mjs`);
      process.exit(1);
    }
    console.log('registries/browser: every slice matches the registries');
  } else {
    for (const [file, slice] of Object.entries(browserSlices())) writeFileSync(path.join(HERE, file), sliceText(slice));
    console.log(`registries/browser: wrote ${Object.keys(browserSlices()).join(', ')}`);
  }
}
