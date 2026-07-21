#!/usr/bin/env python
"""Parse the 1981 NI Census Table 8 (Religions, by the 26 Local Government
Districts) from the OCR'd report markdown into a structured CSV -- the 1981
counterpart of parse_1991_religion_lgd.py.

Table 8 is column-major: 27 area rows (NI + 26 LGDs), then 18 value columns =
6 religion groups (Total population, Roman Catholic, Presbyterian, Church of
Ireland, Methodist, Other-and-not-stated) x 3 (Persons, Males, Females), i.e.
18 * 27 = 486 value lines. We take the Persons column of each group.

1981 CAVEAT: the religion question was voluntary and the census coincided with
the H-Block hunger strikes; non-response was 18.5% and ~19,000 households did not
return at all, concentrated in nationalist areas -- so the 1981 Roman-Catholic
share is an UNDERCOUNT. The 'Other and not stated' column absorbs the non-
response. Validated against printed NI control totals, not treated as a clean
community-background measure.
"""
import re, csv
from pathlib import Path

SRC = Path("data/census/census-1981.md")
OUT = Path("data/census/derived/religion-1981-lgd.csv")
L0, L1 = 37098, 37648  # Table 8 .. Table 8A (0-based slice bounds)

AREAS = [
    "NORTHERN IRELAND", "Antrim", "Ards", "Armagh", "Ballymena", "Ballymoney",
    "Banbridge", "Belfast", "Carrickfergus", "Castlereagh", "Coleraine",
    "Cookstown", "Craigavon", "Down", "Dungannon", "Fermanagh", "Larne",
    "Limavady", "Lisburn", "Londonderry", "Magherafelt", "Moyle",
    "Newry and Mourne", "Newtownabbey", "North Down", "Omagh", "Strabane",
]
# 6 groups x (Persons, Males, Females); we keep each group's Persons column
GROUPS = ["total_pop", "roman_catholic", "presbyterian", "church_of_ireland",
          "methodist", "other_notstated"]

# OCR digit repairs seen in this table: ')'->0, '!'->1, stray punctuation
def to_int(tok):
    t = tok.replace(")", "0").replace("!", "1")
    return int(re.sub(r"[^\d]", "", t))

def main():
    lines = [l.strip() for l in SRC.read_text().splitlines()]
    block = lines[L0:L1]
    vals = [l for l in block if re.match(r"^[\d]", l.replace(" ", ""))
            and len(re.sub(r"[^\d]", "", l)) >= 2]
    assert len(vals) == 18 * 27, f"expected 486 value lines, got {len(vals)}"
    # column c (0..17) row r (0..26): vals[c*27 + r]; Persons columns are 0,3,6,9,12,15
    persons_col = {g: 3 * i for i, g in enumerate(GROUPS)}
    cols = {g: [to_int(vals[persons_col[g] * 27 + r]) for r in range(27)] for g in GROUPS}

    rows = []
    for r, area in enumerate(AREAS):
        rec = {"lgd": area, **{g: cols[g][r] for g in GROUPS}}
        denom_sum = sum(rec[g] for g in GROUPS[1:])
        rec["catholic_pct"] = round(100 * rec["roman_catholic"] / rec["total_pop"], 1)
        rec["denom_sum"] = denom_sum
        rec["sum_vs_total_diff"] = denom_sum - rec["total_pop"]
        rows.append(rec)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    fields = ["lgd"] + GROUPS + ["catholic_pct", "denom_sum", "sum_vs_total_diff"]
    with OUT.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)

    # validation
    ni = rows[0]
    print(f"parsed {len(rows)} areas -> {OUT}")
    print(f"NI total population: {ni['total_pop']:,} (printed 1,481,959) "
          f"{'OK' if ni['total_pop']==1481959 else 'MISMATCH'}")
    print(f"NI Roman Catholic: {ni['roman_catholic']:,} (printed 414,532) "
          f"{'OK' if ni['roman_catholic']==414532 else 'MISMATCH'}  "
          f"= {ni['catholic_pct']}% of usually-resident")
    bad = [r for r in rows if abs(r["sum_vs_total_diff"]) > 3]
    print(f"denominations-sum-vs-total: {len(rows)-len(bad)}/{len(rows)} match within 3"
          + ("" if not bad else " | off: "
             + ", ".join(f"{r['lgd']}({r['sum_vs_total_diff']:+d})" for r in bad)))

if __name__ == "__main__":
    main()
