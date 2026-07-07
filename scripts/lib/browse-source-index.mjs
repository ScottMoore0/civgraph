import { readFileSync } from 'node:fs';
import path from 'node:path';

// The Browse "sources" aggregate search index outgrew the 25 MB Cloudflare Pages
// per-file limit, so it is emitted as a shard manifest ({ indexLayout: 'sharded',
// shards: [{ url, count }, ...] }) instead of a monolithic { items: [...] }.
// This resolver transparently returns the flat items[] for either layout so
// consumers (validators, graph build) need no per-call branching.
//
// `root` defaults to the current working directory — every script that reads the
// index runs from the repo root, and shard urls are site-absolute
// (/data/browse/source-index-shards/sources-000.json).
export function resolveBrowseSourceItems(index, root = process.cwd()) {
  if (Array.isArray(index?.items)) return index.items;
  if (index?.indexLayout === 'sharded' && Array.isArray(index.shards)) {
    const items = [];
    for (const shard of index.shards) {
      const rel = String(shard.url || '').replace(/^\/+/, '');
      const shardData = JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
      const shardItems = Array.isArray(shardData.items) ? shardData.items : [];
      if (shard.count !== undefined && shard.count !== shardItems.length) {
        throw new Error(`sources index shard ${shard.url} manifest count ${shard.count} != ${shardItems.length}`);
      }
      items.push(...shardItems);
    }
    return items;
  }
  return [];
}
