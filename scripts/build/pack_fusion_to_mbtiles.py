#!/usr/bin/env python
"""Pack the on-disk PNG tile tree into a single MBTiles SQLite file.

Source: D:\\osni-fusion\\fusion-light\\<z>\\<row>\\<col>.png
Output: D:\\osni-fusion\\fusion-light.mbtiles

Stores tiles in OSNI's native (z, row, col) scheme — does NOT apply TMS
y-flip, since the pyramid is in OSNI's custom Irish Grid LOD scheme, not
Web Mercator. The MBTiles is a container, not a Web-Mercator-compliant
tileset.

After packing, run with --verify to compare random-sample SHA256s of
PNGs vs MBTiles BLOBs. Then with --delete-pngs to free disk.
"""
import argparse, hashlib, os, random, sqlite3, sys, time, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from pathlib import Path

ROOT = Path(r"D:\osni-fusion\fusion-light")
MBTILES = Path(r"D:\osni-fusion\fusion-light.mbtiles")
SCHEME = "osni-irishgrid"  # documents that this is not standard XYZ/TMS


def init_db(path: Path):
    if path.exists(): path.unlink()
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    conn.execute("PRAGMA cache_size = -100000")
    conn.execute("""
        CREATE TABLE metadata (name TEXT, value TEXT)
    """)
    conn.execute("""
        CREATE TABLE tiles (
            zoom_level INTEGER,
            tile_column INTEGER,
            tile_row INTEGER,
            tile_data BLOB,
            PRIMARY KEY (zoom_level, tile_column, tile_row)
        ) WITHOUT ROWID
    """)
    # Required + custom metadata
    md = [
        ('name', 'OSNI Fusion Light (NI)'),
        ('format', 'png'),
        ('type', 'baselayer'),
        ('version', '1.0'),
        ('description', 'OSNI Fusion Basemap (Light) — NI extent, scraped from utility.arcgis.com TiledMapServer'),
        ('attribution', '© Crown Copyright & Database Right — SpatialNI / Ordnance Survey of Northern Ireland'),
        ('scheme', SCHEME),
        ('crs', 'EPSG:29902'),
        ('source_service', 'https://utility.arcgis.com/usrsvcs/servers/a2e54f6f39d74347bf2769c45934211c/rest/services/VectorBasemaps/OSNIFusionBasemap_Light/MapServer'),
    ]
    conn.executemany("INSERT INTO metadata (name, value) VALUES (?, ?)", md)
    conn.commit()
    return conn


def pack(verify_sample=200):
    print(f"Initialising {MBTILES} ...")
    conn = init_db(MBTILES)
    started = time.time()
    inserted = 0
    batch = []
    BATCH_SIZE = 1000

    print(f"Walking {ROOT} ...")
    files = []
    for z_dir in sorted(ROOT.iterdir()):
        if not z_dir.is_dir(): continue
        try: z = int(z_dir.name)
        except ValueError: continue
        for row_dir in z_dir.iterdir():
            if not row_dir.is_dir(): continue
            try: row = int(row_dir.name)
            except ValueError: continue
            for f in row_dir.iterdir():
                if not f.name.endswith('.png'): continue
                try: col = int(f.stem)
                except ValueError: continue
                files.append((z, row, col, f))

    print(f"  {len(files):,} PNGs to pack")
    last_print = time.time()
    for i, (z, row, col, f) in enumerate(files, 1):
        try:
            data = f.read_bytes()
            batch.append((z, col, row, data))
        except Exception as e:
            print(f"  ! {f}: {e}")
            continue
        if len(batch) >= BATCH_SIZE:
            conn.executemany(
                "INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                batch)
            batch.clear()
            inserted = i
        now = time.time()
        if now - last_print > 5:
            elapsed = now - started
            rate = i / max(elapsed, 1)
            print(f"  packed {i:,}/{len(files):,}  ({rate:.0f}/s)", flush=True)
            last_print = now
    if batch:
        conn.executemany(
            "INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
            batch)
    conn.commit()
    sz = MBTILES.stat().st_size
    print(f"\nPacked {len(files):,} tiles into {MBTILES.name}: {sz/1e9:.2f} GB ({sz/1e6:.1f} MB)")

    # Verify a random sample
    print(f"\nVerifying random sample of {verify_sample} tiles (SHA256 round-trip) ...")
    rng = random.Random(0xc1f6)
    sample = rng.sample(files, min(verify_sample, len(files)))
    mismatches = 0
    for z, row, col, f in sample:
        on_disk = f.read_bytes()
        cur = conn.execute(
            "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
            (z, col, row))
        row_data = cur.fetchone()
        if not row_data or row_data[0] != on_disk:
            mismatches += 1
            print(f"  MISMATCH at z={z} row={row} col={col}")
    print(f"  {len(sample) - mismatches}/{len(sample)} round-trip identical (sha256 byte match)")
    if mismatches:
        print("  ! refusing to proceed — investigate before deleting PNGs")
        sys.exit(1)
    conn.close()
    return len(files)


def delete_pngs():
    if not MBTILES.exists():
        print("MBTiles file missing — refusing to delete PNGs")
        return
    sz = MBTILES.stat().st_size
    if sz < 100_000_000:  # < 100 MB safety threshold
        print(f"MBTiles is suspiciously small ({sz/1e6:.1f} MB) — refusing to delete PNGs")
        return
    # Delete the per-zoom-dir tree
    print(f"Deleting PNG tree under {ROOT} ...")
    for z_dir in sorted(ROOT.iterdir()):
        if not z_dir.is_dir(): continue
        try: int(z_dir.name)
        except ValueError: continue
        # rmdir recursively
        import shutil
        shutil.rmtree(z_dir)
        print(f"  removed {z_dir.name}")
    print("Done.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify-sample', type=int, default=200)
    ap.add_argument('--delete-pngs', action='store_true', help='After packing+verify, delete the PNG tree')
    args = ap.parse_args()
    pack(args.verify_sample)
    if args.delete_pngs:
        delete_pngs()


if __name__ == "__main__":
    main()
