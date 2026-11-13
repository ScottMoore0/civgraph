// Loaded with `node --import` by harness.mjs (beside this file) before a publish script runs:
//
//   - every import of '@aws-sdk/client-s3' gets the recording stand-in (client-s3.mjs), and any
//     other '@aws-sdk/*' module fails to load, so the real SDK can never be reached;
//   - fetch() and outgoing sockets throw, so nothing in the run can touch the network;
//   - a wait of a second or more (a script's retry back-off) is logged with its length and
//     then taken at once, so a retry test costs no time and still shows the delays.
import { registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';
import net from 'node:net';

const FAKE = new URL('./client-s3.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@aws-sdk/client-s3') return { url: FAKE, shortCircuit: true };
    if (specifier.startsWith('@aws-sdk/')) throw new Error(`s3-fake: ${specifier} is not stubbed, and the real SDK may not load in a dry run`);
    return nextResolve(specifier, context);
  },
});

const refuse = (what) => () => { throw new Error(`s3-fake: no network in a dry run (${what})`); };
globalThis.fetch = refuse('fetch');
net.Socket.prototype.connect = refuse('socket');

const LOG_FILE = process.env.S3_FAKE_LOG;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = /** @type {typeof setTimeout} */ ((callback, ms, ...args) => {
  if (typeof ms === 'number' && ms >= 1000) {
    if (LOG_FILE) appendFileSync(LOG_FILE, `${JSON.stringify({ op: 'sleep', ms })}\n`);
    return realSetTimeout(callback, 0, ...args);
  }
  return realSetTimeout(callback, ms, ...args);
});
