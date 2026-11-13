#!/usr/bin/env node
/**
 * The registry slices the browser code imports (REG-0's browser half).
 *
 * src/, packages/map/app/ and packages/core/src/ read registry facts from the small JSON files beside this
 * script, each through its module (councils.mjs imports councils.json `with { type: 'json' }` and
 * re-exports it), a static import that esbuild bundles into the app and Node runs as it is. Each file holds only the views the code reads, computed here by the registry
 * views (registries/*.mjs) from the full registries in data/registries/, so the app bundle carries
 * those views and nothing else. Neither data/registries/ (scripts/build/site.mjs EXCLUDE) nor
 * registries/ (not in SITE_DIRS) is published: the values reach browsers only inside the bundle
 * (owner, 8 Nov 2026).
 *
 * The slices are generated, never edited: change data/registries/*.json, then run
 *
 *   node packages/registries/src/browser/build.mjs           rewrite the slices
 *   node packages/registries/src/browser/build.mjs --check   exit 1 if a slice differs from a fresh build
 *
 * tests/unit/registries-browser.test.mjs fails when a slice is stale.
 *
 *   councils.json        src/ni-local-groups.mjs (NI_COUNCIL_SLUGS, NI_LOCAL_TIERS)
 *   council-search.json  src/catalogue/search.js (council names by generation, council aliases),
 *                        src/catalogue/view-elections.js (the pre-1973 councils on the NI local shelf)
 *   parties.json         packages/core/src/party-names.mjs (PARTIES, NOT_PARTIES, notAPartyLabels)
 *   party-palettes.json  packages/core/src/election-domain.mjs (the election palette, the parties
 *                        whose colour wins, the neutral and placeholder greys), packages/map/src/election/palette.mjs
 *                        (the map's two), packages/map/app/election-manager.js (the STV viewer's table, handed
 *                        to the classic viewer scripts as globalThis.civgraphViewerColours)
 *   colours.json         the fixed colours code draws with (data/registries/colours.json): the map app
 *                        (packages/map/src/colours.mjs), the catalogues, the Elections app, Browse, the
 *                        gallery, the STV viewer and core's area results; served pages reach it at /pkg/
 *                        through colour-palettes.mjs (packages/served.json)
 *   statuses.json        packages/core/src/election-domain.mjs (statusKind, RG-01),
 *                        packages/map/app/ni-local-view.js (round badges, missing rounds, contests: RG-02, RG-03)
 *   layer-types.json     packages/map/src/renderer/map-controller.js (the behaviour flags' source types)
 *   election-bodies.json src/catalogue/view-elections.js and search.js (row label, shelf, search words),
 *                        packages/map/src/app/helpers.mjs (an election's kind): by body id
 *   election-types.json  site/apps/elections/lib/format.js (systemName), site/browse/browse.js (the Type
 *                        filter's labels); both served pages reach it at /pkg/ (packages/served.json)
 *   catalogue-kinds.json packages/map/src/catalogue/index.js (SECTIONS) and util.js (KINDS): the kinds of
 *                        map series, their sections and filter labels
 *   election-groups.json packages/map/src/catalogue/view-elections.js (the shelves), packages/map/src/
 *                        entity-detail-data.mjs (election-history groups), site/apps/elections/views/home.js
 *                        (the home page's groups, at /pkg/); placed by body-groups.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, REPO_ROOT } from '../index.mjs';
import { bodySlugsWithFlag, catalogueBodyAliases, catalogueCouncilNames, niLocalGroupSlugs } from '../councils.mjs';
import { typesWithBehaviour } from '../layers.mjs';
import { browserElectionBodies, catalogueShelves } from '../election-bodies.mjs';
import { browserElectionTypes } from '../election-types.mjs';
import { browserColours } from '../colours.mjs';
import { browserCatalogueKinds } from '../catalogue-kinds.mjs';

/** @typedef {import('../statuses.mjs').StatusMachineFields} StatusMachineFields */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The slices that carry colour data (registry palette parts): with the token files, the only code
 * where a colour literal may stand (docs/ARCHITECTURE-RULES.md R9). check:architecture C8 allows
 * their generated .data.mjs modules and nothing else by this list.
 */
export const PALETTE_SLICES = Object.freeze(['party-palettes.json', 'colours.json']);

/** file name -> slice, from the registries under `root`. */
export function browserSlices(root = REPO_ROOT) {
  const councils = loadRegistry('councils', { root });
  const parties = loadRegistry('parties', { root });
  const statuses = loadRegistry('statuses', { root });
  const layers = loadRegistry('layers', { root });
  const electionBodies = loadRegistry('election-bodies', { root });
  const electionTypes = loadRegistry('election-types', { root });
  const colours = loadRegistry('colours', { root });
  const round = /** @type {StatusMachineFields} */ (statuses.machines['election-round']);
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
      catalogueBodyAliases: catalogueBodyAliases(councils),
      // The pre-1973 councils' bodies, on the catalogue's NI local shelf (src/catalogue/view-elections.js).
      pre1973CouncilBodies: bodySlugsWithFlag(councils, 'pre1973Council')
    },
    'parties.json': {
      // [abbreviation, full name, ...other spellings], as the table was written.
      abbreviations: parties.abbreviations.map(({ abbreviation, fullName, spellings = [] }) => [abbreviation, fullName, ...spellings]),
      notParties: [...parties.notParties],
      // [label, ...the records it occurs in]: the labels that stand for no party (packages/core/src/party-names.mjs notAPartyLabels).
      noPartyLabels: parties.noPartyLabels.map(({ label, in: corpora }) => [label, ...corpora])
    },
    // Apart from parties.json: the colours, [party, colour] in the registry's order (a later row wins).
    'party-palettes.json': {
      elections: parties.palettes.elections.map(({ party, colour }) => [party, colour]),
      electionsRegistryWins: parties.palettes.elections.filter((row) => row.registryWins).map(({ party }) => party),
      mapLocal: parties.palettes.mapLocal.map(({ party, colour }) => [party, colour]),
      mapRoi: parties.palettes.mapRoi.map(({ party, colour }) => [party, colour]),
      viewer: parties.palettes.viewer.map(({ party, colour }) => [party, colour]),
      neutral: parties.palettes.neutral,
      placeholders: [...parties.palettes.placeholders]
    },
    // The fixed colours by palette and role (data/registries/colours.json): one slice, as the map app,
    // the catalogue and the served pages each read several palettes.
    'colours.json': browserColours(colours),
    'statuses.json': {
      candidateKindPatterns: /** @type {NonNullable<StatusMachineFields['kindPatterns']>} */ (statuses.machines['candidate-count'].kindPatterns).map(({ kind, pattern }) => [kind, pattern]),
      roundSiteLabels: { ...round.siteLabels },
      missingReasons: structuredClone(round.missingReasons),
      contestLabels: { .../** @type {StatusMachineFields} */ (statuses.machines.contest).labels },
      // The contribution queue's machine (RG-04): the Functions' decide.js reads it from here
      // (packages/api/src/contribution-status.js) instead of keeping a copy of the table.
      contribution: {
        initial: /** @type {StatusMachineFields} */ (statuses.machines.contribution).initial,
        transitions: structuredClone(/** @type {StatusMachineFields} */ (statuses.machines.contribution).transitions),
        // What an administrator may decide (packages/api/src/contribution-status.js DECISIONS).
        decisions: [.../** @type {string[]} */ (/** @type {StatusMachineFields} */ (statuses.machines.contribution).decisions)],
      }
    },
    'layer-types.json': {
      behaviour: Object.fromEntries(Object.keys(layers.behaviourFlags).map((flag) => [flag, typesWithBehaviour(layers, flag)]))
    },
    'election-bodies.json': browserElectionBodies(electionBodies),
    // How the bodies are grouped (election-bodies groups), apart from election-bodies.json, which is
    // keyed by body: the catalogue's shelves with every body on each, the Elections home page's groups
    // and the map app's election-history groups, each placed by body-groups.mjs.
    'election-groups.json': {
      shelves: catalogueShelves(electionBodies, (flag) => bodySlugsWithFlag(councils, /** @type {Parameters<typeof bodySlugsWithFlag>[1]} */ (flag))),
      electionsHome: structuredClone(electionBodies.groups.electionsHome),
      entityHistory: structuredClone(electionBodies.groups.entityHistory)
    },
    'election-types.json': browserElectionTypes(electionTypes),
    'catalogue-kinds.json': browserCatalogueKinds(loadRegistry('catalogue-kinds', { root }))
  };
}

/**
 * The text a slice file holds.
 * @type {(slice: unknown) => string}
 */
export const sliceText = (slice) => `${JSON.stringify(slice, null, 1)}\n`;

/**
 * The same slice as a plain ES module (<name>.data.mjs), which each <name>.mjs re-exports. A JSON
 * import needs `with { type: 'json' }` in Node, and Cloudflare's Pages build image bundles
 * Functions with wrangler 3.114.17, whose esbuild rejects that syntax (it broke the build of
 * 4da15fa5c2 on 8 Nov 2026); a .mjs data module works in Node, every esbuild and TypeScript.
 * @type {(file: string, slice: unknown) => string}
 */
export const sliceModuleText = (file, slice) => `// Generated by packages/registries/src/browser/build.mjs from ${file}; do not edit.\nexport default ${JSON.stringify(slice, null, 1)};\n`;
/** @type {(file: string) => string} */
const moduleName = (file) => file.replace(/\.json$/, '.data.mjs');

/** Slice files (JSON and their .data.mjs twins) that differ from a fresh build (names). */
export function staleSlices(root = REPO_ROOT, dir = HERE) {
  /** @type {(file: string) => string} */
  const read = (file) => { try { return readFileSync(path.join(dir, file), 'utf8'); } catch { return ''; } };
  return Object.entries(browserSlices(root)).flatMap(([file, slice]) => [
    ...(read(file) !== sliceText(slice) ? [file] : []),
    ...(read(moduleName(file)) !== sliceModuleText(file, slice) ? [moduleName(file)] : []),
  ]);
}

// Also run through the re-export at packages/registries/src/browser/build.mjs (kept until 8 Dec 2026).
const isMain = Boolean(process.argv[1]) && /registries[\\/](?:src[\\/])?browser[\\/]build\.mjs$/.test(path.resolve(process.argv[1]));
if (isMain) {
  if (process.argv.includes('--check')) {
    const stale = staleSlices();
    if (stale.length) {
      console.error(`registries/browser: stale ${stale.join(', ')}; run node packages/registries/src/browser/build.mjs`);
      process.exit(1);
    }
    console.log('registries/browser: every slice matches the registries');
  } else {
    for (const [file, slice] of Object.entries(browserSlices())) {
      writeFileSync(path.join(HERE, file), sliceText(slice));
      writeFileSync(path.join(HERE, moduleName(file)), sliceModuleText(file, slice));
    }
    console.log(`registries/browser: wrote ${Object.keys(browserSlices()).join(', ')}`);
  }
}
