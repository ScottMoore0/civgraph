#!/usr/bin/env python
"""Scrape all EONI Statement of Persons Nominated and Notice of Appointment
of Election Agents PDFs from the Internet Archive.

Strategy:
1. Query CDX API for all EONI election pages
2. Find SPN and Agent index pages for each election
3. Download each index page
4. Extract PDF links from each page
5. Download all PDFs using id_ URLs (raw content)
"""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

OUT_DIR = Path("_tmp_eoni_spn")
AGENT_DIR = Path("_tmp_eoni_agents")
OUT_DIR.mkdir(exist_ok=True)
AGENT_DIR.mkdir(exist_ok=True)

USER_AGENT = "boundaries-website/1.0 (EONI archive scraper)"
DELAY = 1.5  # seconds between requests to be polite to archive.org


def fetch(url: str, timeout: int = 30) -> bytes | None:
    """Fetch URL with retries."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as e:
            if attempt == 2:
                print(f"    FAILED after 3 attempts: {e}")
                return None
            time.sleep(3 * (attempt + 1))
    return None


def fetch_cdx(url_pattern: str) -> list[list[str]]:
    """Query the Wayback Machine CDX API."""
    cdx_url = (
        f"https://web.archive.org/cdx/search/cdx?"
        f"url={urllib.parse.quote(url_pattern, safe='*')}"
        f"&output=json&limit=10000&fl=timestamp,original,statuscode"
        f"&filter=statuscode:200"
    )
    data = fetch(cdx_url)
    if not data:
        return []
    rows = json.loads(data)
    return rows[1:] if rows else []  # skip header


def find_election_index_pages() -> list[dict]:
    """Find all SPN and Agent index pages across all elections."""
    print("Querying CDX API for EONI election pages...")

    # Search broadly for all election results pages
    rows = fetch_cdx("www.eoni.org.uk/Elections/Election-results-and-statistics/*")
    print(f"  Total archived URLs: {len(rows)}")

    # Also search the getmedia paths for PDFs
    pdf_rows = fetch_cdx("www.eoni.org.uk/getmedia/*Statement*")
    pdf_rows += fetch_cdx("www.eoni.org.uk/getmedia/*Persons-Nominated*")
    pdf_rows += fetch_cdx("www.eoni.org.uk/getmedia/*Election-Agent*")
    pdf_rows += fetch_cdx("www.eoni.org.uk/getmedia/*election-agent*")
    pdf_rows += fetch_cdx("www.eoni.org.uk/getmedia/*Appointment*")
    print(f"  Direct PDF URLs found: {len(pdf_rows)}")

    # Find SPN index pages
    spn_pages = []
    agent_pages = []
    for ts, url, status in rows:
        low = url.lower()
        if "statement" in low and "persons" in low:
            spn_pages.append({"timestamp": ts, "url": url, "type": "spn_index"})
        elif "agent" in low and ("appointment" in low or "notice" in low):
            agent_pages.append({"timestamp": ts, "url": url, "type": "agent_index"})

    # Also find election landing pages that might link to SPNs
    election_landing = defaultdict(list)
    for ts, url, status in rows:
        m = re.search(r"Elections-(\d{4})", url)
        if m:
            year = m.group(1)
            election_landing[year].append({"timestamp": ts, "url": url})

    # Deduplicate index pages (keep latest timestamp per URL)
    seen = {}
    for page in spn_pages + agent_pages:
        key = page["url"]
        if key not in seen or page["timestamp"] > seen[key]["timestamp"]:
            seen[key] = page
    index_pages = list(seen.values())

    # Also collect direct PDF URLs
    direct_pdfs = []
    seen_pdfs = set()
    for ts, url, status in pdf_rows:
        if url not in seen_pdfs:
            seen_pdfs.add(url)
            direct_pdfs.append({"timestamp": ts, "url": url, "type": "direct_pdf"})

    print(f"  SPN index pages: {len([p for p in index_pages if p['type'] == 'spn_index'])}")
    print(f"  Agent index pages: {len([p for p in index_pages if p['type'] == 'agent_index'])}")
    print(f"  Direct PDF URLs: {len(direct_pdfs)}")
    print(f"  Election years with pages: {sorted(election_landing.keys())}")

    return index_pages, direct_pdfs, election_landing


def extract_pdf_links(html: str, base_timestamp: str) -> list[dict]:
    """Extract PDF links from an EONI index page."""
    links = []
    # Match getmedia links
    for match in re.finditer(
        r'href="(?:/web/\d+/)?(?:https?://)?(?:www\.)?eoni\.org\.uk(/getmedia/[^"]+)"',
        html,
        re.I,
    ):
        path = match.group(1)
        links.append({
            "path": path,
            "timestamp": base_timestamp,
        })
    # Also match direct archive links
    for match in re.finditer(
        r'href="(/web/\d+/https?://(?:www\.)?eoni\.org\.uk/getmedia/[^"]+)"',
        html,
        re.I,
    ):
        full_path = match.group(1)
        ts_match = re.search(r"/web/(\d+)/", full_path)
        original_match = re.search(r"/(https?://[^\"]+)", full_path)
        if ts_match and original_match:
            original = original_match.group(1)
            path = re.sub(r"^https?://(?:www\.)?eoni\.org\.uk", "", original)
            links.append({
                "path": path,
                "timestamp": ts_match.group(1),
            })
    return links


def classify_pdf(url: str) -> tuple[str, str, str]:
    """Classify a PDF URL into (election_type, year, constituency)."""
    low = url.lower()

    # Extract year
    year_match = re.search(r"(\d{4})", url)
    year = year_match.group(1) if year_match else "unknown"

    # Election type
    if "assembly" in low or "nia" in low:
        etype = "assembly"
    elif "westminster" in low or "parliamentary" in low or "uk-parl" in low:
        etype = "westminster"
    elif "local" in low or "lgov" in low or "council" in low:
        etype = "local_govt"
    elif "european" in low or "eu-" in low:
        etype = "european"
    elif "by-election" in low or "byelection" in low:
        etype = "by_election"
    else:
        etype = "unknown"

    # Constituency code
    const_match = re.search(r"Nominated-(\w+?)(?:_\d+)?$", url)
    if not const_match:
        const_match = re.search(r"Agent-(\w+?)(?:_\d+)?$", url)
    const = const_match.group(1) if const_match else "unknown"

    return etype, year, const


def download_pdf(url: str, timestamp: str, output_path: Path) -> bool:
    """Download a PDF from the Wayback Machine."""
    if output_path.exists() and output_path.stat().st_size > 1000:
        return True  # Already downloaded

    # Use id_ to get raw content
    archive_url = f"https://web.archive.org/web/{timestamp}id_/{url}"
    time.sleep(DELAY)
    data = fetch(archive_url)
    if data and data[:5] == b"%PDF-":
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(data)
        return True
    elif data:
        # Maybe HTML wrapper — try without id_
        if b"%PDF-" in data[:100]:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(data)
            return True
        print(f"    Not a PDF ({len(data)} bytes, starts with {data[:20]})")
    return False


def main():
    index_pages, direct_pdfs, election_landing = find_election_index_pages()

    all_pdfs = []  # (url, timestamp, pdf_type, election_type, year, const)

    # ── Process direct PDF URLs from CDX ──────────────────────────────────
    print(f"\nProcessing {len(direct_pdfs)} direct PDF URLs...")
    for entry in direct_pdfs:
        url = entry["url"]
        ts = entry["timestamp"]
        low = url.lower()
        if "statement" in low or "persons-nominated" in low or "nominated" in low:
            pdf_type = "spn"
        elif "agent" in low or "appointment" in low:
            pdf_type = "agent"
        else:
            pdf_type = "unknown"
        etype, year, const = classify_pdf(url)
        all_pdfs.append((url, ts, pdf_type, etype, year, const))

    # ── Download and parse SPN/Agent index pages ──────────────────────────
    print(f"\nDownloading {len(index_pages)} index pages...")
    for page in index_pages:
        ts = page["timestamp"]
        url = page["url"]
        print(f"  {url} (ts={ts})")
        time.sleep(DELAY)
        archive_url = f"https://web.archive.org/web/{ts}/{url}"
        data = fetch(archive_url)
        if not data:
            continue
        html = data.decode("utf-8", errors="replace")
        pdf_links = extract_pdf_links(html, ts)
        print(f"    Found {len(pdf_links)} PDF links")
        for link in pdf_links:
            full_url = f"http://www.eoni.org.uk{link['path']}"
            low = link["path"].lower()
            if "statement" in low or "nominated" in low:
                pdf_type = "spn"
            elif "agent" in low or "appointment" in low:
                pdf_type = "agent"
            else:
                pdf_type = "unknown"
            etype, year, const = classify_pdf(link["path"])
            all_pdfs.append((full_url, link["timestamp"], pdf_type, etype, year, const))

    # ── Also try to discover pages by crawling election landing pages ─────
    print(f"\nCrawling election landing pages for SPN/Agent links...")
    # Try common URL patterns for each year
    known_patterns = [
        # Assembly elections
        ("assembly", "2003", "NI-Assembly-Election-2003"),
        ("assembly", "2007", "NI-Assembly-Election-2007"),
        ("assembly", "2011", "NI-Assembly-Election-2011"),
        ("assembly", "2016", "NI-Assembly-Election-2016"),
        ("assembly", "2017", "NI-Assembly-Election-2017"),
        ("assembly", "2022", "NI-Assembly-Election-2022"),
        # Westminster
        ("westminster", "2005", "UK-Parliamentary-Election-2005"),
        ("westminster", "2010", "UK-Parliamentary-Election-2010"),
        ("westminster", "2015", "UK-Parliamentary-Election-2015"),
        ("westminster", "2017", "UK-Parliamentary-Election-2017"),
        ("westminster", "2019", "UK-Parliamentary-Election-2019"),
        ("westminster", "2024", "UK-Parliamentary-Election-2024"),
        # Local govt
        ("local_govt", "2005", "Local-Government-Elections-2005"),
        ("local_govt", "2011", "Local-Government-Elections-2011"),
        ("local_govt", "2014", "Local-Government-Elections-2014"),
        ("local_govt", "2019", "Local-Government-Elections-2019"),
        ("local_govt", "2023", "Local-Government-Elections-2023"),
        # European
        ("european", "2004", "European-Parliamentary-Election-2004"),
        ("european", "2009", "European-Parliamentary-Election-2009"),
        ("european", "2014", "European-Parliamentary-Election-2014"),
        ("european", "2019", "European-Parliamentary-Election-2019"),
    ]

    spn_suffixes = [
        "Statements-of-Persons-No",
        "Statements-of-Persons-Nominated",
        "Statement-of-Persons-Nominated",
    ]
    agent_suffixes = [
        "Notices-of-Appointment-of-Election-Agents",
        "Notice-of-Appointment-of-Election-Agents",
        "Notices-of-Election-Agents",
        "Notice-of-Election-Agents",
        "Election-Agents",
    ]

    base = "http://www.eoni.org.uk/Elections/Election-results-and-statistics/Election-results-and-statistics-2003-onwards"

    for etype, year, section in known_patterns:
        for suffix in spn_suffixes + agent_suffixes:
            page_url = f"{base}/Elections-{year}/{section}-{suffix}"
            # Check CDX for this URL
            cdx = fetch_cdx(page_url)
            if cdx:
                latest = max(cdx, key=lambda r: r[0])
                ts, orig, status = latest
                print(f"  Found: {orig} (ts={ts})")
                time.sleep(DELAY)
                archive_url = f"https://web.archive.org/web/{ts}/{orig}"
                data = fetch(archive_url)
                if data:
                    html = data.decode("utf-8", errors="replace")
                    pdf_links = extract_pdf_links(html, ts)
                    pdf_type = "agent" if "agent" in suffix.lower() else "spn"
                    for link in pdf_links:
                        full_url = f"http://www.eoni.org.uk{link['path']}"
                        _, yr, const = classify_pdf(link["path"])
                        all_pdfs.append((full_url, link["timestamp"], pdf_type, etype, yr or year, const))
                    print(f"    {len(pdf_links)} PDF links")

    # ── Deduplicate ───────────────────────────────────────────────────────
    seen = {}
    for url, ts, ptype, etype, year, const in all_pdfs:
        key = url
        if key not in seen or ts > seen[key][1]:
            seen[key] = (url, ts, ptype, etype, year, const)

    unique_pdfs = list(seen.values())
    spn_pdfs = [p for p in unique_pdfs if p[2] == "spn"]
    agent_pdfs = [p for p in unique_pdfs if p[2] == "agent"]
    unknown_pdfs = [p for p in unique_pdfs if p[2] == "unknown"]

    print(f"\nTotal unique PDFs found: {len(unique_pdfs)}")
    print(f"  SPN PDFs: {len(spn_pdfs)}")
    print(f"  Agent PDFs: {len(agent_pdfs)}")
    print(f"  Unknown: {len(unknown_pdfs)}")

    # Group by year and type
    by_year = defaultdict(lambda: {"spn": 0, "agent": 0, "unknown": 0})
    for url, ts, ptype, etype, year, const in unique_pdfs:
        by_year[(year, etype)][ptype] += 1
    for (year, etype), counts in sorted(by_year.items()):
        print(f"  {year} {etype}: {counts}")

    # ── Download all PDFs ─────────────────────────────────────────────────
    print(f"\nDownloading PDFs...")
    downloaded = 0
    failed = 0

    for url, ts, ptype, etype, year, const in sorted(unique_pdfs, key=lambda p: (p[4], p[3], p[5])):
        if ptype == "spn":
            out_dir = OUT_DIR / f"{year}_{etype}"
        elif ptype == "agent":
            out_dir = AGENT_DIR / f"{year}_{etype}"
        else:
            out_dir = OUT_DIR / f"{year}_{etype}_misc"

        # Generate filename
        safe_const = re.sub(r"[^a-zA-Z0-9_-]", "_", const)
        filename = f"{ptype}-{year}-{etype}-{safe_const}.pdf"
        out_path = out_dir / filename

        if out_path.exists() and out_path.stat().st_size > 1000:
            downloaded += 1
            continue

        print(f"  {filename}...")
        ok = download_pdf(url, ts, out_path)
        if ok:
            downloaded += 1
        else:
            failed += 1

    print(f"\nDone: {downloaded} downloaded, {failed} failed")

    # ── Summary ───────────────────────────────────────────────────────────
    total_spn = sum(1 for f in OUT_DIR.rglob("spn-*.pdf"))
    total_agent = sum(1 for f in AGENT_DIR.rglob("agent-*.pdf"))
    print(f"\nFinal counts:")
    print(f"  SPN PDFs: {total_spn} in {OUT_DIR}")
    print(f"  Agent PDFs: {total_agent} in {AGENT_DIR}")

    # Save manifest
    manifest = {
        "pdfs": [
            {"url": url, "timestamp": ts, "type": ptype, "election": etype, "year": year, "const": const}
            for url, ts, ptype, etype, year, const in unique_pdfs
        ]
    }
    Path("_tmp_eoni_manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
