#!/usr/bin/env python3
"""Emit D1-import parts from the built proni.sqlite.

D1 constraints learned the hard way:
  - a single SQL statement must stay under ~100 KB  -> few rows per INSERT
  - a single `d1 execute --file` must finish in the server window -> moderate
    file size per part, and NO one-shot FTS rebuild (a trigger builds the index
    incrementally instead)

Output: <outdir>/000-schema.sql (table + FTS + AFTER INSERT trigger) then
numbered insert parts, each INSERT OR IGNORE (retry-safe).
"""
import sqlite3, os, argparse

COLS = ['ref', 'title', 'dates', 'slug', 'level', 'parent', 'parent_slug', 'has_children', 'fond']

SCHEMA = """PRAGMA defer_foreign_keys=true;
CREATE TABLE proni (
  ref TEXT NOT NULL,
  title TEXT, dates TEXT, slug TEXT, level TEXT,
  parent TEXT, parent_slug TEXT, has_children INTEGER, fond TEXT
);
CREATE UNIQUE INDEX proni_ref ON proni(ref);
CREATE VIRTUAL TABLE proni_fts USING fts5(
  ref, title, dates,
  content='proni', content_rowid='rowid',
  prefix='2 3', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER proni_ai AFTER INSERT ON proni BEGIN
  INSERT INTO proni_fts(rowid, ref, title, dates) VALUES (new.rowid, new.ref, new.title, new.dates);
END;
"""

def lit(v):
    if v is None:
        return "''"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sqlite', required=True)
    ap.add_argument('--outdir', required=True)
    ap.add_argument('--rows-per-statement', type=int, default=100)
    ap.add_argument('--rows-per-part', type=int, default=60000)
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    with open(os.path.join(args.outdir, '000-schema.sql'), 'w', encoding='utf-8') as o:
        o.write(SCHEMA)

    db = sqlite3.connect(args.sqlite)
    cur = db.execute(f"SELECT {','.join(COLS)} FROM proni")
    head = f"INSERT OR IGNORE INTO proni({','.join(COLS)}) VALUES\n"

    part = 0
    rows_in_part = 0
    stmt_rows = []
    out = None

    def open_part():
        nonlocal part, out, rows_in_part
        part += 1
        out = open(os.path.join(args.outdir, f'{part:03d}.sql'), 'w', encoding='utf-8')
        rows_in_part = 0

    def flush_stmt():
        nonlocal stmt_rows
        if stmt_rows:
            out.write(head + ',\n'.join(stmt_rows) + ';\n')
            stmt_rows = []

    open_part()
    total = 0
    for row in cur:
        stmt_rows.append('(' + ','.join(lit(v) for v in row) + ')')
        rows_in_part += 1
        total += 1
        if len(stmt_rows) >= args.rows_per_statement:
            flush_stmt()
        if rows_in_part >= args.rows_per_part:
            flush_stmt(); out.close(); open_part()
    flush_stmt()
    if out:
        out.close()
    db.close()
    print(f'rows: {total:,} | insert parts: {part} | ~{args.rows_per_part:,} rows/part, {args.rows_per_statement} rows/stmt')

if __name__ == '__main__':
    main()
