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

COLS = ['ref', 'title', 'dates', 'slug', 'level', 'parent', 'parent_slug', 'has_children', 'fond',
        'description', 'access', 'digital_record']

SCHEMA = """PRAGMA defer_foreign_keys=true;
CREATE TABLE proni (
  ref TEXT NOT NULL,
  title TEXT, dates TEXT, slug TEXT, level TEXT,
  parent TEXT, parent_slug TEXT, has_children INTEGER, fond TEXT,
  description TEXT, access TEXT, digital_record TEXT
);
CREATE UNIQUE INDEX proni_ref ON proni(ref);
CREATE INDEX proni_parent ON proni(parent, ref);
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
    ap.add_argument('--max-stmt-bytes', type=int, default=90000,
                    help='flush a statement before a row would push it past this many bytes '
                         '(D1 caps a single statement at ~100 KB)')
    ap.add_argument('--max-value-chars', type=int, default=85000,
                    help='truncate any string value to this length; only ~113 finding-aid '
                         'descriptions exceed this (max 527 KB) and cannot fit a lone statement')
    ap.add_argument('--upsert', action='store_true',
                    help='emit INSERT..ON CONFLICT DO UPDATE (updates description/access/'
                         'digital_record on existing rows); skips the schema file')
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    if not args.upsert:
        with open(os.path.join(args.outdir, '000-schema.sql'), 'w', encoding='utf-8') as o:
            o.write(SCHEMA)

    # In upsert mode every row already exists, so carry only ref + the columns we
    # actually update — far smaller statements than repeating all 12 columns.
    use_cols = ['ref', 'description', 'access', 'digital_record'] if args.upsert else COLS
    db = sqlite3.connect(args.sqlite)
    cur = db.execute(f"SELECT {','.join(use_cols)} FROM proni")
    if args.upsert:
        head = f"INSERT INTO proni({','.join(use_cols)}) VALUES\n"
        tail = (" ON CONFLICT(ref) DO UPDATE SET description=excluded.description,"
                " access=excluded.access, digital_record=excluded.digital_record;\n")
    else:
        head = f"INSERT OR IGNORE INTO proni({','.join(COLS)}) VALUES\n"
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
    maxv = args.max_value_chars
    for row in cur:
        row = [(v[:maxv] + '…' if isinstance(v, str) and len(v) > maxv else v) for v in row]
        val = '(' + ','.join(lit(v) for v in row) + ')'
        # Flush BEFORE appending so a statement never exceeds the byte cap (a lone
        # oversized row still becomes its own statement, bounded by max-value-chars).
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
    print(f'rows: {total:,} | insert parts: {part} | ~{args.rows_per_part:,} rows/part, {args.rows_per_statement} rows/stmt')

if __name__ == '__main__':
    main()
