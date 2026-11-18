/**
 * A map's credit as people read it: who made the layer (maps.json `provider`, names from the
 * provider registry) and what it was derived from. A layer built for Civgraph from other people's
 * maps (a Poor Law Union map grouped from Phelim Birch's and Paddy Matthews's DED maps) credits its
 * builder as provider and carries "Derived from ..." in `sourceCredits`, so the makers of the maps
 * underneath stay in view without being credited as its makers (owner-approved, 17 Nov 2026).
 * Every place that shows a map's credit (the catalogue rows and citation, the map's Sources panel,
 * the image export, the agent maps index) reads it through here. Pure.
 */

const DERIVED = /^derived from\s/i;

/**
 * The "Derived from ..." lines of a record's source credits, trimmed, each once.
 * @param {unknown} sourceCredits  maps.json / render-layer `sourceCredits`
 * @returns {string[]}
 */
export function derivedFromLines(sourceCredits) {
  if (!Array.isArray(sourceCredits)) return [];
  /** @type {string[]} */
  const out = [];
  for (const item of sourceCredits) {
    const line = typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : '';
    if (DERIVED.test(line) && !out.includes(line)) out.push(line);
  }
  return out;
}

/**
 * The derived-from lines of several records (a map and its render layer, or a row's maps), each once.
 * @param {...unknown} sourceCreditLists
 * @returns {string[]}
 */
export function mergedDerivedFromLines(...sourceCreditLists) {
  return derivedFromLines(sourceCreditLists.flatMap((list) => (Array.isArray(list) ? list : [])));
}

/**
 * Lines (as words) said as one when they differ only in the middle, or null when they cannot be.
 * @param {readonly string[][]} kept  two or more lines, none beginning another
 * @returns {string | null}
 */
function joinedLine(kept) {
  const shortest = Math.min(...kept.map((w) => w.length));
  let head = 0;
  while (head < shortest && kept.every((w) => w[head] === /** @type {string[]} two or more lines are given */ (kept[0])[head])) head += 1;
  let tail = 0;
  while (tail < shortest - head && kept.every((w) => w[w.length - 1 - tail] === /** @type {string[]} */ (kept[0])[/** @type {string[]} */ (kept[0]).length - 1 - tail])) tail += 1;
  const middles = kept.map((w) => w.slice(head, w.length - tail).join(' '));
  // Shared words beyond "Derived from the" make the lines one statement; fewer, and they name different maps.
  if (head + tail < 6 || middles.some((m) => !m)) return null;
  const list = middles.length === 2 ? middles.join(' and ') : `${middles.slice(0, -1).join(', ')} and ${middles[middles.length - 1]}`;
  return [.../** @type {string[]} */ (kept[0]).slice(0, head), list, .../** @type {string[]} */ (kept[0]).slice(/** @type {string[]} */ (kept[0]).length - tail)].join(' ');
}

/**
 * The derived-from lines of a row's maps said once for the row. A line that another line begins
 * with is left out (the longer one names the same map and more). Lines that differ only in the
 * middle are said as one, their middles listed: "Derived from the 1 Apr 1921, 1911 census and
 * 1907-12 District Electoral Division maps of Phelim Birch and Paddy Matthews". A line that joins
 * none of the others (the townland boundaries one map was also cut along) stays as it is, in its
 * place in the row's order.
 * @param {readonly string[]} lines  derived-from lines, in the row's order
 * @returns {string[]}
 */
export function combinedDerivedFromLines(lines) {
  const unique = derivedFromLines(lines);
  const words = unique.map((line) => line.split(' '));
  const startsWith = (/** @type {string[]} */ a, /** @type {string[]} */ b) => b.length < a.length && b.every((w, i) => a[i] === w);
  const kept = words.filter((w) => !words.some((other) => startsWith(other, w)));
  /** @type {string[][][]} */
  const groups = [];
  for (const w of kept) {
    const group = groups.find((g) => joinedLine([...g, w]) !== null);
    if (group) group.push(w);
    else groups.push([w]);
  }
  return groups.map((g) => (g.length < 2 ? /** @type {string[]} a group holds one line or more */ (g[0]).join(' ') : /** @type {string} */ (joinedLine(g))));
}

/**
 * One credit line: the providers, then what the layer was derived from.
 * "Scott Moore; derived from the 1911 census District Electoral Division maps of Phelim Birch and
 * Paddy Matthews". With no provider the derived line stands alone, capitalised as written.
 * @param {readonly (string | null | undefined)[]} providers  names as the caller shows them (full or short); blanks are skipped
 * @param {readonly string[]} derived  from derivedFromLines
 * @param {{ separator?: string }} [options]  between providers (default ", ")
 * @returns {string}
 */
export function creditLine(providers, derived, { separator = ', ' } = {}) {
  const names = [...new Set(providers.map((p) => String(p || '').trim()).filter(Boolean))].join(separator);
  const lines = derived.map((line, i) => (names || i > 0 ? line.replace(DERIVED, (m) => m.toLowerCase()) : line));
  return [names, ...lines].filter(Boolean).join('; ');
}
