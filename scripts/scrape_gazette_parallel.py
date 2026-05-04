#!/usr/bin/env python
"""Parallel Gazette scraper — downloads PDFs using concurrent threads.

Usage:
    python scrape_gazette_parallel.py belfast_spn
    python scrape_gazette_parallel.py london_spn
    python scrape_gazette_parallel.py belfast_agents
    python scrape_gazette_parallel.py belfast_notice_of_poll
    python scrape_gazette_parallel.py belfast_polling_stations
    python scrape_gazette_parallel.py belfast_expenses

Each invocation handles one search type with concurrent PDF downloads.
Run multiple instances for different search types simultaneously.
"""

import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

PAGE_SIZE = 100
MAX_WORKERS = 5  # concurrent PDF downloads
DELAY_BETWEEN_PAGES = 1.5  # delay between JSON API page fetches
USER_AGENT = "civgraph/1.0 (gazette scraper)"

OUT_DIR = Path("_tmp_gazette")
OUT_DIR.mkdir(exist_ok=True)

# Known NI election dates for pre-filtering agent/poll notices
NI_ELECTION_YEARS = {
    1921, 1924, 1925, 1929, 1933, 1938, 1945, 1949, 1953, 1958, 1962, 1965, 1969,
    1970, 1973, 1974, 1975, 1977, 1979, 1981, 1982, 1983, 1985, 1986, 1987, 1989,
    1992, 1993, 1996, 1997, 1998, 1999, 2001, 2003, 2004, 2005, 2007, 2009, 2010,
    2011, 2014, 2015, 2016, 2017, 2018, 2019, 2022, 2023, 2024,
}

SEARCHES = {
    "belfast_spn": ("belfast", "statement of persons nominated"),
    "london_spn": ("london", "persons nominated belfast"),
    "belfast_agents": ("belfast", "appointment of agent"),
    "belfast_notice_of_poll": ("belfast", "notice of poll"),
    "belfast_polling_stations": ("belfast", "polling station"),
    "belfast_expenses": ("belfast", "election expenses"),
    "belfast_election_agent": ("belfast", "election agent"),
}

# Searches where we should pre-filter by election years
FILTER_BY_ELECTION_YEAR = {"belfast_agents", "belfast_notice_of_poll"}


def fetch(url: str, timeout: int = 60) -> bytes | None:
    """Fetch URL using curl."""
    for attempt in range(3):
        try:
            result = subprocess.run(
                ["curl", "-sS", "-f", "-L", "--max-time", str(timeout),
                 "-A", USER_AGENT, url],
                capture_output=True, timeout=timeout + 10,
            )
            if result.returncode == 0 and result.stdout:
                return result.stdout
        except Exception:
            pass
        if attempt < 2:
            time.sleep(2 * (attempt + 1))
    return None


def fetch_all_entries(edition: str, search_text: str, search_key: str) -> list[dict]:
    """Fetch all entries from JSON API."""
    all_entries = []
    page = 1
    encoded = search_text.replace(" ", "+")
    base = (
        f"https://www.thegazette.co.uk/all-notices/{edition}/notice/data.json?"
        f"results-page-size={PAGE_SIZE}&sort-by=oldest-date"
        f"&text={encoded}&categorycode-all=all"
    )

    while True:
        url = f"{base}&results-page={page}"
        time.sleep(DELAY_BETWEEN_PAGES)
        data = fetch(url)
        if not data:
            break
        try:
            j = json.loads(data)
        except json.JSONDecodeError:
            break

        total = int(j.get("f:total", 0))
        entries = j.get("entry", [])
        if isinstance(entries, dict):
            entries = [entries]
        if not entries:
            break

        # Pre-filter by election year if applicable
        if search_key in FILTER_BY_ELECTION_YEAR:
            before = len(entries)
            entries = [e for e in entries
                       if int(e.get("published", "0000")[:4]) in NI_ELECTION_YEARS]
            skipped = before - len(entries)
            if skipped:
                print(f"    Filtered {skipped} non-election-year entries")

        all_entries.extend(entries)
        print(f"  Page {page}: +{len(entries)} (total: {len(all_entries)}/{total})")

        if len(all_entries) >= total or page * PAGE_SIZE >= total:
            break
        page += 1

    return all_entries


def download_one_pdf(entry: dict, out_path: Path) -> tuple[str, bool, int]:
    """Download a single PDF. Returns (filename, success, size)."""
    if out_path.exists() and out_path.stat().st_size > 500:
        return (out_path.name, True, out_path.stat().st_size)

    links = entry.get("link", [])
    if isinstance(links, dict):
        links = [links]

    pdf_url = None
    for link in links:
        href = link.get("@href", "")
        if "data.pdf" in href or href.endswith(".pdf"):
            pdf_url = f"https://www.thegazette.co.uk{href}" if href.startswith("/") else href
            break

    if not pdf_url:
        return (out_path.name, False, 0)

    data = fetch(pdf_url, timeout=30)
    if data and len(data) > 500:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        return (out_path.name, True, len(data))
    return (out_path.name, False, 0)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in SEARCHES:
        print(f"Usage: {sys.argv[0]} <search_key>")
        print(f"Available: {', '.join(SEARCHES.keys())}")
        sys.exit(1)

    search_key = sys.argv[1]
    edition, search_text = SEARCHES[search_key]

    print(f"{'='*60}")
    print(f"  {search_key} ({edition}: \"{search_text}\")")
    print(f"  Workers: {MAX_WORKERS}")
    print(f"{'='*60}")

    out_subdir = OUT_DIR / search_key
    out_subdir.mkdir(exist_ok=True)

    # Phase 1: Fetch all JSON entries
    print(f"\nFetching entries...")
    entries = fetch_all_entries(edition, search_text, search_key)
    print(f"Total entries to download: {len(entries)}")

    if not entries:
        print("No entries found.")
        return

    # Save entries
    with open(out_subdir / "entries.json", "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)

    # Phase 2: Concurrent PDF downloads
    print(f"\nDownloading PDFs ({MAX_WORKERS} concurrent)...")
    tasks = []
    for i, entry in enumerate(entries):
        entry_id = entry.get("id", "")
        m = re.search(r"issue/(\d+)/page/(\d+)", entry_id)
        if m:
            fname = f"issue_{m.group(1)}_page_{m.group(2)}.pdf"
        else:
            fname = f"notice_{i:04d}.pdf"
        tasks.append((entry, out_subdir / fname))

    downloaded = 0
    cached = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {}
        for entry, out_path in tasks:
            fut = executor.submit(download_one_pdf, entry, out_path)
            futures[fut] = out_path.name

        for fut in as_completed(futures):
            fname, ok, size = fut.result()
            if ok:
                if size > 0:
                    downloaded += 1
                else:
                    cached += 1
                total_done = downloaded + cached
                if total_done % 25 == 0 or total_done <= 5:
                    print(f"  [{total_done}/{len(tasks)}] {fname} ({size:,} bytes)")
            else:
                failed += 1

    print(f"\nDone: {downloaded} new, {cached} cached, {failed} failed (of {len(tasks)})")


if __name__ == "__main__":
    main()
