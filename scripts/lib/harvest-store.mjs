/**
 * Append-only record store for the harvesters, replacing one-file-per-record.
 *
 * WHY
 *
 * The harvest output lives on an exFAT volume with a 256 KB allocation unit --
 * measured, not assumed: 200 one-byte files consumed exactly 52,428,800 bytes.
 * Every response therefore costs 256 KB of disk however small it is. Across the
 * two NI Assembly trees that meant 441,002 files holding 1.75 GB of content
 * while occupying 107.67 GB. The single worst operation,
 * plenary/GetMotionPetitionOfConcern_JSON, held 0.6 MB in 4.31 GB.
 *
 * The outstanding written-answers sweep is 304,370 more documents holding about
 * 0.7 GB. Written as loose files it would consume roughly 80 GB -- most of what
 * packing just reclaimed -- so the write path has to change before that sweep
 * can run at all.
 *
 * DESIGN
 *
 * Three layers, checked in order, all read-only except the last:
 *
 *   1. <service>/<op>.tar.gz   archives produced by pack-harvest-trees.sh
 *   2. <service>/<op>.jsonl    append-only, where new records go
 *   3. <service>/<op>/<key>    loose files, for trees not yet packed
 *
 * A key present in ANY layer counts as held, so a half-migrated tree behaves
 * correctly and re-running after packing does not re-fetch. Appending to a
 * .tar.gz is not possible without rewriting it, hence the separate JSONL; the
 * two are folded together later by the compaction step.
 *
 * Records are stored as {"k":<key>,"b":<raw response text>}. The body is the
 * exact bytes the service returned -- JSON string escaping is lossless for
 * UTF-8 -- so nothing is reinterpreted on the way in. That matters because the
 * whole point of keeping raw responses is that a parser bug downstream can
 * never be mistaken for missing data.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/**
 * List member basenames of a tar.gz without extracting it.
 *
 * --force-local is essential, not decorative. GNU tar parses "host:path" as a
 * REMOTE archive, so a plain Windows path like C:/packs/x.tar.gz is read as
 * host "C" plus path "/packs/x.tar.gz" and tar goes looking for a network
 * host. Git Bash hides this by rewriting paths before tar sees them; Node's
 * execFileSync passes the raw string straight through. The symptom is a
 * baffling "gzip: stdin: unexpected end of file" on an archive that gzip -t
 * passes cleanly.
 */
function tarIndex(archive) {
  try {
    const out = execFileSync('tar', ['--force-local', '-tzf', archive], {
      encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, windowsHide: true
    });
    const keys = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line || line.endsWith('/')) continue;
      // members are stored as "<operation>/<file>"
      const base = line.slice(line.lastIndexOf('/') + 1);
      if (base) keys.add(stripExt(base));
    }
    return keys;
  } catch (e) {
    // A missing tar binary or unreadable archive must not be read as "no records
    // held" -- that would silently re-fetch everything. Signal it instead, and
    // carry tar's own stderr up: swallowing it turned the --force-local bug
    // above into an opaque "cannot read archive" that looked like corruption.
    tarIndex.lastError = String((e && (e.stderr || e.message)) || e).trim().slice(0, 300);
    return null;
  }
}

const stripExt = (n) => n.replace(/\.(json|xml)$/i, '');

/**
 * Read every member of a tar.gz into a Map of key -> body, in ONE pass.
 *
 * Shared by get() and readRecords(): an earlier version implemented archive
 * reading only inside get(), so readRecords() silently returned nothing for a
 * packed operation and the caller concluded the dataset was empty. Same class
 * of bug as everything else here -- a missing code path reading as missing data.
 *
 * `-xzOf` with no member named concatenates all bodies in archive order, so the
 * sizes from `-tzvf` give the split points. Reading them individually would cost
 * one process spawn per record.
 */
function archiveBodies(archive) {
  const bodies = new Map();
  try {
    const listing = execFileSync('tar', ['--force-local', '-tzvf', archive],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, windowsHide: true });
    const members = [];
    for (const line of listing.split(/\r?\n/)) {
      if (!line || line.startsWith('d')) continue;
      const size = Number(line.trim().split(/\s+/)[2]);
      const name = line.replace(/^(\S+\s+){5}/, '');
      if (name && Number.isFinite(size)) members.push({ name, size });
    }
    const blob = execFileSync('tar', ['--force-local', '-xzOf', archive],
      { encoding: 'latin1', maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
    let off = 0;
    for (const mem of members) {
      const body = Buffer.from(blob.slice(off, off + mem.size), 'latin1').toString('utf8');
      off += mem.size;
      bodies.set(stripExt(mem.name.slice(mem.name.lastIndexOf('/') + 1)), body);
    }
  } catch { /* caller treats an empty map as "nothing from this layer" */ }
  return bodies;
}

/**
 * Yield a JSONL file's lines without ever holding the whole file as a string.
 *
 * readFileSync(file,'utf8') cannot do this: Node caps strings at 0x1fffffe8
 * characters (0.5 GB), and GetWrittenAnswerOpenXml.jsonl is 4.27 GB. The store
 * was therefore able to WRITE records it could not read back -- a resumed run
 * would have crashed with "Cannot create a string longer than..." rather than
 * resuming, and the failure only appeared once a single operation exceeded half
 * a gigabyte.
 *
 * StringDecoder is what makes chunking safe: a fixed-size read can split a
 * multi-byte UTF-8 sequence, and buf.toString('utf8') on the fragment would
 * corrupt that character silently.
 */
function* jsonlLines(file) {
  const fd = openSync(file, 'r');
  const decoder = new StringDecoder('utf8');
  const CHUNK = 8 * 1024 * 1024;
  const buf = Buffer.allocUnsafe(CHUNK);
  let carry = '';
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      const text = carry + decoder.write(buf.subarray(0, n));
      const lines = text.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) if (line) yield line;
    }
    carry += decoder.end();
    if (carry) yield carry;
  } finally { closeSync(fd); }
}

/** Keys already recorded in an append-only JSONL, read without parsing bodies. */
function jsonlIndex(file) {
  const keys = new Set();
  if (!existsSync(file)) return keys;
  for (const line of jsonlLines(file)) {
    // Cheap prefix scan: the writer always emits "k" first, so this avoids
    // JSON.parse over hundreds of thousands of bodies just to list keys.
    const m = /^\{"k":("(?:[^"\\]|\\.)*")/.exec(line);
    if (m) { try { keys.add(JSON.parse(m[1])); } catch { /* skip malformed */ } }
  }
  return keys;
}

export function openStore(outDir, { verbose = true } = {}) {
  const indexes = new Map();    // "service/op" -> Set of keys
  const handles = new Map();    // "service/op" -> jsonl path
  const bodyCache = new Map();  // "service/op" -> Map of key -> body (lazy, get() only)
  let loadedArchives = 0;

  function idFor(service, op) { return `${service}/${op}`; }

  function ensure(service, op) {
    const id = idFor(service, op);
    if (indexes.has(id)) return indexes.get(id);

    const svcDir = path.join(outDir, service);
    const keys = new Set();

    const archive = path.join(svcDir, `${op}.tar.gz`);
    if (existsSync(archive)) {
      const fromTar = tarIndex(archive);
      if (fromTar === null) {
        throw new Error(
          `Cannot read ${archive}: ${tarIndex.lastError || 'unknown tar failure'}\n` +
          `  Refusing to continue: treating an unreadable archive as empty would ` +
          `silently re-fetch every record it holds.`);
      }
      for (const k of fromTar) keys.add(k);
      loadedArchives += 1;
    }

    const jsonl = path.join(svcDir, `${op}.jsonl`);
    for (const k of jsonlIndex(jsonl)) keys.add(k);

    const loose = path.join(svcDir, op);
    if (existsSync(loose)) {
      try { for (const f of readdirSync(loose)) keys.add(stripExt(f)); } catch { /* ignore */ }
    }

    indexes.set(id, keys);
    handles.set(id, jsonl);
    if (verbose && keys.size) console.log(`      cache ${id}: ${keys.size} held`);
    return keys;
  }

  return {
    has(service, op, key) { return ensure(service, op).has(String(key)); },

    put(service, op, key, body) {
      const keys = ensure(service, op);
      const k = String(key);
      if (keys.has(k)) return false;
      const svcDir = path.join(outDir, service);
      mkdirSync(svcDir, { recursive: true });
      appendFileSync(handles.get(idFor(service, op)),
        `${JSON.stringify({ k, b: String(body) })}\n`);
      keys.add(k);
      return true;
    },

    /**
     * Fetch a held record's body.
     *
     * Deliberately lazy: bodies are only materialised for an operation the
     * caller actually reads from, because loading them is what costs memory
     * (GetWrittenAnswerHtml alone is 144 MB of content). Phases that merely ask
     * "do I already have this?" go through has() and never pay for it.
     */
    get(service, op, key) {
      ensure(service, op);
      const id = idFor(service, op);
      let bodies = bodyCache.get(id);
      if (!bodies) {
        bodies = new Map();
        const svcDir = path.join(outDir, service);

        const archive = path.join(svcDir, `${op}.tar.gz`);
        if (existsSync(archive)) {
          for (const [k, v] of archiveBodies(archive)) bodies.set(k, v);
        }

        const jsonl = path.join(svcDir, `${op}.jsonl`);
        if (existsSync(jsonl)) {
          for (const line of jsonlLines(jsonl)) {
            try { const r = JSON.parse(line); bodies.set(r.k, r.b); } catch { /* skip */ }
          }
        }

        const loose = path.join(svcDir, op);
        if (existsSync(loose)) {
          try {
            for (const f of readdirSync(loose)) {
              const p = path.join(loose, f);
              if (statSync(p).isFile()) bodies.set(stripExt(f), readFileSync(p, 'utf8'));
            }
          } catch { /* ignore */ }
        }
        bodyCache.set(id, bodies);
      }
      return bodies.get(String(key)) ?? null;
    },

    count(service, op) { return ensure(service, op).size; },

    stats() {
      let held = 0;
      for (const s of indexes.values()) held += s.size;
      return { operations: indexes.size, archivesRead: loadedArchives, recordsHeld: held };
    }
  };
}

/** Stream records out of a store for downstream use, across all three layers. */
export function* readRecords(outDir, service, op) {
  const archive = path.join(outDir, service, `${op}.tar.gz`);
  if (existsSync(archive)) {
    for (const [key, body] of archiveBodies(archive)) yield { key, body };
  }
  const jsonl = path.join(outDir, service, `${op}.jsonl`);
  if (existsSync(jsonl)) {
    for (const line of jsonlLines(jsonl)) {
      try { const r = JSON.parse(line); yield { key: r.k, body: r.b }; } catch { /* skip */ }
    }
  }
  const loose = path.join(outDir, service, op);
  if (existsSync(loose)) {
    for (const f of readdirSync(loose)) {
      const p = path.join(loose, f);
      try { if (statSync(p).isFile()) yield { key: stripExt(f), body: readFileSync(p, 'utf8') }; } catch { /* skip */ }
    }
  }
}
