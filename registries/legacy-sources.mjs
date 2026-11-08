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

/** `read()`, or null once the literal it reads has gone (its caller reads the registry now). */
function optional(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * The council lists the councils registry replaces that still exist, keyed by where they live;
 * null for a list whose literal is gone. Gone (r2-pipeline, 7 Nov 2026): the manifest builder's
 * six council sets, scripts/lib/election-names.mjs's three lists and the grouped build's
 * AUTHORITY_STEM_ALIASES; and (reg-app, 8 Nov 2026) the map app's: src/ni-local-groups.mjs's
 * NI_COUNCIL_SLUGS and NI_LOCAL_TIERS and src/catalogue/search.js's council lists and aliases,
 * which read registries/browser/councils.json. With the first went registries/seed/councils.mjs: since then
 * data/registries/councils.json is the source, edited by hand and checked by
 * node registries/check.mjs and tests/unit/registries-councils.test.mjs.
 */
export function councilSources(root = REPO_ROOT) {
  const py = (rel, name) => optional(() => pythonLiteral(rel, name, root));
  return {
    councilWebsites: py('scripts/ingest/council-websites/scrape_26_councils.py', 'COUNCILS'),
    wikipedia1973: py('scripts/ingest/wikipedia/scrape_old_lgov_wikipedia.py', 'COUNCILS'),
    wikipedia1973Compare: py('scripts/ingest/wikipedia/scrape_and_compare_lgov_wikipedia.py', 'COUNCILS'),
    wikipedia2014: py('scripts/ingest/wikipedia/modern_lgov_wikipedia_common.py', 'MODERN_COUNCILS'),
    wikipedia2014Display: py('scripts/ingest/wikipedia/modern_lgov_wikipedia_common.py', 'COUNCIL_DISPLAY_BY_KEY'),
    officesCouncils: py('scripts/ingest/facts/ef_offices.py', 'COUNCILS'),
    electionsIndex: readJson('data/elections-source/data/elections_index.json', root),
    counties: readJson('data/elections/persons/ni-council-counties.json', root),
    geography: readJson('data/elections/persons/ni-council-geography.json', root),
    offices: readJson('data/offices/offices.json', root)
  };
}
