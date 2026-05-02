#!/usr/bin/env python
"""HEAD-resolve sizes for data.gov.ie resources, with pre-filtering.

Filters applied BEFORE HEAD (skipped resources get resolved_size=None and resolved_from='filtered'):
  - service endpoints (WMS/WFS/ArcGIS REST/ESRI REST)
  - HTML/webpage formats
  - LIDAR / point cloud / orthophotography heuristics on name+description+title+tags
  - alternate CSO formats (PX, JSON-STAT) when XLSX of same resource exists for the same package
    (we keep XLSX as canonical; if no XLSX, keep one of PX/JSON-STAT)

Output:
  data/external/datagovie-resources-resolved.json
  - same shape as input plus 'resolved_size', 'resolved_from', 'resolve_error', 'resolve_status'
  - 'resolve_status' in {ok, filtered, head_failed, no_url}

Concurrency: 12 workers (HEADs hit many different hosts)
Resume: existing resolved file is loaded; only un-resolved entries are HEADed.

Usage:
  python scripts/resolve_datagovie_sizes.py [--workers 12]
"""
import argparse
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RES_PATH = REPO / "data" / "external" / "datagovie-resources.json"
OUT_PATH = REPO / "data" / "external" / "datagovie-resources-resolved.json"
PROGRESS_PATH = REPO / "data" / "external" / "datagovie-resolve-progress.json"

UA = "Mozilla/5.0 boundaries-website/datagovie-size-resolver"

SERVICE_FORMATS = {
    "WMS", "WFS", "WMTS",
    "ARCGIS GEOSERVICES REST API",
    "ARCGIS_GEOSERVICES_REST_API",
    "ARCGIS REST", "ESRI REST", "ESRI REST API",
    "ARCSDE CONNECTION",
}
HTML_FORMATS = {"HTML", "HTM", "WEBPAGE", "WEB", "URL", "REST"}

# Heuristic exclusions for LIDAR + point clouds + orthophotography
LIDAR_TERMS = re.compile(
    r"\b("
    r"lidar|li\s*dar|"
    r"point[-\s]?cloud|"
    r"\.las\b|laz\b|\.copc\b|copc|"
    r"orthophoto|ortho[-\s]?photo(?:graphy)?|orthoimagery|aerial[-\s]?photograph(?:y|s|ic)?|"
    r"orthorectified|"
    r"dtm\b|dsm\b|dem\b|"   # DTM/DSM/DEM rasters (LIDAR-derived)
    r"point[-\s]?density|"
    r"intensity[-\s]?(?:image|raster|grid)"
    r")\b",
    re.IGNORECASE,
)
LIDAR_FORMATS = {"LAS", "LAZ", "COPC", "ASCII", "ASCII GRID", "ESRI ASCII GRID"}


def is_excluded(resource: dict) -> tuple[bool, str]:
    fmt = (resource.get("format") or "").upper().strip()
    if fmt in SERVICE_FORMATS:
        return True, "service"
    if fmt in HTML_FORMATS:
        return True, "html"
    if fmt in LIDAR_FORMATS:
        return True, "lidar_format"
    blob = " ".join([
        resource.get("resource_name") or "",
        resource.get("resource_description") or "",
        resource.get("package_title") or "",
        resource.get("package_notes") or "",
        " ".join(resource.get("tags") or []),
    ])
    if LIDAR_TERMS.search(blob):
        return True, "lidar_kw"
    return False, ""


def collapse_cso_alternates(resources: list[dict]) -> set[str]:
    """For each package, if XLSX exists, drop PX and JSON-STAT siblings.
    If no XLSX but PX+JSON-STAT, keep one (XLSX preferred but not present here, fall back to JSON-STAT).
    Returns set of resource_ids to drop."""
    by_pkg = {}
    for r in resources:
        by_pkg.setdefault(r.get("package_id") or "", []).append(r)
    drop = set()
    for pkg_id, items in by_pkg.items():
        fmts = {(i.get("format") or "").upper(): i for i in items}
        xlsx = [i for i in items if (i.get("format") or "").upper() in {"XLSX", ".XLSX", "XLS"}]
        px = [i for i in items if (i.get("format") or "").upper() == "PX"]
        jstat = [i for i in items if (i.get("format") or "").upper() == "JSON-STAT"]
        if xlsx:
            for i in px + jstat:
                drop.add(i["resource_id"])
        elif jstat and px:
            for i in px:  # prefer JSON-STAT over PX
                drop.add(i["resource_id"])
    return drop


def head_size(url: str) -> tuple[str, int, str]:
    """Return (status, content_length, error). status in {ok, head_failed, no_url}."""
    if not url or not url.startswith("http"):
        return "no_url", -1, ""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            cl = r.headers.get("Content-Length")
            ct = (r.headers.get("Content-Type") or "").lower()
            if "text/html" in ct:
                return "ok", int(cl) if cl else -1, "html-content"
            return "ok", int(cl) if cl else -1, ""
    except Exception as e:
        # Some servers don't allow HEAD; try GET with Range: bytes=0-0
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": UA, "Range": "bytes=0-0"},
            )
            with urllib.request.urlopen(req, timeout=45) as r:
                cr = r.headers.get("Content-Range") or ""
                m = re.match(r"bytes\s+0-0/(\d+)", cr)
                if m:
                    return "ok", int(m.group(1)), ""
                cl = r.headers.get("Content-Length")
                return "ok", int(cl) if cl else -1, "ranged-get"
        except Exception as e2:
            return "head_failed", -1, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    print("Loading resources ...")
    resources = json.loads(RES_PATH.read_text(encoding="utf-8"))
    print(f"  {len(resources):,} resources")

    cso_drop = collapse_cso_alternates(resources)
    print(f"  {len(cso_drop):,} alternate-format CSO resources will be filtered")

    existing = {}
    if OUT_PATH.exists():
        try:
            for r in json.loads(OUT_PATH.read_text(encoding="utf-8")):
                existing[r["resource_id"]] = r
            print(f"  resuming: {len(existing):,} already resolved")
        except Exception as e:
            print(f"  warn: could not load existing resolved file: {e}")

    work = []
    pre_filtered = 0
    for r in resources:
        rid = r["resource_id"]
        if rid in existing:
            continue
        if rid in cso_drop:
            r["resolved_size"] = None
            r["resolved_from"] = "filtered"
            r["resolve_status"] = "filtered"
            r["resolve_error"] = "cso-alt-format"
            existing[rid] = r
            pre_filtered += 1
            continue
        excluded, why = is_excluded(r)
        if excluded:
            r["resolved_size"] = None
            r["resolved_from"] = "filtered"
            r["resolve_status"] = "filtered"
            r["resolve_error"] = why
            existing[rid] = r
            pre_filtered += 1
            continue
        work.append(r)

    print(f"  {pre_filtered:,} pre-filtered (CSO alternates / LIDAR / orthophoto / service / html)")
    print(f"  {len(work):,} resources need HEAD")

    if args.limit:
        work = work[: args.limit]
        print(f"  --limit applied: {len(work)}")

    if not work:
        print("Nothing to do; writing output and exiting.")
    else:
        out_lock = threading.Lock()
        counters = {"ok": 0, "fail": 0, "no_url": 0, "bytes": 0}
        cl = threading.Lock()
        started = time.time()
        last_print = started

        def worker(r):
            url = r.get("url") or ""
            status, size, err = head_size(url)
            r["resolved_size"] = size if size > 0 else None
            r["resolved_from"] = "http-head" if status == "ok" else status
            r["resolve_status"] = status
            r["resolve_error"] = err
            with out_lock:
                existing[r["resource_id"]] = r
            with cl:
                if status == "ok":
                    counters["ok"] += 1
                    if size > 0:
                        counters["bytes"] += size
                elif status == "no_url":
                    counters["no_url"] += 1
                else:
                    counters["fail"] += 1
            return status

        print(f"HEADing {len(work)} resources with {args.workers} workers ...")
        sys.stdout.flush()

        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = [ex.submit(worker, r) for r in work]
            for i, fut in enumerate(as_completed(futs), 1):
                try:
                    fut.result()
                except Exception as e:
                    pass
                now = time.time()
                if now - last_print > 30 or i == len(work):
                    elapsed = now - started
                    rate = i / max(elapsed, 1)
                    print(
                        f"[{i:6}/{len(work)}]  ok={counters['ok']} fail={counters['fail']} "
                        f"no_url={counters['no_url']}  resolved={counters['bytes']/1e9:.2f} GB  "
                        f"{rate:.1f} req/s  ETA {((len(work)-i)/max(rate,0.1))/60:.0f}min",
                        flush=True,
                    )
                    last_print = now
                    if i % 5000 == 0:
                        OUT_PATH.write_text(
                            json.dumps(list(existing.values()), ensure_ascii=False, indent=1),
                            encoding="utf-8",
                        )

    OUT_PATH.write_text(
        json.dumps(list(existing.values()), ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    PROGRESS_PATH.write_text(json.dumps({
        "resolved": len(existing),
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }))
    print(f"\nWrote {OUT_PATH}  ({OUT_PATH.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
