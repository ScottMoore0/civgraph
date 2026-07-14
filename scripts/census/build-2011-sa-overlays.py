#!/usr/bin/env python3
"""Build 2011 Census Small-Area (SA2011) data-entry overlays from the committed
NISRA 2011 Key Statistics flat files. Produces one CSV (census-2011-sa.csv) with
the MRP-relevant demographics joined on SA2011, ready for data-entries on the
sa-2011 layer. Plain stdlib (no numpy/pandas)."""
import csv, json, os
BASE = "data/census/2011/census-2011-key-statistics-tables-statistical-geographies/SMALL AREAS"

def read(tbl):
    with open(f"{BASE}/{tbl}NIDATA0.CSV", newline="") as f:
        return {r["GeographyCode"]: r for r in csv.DictReader(f)}

ks101, ks102, ks212, ks611 = read("KS101"), read("KS102"), read("KS212"), read("KS611")

# SOA names from the NIMDM CSV we already built (SA2011 -> SOA name)
soa = {}
try:
    for r in csv.DictReader(open("data/census/derived/nimdm-2017-sa.csv")):
        soa[r["SA2011"]] = r["Geography"]
except Exception:
    pass

def pct(num, den):
    try:
        n, d = float(num), float(den)
        return round(100 * n / d, 1) if d else ""
    except Exception:
        return ""

rows = []
for code in ks101:
    a, g, r, s = ks101[code], ks102.get(code, {}), ks212.get(code, {}), ks611.get(code, {})
    allres = a.get("KS101NI0001")
    age_all = g.get("KS102NI0001")
    age_10_19 = sum(float(g.get(c, 0) or 0) for c in ("KS102NI0005", "KS102NI0006", "KS102NI0007", "KS102NI0008"))
    rel_all = r.get("KS212NI0001")
    nssec_all = s.get("KS611NI0001")
    nssec_higher = sum(float(s.get(c, 0) or 0) for c in ("KS611NI0002", "KS611NI0003", "KS611NI0004", "KS611NI0005"))  # NS-SeC 1.1,1.2,2,3 ~ ABC1
    rows.append({
        "SA2011": code,
        "Geography": soa.get(code, code),
        "AllUsualResidents": allres,
        "Female_pct": a.get("KS101NI0007"),
        "Age_10_19_pct": pct(age_10_19, age_all),
        "Median_age": g.get("KS102NI0019"),
        "Catholic_background_pct": pct(r.get("KS212NI0002"), rel_all),
        "Protestant_background_pct": pct(r.get("KS212NI0003"), rel_all),
        "NSSeC_higher_pct": pct(nssec_higher, nssec_all),  # NS-SeC 1-3 (managerial/professional/intermediate), ABC1 proxy
    })

rows.sort(key=lambda x: x["SA2011"])
cols = ["SA2011", "Geography", "AllUsualResidents", "Female_pct", "Age_10_19_pct", "Median_age",
        "Catholic_background_pct", "Protestant_background_pct", "NSSeC_higher_pct"]
os.makedirs("data/census/derived", exist_ok=True)
with open("data/census/derived/census-2011-sa.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    w.writerows(rows)
print(f"wrote census-2011-sa.csv: {len(rows)} Small Areas, cols={cols}")
print("sample:", {k: rows[0][k] for k in cols})
