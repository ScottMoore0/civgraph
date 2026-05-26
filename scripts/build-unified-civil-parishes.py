from __future__ import annotations

import gzip
import json
import math
from pathlib import Path

import geopandas as gpd
import pandas as pd
ROOT = Path(__file__).resolve().parents[1]
MAP_DIR = ROOT / "data" / "maps" / "baronies-parishes"
CHUNKS_DIR = MAP_DIR / "chunks"

SOURCES = [
    ("Connacht", MAP_DIR / "ParishesConnacht.fgb"),
    ("Leinster", MAP_DIR / "ParishesLeinster.fgb"),
    ("Munster", MAP_DIR / "ParishesMunster.fgb"),
    ("Ulster", MAP_DIR / "ParishesUlster.fgb"),
]

MAP_ID = "civil-parishes-by-province"
BASE_NAME = "Civil_Parishes_Ireland_v2"
BASE_FGB = MAP_DIR / f"{BASE_NAME}.fgb"
LOD_LEVELS = [
    ("lod0", 0.005),
    ("lod1", 0.0005),
    ("lod2", 0.0001),
]

IE_BBOX = (-10.75, 51.35, -5.35, 55.55)
CELL_DEG = 0.5
ZOOM_LEVELS = [
    {"name": "z7", "minDiag": 0.02, "maxZoom": 8, "tolerance": 0.005},
    {"name": "z10", "minDiag": 0.004, "maxZoom": 11, "tolerance": 0.001},
]


def compress_gzip(path: Path) -> Path:
    out = path.with_suffix(path.suffix + ".gz")
    with path.open("rb") as src, gzip.open(out, "wb", compresslevel=9) as dst:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            dst.write(chunk)
    return out


def bbox_diag(geom) -> float:
    if geom is None or geom.is_empty:
        return 0.0
    minx, miny, maxx, maxy = geom.bounds
    return math.hypot(maxx - minx, maxy - miny)


def write_fgb(gdf: gpd.GeoDataFrame, path: Path) -> None:
    if path.exists():
        path.unlink()
    gdf.to_file(path, driver="FlatGeobuf")
    compress_gzip(path)


def build_unified() -> gpd.GeoDataFrame:
    frames = []
    for province, path in SOURCES:
        gdf = gpd.read_file(path)
        gdf["province_source"] = province
        frames.append(gdf)
        print(f"{province}: {len(gdf)} features, {path.stat().st_size / 1_000_000:.1f} MB")

    columns = sorted(set().union(*(set(frame.columns) for frame in frames)))
    aligned = []
    for frame in frames:
        for col in columns:
            if col not in frame.columns:
                frame[col] = None
        aligned.append(frame[columns])

    merged = gpd.GeoDataFrame(pd.concat(aligned, ignore_index=True), crs=frames[0].crs)
    merged = merged[merged.geometry.notna() & ~merged.geometry.is_empty].copy()
    print(f"Unified: {len(merged)} features")
    write_fgb(merged, BASE_FGB)
    print(f"Wrote {BASE_FGB.relative_to(ROOT)} ({BASE_FGB.stat().st_size / 1_000_000:.1f} MB)")
    return merged


def build_lods(gdf: gpd.GeoDataFrame) -> None:
    for suffix, tolerance in LOD_LEVELS:
        out = BASE_FGB.with_name(f"{BASE_NAME}-{suffix}.fgb")
        simplified = gdf.copy()
        simplified["geometry"] = simplified.geometry.simplify(tolerance, preserve_topology=False)
        simplified = simplified[simplified.geometry.notna() & ~simplified.geometry.is_empty].copy()
        if suffix == "lod0":
            try:
                simplified["geometry"] = simplified.geometry.buffer(0)
                simplified = simplified[simplified.geometry.notna() & ~simplified.geometry.is_empty].copy()
            except Exception:
                pass
        write_fgb(simplified, out)
        print(f"Wrote {out.relative_to(ROOT)} ({len(simplified)} features, {out.stat().st_size / 1_000_000:.1f} MB)")


def build_zoom_variant(gdf: gpd.GeoDataFrame, chunk_path: Path, level: dict) -> dict | None:
    filtered = gdf[gdf.geometry.apply(bbox_diag) >= level["minDiag"]].copy()
    if filtered.empty or len(filtered) == len(gdf):
        return None
    filtered["geometry"] = filtered.geometry.simplify(level["tolerance"], preserve_topology=False)
    filtered = filtered[filtered.geometry.notna() & ~filtered.geometry.is_empty].copy()
    if filtered.empty:
        return None
    out = chunk_path.with_name(f"{chunk_path.stem}_{level['name']}.fgb")
    write_fgb(filtered, out)
    return {
        "file": out.relative_to(ROOT).as_posix(),
        "count": int(len(filtered)),
        "maxZoom": level["maxZoom"],
    }


def build_chunks(gdf: gpd.GeoDataFrame) -> None:
    CHUNKS_DIR.mkdir(exist_ok=True)
    for stale in CHUNKS_DIR.glob(f"{BASE_NAME}_*.fgb*"):
        stale.unlink()

    minx, miny, maxx, maxy = IE_BBOX
    rows = math.ceil((maxy - miny) / CELL_DEG)
    cols = math.ceil((maxx - minx) / CELL_DEG)
    chunks = []
    total = 0
    anchors = gdf.geometry.representative_point()
    anchor_x = anchors.x
    anchor_y = anchors.y

    for row in range(rows):
        for col in range(cols):
            cminx = minx + col * CELL_DEG
            cmaxx = min(cminx + CELL_DEG, maxx)
            cminy = miny + row * CELL_DEG
            cmaxy = min(cminy + CELL_DEG, maxy)
            x_upper = anchor_x <= cmaxx if col == cols - 1 else anchor_x < cmaxx
            y_upper = anchor_y <= cmaxy if row == rows - 1 else anchor_y < cmaxy
            mask = (anchor_x >= cminx) & x_upper & (anchor_y >= cminy) & y_upper
            cell = gdf[mask].copy()
            if cell.empty:
                continue

            chunk_id = f"{row}_{col}"
            chunk_path = CHUNKS_DIR / f"{BASE_NAME}_{chunk_id}.fgb"
            write_fgb(cell, chunk_path)
            zoom_files = {}
            for level in ZOOM_LEVELS:
                variant = build_zoom_variant(cell, chunk_path, level)
                if variant:
                    zoom_files[level["name"]] = variant
            actual_bounds = [round(v, 6) for v in cell.total_bounds.tolist()]
            chunks.append({
                "id": chunk_id,
                "bbox": actual_bounds,
                "file": chunk_path.relative_to(ROOT).as_posix(),
                "count": int(len(cell)),
                "zoomFiles": zoom_files,
            })
            total += len(cell)
            print(f"Chunk {chunk_id}: {len(cell)} features")

    chunks.sort(key=lambda item: item["id"])
    index = {
        "mapId": MAP_ID,
        "grid": [rows, cols],
        "cellSize": CELL_DEG,
        "bbox": list(IE_BBOX),
        "totalFeatures": int(len(gdf)),
        "chunkFeatureRefs": int(total),
        "zoomLevels": [
            {key: level[key] for key in ("name", "minDiag", "maxZoom")}
            for level in ZOOM_LEVELS
        ],
        "chunks": chunks,
    }
    index_path = MAP_DIR / f"{MAP_ID}-chunks.json"
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {index_path.relative_to(ROOT)} ({len(chunks)} chunks, {total} chunk refs)")


def main() -> None:
    gdf = build_unified()
    build_lods(gdf)
    build_chunks(gdf)


if __name__ == "__main__":
    main()
