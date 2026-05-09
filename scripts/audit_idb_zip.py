"""Audit the 2026-05-09 'Irish Digitised Boundaries' zip against current
maps.json and R2: for each FGB in the zip, check whether the website
currently references it, whether it's on R2, and whether the bytes
match.
"""
from __future__ import annotations
import hashlib, json, os, subprocess, sys
from urllib.parse import quote

ROOT = '_tmp_idb_zip/Irish Digitised Boundaries'

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def head_remote(url):
    """Return (status, content-length, etag) for a HEAD."""
    enc_url = url.split('://')[0] + '://' + url.split('://')[1].split('/')[0] + '/' + quote(url.split('://')[1].split('/', 1)[1], safe='/')
    r = subprocess.run(
        ['curl', '-sI', '--max-time', '8', enc_url],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        return None, None, None
    status = None
    length = None
    etag = None
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith('HTTP/'):
            try: status = int(line.split()[1])
            except: pass
        if line.lower().startswith('content-length:'):
            try: length = int(line.split(':',1)[1].strip())
            except: pass
        if line.lower().startswith('etag:'):
            etag = line.split(':',1)[1].strip().strip('"')
    return status, length, etag


# --- collect zip inventory ---
zip_records = []
for dirpath, _, files in os.walk(ROOT):
    for fn in files:
        if not fn.lower().endswith('.fgb'):
            continue
        p = os.path.join(dirpath, fn)
        rel = os.path.relpath(p, ROOT).replace('\\', '/')
        zip_records.append({
            'rel': rel,
            'name': fn,
            'size': os.path.getsize(p),
            'sha': sha(p),
            'local_path': p,
        })

# --- map basename -> maps.json entries that reference it ---
with open('data/database/maps.json', encoding='utf-8') as f:
    maps_data = json.load(f)
basename_to_entries = {}
for m in maps_data['maps']:
    fgb = m.get('files', {}).get('fgb', '')
    if fgb:
        bn = fgb.rsplit('/', 1)[-1].split('?')[0]
        basename_to_entries.setdefault(bn, []).append((m['id'], fgb))
    for v in m.get('variants', []) or []:
        vfgb = v.get('files', {}).get('fgb', '')
        if vfgb:
            bn = vfgb.rsplit('/', 1)[-1]
            basename_to_entries.setdefault(bn, []).append((m['id'] + '/' + v.get('id',''), vfgb))


# --- audit each zip file ---
print(f'{"size":>10} {"zip-sha":>16}  {"R2":>3} {"r2-bytes":>10}  {"match?":>6}  zip path')
print('-' * 110)
for r in sorted(zip_records, key=lambda r: r['rel']):
    bn = r['name']
    entries = basename_to_entries.get(bn, [])
    if entries:
        # Take the first matching URL
        _id, url = entries[0]
        status, length, _etag = head_remote(url)
    else:
        status, length, _etag = None, None, None
    match = ('=' if length == r['size'] else '!') if status == 200 else '-'
    note = ''
    if not entries:
        note = 'NOT REFERENCED in maps.json'
    elif status != 200:
        note = f'NOT ON R2 ({status}) — referenced by {entries[0][0]}'
    elif length != r['size']:
        note = f'SIZE MISMATCH (zip {r["size"]} vs R2 {length}) — {entries[0][0]}'
    else:
        note = f'OK — {entries[0][0]}'
    print(f'{r["size"]:>10} {r["sha"]}  {status if status else "-":>3} {length if length else "-":>10}  {match:>6}  {r["rel"]}    | {note}')

print(f'\n{len(zip_records)} FGB files in zip')
