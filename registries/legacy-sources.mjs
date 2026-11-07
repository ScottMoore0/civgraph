/**
 * The scattered lists the registries replace, read from where they live today.
 *
 * Used twice: by registries/seed/*.mjs, which wrote the registry files from them once, and by the
 * parity tests (tests/unit/registries-*.test.mjs), which hold the registry to them until every
 * caller reads the registry instead (LANDING.md, "Requests to other streams"). When the last
 * literal is gone, this file and the parity half of those tests go with it.
 *
 * Most lists are module-level constants that their files do not export, so they are read from the
 * source text: the declarations between two markers are run in an empty VM context and the named
 * bindings returned. Python literals are converted to JSON. Nothing here writes a file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (rel, root = REPO_ROOT) => readFileSync(path.join(root, rel), 'utf8');
const readJson = (rel, root = REPO_ROOT) => JSON.parse(read(rel, root));

/** Run the JS declarations between `start` (inclusive) and `end` (exclusive); return `names`. */
export function evalDeclarations(rel, start, end, names, root = REPO_ROOT) {
  const text = read(rel, root);
  const from = text.indexOf(start);
  if (from < 0) throw new Error(`${rel}: start marker not found: ${start}`);
  const to = text.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`${rel}: end marker not found: ${end}`);
  const code = `${text.slice(from, to).replace(/^export /gm, '')}\n;({ ${names.join(', ')} })`;
  return vm.runInNewContext(code, {}, { filename: rel });
}

/** A Python list or dict literal assigned to `name` (strings, numbers, lists, tuples, dicts). */
export function pythonLiteral(rel, name, root = REPO_ROOT) {
  const text = read(rel, root);
  const at = text.search(new RegExp(`^${name}\\s*=\\s*[\\[{]`, 'm'));
  if (at < 0) throw new Error(`${rel}: ${name} not found`);
  const open = text.indexOf('=', at) + 1;
  let i = text.slice(open).search(/[[{]/) + open;
  const startChar = text[i];
  let depth = 0;
  let out = '';
  let quote = null;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { out += ch + text[i + 1]; i += 1; continue; }
      if (ch === quote) { quote = null; out += '"'; continue; }
      out += ch === '"' ? '\\"' : ch;
      continue;
    }
    if (ch === '#') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    if (ch === '"' || ch === "'") { quote = ch; out += '"'; continue; }
    if ('[{('.includes(ch)) depth += 1;
    if (']})'.includes(ch)) depth -= 1;
    out += ch === '(' ? '[' : ch === ')' ? ']' : ch;
    if (depth === 0) break;
  }
  if (!'[{'.includes(startChar)) throw new Error(`${rel}: ${name} is not a list or dict`);
  return JSON.parse(out.replace(/,(\s*[\]}])/g, '$1'));
}

/** Every council list the councils registry replaces, keyed by where it lives. */
export function councilSources(root = REPO_ROOT) {
  const manifest = evalDeclarations('scripts/build/build-test2-election-manifest.mjs',
    'const NI_COUNCILS_1923_67_BODY_SLUGS', 'const NAME_ALIASES',
    ['NI_COUNCILS_1923_67_BODY_SLUGS', 'PRE1973_COUNCIL_BODY_SLUGS', 'NI_COUNCILS_1923_67_RESULTS_ONLY_BODY_SLUGS',
      'PR1920_ONLY_COUNCIL_BODY_SLUGS', 'ARMAGH_PILOT_RESULTS_ONLY_BODY_SLUGS', 'LOCAL_GOVERNMENT_BODIES'], root);
  const electionNames = evalDeclarations('scripts/lib/election-names.mjs',
    'const NI_COUNCIL_ERA_TITLES', 'export function isElectionByElectionScope',
    ['NI_COUNCIL_ERA_TITLES', 'NI_COUNCILS_1923_67_PLAIN_TITLES', 'PRE1973_COUNCIL_BODIES'], root);
  const niLocalGroups = evalDeclarations('src/ni-local-groups.mjs',
    'export const NI_COUNCIL_SLUGS', '/** Whether a year is grouped',
    ['NI_COUNCIL_SLUGS'], root);
  const niLocalTiers = evalDeclarations('src/ni-local-groups.mjs',
    'export const NI_LOCAL_TIERS', '/** The kind of council a body slug names',
    ['NI_LOCAL_TIERS'], root);
  const search = evalDeclarations('src/catalogue/search.js',
    'const BODY_ALIASES', '/** The other names an election goes by',
    ['BODY_ALIASES', 'NI_COUNCILS_2014', 'NI_COUNCILS_1973', 'IRISH_COUNCILS'], root);
  const groupedStems = evalDeclarations('scripts/build/build-ni-local-grouped.mjs',
    'const AUTHORITY_STEM_ALIASES', '/** Every name a council',
    ['AUTHORITY_STEM_ALIASES'], root);
  return {
    manifest,
    electionNames,
    niCouncilSlugs: niLocalGroups.NI_COUNCIL_SLUGS,
    niLocalTiers: niLocalTiers.NI_LOCAL_TIERS,
    search,
    authorityStemAliases: groupedStems.AUTHORITY_STEM_ALIASES,
    councilWebsites: pythonLiteral('scripts/ingest/council-websites/scrape_26_councils.py', 'COUNCILS', root),
    wikipedia1973: pythonLiteral('scripts/ingest/wikipedia/scrape_old_lgov_wikipedia.py', 'COUNCILS', root),
    wikipedia1973Compare: pythonLiteral('scripts/ingest/wikipedia/scrape_and_compare_lgov_wikipedia.py', 'COUNCILS', root),
    wikipedia2014: pythonLiteral('scripts/ingest/wikipedia/modern_lgov_wikipedia_common.py', 'MODERN_COUNCILS', root),
    wikipedia2014Display: pythonLiteral('scripts/ingest/wikipedia/modern_lgov_wikipedia_common.py', 'COUNCIL_DISPLAY_BY_KEY', root),
    officesCouncils: pythonLiteral('scripts/ingest/facts/ef_offices.py', 'COUNCILS', root),
    electionsIndex: readJson('data/elections-source/data/elections_index.json', root),
    counties: readJson('data/elections/persons/ni-council-counties.json', root),
    geography: readJson('data/elections/persons/ni-council-geography.json', root),
    offices: readJson('data/offices/offices.json', root)
  };
}
