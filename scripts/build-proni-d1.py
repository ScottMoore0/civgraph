#!/usr/bin/env python3
"""Build the PRONI search database for Cloudflare D1 (Option B).

Reads the combined detail JSONL (leaves + enriched containers) and emits:
  proni.sqlite        -- local SQLite with an FTS5 table (for local testing / wrangler local D1)
  proni-d1.sql        -- schema + batched INSERTs for `wrangler d1 import` (remote D1)

Single FTS5 table `proni`:
  searchable : ref, title, dates
  UNINDEXED  : slug, level, parent, parent_slug, has_children, fond
This keeps D1 import and querying simple (no joins, triggers, or rebuild step).
"""
import sys, os, json, argparse, sqlite3, gzip

def slugify(ref): return ref.replace('/', '~')

DDL = """CREATE TABLE proni (
  ref TEXT NOT NULL,
  title TEXT, dates TEXT, slug TEXT, level TEXT,
  parent TEXT, parent_slug TEXT, has_children INTEGER, fond TEXT
);
CREATE UNIQUE INDEX proni_ref ON proni(ref);
CREATE VIRTUAL TABLE proni_fts USING fts5(
  ref, title, dates,
  content='proni', content_rowid='rowid',
  prefix='2 3', tokenize='unicode61 remove_diacritics 2'
);"""

FTS_REBUILD = "INSERT INTO proni_fts(proni_fts) VALUES('rebuild');"

COLS = ['ref', 'title', 'dates', 'slug', 'level', 'parent', 'parent_slug', 'has_children', 'fond']

def stream(src):
    with open(src, encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue

def row_for(d, containers):
    ref = d.get('proniReference') or d.get('expectedRef') or ''
    if not ref:
        return None
    p = d.get('path') or []
    parent = p[-1] if p else ''
    fond = p[0] if p else ref.split('/')[0]
    return {
        'ref': ref,
        'title': d.get('title') or ref,
        'dates': d.get('dates') or '',
        'slug': slugify(ref),
        'level': d.get('level') or '',
        'parent': parent,
        'parent_slug': slugify(parent) if parent else '',
        'has_children': 1 if ref in containers else 0,
        'fond': fond,
    }

def sql_lit(v):
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--sqlite', required=True)
    ap.add_argument('--sql', required=True, help='D1 import SQL (gzipped if ends .gz)')
    ap.add_argument('--batch', type=int, default=500)
    args = ap.parse_args()

    # Pass 1: collect the set of container refs (every path ancestor). Small (~115k).
    containers = set()
    n = 0
    for d in stream(args.src):
        for a in (d.get('path') or []):
            containers.add(a)
        n += 1
    print(f'pass1: {n:,} records streamed, {len(containers):,} container refs')

    # Pass 2: build SQLite + emit D1 SQL.
    if os.path.exists(args.sqlite):
        os.remove(args.sqlite)
    db = sqlite3.connect(args.sqlite)
    db.execute('PRAGMA journal_mode=OFF')
    db.execute('PRAGMA synchronous=OFF')
    db.executescript(DDL)
    ins = f"INSERT INTO proni({','.join(COLS)}) VALUES ({','.join('?'*len(COLS))})"

    opener = gzip.open if args.sql.endswith('.gz') else open
    sqlf = opener(args.sql, 'wt', encoding='utf-8')
    sqlf.write('PRAGMA defer_foreign_keys=true;\n')
    sqlf.write(DDL + '\n')

    batch = []
    seen = set()
    dups = 0
    inserted = 0
    values_buf = []

    def flush_sql():
        if values_buf:
            sqlf.write(f"INSERT INTO proni({','.join(COLS)}) VALUES\n")
            sqlf.write(',\n'.join(values_buf))
            sqlf.write(';\n')
            values_buf.clear()

    for d in stream(args.src):
        r = row_for(d, containers)
        if not r:
            continue
        if r['ref'] in seen:
            dups += 1
            continue
        seen.add(r['ref'])
        vals = [r[c] for c in COLS]
        batch.append(vals)
        values_buf.append('(' + ','.join(sql_lit(v) for v in vals) + ')')
        inserted += 1
        if len(batch) >= args.batch:
            db.executemany(ins, batch); batch.clear()
        if len(values_buf) >= args.batch:
            flush_sql()
    if batch:
        db.executemany(ins, batch)
    flush_sql()
    # Build the FTS index from the base table (external-content pattern).
    db.execute(FTS_REBUILD)
    db.commit()
    sqlf.write(FTS_REBUILD + '\n')
    sqlf.close()

    cnt = db.execute('SELECT count(*) FROM proni').fetchone()[0]
    db.close()
    sz = os.path.getsize(args.sqlite) / 1048576
    sqlsz = os.path.getsize(args.sql) / 1048576
    print(f'pass2: inserted {inserted:,} rows ({dups:,} dup refs skipped); table count {cnt:,}')
    print(f'  {args.sqlite}  ({sz:.0f} MB)')
    print(f'  {args.sql}  ({sqlsz:.0f} MB)')

if __name__ == '__main__':
    main()
