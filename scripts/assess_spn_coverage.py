#!/usr/bin/env python
"""Assess SPN coverage across all NI elections."""
import json, os
from pathlib import Path
from collections import defaultdict

os.chdir("C:/Users/scomo/boundaries-website")

# Known elections
elections = [
    # (name, year, type, expected_constituencies)
    ("Stormont 1921", 1921, "stormont", 48),
    ("Stormont 1925", 1925, "stormont", 48),
    ("Stormont 1929", 1929, "stormont", 48),
    ("Stormont 1933", 1933, "stormont", 48),
    ("Stormont 1938", 1938, "stormont", 48),
    ("Stormont 1945", 1945, "stormont", 48),
    ("Stormont 1949", 1949, "stormont", 48),
    ("Stormont 1953", 1953, "stormont", 48),
    ("Stormont 1958", 1958, "stormont", 48),
    ("Stormont 1962", 1962, "stormont", 48),
    ("Stormont 1965", 1965, "stormont", 48),
    ("Stormont 1969", 1969, "stormont", 52),
    ("Westminster 1922", 1922, "westminster", 13),
    ("Westminster 1923", 1923, "westminster", 13),
    ("Westminster 1924", 1924, "westminster", 13),
    ("Westminster 1929", 1929, "westminster", 13),
    ("Westminster 1931", 1931, "westminster", 13),
    ("Westminster 1935", 1935, "westminster", 13),
    ("Westminster 1945", 1945, "westminster", 13),
    ("Westminster 1950", 1950, "westminster", 12),
    ("Westminster 1951", 1951, "westminster", 12),
    ("Westminster 1955", 1955, "westminster", 12),
    ("Westminster 1959", 1959, "westminster", 12),
    ("Westminster 1964", 1964, "westminster", 12),
    ("Westminster 1966", 1966, "westminster", 12),
    ("Westminster 1970", 1970, "westminster", 12),
    ("Westminster Feb 1974", 1974, "westminster", 12),
    ("Westminster Oct 1974", 1974, "westminster", 12),
    ("Westminster 1979", 1979, "westminster", 12),
    ("Westminster 1983", 1983, "westminster", 17),
    ("Westminster 1987", 1987, "westminster", 17),
    ("Westminster 1992", 1992, "westminster", 17),
    ("Westminster 1997", 1997, "westminster", 18),
    ("Westminster 2001", 2001, "westminster", 18),
    ("Westminster 2005", 2005, "westminster", 18),
    ("Westminster 2010", 2010, "westminster", 18),
    ("Westminster 2015", 2015, "westminster", 18),
    ("Westminster 2017", 2017, "westminster", 18),
    ("Westminster 2019", 2019, "westminster", 18),
    ("Westminster 2024", 2024, "westminster", 18),
    ("Assembly 1973", 1973, "assembly", 12),
    ("Assembly 1982", 1982, "assembly", 12),
    ("Assembly 1998", 1998, "assembly", 18),
    ("Assembly 2003", 2003, "assembly", 18),
    ("Assembly 2007", 2007, "assembly", 18),
    ("Assembly 2011", 2011, "assembly", 18),
    ("Assembly 2016", 2016, "assembly", 18),
    ("Assembly 2017", 2017, "assembly", 18),
    ("Assembly 2022", 2022, "assembly", 18),
    ("Convention 1975", 1975, "convention", 12),
    ("Forum 1996", 1996, "forum", 18),
    ("European 1979", 1979, "european", 1),
    ("European 1984", 1984, "european", 1),
    ("European 1989", 1989, "european", 1),
    ("European 1994", 1994, "european", 1),
    ("European 1999", 1999, "european", 1),
    ("European 2004", 2004, "european", 1),
    ("European 2009", 2009, "european", 1),
    ("European 2014", 2014, "european", 1),
    ("European 2019", 2019, "european", 1),
    ("Local 2023", 2023, "local", 80),
    ("Local 2019", 2019, "local", 80),
    ("Local 2014", 2014, "local", 80),
    ("Local 2011", 2011, "local_old", 101),
    ("Local 2005", 2005, "local_old", 101),
    ("Local 2001", 2001, "local_old", 101),
    ("Local 1997", 1997, "local_old", 101),
    ("Local 1993", 1993, "local_old", 101),
    ("Local 1989", 1989, "local_old", 101),
    ("Local 1985", 1985, "local_old", 101),
    ("Local 1981", 1981, "local_old", 101),
    ("Local 1977", 1977, "local_old", 101),
    ("Local 1973", 1973, "local_old", 101),
]

# EONI/Council SPNs - manually assessed from earlier analysis
eoni_status = {
    "Assembly 2016": "COMPLETE (18/18)",
    "Assembly 2017": "COMPLETE (18/18)",
    "Assembly 2022": "NEAR-COMPLETE (17/18, Belfast South missing)",
    "Assembly 2011": "PARTIAL (9/18 from EONI MDs + 8 PDFs)",
    "Westminster 2015": "COMPLETE (18/18, combined + individual)",
    "Westminster 2017": "COMPLETE (18/18, combined + individual)",
    "Westminster 2019": "COMPLETE (18/18, combined + individual)",
    "Westminster 2024": "COMPLETE (combined SPN covers all 18)",
    "European 2014": "COMPLETE",
    "European 2019": "COMPLETE",
    "Local 2023": "COMPLETE (80/80 DEAs)",
    "Local 2019": "NEAR-COMPLETE (~73/80, Ards&ND + Lisburn&C gaps)",
    "Local 2014": "PARTIAL (21 SPNs from old26 councils: Ards 7, Ballymoney 7, + v4 downloads)",
    "Westminster 2018 by-election": "COMPLETE (West Tyrone)",
}

# Load Gazette entries to check coverage
gazette_years = defaultdict(int)
for subdir in ["belfast_spn", "london_spn", "london_spn_ni"]:
    epath = Path(f"_tmp_gazette/{subdir}/entries.json")
    if epath.exists():
        with open(epath, encoding="utf-8") as f:
            for e in json.load(f):
                gazette_years[e.get("published", "")[:4]] += 1

print("=" * 85)
print(f"{'Election':<28} {'Digital SPNs':<35} {'Gazette':<10} {'Status'}")
print("=" * 85)

complete = 0
near_complete = 0
partial = 0
gazette_only = 0
missing = 0

for name, year, etype, expected in elections:
    eoni = eoni_status.get(name, "")
    gaz_count = gazette_years.get(str(year), 0)
    gaz = f"{gaz_count} notices" if gaz_count > 0 else "None"

    if "COMPLETE" in eoni and "NEAR" not in eoni:
        status = "COMPLETE"
        complete += 1
    elif "NEAR" in eoni:
        status = "NEAR-COMPLETE"
        near_complete += 1
    elif "PARTIAL" in eoni:
        status = "PARTIAL"
        partial += 1
    elif gaz_count > 0:
        status = "GAZETTE ONLY (unverified)"
        gazette_only += 1
    else:
        status = "MISSING"
        missing += 1

    print(f"{name:<28} {eoni:<35} {gaz:<10} {status}")

print("=" * 85)
print(f"\nSummary:")
print(f"  COMPLETE:       {complete}")
print(f"  NEAR-COMPLETE:  {near_complete}")
print(f"  PARTIAL:        {partial}")
print(f"  GAZETTE ONLY:   {gazette_only} (PDFs downloaded but not yet verified/parsed)")
print(f"  MISSING:        {missing}")
print(f"  Total elections: {len(elections)}")
