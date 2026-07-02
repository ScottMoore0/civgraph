#!/usr/bin/env python3
"""Emit chunked UPDATEs that restore FULL descriptions for the handful of records
whose description exceeds the D1 single-statement (~100 KB) limit.

D1 can store values up to 2 MB; the only constraint is per-statement text size.
So we build each oversized value up across several sub-100 KB statements:

  UPDATE proni SET description = '<chunk0>'                WHERE ref='X';
  UPDATE proni SET description = description || '<chunk1>' WHERE ref='X';
  ...

Ordering is per-ref and sequential, so the concatenation reassembles the exact
original text. Run AFTER the batched upsert (which sets the truncated value that
these statements overwrite in full).
"""
import sqlite3, argparse

def lit(s):
    return "'" + s.replace("'", "''") + "'"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sqlite', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--threshold', type=int, default=85000)
    ap.add_argument('--chunk', type=int, default=40000)  # chars; ~<100KB after escaping
    args = ap.parse_args()

    db = sqlite3.connect(args.sqlite)
    rows = db.execute(
        'SELECT ref, description FROM proni WHERE length(description) > ? ORDER BY ref',
        (args.threshold,)
    ).fetchall()

    records = 0
    stmts = 0
    with open(args.out, 'w', encoding='utf-8') as o:
        for ref, desc in rows:
            if not desc:
                continue
            records += 1
            reflit = lit(ref)
            first = True
            for i in range(0, len(desc), args.chunk):
                c = desc[i:i + args.chunk]
                if first:
                    o.write(f"UPDATE proni SET description={lit(c)} WHERE ref={reflit};\n")
                    first = False
                else:
                    o.write(f"UPDATE proni SET description=description||{lit(c)} WHERE ref={reflit};\n")
                stmts += 1
    db.close()
    print(f'records: {records} | statements: {stmts} -> {args.out}')

if __name__ == '__main__':
    main()
