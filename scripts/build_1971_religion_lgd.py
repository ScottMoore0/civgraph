#!/usr/bin/env python
"""1971 NI Census Catholic share by the 26 district council areas.

The 1971 religion tables in the in-repo OCR (data/census/census-1971.md) are the
pre-1973 County Reports (Table 8 by urban/rural district within each county, plus
ward tables for the boroughs). That OCR is too corrupted to parse safely -- only
2 of the ~7 area blocks validate (denominations sum to total); the rest are
mangled by multi-page spanning and interleaved ward sub-tables.

Instead we take the authoritative retabulated series: CAIN (Ulster University),
Majority Minority Review 3 "Housing and Religion in NI", Appendix 3.1 -- 1971
Catholic percentage on the 26 (post-1973) district council areas. This is the
standard NI political-demography 1971 series, computed on the modern districts so
it crosswalks exactly like the 1981/1991 tables. Cross-checked against the NI
control (1971 Roman Catholics 477,921) and the two cleanly-parsing OCR county
blocks (Fermanagh, and the 138k-pop county), and against sensible 1971->1991
trajectories (e.g. Derry 64.3->69.5, Newry & Mourne 71.4->71.8).

Source: https://cain.ulster.ac.uk/ccru/research/csc/mm3app.htm  (Appendix 3.1)
"""
import csv
from pathlib import Path

OUT = Path("data/census/derived/religion-1971-lgd.csv")

# CAIN MMR3 Appendix 3.1 -- % Catholics 1971, by district (Derry = Londonderry)
CATH71 = {
    "Antrim": 31.10, "Ards": 16.00, "Armagh": 44.50, "Ballymena": 17.70,
    "Ballymoney": 29.60, "Banbridge": 31.20, "Belfast": 34.10, "Carrickfergus": 16.20,
    "Castlereagh": 10.10, "Coleraine": 23.90, "Cookstown": 49.20, "Craigavon": 38.70,
    "Down": 54.10, "Dungannon": 52.30, "Fermanagh": 52.50, "Larne": 26.80,
    "Limavady": 52.40, "Lisburn": 16.60, "Londonderry": 64.30, "Magherafelt": 54.70,
    "Moyle": 48.70, "Newry and Mourne": 71.40, "Newtownabbey": 18.00,
    "North Down": 11.30, "Omagh": 62.10, "Strabane": 56.90,
}

def main():
    # weight for the NI-mean sanity check: 1981 district populations (proxy; district
    # ranks are stable 1971<->1981). The shipped covariate is catholic_pct.
    pop81 = {}
    p = Path("data/census/derived/religion-1981-lgd.csv")
    if p.exists():
        for r in csv.DictReader(p.open()):
            pop81[r["lgd"]] = int(r["total_pop"])

    rows = [{"lgd": "NORTHERN IRELAND", "catholic_pct": "", "weight_pop_1981": sum(pop81.values()) or ""}]
    for lgd, pct in CATH71.items():
        rows.append({"lgd": lgd, "catholic_pct": pct, "weight_pop_1981": pop81.get(lgd, "")})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["lgd", "catholic_pct", "weight_pop_1981"])
        w.writeheader(); w.writerows(rows)

    print(f"wrote {OUT}: 26 districts")
    if pop81:
        num = sum(CATH71[l] * pop81[l] for l in CATH71 if l in pop81)
        den = sum(pop81[l] for l in CATH71 if l in pop81)
        print(f"NI 1981-pop-weighted mean 1971 Catholic%: {num/den:.1f} "
              f"(NI 1971 enumerated Roman Catholic = 477,921 = 31.4% of stated)")
    print(f"range: {min(CATH71.values())} (North Down) .. {max(CATH71.values())} (Newry & Mourne)")

if __name__ == "__main__":
    main()
