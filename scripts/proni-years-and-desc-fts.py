#!/usr/bin/env python3
"""Upgrade the PRONI search DB for the Civgraph PRONI Search app:
  - add start_year/end_year (parsed from the free-text `dates`) for date-range filtering
  - rebuild the FTS index to also cover `description` (was ref/title/dates only)

Operates on the local proni.sqlite. Emits the equivalent D1 steps as SQL:
  - proni-years.parts/*.sql  : chunked UPSERTs for the year columns (retry-safe)
  - proni-fts-desc.sql        : DROP+CREATE proni_fts (incl. description) + trigger
The FTS is repopulated on D1 with chunked INSERT..SELECT over rowid ranges
(driven separately) to avoid a single huge rebuild statement.
"""
import sqlite3, re, os, argparse

YEAR_RE = re.compile(r'\b(1[5-9]\d{2}|20\d{2})\b')

def years(dates):
    ys = [int(y) for y in YEAR_RE.findall(dates or '')]
    if not ys:
        return None, None
    return min(ys), max(ys)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sqlite', required=True)
    ap.add_argument('--outdir', required=True)  # for D1 SQL artifacts
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    db = sqlite3.connect(args.sqlite)
    db.execute('PRAGMA journal_mode=OFF')
    cols = {r[1] for r in db.execute('PRAGMA table_info(proni)')}
    if 'start_year' not in cols:
        db.execute('ALTER TABLE proni ADD COLUMN start_year INTEGER')
    if 'end_year' not in cols:
        db.execute('ALTER TABLE proni ADD COLUMN end_year INTEGER')

    # populate years locally
    rows = db.execute('SELECT rowid, dates FROM proni').fetchall()
    upd = []
    for rid, dates in rows:
        s, e = years(dates)
        if s is not None:
            upd.append((s, e, rid))
    db.executemany('UPDATE proni SET start_year=?, end_year=? WHERE rowid=?', upd)
    db.commit()
    print(f'years: parsed {len(upd):,} of {len(rows):,} records')

    # rebuild FTS to include description
    db.executescript("""
      DROP TRIGGER IF EXISTS proni_ai;
      DROP TABLE IF EXISTS proni_fts;
      CREATE VIRTUAL TABLE proni_fts USING fts5(
        ref, title, dates, description,
        content='proni', content_rowid='rowid',
        prefix='2 3', tokenize='unicode61 remove_diacritics 2'
      );
      INSERT INTO proni_fts(proni_fts) VALUES('rebuild');
      CREATE TRIGGER proni_ai AFTER INSERT ON proni BEGIN
        INSERT INTO proni_fts(rowid, ref, title, dates, description)
        VALUES (new.rowid, new.ref, new.title, new.dates, new.description);
      END;
    """)
    db.commit()
    n = db.execute('SELECT count(*) FROM proni_fts').fetchone()[0]
    print(f'FTS rebuilt with description: {n:,} rows')

    # --- D1 artifacts ---
    # 1) year upsert parts (ref + start/end year), retry-safe, byte-bounded
    def lit(v):
        return 'NULL' if v is None else (str(v) if isinstance(v, int) else "'" + str(v).replace("'", "''") + "'")
    cur = db.execute('SELECT ref, start_year, end_year FROM proni WHERE start_year IS NOT NULL')
    part = 0; rows_in = 0; out = None; stmt = []
    HEAD = 'INSERT INTO proni(ref,start_year,end_year) VALUES\n'
    TAIL = ' ON CONFLICT(ref) DO UPDATE SET start_year=excluded.start_year, end_year=excluded.end_year;\n'
    def flush():
        nonlocal stmt
        if stmt:
            out.write(HEAD + ',\n'.join(stmt) + TAIL); stmt = []
    def open_part():
        nonlocal part, out, rows_in
        part += 1; rows_in = 0
        out = open(os.path.join(args.outdir, f'years-{part:03d}.sql'), 'w', encoding='utf-8')
    open_part()
    total = 0
    for ref, s, e in cur:
        stmt.append(f'({lit(ref)},{lit(s)},{lit(e)})')
        rows_in += 1; total += 1
        if len(stmt) >= 200:
            flush()
        if rows_in >= 80000:
            flush(); out.close(); open_part()
    flush()
    if out: out.close()
    print(f'year upsert parts: {part} ({total:,} rows) -> {args.outdir}/years-*.sql')

    # 2) FTS schema swap (DROP+CREATE incl description + trigger); populate done via INSERT..SELECT ranges
    with open(os.path.join(args.outdir, 'fts-desc-schema.sql'), 'w', encoding='utf-8') as f:
        f.write(
            "DROP TRIGGER IF EXISTS proni_ai;\n"
            "DROP TABLE IF EXISTS proni_fts;\n"
            "CREATE VIRTUAL TABLE proni_fts USING fts5(ref, title, dates, description, "
            "content='proni', content_rowid='rowid', prefix='2 3', tokenize='unicode61 remove_diacritics 2');\n"
            "CREATE TRIGGER proni_ai AFTER INSERT ON proni BEGIN "
            "INSERT INTO proni_fts(rowid, ref, title, dates, description) "
            "VALUES (new.rowid, new.ref, new.title, new.dates, new.description); END;\n"
        )
    maxrow = db.execute('SELECT max(rowid) FROM proni').fetchone()[0]
    print(f'max rowid: {maxrow}')
    with open(os.path.join(args.outdir, 'fts-populate-ranges.txt'), 'w', encoding='utf-8') as f:
        step = 20000
        for lo in range(1, maxrow + 1, step):
            hi = lo + step - 1
            f.write(f"INSERT INTO proni_fts(rowid,ref,title,dates,description) SELECT rowid,ref,title,dates,description FROM proni WHERE rowid BETWEEN {lo} AND {hi};\n")
    print('wrote fts-desc-schema.sql + fts-populate-ranges.txt')
    db.close()

if __name__ == '__main__':
    main()
