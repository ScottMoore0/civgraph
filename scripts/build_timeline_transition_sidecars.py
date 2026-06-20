from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import geopandas as gpd
from pyproj import Transformer
from shapely import set_precision
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping
from shapely.ops import transform
from shapely.strtree import STRtree
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "timeline-transitions"
MIN_AREA_M2 = 100.0
PRECISION_GRID_M = 0.01
TO_WGS84 = Transformer.from_crs("EPSG:2157", "EPSG:4326", always_xy=True)

NAME_KEYS = ["WARDNAME", "WARD_NAME", "WardName", "wardname", "Ward_Name", "NAME", "Name", "name", "WARD", "Ward"]
ID_KEYS = ["WARD93_ID", "WardCode", "WARD_CODE", "OBJECTID", "FID", "ID", "WARD_ID", "Ward_ID", "ward_id", "REF", "Code", "CODE"]


@dataclass(frozen=True)
class TransitionConfig:
    from_id: str
    to_id: str
    from_source: str
    to_source: str
    from_label: str
    to_label: str


DEFAULT_TRANSITIONS = [
    TransitionConfig(
        from_id="wards-1993",
        to_id="wards-2012",
        from_source="test/source-cache/vector-intake/wards-1993.fgb",
        to_source="test/source-cache/vector-intake/wards-2012.fgb",
        from_label="Wards 1993",
        to_label="Wards 2012",
    )
]


def polygonal_only(geom):
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    if isinstance(geom, GeometryCollection):
        polygons = []
        for part in geom.geoms:
            sub = polygonal_only(part)
            if sub is None or sub.is_empty:
                continue
            if isinstance(sub, Polygon):
                polygons.append(sub)
            elif isinstance(sub, MultiPolygon):
                polygons.extend(list(sub.geoms))
        if not polygons:
            return None
        return MultiPolygon(polygons) if len(polygons) > 1 else polygons[0]
    return None


def polygon_parts(geom) -> list[Polygon]:
    geom = polygonal_only(geom)
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return [part for part in geom.geoms if part.area > 0]
    return []


def clean_geom(geom):
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = make_valid(geom)
    geom = polygonal_only(geom)
    if geom is None or geom.is_empty:
        return None
    geom = set_precision(geom, PRECISION_GRID_M)
    if not geom.is_valid:
        geom = make_valid(geom)
    geom = polygonal_only(geom)
    if geom is None or geom.is_empty or geom.area <= 0:
        return None
    return geom


def prop_value(props: dict, keys: Iterable[str], fallback: str) -> str:
    for key in keys:
        value = props.get(key)
        if value not in (None, ""):
            if isinstance(value, float) and math.isnan(value):
                continue
            return str(value)
    return fallback


def jsonable_props(props: dict) -> dict:
    out = {}
    for key, value in props.items():
        if key == "geometry":
            continue
        if hasattr(value, "item"):
            value = value.item()
        if isinstance(value, float) and math.isnan(value):
            value = None
        out[str(key)] = value
    return out


def rounded_mapping(geom, decimals: int = 6) -> dict:
    def round_value(value):
        return round(float(value), decimals)

    def round_coords(coords):
        if not coords:
            return coords
        first = coords[0]
        if isinstance(first, (float, int)):
            return [round_value(value) for value in coords]
        return [round_coords(part) for part in coords]

    mapped = mapping(geom)
    if "coordinates" in mapped:
        mapped["coordinates"] = round_coords(mapped["coordinates"])
    return mapped


def load_records(path: Path, label: str) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(path)
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    gdf = gdf.to_crs(2157)
    records = []
    for source_index, row in enumerate(gdf.itertuples(index=False), start=1):
        props = row._asdict()
        geom = clean_geom(props.pop("geometry", None))
        if geom is None:
            continue
        props = jsonable_props(props)
        records.append(
            {
                "index": len(records),
                "sourceIndex": source_index,
                "id": prop_value(props, ID_KEYS, f"{label}-{source_index}"),
                "name": prop_value(props, NAME_KEYS, f"{label} feature {source_index}"),
                "properties": props,
                "geometry": geom,
                "area_m2": float(geom.area),
            }
        )
    return records


def build_transition(config: TransitionConfig, min_area_m2: float = MIN_AREA_M2, simplify_metres: float = 0.0, coordinate_decimals: int = 6) -> dict:
    from_records = load_records(ROOT / config.from_source, config.from_label)
    to_records = load_records(ROOT / config.to_source, config.to_label)
    to_geoms = [record["geometry"] for record in to_records]
    tree = STRtree(to_geoms)
    pieces = []
    pair_totals: dict[tuple[int, int], float] = {}

    for old in from_records:
        for to_index in tree.query(old["geometry"], predicate="intersects"):
            new = to_records[int(to_index)]
            inter = polygonal_only(old["geometry"].intersection(new["geometry"]))
            if inter is None or inter.is_empty:
                continue
            parts = polygon_parts(inter)
            if not parts:
                continue
            pair_key = (old["index"], new["index"])
            pair_total = sum(float(part.area) for part in parts if part.area > 0)
            if pair_total <= 0:
                continue
            pair_totals[pair_key] = pair_totals.get(pair_key, 0.0) + pair_total
            for part_no, part in enumerate(parts, start=1):
                area = float(part.area)
                if area < min_area_m2:
                    continue
                pieces.append({
                    "old": old,
                    "new": new,
                    "partNo": part_no,
                    "geometry": part,
                    "area_m2": area,
                    "pairKey": pair_key,
                })

    max_for_old: dict[int, tuple[int, float]] = {}
    max_for_new: dict[int, tuple[int, float]] = {}
    significant_target_count: dict[int, int] = {}
    for (old_index, new_index), area in pair_totals.items():
        if area >= min_area_m2:
            significant_target_count[old_index] = significant_target_count.get(old_index, 0) + 1
        if area > max_for_old.get(old_index, (-1, -1.0))[1]:
            max_for_old[old_index] = (new_index, area)
        if area > max_for_new.get(new_index, (-1, -1.0))[1]:
            max_for_new[new_index] = (old_index, area)

    features = []
    for piece_number, piece in enumerate(pieces, start=1):
        old = piece["old"]
        new = piece["new"]
        old_index, new_index = piece["pairKey"]
        is_old_primary_target = max_for_old.get(old_index, (None,))[0] == new_index
        is_new_primary_source = max_for_new.get(new_index, (None,))[0] == old_index
        if is_old_primary_target and is_new_primary_source:
            continue
        transition_type = "split" if significant_target_count.get(old_index, 0) > 1 and not is_old_primary_target else "transfer"
        geom = piece["geometry"]
        if simplify_metres > 0:
            geom = geom.simplify(simplify_metres, preserve_topology=True)
        geom_wgs84 = transform(TO_WGS84.transform, geom)
        from_name = old["name"]
        to_name = new["name"]
        transition_id = f"{config.from_id}__{config.to_id}__{piece_number}"
        features.append({
            "type": "Feature",
            "id": transition_id,
            "properties": {
                "transitionId": transition_id,
                "transitionType": transition_type,
                "fromMapId": config.from_id,
                "toMapId": config.to_id,
                "fromMapName": config.from_label,
                "toMapName": config.to_label,
                "fromFeatureId": old["id"],
                "toFeatureId": new["id"],
                "fromFeatureName": from_name,
                "toFeatureName": to_name,
                "name": f"{from_name} to {to_name}",
                "area_m2": piece["area_m2"],
                "area_km2": piece["area_m2"] / 1_000_000.0,
                "fromFeatureAreaM2": old["area_m2"],
                "toFeatureAreaM2": new["area_m2"],
                "fromFeatureSharePct": piece["area_m2"] / old["area_m2"] * 100 if old["area_m2"] else None,
                "toFeatureSharePct": piece["area_m2"] / new["area_m2"] * 100 if new["area_m2"] else None,
                "fromProperties": old["properties"],
                "toProperties": new["properties"],
            },
            "geometry": rounded_mapping(geom_wgs84, coordinate_decimals),
        })

    return {
        "type": "FeatureCollection",
        "name": f"Territorial changes: {config.from_label} to {config.to_label}",
        "metadata": {
            "fromMapId": config.from_id,
            "toMapId": config.to_id,
            "fromSource": config.from_source,
            "toSource": config.to_source,
            "minimumAreaM2": min_area_m2,
            "coordinateDecimals": coordinate_decimals,
            "transitionPieceRule": "non-mutual-primary intersections at or above the minimum area threshold",
            "transitionTypes": {
                "transfer": "non-primary overlap where the earlier feature keeps a primary successor",
                "split": "non-primary overlap where the earlier feature has multiple significant successors"
            },
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Civgraph timeline territorial transition sidecars.")
    parser.add_argument("--min-area-m2", type=float, default=MIN_AREA_M2)
    parser.add_argument("--simplify-metres", type=float, default=0.0)
    parser.add_argument("--coordinate-decimals", type=int, default=6)
    args = parser.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    summary = []
    for config in DEFAULT_TRANSITIONS:
        sidecar = build_transition(config, min_area_m2=args.min_area_m2, simplify_metres=args.simplify_metres, coordinate_decimals=args.coordinate_decimals)
        out_path = OUT_DIR / f"{config.from_id}__{config.to_id}.geojson"
        out_path.write_text(json.dumps(sidecar, separators=(",", ":")), encoding="utf-8")
        summary.append({
            "path": str(out_path.relative_to(ROOT)),
            "features": len(sidecar["features"]),
            "bytes": out_path.stat().st_size,
            "minAreaM2": args.min_area_m2,
        })
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
