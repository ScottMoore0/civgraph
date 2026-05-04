#!/usr/bin/env python
"""Scrape election notices from the Belfast Gazette and London Gazette via their JSON API.

Targets:
1. Statements of Persons Nominated (SPNs)
2. Appointment of Election Agents
3. Notices of Poll
4. Polling Station lists
5. Election Expenses returns

Output: _tmp_gazette/ directory with JSON data and PDF downloads.
"""

import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

DELAY = 2.0
PAGE_SIZE = 100
USER_AGENT = "civgraph/1.0 (gazette scraper)"

OUT_DIR = Path("_tmp_gazette")
OUT_DIR.mkdir(exist_ok=True)

# Search queries in priority order
SEARCHES = [
    # (label, edition, search_text, subdir)
    ("Belfast SPN", "belfast", "statement of persons nominated", "belfast_spn"),
    ("London SPN (NI)", "london", "persons nominated belfast", "london_spn_ni"),
    ("Belfast Agents", "belfast", "appointment of agent", "belfast_agents"),
    ("Belfast Notice of Poll", "belfast", "notice of poll", "belfast_notice_of_poll"),
    ("Belfast Polling Stations", "belfast", "polling station", "belfast_polling_stations"),
    ("Belfast Election Expenses", "belfast", "election expenses", "belfast_expenses"),
    ("Belfast Election Agent", "belfast", "election agent", "belfast_election_agent"),
]


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
            if attempt == 2:
                err = result.stderr.decode("utf-8", errors="replace").strip()
                print(f"    FAILED: curl exit {result.returncode}: {err[:100]}")
                return None
        except Exception as e:
            if attempt == 2:
                print(f"    FAILED: {e}")
                return None
        time.sleep(3 * (attempt + 1))
    return None


def fetch_all_notices(edition: str, search_text: str) -> list[dict]:
    """Fetch all notice entries for a search query via the JSON API."""
    all_entries = []
    page = 1

    # First request to get total
    encoded_text = search_text.replace(" ", "+")
    base_url = (
        f"https://www.thegazette.co.uk/all-notices/{edition}/notice/data.json?"
        f"results-page-size={PAGE_SIZE}&sort-by=oldest-date"
        f"&text={encoded_text}&categorycode-all=all"
    )

    while True:
        url = f"{base_url}&results-page={page}"
        time.sleep(DELAY)
        data_bytes = fetch(url)
        if not data_bytes:
            break

        try:
            data = json.loads(data_bytes)
        except json.JSONDecodeError:
            print(f"    JSON decode error on page {page}")
            break

        total = int(data.get("f:total", 0))
        entries = data.get("entry", [])
        if not entries:
            break

        # Ensure entries is a list (single entry comes as dict)
        if isinstance(entries, dict):
            entries = [entries]

        all_entries.extend(entries)
        print(f"    Page {page}: {len(entries)} entries (total so far: {len(all_entries)}/{total})")

        if len(all_entries) >= total:
            break
        page += 1

    return all_entries


def download_pdf(entry: dict, out_path: Path) -> bool:
    """Download the PDF for a gazette notice entry."""
    if out_path.exists() and out_path.stat().st_size > 500:
        return True

    # Extract PDF link from entry
    links = entry.get("link", [])
    if isinstance(links, dict):
        links = [links]

    pdf_url = None
    for link in links:
        href = link.get("@href", "")
        if href.endswith(".pdf") or "data.pdf" in href:
            if href.startswith("/"):
                pdf_url = f"https://www.thegazette.co.uk{href}"
            else:
                pdf_url = href
            break

    if not pdf_url:
        return False

    time.sleep(DELAY)
    data = fetch(pdf_url)
    if data and len(data) > 500:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        return True
    return False


def extract_year_and_type(entry: dict) -> tuple[str, str]:
    """Try to determine the election year and type from notice content."""
    content = entry.get("content", "")
    if isinstance(content, dict):
        content = content.get("#text", "") or content.get("$", "") or str(content)
    pub_date = entry.get("published", "")[:4]
    title = entry.get("title", "")

    # Try to find election type from content
    content_lower = content.lower() if content else ""
    title_lower = title.lower()

    if "parliament of northern ireland" in content_lower or "stormont" in content_lower:
        etype = "stormont"
    elif "westminster" in content_lower or "house of commons" in content_lower or "parliamentary" in content_lower:
        etype = "westminster"
    elif "assembly" in content_lower:
        etype = "assembly"
    elif "european" in content_lower:
        etype = "european"
    elif "local" in content_lower or "district" in content_lower or "council" in content_lower or "borough" in content_lower:
        etype = "local"
    elif "convention" in content_lower:
        etype = "convention"
    elif "forum" in content_lower:
        etype = "forum"
    else:
        etype = "unknown"

    return pub_date, etype


def main():
    summary = {}

    for label, edition, search_text, subdir in SEARCHES:
        print(f"\n{'='*60}")
        print(f"  {label}")
        print(f"  Edition: {edition}, Search: \"{search_text}\"")
        print(f"{'='*60}")

        out_subdir = OUT_DIR / subdir
        out_subdir.mkdir(exist_ok=True)

        # Fetch all notices
        entries = fetch_all_notices(edition, search_text)
        print(f"  Total entries: {len(entries)}")

        if not entries:
            summary[label] = {"total": 0, "downloaded": 0}
            continue

        # Save entries JSON
        entries_path = out_subdir / "entries.json"
        with open(entries_path, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2, ensure_ascii=False)

        # Analyze by year
        by_year = defaultdict(list)
        for entry in entries:
            pub_date = entry.get("published", "")[:4]
            by_year[pub_date].append(entry)

        print(f"  By year:")
        for year in sorted(by_year.keys()):
            print(f"    {year}: {len(by_year[year])} notices")

        # Download PDFs
        downloaded = 0
        failed = 0
        for i, entry in enumerate(entries):
            entry_id = entry.get("id", f"unknown_{i}")
            # Extract issue/page from ID
            # e.g. "https://www.thegazette.co.uk/Belfast/issue/78/page/745"
            m = re.search(r"issue/(\d+)/page/(\d+)", entry_id)
            if m:
                issue = m.group(1)
                page = m.group(2)
                fname = f"issue_{issue}_page_{page}.pdf"
            else:
                fname = f"notice_{i:04d}.pdf"

            pub_date = entry.get("published", "")[:10]
            year, etype = extract_year_and_type(entry)

            out_path = out_subdir / fname
            ok = download_pdf(entry, out_path)
            if ok:
                downloaded += 1
                size = out_path.stat().st_size
                if (i + 1) % 20 == 0 or i < 5:
                    print(f"  [{i+1}/{len(entries)}] {pub_date} {fname} ({size:,} bytes)")
            else:
                failed += 1
                if failed <= 5:
                    print(f"  [{i+1}/{len(entries)}] {pub_date} {fname} FAILED")

        print(f"\n  Downloaded: {downloaded}, Failed: {failed}")
        summary[label] = {"total": len(entries), "downloaded": downloaded, "failed": failed}

    # Final summary
    print(f"\n{'='*60}")
    print(f"  FINAL SUMMARY")
    print(f"{'='*60}")
    for label, counts in summary.items():
        print(f"  {label}: {counts['total']} notices, {counts.get('downloaded', 0)} downloaded")

    # Save summary
    with open(OUT_DIR / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\n  Saved to {OUT_DIR / 'summary.json'}")


if __name__ == "__main__":
    # Allow running specific searches by index
    if len(sys.argv) > 1:
        indices = [int(x) for x in sys.argv[1:]]
        SEARCHES = [SEARCHES[i] for i in indices if i < len(SEARCHES)]
        print(f"Running searches: {[s[0] for s in SEARCHES]}")
    main()
