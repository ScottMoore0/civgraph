import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// The approved-publication gate outgrew GitHub's 50 MB soft warning (it is not a
// Pages-deployed file — clean-for-pages strips it — so this is purely about repo
// file size). It is stored as a small manifest
//   { schemaVersion, counts, indexLayout: 'sharded', shards: [{ url, count }, …] }
// with the records split across repo-relative shard files
//   data/database/approved-publication-sources-shards/sources-000.json  ({ items: [...] })
// so no single tracked file approaches GitHub's limits and the gate can keep
// growing. Legacy monolithic { sources: [...] } / { items: [...] } files are
// still read transparently.

export const GATE_MANIFEST_REL = 'data/database/approved-publication-sources.json';
export const GATE_SHARD_DIR_REL = 'data/database/approved-publication-sources-shards';
const RECORDS_PER_SHARD = 3000;

/**
 * One source record of the gate: open-ended JSON, its fields set by the emitters.
 * @typedef {Record<string, unknown>} SourceRecord
 * @typedef {{ url?: string, count?: number }} ShardRef
 * @typedef {{ sources?: SourceRecord[], items?: SourceRecord[], indexLayout?: string, shards?: ShardRef[], [field: string]: unknown }} GateManifest
 *   a sharded manifest, or a legacy monolithic { sources } / { items } file
 */

/**
 * @param {GateManifest | null | undefined} index
 * @param {string} [root]
 * @returns {SourceRecord[]}
 */
export function resolveApprovedPublicationSources(index, root = process.cwd()) {
  if (!index) return [];
  if (Array.isArray(index.sources)) return index.sources;
  if (Array.isArray(index.items)) return index.items;
  if (index.indexLayout === 'sharded' && Array.isArray(index.shards)) {
    /** @type {SourceRecord[]} */
    const out = [];
    for (const shard of index.shards) {
      const rel = String(shard.url || '').replace(/^\/+/, '');
      const data = JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
      const items = Array.isArray(data.items) ? data.items : (Array.isArray(data.sources) ? data.sources : []);
      if (shard.count !== undefined && shard.count !== items.length) {
        throw new Error(`approved-publication shard ${shard.url} manifest count ${shard.count} != ${items.length}`);
      }
      out.push(...items);
    }
    return out;
  }
  return [];
}

// Read the gate (manifest or legacy) and return { manifest, sources }.
/**
 * @param {string} [root]
 * @param {string} [manifestRel]
 * @returns {{ manifest: GateManifest, sources: SourceRecord[] }}
 */
export function readApprovedPublicationGate(root = process.cwd(), manifestRel = GATE_MANIFEST_REL) {
  const manifest = JSON.parse(readFileSync(path.join(root, manifestRel), 'utf8'));
  return { manifest, sources: resolveApprovedPublicationSources(manifest, root) };
}

// Write the gate as a sharded manifest + shard files, replacing any prior shards.
// `meta` carries every manifest field except the records (schemaVersion, counts, …).
/**
 * @param {Record<string, unknown>} meta
 * @param {SourceRecord[]} sources
 * @param {string} [root]
 * @param {{ manifestRel?: string, shardDirRel?: string, recordsPerShard?: number }} [opts]
 */
export function writeApprovedPublicationSources(meta, sources, root = process.cwd(), opts = {}) {
  const manifestRel = opts.manifestRel || GATE_MANIFEST_REL;
  const shardDirRel = opts.shardDirRel || GATE_SHARD_DIR_REL;
  const perShard = opts.recordsPerShard || RECORDS_PER_SHARD;
  const shardDirAbs = path.join(root, shardDirRel);

  // clear stale shard files
  if (existsSync(shardDirAbs)) {
    for (const f of readdirSync(shardDirAbs)) if (/^sources-\d+\.json$/.test(f)) rmSync(path.join(shardDirAbs, f));
  } else {
    mkdirSync(shardDirAbs, { recursive: true });
  }

  const shards = [];
  for (let i = 0, n = 0; i < sources.length; i += perShard, n += 1) {
    const items = sources.slice(i, i + perShard);
    const name = `sources-${String(n).padStart(3, '0')}.json`;
    writeFileSync(path.join(shardDirAbs, name), JSON.stringify({ items }, null, 2) + '\n');
    shards.push({ url: `${shardDirRel}/${name}`, count: items.length });
  }
  if (sources.length === 0) {
    const name = 'sources-000.json';
    writeFileSync(path.join(shardDirAbs, name), JSON.stringify({ items: [] }, null, 2) + '\n');
    shards.push({ url: `${shardDirRel}/${name}`, count: 0 });
  }

  /** @type {GateManifest} */
  const manifest = { ...meta, indexLayout: 'sharded', shardCount: shards.length, shards };
  // drop any inline records that a legacy caller may have passed in meta
  delete manifest.sources;
  delete manifest.items;
  writeFileSync(path.join(root, manifestRel), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, shardCount: shards.length, total: sources.length };
}
