/**
 * Shared by every records Function (data design phase 2): the dataset version, the cache
 * wrapper, the table names, and the rebuilding of documents stored with markers.
 *
 * CACHING (DESIGN.md 3.2). Pages Functions run before the CDN cache, so responses are cached
 * explicitly with the Cache API, per data centre, under a key that includes the code version and
 * the dataset version. A publish writes a new dataset.version, so new requests use new keys and
 * nothing needs purging. While dataset.loading is set (a delta is being applied) nothing is
 * cached and responses say no-store. Every 200 is also kept under a version-less "last good" key,
 * served with a Warning header if D1 fails or the binding is missing.
 *
 * Error responses are never cached: a transient 503 pinned at the edge for a day would outlive
 * its cause (the rule in elections/index.js's json() helper).
 */
import { STORE, phaseOf, readDataset, resetDatasetMemo } from '../_lib/dataset-state.js';
import { CACHE, binding } from '../_lib/config.js';
import { asStore } from '../../packages/storage/src/d1.js';
import { T } from '../_lib/queries/tables.js';
import { ELECTIONS } from '../_lib/queries/elections.js';
import { DOCUMENTS } from '../_lib/queries/documents.js';

/** The two tables whose final names are still taken by live legacy tables (stage H renames them). */
export { T };

/**
 * The dataset's version and loading flag, memoised a minute per isolate: one memo shared with
 * the server-rendered pages (functions/_lib/dataset-state.js, state machine FN-03).
 */
export const datasetState = (/** @type {D1Database} */ db) => readDataset(db);

/** For tests: forget the memoised dataset state. */
export { resetDatasetMemo };

export const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

export function jsonResponse(payload, status = 200, extra = {}) {
  return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store', ...extra },
  });
}

/**
 * A transition table, frozen to its last array.
 * @template {string} S
 * @param {Record<S, S[]>} table
 * @returns {Readonly<Record<S, readonly S[]>>}
 */
function freezeTable(table) {
  for (const next of Object.values(table)) Object.freeze(next);
  return Object.freeze(table);
}

/**
 * Where a records answer comes from (refactor state machine FN-02): each request walks this
 * ladder from `start` to one terminal state, and a step the table does not list throws, so a
 * change to cachedJson cannot quietly skip a rung (say, store an answer built while a load is
 * running, or answer a refused rebuild with nothing).
 *
 *   not-modified    304: If-None-Match is the current ETag
 *   edge-hit        the answer stored at this data centre (caches.default)
 *   waiting         gated: another request is rebuilding this URL; wait for it, then look again
 *   gate            gated: ask the isolate's gate for a rebuild slot (GATE_SLOT below)
 *   r2-first        `r2First`: try the R2 copy before D1
 *   rebuild         ask D1 (the handler)
 *   stored          200, stored at the edge and as last-good
 *   unstored        200 built while the dataset is loading: no-store, nothing stored
 *   client-error    4xx: no-store
 *   passed-through  any other non-error answer (a 301 to another spelling of an id) as the handler gave it
 *   failed          no answer, a 5xx, or no gate slot: fall back
 *   last-good       the last 200 for this URL, with a Warning
 *   from-r2         the file's R2 copy (stored like a rebuild)
 *   unavailable     the handler's 5xx, or 503 with Retry-After
 *
 * @typedef {'start' | 'not-modified' | 'edge-hit' | 'waiting' | 'gate' | 'r2-first' | 'rebuild' | 'stored' | 'unstored'
 *   | 'client-error' | 'passed-through' | 'failed' | 'last-good' | 'from-r2' | 'unavailable'} AnswerStep
 */
export const ANSWER_LADDER = freezeTable(/** @type {Record<AnswerStep, AnswerStep[]>} */ ({
  start: ['not-modified', 'edge-hit', 'waiting', 'gate', 'r2-first', 'rebuild'],
  waiting: ['edge-hit', 'gate'],
  gate: ['r2-first', 'rebuild', 'failed'],
  'r2-first': ['from-r2', 'rebuild'],
  rebuild: ['stored', 'unstored', 'client-error', 'passed-through', 'failed'],
  failed: ['last-good', 'from-r2', 'unavailable'],
  'not-modified': [],
  'edge-hit': [],
  stored: [],
  unstored: [],
  'client-error': [],
  'passed-through': [],
  'last-good': [],
  'from-r2': [],
  unavailable: [],
}));

/**
 * One request's walk down the ladder.
 * @param {(path: AnswerStep[]) => void} [onDone]  called with the whole path on reaching a terminal step
 */
export function answerLadder(onDone) {
  /** @type {AnswerStep} */
  let at = 'start';
  /** @type {AnswerStep[]} */
  const path = [at];
  return {
    get at() { return at; },
    path,
    /** @param {AnswerStep} next */
    to(next) {
      if (!ANSWER_LADDER[at].includes(next)) throw new Error(`records answer: ${at} -> ${next} is not a transition`);
      at = next;
      path.push(next);
      if (!ANSWER_LADDER[next].length) onDone?.([...path]);
      return next;
    },
  };
}

/**
 * A JSON answer cached at the edge (caches.default) under the code version and, by default, the
 * dataset version, with a last-good copy that answers while D1 fails.
 *
 * `options.cacheControl` replaces the browser policy of a 200 (default: max-age=300 with
 * stale-while-revalidate). The map documents use must-revalidate: the browser asks each load and
 * the ETag (code and dataset version) answers 304, so a publish is seen at once.
 *
 * For the old /data/browse and /data/graph file URLs (data phase 4), which a burst could turn into
 * many heavy D1 reads at once (15 of 294 answered 503, D1 overloaded, in a production crawl on
 * 7 Nov 2026):
 *   `edgeTtl`  seconds a stored 200 lives at the edge (s-maxage: caches.default keeps a response
 *              for its Cache-Control, so with max-age=300 alone it was gone in five minutes).
 *              Under a dataset-versioned key the content never changes, so it can be long.
 *   `stable`   the key and ETag leave out the dataset version, and the cache is read before D1
 *              is asked anything: for content frozen until it retires (/data/graph, whose
 *              graph_files is frozen as loaded at go-live). A publish does not empty it.
 *   `gate`     the rebuild goes through the isolate's gate: one rebuild per URL at a time (a
 *              second request waits for it and takes its stored copy), at most GATE_ACTIVE
 *              rebuilds at once and GATE_QUEUE more waiting up to GATE_WAIT_MS each; past that,
 *              the last-good copy, the R2 copy or 503 with Retry-After.
 *   `r2Key`    the file's copy on R2 (MAPS_BUCKET), left by the old publish: read before D1 with
 *              `r2First`, else only when D1 fails and no last-good copy is held.
 */
export async function cachedJson(context, codeVersion, handler, options = {}) {
  const { stable = false, edgeTtl = 0, gate = false, r2Key = null, r2First = false } = options;
  // options.onPath: for tests, the ladder's path (ANSWER_LADDER) once the answer is chosen.
  const ladder = answerLadder(options.onPath);
  const db = binding(context.env, 'ELECTIONS_DB');
  /** @type {{ version: string, loading: string } | null} */
  let state = null;
  const getState = async () => {
    if (!state) state = db ? await datasetState(db) : { version: '', loading: '' };
    return state;
  };
  const version = stable ? '' : (await getState()).version;
  const etag = stable ? `"${codeVersion}"` : `"${codeVersion}-${version}"`;
  if ((stable || version) && context.request.headers.get('If-None-Match') === etag) {
    ladder.to('not-modified');
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const requestUrl = new URL(context.request.url);
  const key = new URL(requestUrl);
  key.searchParams.set('_cv', codeVersion);
  if (!stable) key.searchParams.set('_dv', version);
  const cacheKey = new Request(key.toString(), { method: 'GET' });
  const lastGoodUrl = new URL(requestUrl);
  lastGoodUrl.searchParams.set('_lastgood', codeVersion);
  const lastGood = stable ? cacheKey : new Request(lastGoodUrl.toString(), { method: 'GET' });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheControl = `${options.cacheControl || CACHE.records}${edgeTtl ? `, s-maxage=${edgeTtl}` : ''}`;
  const lookup = async () => (cache ? (await cache.match(cacheKey)) || null : null);
  if (cache && (stable || !(/** @type {{ loading: string } | null} */ (state))?.loading)) {
    const hit = await lookup();
    if (hit) { ladder.to('edge-hit'); return hit; }
  }

  /** A 200's headers; stored unless a load is under way. Returns it and the put's promise. */
  const finish = (resp, loading) => {
    resp = new Response(resp.body, resp);
    if (version || stable) resp.headers.set('ETag', etag);
    resp.headers.set('Cache-Control', loading ? CACHE.loading : cacheControl);
    let put = null;
    if (cache && !loading) {
      put = Promise.all([cache.put(cacheKey, resp.clone()), stable ? null : cache.put(lastGood, resp.clone())]).catch(() => {});
      context.waitUntil?.(put);
    }
    return { resp, put };
  };
  const fallback = async (resp) => {
    const lg = cache ? await cache.match(lastGood) : null;
    if (lg) {
      ladder.to('last-good');
      const headers = new Headers(lg.headers);
      headers.set('Warning', '110 - "stale: database unavailable"');
      headers.set('Cache-Control', CACHE.lastGood);
      return new Response(lg.body, { status: 200, headers });
    }
    const copy = await r2Copy(context.env, r2Key);
    if (copy) { ladder.to('from-r2'); return finish(copy, false).resp; }
    ladder.to('unavailable');
    return resp || jsonResponse({ error: 'unavailable' }, 503, { 'Retry-After': '5' });
  };
  const rebuild = async () => {
    if (r2First) {
      ladder.to('r2-first');
      const copy = await r2Copy(context.env, r2Key);
      if (copy) { ladder.to('from-r2'); return finish(copy, false); }
    }
    ladder.to('rebuild');
    const loading = !STORE[phaseOf(await getState())];
    let resp = null;
    try { resp = db ? await handler() : null; } catch { resp = null; }
    if (!resp || resp.status >= 500) { ladder.to('failed'); return { resp: await fallback(resp), put: null }; }
    if (resp.status === 200) { ladder.to(loading ? 'unstored' : 'stored'); return finish(resp, loading); }
    if (resp.status >= 400) {
      ladder.to('client-error');
      resp = new Response(resp.body, resp);
      resp.headers.set('Cache-Control', CACHE.error);
    } else ladder.to('passed-through');
    // A redirect (another spelling of an id) keeps the Cache-Control its handler gave it.
    return { resp, put: null };
  };
  if (!gate) return (await rebuild()).resp;

  const flight = GATE.inflight.get(cacheKey.url);
  if (flight) {
    ladder.to('waiting');
    await flight;
    const hit = await lookup();
    if (hit) { ladder.to('edge-hit'); return hit; }
  }
  ladder.to('gate');
  let settle;
  const mine = new Promise((resolve) => { settle = resolve; });
  if (!flight) GATE.inflight.set(cacheKey.url, mine);
  let put = null;
  try {
    const release = await acquireGate();
    if (!release) { ladder.to('failed'); return await fallback(null); }
    let out;
    try { out = await rebuild(); } finally { release(); }
    put = out.put;
    return out.resp;
  } finally {
    Promise.resolve(put).then(() => {
      settle();
      if (GATE.inflight.get(cacheKey.url) === mine) GATE.inflight.delete(cacheKey.url);
    });
  }
}

/** The isolate's gate on expensive rebuilds (cachedJson `gate`). */
export const GATE_ACTIVE = 2;
export const GATE_QUEUE = 32;
export const GATE_WAIT_MS = 20_000;

/**
 * One request's slot at the gate (refactor state machine FN-01):
 *   asking     -> active (a slot is free) | queued (wait, up to GATE_WAIT_MS) | refused (queue full)
 *   queued     -> active (a released slot is handed over) | timed-out
 *   active     -> released (the rebuild finished; the slot passes to the next waiter or is freed)
 * Refused and timed-out requests fall back (ANSWER_LADDER `failed`). Releasing twice is a no-op.
 *
 * @typedef {'asking' | 'active' | 'queued' | 'refused' | 'timed-out' | 'released'} GateSlotState
 */
export const GATE_SLOT = freezeTable(/** @type {Record<GateSlotState, GateSlotState[]>} */ ({
  asking: ['active', 'queued', 'refused'],
  queued: ['active', 'timed-out'],
  active: ['released'],
  refused: [],
  'timed-out': [],
  released: [],
}));

/** @typedef {{ state: GateSlotState }} GateSlot */

/** Move a slot, or throw if GATE_SLOT has no such move. */
export function slotTo(/** @type {GateSlot} */ slot, /** @type {GateSlotState} */ next) {
  if (!GATE_SLOT[slot.state].includes(next)) throw new Error(`records gate: ${slot.state} -> ${next} is not a transition`);
  slot.state = next;
}

/** @type {{ active: number, queue: Array<{ resolve: (release: (() => void) | null) => void, timer: any, slot: GateSlot }>, inflight: Map<string, unknown>, peak: number }} */
const GATE = { active: 0, queue: [], inflight: new Map(), peak: 0 };

/** For tests: the gate's counters, and a reset. */
export const gateState = {
  get active() { return GATE.active; },
  get queued() { return GATE.queue.length; },
  get peak() { return GATE.peak; },
  reset() { GATE.active = 0; GATE.queue.length = 0; GATE.inflight.clear(); GATE.peak = 0; },
};

function acquireGate() {
  /** @type {GateSlot} */
  const slot = { state: 'asking' };
  if (GATE.active < GATE_ACTIVE) {
    slotTo(slot, 'active');
    GATE.active += 1;
    GATE.peak = Math.max(GATE.peak, GATE.active);
    return Promise.resolve(releaseGate(slot));
  }
  if (GATE.queue.length >= GATE_QUEUE) {
    slotTo(slot, 'refused');
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    slotTo(slot, 'queued');
    /** @type {(typeof GATE.queue)[number]} */
    const waiter = { resolve, timer: null, slot };
    waiter.timer = setTimeout(() => {
      const i = GATE.queue.indexOf(waiter);
      if (i >= 0) GATE.queue.splice(i, 1);
      slotTo(slot, 'timed-out');
      resolve(null);
    }, GATE_WAIT_MS);
    GATE.queue.push(waiter);
  });
}

/** An active slot's release, good once: the slot passes to the next waiter, else it is freed. */
function releaseGate(/** @type {GateSlot} */ slot) {
  return () => {
    if (slot.state === 'released') return;
    slotTo(slot, 'released');
    const next = GATE.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      slotTo(next.slot, 'active');
      next.resolve(releaseGate(next.slot));
    } else GATE.active = Math.max(0, GATE.active - 1);
  };
}

async function r2Copy(env, key) {
  if (!key || !binding(env, 'MAPS_BUCKET')) return null;
  try {
    const obj = await binding(env, 'MAPS_BUCKET').get(key);
    return obj ? new Response(obj.body, { headers: { ...JSON_HEADERS, 'X-Civgraph-Copy': 'r2' } }) : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} text
 * @param {any} [fallback]
 * @returns {any}
 */
export function parseJson(text, fallback = null) {
  if (text === null || text === undefined) return fallback;
  try { return JSON.parse(/** @type {string} */ (text)); } catch { return fallback; }
}

/** A marker the loader put where a value lives in another table ("$contests", "$candidacies"...). */
export const isMarker = (value) => typeof value === 'string' && value.length > 1 && value[0] === '$'
  && /^\$[a-zA-Z.]+$/.test(value);

/** The object without its marker keys. */
export function withoutMarkers(object) {
  const out = {};
  for (const [k, v] of Object.entries(object || {})) if (!isMarker(v)) out[k] = v;
  return out;
}

/** Replace marker values by fill(key, marker) in place of the marker, keeping key order. */
export function fillMarkers(object, fill) {
  const out = {};
  for (const [k, v] of Object.entries(object || {})) out[k] = isMarker(v) ? fill(k, v) : v;
  return out;
}

// ---------------------------------------------------------------- Python-compatible JSON text

/**
 * A number as Python's json module writes it (repr): the same shortest digits as JavaScript,
 * but scientific notation below 1e-4 ("6.0498446131848995e-05") where JavaScript writes fixed.
 * The election bundles were last written by the Python person-id scripts (indent 2,
 * ensure_ascii False), so this is what makes the compatibility route byte-identical.
 */
export function pyNumber(n) {
  if (!Number.isFinite(n)) return 'null';
  if (Number.isInteger(n) || n === 0) return JSON.stringify(n);
  const abs = Math.abs(n);
  if (abs >= 1e-4 && abs < 1e16) return JSON.stringify(n);
  const [mantissa, exp] = n.toExponential().split('e');
  const e = Number(exp);
  const sign = e < 0 ? '-' : '+';
  return `${mantissa}e${sign}${String(Math.abs(e)).padStart(2, '0')}`;
}

/** JSON text as Python's json.dumps(value, indent=2, ensure_ascii=False) writes it. */
export function pyJson(value, level = 0) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return pyNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  const pad = '  '.repeat(level + 1);
  const close = '  '.repeat(level);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map((v) => pad + pyJson(v, level + 1)).join(',\n')}\n${close}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pyJson(v, level + 1)}`).join(',\n')}\n${close}}`;
}

/** JSON text as Python's json.dumps(value, ensure_ascii=False, separators=(',', ':')) writes it. */
export function pyJsonCompact(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return pyNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyJsonCompact).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${pyJsonCompact(v)}`).join(',')}}`;
}

// ---------------------------------------------------------------- election bundles

// Each helper takes a RecordStore or a D1 binding (asStore), so callers move to the adapter one
// route at a time; the SQL is named in functions/_lib/queries/elections.js (ST-6).

export async function electionRow(db, key) {
  return asStore(db).first(ELECTIONS.row, [key]);
}

export async function electionAggregates(db, key) {
  const results = await asStore(db).all(ELECTIONS.aggregates, [key]);
  const joined = new Map();
  for (const r of results || []) joined.set(r.name, (joined.get(r.name) || '') + r.payload);
  return new Map([...joined].map(([name, text]) => [name, parseJson(text)]));
}

/** One contest of a bundle, exactly as the file held it. */
export function contestObject(contestMeta, candidacyMetas, animationPayloadText) {
  const meta = parseJson(contestMeta, {});
  let anim;
  const animation = () => {
    if (anim === undefined) anim = parseJson(animationPayloadText, null);
    return anim;
  };
  return fillMarkers(meta, (_k, marker) => {
    if (marker === '$candidacies') return candidacyMetas.map((m) => parseJson(m, {}));
    if (marker === '$animation') return animation();
    if (marker === '$animation.countGroup') return animation()?.Constituency?.countGroup ?? [];
    return null;
  });
}

/** The contests of an election, in order, each with its candidacies and animation payload. */
export async function* contestsOf(db, key, { perContest = true } = {}) {
  const store = asStore(db);
  const contests = await store.all(ELECTIONS.contests, [key]);
  if (!perContest) {
    const [cands, anims] = await Promise.all([
      store.all(ELECTIONS.candidacyMetas, [key]),
      store.all(ELECTIONS.animations, [key]),
    ]);
    const bySeq = new Map();
    for (const r of cands) {
      if (!bySeq.has(r.seq)) bySeq.set(r.seq, []);
      bySeq.get(r.seq).push(r.meta);
    }
    const animBySeq = new Map(anims.map((r) => [r.seq, r.payload]));
    for (const c of contests || []) yield contestObject(c.meta, bySeq.get(c.seq) || [], animBySeq.get(c.seq));
    return;
  }
  for (const c of contests || []) {
    const [cands, anim] = await Promise.all([
      store.all(ELECTIONS.contestCandidacyMetas, [key, c.seq]),
      store.first(ELECTIONS.contestAnimation, [key, c.seq]),
    ]);
    yield contestObject(c.meta, cands.map((r) => r.meta), anim?.payload);
  }
}

/**
 * The bundle as text chunks, in the file's own key order and Python formatting: the head, then
 * one contest at a time, so the largest bundle (ireland-local 2019, 24.7 MB) is never held whole.
 * Returns null when the election does not exist.
 */
export async function bundleChunks(db, key) {
  const row = await electionRow(db, key);
  if (!row) return null;
  const meta = parseJson(row.meta, {});
  const aggregates = Object.values(meta).some((v) => v === '$aggregate') ? await electionAggregates(db, key) : new Map();
  const compact = row.compact === 1;
  const text = (v, level) => (compact ? pyJsonCompact(v) : pyJson(v, level));
  async function* generate() {
    const entries = Object.entries(meta);
    const NL = '\n';
    const nl = compact ? '' : NL;
    yield `{${nl}`;
    for (let i = 0; i < entries.length; i += 1) {
      const [k, v] = entries[i];
      const sep = i < entries.length - 1 ? `,${nl}` : nl;
      const head = compact ? `${JSON.stringify(k)}:` : `  ${JSON.stringify(k)}: `;
      if (v === '$contests') {
        yield head;
        let first = true;
        for await (const contest of contestsOf(db, key)) {
          if (compact) yield `${first ? '[' : ','}${text(contest)}`;
          else yield `${first ? `[${NL}` : `,${NL}`}    ${text(contest, 2)}`;
          first = false;
        }
        if (first) yield `[]${sep}`;
        else yield `${compact ? ']' : `${NL}  ]`}${sep}`;
      } else {
        const value = v === '$aggregate' ? (aggregates.get(k) ?? null) : v;
        yield `${head}${text(value, 1)}${sep}`;
      }
    }
    // generated_json.py ends every file with a newline.
    yield `}${NL}`;
  }
  return generate();
}

/** The bundle as an object (format=bundle). */
export async function bundleObject(db, key) {
  const row = await electionRow(db, key);
  if (!row) return null;
  const meta = parseJson(row.meta, {});
  const aggregates = await electionAggregates(db, key);
  const contests = [];
  for await (const c of contestsOf(db, key, { perContest: false })) contests.push(c);
  return fillMarkers(meta, (k, marker) => (marker === '$contests' ? contests : (aggregates.get(k) ?? null)));
}

/** A ReadableStream of text chunks from an async iterator. */
export function streamFrom(iterator) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
  });
}

export async function documentBody(db, name) {
  const row = await asStore(db).first(DOCUMENTS.body, [name]);
  return row ? parseJson(row.body) : null;
}
