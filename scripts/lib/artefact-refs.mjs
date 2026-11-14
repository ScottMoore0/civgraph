/**
 * References to generated artefacts in config/worktrees.json, resolved to paths: { records: KEY }
 * names a key of recordPaths() (packages/config/src/node.mjs), { repo: 'a/b' } a path from the
 * repository root, and an optional file: 'x.json' a file inside either. Pure: the record paths
 * and the existence test are passed in.
 */
import path from 'node:path';

/** @typedef {{ records?: string, repo?: string, file?: string }} ArtefactRef */

/**
 * The absolute path of an artefact reference.
 * @param {ArtefactRef} ref
 * @param {Record<string, string | null>} records recordPaths()
 * @param {string} root the checkout's root
 */
export function artefactPath(ref, records, root) {
  let abs;
  if (ref.records) {
    abs = records[ref.records];
    if (!abs) throw new Error(`config/worktrees.json: recordPaths() has no ${ref.records}`);
  } else if (ref.repo) {
    abs = path.join(root, ...ref.repo.split('/'));
  } else {
    throw new Error(`config/worktrees.json: an artefact needs "records" or "repo": ${JSON.stringify(ref)}`);
  }
  return ref.file ? path.join(abs, ref.file) : abs;
}

/**
 * The artefacts a check step needs that are absent, as paths from the root (forward slashes).
 * @param {string} step
 * @param {Record<string, ArtefactRef[] | string>} needs config/worktrees.json checkNeeds
 * @param {{ records: Record<string, string | null>, root: string, exists: (p: string) => boolean }} env
 * @returns {string[]}
 */
export function missingNeeds(step, needs, { records, root, exists }) {
  const refs = needs[step];
  if (!Array.isArray(refs)) return [];
  return refs.map((ref) => artefactPath(ref, records, root))
    .filter((abs) => !exists(abs))
    .map((abs) => path.relative(root, abs).split(path.sep).join('/'));
}
