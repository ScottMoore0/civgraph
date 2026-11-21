/**
 * Each map's status in the agent maps index (/agent/maps-index.json, scripts/build/agent-index.mjs),
 * in the catalogue's own states:
 *
 * - `ready`: the site shows the map;
 * - `partial`: the site shows the map and marks it incomplete (maps.json `incomplete`);
 * - `to-be-added`: the catalogue lists the map as to be added (maps.json `placeholder`), or the map is
 *   hidden and is neither a copy of another map nor a part of one. Its entry keeps its metadata and
 *   gives no geometry link: the site does not show the file at that link.
 *
 * A hidden copy of another map (the catalogue source's `hidden[].to` naming a map, or the same
 * file as a map that is shown) points at that map (`sameAs`) and takes its status and geometry. A
 * hidden part of a map that is shown (named in that map's maps.json `variants`) points at it
 * (`partOf`) and keeps its own geometry, which the site shows as that part. No reason is given. Pure.
 */

/** @typedef {'ready' | 'partial' | 'to-be-added'} AgentMapStatus */

/**
 * A maps.json record, as far as the status reads it.
 * @typedef {object} StatusRecord
 * @property {string} id
 * @property {boolean} [hidden]
 * @property {boolean} [placeholder]
 * @property {boolean} [incomplete]
 * @property {{ fgb?: string }} [files]
 * @property {Array<string | { id?: string }>} [variants]
 */

/**
 * @typedef {object} AgentMapStatusOut
 * @property {AgentMapStatus} status
 * @property {string | null} geometryFrom  the record whose geometry the entry links to; null for none
 * @property {string} [sameAs]             a hidden copy: the map it points at
 * @property {string} [partOf]             a hidden part: the map it is shown as part of
 */

/**
 * A map's file without its cache token: ".../Counties_Ireland_1915.fgb?v=abc" -> ".../Counties_Ireland_1915.fgb".
 * @param {unknown} url
 * @returns {string}
 */
function fileKey(url) {
  return typeof url === 'string' ? (url.split('?')[0] || '') : '';
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
  /** @type {Map<string, string>} part id -> the shown record that lists it */
  const parentOf = new Map();
  // A map the site draws is preferred over one to be added that names the same file.
  for (const r of [...records.filter((x) => !x.placeholder), ...records.filter((x) => x.placeholder)]) {
    if (r.hidden) continue;
    const key = fileKey(r.files?.fgb);
    if (key && !shownByFile.has(key)) shownByFile.set(key, r.id);
  }
  for (const r of records) {
    if (r.hidden) continue;
    for (const v of r.variants || []) {
      const id = typeof v === 'string' ? v : v.id;
      if (id && id !== r.id && !parentOf.has(id)) parentOf.set(id, r.id);
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
    const parentId = parentOf.get(r.id);
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && ownStatus(parent) !== 'to-be-added') {
      const own = shown(r);
      out.set(r.id, { ...own, partOf: parent.id });
      continue;
    }
    out.set(r.id, { status: 'to-be-added', geometryFrom: null });
  }
  return out;
}
