#!/usr/bin/env python
"""Retry pass for failed downloads. Reads a manifest CSV, picks rows with
status='failed', and re-attempts each download with longer timeouts and
lower concurrency. Updates the manifest in place by appending new rows
(retry attempts) — does not edit prior rows.

Usage:
  python scripts/retry_failures.py D:\\opendatani\\_manifest.csv 2
  python scripts/retry_failures.py D:\\datagovie\\_reconcile_missing.csv 4
"""
import argparse, csv, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

UA = "Mozilla/5.0 civgraph/retry-pass"


def download(url, dest, timeout=300):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    have = tmp.stat().st_size if tmp.exists() else 0
    last_err = ""
    for attempt in range(4):
        try:
            headers = {"User-Agent": UA}
            mode = "wb"
            if have > 0:
                headers["Range"] = f"bytes={have}-"
                mode = "ab"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, mode) as out:
                while True:
                    chunk = r.read(1024 * 256)
                    if not chunk: break
                    out.write(chunk)
                    have += len(chunk)
            if dest.exists(): dest.unlink()
            tmp.rename(dest)
            return "ok", dest.stat().st_size, ""
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(3 * (attempt + 1))
            if "416" in last_err and tmp.exists():
                tmp.unlink(); have = 0
    return "failed", (tmp.stat().st_size if tmp.exists() else 0), last_err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("workers", type=int, nargs='?', default=2)
    ap.add_argument("--target-root", help="Override target root if path columns are relative")
    args = ap.parse_args()

    manifest_path = Path(args.manifest)
    target_root = Path(args.target_root) if args.target_root else manifest_path.parent

    rows_to_retry = []
    with manifest_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            if row.get("status") == "failed" or "expected_path" in row:
                rows_to_retry.append(row)

    print(f"will retry {len(rows_to_retry)} entries from {manifest_path}")
    if not rows_to_retry:
        return

    counters = {"ok": 0, "failed": 0, "bytes": 0}
    cl = Lock()
    log_file = manifest_path.with_suffix(".retry.log").open("a", encoding="utf-8")
    log_file.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} retry run ===\n")
    log_file.flush()

    def worker(row):
        url = row.get("url") or ""
        path = row.get("expected_path") or row.get("target_path") or ""
        if path and not Path(path).is_absolute():
            dest = target_root / path
        else:
            dest = Path(path)
        status, size, err = download(url, dest)
        with cl:
            counters[status] += 1
            counters["bytes"] += size
            log_file.write(f"{status}  {size:>10}  {url}  -> {dest}  {err}\n")
            log_file.flush()
        return status

    started = time.time()
    last_print = started
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(worker, r) for r in rows_to_retry]
        for i, fut in enumerate(as_completed(futs), 1):
            try: fut.result()
            except: pass
            now = time.time()
            if now - last_print > 15 or i == len(rows_to_retry):
                with cl:
                    print(f"  [{i}/{len(rows_to_retry)}]  ok={counters['ok']} failed={counters['failed']}  {counters['bytes']/1e6:.1f} MB",
                          flush=True)
                last_print = now

    print(f"\nDone in {(time.time()-started)/60:.1f} min")
    print(f"  ok={counters['ok']} failed={counters['failed']}")
    log_file.close()


if __name__ == "__main__":
    main()
