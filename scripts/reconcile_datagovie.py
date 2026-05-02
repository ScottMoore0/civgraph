#!/usr/bin/env python
"""Reconcile what was supposed to land vs what's on disk under D:\\datagovie\\.

Re-applies the same filter pipeline used by mirror_datagovie.py to the
resolved resources JSON, computes the expected target path for each,
and reports which expected files are missing.

Output:
  D:\\datagovie\\_reconcile_missing.csv  — rows for missing resources
  D:\\datagovie\\_reconcile_summary.txt  — human-readable summary
"""
import csv, json, os, re, sys, urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RESOLVED = REPO / "data" / "external" / "datagovie-resources-resolved.json"
TARGET = Path(r"D:\datagovie")
ODNI_MANIFEST = Path(r"D:\opendatani\_manifest.csv")

INVALID_FS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
SPATIAL_RANK = {"GPKG":0,"GEOPACKAGE":0,".GPKG":0,
                "SHP":1,"SHP / ZIP":1,"SHP.ZIP":1,"SHAPEFILE":1,"SHAPEFILES":1,
                "GEOJSON":2, "GDB":3,".GBD":3, "KML":4,"KMZ":4}
TABULAR_RANK = {"CSV":0,"CSV.ZIP":0,"CSV.":0, "XLSX":1,".XLSX":1,
                "XLS":2, "ODS":3, "TSV":4,"TAB":4}


def safe_name(s, max_len=100):
    if not s: return "_"
    s = INVALID_FS_RE.sub("_", s).strip(" .")
    return (s[:max_len] or "_")


def filename_from(r):
    rname = r.get("resource_name") or ""
    url = r.get("url") or ""
    basename = ""
    if url:
        basename = os.path.basename(urllib.parse.urlparse(url).path)
    if not basename or basename in {"download", "/"}:
        basename = rname or r["resource_id"]
    if rname and "." in rname and "." not in basename:
        basename = rname
    return safe_name(basename)


def select_canonical(resources):
    by_pkg = defaultdict(list)
    for r in resources:
        by_pkg[r.get("package_id") or ""].append(r)
    kept = []
    drop = {}
    for items in by_pkg.values():
        spatial, tabular, txt, other = [], [], [], []
        for r in items:
            f = (r.get("format") or "").upper()
            if f in SPATIAL_RANK: spatial.append(r)
            elif f in TABULAR_RANK: tabular.append(r)
            elif f == "TXT": txt.append(r)
            else: other.append(r)
        if spatial:
            for r in txt: drop[r["resource_id"]] = "txt-with-spatial"
        else:
            other.extend(txt)
        if spatial:
            spatial.sort(key=lambda r: (SPATIAL_RANK[(r.get("format") or "").upper()],
                                         -(r.get("resolved_size") or 0)))
            kept.append(spatial[0])
            for r in spatial[1:]: drop[r["resource_id"]] = "alt-spatial"
        if tabular:
            tabular.sort(key=lambda r: (TABULAR_RANK[(r.get("format") or "").upper()],
                                         -(r.get("resolved_size") or 0)))
            kept.append(tabular[0])
            for r in tabular[1:]: drop[r["resource_id"]] = "alt-tabular"
        kept.extend(other)
    return kept, drop


def load_odni_urls():
    if not ODNI_MANIFEST.exists(): return set()
    urls = set()
    with ODNI_MANIFEST.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("status") in {"ok","skipped"} and row.get("url"):
                urls.add(row["url"])
    return urls


def main():
    cap_bytes = int(5 * 1e9)
    print("Loading resolved resources ...")
    resources = json.loads(RESOLVED.read_text(encoding="utf-8"))
    ok_set = [r for r in resources if r.get("resolve_status") == "ok"]
    print(f"  resolve_status=ok: {len(ok_set):,}")

    kept, _ = select_canonical(ok_set)
    print(f"  after canonical: {len(kept):,}")

    capped = [r for r in kept if not (r.get("resolved_size") or 0) > cap_bytes]
    print(f"  after 5GB cap: {len(capped):,}")

    odni = load_odni_urls()
    final = [r for r in capped if r.get("url") not in odni]
    print(f"  after ODNI dedup: {len(final):,}")

    missing = []
    present = 0
    for r in final:
        org = safe_name(r.get("organization_title") or r.get("organization_name") or "_misc", 80)
        pkg = safe_name(r.get("package_name") or r.get("package_title") or r["resource_id"], 100)
        fname = filename_from(r)
        dest = TARGET / org / pkg / fname
        if dest.exists() and dest.stat().st_size > 0:
            present += 1
        else:
            missing.append({
                "resource_id": r["resource_id"],
                "package_name": r.get("package_name") or "",
                "organization": r.get("organization_title") or "",
                "format": (r.get("format") or "").upper(),
                "url": r.get("url") or "",
                "expected_size": r.get("resolved_size") or 0,
                "expected_path": str(dest),
            })

    print(f"\nPresent: {present:,}")
    print(f"Missing: {len(missing):,}")

    # Write missing CSV
    out_csv = TARGET / "_reconcile_missing.csv"
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(missing[0].keys()) if missing else
                           ["resource_id","package_name","organization","format","url","expected_size","expected_path"])
        w.writeheader()
        for row in missing: w.writerow(row)
    print(f"  wrote {out_csv} ({len(missing):,} rows)")

    # Summary by host + format + org
    hosts = Counter(urllib.parse.urlparse(r["url"]).netloc for r in missing)
    fmts = Counter(r["format"] for r in missing)
    orgs = Counter(r["organization"] for r in missing)
    bytes_total = sum(r["expected_size"] or 0 for r in missing)

    summary = []
    summary.append(f"data.gov.ie reconcile — {len(missing):,} missing of {len(final):,} expected")
    summary.append(f"Estimated bytes missing: {bytes_total/1e9:.2f} GB")
    summary.append("\nTop 15 missing hosts:")
    for h,n in hosts.most_common(15):
        summary.append(f"  {n:>5}  {h}")
    summary.append("\nTop 15 missing formats:")
    for f,n in fmts.most_common(15):
        summary.append(f"  {n:>5}  {f}")
    summary.append("\nTop 15 missing organisations:")
    for o,n in orgs.most_common(15):
        summary.append(f"  {n:>5}  {o[:60]}")

    out_txt = TARGET / "_reconcile_summary.txt"
    out_txt.write_text("\n".join(summary), encoding="utf-8")
    print("\n" + "\n".join(summary))


if __name__ == "__main__":
    main()
