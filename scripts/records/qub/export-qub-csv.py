"""Write the whole QUB Library catalogue harvest as one gzipped CSV (the Internet Archive item
civgraph-qub-library-catalogue-csv; owner-approved 27 Nov 2026), with each record's link to its record in QUB's catalogue
(the condition of QUB's metadata reuse policy) and Civgraph's scope label.

    python -E -X utf8 scripts/records/qub/export-qub-csv.py --records <qub-full.sqlite> --labels <labels.sqlite> --out <file.csv.gz>

One row per record, in MMS ID order. Lists inside a cell are joined with " | ". UTF-8, RFC 4180 quoting, CRLF.
Nothing here touches the network.
"""
import argparse, csv, gzip, io, json, sqlite3, sys, time
from urllib.parse import quote

PRIMO = "https://qub.primo.exlibrisgroup.com/discovery/fulldisplay?docid=alma{mms}&context=L&vid=44QSUB_INST%3AQUB&lang=en"

COLUMNS = [
    ("mms_id", "QUB's Alma record id (MMS ID)"),
    ("qub_catalogue_url", "the record in QUB Library's catalogue (Primo)"),
    ("title", "MARC 245 $a$b$f$g$k$n$p$s"),
    ("statement_of_responsibility", "245 $c"),
    ("uniform_title", "130/240"),
    ("variant_titles", "246"),
    ("author", "100/110/111"),
    ("other_names", "700/710/711 (with relator, when given)"),
    ("edition", "250"),
    ("imprint", "264 (second indicator 1) or 260 $a$b$c"),
    ("place_of_publication", "264/260 $a"),
    ("publisher", "264/260 $b"),
    ("date_of_publication", "264/260 $c"),
    ("date1", "008/07-10"),
    ("year", "008 date 1 as a number, when it is one"),
    ("country_of_publication", "008/15-17 (MARC country code)"),
    ("language", "008/35-37 (MARC language code)"),
    ("record_type", "leader/06"),
    ("bibliographic_level", "leader/07"),
    ("extent", "300"),
    ("series", "490/830/440/800/810/811"),
    ("notes", "500 (first six)"),
    ("summary", "520"),
    ("contents", "505"),
    ("subjects", "600/610/611/630/648/650/651/655/653/690/691, subdivisions joined with --"),
    ("geographic_area_codes", "043"),
    ("isbn", "020"),
    ("issn", "022"),
    ("oclc_numbers", "035 (OCoLC)"),
    ("cataloguing_source", "040 $a$c$d"),
    ("lc_class", "050"),
    ("local_class", "090 (QUB's shelf class)"),
    ("dewey_class", "082"),
    ("government_document_number", "086"),
    ("shelf_mark", "090 $a$k or 099"),
    ("holdings", "QUB holdings at harvest time: library / location / call number / availability"),
    ("online_links", "856 $u and Alma electronic portfolios (AVE)"),
    ("civgraph_scope", "Civgraph's label: Within Civgraph scope / Outside of Civgraph scope"),
    ("civgraph_topics", "Civgraph's topic tags A-H (see README)"),
    ("civgraph_scope_reason", "why the record has its label (rules, or a reviewer's note)"),
    ("civgraph_scope_method", "rules / review / rules+review-default"),
]


def joined(v):
    return " | ".join(x for x in (v or []) if x)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--records", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--columns-out", help="also write the column list (name, source) as text")
    a = ap.parse_args()
    src = sqlite3.connect(f"file:{a.records}?mode=ro", uri=True)
    lab = sqlite3.connect(f"file:{a.labels}?mode=ro", uri=True)
    labels = {m: (l, t or "", r or "", meth or "") for m, l, t, r, meth in lab.execute("SELECT mms_id, label, tags, reason, method FROM labels")}
    t0 = time.time()
    n = 0
    with gzip.open(a.out, "wb", compresslevel=9) as gz:
        f = io.TextIOWrapper(gz, encoding="utf-8", newline="")
        w = csv.writer(f, lineterminator="\r\n")
        w.writerow([c for c, _ in COLUMNS])
        q = ("SELECT mms_id, title, author, other_names, imprint, pub_place, publisher, date_imprint, date1, pub_year, country, "
             "language, rec_type, bib_level, shelf_mark, lc090, ddc, gov086, subjects, geo043, series, summary, contents, detail "
             "FROM rec ORDER BY mms_id")
        for (mms, title, author, others, imprint, place, pub, dimp, d1, year, country, lang, rtype, blevel, shelf, lc090,
             ddc, gov086, subjects, geo043, series, summary, contents, detail) in src.execute(q):
            try:
                d = json.loads(detail or "{}")
            except ValueError:
                d = {}
            label, tags, reason, method = labels.get(mms, ("Outside of Civgraph scope", "", "", ""))
            holdings = [" / ".join(x for x in (h.get("library"), h.get("location"), h.get("call"), h.get("availability")) if x)
                        for h in d.get("holdings") or []]
            online = [o.get("url") for o in d.get("online") or [] if o.get("url")]
            other = [(o.get("name") + (f" ({o['role']})" if o.get("role") else "")) for o in d.get("others") or [] if o.get("name")]
            w.writerow([
                mms, PRIMO.format(mms=quote(mms)), title, d.get("resp"), d.get("uniform"), joined(d.get("variant")), author,
                joined(other) or others, d.get("edition"), imprint, place, pub, dimp, d1, year, country, lang, rtype, blevel,
                d.get("extent"), series, joined(d.get("notes")), summary, contents, subjects, geo043, joined(d.get("isbn")),
                joined(d.get("issn")), joined(d.get("oclc")), d.get("catSource"), d.get("lc050"), lc090, ddc, gov086, shelf,
                joined(holdings), joined(online), label, " ".join(tags), reason, method,
            ])
            n += 1
            if n % 200000 == 0:
                print(f"{n} rows {time.time() - t0:.0f}s", flush=True)
        f.flush()
        f.detach()
    if a.columns_out:
        with open(a.columns_out, "w", encoding="utf-8") as c:
            c.write("\n".join(f"{name:<28} {src_}" for name, src_ in COLUMNS) + "\n")
    print(f"done: {n} rows, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
