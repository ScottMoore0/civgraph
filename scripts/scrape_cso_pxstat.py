"""Download every CSO PXStat cube via the public RESTful API.

Catalogue:
  GET https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadCollection?params={"language":{"code":"en"}}

Each cube data:
  GET https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/<matrix>/JSON-stat/2.0/en

Outputs:
  D:\\cso-pxstat\\<matrix-prefix>\\<matrix>.json   — full JSON-stat data
  D:\\cso-pxstat\\<matrix-prefix>\\<matrix>.meta.json — release metadata
  D:\\cso-pxstat\\_catalogue.json                  — full catalogue
  D:\\cso-pxstat\\_log.txt                         — append-only log
  D:\\cso-pxstat\\_done.txt                        — list of completed matrices for resume
"""
import os, time, json, sys, re, urllib.parse, io
from pathlib import Path
import httpx
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(r'D:\cso-pxstat')
ROOT.mkdir(parents=True, exist_ok=True)
LOG = ROOT / '_log.txt'
CAT_PATH = ROOT / '_catalogue.json'
DONE_PATH = ROOT / '_done.txt'

API = 'https://ws.cso.ie/public/api.restful'
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data archive)'}
c = httpx.Client(headers=HEADERS, timeout=300.0, follow_redirects=True)


def log(msg):
    t = time.strftime('%H:%M:%S')
    line = f'[{t}] {msg}'
    print(line)
    with open(LOG, 'a', encoding='utf-8', errors='replace') as f:
        f.write(line + '\n')


def load_done():
    if DONE_PATH.exists():
        return set(DONE_PATH.read_text(encoding='utf-8').splitlines())
    return set()


def add_done(matrix):
    with open(DONE_PATH, 'a', encoding='utf-8') as f:
        f.write(matrix + '\n')


def fetch_catalogue():
    if CAT_PATH.exists():
        log('using cached catalogue')
        return json.loads(CAT_PATH.read_text(encoding='utf-8'))
    params = urllib.parse.quote(json.dumps({'language': {'code': 'en'}}))
    url = f'{API}/PxStat.Data.Cube_API.ReadCollection?params={params}'
    log('fetching catalogue...')
    r = c.get(url, timeout=600.0)
    r.raise_for_status()
    data = r.json()
    with open(CAT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    items = data.get('link', {}).get('item', [])
    log(f'catalogue saved — {len(items)} matrices')
    return data


def fetch_cube(matrix):
    url = f'{API}/PxStat.Data.Cube_API.ReadDataset/{matrix}/JSON-stat/2.0/en'
    r = c.get(url, timeout=600.0)
    if r.status_code != 200:
        return None, r.status_code
    return r.json(), 200


def main():
    log('=== CSO PXStat scraper start ===')
    cat = fetch_catalogue()
    items = cat.get('link', {}).get('item', [])
    log(f'catalogue has {len(items)} matrices')
    if not items:
        log('! catalogue empty — aborting')
        return

    done = load_done()
    log(f'already done: {len(done)}')

    fetched = 0; failed = 0; bytes_added = 0; skipped = 0
    for i, it in enumerate(items, 1):
        ext = it.get('extension', {}) or {}
        m = ext.get('matrix')
        if not m: continue
        if m in done:
            skipped += 1
            continue
        # output path: D:\cso-pxstat\<first 3 chars of matrix>\<matrix>.json
        prefix = m[:3] if len(m) >= 3 else 'misc'
        out_dir = ROOT / prefix
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f'{m}.json'
        meta_path = out_dir / f'{m}.meta.json'
        if out_path.exists():
            add_done(m); done.add(m); skipped += 1
            continue
        try:
            data, status = fetch_cube(m)
            if data is None:
                log(f'  [{i}/{len(items)}] {m} ! HTTP {status}')
                failed += 1
                continue
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(it, f, indent=2, ensure_ascii=False)
            sz = out_path.stat().st_size
            bytes_added += sz
            fetched += 1
            add_done(m); done.add(m)
            if fetched % 50 == 0 or sz > 5 * 1024 * 1024:
                log(f'  [{i}/{len(items)}] {m}: {sz/1e6:.1f}MB '
                    f'(fetched={fetched} fail={failed} skip={skipped} '
                    f'+{bytes_added/1e9:.2f}GB)')
        except Exception as e:
            log(f'  [{i}/{len(items)}] {m} ! {type(e).__name__}: {str(e)[:200]}')
            failed += 1
        time.sleep(0.4)

    log(f'=== done: fetched={fetched} failed={failed} skipped={skipped} '
        f'+{bytes_added/1e9:.2f}GB ===')


if __name__ == '__main__':
    main()
