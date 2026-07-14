#!/usr/bin/env python3
"""Build 2011 Census joint-margin tables (Small Area) as tidy poststratification
inputs for MRP: age x religion-brought-up-in (LC2110) and sex x religion-brought-up-in
(LC2112). These are the published 2-way joints; a full age x sex x religion x NS-SeC
frame must be raked (IPF) from these margins — see agent/mrp-frame-README.md.
Plain stdlib."""
import csv, os
BASE = "data/census/2011/census-2011-local-characteristic-tables-statistical-geographies/SMALL AREAS"
OUT = "data/census/derived"
os.makedirs(OUT, exist_ok=True)

def read(tbl):
    with open(f"{BASE}/{tbl}NIDATA0.CSV", newline="") as f:
        return {r["GeographyCode"]: r for r in csv.DictReader(f)}

REL = ["Catholic", "Protestant and Other Christian", "Other religions and none"]

# LC2110: age x religion brought up in. Joint cells (excluding 'All') by age band.
lc2110 = read("LC2110")
AGE = {"0-24": ("0006", "0007", "0008"), "25-44": ("0010", "0011", "0012"), "45+": ("0014", "0015", "0016")}
with open(f"{OUT}/joint-2011-age-religion-sa.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["SA2011", "age_band", "religion_brought_up_in", "count"])
    for code, r in lc2110.items():
        for band, cols in AGE.items():
            for rel, c in zip(REL, cols):
                w.writerow([code, band, rel, r[f"LC2110NI{c}"]])

# LC2112: sex x religion brought up in.
lc2112 = read("LC2112")
SEX = {"Male": ("0006", "0007", "0008"), "Female": ("0010", "0011", "0012")}
with open(f"{OUT}/joint-2011-sex-religion-sa.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["SA2011", "sex", "religion_brought_up_in", "count"])
    for code, r in lc2112.items():
        for sex, cols in SEX.items():
            for rel, c in zip(REL, cols):
                w.writerow([code, sex, rel, r[f"LC2112NI{c}"]])

for fn in ("joint-2011-age-religion-sa.csv", "joint-2011-sex-religion-sa.csv"):
    n = sum(1 for _ in open(f"{OUT}/{fn}")) - 1
    print(f"wrote {fn}: {n} rows")
