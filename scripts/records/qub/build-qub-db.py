"""Build the Independent QUB Catalogue's database (the QUB_DB schema; packages/api/src/queries/qub.js).

    python -E -X utf8 scripts/records/qub/build-qub-db.py --records <qub-full.sqlite> --labels <labels.sqlite> --out <qub-catalogue.sqlite> [--all]

By default the database holds only the records within Civgraph's scope (owner, 27 Nov 2026: the live app holds the
in-scope records; the whole catalogue is on the Internet Archive, scripts/records/qub/export-qub-csv.py). --all keeps
every record (out-of-scope ones with their identifying fields only).

Inputs are PRIVATE intake (the QUB harvest parsed by the intake's parse_full.py, and the Civgraph scope labels);
the output is a local SQLite file the local server reads (scripts/dev/qub-server.mjs). It is D1-compatible (plain
tables and an external-content FTS5 index, as PRONI's), and scripts/records/qub/build-qub-d1-sql.py writes it out as
SQL files for `wrangler d1 execute` once the owner approves a D1 database (LANDING.md). Nothing here touches the network.

Tables:
  qub        one row per record: display columns, scope (1 within Civgraph scope / 0 outside), tags ('ABG'),
             the scope reason and method, and the detail JSON the record page reads
  qub_fts    FTS5 with external content (qub) over title, author, subjects, notes (series, notes, summary,
             contents, other names, uniform title) and facets ('scopein'/'scopeout', 'taga'..'tagh')
  qub_stats  the whole catalogue's figures: all, in, out, tag:A..tag:H (in scope), whatever this file holds
"""
import argparse, json, os, sqlite3, sys, time

FORMATS = {"a": "Text", "t": "Manuscript", "e": "Map", "f": "Manuscript map", "c": "Music score", "d": "Manuscript music",
           "g": "Film or video", "i": "Sound recording", "j": "Music recording", "k": "Image", "m": "Computer file",
           "o": "Kit", "p": "Mixed materials", "r": "Object"}
LEVELS = {"m": "Book", "s": "Journal or series", "i": "Updating resource", "c": "Collection", "d": "Part of a collection",
          "a": "Part of a book", "b": "Part of a serial"}
LANGS = {"eng": "English", "gle": "Irish", "fre": "French", "ger": "German", "lat": "Latin", "spa": "Spanish", "ita": "Italian",
         "gla": "Scottish Gaelic", "wel": "Welsh", "dut": "Dutch", "por": "Portuguese", "rus": "Russian", "chi": "Chinese",
         "jpn": "Japanese", "grc": "Ancient Greek", "gre": "Greek", "heb": "Hebrew", "ara": "Arabic", "swe": "Swedish",
         "dan": "Danish", "nor": "Norwegian", "pol": "Polish", "cze": "Czech", "hun": "Hungarian", "fin": "Finnish",
         "mul": "Several languages", "und": "Undetermined", "zxx": "No linguistic content", "sco": "Scots", "ang": "Old English",
         "enm": "Middle English", "sga": "Old Irish", "mga": "Middle Irish"}

SCHEMA = """
CREATE TABLE qub (mms_id TEXT NOT NULL, title TEXT, author TEXT, imprint TEXT, year INTEGER, date_text TEXT, format TEXT,
  language TEXT, shelf TEXT, subjects TEXT, notes TEXT, facets TEXT, scope INTEGER NOT NULL, tags TEXT, scope_reason TEXT,
  scope_method TEXT, detail TEXT);
CREATE TABLE qub_stats (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
"""
INDEXES = """
CREATE UNIQUE INDEX qub_mms ON qub(mms_id);
CREATE INDEX qub_year ON qub(year, mms_id);
CREATE INDEX qub_title ON qub(title);
CREATE VIRTUAL TABLE qub_fts USING fts5(title, author, subjects, notes, facets, content='qub', content_rowid='rowid',
  prefix='2 3', tokenize='unicode61 remove_diacritics 2');
INSERT INTO qub_fts(qub_fts) VALUES('rebuild');
"""
INSERT = ("INSERT INTO qub (rowid, mms_id, title, author, imprint, year, date_text, format, language, shelf, subjects, notes, "
          "facets, scope, tags, scope_reason, scope_method, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")


def fmt(rec_type, bib_level, n_online):
    kind = FORMATS.get(rec_type or "", "")
    if kind == "Text":
        kind = LEVELS.get(bib_level or "", "Text")
    if n_online:
        kind = f"{kind} (online)" if kind else "Online"
    return kind


def cut(v, n):
    return v[:n] + "…" if isinstance(v, str) and len(v) > n else v


OUT_KEEP = ("resp", "uniform", "edition", "extent", "series", "isbn", "issn", "oclc", "catSource", "lc050", "ddc", "gov086", "others", "holdings", "online")


def trim(d, in_scope):
    """The record page's detail, bounded: the full record is a click away in QUB's catalogue. A record outside
    Civgraph's scope keeps only its identifying fields (most of the catalogue: it keeps the database small)."""
    if not in_scope:
        d = {k: v for k, v in d.items() if k in OUT_KEEP}
        d["series"] = (d.get("series") or [])[:2]
        d["others"] = (d.get("others") or [])[:4]
        d["holdings"] = (d.get("holdings") or [])[:2]
        d["online"] = (d.get("online") or [])[:1]
    d.pop("subjects", None)
    d.pop("date2", None)
    d.pop("dateType", None)
    for k in ("contents", "summary"):
        d[k] = cut(d.get(k), 1500)
    d["notes"] = [cut(n, 400) for n in (d.get("notes") or [])[:4]]
    d["others"] = (d.get("others") or [])[:12]
    d["holdings"] = (d.get("holdings") or [])[:6]
    d["online"] = [{"label": cut(o.get("label"), 80), "url": o.get("url")} for o in (d.get("online") or [])[:3] if o.get("url")]
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--records", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--all", action="store_true", help="keep every record, not only those within scope")
    a = ap.parse_args()
    if os.path.exists(a.out):
        os.remove(a.out)
    out = sqlite3.connect(a.out)
    out.execute("PRAGMA journal_mode=OFF")
    out.execute("PRAGMA synchronous=OFF")
    out.executescript(SCHEMA)
    src = sqlite3.connect(f"file:{a.records}?mode=ro", uri=True)
    lab = sqlite3.connect(f"file:{a.labels}?mode=ro", uri=True)
    labels = {m: (l, t or "", r or "", meth or "") for m, l, t, r, meth in lab.execute("SELECT mms_id, label, tags, reason, method FROM labels")}
    t0 = time.time()
    n = 0
    rows = []
    stats = {"all": 0, "in": 0, "out": 0}
    q = ("SELECT mms_id, title, author, imprint, pub_year, date_imprint, rec_type, bib_level, language, shelf_mark, subjects, "
         "series, notes, summary, contents, other_names, n_online, detail FROM rec ORDER BY mms_id")
    for (mms, title, author, imprint, year, date_imp, rtype, blevel, lang, shelf, subjects, series, notes, summary, contents,
         others, n_online, detail) in src.execute(q):
        label, tags, reason, method = labels.get(mms, ("Outside of Civgraph scope", "", "not labelled", "none"))
        scope = 1 if label == "Within Civgraph scope" else 0
        try:
            d = json.loads(detail or "{}")
        except ValueError:
            d = {}
        searchable = (" | ".join(filter(None, [series, notes, summary, contents, others, d.get("uniform")]))[:4000] if scope
                      else " | ".join(filter(None, [series, others, d.get("uniform")]))[:600])
        facets = " ".join(["scopein" if scope else "scopeout"] + [f"tag{t.lower()}" for t in tags])
        try:
            y = int(year) if year is not None else None
        except (TypeError, ValueError):
            y = None
        stats["all"] += 1
        stats["in" if scope else "out"] += 1
        if scope:
            for t in tags:
                stats[f"tag:{t}"] = stats.get(f"tag:{t}", 0) + 1
        if not scope and not a.all:
            continue
        n += 1
        rows.append((n, mms, title, author, imprint, y, (date_imp or "").strip(" .") or None, fmt(rtype, blevel, n_online),
                     LANGS.get(lang or "", lang or None), shelf, subjects, searchable or None, facets, scope, tags,
                     cut(reason, 300), method, json.dumps(trim(d, scope), ensure_ascii=False, separators=(",", ":"))))
        if len(rows) >= 20000:
            out.executemany(INSERT, rows)
            rows = []
    out.executemany(INSERT, rows)
    out.executemany("INSERT INTO qub_stats VALUES (?, ?)", sorted(stats.items()))
    out.commit()
    print("indexing", flush=True)
    out.executescript(INDEXES)
    out.commit()
    out.close()
    print(f"done: {n} records, {stats['in']} within scope, {time.time() - t0:.0f}s; {os.path.getsize(a.out) / 1e9:.2f} GB")


if __name__ == "__main__":
    sys.exit(main())
