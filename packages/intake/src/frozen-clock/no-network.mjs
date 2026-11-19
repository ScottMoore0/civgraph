// Loaded with --import by `intake parity --offline` and `intake run --offline` only: every Node
// step of the run (and every Node process it starts, which inherits NODE_OPTIONS) is refused the
// network, so a network step replays from what it has cached or fails loudly; nothing can reach
// a live source. fetch, http(s).request/get, net and tls connections and DNS lookups throw.
// Connections to this machine (localhost, 127.0.0.1, ::1) are refused too: a step has no
// business with a local server during a replay.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

/** @param {string} what @returns {never} */
const refuse = (what) => {
  const e = /** @type {Error & { code?: string }} */ (new Error(`INTAKE_OFFLINE: ${what} refused (an offline replay: the step must work from its cache)`));
  e.code = 'INTAKE_OFFLINE';
  throw e;
};
/** @typedef {{ url?: unknown, href?: unknown, host?: unknown, hostname?: unknown } | null | undefined} TargetLike */
/** @param {unknown} x a URL, a request or its options, or a host */
const target = (x) => {
  try { return String(/** @type {TargetLike} */ (x)?.url ?? /** @type {TargetLike} */ (x)?.href ?? /** @type {TargetLike} */ (x)?.host ?? /** @type {TargetLike} */ (x)?.hostname ?? x); } catch { return '?'; }
};

globalThis.fetch = async (/** @type {unknown} */ input) => refuse(`fetch ${target(input)}`);
for (const [name, mod] of /** @type {[string, typeof http | typeof https][]} */ ([['http', http], ['https', https]])) {
  mod.request = (/** @type {unknown} */ a) => refuse(`${name}.request ${target(a)}`);
  mod.get = (/** @type {unknown} */ a) => refuse(`${name}.get ${target(a)}`);
}
net.connect = (a) => refuse(`net.connect ${target(a)}`);
net.createConnection = (a) => refuse(`net.createConnection ${target(a)}`);
tls.connect = (a) => refuse(`tls.connect ${target(a)}`);
// A stand-in has no __promisify__ (nothing here promisifies them: dns.promises is replaced below).
dns.lookup = /** @type {typeof dns.lookup} */ (/** @type {unknown} */ ((/** @type {string} */ h) => refuse(`dns.lookup ${h}`)));
dns.resolve = /** @type {typeof dns.resolve} */ (/** @type {unknown} */ ((/** @type {string} */ h) => refuse(`dns.resolve ${h}`)));
dns.promises.lookup = async (h) => refuse(`dns.lookup ${h}`);
dns.promises.resolve = async (h) => refuse(`dns.resolve ${h}`);
syncBuiltinESMExports();
