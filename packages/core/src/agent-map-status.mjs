/**
 * Each map's status in the agent maps index (/agent/maps-index.json, scripts/build/agent-index.mjs),
 * in the catalogue's own states:
 *
 * - `ready`: the site shows the map;
 * - `partial`: the site shows the map and marks it incomplete (maps.json `incomplete`);
 * - `to-be-added`: the catalogue lists the map as to be added (maps.json `placeholder`), or the map is
 *   hidden, is neither a copy of another map nor a part of one, and is not retired (a hidden map
 *   waits to be added unless its record says it is retired). Its entry keeps its metadata and gives
 *   no geometry link: the site does not show the file at that link;
 * - `retired`: the map is hidden, is neither a copy nor a part, and its record is marked retired
 *   (maps.json `retired: true`): it is not coming back. No geometry link. `replacedBy` names the map
 *   to use instead, when the record names one (maps.json `replacedBy`, a map id).
 *
 * A hidden copy of another map (the catalogue source's `hidden[].to` naming a map, or the same
 * file as a map that is shown) points at that map (`sameAs`) and takes its status and geometry. A
 * hidden part of a map that is shown (named in that map's maps.json `variants`, by the variant's
 * `id` or `cloneOf`, or serving the same file as one of its variants) points at it (`partOf`) and
 * keeps its own geometry, which the site shows as that part. No reason is given. Pure.
 */

/** @typedef {'ready' | 'partial' | 'to-be-added' | 'retired'} AgentMapStatus */

/** The statuses, in the order the index counts them. @type {readonly AgentMapStatus[]} */
export const AGENT_MAP_STATUSES = Object.freeze(['ready', 'partial', 'to-be-added', 'retired']);

/**
 * A maps.json record, as far as the status reads it.
 * @typedef {object} StatusRecord
 * @property {string} id
 * @property {boolean} [hidden]
 * @property {boolean} [placeholder]
 * @property {boolean} [incomplete]
 * @property {boolean} [retired]       a hidden map that is not coming back
 * @property {string} [replacedBy]     a retired map: the map to use instead
 * @property {{ fgb?: string }} [files]
 * @property {Array<string | { id?: string, cloneOf?: string, files?: { fgb?: string } }>} [variants]
 */

/**
 * @typedef {object} AgentMapStatusOut
 * @property {AgentMapStatus} status
 * @property {string | null} geometryFrom  the record whose geometry the entry links to; null for none
 * @property {string} [sameAs]             a hidden copy: the map it points at
 * @property {string} [partOf]             a hidden part: the map it is shown as part of
 * @property {string} [replacedBy]         a retired map: the map to use instead
 */

/**
 * A map's file without its cache token, its escapes decoded: ".../Electoral%20Divisions/X.fgb?v=abc"
 * -> ".../Electoral Divisions/X.fgb" (the data spells one file both ways).
 * @param {unknown} url
 * @returns {string}
 */
function fileKey(url) {
  if (typeof url !== 'string') return '';
  const path = url.split('?')[0] || '';
  try { return decodeURI(path); } catch { return path; }
}

/**
 * The state of a record the site shows, from its own flags.
 * @param {StatusRecord} record
 * @returns {AgentMapStatus}
 */
function ownStatus(record) {
  if (record.placeholder) return 'to-be-added';
  return record.incomplete ? 'partial' : 'ready';
}

/**
 * Add a value to a list in a map of lists.
 * @param {Map<string, string[]>} lists
 * @param {string} key
 * @param {string} value
 */
function push(lists, key, value) {
  const list = lists.get(key);
  if (list) { if (!list.includes(value)) list.push(value); } else lists.set(key, [value]);
}

/**
 * The status of every record, keyed by id.
 * @param {StatusRecord[]} records  maps.json `maps`
 * @param {Record<string, string>} [copyOf]  map id -> the map it duplicates (catalogue source `hidden[].to`, map ids only)
 * @returns {Map<string, AgentMapStatusOut>}
 */
export function agentMapStatuses(records, copyOf = {}) {
  /** @type {Map<string, StatusRecord>} */
  const byId = new Map(records.map((r) => [r.id, r]));
  /** @type {Map<string, string>} file -> the first shown record that serves it */
  const shownByFile = new Map();
  /** @type {Map<string, string[]>} part id -> the shown records that list it (by variant id or cloneOf) */
  const parentsById = new Map();
  /** @type {Map<string, string[]>} file -> the shown records with a variant that serves it */
  const parentsByFile = new Map();
  // A map the site draws is preferred over one to be added that names the same file.
  for (const r of [...records.filter((x) => !x.placeholder), ...records.filter((x) => x.placeholder)]) {
    if (r.hidden) continue;
    const key = fileKey(r.files?.fgb);
    if (key && !shownByFile.has(key)) shownByFile.set(key, r.id);
  }
  for (const r of records) {
    if (r.hidden) continue;
    for (const v of r.variants || []) {
      const ids = typeof v === 'string' ? [v] : [v.id, v.cloneOf];
      for (const id of ids) if (id && id !== r.id) push(parentsById, id, r.id);
      const key = typeof v === 'string' ? '' : fileKey(v.files?.fgb);
      if (key) push(parentsByFile, key, r.id);
    }
  }
  /** @type {Map<string, AgentMapStatusOut>} */
  const out = new Map();
  /** @param {StatusRecord} r @returns {AgentMapStatusOut} */
  const shown = (r) => {
    const status = ownStatus(r);
    return { status, geometryFrom: status === 'to-be-added' ? null : r.id };
  };
  for (const r of records) {
    const named = copyOf[r.id];
    const namedTarget = named && named !== r.id ? byId.get(named) : undefined;
    const sameFile = r.hidden ? shownByFile.get(fileKey(r.files?.fgb)) : undefined;
    const target = namedTarget && !namedTarget.hidden ? namedTarget : (sameFile && sameFile !== r.id ? byId.get(sameFile) : undefined);
    if (target) {
      const t = shown(target);
      out.set(r.id, { ...t, sameAs: target.id });
      continue;
    }
    if (!r.hidden) { out.set(r.id, shown(r)); continue; }
    const key = fileKey(r.files?.fgb);
    const parentIds = [...(parentsById.get(r.id) || []), ...((key && parentsByFile.get(key)) || [])];
    const parent = parentIds.map((id) => byId.get(id)).find((p) => p && p.id !== r.id && ownStatus(p) !== 'to-be-added');
    if (parent) {
      const own = shown(r);
      out.set(r.id, { ...own, partOf: parent.id });
      continue;
    }
    if (r.retired === true) {
      const replacement = typeof r.replacedBy === 'string' && r.replacedBy !== r.id && byId.has(r.replacedBy) ? r.replacedBy : undefined;
      out.set(r.id, replacement ? { status: 'retired', geometryFrom: null, replacedBy: replacement } : { status: 'retired', geometryFrom: null });
      continue;
    }
    out.set(r.id, { status: 'to-be-added', geometryFrom: null });
  }
  return out;
}
