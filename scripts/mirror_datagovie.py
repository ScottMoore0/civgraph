#!/usr/bin/env python
"""Mirror data.gov.ie + Tailte Éireann resources (already filtered for
LIDAR/point clouds/orthophoto via the resolver) to D:\\datagovie.

Reads data/external/datagovie-resources-resolved.json and applies a
TIGHTER selection step that:
  - skips resources with resolve_status != 'ok'
  - skips items >5 GB (per-file cap)
  - per package, keeps one canonical spatial format and one canonical
    tabular format (preferring open formats over proprietary):
      spatial: GPKG > SHP > GEOJSON > GDB > KML
      tabular: CSV > XLSX > XLS
      anything else (ZIP, PDF, JSON, GeoTIFF, NetCDF…): kept as-is
  - de-duplicates against the ODNI mirror (skips URLs already in
    D:/opendatani/_manifest.csv)

Concurrency: 6 workers (resources span many publisher hosts; politely)
Resumable via HTTP Range; manifest CSV + line log.

Usage:
  python scripts/mirror_datagovie.py [--target D:\\datagovie] [--workers 6] [--dry-run] [--max-size-gb 5]
"""
import argparse
import csv
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from collections import defaultdict

REPO = Path(__file__).resolve().parent.parent
RESOLVED_PATH = REPO / "data" / "external" / "datagovie-resources-resolved.json"
ODNI_MANIFEST = Path(r"D:\opendatani\_manifest.csv")

UA = "Mozilla/5.0 civgraph/mirror-datagovie"
INVALID_FS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

# Per-package canonical preferences (lower index = more preferred)
SPATIAL_RANK = {"GPKG": 0, "GEOPACKAGE": 0, ".GPKG": 0,
                "SHP": 1, "SHP / ZIP": 1, "SHP.ZIP": 1, "SHAPEFILE": 1, "SHAPEFILES": 1,
                "GEOJSON": 2,
                "GDB": 3, ".GBD": 3,
                "KML": 4, "KMZ": 4}
TABULAR_RANK = {"CSV": 0, "CSV.ZIP": 0, "CSV.": 0,
                "XLSX": 1, ".XLSX": 1,
                "XLS": 2,
                "ODS": 3,
                "TSV": 4, "TAB": 4}
# Non-canonical formats that are always-keep (no dedup): pass-through
PASSTHROUGH = {"PDF", "ZIP", "ZIP ARCHIVE", "JSON", "XML", "GEOTIFF", "TIFF", "TIF",
               "TXT", "DOCX", "DOC", "PNG", "JPG", "JPEG", "WEBP",
               "WWW:DOWNLOAD-1.0-HTTP--DOWNLOAD"}


def safe_name(s: str, max_len: int = 100) -> str:
    if not s:
        return "_"
    s = INVALID_FS_RE.sub("_", s).strip(" .")
    return (s[:max_len] or "_")


def filename_from(resource: dict) -> str:
    rname = resource.get("resource_name") or ""
    url = resource.get("url") or ""
    basename = ""
    if url:
        path = urllib.parse.urlparse(url).path
        basename = os.path.basename(path)
    if not basename or basename in {"download", "/"}:
        basename = rname or resource["resource_id"]
    if rname and "." in rname and "." not in basename:
        basename = rname
    return safe_name(basename)


def select_canonical(resources: list[dict]) -> tuple[list[dict], dict]:
    """Apply per-package canonical-format selection.

    Returns (kept, drop_reason_by_id).
    For each package:
      - among spatial formats, keep best-ranked one only
      - among tabular formats, keep best-ranked one only
      - all PASSTHROUGH formats are kept
      - other formats (none of the above) are kept (rare)
    """
    by_pkg = defaultdict(list)
    for r in resources:
        by_pkg[r.get("package_id") or ""].append(r)

    kept = []
    drop = {}
    for pkg_id, items in by_pkg.items():
        # Group by category
        spatial = []
        tabular = []
        other = []
        txt = []
        for r in items:
            f = (r.get("format") or "").upper()
            if f in SPATIAL_RANK:
                spatial.append(r)
            elif f in TABULAR_RANK:
                tabular.append(r)
            elif f == "TXT":
                txt.append(r)
            else:
                other.append(r)
        # If we have spatial, treat TXT as redundant feature-collection dumps
        if spatial:
            for r in txt:
                drop[r["resource_id"]] = "txt-with-spatial"
        else:
            other.extend(txt)

        # Pick best spatial
        if spatial:
            spatial.sort(key=lambda r: (
                SPATIAL_RANK[(r.get("format") or "").upper()],
                -(r.get("resolved_size") or 0),  # prefer larger if same rank (more complete)
            ))
            chosen = spatial[0]
            kept.append(chosen)
            for r in spatial[1:]:
                drop[r["resource_id"]] = f"alt-spatial (kept {(chosen.get('format') or '').upper()})"
        # Pick best tabular
        if tabular:
            tabular.sort(key=lambda r: (
                TABULAR_RANK[(r.get("format") or "").upper()],
                -(r.get("resolved_size") or 0),
            ))
            chosen = tabular[0]
            kept.append(chosen)
            for r in tabular[1:]:
                drop[r["resource_id"]] = f"alt-tabular (kept {(chosen.get('format') or '').upper()})"
        # Other passes through
        for r in other:
            kept.append(r)

    return kept, drop


def load_odni_already_downloaded() -> set:
    """Return set of URLs already mirrored under D:/opendatani."""
    if not ODNI_MANIFEST.exists():
        return set()
    urls = set()
    try:
        with ODNI_MANIFEST.open("r", encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                if row.get("status") in {"ok", "skipped"} and row.get("url"):
                    urls.add(row["url"])
    except Exception:
        pass
    return urls


def download(url: str, dest: Path, expected_size: int) -> tuple[str, int, str]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")

    if dest.exists() and expected_size > 0 and dest.stat().st_size == expected_size:
        return "skipped", dest.stat().st_size, ""

    have = tmp.stat().st_size if tmp.exists() else 0
    last_err = ""
    for attempt in range(3):
        try:
            headers = {"User-Agent": UA}
            mode = "wb"
            if have > 0:
                headers["Range"] = f"bytes={have}-"
                mode = "ab"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as r, open(tmp, mode) as out:
                while True:
                    chunk = r.read(1024 * 256)
                    if not chunk:
                        break
                    out.write(chunk)
                    have += len(chunk)
            if dest.exists():
                dest.unlink()
            tmp.rename(dest)
            size = dest.stat().st_size
            if expected_size > 0 and size != expected_size:
                return "ok", size, f"size mismatch (got {size}, expected {expected_size})"
            return "ok", size, ""
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(2 ** attempt)
            if "416" in last_err and tmp.exists():
                tmp.unlink()
                have = 0
    return "failed", (tmp.stat().st_size if tmp.exists() else 0), last_err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default=r"D:\datagovie")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-size-gb", type=float, default=5.0)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    target = Path(args.target)
    target.mkdir(parents=True, exist_ok=True)
    manifest_path = target / "_manifest.csv"
    log_path = target / "_download.log"
    cap_bytes = int(args.max_size_gb * 1e9)

    print("Loading resolved resources ...")
    resources = json.loads(RESOLVED_PATH.read_text(encoding="utf-8"))
    print(f"  {len(resources):,} total")

    ok_set = [r for r in resources if r.get("resolve_status") == "ok"]
    print(f"  {len(ok_set):,} resolve_status=ok")

    # Per-package canonical selection
    kept, dropped = select_canonical(ok_set)
    print(f"  per-package canonical selection: kept {len(kept):,}, dropped {len(dropped):,}")

    # Per-file size cap
    capped = []
    over_cap = 0
    over_cap_bytes = 0
    for r in kept:
        s = r.get("resolved_size") or 0
        if s and s > cap_bytes:
            over_cap += 1
            over_cap_bytes += s
            continue
        capped.append(r)
    print(f"  per-file >{args.max_size_gb} GB cap: dropped {over_cap:,} files ({over_cap_bytes/1e9:.2f} GB)")

    # Dedup vs ODNI mirror by URL
    odni_urls = load_odni_already_downloaded()
    print(f"  ODNI URLs already on disk: {len(odni_urls):,}")
    final = []
    odni_dups = 0
    for r in capped:
        if r.get("url") in odni_urls:
            odni_dups += 1
            continue
        final.append(r)
    print(f"  cross-catalogue dedup: dropped {odni_dups:,}")

    total_bytes = sum(r.get("resolved_size") or 0 for r in final)
    print(f"\nFinal scope: {len(final):,} resources, {total_bytes/1e9:.2f} GB expected")

    if args.limit:
        final = final[: args.limit]
        print(f"  --limit applied: {len(final)}")

    if args.dry_run:
        # Format breakdown of final scope
        from collections import Counter
        fmts = Counter((r.get("format") or "").upper() for r in final)
        print("\nFormat breakdown (top 20 by count):")
        for f, n in fmts.most_common(20):
            sz = sum(r.get("resolved_size") or 0 for r in final if (r.get("format") or "").upper() == f)
            print(f"  {n:>5}  {sz/1e9:>7.2f} GB  {f}")
        return

    # Manifest setup
    is_new = not manifest_path.exists() or manifest_path.stat().st_size == 0
    manifest_file = manifest_path.open("a", encoding="utf-8", newline="")
    writer = csv.writer(manifest_file)
    if is_new:
        writer.writerow([
            "resource_id", "package_name", "organization", "format",
            "url", "target_path", "expected_size", "downloaded_size",
            "status", "error", "ts",
        ])
        manifest_file.flush()

    log_file = log_path.open("a", encoding="utf-8")
    log_file.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} mirror run ===\n")
    log_file.flush()

    log_lock = threading.Lock()
    manifest_lock = threading.Lock()
    counters_lock = threading.Lock()
    counters = {"ok": 0, "skipped": 0, "failed": 0, "bytes": 0}
    started = time.time()

    def log(msg):
        with log_lock:
            log_file.write(msg + "\n")
            log_file.flush()

    def write_row(row):
        with manifest_lock:
            writer.writerow(row)
            manifest_file.flush()

    def worker(r):
        rid = r["resource_id"]
        org = safe_name(r.get("organization_title") or r.get("organization_name") or "_misc", 80)
        pkg = safe_name(r.get("package_name") or r.get("package_title") or rid, 100)
        fname = filename_from(r)
        dest = target / org / pkg / fname
        url = r["url"]
        expected = r.get("resolved_size") or 0
        status, size, err = download(url, dest, expected)
        with counters_lock:
            counters[status] += 1
            counters["bytes"] += size
        log(f"{status:7} {size:>12} {url}  -> {dest.relative_to(target)}  {err}")
        write_row([
            rid, r.get("package_name") or "", r.get("organization_title") or "",
            r.get("format") or "", url, str(dest.relative_to(target)),
            expected, size, status, err, time.strftime("%Y-%m-%dT%H:%M:%S"),
        ])
        return status

    print(f"Starting download with {args.workers} workers ...")
    print(f"Target: {target}")
    sys.stdout.flush()

    last_print = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(worker, r): r for r in final}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                fut.result()
            except Exception as e:
                log(f"WORKER ERROR: {e}")
            now = time.time()
            if now - last_print > 30 or i == len(final):
                with counters_lock:
                    elapsed = now - started
                    rate_mb = (counters["bytes"] / 1e6) / max(elapsed, 1)
                    print(
                        f"[{i:6}/{len(final)}]  "
                        f"ok={counters['ok']} skipped={counters['skipped']} failed={counters['failed']}  "
                        f"{counters['bytes']/1e9:.2f} GB  {rate_mb:.1f} MB/s",
                        flush=True,
                    )
                last_print = now

    elapsed = time.time() - started
    print(f"\nDone in {elapsed/60:.1f} min")
    print(f"  ok={counters['ok']} skipped={counters['skipped']} failed={counters['failed']}")
    print(f"  total downloaded: {counters['bytes']/1e9:.2f} GB")
    log_file.close()
    manifest_file.close()


if __name__ == "__main__":
    main()
