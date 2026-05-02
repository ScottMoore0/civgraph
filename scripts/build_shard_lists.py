#!/usr/bin/env python
"""Plan-once, fetch-twice: build non-overlapping shard work lists.

Runs discovery (--pass all = tilemap + brute-force fallback) for each
requested zoom against the existing master MBTiles, computes the
remaining-to-fetch set per zoom, and splits row-modulo into N shard files.

Output: D:\\osni-fusion\\shard{0,1,...}.json — each is a JSON list of
[z, row, col] triples. Machines just consume their own list.

Usage:
  python scripts/build_shard_lists.py --min-zoom 12 --max-zoom 13 --shards 2
"""
import argparse, json, sqlite3, sys, time
from pathlib import Path

# Reuse the smart scraper's discovery + endpoints (it sets up stdout encoding on import)
sys.path.insert(0, str(Path(__file__).parent))
from scrape_osni_fusion_smart import (
    VARIANTS, MBTILES, discover_existing_tiles, existing_in_db,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--min-zoom', type=int, default=12)
    ap.add_argument('--max-zoom', type=int, default=13)
    ap.add_argument('--variant', choices=list(VARIANTS), default='light')
    ap.add_argument('--shards', type=int, default=2)
    ap.add_argument('--master', default=str(MBTILES),
                    help='Master MBTiles whose contents define already-done')
    ap.add_argument('--out-dir', default=r'D:\osni-fusion',
                    help='Directory to write shard{N}.json into')
    args = ap.parse_args()

    base = VARIANTS[args.variant]
    master = Path(args.master)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not master.exists():
        print(f"  ! master MBTiles missing: {master}"); sys.exit(1)

    reader = sqlite3.connect(str(master))
    reader.execute("PRAGMA query_only = TRUE")

    shard_lists = [[] for _ in range(args.shards)]
    overall_started = time.time()

    for z in range(args.min_zoom, args.max_zoom + 1):
        print(f"\n=== z={z} discovery (mode=all) ===")
        sys.stdout.flush()
        t0 = time.time()
        candidates = discover_existing_tiles(base, z, mode='all')
        in_db = existing_in_db(reader, z)
        remaining = [(r, c) for (r, c) in candidates if (r, c) not in in_db]
        print(f"  z={z}: candidates={len(candidates):,}  in_db={len(in_db):,}  "
              f"remaining={len(remaining):,}  ({time.time()-t0:.1f}s)")
        for (r, c) in remaining:
            shard_lists[r % args.shards].append([z, r, c])

    reader.close()
    print(f"\n=== writing {args.shards} shard files ===")
    for i, lst in enumerate(shard_lists):
        path = out_dir / f"shard{i}.json"
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(lst, f)
        size_mb = path.stat().st_size / 1e6
        print(f"  {path}: {len(lst):,} tiles  ({size_mb:.1f}MB)")
    print(f"\n=== plan built in {(time.time()-overall_started)/60:.1f} min ===")


if __name__ == "__main__":
    main()
