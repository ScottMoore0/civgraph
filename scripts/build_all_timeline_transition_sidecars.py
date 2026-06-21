from __future__ import annotations

import argparse
import json
import re
from urllib.parse import unquote, urlparse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from build_timeline_transition_sidecars import (
    DEFAULT_TRANSITIONS,
    ID_KEYS,
    MIN_AREA_M2,
    NAME_KEYS,
    OUT_DIR,
    ROOT,
    TransitionConfig,
    build_transition_from_sources,
)

MAPS_DB_PATH = ROOT / "data" / "database" / "maps.json"
SOURCE_DIR = ROOT / "test" / "source-cache" / "vector-intake"

EXTRA_NAME_KEYS = [
    "DEAName", "DEA_NAME", "LGDNAME", "LGD_NAME", "COUNCIL",
    "CONSTITUENCY", "Constituency", "CONST_NAME", "Dail Constituency",
    "COUNTY", "COUNTYNAME", "CountyName", "COUNTY_NAME",
    "PROVINCE", "Province", "EDNAME", "DED", "DED_NAME", "ED_NAME",
    "Settlement", "SETTLEMENT", "LABEL", "Label", "title", "Title",
]
EXTRA_ID_KEYS = [
    "DEA_CODE", "DEACode", "LGDCode", "LGD_CODE", "GEOGID", "GEOG_ID",
    "REF_ID", "CONST_ID", "COUNTY_ID", "ED_ID",
]

for key in EXTRA_NAME_KEYS:
    if key not in NAME_KEYS:
        NAME_KEYS.append(key)
for key in EXTRA_ID_KEYS:
    if key not in ID_KEYS:
        ID_KEYS.append(key)


@dataclass(frozen=True)
class DiscoveredTransition:
    config: TransitionConfig
    from_sources: tuple[str, ...]
    to_sources: tuple[str, ...]
    chain_id: str
    class_id: str
    source: str


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def parse_map_date(date_value) -> int | None:
    if not date_value:
        return None
    text = str(date_value).strip()
    if re.fullmatch(r"\d{4}", text):
        text = f"{text}-01-01"
    try:
        return int(datetime.fromisoformat(text[:10]).replace(tzinfo=timezone.utc).timestamp())
    except ValueError:
        pass
    for fmt in ("%d %b %Y", "%d %B %Y", "%Y-%m-%d"):
        try:
            return int(datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            continue
    return None


def map_label(item: dict | None, fallback: str) -> str:
    if not item:
        return fallback
    for key in ("name", "title", "label", "shortName"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def is_placeholder(item: dict | None) -> bool:
    if not item:
        return True
    text = " ".join(str(item.get(key, "")) for key in ("status", "availability", "conversionStatus", "note", "description"))
    return bool(re.search(r"\b(to be added|placeholder|not yet converted)\b", text, flags=re.IGNORECASE))


def source_candidates(map_id: str, item: dict | None) -> list[str]:
    candidates = [map_id]
    if item:
        for key in ("sourceMapId", "sourceId", "canonicalMapId", "cloneOf", "aliasOf", "coLoadMapId", "parentId"):
            value = item.get(key)
            if isinstance(value, str) and value:
                candidates.append(value)
        for key in ("sourceMapIds", "aliases", "variantOf"):
            values = item.get(key)
            if isinstance(values, list):
                candidates.extend(str(value) for value in values if value)
    suffixes = ("-vector-test", "-standard", "-full", "-largescale", "-large-scale", "-50k", "-ungeneralised")
    for candidate in list(candidates):
        for suffix in suffixes:
            if candidate.endswith(suffix):
                candidates.append(candidate[: -len(suffix)])
    seen = set()
    ordered = []
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.add(candidate)
            ordered.append(candidate)
    return ordered


def local_fgb_path(value: str) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.startswith("http://") or text.startswith("https://"):
        parsed = urlparse(text)
        if parsed.netloc not in {"data.civgraph.net", "www.data.civgraph.net"}:
            return None
        path = ROOT / unquote(parsed.path.lstrip("/"))
    else:
        path = Path(unquote(text))
        if not path.is_absolute():
            path = ROOT / path
    return path if path.exists() and path.suffix.lower() == ".fgb" else None


def item_fgb_paths(item: dict | None) -> list[Path]:
    if not item:
        return []
    paths: list[Path] = []
    files = item.get("files")
    if isinstance(files, dict):
        path = local_fgb_path(files.get("fgb"))
        if path:
            paths.append(path)
    for key in ("fgb", "sourceFgb", "localFgb"):
        path = local_fgb_path(item.get(key))
        if path:
            paths.append(path)
    seen = set()
    ordered = []
    for path in paths:
        key = str(path.resolve()).casefold()
        if key not in seen:
            seen.add(key)
            ordered.append(path)
    return ordered


def resolve_source(map_id: str, item: dict | None) -> Path | None:
    for candidate in source_candidates(map_id, item):
        path = SOURCE_DIR / f"{candidate}.fgb"
        if path.exists():
            return path
    for path in item_fgb_paths(item):
        return path
    return None


PROVINCE_VARIANT_RE = re.compile(r"\b(connacht|leinster|munster|ulster)\b", flags=re.IGNORECASE)


def is_province_variant(item: dict | None) -> bool:
    if not item:
        return False
    text = " ".join(str(item.get(key, "")) for key in ("id", "label", "name", "title"))
    return bool(PROVINCE_VARIANT_RE.search(text))


def resolve_sources(map_id: str, item: dict | None) -> tuple[Path, ...]:
    direct = resolve_source(map_id, item)
    if direct:
        return (direct,)

    variants = item.get("variants") if item else None
    province_variants = [variant for variant in (variants or []) if is_province_variant(variant)]
    if province_variants:
        paths: list[Path] = []
        for variant in province_variants:
            variant_id = str(variant.get("id") or "").strip()
            path = resolve_source(variant_id, variant)
            if not path:
                return ()
            paths.append(path)
        return tuple(paths)

    return ()


def chain_class_groups(chain: dict) -> list[tuple[str, str]]:
    groups = []
    for class_id in chain.get("classIds", []) or []:
        groups.append((class_id, class_id))
    for segment in chain.get("segments", []) or []:
        for class_id in segment.get("classIds", []) or []:
            groups.append((class_id, class_id))
    for column in chain.get("columns", []) or []:
        column_name = column.get("name") or "column"
        for class_id in column.get("classIds", []) or []:
            groups.append((f"{column_name}:{class_id}", class_id))
    predecessor = chain.get("predecessor") or {}
    for class_id in predecessor.get("classIds", []) or []:
        groups.append((f"predecessor:{class_id}", class_id))
    return groups


def discover_transitions(include_manual_fallback: bool = True) -> tuple[list[DiscoveredTransition], list[dict]]:
    data = json.loads(MAPS_DB_PATH.read_text(encoding="utf-8"))
    maps = {item["id"]: item for item in data.get("maps", []) if item.get("id")}
    classes = {item["id"]: item for item in data.get("classes", []) if item.get("id")}
    transitions = []
    skipped = []
    seen = set()

    for chain in data.get("timeSeriesChains", []) or []:
        chain_id = chain.get("id") or "unknown-chain"
        for group_id, class_id in chain_class_groups(chain):
            cls = classes.get(class_id)
            dated_maps = []
            for map_id in (cls.get("maps", []) if cls else []):
                item = maps.get(map_id)
                timestamp = parse_map_date(item.get("date") if item else None)
                if timestamp is None:
                    skipped.append({
                        "chainId": chain_id,
                        "classId": class_id,
                        "mapId": map_id,
                        "reason": "missing-or-unparseable-date",
                    })
                    continue
                dated_maps.append((timestamp, map_id, item))
            dated_maps.sort(key=lambda value: (value[0], value[1]))
            for index in range(1, len(dated_maps)):
                _, from_id, from_item = dated_maps[index - 1]
                _, to_id, to_item = dated_maps[index]
                pair_key = (from_id, to_id)
                if pair_key in seen:
                    continue
                seen.add(pair_key)
                if is_placeholder(from_item) or is_placeholder(to_item):
                    skipped.append({
                        "chainId": chain_id,
                        "classId": class_id,
                        "fromMapId": from_id,
                        "toMapId": to_id,
                        "reason": "placeholder-or-to-be-added",
                    })
                    continue
                from_sources = resolve_sources(from_id, from_item)
                to_sources = resolve_sources(to_id, to_item)
                if not from_sources or not to_sources:
                    skipped.append({
                        "chainId": chain_id,
                        "classId": class_id,
                        "fromMapId": from_id,
                        "toMapId": to_id,
                        "reason": "missing-converted-vector-source",
                        "fromSourceFound": bool(from_sources),
                        "toSourceFound": bool(to_sources),
                    })
                    continue
                config = TransitionConfig(
                    from_id=from_id,
                    to_id=to_id,
                    from_source=rel(from_sources[0]),
                    to_source=rel(to_sources[0]),
                    from_label=map_label(from_item, from_id),
                    to_label=map_label(to_item, to_id),
                )
                transitions.append(DiscoveredTransition(
                    config=config,
                    from_sources=tuple(rel(path) for path in from_sources),
                    to_sources=tuple(rel(path) for path in to_sources),
                    chain_id=chain_id,
                    class_id=group_id,
                    source="catalogue",
                ))

    if include_manual_fallback:
        existing = {(item.config.from_id, item.config.to_id) for item in transitions}
        for config in DEFAULT_TRANSITIONS:
            if (config.from_id, config.to_id) not in existing:
                transitions.append(DiscoveredTransition(
                    config=config,
                    from_sources=(config.from_source,),
                    to_sources=(config.to_source,),
                    chain_id="wards",
                    class_id="ni-wards",
                    source="manual-fallback",
                ))
    transitions.sort(key=lambda item: (item.chain_id, item.class_id, item.config.from_id, item.config.to_id))
    return transitions, skipped



def empty_transition_sidecar(config: TransitionConfig, item: DiscoveredTransition, args: argparse.Namespace, reason: str) -> dict:
    return {
        "type": "FeatureCollection",
        "name": f"Territorial changes: {config.from_label} to {config.to_label}",
        "metadata": {
            "fromMapId": config.from_id,
            "toMapId": config.to_id,
            "fromSource": config.from_source,
            "toSource": config.to_source,
            "fromSources": list(item.from_sources),
            "toSources": list(item.to_sources),
            "minimumAreaM2": args.min_area_m2,
            "coordinateDecimals": args.coordinate_decimals,
            "chainId": item.chain_id,
            "classId": item.class_id,
            "discoverySource": item.source,
            "noChangeReason": reason,
            "transitionPieceRule": "no territorial pieces generated because the adjacent layers resolve to the same converted vector source",
            "transitionTypes": {
                "unchanged": "adjacent catalogue state uses the same converted geometry source"
            },
        },
        "features": [],
    }


def manifest_entry(item: DiscoveredTransition, out_path: Path, sidecar: dict, reused: bool = False) -> dict:
    config = item.config
    transition_id = f"{config.from_id}__{config.to_id}"
    return {
        "id": transition_id,
        "fromMapId": config.from_id,
        "toMapId": config.to_id,
        "fromMapName": config.from_label,
        "toMapName": config.to_label,
        "chainId": item.chain_id,
        "classId": item.class_id,
        "source": item.source,
        "path": rel(out_path),
        "fromSource": config.from_source,
        "toSource": config.to_source,
        "fromSources": list(item.from_sources),
        "toSources": list(item.to_sources),
        "featureCount": len(sidecar.get("features", [])),
        "bytes": out_path.stat().st_size,
        "reused": bool(reused),
        "noChangeReason": sidecar.get("metadata", {}).get("noChangeReason"),
    }

def build_all(args: argparse.Namespace) -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    discovered, skipped = discover_transitions(include_manual_fallback=not args.no_manual_fallback)
    if args.only:
        wanted = set(args.only)
        discovered = [item for item in discovered if f"{item.config.from_id}__{item.config.to_id}" in wanted]
    if args.limit:
        discovered = discovered[: args.limit]

    built = []
    failed = []
    for item in discovered:
        config = item.config
        transition_id = f"{config.from_id}__{config.to_id}"
        out_path = OUT_DIR / f"{transition_id}.geojson"
        try:
            if out_path.exists() and not args.force:
                sidecar = json.loads(out_path.read_text(encoding="utf-8"))
                built.append(manifest_entry(item, out_path, sidecar, reused=True))
                print(f"reused {transition_id} ({built[-1]['featureCount']} features)", flush=True)
                continue

            if tuple(item.from_sources) == tuple(item.to_sources):
                sidecar = empty_transition_sidecar(config, item, args, "identical-converted-vector-source")
            else:
                sidecar = build_transition_from_sources(
                    config,
                    item.from_sources,
                    item.to_sources,
                    min_area_m2=args.min_area_m2,
                    simplify_metres=args.simplify_metres,
                    coordinate_decimals=args.coordinate_decimals,
                )
                sidecar.setdefault("metadata", {})["chainId"] = item.chain_id
                sidecar.setdefault("metadata", {})["classId"] = item.class_id
                sidecar.setdefault("metadata", {})["discoverySource"] = item.source
            out_path.write_text(json.dumps(sidecar, separators=(",", ":")), encoding="utf-8")
            built.append(manifest_entry(item, out_path, sidecar, reused=False))
            print(f"built {transition_id} ({built[-1]['featureCount']} features)", flush=True)
        except Exception as exc:  # noqa: BLE001 - generator report must preserve per-transition failures.
            failed.append({
                "id": transition_id,
                "fromMapId": config.from_id,
                "toMapId": config.to_id,
                "chainId": item.chain_id,
                "classId": item.class_id,
                "reason": type(exc).__name__,
                "message": str(exc),
            })
            print(f"failed {transition_id}: {type(exc).__name__}: {exc}", flush=True)

    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "minimumAreaM2": args.min_area_m2,
        "coordinateDecimals": args.coordinate_decimals,
        "transitionCount": len(built),
        "skippedCount": len(skipped),
        "failedCount": len(failed),
        "transitions": built,
        "skipped": skipped,
        "failed": failed,
    }
    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover and build Civgraph timeline territorial transition sidecars.")
    parser.add_argument("--min-area-m2", type=float, default=MIN_AREA_M2)
    parser.add_argument("--simplify-metres", type=float, default=0.0)
    parser.add_argument("--coordinate-decimals", type=int, default=6)
    parser.add_argument("--limit", type=int, default=0, help="Debug only: build the first N discovered transitions.")
    parser.add_argument("--only", action="append", default=[], help="Build one transition id, e.g. wards-1993__wards-2012. May be repeated.")
    parser.add_argument("--no-manual-fallback", action="store_true")
    parser.add_argument("--force", action="store_true", help="Rebuild existing sidecars instead of reusing them.")
    args = parser.parse_args()
    manifest = build_all(args)
    print(json.dumps({
        "transitionCount": manifest["transitionCount"],
        "skippedCount": manifest["skippedCount"],
        "failedCount": manifest["failedCount"],
    }, indent=2))


if __name__ == "__main__":
    main()
