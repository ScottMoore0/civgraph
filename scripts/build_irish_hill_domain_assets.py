#!/usr/bin/env python
"""Generate Irish hill/mountain domain polygon source assets.

The output layers are modelling aids, not official mountain boundaries:

* summit-domain polygons are land-clipped nearest-summit Voronoi cells.
* prominence-domain polygons are land-clipped, DEM-informed weighted domains
  where cells are assigned to nearby eligible summits using DoBIH prominence
  (drop) and col-height metadata.

Both layers are generated from local, reproducible inputs so the MapLibre
PMTiles can be rebuilt without hand-editing geometry.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize, shapes
from rasterio.merge import merge
from scipy.spatial import Voronoi, cKDTree
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "tmp" / "dobih" / "source" / "hillcsv" / "DoBIH_v18_4.csv"
LAND_MASK_PATH = (
    ROOT / "data" / "maps" / "physical" / "Ireland-lod1.fgb"
    if (ROOT / "data" / "maps" / "physical" / "Ireland-lod1.fgb").exists()
    else ROOT / "data" / "maps" / "physical" / "Ireland.fgb"
)
DEM_TILE_DIR = ROOT / "data" / "maps" / "physical" / "dem_tiles"
OUTPUT_DIR = ROOT / "tmp" / "dobih" / "domain-polygons"
VECTOR_INTAKE_DIR = ROOT / "test" / "source-cache" / "vector-intake"

SUMMIT_ID = "irish-hill-summit-domains"
PROMINENCE_ID = "irish-hill-prominence-domains"
DATASET_DATE = "2026-06-24"
MODEL_VERSION = "1"
WGS84 = "EPSG:4326"
IRISH_GRID = "EPSG:2157"


CLASSIFICATION_NAMES = {
    "A": "Arderin",
    "VL": "Vandeleur-Lynam",
    "Ca": "Carn",
    "Bin": "Binnion",
    "Ma": "Marilyn",
    "Hu": "HuMP",
    "Sim": "Simm",
    "F": "Furth",
    "Hew": "Hewitt",
    "CoH": "County Top - historic",
    "CoU": "County Top - current county/unitary authority",
    "CoA": "County Top - administrative county",
    "CoL": "County Top - local government area",
    "CT": "County Top",
    "SIB": "Significant Island of Britain and Ireland",
}


@dataclass
class DomainOutput:
    id: str
    name: str
    kind: str
    description: str
    geojson_path: Path
    fgb_path: Path
    intake_path: Path
    feature_index_path: Path
    feature_count: int
    bounds: list[list[float]]
    bytes: int
    method: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--grid-resolution",
        type=float,
        default=0.0035,
        help="Prominence-domain raster grid size in degrees before polygonization.",
    )
    parser.add_argument(
        "--candidate-count",
        type=int,
        default=48,
        help="Nearest summit candidates checked for each DEM grid cell.",
    )
    parser.add_argument(
        "--simplify-metres",
        type=float,
        default=75.0,
        help="Topology-preserving simplification tolerance for generated polygons.",
    )
    parser.add_argument("--skip-prominence", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    VECTOR_INTAKE_DIR.mkdir(parents=True, exist_ok=True)

    assert_inputs()
    land = read_land_mask()
    hills = read_irish_hills()

    outputs: list[DomainOutput] = []
    print("Building summit-domain polygons...", flush=True)
    outputs.append(build_summit_domains(hills, land, args.simplify_metres))
    if not args.skip_prominence:
        print("Building prominence-domain polygons...", flush=True)
        outputs.append(
            build_prominence_domains(
                hills,
                land,
                grid_resolution=args.grid_resolution,
                candidate_count=args.candidate_count,
                simplify_metres=args.simplify_metres,
            )
        )

    report = {
        "schemaVersion": 1,
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "datasetDate": DATASET_DATE,
        "modelVersion": MODEL_VERSION,
        "inputs": {
            "dobihCsv": rel(CSV_PATH),
            "landMask": rel(LAND_MASK_PATH),
            "demTileDir": rel(DEM_TILE_DIR),
            "irishHillCount": len(hills),
        },
        "parameters": {
            "gridResolutionDegrees": args.grid_resolution,
            "candidateCount": args.candidate_count,
            "simplifyMetres": args.simplify_metres,
        },
        "outputs": [output.__dict__ | {
            "geojson_path": rel(output.geojson_path),
            "fgb_path": rel(output.fgb_path),
            "intake_path": rel(output.intake_path),
            "feature_index_path": rel(output.feature_index_path),
        } for output in outputs],
        "caveats": [
            "These are modelled hill-domain polygons, not official hill or mountain boundaries.",
            "Summit domains use nearest-summit Voronoi partitioning clipped to the Ireland land mask.",
            "Prominence domains use DoBIH drop/col metadata and sampled Copernicus GLO-30 DEM cells; they are suitable for visual exploration, not legal/topographic boundary claims.",
        ],
    }
    write_json(OUTPUT_DIR / "irish-hill-domain-build-report.json", report)
    print(json.dumps({
        "status": "ok",
        "outputs": [{
            "id": output.id,
            "features": output.feature_count,
            "bounds": output.bounds,
            "bytes": output.bytes,
        } for output in outputs],
    }, indent=2))


def assert_inputs() -> None:
    missing = [path for path in [CSV_PATH, LAND_MASK_PATH, DEM_TILE_DIR] if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing required inputs: " + ", ".join(str(path) for path in missing))
    if not any(DEM_TILE_DIR.glob("*.tif")):
        raise FileNotFoundError(f"No DEM .tif tiles found under {DEM_TILE_DIR}")


def read_land_mask() -> gpd.GeoDataFrame:
    land = gpd.read_file(LAND_MASK_PATH)
    if land.crs is None:
        land = land.set_crs(WGS84)
    land = land.to_crs(WGS84)
    geometry = unary_union([geom for geom in land.geometry if geom is not None and not geom.is_empty])
    return gpd.GeoDataFrame({"name": ["Ireland land mask"]}, geometry=[geometry], crs=WGS84)


def read_irish_hills() -> gpd.GeoDataFrame:
    df = pd.read_csv(CSV_PATH, dtype=str, keep_default_na=False)
    df = df[df["Country"].isin(["I", "NI"])].copy()
    for column in ["Latitude", "Longitude", "Metres", "Feet", "Drop", "Col height"]:
        df[column] = pd.to_numeric(df[column], errors="coerce")
    df = df.dropna(subset=["Latitude", "Longitude", "Metres", "Drop", "Col height"])
    df["CountryName"] = df["Country"].map({"I": "Ireland", "NI": "Northern Ireland"}).fillna(df["Country"])
    df["ClassificationNames"] = df["Classification"].map(classification_names)
    df["HillBagging"] = df["Hill-bagging"].map(lambda value: f"https://www.hill-bagging.co.uk/mountaindetails.php?qu=S&rf={value}" if value else "")
    df["Streetmap"] = df["Streetmap/MountainViews"]
    df["GoogleMaps"] = df["Google Maps"]
    geometry = gpd.points_from_xy(df["Longitude"], df["Latitude"], crs=WGS84)
    return gpd.GeoDataFrame(df, geometry=geometry, crs=WGS84)


def classification_names(value: str) -> str:
    codes = [part.strip() for part in str(value or "").split(",") if part.strip()]
    return "; ".join(CLASSIFICATION_NAMES.get(code, code) for code in codes)


def build_summit_domains(hills: gpd.GeoDataFrame, land: gpd.GeoDataFrame, simplify_metres: float) -> DomainOutput:
    projected_hills = hills.to_crs(IRISH_GRID)
    points = np.array([[geom.x, geom.y] for geom in projected_hills.geometry])
    regions, vertices = finite_voronoi_polygons(points)
    land_projected = land.to_crs(IRISH_GRID)
    land_geom = clean_projected_geometry(land_projected.geometry.iloc[0], max(150.0, simplify_metres))

    geometries = []
    indices = []
    for index, region in enumerate(regions):
        polygon = Polygon(vertices[region])
        clipped = polygon.intersection(land_geom)
        if clipped.is_empty:
            continue
        geometries.append(clean_projected_geometry(clipped, simplify_metres))
        indices.append(index)

    domains = projected_hills.iloc[indices].copy()
    domains = domains.drop(columns="geometry")
    domains["DomainType"] = "Summit domain"
    domains["DomainMethod"] = "Nearest-summit land-clipped Voronoi polygon"
    domains["DomainSource"] = "Database of British and Irish Hills v18.4; Civgraph Ireland land mask"
    gdf = gpd.GeoDataFrame(domains, geometry=geometries, crs=IRISH_GRID).to_crs(WGS84)
    gdf = append_missing_domain_fallbacks(
        gdf,
        hills,
        land,
        "Summit domain",
        "Nearest-summit land-clipped Voronoi polygon",
        "Database of British and Irish Hills v18.4; Civgraph Ireland land mask",
        max(150.0, simplify_metres * 2),
    )
    return write_domain_output(
        SUMMIT_ID,
        "Irish Hill Summit Domains",
        "summit",
        "Land-clipped nearest-summit domain polygons for Irish hills and mountains in DoBIH v18.4.",
        gdf,
        "Nearest-summit land-clipped Voronoi polygon",
    )


def build_prominence_domains(
    hills: gpd.GeoDataFrame,
    land: gpd.GeoDataFrame,
    grid_resolution: float,
    candidate_count: int,
    simplify_metres: float,
) -> DomainOutput:
    bounds = tuple(float(value) for value in land.total_bounds)
    dem_paths = sorted(DEM_TILE_DIR.glob("*.tif"))
    datasets = [rasterio.open(path) for path in dem_paths]
    try:
        mosaic, transform = merge(
            datasets,
            bounds=bounds,
            res=(grid_resolution, grid_resolution),
            nodata=np.nan,
        )
    finally:
        for dataset in datasets:
            dataset.close()

    elevation = mosaic[0].astype("float32")
    mask = rasterize(
        [(geom, 1) for geom in land.geometry],
        out_shape=elevation.shape,
        transform=transform,
        fill=0,
        dtype="uint8",
    ).astype(bool)
    valid = mask & np.isfinite(elevation)

    rows, cols = np.where(valid)
    xs, ys = rasterio.transform.xy(transform, rows, cols, offset="center")
    lons = np.asarray(xs, dtype="float64")
    lats = np.asarray(ys, dtype="float64")

    transformer = Transformer.from_crs(WGS84, IRISH_GRID, always_xy=True)
    cell_x, cell_y = transformer.transform(lons, lats)
    coords = np.column_stack([cell_x, cell_y])
    hill_projected = hills.to_crs(IRISH_GRID)
    hill_coords = np.array([[geom.x, geom.y] for geom in hill_projected.geometry])
    tree = cKDTree(hill_coords)

    k = max(1, min(candidate_count, len(hill_projected)))
    distances, indices = tree.query(coords, k=k, workers=-1)
    if k == 1:
        distances = distances[:, None]
        indices = indices[:, None]

    drops = hills["Drop"].to_numpy(dtype="float64")
    col_heights = hills["Col height"].to_numpy(dtype="float64")
    cell_elevations = elevation[rows, cols].astype("float64")
    labels = choose_prominence_labels(distances, indices, cell_elevations, drops, col_heights)

    label_raster = np.zeros(elevation.shape, dtype="int32")
    label_raster[rows, cols] = labels + 1
    anchor_unassigned_summits(label_raster, rows, cols, coords, hill_coords)

    polygon_rows = []
    for geom, value in shapes(label_raster, mask=label_raster > 0, transform=transform):
        label = int(value) - 1
        polygon_rows.append((label, shape(geom)))

    raw = gpd.GeoDataFrame(
        {"summit_index": [row[0] for row in polygon_rows]},
        geometry=[row[1] for row in polygon_rows],
        crs=WGS84,
    )
    dissolved = raw.dissolve(by="summit_index", as_index=False)
    dissolved = gpd.overlay(dissolved, land, how="intersection", keep_geom_type=True)
    projected = dissolved.to_crs(IRISH_GRID)
    projected["geometry"] = projected.geometry.map(lambda geom: clean_projected_geometry(geom, simplify_metres))
    dissolved = projected.to_crs(WGS84)

    attrs = hills.reset_index(drop=True).drop(columns="geometry").copy()
    attrs["summit_index"] = attrs.index
    attrs["DomainType"] = "Prominence domain"
    attrs["DomainMethod"] = "DEM-informed prominence-weighted raster partition"
    attrs["DomainSource"] = "Database of British and Irish Hills v18.4; Copernicus GLO-30 DEM; Civgraph Ireland land mask"
    gdf = dissolved.merge(attrs, on="summit_index", how="left")
    gdf = gpd.GeoDataFrame(gdf, geometry="geometry", crs=WGS84)
    gdf = append_missing_domain_fallbacks(
        gdf,
        hills,
        land,
        "Prominence domain",
        "DEM-informed prominence-weighted raster partition",
        "Database of British and Irish Hills v18.4; Copernicus GLO-30 DEM; Civgraph Ireland land mask",
        max(150.0, simplify_metres * 2),
    )
    return write_domain_output(
        PROMINENCE_ID,
        "Irish Hill Prominence Domains",
        "prominence",
        "Modelled prominence-weighted domain polygons for Irish hills and mountains in DoBIH v18.4.",
        gdf,
        "DEM-informed prominence-weighted raster partition",
    )


def choose_prominence_labels(
    distances: np.ndarray,
    indices: np.ndarray,
    elevations: np.ndarray,
    drops: np.ndarray,
    col_heights: np.ndarray,
) -> np.ndarray:
    weights = np.sqrt(np.maximum(drops[indices], 1.0))
    scores = distances / weights
    eligible = col_heights[indices] <= elevations[:, None]
    scores = np.where(eligible, scores, np.inf)
    best = np.argmin(scores, axis=1)
    no_eligible = ~np.isfinite(scores[np.arange(scores.shape[0]), best])
    chosen = indices[np.arange(indices.shape[0]), best]
    chosen[no_eligible] = indices[no_eligible, 0]
    return chosen.astype("int32")


def anchor_unassigned_summits(
    label_raster: np.ndarray,
    valid_rows: np.ndarray,
    valid_cols: np.ndarray,
    valid_coords: np.ndarray,
    hill_coords: np.ndarray,
) -> None:
    """Ensure every source summit has at least one visible prominence cell.

    A multiplicative prominence-weighted partition can legitimately swallow
    very low-prominence summits near dominant neighbours. For Civgraph browse
    and feature-selection parity, every source hill still needs a rendered
    feature. We therefore reserve the nearest valid DEM/land cell for any
    missing summit after the main model assignment.
    """

    present = set(int(value) - 1 for value in np.unique(label_raster) if value > 0)
    missing = [index for index in range(len(hill_coords)) if index not in present]
    if not missing:
        return
    tree = cKDTree(valid_coords)
    k = min(24, len(valid_coords))
    _, nearest = tree.query(hill_coords[missing], k=k, workers=-1)
    if k == 1:
        nearest = nearest[:, None]
    used_cells = set(zip(*np.where(label_raster > 0)))
    for missing_index, candidates in zip(missing, nearest):
        chosen_cell = None
        for candidate in np.atleast_1d(candidates):
            cell = (int(valid_rows[candidate]), int(valid_cols[candidate]))
            if cell not in used_cells:
                chosen_cell = cell
                break
        if chosen_cell is None:
            candidate = int(np.atleast_1d(candidates)[0])
            chosen_cell = (int(valid_rows[candidate]), int(valid_cols[candidate]))
        label_raster[chosen_cell] = int(missing_index) + 1
        used_cells.add(chosen_cell)


def finite_voronoi_polygons(points: np.ndarray, radius: float | None = None) -> tuple[list[list[int]], np.ndarray]:
    if points.shape[1] != 2:
        raise ValueError("Voronoi input must be two-dimensional")
    vor = Voronoi(points)
    if radius is None:
        radius = np.ptp(points, axis=0).max() * 2
    new_regions: list[list[int]] = []
    new_vertices = vor.vertices.tolist()
    center = points.mean(axis=0)
    all_ridges: dict[int, list[tuple[int, int, int]]] = {}
    for (p1, p2), (v1, v2) in zip(vor.ridge_points, vor.ridge_vertices):
        all_ridges.setdefault(p1, []).append((p2, v1, v2))
        all_ridges.setdefault(p2, []).append((p1, v1, v2))

    for p1, region_index in enumerate(vor.point_region):
        vertices = vor.regions[region_index]
        if all(v >= 0 for v in vertices):
            new_regions.append(vertices)
            continue

        ridges = all_ridges[p1]
        new_region = [v for v in vertices if v >= 0]
        for p2, v1, v2 in ridges:
            if v2 < 0:
                v1, v2 = v2, v1
            if v1 >= 0:
                continue
            tangent = points[p2] - points[p1]
            tangent /= np.linalg.norm(tangent)
            normal = np.array([-tangent[1], tangent[0]])
            midpoint = points[[p1, p2]].mean(axis=0)
            direction = np.sign(np.dot(midpoint - center, normal)) * normal
            far_point = vor.vertices[v2] + direction * radius
            new_region.append(len(new_vertices))
            new_vertices.append(far_point.tolist())

        vs = np.asarray([new_vertices[v] for v in new_region])
        centroid = vs.mean(axis=0)
        angles = np.arctan2(vs[:, 1] - centroid[1], vs[:, 0] - centroid[0])
        new_regions.append([v for _, v in sorted(zip(angles, new_region))])
    return new_regions, np.asarray(new_vertices)


def clean_projected_geometry(geom, simplify_metres: float):
    if simplify_metres > 0:
        geom = geom.simplify(simplify_metres, preserve_topology=True)
    geom = geom.buffer(0)
    if isinstance(geom, Polygon):
        return geom
    if isinstance(geom, MultiPolygon):
        return geom
    return geom


def append_missing_domain_fallbacks(
    gdf: gpd.GeoDataFrame,
    hills: gpd.GeoDataFrame,
    land: gpd.GeoDataFrame,
    domain_type: str,
    domain_method: str,
    domain_source: str,
    radius_metres: float,
) -> gpd.GeoDataFrame:
    existing_numbers = set(gdf["Number"].astype(str)) if "Number" in gdf.columns else set()
    missing = hills[~hills["Number"].astype(str).isin(existing_numbers)].copy()
    if missing.empty:
        return gdf

    missing_projected = missing.to_crs(IRISH_GRID)
    land_projected = land.to_crs(IRISH_GRID)
    land_geom = land_projected.geometry.iloc[0]
    records = []
    geometries = []
    for index, row in missing_projected.iterrows():
        buffered = row.geometry.buffer(radius_metres)
        clipped = buffered.intersection(land_geom)
        geom = clipped if not clipped.is_empty else buffered
        geom = clean_projected_geometry(geom, 0)
        if geom.is_empty:
            continue
        record = missing.loc[index].drop(labels="geometry").to_dict()
        record["DomainType"] = domain_type
        record["DomainMethod"] = f"{domain_method} (point-buffer fallback)"
        record["DomainSource"] = domain_source
        records.append(record)
        geometries.append(geom)

    if not records:
        return gdf

    fallback = gpd.GeoDataFrame(records, geometry=geometries, crs=IRISH_GRID).to_crs(WGS84)
    combined = pd.concat([gdf, fallback], ignore_index=True)
    return gpd.GeoDataFrame(combined, geometry="geometry", crs=WGS84)


def write_domain_output(
    layer_id: str,
    name: str,
    kind: str,
    description: str,
    gdf: gpd.GeoDataFrame,
    method: str,
) -> DomainOutput:
    columns = [
        "Number",
        "Name",
        "Parent (SMC)",
        "Parent name (SMC)",
        "Section",
        "Region",
        "Area",
        "Island",
        "Topo Section",
        "County",
        "Classification",
        "ClassificationNames",
        "Metres",
        "Feet",
        "Drop",
        "Col grid ref",
        "Col height",
        "Feature",
        "Observations",
        "Survey",
        "Country",
        "CountryName",
        "County Top",
        "Revision",
        "Comments",
        "Latitude",
        "Longitude",
        "Grid ref",
        "Grid ref 10",
        "HillBagging",
        "Streetmap",
        "GoogleMaps",
        "DomainType",
        "DomainMethod",
        "DomainSource",
        "geometry",
    ]
    for column in columns:
        if column != "geometry" and column not in gdf.columns:
            gdf[column] = ""
    gdf = gdf[columns].copy()
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    gdf["Number"] = gdf["Number"].astype(str)
    gdf["DomainId"] = layer_id + "-" + gdf["Number"]
    gdf = gdf[["DomainId", *columns[:-1], "geometry"]]

    geojson_path = OUTPUT_DIR / f"{layer_id}.geojson"
    fgb_path = OUTPUT_DIR / f"{layer_id}.fgb"
    intake_path = VECTOR_INTAKE_DIR / f"{layer_id}.fgb"
    feature_index_path = OUTPUT_DIR / f"{layer_id}.feature-index.json"

    remove_if_exists(geojson_path)
    remove_if_exists(fgb_path)
    remove_if_exists(intake_path)
    gdf.to_file(geojson_path, driver="GeoJSON")
    pyogrio.write_dataframe(gdf, fgb_path, driver="FlatGeobuf")
    shutil.copy2(fgb_path, intake_path)

    bounds = to_civgraph_bounds(gdf.total_bounds)
    feature_index = {
        "layerId": f"{layer_id}-vector-test",
        "itemLimit": len(gdf),
        "totalItems": len(gdf),
        "truncated": False,
        "items": [
            {
                "id": row["DomainId"],
                "name": row["Name"],
                "aliases": [
                    value
                    for value in [
                        row["Name"],
                        row.get("ClassificationNames"),
                        row.get("County"),
                        row.get("CountryName"),
                        row.get("Grid ref"),
                        row.get("Grid ref 10"),
                        row.get("DomainType"),
                    ]
                    if value
                ],
                "center": [float(row.geometry.representative_point().x), float(row.geometry.representative_point().y)],
            }
            for _, row in gdf.iterrows()
        ],
    }
    write_json(feature_index_path, feature_index)

    return DomainOutput(
        id=layer_id,
        name=name,
        kind=kind,
        description=description,
        geojson_path=geojson_path,
        fgb_path=fgb_path,
        intake_path=intake_path,
        feature_index_path=feature_index_path,
        feature_count=len(gdf),
        bounds=bounds,
        bytes=fgb_path.stat().st_size,
        method=method,
    )


def to_civgraph_bounds(bounds: np.ndarray) -> list[list[float]]:
    minx, miny, maxx, maxy = [round(float(value), 6) for value in bounds]
    return [[miny, minx], [maxy, maxx]]


def remove_if_exists(path: Path) -> None:
    if path.exists():
        path.unlink()


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


if __name__ == "__main__":
    main()
