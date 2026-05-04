#!/usr/bin/env python
"""Download NIEA Natural Environment designated-sites datasets from
Open Data NI as GeoJSON, convert to FlatGeobuf (already WGS84), and
write to data/maps/designated-sites/.

Source: NIEA Natural Environment Division (DAERA) on Open Data NI.

Usage:
  python scripts/fetch_niea_designated.py [--skip-download]
"""
import json
import re
import shutil
import subprocess
import sys
import urllib.request
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TMP = REPO / "_tmp_niea"
OUT = REPO / "data" / "maps" / "designated-sites"
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)

GDAL_BIN = Path("C:/Program Files/GDAL")
OGR2OGR = str(GDAL_BIN / "ogr2ogr.exe")

UA = "Mozilla/5.0 civgraph-scraper - NIEA designated sites"

# (slug, full_title, package_id, geojson_resource_id, geojson_filename)
DATASETS = [
    ("designated-aonb",   "Areas of Outstanding Natural Beauty",
     "9d3ddec8-eaf4-43a1-9b80-2a23dab6e0a1",
     "00347e51-c3ca-46c0-a638-0b15b085060a",
     "aonb-updated-27aug2020.geojson"),
    ("designated-assi",   "Areas of Special Scientific Interest",
     "f2cdb3e5-f3a3-4dec-92cd-72a66a78f30c",
     "175b432e-01df-4413-b265-4f85c97914d1",
     "assi-updated-25aug2020.geojson"),
    ("designated-nnr",    "National Nature Reserves",
     "f1c6df14-65ea-4ab3-9a84-09c5e4c3f5e7",
     "0fed28cb-5dec-49f2-ace1-ba7d7e70a0dc",
     "national-nature-reserves-updated-27aug2020.geojson"),
    ("designated-ramsar", "Ramsar Sites",
     "fa72bccc-6dba-435a-9907-5ce98c8b3a47",
     "97981f8f-091b-4ad8-ae1d-7ba7a6167f14",
     "ramsarsites-updated-27aug2020.geojson"),
    ("designated-sac",    "Special Areas of Conservation",
     "c1ef0c93-edcc-462b-906f-e3e6cf99f923",
     "f9a9e76d-f4b5-4c21-f794-26ade0af0000",  # placeholder; resolved at runtime
     "special-areas-of-conservation-updated-27aug2020.geojson"),
    ("designated-spa",    "Special Protection Areas",
     "63d2e0c8-f7e3-44f3-bf91-d33fc99f8000",
     "8b2c7820-7f12-4b80-aedc-695464d7f618",
     "special-protected-areas-updated-27aug2020.geojson"),
    ("designated-whs",    "World Heritage Site",
     "8a7e2c4d-9876-4321-abcd-aaaaaaaaaaaa",
     "64746aa4-313f-455a-bf7c-230db9d18655",
     "worldheritagesite.geojson"),
    ("designated-lca",    "Landscape Character Areas",
     "9b3d1f2c-6789-4321-bcde-bbbbbbbbbbbb",
     "0c87b62b-a1b2-4b62-b539-0c2112003d02",
     "landscapecharacterareas-updated-27aug2020.geojson"),
]


def find_geojson_url(catalogue, package_substring, geojson_filename):
    """Look up the actual download URL from the catalogue file using the
    geojson filename as the matching token (more reliable than IDs)."""
    for pkg in catalogue:
        for r in pkg.get("resources", []):
            url = r.get("url", "")
            if geojson_filename in url:
                return url
    return None


def fetch(url, dest):
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    print(f"  downloading: {url[-80:]}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    print(f"    {len(data)/1024:.0f} KB")
    return dest


def run(*args):
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  ! command failed: {' '.join(str(a) for a in args[:3])}...")
        print(f"    stderr: {r.stderr[:300]}")
    return r.returncode == 0


def convert(slug, geojson_path):
    out_fgb = OUT / f"{slug}.fgb"
    print(f"  converting {geojson_path.name} -> {out_fgb.name}")
    if out_fgb.exists():
        out_fgb.unlink()
    # GeoJSON is already WGS84 (per the spec). Promote to multi-polygon to
    # avoid the same Polygon/MultiPolygon mismatch we hit with Ulster Wildlife.
    ok = run(OGR2OGR, "-f", "FlatGeobuf",
             "-nlt", "PROMOTE_TO_MULTI", "-skipfailures",
             out_fgb, geojson_path)
    if not ok or not out_fgb.exists() or out_fgb.stat().st_size < 2000:
        if out_fgb.exists() and out_fgb.stat().st_size < 2000:
            out_fgb.unlink()
        return False
    # Compress
    import gzip
    gz = out_fgb.with_suffix(out_fgb.suffix + ".gz")
    if gz.exists(): gz.unlink()
    with out_fgb.open("rb") as src, gzip.open(gz, "wb") as dst:
        shutil.copyfileobj(src, dst)
    return True


def main():
    skip_download = "--skip-download" in sys.argv
    print("Loading catalogue...")
    cat = json.loads((REPO / "data" / "external" / "opendatani-catalogue.json").read_text(encoding="utf-8"))
    print(f"Output dir: {OUT}")
    success, fail = 0, 0
    for slug, title, _, _, geojson_filename in DATASETS:
        print(f"\n{slug}: {title}")
        if not skip_download:
            url = find_geojson_url(cat, slug, geojson_filename)
            if not url:
                print(f"  ! no GeoJSON URL found in catalogue for filename '{geojson_filename}'")
                fail += 1
                continue
            local = TMP / geojson_filename
            try:
                fetch(url, local)
            except Exception as e:
                print(f"  ! download failed: {e}")
                fail += 1
                continue
        else:
            local = TMP / geojson_filename
            if not local.exists():
                print(f"  ! source missing: {local}")
                fail += 1
                continue
        if convert(slug, local):
            success += 1
        else:
            fail += 1
    print(f"\nDone: {success} ok, {fail} failed")


if __name__ == "__main__":
    main()
