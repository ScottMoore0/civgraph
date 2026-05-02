#!/usr/bin/env python
"""Fetch a pre-computed list of tiles into an MBTiles file.

Consumes shardN.json (list of [z, row, col]) produced by build_shard_lists.py.
Resume-safe — anything already in the output MBTiles is skipped.

All scraper optimisations are inherited from scrape_osni_fusion_smart:
  - httpx HTTP/1.1 connection pool, 16 workers
  - 3-minute Client recycle (bypasses session-throttle decay)
  - single SQLite writer thread, 200-batch commits

Machine A:
  python scrape_osni_fusion_shardlist.py --shardlist D:\\osni-fusion\\shard0.json \
      --output D:\\osni-fusion\\fusion-light.mbtiles --workers 16

Machine B (different IP):
  python scrape_osni_fusion_shardlist.py --shardlist shard1.json \
      --output fusion-light-shardB.mbtiles --workers 16
"""
import argparse, json, sqlite3, sys, time, threading, queue
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# scrape_osni_fusion_smart sets up stdout encoding on import
sys.path.insert(0, str(Path(__file__).parent))
from scrape_osni_fusion_smart import VARIANTS, fetch_tile


def init_output(path: Path):
    if path.exists():
        return sqlite3.connect(str(path))
    print(f"  creating output MBTiles: {path}")
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
    conn.execute("""CREATE TABLE tiles (
        zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB,
        PRIMARY KEY (zoom_level, tile_column, tile_row)
    ) WITHOUT ROWID""")
    conn.commit()
    return conn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shardlist', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--workers', type=int, default=16)
    ap.add_argument('--variant', choices=list(VARIANTS), default='light')
    args = ap.parse_args()

    base = VARIANTS[args.variant]
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"loading shardlist: {args.shardlist}")
    with open(args.shardlist, 'r', encoding='utf-8') as f:
        plan = json.load(f)
    print(f"  plan: {len(plan):,} tiles")

    # Resume: skip what's already in output
    seed = init_output(out); seed.close()
    reader = sqlite3.connect(str(out))
    reader.execute("PRAGMA query_only = TRUE")
    existing = set()
    for z, c, r in reader.execute("SELECT zoom_level, tile_column, tile_row FROM tiles"):
        existing.add((z, r, c))
    reader.close()
    todo = [(z, r, c) for (z, r, c) in plan if (z, r, c) not in existing]
    print(f"  already in output: {len(existing):,}  to fetch: {len(todo):,}")
    sys.stdout.flush()
    if not todo:
        print("nothing to do."); return

    write_q = queue.Queue(maxsize=2000)
    counters = {'ok': 0, 'fail': 0, 'bytes': 0}
    cl = threading.Lock()

    def writer_thread():
        conn = sqlite3.connect(str(out))
        conn.execute("PRAGMA journal_mode = OFF")
        conn.execute("PRAGMA synchronous = OFF")
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

    writer = threading.Thread(target=writer_thread, daemon=True); writer.start()

    def worker(zrc):
        z, r, c = zrc
        data = fetch_tile(base, z, r, c)
        if data:
            write_q.put((z, c, r, data))
            with cl:
                counters['ok'] += 1
                counters['bytes'] += len(data)
        else:
            with cl:
                counters['fail'] += 1

    started = time.time(); last_print = started
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(worker, zrc) for zrc in todo]
        for i, f in enumerate(as_completed(futures), 1):
            f.result()
            now = time.time()
            if now - last_print > 20:
                elapsed = now - started
                rate = i / max(elapsed, 1)
                eta = (len(todo) - i) / max(rate, 0.1)
                print(f"  {i}/{len(todo)}  ok={counters['ok']:,}  fail={counters['fail']}  "
                      f"{counters['bytes']/1e6:.1f}MB  {rate:.0f}/s  ETA {eta/60:.0f}min",
                      flush=True)
                last_print = now

    write_q.put(None); writer.join()
    elapsed = time.time() - started
    print(f"\n=== done in {elapsed/60:.1f} min ===")
    print(f"  ok: {counters['ok']:,}  fail: {counters['fail']:,}")
    print(f"  bytes added: {counters['bytes']/1e9:.2f} GB")
    print(f"  output size: {out.stat().st_size/1e9:.2f} GB")


if __name__ == "__main__":
    main()
