#!/usr/bin/env python3
"""Re-import the freshly-scraped descriptions (line breaks preserved) into the
canonical proni.sqlite and emit D1 upsert parts.

Streams records-details.jsonl (bounded memory). Updates proni.sqlite.description
for every fetched non-empty description (keeps the canonical source current). For
the D1 push it emits ONLY records whose description contains a line break — those
are exactly the rows whose stored D1 value changed (single-line descriptions are
byte-identical to what's already loaded, so re-pushing them would be wasted work).
Oversized values (> max-value-chars) go to a separate 999-bigdesc.sql of chunked
concat UPDATEs (a single INSERT can't exceed ~100 KB).
"""
import sqlite3, os, argparse, json

def lit(s):
    return "'" + s.replace("'", "''") + "'"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--details', required=True)
    ap.add_argument('--sqlite', required=True)
    ap.add_argument('--outdir', required=True)
    ap.add_argument('--rows-per-statement', type=int, default=100)
    ap.add_argument('--rows-per-part', type=int, default=30000)
    ap.add_argument('--max-stmt-bytes', type=int, default=90000)
    ap.add_argument('--max-value-chars', type=int, default=85000)
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    head = 'INSERT INTO proni(ref,description) VALUES\n'
    tail = ' ON CONFLICT(ref) DO UPDATE SET description=excluded.description;\n'
    maxv = args.max_value_chars

    db = sqlite3.connect(args.sqlite)
    db.execute('PRAGMA journal_mode=WAL')
    batch = []           # pending proni.sqlite UPDATEs
    total = updated = pushed = big = 0
    part = 0
    out = None
    rows_in_part = 0
    stmt = []
    stmt_bytes = 0
    bigf = open(os.path.join(args.outdir, '999-bigdesc.sql'), 'w', encoding='utf-8', newline='')

    def open_part():
        nonlocal part, out, rows_in_part
        part += 1
        out = open(os.path.join(args.outdir, f'{part:03d}.sql'), 'w', encoding='utf-8', newline='')
        rows_in_part = 0

    def flush_stmt():
        nonlocal stmt, stmt_bytes
        if stmt:
            out.write(head + ',\n'.join(stmt) + tail)
            stmt = []
            stmt_bytes = 0

    def flush_batch():
        nonlocal batch, updated
        if batch:
            db.executemany('UPDATE proni SET description=? WHERE ref=?', batch)
            db.commit()
            updated += len(batch)
            batch = []

    open_part()
    with open(args.details, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            ref = r.get('expectedRef') or r.get('proniReference') or r.get('ref')
            d = r.get('description') or ''
            if not ref or not d.strip():
                continue
            total += 1
            batch.append((d, ref))
            if len(batch) >= 5000:
                flush_batch()
            if '\n' in d:                      # only break-bearing rows change in D1
                if len(d) > maxv:
                    chunks = [d[i:i + 40000] for i in range(0, len(d), 40000)]
                    bigf.write(f"UPDATE proni SET description={lit(chunks[0])} WHERE ref={lit(ref)};\n")
                    for c in chunks[1:]:
                        bigf.write(f"UPDATE proni SET description=description||{lit(c)} WHERE ref={lit(ref)};\n")
                    big += 1
                    continue
                val = f'({lit(ref)},{lit(d)})'
                if stmt and (len(stmt) >= args.rows_per_statement or stmt_bytes + len(val) + 2 > args.max_stmt_bytes):
                    flush_stmt()
                stmt.append(val)
                stmt_bytes += len(val) + 2
                rows_in_part += 1
                pushed += 1
                if rows_in_part >= args.rows_per_part:
                    flush_stmt(); out.close(); open_part()
    flush_batch()
    flush_stmt()
    if out:
        out.close()
    bigf.close()
    db.close()
    print(f'fetched non-empty: {total:,} | proni.sqlite updated: {updated:,}')
    print(f'D1 push (line-break rows): normal={pushed:,} in {part} parts | oversized(bigdesc)={big:,}')

if __name__ == '__main__':
    main()
