"""Build the Independent QUB Catalogue's database (the QUB_DB schema; packages/api/src/queries/qub.js).

    python -E -X utf8 scripts/records/qub/build-qub-db.py --records <qub-full.sqlite> --labels <labels.sqlite> --out <qub-catalogue.sqlite>

Inputs are PRIVATE intake (the QUB harvest parsed by the intake's parse_full.py, and the Civgraph scope labels);
the output is a local SQLite file the local server reads (packages/loader/src/qub-local.mjs). It is D1-compatible
(plain tables, FTS5 with external content) so `wrangler d1 execute --file` of a dump would load it once the owner
approves a D1 database (LANDING/qub-app). Nothing here touches the network.

Tables:
  qub        one row per record: display columns, scope (1 within Civgraph scope / 0 outside), tags ('ABG'),
             the scope reason and method, and the detail JSON the record page reads
  qub_fts    FTS5 over title, author, subjects, notes and facets ('scopein'/'scopeout', 'taga'..'tagh')
  qub_stats  the catalogue figures: all, in, out, tag:A..tag:H (in scope)
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


def fmt(rec_type, bib_level, n_online):
    kind = FORMATS.get(rec_type or "", "")
    if kind == "Text":
        kind = LEVELS.get(bib_level or "", "Text")
    if n_online:
        kind = f"{kind} (online)" if kind else "Online"
    return kind


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--records", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", required=True)
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
    batch = []
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
        d.pop("subjects", None)
        searchable = " | ".join(filter(None, [series, notes, summary, contents, others, d.get("uniform")]))[:6000]
        facets = " ".join(["scopein" if scope else "scopeout"] + [f"tag{t.lower()}" for t in tags])
        try:
            y = int(year) if year is not None else None
        except (TypeError, ValueError):
            y = None
        batch.append((mms, title, author, imprint, y, (date_imp or "").strip(" .") or None, fmt(rtype, blevel, n_online),
                      LANGS.get(lang or "", lang or None), shelf, subjects, searchable or None, facets, scope, tags,
                      reason, method, json.dumps(d, ensure_ascii=False, separators=(",", ":"))))
        stats["all"] += 1
        stats["in" if scope else "out"] += 1
        if scope:
            for t in tags:
                stats[f"tag:{t}"] = stats.get(f"tag:{t}", 0) + 1
        n += 1
        if len(batch) >= 20000:
            out.executemany("INSERT INTO qub VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
            batch = []
            print(f"{n} rows {time.time() - t0:.0f}s", flush=True)
    out.executemany("INSERT INTO qub VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
    out.executemany("INSERT INTO qub_stats VALUES (?, ?)", sorted(stats.items()))
    out.commit()
    print("indexing", flush=True)
    out.executescript(INDEXES)
    out.commit()
    out.close()
    print(f"done: {n} records, {stats['in']} within scope, {time.time() - t0:.0f}s; {os.path.getsize(a.out) / 1e9:.2f} GB")


if __name__ == "__main__":
    sys.exit(main())
