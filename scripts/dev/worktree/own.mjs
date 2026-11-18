#!/usr/bin/env node
/**
 * npm run worktree:own -- <folder> [<folder>...] | --all
 *
 * In a worktree made by worktree:new, turn linked artefact folders (junctions to the shared
 * read-only snapshot) into local, writable copies, as the write guard does by itself on the
 * first write. For a builder run directly with node (not through npm, so without the guard)
 * that would otherwise stop on the snapshot's read-only files. <folder> is the path from the
 * worktree root, as worktree:new printed it.
 */
import { renameSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '@civgraph/config/node';
import { copyFolder, isLink, readState, removeLink, writeState } from './lib.mjs';

const args = process.argv.slice(2);
const state = readState(REPO_ROOT);
if (!state) {
  console.error(`FAIL: ${REPO_ROOT} was not made by npm run worktree:new (no tmp/worktree/state.json)`);
  process.exit(1);
}
const wanted = args.includes('--all') ? state.links.map((/** @type {{ rel: string }} */ l) => l.rel) : args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\\/g, '/').replace(/\/+$/, ''));
if (!wanted.length) {
  console.error('usage: npm run worktree:own -- <folder> [<folder>...] | --all');
  process.exit(2);
}
let failed = false;
for (const rel of wanted) {
  const link = state.links.find((/** @type {{ rel: string }} */ l) => l.rel === rel);
  if (!link) { console.error(`FAIL: ${rel} is not a linked folder here (${state.links.map((/** @type {{ rel: string }} */ l) => l.rel).join(', ')})`); failed = true; continue; }
  if (!isLink(link.wtAbs)) { console.log(`${rel}: already local`); link.state = 'local'; continue; }
  const staging = `${link.wtAbs}.local-${process.pid}`;
  copyFolder(link.target, staging, { writable: true });
  removeLink(link.wtAbs);
  renameSync(staging, link.wtAbs);
  link.state = 'local';
  console.log(`${rel}: now a local copy (${path.relative(REPO_ROOT, link.wtAbs)})`);
}
writeState(REPO_ROOT, state);
process.exit(failed ? 1 : 0);
