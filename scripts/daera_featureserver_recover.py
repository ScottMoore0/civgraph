#!/usr/bin/env python
"""Recover the 184 DAERA Hub 500-error failures by going around the
broken Hub dynamic export endpoint and querying the underlying ArcGIS
FeatureServer directly with paginated requests.

Strategy:
  1. Walk D:/opendatani/_manifest.csv for rows where url matches
     `https://opendata-daerani.hub.arcgis.com/api/download/v1/items/<itemid>/<format>?layers=<N>`
  2. Group by (item_id, layer) — many manifest rows are different formats
     of the same underlying layer.
  3. For each (item_id, layer):
     - Resolve the FeatureServer URL via the ArcGIS Hub item info API
       (https://www.arcgis.com/sharing/rest/content/items/{item_id}?f=json)
     - Paginate `query?where=1=1&outFields=*&resultOffset=N&resultRecordCount=2000&f=geojson`
       until exhausted.
  4. Concatenate features → one GeoJSON file per (item, layer).
  5. Save under D:/opendatani/<DAERA recovery>/<item_id>/<layer>.geojson
  6. Mark the matching manifest rows as recovered (in a side-log).
"""
import argparse, csv, json, os, re, sys, time, urllib.parse, urllib.request, io
from collections import defaultdict
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

UA = "Mozilla/5.0 boundaries-website/daera-recovery"
TARGET_ROOT = Path(r"D:\opendatani\DAERA Hub recovery")
TARGET_ROOT.mkdir(parents=True, exist_ok=True)
MANIFEST = Path(r"D:\opendatani\_manifest.csv")


def load_failures():
    """Group manifest rows by (item_id, layer)."""
    by_item_layer = defaultdict(list)
    with MANIFEST.open(encoding='utf-8') as f:
        for row in csv.DictReader(f):
            if row['status'] != 'failed': continue
            url = row['url']
            m = re.search(r'/items/([0-9a-f]+)/[^?]+\?layers=(\d+)', url)
            if not m: continue
            if 'opendata-daerani.hub.arcgis.com' not in url: continue
            item_id, layer = m.group(1), int(m.group(2))
            by_item_layer[(item_id, layer)].append(row)
    return by_item_layer


def hub_item_info(item_id):
    """Returns the ArcGIS item details for the given Hub item id."""
    url = f"https://www.arcgis.com/sharing/rest/content/items/{item_id}?f=json"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def paginate_layer(fs_url, layer, page_size=2000):
    """Paginate query against <fs_url>/<layer>/query and yield batches of features."""
    url = f"{fs_url.rstrip('/')}/{layer}/query"
    offset = 0
    total = 0
    while True:
        params = {
            'where': '1=1',
            'outFields': '*',
            'returnGeometry': 'true',
            'outSR': 4326,
            'resultOffset': offset,
            'resultRecordCount': page_size,
            'f': 'geojson',
        }
        req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}",
                                     headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
        feats = data.get('features') or []
        if not feats:
            break
        yield feats
        total += len(feats)
        if len(feats) < page_size:
            break
        offset += len(feats)
    return


def safe(s):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(s)).strip(' .')[:80]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()

    print("Loading DAERA Hub failures from manifest ...")
    groups = load_failures()
    items = sorted(set(k[0] for k in groups))
    print(f"  {len(groups)} unique (item, layer) combinations across {len(items)} items")
    print(f"  ({sum(len(v) for v in groups.values())} manifest rows total)")
    if args.limit:
        groups = dict(list(groups.items())[: args.limit])
        print(f"  --limit {args.limit}")

    if args.dry_run:
        for (item, layer), rows in list(groups.items())[:10]:
            print(f"  {item}/{layer}: {len(rows)} format variants")
        return

    item_info_cache = {}
    out_log = TARGET_ROOT / "_recovery.log"
    log_f = out_log.open('a', encoding='utf-8')
    log_f.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} run ===\n")

    ok = fail = 0
    started = time.time()
    for (item_id, layer), manifest_rows in groups.items():
        if item_id not in item_info_cache:
            try:
                item_info_cache[item_id] = hub_item_info(item_id)
            except Exception as e:
                print(f"  ! {item_id}: item info failed: {e}")
                item_info_cache[item_id] = None
                fail += len(manifest_rows)
                log_f.write(f"item-info-fail  {item_id}  {e}\n")
                continue
        info = item_info_cache[item_id]
        if not info:
            fail += len(manifest_rows)
            continue
        title = info.get('title') or item_id
        fs_url = info.get('url')
        if not fs_url or ('FeatureServer' not in fs_url and 'MapServer' not in fs_url):
            print(f"  ! {item_id} {title!r}: no Feature/MapServer URL ({fs_url})")
            fail += len(manifest_rows)
            log_f.write(f"no-fs-url  {item_id}  url={fs_url}\n")
            continue
        # Skip raster MapServers — they aren't queryable as features
        if 'MapServer' in fs_url:
            try:
                probe = urllib.request.Request(fs_url + "?f=json", headers={"User-Agent": UA})
                with urllib.request.urlopen(probe, timeout=30) as r:
                    layer_meta = json.loads(r.read()).get('layers') or []
                kinds = set(L.get('type','') for L in layer_meta)
                if kinds and all(k == 'Raster Layer' for k in kinds):
                    print(f"  - {item_id} {title!r}: raster-only (skipping; would need image export)")
                    log_f.write(f"raster     {item_id}  {fs_url}\n")
                    fail += len(manifest_rows)
                    continue
            except Exception as e:
                pass
        out_dir = TARGET_ROOT / safe(title)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"layer{layer}.geojson"
        if out_file.exists() and out_file.stat().st_size > 1000:
            ok += len(manifest_rows)
            log_f.write(f"cached     {item_id}/{layer}  {out_file}\n")
            continue
        try:
            print(f"  fetching {item_id} layer={layer} <- {title!r}")
            sys.stdout.flush()
            feats = []
            for batch in paginate_layer(fs_url, layer):
                feats.extend(batch)
            if not feats:
                print(f"    no features returned")
                log_f.write(f"empty      {item_id}/{layer}  {fs_url}\n")
                fail += len(manifest_rows)
                continue
            out = {"type": "FeatureCollection", "features": feats}
            out_file.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
            print(f"    wrote {out_file.name}: {len(feats)} features, {out_file.stat().st_size/1e6:.1f} MB")
            log_f.write(f"ok         {item_id}/{layer}  feats={len(feats)}  {out_file}\n")
            ok += len(manifest_rows)
        except Exception as e:
            print(f"    ! {e}")
            log_f.write(f"fail       {item_id}/{layer}  {e}\n")
            fail += len(manifest_rows)
        log_f.flush()
        time.sleep(0.5)

    print(f"\nDone in {(time.time()-started)/60:.1f} min")
    print(f"  manifest rows recovered: {ok}, failed: {fail}")
    log_f.close()


if __name__ == "__main__":
    main()
