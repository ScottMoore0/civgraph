// @ts-check
/**
 * The comparison behind verify-map-mirror.mjs: is the local mirror of the served map files
 * (data/maps/ in the working tree) the same as the live objects in R2 (served at
 * data.civgraph.net/data/maps/)? Pure: no file system, no network, so the unit tests
 * (tests/unit/map-mirror-parity.test.mjs) run it on fixtures.
 *
 * Why: the builds read the local mirror, not R2 (timeline-changes.py resolves a map's
 * files.fgb to data/maps/...). On 21 Nov 2026 twelve local files were older than the live ones
 * (uploads of 16 Aug 2026 never copied back), and the timeline builder produced change-panel
 * text the site did not match. Nothing said so; this check does.
 *
 * What is compared, per file:
 *   1. size: a different size is stale, with nothing to hash;
 *   2. content: R2's S3 ETag is the MD5 of the bytes for a single-part upload, so the local MD5
 *      must equal it. A multipart upload's ETag is "<md5 of the parts' MD5s>-<parts>"; the
 *      local file is cut into parts of each plausible part size (PART_SIZE of r2-put-file.mjs,
 *      8 MiB, first, then the other common sizes that give the same number of parts) and the
 *      same ETag is computed. A match on any of them is a match. When none matches, every
 *      other whole-MiB part size from 5 to 128 MiB with that many parts is tried, and a file
 *      none of them reproduces is stale (see compareFile). No object bytes are read: the bucket
 *      is only listed.
 */
import { createHash } from 'node:crypto';

/** The mirrored prefix, the same key in the bucket and path in the working tree. */
export const MIRROR_PREFIX = 'data/maps/';
/** Local folders under the prefix that are not mirrors (the owner's local archive). */
export const LOCAL_ONLY_DIRS = Object.freeze(['data/maps/_archive/']);
/** Geometry the builds read (timeline changes, the NI council rounds, the catalogue). */
const BUILD_INPUT = /\.(fgb|geojson|gpkg)$/i;
const MIB = 1024 * 1024;
/** Part sizes tried for a multipart ETag, most likely first (8 MiB: scripts/publish/r2-put-file.mjs PART_SIZE). */
export const PART_SIZES = Object.freeze([8, 5, 10, 16, 15, 20, 25, 32, 50, 64, 100, 128].map((n) => n * MIB));
/** Then every other whole number of MiB from 5 to 128, tried only when none of those matches. */
export const ALL_PART_SIZES = Object.freeze([...PART_SIZES, ...Array.from({ length: 124 }, (_, i) => (i + 5) * MIB).filter((p) => !PART_SIZES.includes(p))]);

/**
 * @typedef {object} Reference
 * @property {boolean} build        a build reads it (geometry named by the catalogue or the layer metadata)
 * @property {Set<string>} from     where it is named ("maps.json files.fgb", a chunk index's path)
 */
/** @typedef {{ size: number, mtimeMs: number }} LocalFile */
/** @typedef {{ size: number | null, etag: string | null, uploaded: string | null }} RemoteObject */
/**
 * What is known of a local file's bytes: its MD5 (hex) and the multipart ETags it gives,
 * by part size. Only what was needed is computed.
 * @typedef {{ md5?: string, multipart?: Record<string, string> }} Digest
 */
/**
 * @typedef {'match' | 'stale' | 'missing-local' | 'missing-remote' | 'unverified'} Verdict
 *   unverified: equal size, content not proven (multipart part size unknown, or not hashed)
 */
/**
 * @typedef {object} Row
 * @property {string} key
 * @property {Verdict} verdict
 * @property {string} why                 a few words: 'size', 'md5', 'multipart 8 MiB parts', 'not hashed'
 * @property {'build' | 'referenced' | 'unreferenced'} scope
 * @property {LocalFile | null} local
 * @property {RemoteObject | null} remote
 * @property {string[]} from
 */

/**
 * The bucket key a catalogue value names under the mirror prefix, or null. A value is a whole
 * string: an absolute URL on the data origin, or a repository path. Prose and other hosts are
 * null, and so is a tile template ({z}/{x}/{y}), which names no single object.
 * @param {unknown} raw
 * @param {string} dataOrigin   e.g. https://data.civgraph.net (SITE.dataOrigin)
 * @returns {string | null}
 */
export function mirrorKey(raw, dataOrigin) {
  if (typeof raw !== 'string' || !raw || /\s{2}|\n/.test(raw)) return null;
  if (/\{[zxy]\}/.test(raw)) return null;
  let p = raw.trim();
  const origin = dataOrigin.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(p)) {
    if (!p.toLowerCase().startsWith(`${origin.toLowerCase()}/`)) return null;
    p = p.slice(origin.length);
  }
  p = /** @type {string} */ (/** @type {string} */ (p.split('#')[0]).split('?')[0]).replace(/^\/+/, '');
  try { p = decodeURIComponent(p); } catch { /* keep it as written */ }
  if (!p.startsWith(MIRROR_PREFIX) || p.endsWith('/')) return null;
  return p;
}

/** @param {string} key */
export function isLocalOnly(key) {
  return LOCAL_ONLY_DIRS.some((dir) => key.startsWith(dir));
}

/**
 * Every mirrored key the catalogue (data/database/maps.json `maps`), the layer metadata
 * (render/metadata/maps-test.json `layers`) and the chunk indexes name. A geometry file named
 * by the catalogue or the layers is a build input; images, downloads, references and chunk
 * parts are referenced only.
 * @param {{ maps?: unknown[], layers?: unknown[], chunkIndexes?: Array<{ path: string, doc: unknown }> }} sources
 * @param {{ dataOrigin: string }} options
 * @returns {Map<string, Reference>}
 */
export function collectReferences({ maps = [], layers = [], chunkIndexes = [] }, { dataOrigin }) {
  /** @type {Map<string, Reference>} */
  const refs = new Map();
  /** @param {string} key @param {string} from @param {boolean} build */
  const note = (key, from, build) => {
    const ref = refs.get(key) || { build: false, from: new Set() };
    ref.build ||= build;
    ref.from.add(from);
    refs.set(key, ref);
  };
  /** @param {unknown} node @param {string} file @param {string[]} trail */
  const walk = (node, file, trail) => {
    if (Array.isArray(node)) { for (const v of node) walk(v, file, trail); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, file, [...trail, k]);
      return;
    }
    const key = mirrorKey(node, dataOrigin);
    if (key) note(key, `${file} ${trail.join('.')}`, BUILD_INPUT.test(key));
  };
  for (const m of maps) walk(m, 'maps.json', []);
  for (const l of layers) walk(l, 'maps-test.json', []);
  for (const { path, doc } of chunkIndexes) {
    const chunks = /** @type {{ chunks?: Array<{ file?: unknown, zoomFiles?: Record<string, unknown> }> }} */ (doc || {}).chunks || [];
    for (const c of chunks) {
      for (const value of [c.file, ...Object.values(c.zoomFiles || {})]) {
        const key = mirrorKey(value, dataOrigin);
        if (key) note(key, path, false);
      }
    }
  }
  return refs;
}

/**
 * An S3 ETag, unquoted: { md5 } for a single-part upload, { md5, parts } for a multipart one
 * (the md5 then being of the parts' digests, not of the file). Null when it is neither.
 * @param {string | null | undefined} etag
 * @returns {{ md5: string, parts: number | null } | null}
 */
export function parseEtag(etag) {
  const m = /^(?:W\/)?"?([0-9a-f]{32})(?:-(\d+))?"?$/i.exec(String(etag || '').trim());
  if (!m) return null;
  return { md5: /** @type {string} */ (m[1]).toLowerCase(), parts: m[2] ? Number(m[2]) : null };
}

/**
 * The part sizes that cut `size` bytes into exactly `parts` parts, in the order given.
 * @param {number} size
 * @param {number} parts
 * @param {readonly number[]} [sizes]
 */
export function candidatePartSizes(size, parts, sizes = ALL_PART_SIZES) {
  return sizes.filter((p) => Math.ceil(size / p) === parts);
}

/**
 * One file's verdict. `digest` is consulted only when the sizes agree; pass what was computed
 * (an absent digest of a file that needed one is "unverified: not hashed").
 *
 * A multipart ETag no tried part size reproduces is "unverified" until every whole-MiB part size
 * from 5 to 128 MiB that gives that many parts has been tried, and then "stale": on this bucket
 * every multipart object the mirror holds unchanged matches at 8 or 5 MiB (23 Nov 2026: 102 of
 * 102), and a same-size, changed file (DEDs_Connacht_1919.fgb before the 21 Nov refresh) shows
 * exactly as no match. The reason says so, for whoever reads the list.
 * @param {{ local: LocalFile | null, remote: RemoteObject | null, digest?: Digest | null }} input
 * @returns {{ verdict: Verdict, why: string }}
 */
export function compareFile({ local, remote, digest = null }) {
  if (!local && !remote) return { verdict: 'missing-remote', why: 'neither' };
  if (!local) return { verdict: 'missing-local', why: 'not mirrored' };
  if (!remote) return { verdict: 'missing-remote', why: 'not in the bucket' };
  if (remote.size !== null && remote.size !== local.size) return { verdict: 'stale', why: 'size' };
  const etag = parseEtag(remote.etag);
  if (!etag) return { verdict: 'unverified', why: 'no usable ETag' };
  if (etag.parts === null) {
    if (!digest?.md5) return { verdict: 'unverified', why: 'not hashed' };
    return digest.md5 === etag.md5 ? { verdict: 'match', why: 'md5' } : { verdict: 'stale', why: 'md5' };
  }
  const candidates = candidatePartSizes(local.size, etag.parts);
  if (!candidates.length) return { verdict: 'unverified', why: `multipart (${etag.parts} parts), no part size of 5-128 MiB gives that many` };
  const tried = digest?.multipart || {};
  const wanted = `${etag.md5}-${etag.parts}`;
  const hit = Object.entries(tried).find(([, value]) => value === wanted);
  if (hit) return { verdict: 'match', why: `multipart ${Number(hit[0]) / MIB} MiB parts` };
  if (candidates.every((p) => tried[String(p)])) return { verdict: 'stale', why: `multipart ETag: no part size of 5-128 MiB reproduces it (${candidates.length} tried)` };
  return { verdict: 'unverified', why: 'not hashed' };
}

/**
 * What must be hashed next to judge a file: nothing (a size or presence difference decides it,
 * or what was hashed already does), its MD5, or multipart ETags at some part sizes: first the
 * likely ones (PART_SIZES), and only when none of them matches, every other candidate.
 * @param {LocalFile | null} local
 * @param {RemoteObject | null} remote
 * @param {Digest | null} [digest]  what is already known
 * @returns {{ md5: boolean, partSizes: number[] }}
 */
export function digestNeeded(local, remote, digest = null) {
  const none = { md5: false, partSizes: [] };
  if (!local || !remote || (remote.size !== null && remote.size !== local.size)) return none;
  const etag = parseEtag(remote.etag);
  if (!etag) return none;
  if (etag.parts === null) return digest?.md5 ? none : { md5: true, partSizes: [] };
  const tried = digest?.multipart || {};
  if (Object.values(tried).includes(`${etag.md5}-${etag.parts}`)) return none;
  const untried = (/** @type {readonly number[]} */ sizes) => candidatePartSizes(local.size, /** @type {number} */ (etag.parts), sizes).filter((p) => !tried[String(p)]);
  const likely = untried(PART_SIZES);
  return { md5: false, partSizes: likely.length ? likely : untried(ALL_PART_SIZES) };
}

/**
 * A digester fed a file's bytes in order (chunks of any size): its MD5 when `md5`, and the
 * multipart ETag ("<md5 of the parts' MD5s>-<parts>") for each part size in `partSizes`, all in
 * one pass. No I/O: the caller streams the file in.
 * @param {{ md5: boolean, partSizes: number[] }} need
 */
export function createDigester({ md5, partSizes }) {
  const whole = md5 ? createHash('md5') : null;
  const cuts = partSizes.map((size) => ({ size, filled: 0, part: createHash('md5'), parts: /** @type {Buffer[]} */ ([]) }));
  return {
    /** @param {Uint8Array} chunk */
    update(chunk) {
      whole?.update(chunk);
      for (const cut of cuts) {
        for (let offset = 0; offset < chunk.length;) {
          const take = Math.min(cut.size - cut.filled, chunk.length - offset);
          cut.part.update(chunk.subarray(offset, offset + take));
          cut.filled += take;
          offset += take;
          if (cut.filled === cut.size) { cut.parts.push(cut.part.digest()); cut.part = createHash('md5'); cut.filled = 0; }
        }
      }
    },
    /** @returns {Digest} */
    result() {
      /** @type {Digest} */
      const out = {};
      if (whole) out.md5 = whole.digest('hex');
      if (cuts.length) {
        out.multipart = {};
        for (const cut of cuts) {
          if (cut.filled > 0) cut.parts.push(cut.part.digest());
          out.multipart[String(cut.size)] = `${createHash('md5').update(Buffer.concat(cut.parts)).digest('hex')}-${cut.parts.length}`;
        }
      }
      return out;
    },
  };
}

/**
 * The folders to list in the bucket (one delimited listing each): those of the local files and
 * of the referenced keys. The whole prefix is far too big to list (tile pyramids live under it).
 * @param {Iterable<string>} keys
 */
export function foldersOf(keys) {
  const out = new Set();
  for (const key of keys) out.add(key.slice(0, key.lastIndexOf('/') + 1));
  return [...out].sort();
}

/**
 * The rows, one per key that is local or referenced. Remote objects in a listed folder that
 * are neither are not rows (the bucket holds much the mirror does not).
 * @param {{ refs: Map<string, Reference>, local: Map<string, LocalFile>, remote: Map<string, RemoteObject>, digests: Map<string, Digest> }} input
 * @returns {Row[]}
 */
export function compareMirror({ refs, local, remote, digests }) {
  const keys = new Set([...refs.keys(), ...local.keys()]);
  /** @type {Row[]} */
  const rows = [];
  for (const key of [...keys].sort()) {
    if (isLocalOnly(key)) continue;
    const ref = refs.get(key);
    const l = local.get(key) || null;
    const r = remote.get(key) || null;
    const { verdict, why } = compareFile({ local: l, remote: r, digest: digests.get(key) || null });
    rows.push({ key, verdict, why, scope: ref ? (ref.build ? 'build' : 'referenced') : 'unreferenced', local: l, remote: r, from: ref ? [...ref.from].sort() : [] });
  }
  return rows;
}

/**
 * Counts by scope and verdict.
 * @param {Row[]} rows
 */
export function summarise(rows) {
  /** @type {Record<string, Record<Verdict, number>>} */
  const out = {};
  for (const row of rows) {
    const scope = out[row.scope] ||= { match: 0, stale: 0, 'missing-local': 0, 'missing-remote': 0, unverified: 0 };
    scope[row.verdict] += 1;
  }
  return out;
}

/**
 * Non-zero when a file a build reads is stale (the one failure: everything else is reported).
 * @param {Row[]} rows
 */
export function exitCodeFor(rows) {
  return rows.some((row) => row.scope === 'build' && row.verdict === 'stale') ? 1 : 0;
}

/** @param {number | null | undefined} n */
const bytes = (n) => (typeof n === 'number' ? n.toLocaleString('en-GB') : '?');
/** @param {number | null | undefined} ms */
const day = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '?');

/**
 * The report's lines: a count table, then each stale file (local and remote size and date),
 * then the other lists, each cut at `limit` lines.
 * @param {Row[]} rows
 * @param {{ limit?: number }} [options]
 * @returns {string[]}
 */
export function formatReport(rows, { limit = 40 } = {}) {
  const counts = summarise(rows);
  const lines = ['', '  scope          match  stale  missing-local  missing-remote  unverified'];
  for (const scope of ['build', 'referenced', 'unreferenced']) {
    const c = counts[scope];
    if (!c) continue;
    lines.push(`  ${scope.padEnd(13)}${String(c.match).padStart(6)}${String(c.stale).padStart(7)}${String(c['missing-local']).padStart(15)}${String(c['missing-remote']).padStart(16)}${String(c.unverified).padStart(12)}`);
  }
  /** @param {string} title @param {Row[]} list @param {(row: Row) => string} line */
  const section = (title, list, line) => {
    if (!list.length) return;
    lines.push('', `  ${title}: ${list.length}`);
    for (const row of list.slice(0, limit)) lines.push(line(row));
    if (list.length > limit) lines.push(`    ... and ${list.length - limit} more`);
  };
  const stale = (/** @type {Row} */ row) => `    ${row.key}\n      local  ${bytes(row.local?.size)} B, modified ${day(row.local?.mtimeMs)}\n      R2     ${bytes(row.remote?.size)} B, uploaded ${row.remote?.uploaded ? row.remote.uploaded.slice(0, 16).replace('T', ' ') : '?'}  (differs by ${row.why})`;
  const pick = (/** @type {string} */ scope, /** @type {Verdict} */ verdict) => rows.filter((r) => r.scope === scope && r.verdict === verdict);
  section('STALE, read by the builds', pick('build', 'stale'), stale);
  section('stale, referenced (images, downloads, chunk parts)', pick('referenced', 'stale'), stale);
  section('stale, unreferenced local files', pick('unreferenced', 'stale'), stale);
  const withFrom = (/** @type {Row} */ row) => `    ${row.key}${row.from.length ? `   (${row.from.slice(0, 2).join('; ')}${row.from.length > 2 ? '; ...' : ''})` : ''}`;
  section('missing-local, read by the builds (named, not mirrored)', pick('build', 'missing-local'), withFrom);
  section('missing-remote, read by the builds (mirrored, not in the bucket)', pick('build', 'missing-remote'), withFrom);
  section('missing-remote, referenced', pick('referenced', 'missing-remote'), withFrom);
  section('unverified, read by the builds (same size)', pick('build', 'unverified'), (row) => `    ${row.key}   (${row.why})`);
  return lines;
}
