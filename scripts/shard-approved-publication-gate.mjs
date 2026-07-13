#!/usr/bin/env node
/**
 * Convert the approved-publication gate to (or refresh) the sharded layout:
 * a small manifest data/database/approved-publication-sources.json +
 * data/database/approved-publication-sources-shards/sources-NNN.json.
 *
 * Re-runnable: reads whichever layout is present (monolithic or sharded) and
 * rewrites the shards. Not a Pages-deployed file — this is about GitHub repo
 * file-size limits.
 *
 * Usage: node scripts/shard-approved-publication-gate.mjs
 */
import { readFileSync } from 'node:fs';
import { GATE_MANIFEST_REL, resolveApprovedPublicationSources, writeApprovedPublicationSources } from './lib/approved-publication-index.mjs';

const gate = JSON.parse(readFileSync(GATE_MANIFEST_REL, 'utf8'));
const sources = resolveApprovedPublicationSources(gate);
const { sources: _s, items: _i, ...meta } = gate;
const res = writeApprovedPublicationSources(meta, sources);
console.log(`Sharded gate: ${res.total} records across ${res.shardCount} shards; counts.total=${gate.counts?.total}`);
