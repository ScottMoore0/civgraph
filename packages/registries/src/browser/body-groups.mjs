// How a value (a body slug, or an election's type label) is placed in a group of the election-bodies
// registry's `groups` (data/registries/election-bodies.json): the first group whose `match` it meets.
// Hand-written and pure, so the Node views (packages/registries/src/election-bodies.mjs), the map app
// and the served Elections app (at /pkg/, packages/served.json) place it the same way.

/**
 * What a group takes: one of `bodies`, a value starting with one of `prefixes`, containing one of
 * `contains`, or matching `pattern` (case-insensitive).
 * @typedef {{ bodies?: string[], prefixes?: string[], contains?: string[], pattern?: string }} GroupMatch
 */
/** @typedef {{ label: string, match: GroupMatch }} LabelledGroup */
/** @typedef {{ groups: LabelledGroup[], fallback: string, order: string[] }} LabelledGroups */

/**
 * Whether a value meets a group's match.
 * @param {GroupMatch} match
 * @param {string} value
 * @returns {boolean}
 */
export function meetsMatch(match, value) {
  if (match.bodies?.includes(value)) return true;
  if (match.prefixes?.some((prefix) => value.startsWith(prefix))) return true;
  if (match.contains?.some((part) => value.includes(part))) return true;
  return Boolean(match.pattern && new RegExp(match.pattern, 'i').test(value));
}

/**
 * The first group of a list whose match the value meets, or null.
 * @template {{ match: GroupMatch }} G
 * @param {readonly G[]} groups
 * @param {unknown} value
 * @returns {G | null}
 */
export function firstGroup(groups, value) {
  const text = String(value ?? '');
  return groups.find((group) => meetsMatch(group.match, text)) || null;
}

/**
 * The label of the group a value is placed in, or the list's fallback.
 * @param {LabelledGroups} list
 * @param {unknown} value
 * @returns {string}
 */
export function groupLabel(list, value) {
  return firstGroup(list.groups, value)?.label ?? list.fallback;
}
