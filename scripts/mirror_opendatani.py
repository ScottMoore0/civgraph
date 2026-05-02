#!/usr/bin/env python
"""Mirror remaining (un-integrated) Open Data NI resources to an external drive.

- Reads data/external/opendatani-resources.json (5,893 resources, ~213.9 GB total)
- Excludes packages already represented in data/database/maps.json (~103 pkgs)
- Downloads remaining ~952 packages to D:\\opendatani\\<org>\\<package>\\<file>
- Concurrent (6 workers), resumable (HTTP Range), retries with backoff
- Skips WMS/WFS/ArcGIS REST capabilities endpoints (records URL only)
- Manifest CSV + line log; safe to re-run (resumes/skips completed)

Usage:
  python scripts/mirror_opendatani.py [--target D:\\opendatani] [--workers 6] [--dry-run]
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

REPO = Path(__file__).resolve().parent.parent
RES_PATH = REPO / "data" / "external" / "opendatani-resources.json"
MAPS_PATH = REPO / "data" / "database" / "maps.json"

UA = "Mozilla/5.0 boundaries-website/mirror-opendatani"
SERVICE_FORMATS = {"WMS", "WFS", "WMTS", "ESRI REST", "ARCGIS_GEOSERVICE", "ESRI REST API"}
WEBPAGE_FORMATS = {"HTML", "WEBPAGE"}

INVALID_FS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_name(s: str, max_len: int = 120) -> str:
    if not s:
        return "_"
    s = INVALID_FS_RE.sub("_", s).strip(" .")
    return (s[:max_len] or "_")


def load_integrated_pkg_keys() -> tuple[set, set]:
    """Return (uuid_pkg_ids, slug_pkg_names) referenced in maps.json."""
    db = json.loads(MAPS_PATH.read_text(encoding="utf-8"))
    slug_re = re.compile(r"opendatani[^/]*/dataset/([a-z0-9-]+)")

    def iter_refs(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == "references" and isinstance(v, list):
                    for r in v:
                        if isinstance(r, dict):
                            yield r.get("url", "") or ""
                else:
                    yield from iter_refs(v)
        elif isinstance(obj, list):
            for x in obj:
                yield from iter_refs(x)

    uuids, slugs = set(), set()
    for url in iter_refs(db):
        if "opendatani" not in url:
            continue
        m = slug_re.search(url)
        if not m:
            continue
        tok = m.group(1)
        if re.match(r"^[0-9a-f-]{36}$", tok):
            uuids.add(tok)
        else:
            slugs.add(tok)
    return uuids, slugs


def filename_from(resource: dict) -> str:
    """Pick a sensible local filename for a resource."""
    rname = resource.get("resource_name") or ""
    url = resource.get("url") or ""
    # Prefer URL basename (carries the real extension)
    basename = ""
    if url:
        path = urllib.parse.urlparse(url).path
        basename = os.path.basename(path)
    if not basename or basename in {"download", "/"}:
        basename = rname or resource["resource_id"]
    # If basename has no extension but resource_name does, prefer resource_name
    if rname and "." in rname and "." not in basename:
        basename = rname
    return safe_name(basename)


def http_size(url: str) -> tuple[int, int]:
    """HEAD the URL; return (status_code, content_length or -1)."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            cl = r.headers.get("Content-Length")
            return r.status, int(cl) if cl else -1
    except Exception:
        return 0, -1


def download(url: str, dest: Path, expected_size: int) -> tuple[str, int, str]:
    """Download with HTTP Range resume + retries.

    Returns (status, bytes_written_total, error_msg).
    status in {ok, skipped, failed}.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")

    # Already complete?
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
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, mode) as out:
                while True:
                    chunk = r.read(1024 * 256)
                    if not chunk:
                        break
                    out.write(chunk)
                    have += len(chunk)
            # Move tmp -> dest
            if dest.exists():
                dest.unlink()
            tmp.rename(dest)
            size = dest.stat().st_size
            if expected_size > 0 and size != expected_size:
                # Acceptable if no Content-Length was advertised
                return "ok", size, f"size mismatch (got {size}, expected {expected_size})"
            return "ok", size, ""
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(2 ** attempt)
            # On 416 (range not satisfiable) wipe partial and retry
            if "416" in last_err and tmp.exists():
                tmp.unlink()
                have = 0
    return "failed", (tmp.stat().st_size if tmp.exists() else 0), last_err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default=r"D:\opendatani")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="Process only first N resources (testing)")
    args = ap.parse_args()

    target = Path(args.target)
    target.mkdir(parents=True, exist_ok=True)
    manifest_path = target / "_manifest.csv"
    log_path = target / "_download.log"

    print(f"Loading resources from {RES_PATH.name} ...")
    resources = json.loads(RES_PATH.read_text(encoding="utf-8"))
    print(f"  {len(resources)} total resources")

    print("Identifying integrated packages from maps.json ...")
    uuids, slugs = load_integrated_pkg_keys()
    print(f"  {len(uuids)} UUID refs, {len(slugs)} slug refs")

    # Filter to remaining
    remaining = []
    skipped_integrated = 0
    skipped_service = 0
    for r in resources:
        pid = r.get("package_id") or ""
        pname = r.get("package_name") or ""
        if pid in uuids or pname in slugs:
            skipped_integrated += 1
            continue
        fmt = (r.get("format") or "").upper().strip()
        if fmt in SERVICE_FORMATS or fmt in WEBPAGE_FORMATS:
            skipped_service += 1
            continue
        if not (r.get("url") or "").startswith("http"):
            continue
        remaining.append(r)

    print(f"  {skipped_integrated} resources from integrated packages (skipped)")
    print(f"  {skipped_service} service/webpage resources (skipped)")
    print(f"  {len(remaining)} resources to mirror")
    total_bytes = sum((r.get("resolved_size") or 0) for r in remaining)
    print(f"  Expected payload: {total_bytes/1e9:.2f} GB")

    if args.limit:
        remaining = remaining[: args.limit]
        print(f"  --limit applied: {len(remaining)} resources")

    if args.dry_run:
        print("Dry run — exiting without downloading.")
        return

    # Prepare manifest
    manifest_existing = {}
    if manifest_path.exists():
        with manifest_path.open("r", encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                manifest_existing[row["resource_id"]] = row

    log_lock = threading.Lock()
    manifest_lock = threading.Lock()
    log_file = log_path.open("a", encoding="utf-8")
    log_file.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} mirror run ===\n")
    log_file.flush()

    # Open manifest in append mode (with header if new)
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

    counters = {"ok": 0, "skipped": 0, "failed": 0, "bytes": 0}
    counters_lock = threading.Lock()
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
    print(f"Manifest: {manifest_path}")
    print(f"Log: {log_path}")
    sys.stdout.flush()

    last_print = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(worker, r): r for r in remaining}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                fut.result()
            except Exception as e:
                log(f"WORKER ERROR: {e}")
            now = time.time()
            if now - last_print > 30 or i == len(remaining):
                with counters_lock:
                    elapsed = now - started
                    rate_mb = (counters["bytes"] / 1e6) / max(elapsed, 1)
                    print(
                        f"[{i:5}/{len(remaining)}]  "
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
