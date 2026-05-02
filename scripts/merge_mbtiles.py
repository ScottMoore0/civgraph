#!/usr/bin/env python
"""Merge multiple MBTiles files into one.

Use after running shard scrapers on different machines/IPs:
  python merge_mbtiles.py D:\\osni-fusion\\shard-A.mbtiles D:\\osni-fusion\\shard-B.mbtiles
      --output D:\\osni-fusion\\fusion-light.mbtiles
      [--also-merge D:\\osni-fusion\\fusion-light.mbtiles]   # existing prior work

Resolves duplicates with INSERT OR IGNORE (prefers whichever shard wrote
first). Tile data is byte-identical across shards by construction
(both fetch from the same OSNI service), so dedup choice doesn't matter.
"""
import argparse, sqlite3, sys, time, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


def init_master(path: Path, copy_metadata_from: Path | None = None):
    if path.exists():
        print(f"  master already exists: {path}")
        conn = sqlite3.connect(str(path))
    else:
        print(f"  creating master: {path}")
        conn = sqlite3.connect(str(path))
        conn.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
        conn.execute("""CREATE TABLE tiles (
            zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB,
            PRIMARY KEY (zoom_level, tile_column, tile_row)
        ) WITHOUT ROWID""")
        if copy_metadata_from and Path(copy_metadata_from).exists():
            src = sqlite3.connect(str(copy_metadata_from))
            md = src.execute("SELECT name, value FROM metadata").fetchall()
            src.close()
            conn.executemany("INSERT INTO metadata (name, value) VALUES (?, ?)", md)
        conn.commit()
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    return conn


def merge_one(master: sqlite3.Connection, source: Path):
    print(f"\nmerging {source} ...")
    master.execute(f"ATTACH ? AS src", (str(source),))
    t0 = time.time()
    cur = master.execute("SELECT COUNT(*) FROM tiles"); before = cur.fetchone()[0]
    cur = master.execute("SELECT COUNT(*) FROM src.tiles"); src_count = cur.fetchone()[0]
    print(f"  master before: {before:,}  source has: {src_count:,}")
    master.execute("""
        INSERT OR IGNORE INTO tiles (zoom_level, tile_column, tile_row, tile_data)
        SELECT zoom_level, tile_column, tile_row, tile_data FROM src.tiles
    """)
    master.commit()
    cur = master.execute("SELECT COUNT(*) FROM tiles"); after = cur.fetchone()[0]
    print(f"  master after: {after:,}  added: {after-before:,}  duplicates ignored: {src_count-(after-before):,}  ({time.time()-t0:.1f}s)")
    master.execute("DETACH src")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sources', nargs='+', help='MBTiles files to merge')
    ap.add_argument('--output', required=True, help='Master MBTiles to create or extend')
    args = ap.parse_args()
    out = Path(args.output)
    sources = [Path(s) for s in args.sources]
    for s in sources:
        if not s.exists():
            sys.exit(f"missing source: {s}")
    master = init_master(out, copy_metadata_from=sources[0])
    for s in sources:
        merge_one(master, s)
    cur = master.execute("SELECT zoom_level, COUNT(*) FROM tiles GROUP BY zoom_level ORDER BY zoom_level")
    print(f"\nFinal counts in {out}:")
    for z, n in cur.fetchall():
        print(f"  z={z}: {n:,}")
    master.close()
    print(f"\nMaster file size: {out.stat().st_size/1e9:.2f} GB")


if __name__ == "__main__":
    main()
