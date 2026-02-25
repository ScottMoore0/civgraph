#!/usr/bin/env python3
"""
Build static pre-coloured XYZ tiles for Copernicus GLO-30 DEM (Ireland).

Pipeline:
1) Optional: merge source 1x1 degree Copernicus DEM tiles into one GeoTIFF mosaic.
2) Reproject DEM into Web Mercator per XYZ tile on demand.
3) Apply a terrain colour ramp offline.
4) Write static WebP tiles for Leaflet L.tileLayer(...).

Usage examples:
  python scripts/build-copernicus-dem-tiles.py
  python scripts/build-copernicus-dem-tiles.py --mosaic-from-dir data/maps/physical/dem_tiles
  python scripts/build-copernicus-dem-tiles.py --min-zoom 5 --max-zoom 13
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pyogrio
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_geom

WEBMERC = "EPSG:3857"
TILE_SIZE = 256
RADIUS = 6378137.0
ORIGIN_SHIFT = math.pi * RADIUS

# Elevation stops in metres with RGB values.
COLOR_STOPS = [
    (-50.0, (26, 152, 80)),
    (0.0, (67, 170, 96)),
    (100.0, (145, 207, 96)),
    (200.0, (217, 239, 139)),
    (400.0, (254, 224, 139)),
    (700.0, (253, 174, 97)),
    (1000.0, (244, 109, 67)),
    (1400.0, (215, 48, 39)),
    (2400.0, (127, 59, 8)),
]


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tile_bounds_webmerc(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    tile_width = (2 * ORIGIN_SHIFT) / n
    min_x = -ORIGIN_SHIFT + x * tile_width
    max_x = min_x + tile_width
    max_y = ORIGIN_SHIFT - y * tile_width
    min_y = max_y - tile_width
    return min_x, min_y, max_x, max_y


def colourize_elevation(data: np.ndarray) -> np.ndarray:
    rgba = np.zeros((data.shape[0], data.shape[1], 4), dtype=np.uint8)
    valid = np.isfinite(data) & (data > -500.0)
    if not np.any(valid):
        return rgba

    values = data[valid]
    elev = np.array([s[0] for s in COLOR_STOPS], dtype=np.float32)
    rvals = np.array([s[1][0] for s in COLOR_STOPS], dtype=np.float32)
    gvals = np.array([s[1][1] for s in COLOR_STOPS], dtype=np.float32)
    bvals = np.array([s[1][2] for s in COLOR_STOPS], dtype=np.float32)

    rgba[..., 0][valid] = np.interp(values, elev, rvals).astype(np.uint8)
    rgba[..., 1][valid] = np.interp(values, elev, gvals).astype(np.uint8)
    rgba[..., 2][valid] = np.interp(values, elev, bvals).astype(np.uint8)
    rgba[..., 3][valid] = 255
    return rgba


def load_land_mask_geometries(mask_path: Path, src_crs: str = "EPSG:4326", dst_crs: str = WEBMERC) -> list[dict]:
    if not mask_path.exists():
        raise FileNotFoundError(f"Land mask file not found: {mask_path}")

    df = pyogrio.read_dataframe(mask_path, columns=[])
    if df.empty:
        raise RuntimeError(f"Land mask contains no features: {mask_path}")

    geoms: list[dict] = []
    for geom in df.geometry:
        if geom is None or geom.is_empty:
            continue
        geoms.append(transform_geom(src_crs=src_crs, dst_crs=dst_crs, geom=geom.__geo_interface__))

    if not geoms:
        raise RuntimeError(f"Land mask contains no valid geometries: {mask_path}")

    return geoms


def build_mosaic(tile_dir: Path, output_tif: Path, bounds: tuple[float, float, float, float]) -> None:
    sources = sorted(tile_dir.glob("*.tif"))
    if not sources:
        raise FileNotFoundError(f"No GeoTIFF files found in {tile_dir}")

    datasets = [rasterio.open(src) for src in sources]
    try:
        mosaic, out_transform = merge(datasets, bounds=bounds, nodata=np.nan)
        profile = datasets[0].profile.copy()
        profile.update(
            driver="GTiff",
            height=mosaic.shape[1],
            width=mosaic.shape[2],
            transform=out_transform,
            count=1,
            dtype=str(mosaic.dtype),
            compress="DEFLATE",
            predictor=2,
            tiled=True,
            bigtiff="IF_SAFER",
            nodata=np.nan,
        )
        output_tif.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(output_tif, "w", **profile) as dst:
            dst.write(mosaic[0], 1)
    finally:
        for ds in datasets:
            ds.close()


def generate_tiles(
    src_tif: Path,
    out_dir: Path,
    min_zoom: int,
    max_zoom: int,
    bounds_lonlat: tuple[float, float, float, float],
    land_mask_geometries: list[dict] | None = None,
    skip_empty: bool = True,
) -> dict:
    if not src_tif.exists():
        raise FileNotFoundError(f"Source DEM not found: {src_tif}")

    west, south, east, north = bounds_lonlat
    metadata = {"source": str(src_tif), "minZoom": min_zoom, "maxZoom": max_zoom, "bounds": [west, south, east, north]}

    tile_count = 0
    skipped_count = 0

    with rasterio.open(src_tif) as src:
        src_nodata = src.nodata
        for z in range(min_zoom, max_zoom + 1):
            min_x, max_y = lonlat_to_tile(west, north, z)
            max_x, min_y = lonlat_to_tile(east, south, z)

            for x in range(min_x, max_x + 1):
                x_dir = out_dir / str(z) / str(x)
                x_dir.mkdir(parents=True, exist_ok=True)

                for y in range(max_y, min_y + 1):
                    minx, miny, maxx, maxy = tile_bounds_webmerc(z, x, y)
                    dst_transform = from_bounds(minx, miny, maxx, maxy, TILE_SIZE, TILE_SIZE)
                    dem_tile = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)

                    reproject(
                        source=rasterio.band(src, 1),
                        destination=dem_tile,
                        src_transform=src.transform,
                        src_crs=src.crs,
                        src_nodata=src_nodata,
                        dst_transform=dst_transform,
                        dst_crs=WEBMERC,
                        dst_nodata=np.nan,
                        # DEM is continuous data; nearest-neighbour introduces visible striping/banding.
                        resampling=Resampling.bilinear,
                    )

                    rgba = colourize_elevation(dem_tile)
                    if land_mask_geometries:
                        land_mask = rasterize(
                            ((geom, 1) for geom in land_mask_geometries),
                            out_shape=(TILE_SIZE, TILE_SIZE),
                            transform=dst_transform,
                            fill=0,
                            dtype=np.uint8,
                            all_touched=True,
                        )
                        rgba[..., 3] = np.where(land_mask == 1, rgba[..., 3], 0).astype(np.uint8)
                    has_data = np.any(rgba[..., 3] > 0)
                    if skip_empty and not has_data:
                        skipped_count += 1
                        continue

                    tile_path = x_dir / f"{y}.webp"
                    Image.fromarray(rgba, mode="RGBA").save(
                        tile_path,
                        format="WEBP",
                        lossless=True,
                        quality=100,
                        method=6,
                    )
                    tile_count += 1

    metadata["tilesWritten"] = tile_count
    metadata["tilesSkippedEmpty"] = skipped_count
    metadata["ramp"] = [{"elev_m": e, "rgb": list(rgb)} for (e, rgb) in COLOR_STOPS]
    return metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build static Copernicus DEM WebP XYZ tiles for Ireland.")
    parser.add_argument("--src", default="data/maps/physical/copernicus-dem-30m-ireland.tif", help="Path to source DEM mosaic GeoTIFF.")
    parser.add_argument("--tile-dir", default="data/maps/physical/copernicus-dem-30m-ireland-tiles", help="Output XYZ tile directory.")
    parser.add_argument("--min-zoom", type=int, default=5, help="Minimum zoom level.")
    parser.add_argument("--max-zoom", type=int, default=12, help="Maximum zoom level.")
    parser.add_argument(
        "--bounds",
        type=float,
        nargs=4,
        default=[-10.9, 51.2, -5.2, 55.7],
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        help="Bounds in lon/lat for tile generation.",
    )
    parser.add_argument("--mosaic-from-dir", default="", help="Optional folder with Copernicus 1x1 degree GeoTIFF tiles.")
    parser.add_argument(
        "--land-mask",
        default="data/maps/physical/Ireland.fgb",
        help="Polygon dataset used to mask DEM to land only (default: Island of Ireland FGB).",
    )
    parser.add_argument(
        "--no-land-mask",
        action="store_true",
        help="Disable land masking and render all DEM pixels within tile bounds.",
    )
    parser.add_argument(
        "--include-empty-tiles",
        action="store_true",
        help="Write fully transparent tiles instead of skipping empty tiles.",
    )
    parser.add_argument("--force", action="store_true", help="Regenerate tiles even if output directory already exists.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    src_tif = Path(args.src)
    out_dir = Path(args.tile_dir)
    bounds = tuple(args.bounds)
    mask_geometries = None

    if args.mosaic_from_dir:
        tile_dir = Path(args.mosaic_from_dir)
        print(f"[DEM Tiles] Building mosaic from {tile_dir} -> {src_tif}")
        build_mosaic(tile_dir, src_tif, bounds)

    if out_dir.exists() and not args.force:
        existing = list(out_dir.glob("*"))
        if existing:
            raise RuntimeError(f"Output directory is not empty: {out_dir}. Use --force after clearing it.")

    if not args.no_land_mask:
        mask_path = Path(args.land_mask)
        print(f"[DEM Tiles] Loading land mask geometries from {mask_path}")
        mask_geometries = load_land_mask_geometries(mask_path)

    print(f"[DEM Tiles] Generating tiles from {src_tif} into {out_dir}")
    metadata = generate_tiles(
        src_tif=src_tif,
        out_dir=out_dir,
        min_zoom=args.min_zoom,
        max_zoom=args.max_zoom,
        bounds_lonlat=bounds,
        land_mask_geometries=mask_geometries,
        skip_empty=not args.include_empty_tiles,
    )

    metadata_path = out_dir / "metadata.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"[DEM Tiles] Done. Wrote {metadata['tilesWritten']} tiles and metadata: {metadata_path}")


if __name__ == "__main__":
    main()
