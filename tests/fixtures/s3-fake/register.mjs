// Loaded with `node --import` by harness.mjs (beside this file) before a publish script runs:
//
//   - every import of '@aws-sdk/client-s3' gets the recording stand-in (client-s3.mjs), and any
//     other '@aws-sdk/*' module fails to load, so the real SDK can never be reached;
//   - fetch() and outgoing sockets throw, so nothing in the run can touch the network;
//   - a wait of a second or more (a script's retry back-off) is logged with its length and
//     then taken at once, so a retry test costs no time and still shows the delays;
//   - `spawn('npx', ['wrangler', 'r2', 'object', 'put', ...])` (how r2-upload-pmtiles uploaded
//     before it moved onto the S3 store) runs a recording stand-in for wrangler instead, which
//     logs the object it would have written; any other npx command is refused.
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import path from 'node:path';
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

// The wrangler stand-in. `wrangler r2 object put <bucket>/<key> --file <path> [--content-type T]
// [--content-encoding E] [--remote]` reads the file and logs { op: 'wrangler', args, written },
// where `written` is the object R2 would hold: wrangler 4 sends one PUT to the Cloudflare REST API
// with only the headers given (no Cache-Control, no metadata). As wrangler 4.85 does, it refuses a
// file over 300 MiB (MAX_UPLOAD_SIZE_BYTES) and exits 1. A state `fail` entry
// { op: 'wrangler-put', key, times? } makes it exit 1 as an API error would.
const WRANGLER_MAX_BYTES = 300 * 1024 * 1024;
const STATE = process.env.S3_FAKE_STATE ? JSON.parse(readFileSync(process.env.S3_FAKE_STATE, 'utf8')) : {};
const wranglerFailures = (STATE.fail || []).filter((f) => f.op === 'wrangler-put').map((f) => ({ ...f, left: f.times ?? 1 }));
const log = (entry) => { if (LOG_FILE) appendFileSync(LOG_FILE, `${JSON.stringify(entry)}
`); };

/** @param {string[]} args  after 'wrangler' */
function fakeWrangler(args) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const finish = (code, out, err) => realSetTimeout(() => {
    if (out) child.stdout.emit('data', out);
    if (err) child.stderr.emit('data', err);
    child.emit('close', code);
  }, 0);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args[0] !== 'r2' || args[1] !== 'object' || args[2] !== 'put') throw new Error(`s3-fake: wrangler ${args.slice(0, 3).join(' ')} is not stubbed`);
  const target = args[3];
  const slash = target.indexOf('/');
  const Bucket = target.slice(0, slash);
  const Key = target.slice(slash + 1);
  const file = flag('--file');
  const shown = args.map((a) => (a === file ? path.relative(process.cwd(), a).split(path.sep).join('/') : a));
  const size = statSync(file).size;
  if (size > WRANGLER_MAX_BYTES) {
    log({ op: 'wrangler', args: shown, refused: 'over 300 MiB' });
    finish(1, '', `[ERROR] Error: Wrangler only supports uploading files up to 300 MiB in size\n${Key} is ${(size / 1024 / 1024).toFixed(1)} MiB in size\n`);
    return child;
  }
  const failure = wranglerFailures.find((f) => f.key === Key && f.left > 0);
  if (failure) {
    failure.left -= 1;
    log({ op: 'wrangler', args: shown, failed: 500 });
    finish(1, '', `[ERROR] Failed to fetch /accounts/<account>/r2/buckets/${Bucket}/objects/${Key} - 500: Internal Server Error;\n`);
    return child;
  }
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  const written = { Bucket, Key, size, sha256: hash, ContentType: flag('--content-type'), ContentEncoding: flag('--content-encoding'), CacheControl: flag('--cache-control'), Metadata: {} };
  log({ op: 'wrangler', args: shown, written: JSON.parse(JSON.stringify(written)) });
  // Wrangler quotes the key and bucket; the stand-in does not, as the harness normalises a written
  // file's text (backslashes included) before parsing it.
  finish(0, `Resource location: remote\nCreating object ${Key} in bucket ${Bucket}.\nUpload complete.\n`, '');
  return child;
}

const realSpawn = childProcess.spawn;
childProcess.spawn = /** @type {typeof childProcess.spawn} */ ((command, args, ...rest) => {
  if (command === 'npx' || command === 'npx.cmd') {
    if (Array.isArray(args) && args[0] === 'wrangler') return fakeWrangler(args.slice(1));
    throw new Error(`s3-fake: npx ${Array.isArray(args) ? args.join(' ') : ''} may not run in a dry run`);
  }
  return realSpawn(command, args, ...rest);
});
syncBuiltinESMExports();
