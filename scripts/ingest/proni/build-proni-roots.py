#!/usr/bin/env python3
"""Emit the PRONI browse landing (top-level fonds) as a static JSON file.

The roots list is fixed until a re-import, so serving it as a static CDN asset
is faster and cheaper than a D1 query on every landing visit. Same shape as
`GET /_api/proni/node`, so the client can use either.
"""
import sqlite3, json, argparse

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sqlite', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    db = sqlite3.connect(args.sqlite)
    rows = db.execute(
        "SELECT ref, slug, title, level, dates, has_children "
        "FROM proni WHERE parent = '' ORDER BY ref"
    ).fetchall()
    roots = [
        {'ref': r[0], 'slug': r[1], 'title': r[2] or r[0],
         'level': r[3] or '', 'dates': r[4] or '', 'hasChildren': bool(r[5])}
        for r in rows
    ]
    db.close()
    with open(args.out, 'w', encoding='utf-8') as o:
        json.dump({'roots': roots, 'count': len(roots)}, o, ensure_ascii=False)
    print(f'wrote {len(roots):,} roots -> {args.out}')

if __name__ == '__main__':
    main()
