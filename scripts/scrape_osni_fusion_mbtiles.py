#!/usr/bin/env python
"""Mirror OSNI Fusion Light tile pyramid for the NI extent into MBTiles.

Writes directly to D:\\osni-fusion\\fusion-light.mbtiles (SQLite). Resume:
on each run, skips any (z, row, col) already present in the tiles table.

Tile fetching is concurrent (ThreadPoolExecutor); SQLite writes are
serialised through a single writer thread that drains a queue.
"""
import argparse, sqlite3, sys, time, urllib.request, urllib.error, threading, queue, io
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

UA = "Mozilla/5.0 civgraph/fusion-mirror"
MBTILES = Path(r"D:\osni-fusion\fusion-light.mbtiles")

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


def existing_keys(conn, z):
    """Return the set of (row, col) already present at zoom z."""
    keys = set()
    for row, col in conn.execute("SELECT tile_row, tile_column FROM tiles WHERE zoom_level = ?", (z,)):
        keys.add((row, col))
    return keys


def fetch_tile(base, z, row, col, retries=3):
    url = f"{base}/tile/{z}/{row}/{col}"
    last_err = ''
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://experience.arcgis.com/"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return ('ok', data) if data else ('empty', b'')
        except urllib.error.HTTPError as e:
            if e.code in (404, 500): return (f'http{e.code}', b'')
            last_err = f'HTTP {e.code}'
        except Exception as e:
            last_err = f'{type(e).__name__}: {e}'
            time.sleep(0.5 + attempt)
    return (f'fail({last_err})', b'')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-zoom', type=int, default=11)
    ap.add_argument('--min-zoom', type=int, default=0)
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--variant', choices=list(VARIANTS), default='light')
    args = ap.parse_args()

    base = VARIANTS[args.variant]
    if not MBTILES.exists():
        print(f"  ! MBTiles file does not exist: {MBTILES}")
        print(f"  ! run pack_fusion_to_mbtiles.py first (or rename a fresh DB)")
        sys.exit(1)

    # Single writer thread + queue
    write_q = queue.Queue(maxsize=2000)
    counters = {'ok': 0, 'skip': 0, 'http': 0, 'fail': 0, 'empty': 0, 'bytes': 0}
    counters_lock = threading.Lock()

    def writer_thread():
        conn = sqlite3.connect(str(MBTILES))
        conn.execute("PRAGMA journal_mode = OFF")
        conn.execute("PRAGMA synchronous = OFF")
        batch = []
        while True:
            item = write_q.get()
            if item is None:
                if batch:
                    conn.executemany(
                        "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                        batch)
                    conn.commit()
                conn.close()
                return
            batch.append(item)
            if len(batch) >= 200:
                conn.executemany(
                    "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                    batch)
                conn.commit()
                batch.clear()

    writer = threading.Thread(target=writer_thread, daemon=True)
    writer.start()

    # Plan
    plan = []
    for z in range(args.min_zoom, args.max_zoom + 1):
        c0, c1, r0, r1 = tile_range(z)
        plan.append((z, c0, c1, r0, r1, (c1-c0)*(r1-r0)))
    print("Plan:")
    for z, c0, c1, r0, r1, n in plan:
        print(f"  z={z:>2}  cols={c0}..{c1-1}  rows={r0}..{r1-1}  total={n:,}")
    sys.stdout.flush()

    # Reader connection (separate from writer)
    reader = sqlite3.connect(str(MBTILES))
    reader.execute("PRAGMA query_only = TRUE")
    started = time.time()
    last_print = started

    def worker(z, row, col):
        status, data = fetch_tile(base, z, row, col)
        if status == 'ok':
            write_q.put((z, col, row, data))
            with counters_lock:
                counters['ok'] += 1
                counters['bytes'] += len(data)
        else:
            with counters_lock:
                k = 'http' if status.startswith('http') else 'empty' if status == 'empty' else 'fail'
                counters[k] += 1

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for z, c0, c1, r0, r1, total in plan:
            print(f"\n=== z={z} ({total:,} cells) ===")
            already = existing_keys(reader, z)
            print(f"  already present: {len(already):,}")
            sys.stdout.flush()
            futures = []
            for row in range(r0, r1):
                for col in range(c0, c1):
                    if (row, col) in already:
                        with counters_lock: counters['skip'] += 1
                        continue
                    futures.append(ex.submit(worker, z, row, col))
            for i, f in enumerate(as_completed(futures), 1):
                f.result()
                now = time.time()
                if now - last_print > 30:
                    with counters_lock:
                        elapsed = now - started
                        rate = sum(v for k, v in counters.items() if k != 'bytes') / max(elapsed, 1)
                        print(f"  z={z}  {i}/{len(futures)}  ok={counters['ok']:,}  skip={counters['skip']:,}  "
                              f"http={counters['http']:,}  fail={counters['fail']:,}  "
                              f"{counters['bytes']/1e6:.1f}MB  {rate:.0f}/s",
                              flush=True)
                    last_print = now
            print(f"  z={z} done.")

    write_q.put(None)
    writer.join()
    elapsed = time.time() - started
    print(f"\nDone in {elapsed/60:.1f} min")
    print(f"  ok={counters['ok']:,}  skip={counters['skip']:,}  http={counters['http']:,}  empty={counters['empty']:,}  fail={counters['fail']:,}")
    print(f"  bytes added: {counters['bytes']/1e9:.2f} GB")
    print(f"  MBTiles size: {MBTILES.stat().st_size/1e9:.2f} GB")


if __name__ == "__main__":
    main()
