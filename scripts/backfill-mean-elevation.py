#!/usr/bin/env python3
"""
Backfill mean elevation properties into vector datasets.

For each .fgb/.geojson file under a root directory, if min/max elevation
properties exist, writes:
  - meanElev_m
  - meanElev_ft

Mean values are computed per feature as midpoint of min/max values.
"""

from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
import shutil

import numpy as np
import pandas as pd
import pyogrio


MIN_M_KEYS = {"minelev_m"}
MAX_M_KEYS = {"maxelev_m"}
MIN_FT_KEYS = {"minelev_ft"}
MAX_FT_KEYS = {"maxelev_ft"}


def find_key(columns: list[str], wanted: set[str]) -> str | None:
    by_lower = {c.lower(): c for c in columns}
    for key in wanted:
        if key in by_lower:
            return by_lower[key]
    return None


def driver_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".fgb":
        return "FlatGeobuf"
    if ext == ".geojson":
        return "GeoJSON"
    raise ValueError(f"Unsupported extension: {path}")


def iter_vector_files(root: Path) -> list[Path]:
    files = [*root.rglob("*.fgb"), *root.rglob("*.geojson")]
    return sorted(files)


def compute_mean_series(a: pd.Series, b: pd.Series) -> pd.Series:
    av = pd.to_numeric(a, errors="coerce")
    bv = pd.to_numeric(b, errors="coerce")
    mean = (av + bv) / 2.0
    return mean.where(np.isfinite(mean), np.nan)


def process_file(path: Path, overwrite: bool, dry_run: bool) -> tuple[bool, int]:
    if path.is_dir():
        raise RuntimeError(f"Expected file but found directory: {path}")

    info = pyogrio.read_info(str(path))
    fields = list(info.get("fields", []))
    min_m_key = find_key(fields, MIN_M_KEYS)
    max_m_key = find_key(fields, MAX_M_KEYS)
    if not min_m_key or not max_m_key:
        return False, 0

    df = pyogrio.read_dataframe(str(path))
    if df.empty:
        return False, 0

    mean_m = compute_mean_series(df[min_m_key], df[max_m_key]).round(1)

    min_ft_key = find_key(fields, MIN_FT_KEYS)
    max_ft_key = find_key(fields, MAX_FT_KEYS)
    if min_ft_key and max_ft_key:
        mean_ft = compute_mean_series(df[min_ft_key], df[max_ft_key]).round(1)
    else:
        mean_ft = (mean_m * 3.28084).round(1)

    changed = 0
    if "meanElev_m" not in df.columns:
        df["meanElev_m"] = mean_m
        changed = int(mean_m.notna().sum())
    else:
        existing = pd.to_numeric(df["meanElev_m"], errors="coerce")
        if overwrite:
            df["meanElev_m"] = mean_m
            changed = int((existing.fillna(-999999) != mean_m.fillna(-999999)).sum())
        else:
            fill_mask = existing.isna() & mean_m.notna()
            df.loc[fill_mask, "meanElev_m"] = mean_m[fill_mask]
            changed = int(fill_mask.sum())

    changed_ft = 0
    if "meanElev_ft" not in df.columns:
        df["meanElev_ft"] = mean_ft
        changed_ft = int(mean_ft.notna().sum())
    else:
        existing_ft = pd.to_numeric(df["meanElev_ft"], errors="coerce")
        if overwrite:
            df["meanElev_ft"] = mean_ft
            changed_ft = int((existing_ft.fillna(-999999) != mean_ft.fillna(-999999)).sum())
        else:
            fill_mask_ft = existing_ft.isna() & mean_ft.notna()
            df.loc[fill_mask_ft, "meanElev_ft"] = mean_ft[fill_mask_ft]
            changed_ft = int(fill_mask_ft.sum())

    total_changed = max(changed, changed_ft)
    if total_changed <= 0:
        return False, 0

    if dry_run:
        return True, total_changed

    # Use a sibling temp path that still ends with the same extension so GDAL
    # writes a single FlatGeobuf file (not a dataset directory).
    tmp_path = path.with_name(f"{path.stem}.__mean_tmp__{path.suffix}")
    if tmp_path.exists():
        if tmp_path.is_dir():
            shutil.rmtree(tmp_path)
        else:
            tmp_path.unlink()
    driver = driver_for_path(path)
    # Preserve stable layer names by forcing output layer name to file stem.
    pyogrio.write_dataframe(df, str(tmp_path), driver=driver, layer=path.stem)
    if not tmp_path.exists() or tmp_path.is_dir():
        raise RuntimeError(f"Temporary output was not a file: {tmp_path}")
    os.replace(tmp_path, path)
    return True, total_changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="data/maps", help="Directory to scan")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing meanElev_* values")
    parser.add_argument("--dry-run", action="store_true", help="Scan and report only")
    args = parser.parse_args()

    root = Path(args.root)
    files = iter_vector_files(root)
    print(f"[mean-elev] Scanning {len(files)} files under {root}")

    changed_files = 0
    changed_features = 0
    failed = 0

    for idx, path in enumerate(files, start=1):
        try:
            changed, n = process_file(path, overwrite=args.overwrite, dry_run=args.dry_run)
            if changed:
                changed_files += 1
                changed_features += n
                print(f"[{idx}/{len(files)}] updated: {path} ({n} features)")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"[{idx}/{len(files)}] failed: {path} ({exc})")

    print(
        f"[mean-elev] done changed_files={changed_files} "
        f"changed_features={changed_features} failed={failed}"
    )


if __name__ == "__main__":
    main()
