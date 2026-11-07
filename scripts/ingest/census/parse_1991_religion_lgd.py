#!/usr/bin/env python
"""Parse 1991 Census Religion Report, Table 2 (Religions of the population, by the
26 Local Government Districts) from the OCR'd markdown into a structured CSV.

The table is column-major: 27 area rows (NI + 26 LGDs), then 8 value columns
(Total population, then 7 denominations) of 27 values each = 216 value lines.
We take the COUNT (first token per value line, robust to the noisy OCR percents)
and recompute percentages ourselves, then validate that the 7 denominations sum
to the printed total and that the Roman Catholic column matches the independently
hand-keyed CATH91 dict used in the 1989 backtest.
"""
import re, csv, sys
from pathlib import Path

SRC = Path("data/census/1991/1991-census-religion-report.md")
OUT = Path("data/census/derived/religion-1991-lgd.csv")

# canonical LGD name (fixes OCR) in the exact table order, NI first
AREAS = [
    "NORTHERN IRELAND", "Antrim", "Ards", "Armagh", "Ballymena", "Ballymoney",
    "Banbridge", "Belfast", "Carrickfergus", "Castlereagh", "Coleraine",
    "Cookstown", "Craigavon", "Derry", "Down", "Dungannon", "Fermanagh",
    "Larne", "Limavady", "Lisburn", "Magherafelt", "Moyle", "Newry and Mourne",
    "Newtownabbey", "North Down", "Omagh", "Strabane",
]
DENOMS = ["total_pop", "roman_catholic", "presbyterian", "church_of_ireland",
          "methodist", "other_denom", "none", "not_stated"]

# 1991 Census Religion Report Table 2 Roman Catholic %, from hist/backtest_councils_1989.py
CATH91 = {'antrim':31.7,'ards':11.3,'armagh':45.4,'ballymena':18.3,'ballymoney':30.2,
    'banbridge':27.6,'belfast':39.0,'carrickfergus':6.9,'castlereagh':9.4,'coleraine':22.4,
    'cookstown':53.2,'craigavon':40.1,'derry':69.5,'down':56.0,'dungannon':55.7,'fermanagh':54.9,
    'larne':22.1,'limavady':51.7,'lisburn':26.9,'magherafelt':58.9,'moyle':52.2,
    'newry and mourne':71.8,'newtownabbey':13.0,'north down':9.0,'omagh':64.3,'strabane':61.8}

def to_int(tok):
    return int(re.sub(r"[^\d]", "", tok))  # counts are integers; strip , . ? spaces

def main():
    lines = [l.strip() for l in SRC.read_text().splitlines()]
    # locate Table 2 header, then its Table 3 terminator
    i0 = next(i for i, l in enumerate(lines) if l.startswith("Table 2 Religions of the population"))
    i1 = next(i for i, l in enumerate(lines[i0+1:], i0+1) if l.startswith("Table 3 Religion by age"))
    block = lines[i0:i1]
    # value lines start with a digit (the count, always >=2 digits); this drops
    # stray single-digit page numbers in the OCR block
    vals = [l for l in block if re.match(r"^\d[\d.,]*", l) and len(re.sub(r"[^\d]", "", l.split()[0])) >= 2]
    assert len(vals) == 8 * 27, f"expected 216 value lines, got {len(vals)}"
    cols = {DENOMS[c]: [to_int(vals[c*27 + r].split()[0]) for r in range(27)] for c in range(8)}

    rows = []
    for r, area in enumerate(AREAS):
        rec = {"lgd": area, **{d: cols[d][r] for d in DENOMS}}
        denom_sum = sum(rec[d] for d in DENOMS[1:])
        rec["catholic_pct"] = round(100 * rec["roman_catholic"] / rec["total_pop"], 1)
        rec["denom_sum"] = denom_sum
        rec["sum_vs_total_diff"] = denom_sum - rec["total_pop"]
        rows.append(rec)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    fields = ["lgd"] + DENOMS + ["catholic_pct", "denom_sum", "sum_vs_total_diff"]
    with OUT.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)

    # --- validation ---
    print(f"parsed {len(rows)} areas -> {OUT}")
    ni = rows[0]
    print(f"NI total population: {ni['total_pop']:,} (printed 1,577,836) "
          f"{'OK' if ni['total_pop']==1577836 else 'MISMATCH'}")
    bad = [r for r in rows if abs(r["sum_vs_total_diff"]) > 3]
    print(f"denominations-sum-vs-total: {len(rows)-len(bad)}/{len(rows)} match within 3 "
          + ("" if not bad else "| off: " + ", ".join(f"{r['lgd']}({r['sum_vs_total_diff']:+d})" for r in bad)))
    # cross-check RC% vs the independently-keyed CATH91
    mism = []
    for r in rows[1:]:
        key = r["lgd"].lower()
        if key in CATH91 and abs(r["catholic_pct"] - CATH91[key]) > 0.15:
            mism.append(f"{r['lgd']}: parsed {r['catholic_pct']} vs CATH91 {CATH91[key]}")
    print(f"Roman Catholic %% vs CATH91: {26-len(mism)}/26 match "
          + ("" if not mism else "| " + "; ".join(mism)))

if __name__ == "__main__":
    main()
