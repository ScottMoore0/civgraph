#!/usr/bin/env python
"""Recover the 58 ws.cso.ie 403 failures by going around the CSO PxStat
REST endpoint (which 403s on GET) and using its JSON-RPC POST endpoint
instead.

The original mirror tried URLs like:
  https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/<MATRIX>/CSV/1.0/en
which returns 403 Forbidden. The same dataset works via:
  POST https://ws.cso.ie/public/api.jsonrpc
  { "jsonrpc":"2.0", "method":"PxStat.Data.Cube_API.ReadDataset",
    "params":{"class":"query","extension":{"matrix":"<MATRIX>",
    "language":{"code":"en"},"format":{"type":"<FMT>","version":"1.0"}}} }

Output:
  D:/datagovie/Central Statistics Office/<package>/<matrix>.<ext>
Manifest update is via _retry.log alongside the existing manifest.
"""
import csv, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

UA = "Mozilla/5.0 civgraph/cso-pxstat-recover"
ENDPOINT = "https://ws.cso.ie/public/api.jsonrpc"
TARGET_ROOT = Path(r"D:\datagovie")
MISSING_CSV = TARGET_ROOT / "_reconcile_missing.csv"


def safe(s):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(s)).strip(' .')[:80]


def jsonrpc_post(matrix, fmt='JSON-stat', version='2.0'):
    """POST a JSON-RPC ReadDataset request. Returns (status, body, error)."""
    body = {
        "jsonrpc": "2.0",
        "method": "PxStat.Data.Cube_API.ReadDataset",
        "params": {
            "class": "query",
            "id": [],
            "dimension": {},
            "extension": {
                "matrix": matrix,
                "language": {"code": "en"},
                "format": {"type": fmt, "version": version},
            },
            "version": "2.0",
        },
    }
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode('utf-8'),
        headers={"User-Agent": UA, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        # Try parse — if it's a JSON-RPC error response, surface it
        try:
            j = json.loads(data)
            if isinstance(j, dict) and 'error' in j:
                return 'rpc-error', None, j['error'].get('data') or j['error'].get('message')
        except Exception:
            pass
        return 'ok', data, ''
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode('utf-8','replace')[:300]
        except Exception:
            err_body = ''
        return 'http-error', None, f'HTTP {e.code} {e.reason}: {err_body}'
    except Exception as e:
        return 'error', None, f'{type(e).__name__}: {e}'


def main():
    rows_to_recover = []
    with MISSING_CSV.open(encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if 'ws.cso.ie' in r.get('url',''):
                rows_to_recover.append(r)
    print(f"CSO failures to recover: {len(rows_to_recover)}")

    log = (TARGET_ROOT / "_cso_recover.log").open('a', encoding='utf-8')
    log.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} CSO recovery ===\n")

    ok = fail = oversize = 0
    for r in rows_to_recover:
        url = r['url']
        m = re.search(r'/PxStat\.Data\.Cube_API\.ReadDataset/([A-Z0-9]+)/(\w+)/([\d.]+)/(\w+)', url)
        if not m:
            print(f"  ! parse fail  {url}")
            log.write(f"parse-fail  {url}\n")
            fail += 1
            continue
        matrix, fmt, version, lang = m.group(1), m.group(2), m.group(3), m.group(4)

        # Compute on-disk path: under the package_name from the failed manifest row,
        # with the matrix as filename, using the same naming convention the mirror used.
        pkg = safe(r.get('package_name') or matrix.lower())
        org = safe(r.get('organization') or 'Central Statistics Office')
        out_dir = TARGET_ROOT / org / pkg
        out_dir.mkdir(parents=True, exist_ok=True)

        # First try CSV (matches the original format request)
        # Fall back to JSON-stat if cell-limit error.
        attempts = [(fmt, '1.0'), ('JSON-stat', '2.0')]
        success = False
        for try_fmt, try_ver in attempts:
            status, data, err = jsonrpc_post(matrix, try_fmt, try_ver)
            if status == 'ok' and data:
                ext = '.csv' if try_fmt.upper() == 'CSV' else '.json' if try_fmt.startswith('JSON') else f'.{try_fmt.lower()}'
                out_path = out_dir / f"{matrix}{ext}"
                out_path.write_bytes(data)
                print(f"  ok     {matrix}  {try_fmt}  {len(data)/1024:.1f} KB  -> {out_path.relative_to(TARGET_ROOT)}")
                log.write(f"ok      {matrix}  {try_fmt}  {len(data)} bytes  {out_path}\n")
                ok += 1
                success = True
                break
            elif status == 'rpc-error' and 'cells' in (err or ''):
                # Cell-limit hit — try next format
                if try_fmt == fmt:
                    print(f"  oversize {matrix}  {try_fmt} cell-limit; trying {attempts[1][0]} ...")
                    log.write(f"oversize {matrix}  {try_fmt}  {err}\n")
                    continue
                else:
                    oversize += 1
                    log.write(f"oversize {matrix}  {try_fmt}  {err}\n")
                    print(f"  ! oversize even in {try_fmt}: {matrix}")
                    break
            else:
                print(f"  fail   {matrix}  {try_fmt}  {err[:100]}")
                log.write(f"fail    {matrix}  {try_fmt}  {err}\n")
                if try_fmt == fmt:
                    continue
                else:
                    break
        if not success:
            fail += 1
        time.sleep(0.5)
        log.flush()

    print(f"\nDone. ok={ok}  oversize={oversize}  fail={fail}")
    log.close()


if __name__ == "__main__":
    main()
