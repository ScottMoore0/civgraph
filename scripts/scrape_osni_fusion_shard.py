#!/usr/bin/env python
"""Tilemap-aware OSNI Fusion mirror — *shard mode*.

Designed to be run independently on N different machines/IPs, with no
coordination. Each invocation is told its shard index (0..N-1) and the
total shard count (N), and only fetches tiles whose row satisfies
`row % N == shard_index`. By construction, no two shards can fetch the
same tile.

Each shard writes to its OWN MBTiles file. After all shards finish,
merge with `merge_mbtiles.py`.

Each shard runs its own discovery phase (cheap — ~390 tilemap probes for
z=11–13) so they don't need to share state.

Resumeable: a shard re-running picks up where it left off in its own DB.

Usage on machine A (IP1):
  python scrape_osni_fusion_shard.py --shard 0 --of 2 --output D:\\osni-fusion\\shard-A.mbtiles

Usage on machine B (IP2):
  python scrape_osni_fusion_shard.py --shard 1 --of 2 --output D:\\osni-fusion\\shard-B.mbtiles

Both can run completely in parallel.
"""
import argparse, sqlite3, sys, time, threading, queue, json, io, socket
import httpx
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Identifies the client to OSNI; per-machine UA helps us be polite + traceable
HOST = socket.gethostname().replace(' ', '_')
UA = f"Mozilla/5.0 civgraph/fusion-mirror-{HOST}"
TILEMAP_BLOCK = 128
# Single shared httpx client per process; HTTP/1.1 (HTTP/2 has high failure rate against OSNI),
# connection pool sized to worker count, 30s timeout.
_CLIENT = None
_CLIENT_BORN = 0.0
_CLIENT_LOCK = threading.Lock()
CLIENT_LIFETIME_S = 180  # recycle httpx client every 3 min — bypasses OSNI's per-session throttle decay (~2.1× speedup)
def get_client(workers=16):
    global _CLIENT, _CLIENT_BORN
    with _CLIENT_LOCK:
        now = time.time()
        if _CLIENT is None or (now - _CLIENT_BORN) > CLIENT_LIFETIME_S:
            old = _CLIENT
            _CLIENT = httpx.Client(
                http2=False,
                headers={"User-Agent": UA, "Referer": "https://experience.arcgis.com/"},
                timeout=httpx.Timeout(60.0, connect=15.0),
                limits=httpx.Limits(max_keepalive_connections=workers, max_connections=workers*2),
            )
            _CLIENT_BORN = now
            if old is not None:
                try: old.close()
                except Exception: pass
        return _CLIENT

VARIANTS = {
    'light': 'https://utility.arcgis.com/usrsvcs/servers/a2e54f6f39d74347bf2769c45934211c/rest/services/VectorBasemaps/OSNIFusionBasemap_Light/MapServer',
    'full':  'https://utility.arcgis.com/usrsvcs/servers/69fee3e0b52f4dd8860e4c8fe6b5cb28/rest/services/VectorBasemaps/OSNIFusionBasemap/MapServer',
}

LODS_RES = [529.1677, 396.8758, 291.0422, 145.5211, 63.5001, 31.7501, 15.8750,
            7.9375, 5.2917, 2.6458, 2.1167, 1.3229, 0.6615, 0.3307, 0.1323]
TILE_PX = 256
TILE_ORIGIN_X = -5422600.0
TILE_ORIGIN_Y = 4321499.999999996
NI_X_MIN, NI_X_MAX = 50000, 370000
NI_Y_MIN, NI_Y_MAX = 310000, 480000


def tile_range(z):
    res = LODS_RES[z]
    tm = res * TILE_PX
    col_min = int((NI_X_MIN - TILE_ORIGIN_X) / tm)
    col_max = int((NI_X_MAX - TILE_ORIGIN_X) / tm) + 1
    row_min = int((TILE_ORIGIN_Y - NI_Y_MAX) / tm)
    row_max = int((TILE_ORIGIN_Y - NI_Y_MIN) / tm) + 1
    return col_min, col_max, row_min, row_max


def fetch_url(url, retries=3):
    c = get_client()
    for attempt in range(retries):
        try:
            r = c.get(url)
            if r.status_code == 200:
                return r.content, None
            if r.status_code in (404, 500):
                return None, f'http{r.status_code}'
        except httpx.HTTPError:
            time.sleep(0.5 + attempt)
        except Exception:
            time.sleep(0.5 + attempt)
    return None, 'fail'


def discover_existing_tiles(base, z, shard, of_n, mode='fast'):
    """Same as smart scraper, with shard filter (row % of_n == shard).

    mode='fast'        — only tilemap-confirmed tiles
    mode='fill-gaps'   — only brute-force candidates from empty-tilemap blocks
    mode='all'         — both
    """
    assert mode in ('fast', 'fill-gaps', 'all')
    c0, c1, r0, r1 = tile_range(z)
    candidates = set()
    block = TILEMAP_BLOCK
    blocks_x = list(range(c0, c1, block))
    blocks_y = list(range(r0, r1, block))
    n_blocks = len(blocks_x) * len(blocks_y)
    print(f"  z={z}: NI bbox cells={(c1-c0)*(r1-r0):,}  tilemap probes={n_blocks}  shard={shard}/{of_n}  mode={mode}")
    sys.stdout.flush()
    started = time.time()
    last_print = started
    probed = 0
    fallback_blocks = 0
    for by in blocks_y:
        for bx in blocks_x:
            url = f"{base}/tilemap/{z}/{by}/{bx}/{block}/{block}?f=json"
            data, _ = fetch_url(url)
            probed += 1
            j = None
            if data is not None:
                try: j = json.loads(data)
                except Exception: j = None
            loc = (j or {}).get('location') or {}
            arr = (j or {}).get('data') or []
            w, h = loc.get('width'), loc.get('height')
            top, left = loc.get('top'), loc.get('left')
            tilemap_empty = not (w and h and arr)
            if tilemap_empty:
                fallback_blocks += 1
                if mode in ('fill-gaps', 'all'):
                    rmax = min(by + block, r1)
                    cmax = min(bx + block, c1)
                    for rr in range(by, rmax):
                        if rr % of_n != shard: continue
                        for cc in range(bx, cmax):
                            candidates.add((rr, cc))
            else:
                if mode in ('fast', 'all'):
                    for i, bit in enumerate(arr):
                        if not bit: continue
                        rr = top + (i // w)
                        if rr % of_n != shard: continue
                        cc = left + (i % w)
                        candidates.add((rr, cc))
            now = time.time()
            if now - last_print > 10:
                print(f"    {probed}/{n_blocks} probed; empty-blocks={fallback_blocks}; "
                      f"shard={shard} candidates: {len(candidates):,}", flush=True)
                last_print = now
    print(f"  z={z}: shard {shard}/{of_n} → {len(candidates):,} candidates  "
          f"(tilemap-empty: {fallback_blocks}/{n_blocks}, mode={mode})")
    return candidates


def fetch_tile(base, z, row, col, retries=3):
    url = f"{base}/tile/{z}/{row}/{col}"
    c = get_client()
    for attempt in range(retries):
        try:
            r = c.get(url)
            if r.status_code == 200:
                return r.content
            if r.status_code in (404, 500):
                return None
        except httpx.HTTPError:
            time.sleep(0.5 + attempt)
        except Exception:
            time.sleep(0.5 + attempt)
    return None


def init_or_open(path: Path):
    new = not path.exists()
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    if new:
        conn.execute("""CREATE TABLE metadata (name TEXT, value TEXT)""")
        conn.execute("""CREATE TABLE tiles (
            zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB,
            PRIMARY KEY (zoom_level, tile_column, tile_row)
        ) WITHOUT ROWID""")
        conn.executemany("INSERT INTO metadata (name, value) VALUES (?, ?)", [
            ('name', 'OSNI Fusion Light (NI) — shard'),
            ('format', 'png'),
            ('type', 'baselayer'),
            ('version', '1.0'),
            ('attribution', '© Crown Copyright & Database Right — SpatialNI'),
            ('scheme', 'osni-irishgrid'),
            ('crs', 'EPSG:29902'),
        ])
        conn.commit()
    return conn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shard', type=int, required=True, help='Shard index 0..N-1')
    ap.add_argument('--of', type=int, required=True, dest='of_n', help='Total shard count N')
    ap.add_argument('--output', required=True, help='Path to this shard\'s MBTiles file')
    ap.add_argument('--max-zoom', type=int, default=13)
    ap.add_argument('--min-zoom', type=int, default=10)
    ap.add_argument('--workers', type=int, default=16)
    ap.add_argument('--variant', choices=list(VARIANTS), default='light')
    ap.add_argument('--pass', dest='passmode', choices=['fast','fill-gaps','all'], default='fast',
                    help='fast=trust tilemap; fill-gaps=brute-force only the empty-tilemap blocks; all=both')
    args = ap.parse_args()
    if args.shard < 0 or args.shard >= args.of_n:
        sys.exit(f"--shard must be in [0, {args.of_n})")

    base = VARIANTS[args.variant]
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Shard {args.shard}/{args.of_n} on host {HOST}")
    print(f"  output: {out_path}")
    print(f"  zoom: {args.min_zoom}–{args.max_zoom}  workers: {args.workers}")
    print(f"  rule: row % {args.of_n} == {args.shard}")
    sys.stdout.flush()

    write_q = queue.Queue(maxsize=2000)
    counters = {'fetched': 0, 'fail': 0, 'bytes': 0}
    cl = threading.Lock()

    def writer():
        conn = init_or_open(out_path)
        batch = []
        while True:
            item = write_q.get()
            if item is None:
                if batch:
                    conn.executemany(
                        "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                        batch); conn.commit()
                conn.close(); return
            batch.append(item)
            if len(batch) >= 200:
                conn.executemany(
                    "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                    batch); conn.commit(); batch.clear()

    wt = threading.Thread(target=writer, daemon=True); wt.start()

    # Reader (separate; this shard's own DB only — no coordination with other shards)
    reader = init_or_open(out_path); reader.close()
    reader = sqlite3.connect(str(out_path)); reader.execute("PRAGMA query_only = TRUE")

    overall_started = time.time()
    print(f"Pass mode: {args.passmode}")
    for z in range(args.min_zoom, args.max_zoom + 1):
        print(f"\n=== z={z} (shard {args.shard}/{args.of_n}, pass={args.passmode}) ===")
        existing_in_cache = discover_existing_tiles(base, z, args.shard, args.of_n, mode=args.passmode)
        already = set()
        for row, col in reader.execute("SELECT tile_row, tile_column FROM tiles WHERE zoom_level = ?", (z,)):
            already.add((row, col))
        to_fetch = [(r, c) for (r, c) in existing_in_cache if (r, c) not in already]
        print(f"  in this shard's DB: {len(already):,}; to fetch: {len(to_fetch):,}")
        sys.stdout.flush()
        if not to_fetch: continue

        zoom_started = time.time()
        last_print = zoom_started
        z_ok = 0; z_fail = 0; z_bytes = 0

        def worker(rc):
            nonlocal z_ok, z_fail, z_bytes
            r, c = rc
            data = fetch_tile(base, z, r, c)
            if data:
                write_q.put((z, c, r, data))
                with cl:
                    z_ok += 1; z_bytes += len(data)
                    counters['fetched'] += 1; counters['bytes'] += len(data)
            else:
                with cl:
                    z_fail += 1; counters['fail'] += 1

        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = [ex.submit(worker, rc) for rc in to_fetch]
            for i, f in enumerate(as_completed(futures), 1):
                f.result()
                now = time.time()
                if now - last_print > 20:
                    elapsed = now - zoom_started
                    rate = i / max(elapsed, 1)
                    eta = (len(to_fetch) - i) / max(rate, 0.1)
                    print(f"  z={z}  {i}/{len(to_fetch)}  ok={z_ok}  fail={z_fail}  "
                          f"{z_bytes/1e6:.1f}MB  {rate:.0f}/s  ETA {eta/60:.0f}min", flush=True)
                    last_print = now
        print(f"  z={z} done: ok={z_ok} fail={z_fail} {z_bytes/1e6:.1f}MB in {(time.time()-zoom_started)/60:.1f}min")

    write_q.put(None); wt.join()
    elapsed = time.time() - overall_started
    print(f"\nShard {args.shard}/{args.of_n} done in {elapsed/60:.1f} min  fetched={counters['fetched']:,}  "
          f"fail={counters['fail']:,}  bytes added={counters['bytes']/1e9:.2f}GB")


if __name__ == "__main__":
    main()
