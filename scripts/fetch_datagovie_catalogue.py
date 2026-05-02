#!/usr/bin/env python
"""Fetch the full data.gov.ie CKAN catalogue (metadata only).

Walks /api/3/action/package_search with pagination, captures every dataset
and its resources. Output mirrors the shape of opendatani-resources.json
so the existing mirror script can consume it.

  data/external/datagovie-catalogue.json   - one entry per package
  data/external/datagovie-resources.json   - one entry per resource (flat)

Usage:
  python scripts/fetch_datagovie_catalogue.py [--rows 500] [--sleep 0.4]
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "data" / "external"
OUT.mkdir(parents=True, exist_ok=True)

API = "https://data.gov.ie/api/3/action/package_search"
UA = "Mozilla/5.0 boundaries-website/datagovie-catalogue"


def fetch_page(start: int, rows: int) -> dict:
    qs = urllib.parse.urlencode({"rows": rows, "start": start})
    req = urllib.request.Request(f"{API}?{qs}", headers={"User-Agent": UA})
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read().decode("utf-8", errors="replace"))
            if not data.get("success"):
                raise RuntimeError(f"CKAN error: {data.get('error')}")
            return data["result"]
        except Exception as e:
            last_err = e
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f"giving up after retries: {last_err}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=500)
    ap.add_argument("--sleep", type=float, default=0.4)
    args = ap.parse_args()

    cat_path = OUT / "datagovie-catalogue.json"
    res_path = OUT / "datagovie-resources.json"
    progress_path = OUT / "datagovie-catalogue-progress.json"

    print("Probing total count ...")
    first = fetch_page(0, 1)
    total = first.get("count", 0)
    print(f"  total datasets reported: {total}")
    if total == 0:
        sys.exit("API returned 0 results - bailing")

    packages = []
    start = 0
    page = 0
    while start < total:
        page += 1
        t0 = time.time()
        result = fetch_page(start, args.rows)
        batch = result.get("results", [])
        if not batch:
            print(f"  empty batch at start={start} - stopping")
            break
        packages.extend(batch)
        elapsed = time.time() - t0
        print(f"  page {page}: start={start} got={len(batch)} cum={len(packages)}/{total}  ({elapsed:.1f}s)")
        progress_path.write_text(json.dumps({
            "have": len(packages), "total": total,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }))
        start += len(batch)
        if len(batch) < args.rows:
            break
        time.sleep(args.sleep)

    print(f"\nFetched {len(packages)} packages.")
    cat_path.write_text(json.dumps(packages, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  wrote {cat_path}  ({cat_path.stat().st_size/1e6:.1f} MB)")

    # Flatten resources
    flat = []
    for pkg in packages:
        org = (pkg.get("organization") or {}) or {}
        for r in pkg.get("resources", []) or []:
            size = r.get("size")
            try:
                size = int(size) if size not in (None, "", "null") else None
            except (TypeError, ValueError):
                size = None
            flat.append({
                "resource_id": r.get("id"),
                "resource_name": r.get("name") or "",
                "resource_description": r.get("description"),
                "url": r.get("url") or "",
                "format": (r.get("format") or "").upper(),
                "mimetype": r.get("mimetype"),
                "size": size,
                "created": r.get("created"),
                "last_modified": r.get("last_modified"),
                "package_id": pkg.get("id"),
                "package_name": pkg.get("name"),
                "package_title": pkg.get("title"),
                "package_notes": (pkg.get("notes") or "")[:1000],
                "organization_name": org.get("name"),
                "organization_title": org.get("title"),
                "license_id": pkg.get("license_id"),
                "license_title": pkg.get("license_title"),
                "tags": [t.get("name") for t in (pkg.get("tags") or []) if t.get("name")],
            })
    res_path.write_text(json.dumps(flat, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  wrote {res_path}  ({len(flat)} resources, {res_path.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
