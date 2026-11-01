#!/usr/bin/env python3
"""Build the Browse "Votes" data (person pages, party cohesion, division records) from the
parliamentary division dataset staged outside the repo.

Input  (--votes-dir, or the CIVGRAPH_VOTES_DIR environment variable; required, the dataset lives outside the repo):
  tidy/divisions.csv, tidy/votes.csv   the division records and member votes
Output (--out, default data/browse/votes, gitignored like the rest of data/browse):
  index.json                 bodies, coverage, counts, sources and licences, shard count
  persons/<personId>.json    one file per Civgraph person with votes: per-term summary and every division
  divisions/<nnn>.json       division records, sharded by a hash of the division id
  parties/<slug>.json        per party, body and term: cohesion and the divisions where it split

A vote's party is the party the person was elected for at the most recent election of that body
on or before the division (Civgraph's own election records), so it matches the party pages.

    python scripts/build_browse_votes.py --votes-dir DIR [--out DIR]   (or set CIVGRAPH_VOTES_DIR)
"""
import argparse
import csv
import glob
import hashlib
import html
import json
import os
import re
import sys
import unicodedata
from bisect import bisect_right
from collections import Counter, defaultdict

csv.field_size_limit(10 ** 8)
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARDS = 256

BODIES = {
    "dail": {"label": "Dáil Éireann", "elections": "dail-eireann"},
    "seanad": {"label": "Seanad Éireann", "elections": None},
    "commons": {"label": "House of Commons", "elections": "house-of-commons-of-the-united-kingdom"},
    "niassembly": {"label": "Northern Ireland Assembly", "elections": "northern-ireland-assembly"},
    "stormont": {"label": "Parliament of Northern Ireland (House of Commons)", "elections": "parliament-of-northern-ireland"},
}
SOURCES = [
    {"body": "dail", "title": "Houses of the Oireachtas Open Data: divisions", "url": "https://api.oireachtas.ie/",
     "licence": "Oireachtas (Open Data) PSI Licence", "licenceUrl": "https://www.oireachtas.ie/en/open-data/license/"},
    {"body": "seanad", "title": "Houses of the Oireachtas Open Data: divisions", "url": "https://api.oireachtas.ie/",
     "licence": "Oireachtas (Open Data) PSI Licence", "licenceUrl": "https://www.oireachtas.ie/en/open-data/license/"},
    {"body": "commons", "title": "UK Parliament Commons Votes API, Linked Data API and the Hansard archive",
     "url": "https://votes.parliament.uk/", "licence": "Open Parliament Licence v3.0",
     "licenceUrl": "https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/"},
    {"body": "niassembly", "title": "Northern Ireland Assembly Open Data: divisions", "url": "https://data.niassembly.gov.uk/",
     "licence": "Open Government Licence v3.0", "licenceUrl": "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"},
]


def slugify(v):
    s = unicodedata.normalize("NFKD", str(v or "")).encode("ascii", "ignore").decode().lower().replace("&", " and ")
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s)) or "entry"


def shard_of(division_id):
    return int(hashlib.sha1(division_id.encode("utf-8")).hexdigest()[:6], 16) % SHARDS


def party_slugs():
    """party label (as in the election records) -> party page slug"""
    p = os.path.join(REPO, "data", "browse", "parties.json")
    out = {}
    if not os.path.exists(p):
        return out
    for it in json.load(open(p, encoding="utf-8")).get("items", []):
        for label in [it.get("title"), it.get("shortName")] + list(it.get("knownAliases") or []):
            if label:
                out.setdefault(label.strip().lower(), it["slug"])
    return out


def elected_terms():
    """body -> personId -> sorted [(date, party, constituency)]; body -> sorted general election dates"""
    terms, generals = defaultdict(lambda: defaultdict(list)), defaultdict(list)
    for code, b in BODIES.items():
        slug = b["elections"]
        if not slug:
            continue
        for f in sorted(glob.glob(os.path.join(REPO, "render", "metadata", "elections-test2", f"{slug}__*.json"))):
            d = json.load(open(f, encoding="utf-8"))
            if not d.get("isByElection"):
                generals[code].append(d["date"])
            for r in d.get("results") or []:
                for c in r.get("candidates") or []:
                    if (c.get("elected") or c.get("autoReturnedCeannComhairle")) and c.get("personId") is not None:
                        terms[code][int(c["personId"])].append((d["date"], c.get("party") or "", r.get("constituency") or ""))
    for code in terms:
        for pid in terms[code]:
            terms[code][pid].sort()
    for code in generals:
        generals[code].sort()
    return terms, generals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--votes-dir", default=os.environ.get("CIVGRAPH_VOTES_DIR"),
                    help="folder holding tidy/divisions.csv and tidy/votes.csv (default: $CIVGRAPH_VOTES_DIR)")
    ap.add_argument("--out", default=os.path.join(REPO, "data", "browse", "votes"))
    a = ap.parse_args()
    if not a.votes_dir:
        ap.error("give --votes-dir or set CIVGRAPH_VOTES_DIR")
    tidy = os.path.join(a.votes_dir, "tidy")
    terms, generals = elected_terms()
    pslug = party_slugs()

    def party_at(body, pid, date):
        lst = terms.get(body, {}).get(pid)
        if not lst:
            return ""
        k = bisect_right([x[0] for x in lst], date) - 1
        return lst[k][1] if k >= 0 else ""

    def term_of(body, date):
        g = generals.get(body)
        if not g:
            return date[:4]
        k = bisect_right(g, date) - 1
        return g[k] if k >= 0 else "before " + g[0]

    divisions = {}
    for r in csv.DictReader(open(os.path.join(tidy, "divisions.csv"), encoding="utf-8")):
        r["title"], r["question"] = html.unescape(r["title"] or ""), html.unescape(r["question"] or "")
        divisions[r["division_id"]] = r
    # Stormont 1921-45 (tidy/stormont) is left out until the owner has checked it.

    per_div = defaultdict(list)
    for r in csv.DictReader(open(os.path.join(tidy, "votes.csv"), encoding="utf-8")):
        per_div[r["division_id"]].append(r)

    # party majority per division
    person_rows = defaultdict(list)
    party_stats = defaultdict(lambda: defaultdict(lambda: {"divisions": 0, "cohesionSum": 0.0, "splits": []}))
    div_shards = defaultdict(dict)
    for did, rows in per_div.items():
        d = divisions.get(did)
        if not d:
            continue
        body, date = d["body"], d["date"]
        by_party = defaultdict(Counter)
        enriched = []
        for r in rows:
            pid = int(r["civgraph_person_id"]) if r["civgraph_person_id"] else None
            party = party_at(body, pid, date) if pid else ""
            if party:
                by_party[party][r["vote"]] += 1
            enriched.append((r, pid, party))
        majority = {}
        for party, c in by_party.items():
            (top, n1), *rest = c.most_common(2) + [(None, 0)]
            n2 = rest[0][1] if rest else 0
            majority[party] = top if n1 > n2 else "split"
            total = sum(c.values())
            if total >= 2:
                st = party_stats[party][(body, term_of(body, date))]
                st["divisions"] += 1
                st["cohesionSum"] += n1 / total
                if n1 / total < 0.8:
                    st["splits"].append([did, date, d["title"][:140], dict(c)])
        title = d["title"] or d["question"]
        for r, pid, party in enriched:
            if pid:
                mj = majority.get(party, "")
                person_rows[pid].append([did, date, body, title[:160], r["vote"], 1 if r["teller"] else 0,
                                         d["result"], party, mj])
        div_shards[shard_of(did)][did] = {
            "body": body, "date": date, "number": d["number"], "title": d["title"], "question": d["question"],
            "result": d["result"], "ayes": d["ayes"], "noes": d["noes"], "abstain": d["abstain"],
            "source": d["source"], "sourceUrl": d["source_url"],
            "partial": body == "commons",  # Commons: only the votes of Irish / NI members are held
            "parties": {p: dict(c) for p, c in by_party.items()},
            "votes": [[r["member_name"], pid, r["vote"], 1 if r["teller"] else 0, party] for r, pid, party in enriched],
        }

    os.makedirs(os.path.join(a.out, "persons"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "divisions"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "parties"), exist_ok=True)
    # divisions held per body per date, for attendance
    held_dates = defaultdict(list)
    for did, d in divisions.items():
        if d["body"] != "commons" or d["source"] != "Hansard archive XML (Open Parliament Licence)":
            held_dates[d["body"]].append(d["date"])
    for b in held_dates:
        held_dates[b].sort()

    n_persons = 0
    for pid, rows in person_rows.items():
        rows.sort(key=lambda x: (x[1], x[0]), reverse=True)
        summary = defaultdict(lambda: {"voted": 0, "aye": 0, "no": 0, "abstain": 0, "againstParty": 0,
                                       "first": "9999", "last": "0000"})
        for did, date, body, title, vote, tell, result, party, mj in rows:
            s = summary[(body, term_of(body, date))]
            s["voted"] += 1
            if vote in ("aye", "no", "abstain"):
                s[vote] += 1
            if mj in ("aye", "no") and vote in ("aye", "no") and vote != mj:
                s["againstParty"] += 1
            s["first"], s["last"] = min(s["first"], date), max(s["last"], date)
        terms_out = []
        for (body, term), s in sorted(summary.items(), key=lambda x: x[0][1], reverse=True):
            hd = held_dates.get(body, [])
            held = bisect_right(hd, s["last"]) - bisect_right(hd, s["first"]) + (1 if s["first"] in hd else 0) if hd else None
            terms_out.append({"body": body, "bodyLabel": BODIES[body]["label"], "term": term, **s,
                              "heldInPeriod": held})
        titles, tindex, compact = [], {}, []
        for did, date, body, title, vote, tell, result, party, mj in rows:
            if title not in tindex:
                tindex[title] = len(titles)
                titles.append(title)
            compact.append([did, date, body, tindex[title], vote, tell, result, mj])
        json.dump({"schemaVersion": 1, "personId": pid, "terms": terms_out, "titles": titles,
                   "columns": ["divisionId", "date", "body", "titleIndex", "vote", "teller", "result", "partyMajority"],
                   "divisions": compact},
                  open(os.path.join(a.out, "persons", f"{pid}.json"), "w", encoding="utf-8"), ensure_ascii=False,
                  separators=(",", ":"))
        n_persons += 1
    for k, recs in div_shards.items():
        json.dump({"schemaVersion": 1, "shard": k, "divisions": recs},
                  open(os.path.join(a.out, "divisions", f"{k:03d}.json"), "w", encoding="utf-8"), ensure_ascii=False,
                  separators=(",", ":"))
    n_parties = 0
    for party, bt in party_stats.items():
        slug = pslug.get(party.strip().lower()) or slugify(party)
        out = []
        for (body, term), st in sorted(bt.items(), key=lambda x: x[0][1], reverse=True):
            st["splits"].sort(key=lambda x: x[1], reverse=True)
            out.append({"body": body, "bodyLabel": BODIES[body]["label"], "term": term, "divisions": st["divisions"],
                        "cohesion": round(st["cohesionSum"] / st["divisions"], 4), "splitCount": len(st["splits"]),
                        "splits": st["splits"][:40]})
        p = os.path.join(a.out, "parties", f"{slug}.json")
        if os.path.exists(p):  # two labels of one party: merge
            prev = json.load(open(p, encoding="utf-8"))
            out = prev["terms"] + out
        json.dump({"schemaVersion": 1, "slug": slug, "labels": sorted({party}), "terms": out},
                  open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        n_parties += 1
    cover = defaultdict(lambda: {"divisions": 0, "first": "9999", "last": "0000"})
    for d in divisions.values():
        c = cover[d["body"]]
        c["divisions"] += 1
        c["first"], c["last"] = min(c["first"], d["date"]), max(c["last"], d["date"])
    json.dump({"schemaVersion": 1, "shards": SHARDS, "bodies": {b: {"label": BODIES[b]["label"], **cover[b]} for b in cover},
               "persons": n_persons, "parties": n_parties, "sources": SOURCES,
               "notes": ["House of Commons divisions hold only the votes of members for Irish (to 1922) and Northern "
                         "Ireland (from 1922) constituencies.",
                         "A vote's party is the party the member was elected for at the latest election of that body."]},
              open(os.path.join(a.out, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("persons", n_persons, "division shards", len(div_shards), "parties", n_parties)


if __name__ == "__main__":
    main()
