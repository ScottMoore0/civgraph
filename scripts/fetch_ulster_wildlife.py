#!/usr/bin/env python
"""Download Ulster Wildlife habitat-network datasets from Open Data NI,
convert SHP -> FGB (EPSG:4326), generate LOD variants, and emit maps.json
entries.

Output:
  data/maps/biodiversity/<slug>.fgb (+ -lod0.fgb, -lod1.fgb, .gz versions)

Usage:
  python scripts/fetch_ulster_wildlife.py [--skip-download] [--skip-convert]
"""
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TMP = REPO / "_tmp_uw"
OUT = REPO / "data" / "maps" / "biodiversity"
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)

GDAL_BIN = Path("C:/Program Files/GDAL")
OGR2OGR = str(GDAL_BIN / "ogr2ogr.exe")

UA = "Mozilla/5.0 boundaries-website-scraper - Ulster Wildlife habitat networks"

# (slug, full_title, package_id, resource_id, filename, abbrev)
DATASETS = [
    ("habitat-bog", "Bog Habitat Network",
     "846c30d0-2d1d-441e-99dc-43c4741e77f6", "b3061c08-a5e2-4b84-9c38-6ac76b773dee",
     "bog-network.zip"),
    ("habitat-deciduous-woodland", "Deciduous Woodland Habitat Network",
     "b15b4d96-9513-43b6-a310-a23c5c7fff37", "11c72436-ebfb-4712-9b8c-48662a4b4551",
     "dwl.zip"),
    ("habitat-fen", "Fen Habitat Network",
     "a62e37f4-9a17-4854-a2ac-cc7b5b433648", "82e70d82-0e41-427f-a12d-43eef73524f2",
     "fen.zip"),
    ("habitat-heath", "Heath Habitat Network",
     "11cae57f-ed15-4a0d-82b4-86871060a6f3", "1e1d7918-821e-45a2-a743-4dbfaf3f9f20",
     "hth.zip"),
    ("habitat-lake", "Lake Habitat Network",
     "c389bfb5-65af-4457-b3f7-b5d1f2c7a29a", "b0ac9330-39bf-4b52-96ee-bf5e3b880bd8",
     "lak.zip"),
    ("habitat-acid-grassland", "Acid Grassland Habitat Network",
     "f4cdfd0e-f655-444d-a5fb-f052a04c6737", "b8377f2c-5dd9-4d8b-87f3-840eda8cb89b",
     "agl.zip"),
    ("habitat-calcareous-grassland", "Calcareous Grassland Habitat Network",
     "ddc941ea-51ce-4bb5-be8c-1daabca0a9b1", "0e4b6339-4b8b-432f-a62f-e50603a3421e",
     "cgl.zip"),
    ("habitat-coastal-sand-dune", "Coastal Sand Dune Habitat Network",
     "10a948a6-05d5-498b-853a-430086da439a", "fe0e195c-7fe3-4b6f-b6bd-c4d1d838ad76",
     "csd.zip"),
    ("habitat-coastal-saltmarsh", "Coastal Saltmarsh Habitat Network",
     "05953343-682e-4ae7-87c3-801a092f0587", "e9f389fa-129a-42b0-a953-d658181f58c2",
     "csm.zip"),
    ("habitat-coastal-vegetated-shingle", "Coastal Vegetated Shingle Habitat Network",
     "bc57fe1b-d5f1-4f1a-af96-494618f3b53b", "9eee1f6e-f567-46f2-9443-9599d8bf51fc",
     "cvs.zip"),
    ("habitat-ancient-semi-natural-woodland", "Ancient Semi-Natural Woodland Habitat Network",
     "0602c59a-2e65-40e7-88cf-4335afed4e09", "11e4cc08-daa5-414d-a008-cf81d505dc67",
     "asnw.zip"),
    ("habitat-lowland-meadow", "Lowland Meadow Habitat Network",
     "c3d5eef0-5ddc-4ba4-a278-b292b1e00b65", "5eecc186-748e-4944-9460-30fee0f4dfba",
     "lmw.zip"),
    ("habitat-limestone-pavement", "Limestone Pavement Habitat Network",
     "371e68d4-530a-4d1c-b867-44a3ef320411", "c17a6347-4352-41cb-844b-35f5e1c2f2c7",
     "lsp.zip"),
    ("habitat-maritime-cliff-slope", "Maritime Cliff and Slope Habitat Network",
     "2b89ad59-e650-4eca-b974-19dda42a8572", "fa869a31-42db-4296-8bee-0f29590a4deb",
     "mcs.zip"),
    ("habitat-pond", "Pond Habitat Network",
     "4773a29d-b525-4e50-acae-b4ffa4047279", "c6d37883-4e89-40ff-8c36-f02e75f0c561",
     "pon.zip"),
    ("habitat-reedbed", "Reedbed Habitat Network",
     "2aad7ca5-4619-4519-ab64-4ecfff858e72", "c398bec9-2c07-41f3-a52e-f6b75b591a6e",
     "rbd.zip"),
    ("habitat-river", "River Habitat Network",
     "bde1d3a6-9276-442d-89e7-8a064af48898", "9a009e4a-9e1c-4396-8ed2-4fd2c09ed121",
     "riv.zip"),
    ("habitat-traditional-orchard", "Traditional Orchard Habitat Network",
     "c4f05bd7-5dd5-4504-b6d7-23940957c3cd", "73256bb2-4ab1-4612-934b-461201810c51",
     "tro.zip"),
    ("habitat-wood-pasture-parkland", "Wood Pasture and Parkland Habitat Network",
     "89653a85-4d13-4cc7-a643-1fb6e7cad0fa", "ffd725e2-702f-4ad4-83fd-168bdbca55e8",
     "wpp.zip"),
    ("habitat-purple-moor-grass", "Purple Moor Grass and Rush Pasture Habitat Network",
     "7bd34e15-1fd7-4b7d-acd3-f2cfefbc15c6", "8e513c7b-81da-4d5b-a48e-a50b7d0e49de",
     "pmg.zip"),
    # Grouped overview datasets
    ("habitat-coastal-grouped", "Coastal Habitat Networks (grouped)",
     "db9a4622-7b79-4bbe-94b6-ff54c9fafd2f", "94aa5eba-c5d3-4cd1-843e-c329a429d581",
     "coastal.zip"),
    ("habitat-woodland-grouped", "Woodland Habitat Networks (grouped)",
     "8cc0d885-994c-432c-af8e-44ff55b4761d", "75bd57e1-fe6e-4438-b09c-de311583164b",
     "woodland.zip"),
    ("habitat-grassland-grouped", "Grassland Habitat Networks (grouped)",
     "f311e7ab-085e-491a-bda2-939e039541d2", "a70269b1-8923-4e7f-8e54-ef4c5a37c0e4",
     "grassland.zip"),
    ("habitat-wetland-grouped", "Wetland Habitat Networks (grouped)",
     "8e581af0-a6bb-43b6-b2d9-1f4d5ed96013", "0d458197-6425-4a5d-ba3a-7a4dcf7fa34a",
     "wetland.zip"),
]


def url_for(pkg_id, res_id, filename):
    return (f"https://admin.opendatani.gov.uk/dataset/{pkg_id}/resource/"
            f"{res_id}/download/{filename}")


def download(slug, url, zipname):
    out = TMP / zipname
    if out.exists() and out.stat().st_size > 1000:
        return out
    print(f"  downloading {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    out.write_bytes(data)
    print(f"    {len(data)/1024:.0f} KB")
    return out


def unzip_to(zip_path, dest):
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    import zipfile
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(dest)
    # Find the .shp inside
    shps = list(dest.rglob("*.shp"))
    if not shps:
        return None
    return shps[0]


def run(*args):
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  ! command failed: {' '.join(str(a) for a in args[:3])}...")
        print(f"    stderr: {r.stderr[:300]}")
    return r.returncode == 0


def convert(slug, shp_path, do_lod=True):
    out_fgb = OUT / f"{slug}.fgb"
    print(f"  converting {shp_path.name} -> {out_fgb.name}")
    if out_fgb.exists():
        out_fgb.unlink()
    # Some Ulster Wildlife shapefiles declare the layer as Polygon but contain
    # MultiPolygon features — promote the layer geometry type so ogr2ogr
    # accepts both. Reproject from Irish Grid (EPSG:29903) to WGS84.
    ok = run(OGR2OGR, "-f", "FlatGeobuf", "-t_srs", "EPSG:4326",
             "-nlt", "PROMOTE_TO_MULTI", "-skipfailures",
             out_fgb, shp_path)
    if not ok or not out_fgb.exists() or out_fgb.stat().st_size < 2000:
        if out_fgb.exists() and out_fgb.stat().st_size < 2000:
            out_fgb.unlink()
        return False
    # Optional LODs (slow on dense polygon datasets — controlled by env var)
    lod0 = OUT / f"{slug}-lod0.fgb"
    lod1 = OUT / f"{slug}-lod1.fgb"
    if do_lod:
        if lod0.exists(): lod0.unlink()
        run(OGR2OGR, "-f", "FlatGeobuf", "-simplify", "0.005",
            "-nlt", "PROMOTE_TO_MULTI", "-skipfailures", lod0, out_fgb)
        if lod1.exists(): lod1.unlink()
        run(OGR2OGR, "-f", "FlatGeobuf", "-simplify", "0.001",
            "-nlt", "PROMOTE_TO_MULTI", "-skipfailures", lod1, out_fgb)
        for stale in OUT.glob(f"{slug}*_temp.fgb"):
            try: stale.unlink()
            except OSError: pass
    # Compress everything that exists
    import gzip
    for f in (out_fgb, lod0, lod1):
        if f.exists() and f.stat().st_size > 100:
            gz = f.with_suffix(f.suffix + ".gz")
            with f.open("rb") as src, gzip.open(gz, "wb") as dst:
                shutil.copyfileobj(src, dst)
    return True


def main():
    skip_download = "--skip-download" in sys.argv
    skip_convert = "--skip-convert" in sys.argv
    no_lod = "--no-lod" in sys.argv
    only_main = "--only-main" in sys.argv  # alias
    do_lod = not (no_lod or only_main)
    print(f"Output dir: {OUT}  (LOD: {'yes' if do_lod else 'no'})")
    success, fail = 0, 0
    for entry in DATASETS:
        slug, title, pkg_id, res_id, fname = entry
        out_fgb = OUT / f"{slug}.fgb"
        # Skip already-converted (only when not regenerating LODs).
        if out_fgb.exists() and out_fgb.stat().st_size > 2000 and not do_lod:
            print(f"\n{slug}: already converted (skipping)")
            success += 1
            continue
        print(f"\n{slug}: {title}")
        try:
            zip_path = download(slug, url_for(pkg_id, res_id, fname), fname) if not skip_download else TMP / fname
            extract_dir = TMP / slug
            shp = unzip_to(zip_path, extract_dir)
            if shp is None:
                print(f"  ! no .shp in zip")
                fail += 1
                continue
            if not skip_convert:
                if not convert(slug, shp, do_lod=do_lod):
                    fail += 1
                    continue
            success += 1
        except Exception as e:
            print(f"  ! {type(e).__name__}: {e}")
            fail += 1
    print(f"\nDone: {success} ok, {fail} failed")


if __name__ == "__main__":
    main()
