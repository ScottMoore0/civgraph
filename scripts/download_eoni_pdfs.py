#!/usr/bin/env python
"""Download all EONI SPN and Agent PDFs from the pre-fetched CDX data."""

import json
import re
import time
import urllib.request
from pathlib import Path

DELAY = 2.0
OUT_SPN = Path("_tmp_eoni_spn")
OUT_AGENT = Path("_tmp_eoni_agents")


def download(url: str, ts: str, out_path: Path) -> bool:
    if out_path.exists() and out_path.stat().st_size > 500:
        # Check it's actually a PDF
        with open(out_path, "rb") as f:
            if f.read(5) == b"%PDF-":
                return True
    archive_url = f"https://web.archive.org/web/{ts}id_/{url}"
    try:
        req = urllib.request.Request(archive_url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=30)
        data = resp.read()
        if data[:5] == b"%PDF-":
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(data)
            return True
        else:
            print(f"    Not PDF: {len(data)} bytes")
            return False
    except Exception as e:
        print(f"    Error: {e}")
        return False


def classify(fname: str, url: str) -> tuple[str, str, str]:
    """Returns (election_type, year, constituency)."""
    low = fname.lower()

    # Try to get year from filename
    m = re.search(r"(\d{4})", fname)
    year = m.group(1) if m else ""
    # Filter out GUID-like years
    if year and (int(year) < 2000 or int(year) > 2030):
        year = ""

    # Election type
    if "assembly" in low or "nia-" in low:
        etype = "assembly"
    elif "parliamentary" in low or "westminster" in low:
        etype = "westminster"
    elif "local" in low or "lgov" in low or "council" in low:
        etype = "local_govt"
    elif "european" in low or "eu-" in low:
        etype = "european"
    elif "by-election" in low or "byelection" in low:
        etype = "by_election"
    elif "referendum" in low:
        etype = "referendum"
    else:
        etype = "unknown"

    # Constituency
    # Try code suffix: -BE, -BN, etc
    cm = re.search(r"[-_]([A-Z]{2,3})(?:_\d+)?$", fname)
    if cm:
        const = cm.group(1)
    else:
        # Try full name: Belfast-East, South-Down, etc
        cm2 = re.search(r"(?:Nominated|Person-Nominated|Agent|Poll)[-_](.+?)(?:_\d+)?$", fname)
        if cm2:
            const = cm2.group(1)
        else:
            const = "unknown"

    return etype, year, const


def main():
    data = json.load(open("_tmp_eoni_filtered_pdfs.json"))

    # Filter out non-SPN/agent items
    skip_keywords = ["policy-statement", "rejected-ballot", "postal-ballot",
                     "postal-vote", "summary-of", "expenses", "canvass",
                     "guide-for-candidates", "counting-agents", "polling-agent",
                     "postal-vote-agents", "referendum-agents"]

    all_items = []
    for category in ["spn", "agents"]:
        for ts, url, status in data[category]:
            fname = url.split("/")[-1]
            low = fname.lower()
            if any(k in low for k in skip_keywords):
                continue
            is_agent = category == "agents" or "agent" in low or "appointment" in low
            pdf_type = "agent" if is_agent else "spn"
            etype, year, const = classify(fname, url)
            all_items.append((ts, url, fname, pdf_type, etype, year, const))

    print(f"Items to download: {len(all_items)}")

    # If we don't have a year, try to determine from the CDX page context
    # For now, download everything and sort later
    downloaded = 0
    failed = 0
    skipped = 0

    for ts, url, fname, pdf_type, etype, year, const in sorted(all_items):
        if etype in ("referendum",):
            skipped += 1
            continue

        if pdf_type == "agent":
            base_dir = OUT_AGENT
        else:
            base_dir = OUT_SPN

        subdir = f"{year}_{etype}" if year else f"undated_{etype}"
        safe_fname = re.sub(r"[^a-zA-Z0-9_.-]", "_", fname) + ".pdf"
        out_path = base_dir / subdir / safe_fname

        if out_path.exists() and out_path.stat().st_size > 500:
            with open(out_path, "rb") as f:
                if f.read(5) == b"%PDF-":
                    downloaded += 1
                    continue

        print(f"  [{pdf_type}] {subdir}/{safe_fname}")
        time.sleep(DELAY)
        ok = download(url, ts, out_path)
        if ok:
            downloaded += 1
        else:
            failed += 1

    print(f"\nDone: {downloaded} downloaded, {failed} failed, {skipped} skipped")

    # Summary
    for base, label in [(OUT_SPN, "SPN"), (OUT_AGENT, "AGENTS")]:
        total = sum(1 for _ in base.rglob("*.pdf"))
        dirs = sorted(set(p.parent.name for p in base.rglob("*.pdf")))
        print(f"\n{label}: {total} PDFs in {base}")
        for d in dirs:
            count = sum(1 for _ in (base / d).glob("*.pdf"))
            print(f"  {d}: {count}")


if __name__ == "__main__":
    main()
