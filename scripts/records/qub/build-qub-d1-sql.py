"""Write the Independent QUB Catalogue database (build-qub-db.py, records within Civgraph scope) as SQL files that
`wrangler d1 execute <db> --remote --file <file>` loads, in order. For the owner-approved deployment (LANDING.md); this
script only writes local files and touches no network and no Cloudflare resource.

    python -E -X utf8 scripts/records/qub/build-qub-d1-sql.py --db <qub-catalogue.sqlite> --out <folder> [--rows-per-file 4000]

Files:
  0000-schema.sql        the tables and indexes (qub, qub_stats), no FTS yet
  0001-data-NNN.sql ...  INSERTs into qub, a few thousand rows per file, every statement well under D1's 100 KB limit
  0002-stats.sql         qub_stats
  0003-fts.sql           the FTS5 index (external content, as PRONI's) and its rebuild from qub
  load.ps1               the wrangler commands in order (not run)
"""
import argparse, os, sqlite3, sys

SCHEMA = """CREATE TABLE IF NOT EXISTS qub (mms_id TEXT NOT NULL, title TEXT, author TEXT, imprint TEXT, year INTEGER, date_text TEXT,
  format TEXT, language TEXT, shelf TEXT, subjects TEXT, notes TEXT, facets TEXT, scope INTEGER NOT NULL, tags TEXT, scope_reason TEXT,
  scope_method TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS qub_stats (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS qub_mms ON qub(mms_id);
CREATE INDEX IF NOT EXISTS qub_year ON qub(year, mms_id);
CREATE INDEX IF NOT EXISTS qub_title ON qub(title);
"""
FTS = """CREATE VIRTUAL TABLE IF NOT EXISTS qub_fts USING fts5(title, author, subjects, notes, facets, content='qub', content_rowid='rowid',
  prefix='2 3', tokenize='unicode61 remove_diacritics 2');
INSERT INTO qub_fts(qub_fts) VALUES('rebuild');
"""
COLS = ["rowid", "mms_id", "title", "author", "imprint", "year", "date_text", "format", "language", "shelf", "subjects", "notes",
        "facets", "scope", "tags", "scope_reason", "scope_method", "detail"]
MAX_STATEMENT = 90_000  # bytes; D1 refuses a statement over 100 KB


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--rows-per-file", type=int, default=4000)
    ap.add_argument("--database-name", default="qub-catalogue")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    db = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    files = []

    def write(name, text):
        with open(os.path.join(a.out, name), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        files.append(name)

    write("0000-schema.sql", SCHEMA)
    part, rows, n = 1, [], 0
    head = f"INSERT INTO qub ({', '.join(COLS)}) VALUES\n"

    def flush():
        nonlocal part, rows
        if not rows:
            return
        out, stmt, size = [], [], len(head)
        for r in rows:
            if stmt and size + len(r) + 2 > MAX_STATEMENT:
                out.append(head + ",\n".join(stmt) + ";\n")
                stmt, size = [], len(head)
            stmt.append(r)
            size += len(r) + 2
        if stmt:
            out.append(head + ",\n".join(stmt) + ";\n")
        write(f"0001-data-{part:03d}.sql", "".join(out))
        part += 1
        rows = []

    for r in db.execute(f"SELECT {', '.join(COLS)} FROM qub ORDER BY rowid"):
        value = "(" + ", ".join(lit(v) for v in r) + ")"
        if len(head) + len(value) > MAX_STATEMENT:
            raise SystemExit(f"row {r[1]} alone is over the statement limit")
        rows.append(value)
        n += 1
        if len(rows) >= a.rows_per_file:
            flush()
    flush()
    stats = db.execute("SELECT key, n FROM qub_stats ORDER BY key").fetchall()
    write("0002-stats.sql", "".join(f"INSERT OR REPLACE INTO qub_stats (key, n) VALUES ({lit(k)}, {v});\n" for k, v in stats))
    write("0003-fts.sql", FTS)
    load = [f"# Load the Independent QUB Catalogue into D1 database '{a.database_name}' (owner approval first).",
            f"# npx wrangler d1 create {a.database_name}    # then add the [[d1_databases]] binding QUB_DB to wrangler.toml",
            "$ErrorActionPreference = 'Stop'"]
    load += [f"npx wrangler d1 execute {a.database_name} --remote --file \"{name}\"" for name in files]
    load += [f"npx wrangler d1 execute {a.database_name} --remote --command \"SELECT COUNT(*) AS n FROM qub\"   # expect {n}"]
    with open(os.path.join(a.out, "load.ps1"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(load) + "\n")
    size = sum(os.path.getsize(os.path.join(a.out, x)) for x in files)
    print(f"done: {n} rows in {len(files)} files, {size / 1e6:.1f} MB; load order in {os.path.join(a.out, 'load.ps1')}")


if __name__ == "__main__":
    sys.exit(main())
