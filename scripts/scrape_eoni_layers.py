#!/usr/bin/env python
"""Scrape EONI Polling Stations + Properties layers from the OSNI Spatial NI
ArcGIS Hub via paginated FeatureServer/MapServer queries.

Outputs:
  D:\\eoni\\polling_stations.geojson    (607 features)
  D:\\eoni\\properties.geojson          (~831,159 features)
  D:\\eoni\\_scrape.log                  per-batch log
"""
import json, sys, io, time, urllib.parse, urllib.request
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

UA = "Mozilla/5.0 civgraph/eoni-scrape (one-shot, polite)"
OUT = Path(r"D:\eoni")
OUT.mkdir(parents=True, exist_ok=True)

LAYERS = {
    'polling_stations': 'https://utility.arcgis.com/usrsvcs/servers/f2ff050dd56543e58dc291eeb2a56800/rest/services/A_EONI_PollingStationsApp/A_EONI_PollingStationsandProperties/MapServer/0',
    'properties':       'https://utility.arcgis.com/usrsvcs/servers/7065d127aefd4253a031925c79a3fd98/rest/services/A_EONI_PollingStationsApp/A_EONI_PollingStationsandProperties/MapServer/1',
}
PAGE_SIZE = 2000


def fetch(url, retries=4):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": "https://experience.arcgis.com/",
    })
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode('utf-8', errors='replace')
        except Exception as e:
            last = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"giving up after {retries} retries: {last}")


def count_layer(base):
    qs = urllib.parse.urlencode({'where': '1=1', 'returnCountOnly': 'true', 'f': 'json'})
    return json.loads(fetch(f"{base}/query?{qs}")).get('count')


def page(base, offset, page_size=PAGE_SIZE):
    qs = urllib.parse.urlencode({
        'where': '1=1', 'outFields': '*', 'returnGeometry': 'true',
        'outSR': 4326,
        'resultOffset': offset, 'resultRecordCount': page_size,
        'f': 'geojson',
    })
    return json.loads(fetch(f"{base}/query?{qs}"))


def scrape(name, base, log_file, sleep=0.6):
    out_path = OUT / f"{name}.geojson"
    total = count_layer(base)
    print(f"\n=== {name}: {total:,} features ===")
    log_file.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} {name}: target {total} features ===\n")
    log_file.flush()
    all_feats = []
    offset = 0
    pages = 0
    started = time.time()
    last_print = started
    while True:
        try:
            r = page(base, offset)
        except Exception as e:
            log_file.write(f"  page offset={offset} ERR {e}\n")
            print(f"  ERROR at offset {offset}: {e}")
            break
        feats = r.get('features') or []
        if not feats: break
        all_feats.extend(feats)
        pages += 1
        offset += len(feats)
        if time.time() - last_print > 10 or len(feats) < PAGE_SIZE:
            elapsed = time.time() - started
            rate = (offset / max(elapsed, 1))
            print(f"  page {pages}: offset={offset:>7}/{total:,}  ({rate:.0f} feats/s)", flush=True)
            log_file.write(f"  page {pages} offset={offset} feats={len(feats)}\n")
            log_file.flush()
            last_print = time.time()
        if len(feats) < PAGE_SIZE: break
        if offset >= total: break
        time.sleep(sleep)

    fc = {"type": "FeatureCollection", "features": all_feats}
    out_path.write_text(json.dumps(fc, ensure_ascii=False), encoding='utf-8')
    sz = out_path.stat().st_size
    print(f"  wrote {out_path}  ({sz/1e6:.1f} MB, {len(all_feats):,} features)")
    log_file.write(f"  done. {len(all_feats)} features  {sz/1e6:.1f} MB  in {(time.time()-started)/60:.1f} min\n")
    log_file.flush()
    return len(all_feats), sz


def main():
    log_file = (OUT / "_scrape.log").open('a', encoding='utf-8')
    for name, base in LAYERS.items():
        scrape(name, base, log_file)
    log_file.close()


if __name__ == "__main__":
    main()
