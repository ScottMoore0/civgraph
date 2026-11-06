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

/** The two tables whose final names are still taken by live legacy tables (stage H renames them). */
export const T = { elections: 'r_elections', counts: 'r_counts' };

const MEMO_MS = 60_000;
let memo = { version: '', loading: '', expires: 0 };

export async function datasetState(db) {
  const now = Date.now();
  if (now < memo.expires) return memo;
  let version = '';
  let loading = '';
  try {
    const { results } = await db.prepare("SELECT key, value FROM dataset WHERE key IN ('version', 'loading') ORDER BY key").all();
    for (const r of results || []) {
      if (r.key === 'version') version = r.value || '';
      if (r.key === 'loading') loading = r.value || '';
    }
  } catch { /* keep '' */ }
  memo = { version, loading, expires: now + MEMO_MS };
  return memo;
}

/** For tests: forget the memoised dataset state. */
export function resetDatasetMemo() {
  memo = { version: '', loading: '', expires: 0 };
}

export const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

export function jsonResponse(payload, status = 200, extra = {}) {
  return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store', ...extra },
  });
}

export async function cachedJson(context, codeVersion, handler) {
  const db = context.env?.ELECTIONS_DB;
  const { version, loading } = db ? await datasetState(db) : { version: '', loading: '' };
  const etag = `"${codeVersion}-${version}"`;
  if (version && context.request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const requestUrl = new URL(context.request.url);
  const key = new URL(requestUrl);
  key.searchParams.set('_cv', codeVersion);
  key.searchParams.set('_dv', version);
  const cacheKey = new Request(key.toString(), { method: 'GET' });
  const lastGoodUrl = new URL(requestUrl);
  lastGoodUrl.searchParams.set('_lastgood', codeVersion);
  const lastGood = new Request(lastGoodUrl.toString(), { method: 'GET' });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache && !loading) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  let resp = null;
  try { resp = db ? await handler() : null; } catch { resp = null; }
  if (!resp || resp.status >= 500) {
    const lg = cache ? await cache.match(lastGood) : null;
    if (lg) {
      const headers = new Headers(lg.headers);
      headers.set('Warning', '110 - "stale: database unavailable"');
      headers.set('Cache-Control', 'public, max-age=60');
      return new Response(lg.body, { status: 200, headers });
    }
    return resp || jsonResponse({ error: 'unavailable' }, 503);
  }
  if (resp.status === 200) {
    resp = new Response(resp.body, resp);
    if (version) resp.headers.set('ETag', etag);
    resp.headers.set('Cache-Control', loading ? 'no-store' : 'public, max-age=300, stale-while-revalidate=86400');
    if (cache && !loading) {
      const copy = resp.clone();
      const copy2 = resp.clone();
      context.waitUntil?.(cache.put(cacheKey, copy));
      context.waitUntil?.(cache.put(lastGood, copy2));
    }
  } else {
    resp = new Response(resp.body, resp);
    resp.headers.set('Cache-Control', 'no-store');
  }
  return resp;
}

export function parseJson(text, fallback = null) {
  if (text === null || text === undefined) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
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

const AGGREGATE_SQL = 'SELECT name, payload FROM election_aggregates WHERE election_key = ?1 ORDER BY name, part';

export async function electionRow(db, key) {
  return db.prepare(`SELECT key, slug, compact, meta FROM ${T.elections} WHERE key = ?1`).bind(key).first();
}

export async function electionAggregates(db, key) {
  const { results } = await db.prepare(AGGREGATE_SQL).bind(key).all();
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
  return fillMarkers(meta, (k, marker) => {
    if (marker === '$candidacies') return candidacyMetas.map((m) => parseJson(m, {}));
    if (marker === '$animation') return animation();
    if (marker === '$animation.countGroup') return animation()?.Constituency?.countGroup ?? [];
    return null;
  });
}

/** The contests of an election, in order, each with its candidacies and animation payload. */
export async function* contestsOf(db, key, { perContest = true } = {}) {
  const { results: contests } = await db.prepare('SELECT seq, meta FROM contests WHERE election_key = ?1 ORDER BY seq').bind(key).all();
  if (!perContest) {
    const [cands, anims] = await Promise.all([
      db.prepare('SELECT contest_seq AS seq, meta FROM candidacies WHERE election_key = ?1 ORDER BY contest_seq, ord').bind(key).all(),
      db.prepare('SELECT contest_seq AS seq, payload FROM contest_animation WHERE election_key = ?1 ORDER BY contest_seq').bind(key).all(),
    ]);
    const bySeq = new Map();
    for (const r of cands.results || []) {
      if (!bySeq.has(r.seq)) bySeq.set(r.seq, []);
      bySeq.get(r.seq).push(r.meta);
    }
    const animBySeq = new Map((anims.results || []).map((r) => [r.seq, r.payload]));
    for (const c of contests || []) yield contestObject(c.meta, bySeq.get(c.seq) || [], animBySeq.get(c.seq));
    return;
  }
  for (const c of contests || []) {
    const [cands, anim] = await Promise.all([
      db.prepare('SELECT meta FROM candidacies WHERE election_key = ?1 AND contest_seq = ?2 ORDER BY ord').bind(key, c.seq).all(),
      db.prepare('SELECT payload FROM contest_animation WHERE election_key = ?1 AND contest_seq = ?2').bind(key, c.seq).first(),
    ]);
    yield contestObject(c.meta, (cands.results || []).map((r) => r.meta), anim?.payload);
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
  const row = await db.prepare('SELECT body FROM documents WHERE name = ?1').bind(name).first();
  return row ? parseJson(row.body) : null;
}
