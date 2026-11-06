#!/usr/bin/env python3
"""Build the Browse "Votes" data (person pages, party cohesion, division records) from the
parliamentary division dataset staged outside the repo.

Input  (--votes-dir, or the CIVGRAPH_VOTES_DIR environment variable; required, the dataset lives outside the repo):
  tidy/divisions.csv, tidy/votes.csv   the division records and member votes
  tidy/stormont/divisions.csv, votes.csv  Stormont (House of Commons of Northern Ireland) 1921-45, split
                             from the OCR of the printed debates; only the exact, confirmed and near
                             divisions are loaded (not the unresolved ones or the second scan copies)
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
_RP = __import__('runpy').run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'records', 'paths.py'))
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
    {"body": "stormont", "title": "Parliamentary Debates (Official Report), House of Commons of Northern Ireland, 1921-45: "
     "division lists read from the OCR of the printed volumes", "url": "", "licence": "Crown copyright expired",
     "licenceUrl": ""},
]
# Statuses (the first word of tidy/stormont/divisions.csv `status`) loaded into Browse. 'unresolved' and
# 'duplicate of ...' (the second HathiTrust scan copy of a division already held) are left out.
STORMONT_LOADED = ("exact", "confirmed", "near")
STORMONT_NOTE = ("Extracted from the OCR of the printed debates (Parliamentary Debates, House of Commons of "
                 "Northern Ireland). Coverage of 1921-45 is partial: only divisions whose lists could be split "
                 "into Ayes and Noes with confidence are held, and 1931 is missing.")
STORMONT_NEAR_NOTE = ("The parsed lists are within one or two names of the printed counts; names whose side "
                      "could not be read are left out.")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def stormont_title(context):
    """The question put, when the OCR gives it cleanly; otherwise None (the caller dates the title)."""
    found = re.findall(r'Question put[,:.]?\s*["\u201c]([^"\u201d]{8,400})["\u201d]', context or "")
    if not found:
        return None
    q = re.sub(r"\s+", " ", found[-1]).strip()
    plain = sum(ch.isalpha() or ch.isspace() for ch in q)
    if len(q) >= 200 or "\ufffd" in q or re.search(r"[^\w\s]{3,}", q) or plain / len(q) < 0.9:
        return None
    return q


def long_date(iso):
    y, m, d = iso.split("-")
    return f"{int(d)} {MONTHS[int(m) - 1]} {y}"


def load_stormont(tidy, divisions, per_div):
    """Add the confidently split Stormont divisions; returns how many were loaded."""
    sdir = os.path.join(tidy, "stormont")
    if not os.path.exists(os.path.join(sdir, "divisions.csv")):
        return 0
    loaded = {}
    for r in csv.DictReader(open(os.path.join(sdir, "divisions.csv"), encoding="utf-8")):
        cls = (r.get("status") or "").strip().split(" ")[0]
        if cls not in STORMONT_LOADED:
            continue
        ayes, noes = int(r["ayes"] or 0), int(r["noes"] or 0)
        question = stormont_title(r.get("context"))
        loaded[r["division_id"]] = {
            "division_id": r["division_id"], "body": "stormont", "date": r["date"], "number": "",
            "title": question or f"Division on {long_date(r['date'])}", "question": question or "",
            "result": "Ayes" if ayes > noes else "Noes" if noes > ayes else "Tie",
            "ayes": str(ayes), "noes": str(noes), "abstain": "",
            "source": f"Parliamentary Debates, House of Commons of Northern Ireland, {r['date'][:4]} (OCR of the printed volume)",
            "source_url": "",
            "note": STORMONT_NOTE + (" " + STORMONT_NEAR_NOTE if cls == "near" else ""),
        }
    for r in csv.DictReader(open(os.path.join(sdir, "votes.csv"), encoding="utf-8")):
        if r["division_id"] in loaded:
            per_div[r["division_id"]].append({"member_name": r["printed_name"], "civgraph_person_id": r["civgraph_person_id"],
                                              "vote": r["vote"], "teller": ""})
    divisions.update(loaded)
    return len(loaded)


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
        for f in sorted(glob.glob(os.path.join(_RP["ELECTION_BUNDLE_DIR"], f"{slug}__*.json"))):
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


def merged_person_ids():
    """{retired personId: surviving personId}. The division data links a member by the id the
    registry gave when it was linked; a later merge (Dehra Chichester 104292 into Dehra Parker
    103875) moves the person to the surviving id. The registry records a merge in mergedFrom only
    on the run that makes it; a later rebuild carries the join and drops the old id silently, so
    the merge logs (person_id_merges.csv) and the hand-confirmed pairs
    (person_id_confirmed_merges.csv) are read too. Only ids no longer in the registry are mapped,
    and chains are followed to a live id."""
    pers = os.path.join(REPO, "data", "elections", "persons")
    path = os.path.join(pers, "person_registry.json")
    if not os.path.exists(path):
        return {}
    entities = json.load(open(path, encoding="utf-8")).get("entities") or []
    live = {int(e["personId"]) for e in entities}
    pairs = {}
    for e in entities:
        for old in e.get("mergedFrom") or []:
            pairs[int(old)] = int(e["personId"])
    for name in ("person_id_merges.csv", "person_id_confirmed_merges.csv"):
        f = os.path.join(pers, name)
        if not os.path.exists(f):
            continue
        for r in csv.DictReader(open(f, encoding="utf-8", newline="")):
            try:
                keep, drop = int(r["keep"]), int(r["drop"])
            except (KeyError, TypeError, ValueError):
                continue
            pairs.setdefault(drop, keep)
    out = {}
    for old in pairs:
        if old in live:
            continue
        target, seen = pairs[old], {old}
        while target not in live and target in pairs and target not in seen:
            seen.add(target)
            target = pairs[target]
        if target in live:
            out[old] = target
    return out


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
    merged = merged_person_ids()
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
    per_div = defaultdict(list)
    for r in csv.DictReader(open(os.path.join(tidy, "votes.csv"), encoding="utf-8")):
        per_div[r["division_id"]].append(r)
    n_stormont = load_stormont(tidy, divisions, per_div)

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
            pid = merged.get(pid, pid)
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
            **({"note": d["note"]} if d.get("note") else {}),
            "parties": {p: dict(c) for p, c in by_party.items()},
            "votes": [[r["member_name"], pid, r["vote"], 1 if r["teller"] else 0, party] for r, pid, party in enriched],
        }

    os.makedirs(os.path.join(a.out, "persons"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "divisions"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "parties"), exist_ok=True)
    # divisions held per body per date, for attendance
    held_dates = defaultdict(list)
    for did, d in divisions.items():
        if d["body"] == "stormont":  # only some divisions are held: an attendance figure would be wrong
            continue
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
    written = set()
    for party, bt in party_stats.items():
        slug = pslug.get(party.strip().lower()) or slugify(party)
        out = []
        for (body, term), st in sorted(bt.items(), key=lambda x: x[0][1], reverse=True):
            st["splits"].sort(key=lambda x: x[1], reverse=True)
            out.append({"body": body, "bodyLabel": BODIES[body]["label"], "term": term, "divisions": st["divisions"],
                        "cohesion": round(st["cohesionSum"] / st["divisions"], 4), "splitCount": len(st["splits"]),
                        "splits": st["splits"][:40]})
        p = os.path.join(a.out, "parties", f"{slug}.json")
        labels = {party}
        # Two labels of one party in this run: merge. Never merge with a file left by an earlier run,
        # which repeated every term on each re-run.
        if slug in written:
            prev = json.load(open(p, encoding="utf-8"))
            out = prev["terms"] + out
            labels |= set(prev.get("labels") or [])
        else:
            n_parties += 1
        written.add(slug)
        json.dump({"schemaVersion": 1, "slug": slug, "labels": sorted(labels), "terms": out},
                  open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    cover = defaultdict(lambda: {"divisions": 0, "first": "9999", "last": "0000"})
    for d in divisions.values():
        c = cover[d["body"]]
        c["divisions"] += 1
        c["first"], c["last"] = min(c["first"], d["date"]), max(c["last"], d["date"])
    json.dump({"schemaVersion": 1, "shards": SHARDS, "bodies": {b: {"label": BODIES[b]["label"], **cover[b]} for b in cover},
               "persons": n_persons, "parties": n_parties, "sources": SOURCES,
               "notes": ["House of Commons divisions hold only the votes of members for Irish (to 1922) and Northern "
                         "Ireland (from 1922) constituencies.",
                         "A vote's party is the party the member was elected for at the latest election of that body.",
                         f"Parliament of Northern Ireland (House of Commons) 1921-45: {n_stormont} divisions. " + STORMONT_NOTE]},
              open(os.path.join(a.out, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("persons", n_persons, "division shards", len(div_shards), "parties", n_parties, "stormont divisions", n_stormont)


if __name__ == "__main__":
    main()
