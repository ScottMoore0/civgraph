#!/usr/bin/env python3
"""
Build downloadable ZIP chunks for oversized FGB files.

For every map in data/database/maps.json with files.fgb > 100 MB:
- split the FGB into <= 90 MB binary parts
- package each part into its own ZIP file
- emit an instructions text file
- update data/downloads/fgb-chunks/manifest.json
"""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPS_JSON = ROOT / "data" / "database" / "maps.json"
OUT_ROOT = ROOT / "data" / "downloads" / "fgb-chunks"

THRESHOLD_BYTES = 100 * 1024 * 1024
CHUNK_BYTES = 90 * 1024 * 1024


def load_maps():
    with MAPS_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("maps", [])


def map_fgb_paths(maps):
    seen = set()
    results = []
    for m in maps:
        map_id = m.get("id")
        fgb = (m.get("files") or {}).get("fgb")
        if not map_id or not fgb:
            continue
        key = (map_id, fgb)
        if key in seen:
            continue
        seen.add(key)
        results.append((map_id, fgb))
    return results


def split_to_parts(src_file: Path, part_prefix: str, out_dir: Path):
    part_files = []
    part_idx = 1
    with src_file.open("rb") as src:
        while True:
            chunk = src.read(CHUNK_BYTES)
            if not chunk:
                break
            part_name = f"{part_prefix}.part{part_idx:03d}"
            part_path = out_dir / part_name
            with part_path.open("wb") as p:
                p.write(chunk)
            part_files.append(part_path)
            part_idx += 1
    return part_files


def zip_part(part_path: Path):
    zip_path = part_path.with_suffix(part_path.suffix + ".zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.write(part_path, arcname=part_path.name)
    part_path.unlink()
    return zip_path


def write_instructions(out_dir: Path, original_name: str, part_prefix: str, part_count: int):
    txt = out_dir / "README-reassemble.txt"
    text = f"""Chunked FGB download

Original file: {original_name}
Parts: {part_count}

1. Extract all *.zip files in this folder.
2. Ensure all {part_prefix}.partNNN files are in one folder.
3. Reassemble:

Windows CMD:
copy /b {part_prefix}.part001+{part_prefix}.part002+... {original_name}

PowerShell:
$parts = Get-ChildItem "{part_prefix}.part*" | Sort-Object Name
$out = [System.IO.File]::OpenWrite("{original_name}")
foreach ($p in $parts) {{
  $bytes = [System.IO.File]::ReadAllBytes($p.FullName)
  $out.Write($bytes, 0, $bytes.Length)
}}
$out.Close()

Linux/macOS:
cat {part_prefix}.part* > {original_name}
"""
    txt.write_text(text, encoding="utf-8")
    return txt


def to_rel(path: Path):
    return path.relative_to(ROOT).as_posix()


def main():
    maps = load_maps()
    fgb_refs = map_fgb_paths(maps)

    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    manifest = {}

    for map_id, rel_fgb in fgb_refs:
        src = ROOT / rel_fgb
        if not src.exists():
            continue
        size = src.stat().st_size
        if size <= THRESHOLD_BYTES:
            continue

        target_dir = OUT_ROOT / map_id
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        part_prefix = src.name
        part_files = split_to_parts(src, part_prefix, target_dir)
        zip_paths = [zip_part(p) for p in part_files]
        readme = write_instructions(target_dir, src.name, part_prefix, len(zip_paths))

        manifest[map_id] = {
            "originalFile": rel_fgb.replace("\\", "/"),
            "originalSize": size,
            "chunkBytes": CHUNK_BYTES,
            "zipParts": [to_rel(p) for p in zip_paths],
            "instructionsFile": to_rel(readme),
        }
        print(f"[chunked] {map_id}: {len(zip_paths)} ZIP parts")

    manifest_path = OUT_ROOT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"[done] wrote {to_rel(manifest_path)} with {len(manifest)} entries")


if __name__ == "__main__":
    main()
