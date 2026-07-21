#!/usr/bin/env python
"""Fix the 1973 NI local-election 'elected' flags.

The Wikipedia count reconstruction mis-marked the elected set in 8 DEAs: it set
Status='Elected' on the wrong number of candidates (over- or under-counting the
winners), so per-DEA elected counts disagreed with the seat magnitude and the
By-Party seat totals were wrong.

Correct, deterministic rule per DEA: exactly M candidates are elected, being the
top-M by final count total. M = declared Number_Of_Seats, verified against the
Droop quota (self-consistent in 7 of 8). The 8th, Omagh Area C, has a corrupt
countInfo (Number_Of_Seats=4 and Quota=667 both copied from Omagh Area D, and
667 is arithmetically impossible for its 6,208 valid poll); Wikipedia confirms
Omagh Area C returned 7 members, so its magnitude is corrected to 7 (its 7
elected flags were already right).

Edits the SOURCE per-DEA countGroup files so rebuilds stay correct.
"""
import json, glob, os, math
from collections import defaultdict

DIR = "election-viewer-package/data/elections/local-government/1973-05-30"
# target magnitude override where the declared Number_Of_Seats is itself wrong,
# each verified against Wikipedia + the Droop quota:
#   omagh-area-c: declared 4 (Quota 667 copied from Omagh D, impossible for its
#                 6,208 poll); Wikipedia -> 7 seats.
#   fermanagh-area-d: declared 5 but Quota 1212 = floor(6058/5)+1 implies 4;
#                 Wikipedia -> 4 seats.
OVERRIDE = {"omagh-area-c-corrected.json": 7, "fermanagh-area-d.json": 4}

def final_totals(cg):
    last = defaultdict(dict)
    for r in cg:
        last[r["Candidate_Id"]][int(r["Count_Number"])] = float(r["Total_Votes"] or 0)
    return {cid: cnts[max(cnts)] for cid, cnts in last.items()}

def fix_file(path):
    base = os.path.basename(path)
    d = json.load(open(path))
    C = d.get("Constituency")
    if not C:
        return None
    ci, cg = C["countInfo"], C["countGroup"]
    M = OVERRIDE.get(base, int(ci.get("Number_Of_Seats") or 0))
    fin = final_totals(cg)
    elected_now = {r["Candidate_Id"] for r in cg if r.get("Status") == "Elected"}
    if len(elected_now) == M and base not in OVERRIDE:
        return None  # already consistent
    # winners = top-M by final total (ties broken by first-pref then id, deterministic)
    order = sorted(fin, key=lambda c: (-fin[c], c))
    winners = set(order[:M])
    n_counts = max(int(r["Count_Number"]) for r in cg)
    changed = 0
    for r in cg:
        cid = r["Candidate_Id"]; f = fin.get(cid, 0)
        want = "Elected" if cid in winners else ("Not Elected" if f > 0 else "Excluded")
        if r.get("Status") != want:
            r["Status"] = want; changed += 1
        # keep Occurred_On_Count consistent with elected status
        if cid in winners:
            if not r.get("Occurred_On_Count"):
                r["Occurred_On_Count"] = str(n_counts)
        else:
            if r.get("Occurred_On_Count") and f > 0:  # was a spurious election mark
                r["Occurred_On_Count"] = ""
    # repair Omagh Area C corrupt seat/quota metadata
    if base in OVERRIDE:
        vp = float(ci.get("Valid_Poll") or 0)
        ci["Number_Of_Seats"] = str(M)
        ci["Quota"] = str(math.floor(vp / (M + 1)) + 1)
    json.dump(d, open(path, "w"), ensure_ascii=False, indent=2)
    return base, M, len(elected_now), len(winners), changed

def main():
    fixed = []
    for p in sorted(glob.glob(f"{DIR}/*.json")):
        if os.path.basename(p).startswith("_"):
            continue
        r = fix_file(p)
        if r:
            fixed.append(r)
    print(f"fixed {len(fixed)} DEAs:")
    for base, M, was, now, ch in fixed:
        print(f"  {base:32s} M={M}  elected {was}->{now}  ({ch} count-rows restatused)")

if __name__ == "__main__":
    main()
