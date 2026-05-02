#!/usr/bin/env python
"""Mirror OSNI Fusion Light tile pyramid for the NI extent.

ArcGIS MapServer tile cache:
  https://utility.arcgis.com/usrsvcs/servers/<id>/rest/services/VectorBasemaps/OSNIFusionBasemap_Light/MapServer/tile/{z}/{y}/{x}

CRS is EPSG:29902 (Irish Grid TM75). The tile pyramid uses OSNI's custom LOD
scheme, NOT Web Mercator. Tile origin: (-5422600, 4321499.999999996).

Saves to D:\\osni-fusion\\fusion-light\\<z>\\<row>\\<col>.png
Resume: skips any tile that already exists with size > 0.

Usage:
  python scripts/scrape_osni_fusion.py [--max-zoom 11] [--workers 6] [--variant light|full]
"""
import argparse, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

UA = "Mozilla/5.0 boundaries-website/fusion-mirror"
ROOT = Path(r"D:\osni-fusion")

VARIANTS = {
    'light': 'https://utility.arcgis.com/usrsvcs/servers/a2e54f6f39d74347bf2769c45934211c/rest/services/VectorBasemaps/OSNIFusionBasemap_Light/MapServer',
    'full':  'https://utility.arcgis.com/usrsvcs/servers/69fee3e0b52f4dd8860e4c8fe6b5cb28/rest/services/VectorBasemaps/OSNIFusionBasemap/MapServer',
}

# Irish Grid LOD resolutions (m/pixel) per OSNI tileInfo, level 0..14
LODS_RES = [529.1677, 396.8758, 291.0422, 145.5211, 63.5001, 31.7501, 15.8750,
            7.9375, 5.2917, 2.6458, 2.1167, 1.3229, 0.6615, 0.3307, 0.1323]
TILE_PX = 256
TILE_ORIGIN_X = -5422600.0
TILE_ORIGIN_Y = 4321499.999999996

# NI bbox in Irish Grid (EPSG:29902), with a small buffer
NI_X_MIN, NI_X_MAX = 50000, 370000
NI_Y_MIN, NI_Y_MAX = 310000, 480000


def tile_range(z):
    """Return (col_min, col_max, row_min, row_max) for NI at zoom z."""
    res = LODS_RES[z]
    tm = res * TILE_PX
    col_min = int((NI_X_MIN - TILE_ORIGIN_X) / tm)
    col_max = int((NI_X_MAX - TILE_ORIGIN_X) / tm) + 1
    row_min = int((TILE_ORIGIN_Y - NI_Y_MAX) / tm)
    row_max = int((TILE_ORIGIN_Y - NI_Y_MIN) / tm) + 1
    return col_min, col_max, row_min, row_max


def fetch_tile(base, z, row, col, dest, retries=3):
    if dest.exists() and dest.stat().st_size > 0:
        return 'skip', dest.stat().st_size
    url = f"{base}/tile/{z}/{row}/{col}"
    last_err = ''
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Referer": "https://experience.arcgis.com/",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if not data or data[:4] != b'\x89PNG':
                # Some valid responses might be JPEG or empty for blank tiles
                if data and data[:3] == b'\xff\xd8\xff':
                    pass  # JPEG OK
                elif not data:
                    return 'empty', 0
                # else accept whatever was returned
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return 'ok', len(data)
        except urllib.error.HTTPError as e:
            if e.code == 404 or e.code == 500:
                # Many tile coords legitimately have no cached tile
                return f'http{e.code}', 0
            last_err = f'HTTP {e.code}'
        except Exception as e:
            last_err = f'{type(e).__name__}: {e}'
            time.sleep(0.5 + attempt)
    return f'fail({last_err})', 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-zoom', type=int, default=11)
    ap.add_argument('--min-zoom', type=int, default=0)
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--variant', choices=list(VARIANTS), default='light')
    ap.add_argument('--sleep', type=float, default=0.05, help='delay between submissions per worker')
    args = ap.parse_args()

    base = VARIANTS[args.variant]
    out_root = ROOT / f'fusion-{args.variant}'
    out_root.mkdir(parents=True, exist_ok=True)
    log = (out_root / '_scrape.log').open('a', encoding='utf-8')
    log.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} variant={args.variant} z={args.min_zoom}-{args.max_zoom} ===\n")
    log.flush()

    # Compute tile lists per zoom
    plan = []
    total = 0
    for z in range(args.min_zoom, args.max_zoom + 1):
        c0, c1, r0, r1 = tile_range(z)
        n = (c1 - c0) * (r1 - r0)
        total += n
        plan.append((z, c0, c1, r0, r1))
        print(f"  z={z:>2}  cols={c0}..{c1-1} ({c1-c0})  rows={r0}..{r1-1} ({r1-r0})  total={n:,}")
    print(f"\nTotal tiles to consider: {total:,}")
    print(f"Target dir: {out_root}")
    sys.stdout.flush()

    counters = {'ok': 0, 'skip': 0, 'empty': 0, 'fail': 0, 'http': 0, 'bytes': 0}
    cl = Lock()
    started = time.time()
    last_print = started

    def worker(z, row, col):
        dest = out_root / str(z) / str(row) / f'{col}.png'
        status, sz = fetch_tile(base, z, row, col, dest)
        bucket = 'ok' if status == 'ok' else 'skip' if status == 'skip' else 'empty' if status == 'empty' else 'http' if status.startswith('http') else 'fail'
        with cl:
            counters[bucket] += 1
            counters['bytes'] += sz

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for z, c0, c1, r0, r1 in plan:
            futures = []
            for row in range(r0, r1):
                for col in range(c0, c1):
                    futures.append(ex.submit(worker, z, row, col))
            for i, f in enumerate(as_completed(futures), 1):
                f.result()
                now = time.time()
                if now - last_print > 20:
                    with cl:
                        elapsed = now - started
                        rate = sum(v for k, v in counters.items() if k != 'bytes') / max(elapsed, 1)
                        print(f"  z={z}  {i}/{len(futures)}  ok={counters['ok']:,}  skip={counters['skip']:,}  http={counters['http']:,}  fail={counters['fail']:,}  {counters['bytes']/1e6:.1f}MB  {rate:.0f}/s",
                              flush=True)
                    last_print = now
            print(f"  z={z} complete: {len(futures)} attempts (cumulative ok={counters['ok']:,}, http={counters['http']:,}, fail={counters['fail']:,})")
            log.write(f"  z={z} done; cumulative ok={counters['ok']} http={counters['http']} fail={counters['fail']} bytes={counters['bytes']}\n")
            log.flush()

    elapsed = time.time() - started
    print(f"\nDone in {elapsed/60:.1f} min")
    print(f"  ok={counters['ok']:,}  skip={counters['skip']:,}  http-error={counters['http']:,}  fail={counters['fail']:,}")
    print(f"  total bytes: {counters['bytes']/1e9:.2f} GB")
    log.close()


if __name__ == "__main__":
    main()
