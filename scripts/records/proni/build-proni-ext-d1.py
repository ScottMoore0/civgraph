#!/usr/bin/env python3
"""Emit D1-import parts for the Extracted Dates "Additional Data" layer.

Reads extracted-dates.sqlite (table `ext`, keyed by PRONI ref) and writes a
000-schema.sql (a standalone `ext` table + a year-range index, LEFT JOINed to
`proni` at query time by ref) followed by numbered INSERT OR IGNORE parts.

Kept as a SEPARATE table (not columns on `proni`) so it is decoupled from the
periodic description re-import, and so loading is fast INSERTs rather than 1.5M
UPDATEs. Same D1 limits as build-proni-d1-parts.py: <~100 KB/statement,
moderate file size, retry-safe.
"""
import sqlite3, os, argparse

COLS = ['ref', 'ext_start_date', 'ext_end_date', 'ext_start_year', 'ext_end_year',
        'ext_circa', 'ext_estimated', 'ext_bound', 'ext_undated', 'ext_display']

SCHEMA = """CREATE TABLE IF NOT EXISTS ext (
  ref TEXT PRIMARY KEY,
  ext_start_date TEXT, ext_end_date TEXT,
  ext_start_year INTEGER, ext_end_year INTEGER,
  ext_circa INTEGER, ext_estimated INTEGER, ext_bound TEXT, ext_undated INTEGER,
  ext_display TEXT
);
CREATE INDEX IF NOT EXISTS ext_years ON ext(ext_start_year, ext_end_year);
"""


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sqlite', required=True)
    ap.add_argument('--outdir', required=True)
    ap.add_argument('--rows-per-statement', type=int, default=100)
    ap.add_argument('--rows-per-part', type=int, default=60000)
    ap.add_argument('--max-stmt-bytes', type=int, default=90000)
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    with open(os.path.join(args.outdir, '000-schema.sql'), 'w', encoding='utf-8') as o:
        o.write(SCHEMA)

    db = sqlite3.connect(args.sqlite)
    cur = db.execute(f"SELECT {','.join(COLS)} FROM ext")
    head = f"INSERT OR IGNORE INTO ext({','.join(COLS)}) VALUES\n"
    tail = ";\n"

    part = 0
    rows_in_part = 0
    stmt_rows = []
    stmt_bytes = 0
    out = None

    def open_part():
        nonlocal part, out, rows_in_part
        part += 1
        out = open(os.path.join(args.outdir, f'{part:03d}.sql'), 'w', encoding='utf-8')
        rows_in_part = 0

    def flush_stmt():
        nonlocal stmt_rows, stmt_bytes
        if stmt_rows:
            out.write(head + ',\n'.join(stmt_rows) + tail)
            stmt_rows = []
            stmt_bytes = 0

    open_part()
    total = 0
    for row in cur:
        val = '(' + ','.join(lit(v) for v in row) + ')'
        if stmt_rows and (len(stmt_rows) >= args.rows_per_statement
                          or stmt_bytes + len(val) + 2 > args.max_stmt_bytes):
            flush_stmt()
        stmt_rows.append(val)
        stmt_bytes += len(val) + 2
        rows_in_part += 1
        total += 1
        if rows_in_part >= args.rows_per_part:
            flush_stmt(); out.close(); open_part()
    flush_stmt()
    if out:
        out.close()
    db.close()
    print(f'rows: {total:,} | parts: {part} | ~{args.rows_per_part:,} rows/part, {args.rows_per_statement} rows/stmt')


if __name__ == '__main__':
    main()
