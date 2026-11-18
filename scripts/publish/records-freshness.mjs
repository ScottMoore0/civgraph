#!/usr/bin/env node
// @ts-check
/**
 * Is the records build in place a build of exactly the inputs now? The publish asks before it
 * builds (scripts/publish/publish.sh), and npm run rebuild before each records:build of its plan.
 *
 * The build writes inputs-manifest.json beside the database (packages/loader/src/publish-inputs.mjs):
 * the content of every records input as it began, where the votes came from and the order seed.
 * This computes the same manifest for the working tree now and compares. Content, not commits: a
 * build made before a commit of the same tree is current after it.
 *
 *   node scripts/publish/records-freshness.mjs     exit 0 and "CURRENT ..." when it is; exit 1 and
 *                                                 "STALE: <reasons>" when it is not
 */
import { pathToFileURL } from 'node:url';
import { recordPaths } from '@civgraph/config/node';
import { currentInputsManifest, readBuiltManifest, staleReasons } from '@civgraph/loader/publish-inputs.mjs';

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ current: boolean, line: string }}
 */
export function freshness(env = process.env) {
  const now = currentInputsManifest(env);
  const reasons = staleReasons({ env, dbFile: recordPaths(env).RECORDS_DB, now });
  if (reasons.length) return { current: false, line: `STALE: ${reasons.join('; ')}` };
  const built = readBuiltManifest(env);
  return { current: true, line: `CURRENT: built ${built?.builtAt || '?'} from these inputs (${now.files} records files, ${now.hash.slice(0, 8)}; votes ${now.votes})` };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const { current, line } = freshness();
    console.log(line);
    process.exitCode = current ? 0 : 1;
  } catch (error) {
    console.log(`STALE: the check failed (${/** @type {Error} */ (error).message.split('\n')[0]})`);
    process.exitCode = 1;
  }
}
