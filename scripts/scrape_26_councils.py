#!/usr/bin/env python
"""Scrape 2014, 2011 (and possibly 2005) SPNs from the former 26 NI council
websites via Internet Archive.

Strategy:
1. For each council, do a broad CDX search for ALL archived URLs
2. Scan URLs for election-related content (decoded, case-insensitive)
3. Also search for PDF/DOC files containing nomination/agent keywords
4. Fetch election index pages and extract document links
5. Download all found SPNs and Agent docs
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from collections import defaultdict
from pathlib import Path

DELAY = 3.0
CDX_DELAY = 5.0
USER_AGENT = "boundaries-website/1.0 (old-26-council scraper)"

COUNCILS = [
    ("antrim", "www.antrim.gov.uk"),
    ("ards", "www.ards-council.gov.uk"),
    ("armagh", "www.armagh.gov.uk"),
    ("ballymena", "www.ballymena.gov.uk"),
    ("ballymoney", "www.ballymoney.gov.uk"),
    ("banbridge", "www.banbridge.com"),
    ("belfast", "www.belfastcity.gov.uk"),
    ("carrickfergus", "www.carrickfergus.org"),
    ("castlereagh", "www.castlereagh.gov.uk"),
    ("coleraine", "www.colerainebc.gov.uk"),
    ("cookstown", "www.cookstown.gov.uk"),
    ("craigavon", "www.craigavon.gov.uk"),
    ("derry", "www.derrycity.gov.uk"),
    ("down", "www.downdc.gov.uk"),
    ("dungannon", "www.dungannon.gov.uk"),
    ("fermanagh", "www.fermanagh.gov.uk"),
    ("larne", "www.larne.gov.uk"),
    ("limavady", "www.limavady.gov.uk"),
    ("lisburn", "www.lisburn.gov.uk"),
    ("magherafelt", "www.magherafelt.gov.uk"),
    ("moyle", "www.moyle-council.org"),
    ("newry-mourne", "www.newryandmourne.gov.uk"),
    ("newtownabbey", "www.newtownabbey.gov.uk"),
    ("north-down", "www.northdown.gov.uk"),
    ("omagh", "www.omagh.gov.uk"),
    ("strabane", "www.strabanedc.com"),
]

OUT_SPN = Path("_tmp_eoni_spn")
OUT_AGENT = Path("_tmp_eoni_agents")
OUT_SPN.mkdir(exist_ok=True)
OUT_AGENT.mkdir(exist_ok=True)


def fetch(url: str, timeout: int = 60) -> bytes | None:
    """Fetch URL using curl."""
    for attempt in range(5):
        try:
            result = subprocess.run(
                ["curl", "-sS", "-f", "-L", "--max-time", str(timeout),
                 "-A", USER_AGENT, url],
                capture_output=True, timeout=timeout + 15,
            )
            if result.returncode == 0 and result.stdout:
                return result.stdout
            if attempt == 4:
                err = result.stderr.decode("utf-8", errors="replace").strip()
                print(f"    FAILED after 5 attempts: curl exit {result.returncode}: {err[:100]}")
                return None
        except Exception as e:
            if attempt == 4:
                print(f"    FAILED after 5 attempts: {e}")
                return None
        wait = 5 * (attempt + 1)
        time.sleep(wait)
    return None


def cdx_search(domain: str, pattern: str = "*", limit: int = 10000) -> list:
    """Search CDX for URLs on a domain."""
    time.sleep(CDX_DELAY)
    url = (
        f"https://web.archive.org/cdx/search/cdx?"
        f"url={domain}/{pattern}&output=json&limit={limit}"
        f"&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=urlkey"
    )
    data = fetch(url)
    if not data:
        return []
    try:
        rows = json.loads(data)
        return rows[1:] if rows else []
    except json.JSONDecodeError:
        return []


def decode_url(url: str) -> str:
    """URL-decode for matching purposes."""
    return urllib.parse.unquote(url).lower()


# Keywords to identify election-related documents
ELECTION_KEYWORDS = [
    "election", "nominated", "nomination", "statement of persons",
    "persons nominated", "notice of poll", "election agent",
    "appointment of agent", "candidate", "polling",
]

DOC_KEYWORDS = [
    "nominated", "statement", "persons", "agent", "appointment",
    "notice of poll", "notice_of_poll",
]

DOC_EXTENSIONS = [".pdf", ".doc", ".docx", ".PDF", ".DOC", ".DOCX"]


def is_election_doc(url: str) -> tuple[bool, str]:
    """Check if a URL is an election document. Returns (is_doc, type)."""
    decoded = decode_url(url)
    has_doc_ext = any(ext.lower() in decoded for ext in DOC_EXTENSIONS)
    has_filestore = any(x in decoded for x in ["filestore", "upload", "download", "attachment", "getmedia"])

    if not (has_doc_ext or has_filestore):
        return False, ""

    is_agent = ("agent" in decoded and "guide" not in decoded
                and "candidate" not in decoded and "polling" not in decoded)
    is_spn = any(x in decoded for x in [
        "nominated", "statement of persons", "statement%20of%20persons",
        "persons_nominated", "persons-nominated", "notice of poll",
        "notice_of_poll", "notice-of-poll",
    ])

    if is_spn:
        return True, "spn"
    elif is_agent:
        return True, "agent"
    return False, ""


def is_election_page(url: str) -> bool:
    """Check if a URL is an election-related HTML page."""
    decoded = decode_url(url)
    if any(ext in decoded for ext in [".pdf", ".doc", ".docx", ".jpg", ".png", ".css", ".js"]):
        return False
    return any(kw in decoded for kw in ELECTION_KEYWORDS)


def extract_doc_links(html: str, base_domain: str, timestamp: str) -> list:
    """Extract document links from an HTML page."""
    results = []

    # Match all href links
    for match in re.finditer(r'href="([^"]+)"', html, re.I):
        link = match.group(1)
        decoded_link = decode_url(link)

        # Check if it's an election document
        has_doc = any(ext in decoded_link for ext in [".pdf", ".doc", ".docx"])
        has_kw = any(kw in decoded_link for kw in DOC_KEYWORDS)

        if not (has_doc and has_kw):
            continue

        # Resolve the URL
        if link.startswith("/web/"):
            # Archive URL — extract original
            m = re.search(r"/web/\d+/(https?://[^\"]+)", link)
            if m:
                original = m.group(1)
            else:
                continue
        elif link.startswith("http"):
            original = link
        elif link.startswith("/"):
            original = f"http://{base_domain}{link}"
        else:
            original = f"http://{base_domain}/{link}"

        is_agent = "agent" in decoded_link and "guide" not in decoded_link
        is_spn = any(x in decoded_link for x in ["nominated", "statement", "persons", "poll"])
        ptype = "agent" if is_agent and not is_spn else "spn"

        results.append((timestamp, original, ptype))

    return results


def determine_year(url: str, timestamp: str) -> str:
    """Determine election year from URL or timestamp."""
    # Check URL for year
    for year in ["2014", "2011", "2005", "2001", "1997", "1993", "1989", "1985", "1981"]:
        if year in url:
            return year
    # Fall back to timestamp year
    ts_year = int(timestamp[:4])
    if ts_year >= 2014:
        return "2014"
    elif ts_year >= 2011:
        return "2011"
    elif ts_year >= 2005:
        return "2005"
    else:
        return str(ts_year)


def process_council(council_key: str, domain: str) -> list:
    """Process a single council — find and download all election docs."""
    print(f"\n{'='*60}")
    print(f"  {council_key} ({domain})")
    print(f"{'='*60}")

    # Build list of domains to try
    domains = [domain]
    if domain.startswith("www."):
        domains.append(domain[4:])

    all_docs = []  # (timestamp, url, type)
    election_pages = []  # (timestamp, url)

    for d in domains:
        # Phase 1: Broad CDX search — get ALL URLs and scan for election content
        print(f"  Scanning {d}...")
        rows = cdx_search(d, "*", limit=5000)
        if not rows:
            print(f"    No archived URLs found")
            continue

        print(f"    {len(rows)} archived URLs")

        for ts, url, status in rows:
            # Check for direct document links
            is_doc, ptype = is_election_doc(url)
            if is_doc:
                all_docs.append((ts, url, ptype))
                continue

            # Check for election pages we should crawl
            if is_election_page(url):
                election_pages.append((ts, url))

        # Phase 2: Targeted CDX searches for documents
        for pattern in ["*Persons*Nominated*", "*persons*nominated*",
                        "*Statement*Person*", "*statement*person*",
                        "*Election*Agent*", "*election*agent*",
                        "*Nomination*", "*nomination*",
                        "*Notice*Poll*", "*notice*poll*"]:
            extra = cdx_search(d, pattern)
            for ts, url, status in extra:
                is_doc, ptype = is_election_doc(url)
                if is_doc:
                    all_docs.append((ts, url, ptype))
                elif is_election_page(url):
                    election_pages.append((ts, url))

        if all_docs or election_pages:
            break  # Found content on this domain variant

    # Deduplicate docs found so far
    seen_urls = {}
    for ts, url, ptype in all_docs:
        if url not in seen_urls or ts > seen_urls[url][0]:
            seen_urls[url] = (ts, ptype)

    print(f"  Direct docs found: {len(seen_urls)}")
    print(f"  Election pages to crawl: {len(election_pages)}")

    # Phase 3: Crawl election pages for document links
    # Deduplicate pages and get the latest capture of each
    page_by_url = {}
    for ts, url in election_pages:
        if url not in page_by_url or ts > page_by_url[url]:
            page_by_url[url] = ts

    crawled = 0
    for page_url, ts in sorted(page_by_url.items(), key=lambda x: x[1], reverse=True):
        if crawled >= 10:  # Limit pages crawled per council
            break
        archive_url = f"https://web.archive.org/web/{ts}/{page_url}"
        time.sleep(DELAY)
        data = fetch(archive_url)
        if not data:
            continue
        crawled += 1
        html = data.decode("utf-8", errors="replace")
        d = domain if domain.startswith("www.") else f"www.{domain}"
        links = extract_doc_links(html, d, ts)
        if links:
            print(f"    Page {page_url[-60:]}: {len(links)} doc links")
        for link_ts, link_url, link_type in links:
            if link_url not in seen_urls or link_ts > seen_urls[link_url][0]:
                seen_urls[link_url] = (link_ts, link_type)

    print(f"  Total unique docs: {len(seen_urls)}")

    # Phase 4: Download documents
    downloaded = []
    for url, (ts, ptype) in sorted(seen_urls.items()):
        year = determine_year(url, ts)
        fname = urllib.parse.unquote(url.split("/")[-1].split("?")[0])
        safe_fname = re.sub(r"[^a-zA-Z0-9._-]", "_", fname)
        if not any(safe_fname.lower().endswith(ext) for ext in [".pdf", ".doc", ".docx"]):
            safe_fname += ".pdf"

        base = OUT_AGENT if ptype == "agent" else OUT_SPN
        out_dir = base / f"{year}_local_old26_{council_key}"
        out_path = out_dir / safe_fname

        # Skip if already downloaded
        if out_path.exists() and out_path.stat().st_size > 500:
            print(f"  [{ptype}] {year} {safe_fname[:55]} (cached)")
            downloaded.append({
                "council": council_key, "year": year, "type": ptype,
                "url": url, "file": str(out_path),
            })
            continue

        archive_url = f"https://web.archive.org/web/{ts}id_/{url}"
        time.sleep(DELAY)
        data = fetch(archive_url)
        if not data or len(data) < 500:
            print(f"  [{ptype}] {year} {safe_fname[:55]} FAILED (too small)")
            continue

        # Validate — accept PDF, DOC, DOCX
        is_pdf = data[:5] == b"%PDF-"
        is_doc = data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # OLE2 (doc/xls)
        is_docx = data[:4] == b"PK\x03\x04"  # ZIP (docx)
        if not (is_pdf or is_doc or is_docx):
            # Might be HTML wrapper — check if it contains PDF signature
            if b"%PDF-" in data[:200]:
                is_pdf = True
            else:
                print(f"  [{ptype}] {year} {safe_fname[:55]} FAILED (not a document)")
                continue

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        size = out_path.stat().st_size
        fmt = "PDF" if is_pdf else ("DOC" if is_doc else "DOCX")
        print(f"  [{ptype}] {year} {safe_fname[:55]} OK ({size:,} bytes, {fmt})")
        downloaded.append({
            "council": council_key, "year": year, "type": ptype,
            "url": url, "file": str(out_path),
        })

    return downloaded


def main():
    all_found = []

    for council_key, domain in COUNCILS:
        results = process_council(council_key, domain)
        all_found.extend(results)

    # Summary
    print(f"\n{'='*60}")
    print(f"  SUMMARY")
    print(f"{'='*60}")
    print(f"  Total documents found: {len(all_found)}")

    by_year = defaultdict(lambda: {"spn": 0, "agent": 0})
    by_council = defaultdict(lambda: {"spn": 0, "agent": 0})
    for item in all_found:
        by_year[item["year"]][item["type"]] += 1
        by_council[item["council"]][item["type"]] += 1

    print(f"\n  By year:")
    for year, counts in sorted(by_year.items()):
        print(f"    {year}: {counts['spn']} SPN, {counts['agent']} Agent")

    print(f"\n  By council:")
    for council, counts in sorted(by_council.items()):
        print(f"    {council}: {counts['spn']} SPN, {counts['agent']} Agent")

    # Show directories
    print(f"\n  Output directories:")
    for base, label in [(OUT_SPN, "SPN"), (OUT_AGENT, "Agent")]:
        if base.exists():
            for d in sorted(base.iterdir()):
                if d.is_dir() and "old26" in d.name:
                    count = sum(1 for f in d.iterdir() if f.stat().st_size > 500)
                    if count:
                        print(f"    {label}: {d.name}: {count} files")

    # Save manifest
    manifest_path = Path("_tmp_old26_manifest.json")
    manifest_path.write_text(json.dumps(all_found, indent=2), encoding="utf-8")
    print(f"\n  Manifest saved to {manifest_path}")


if __name__ == "__main__":
    main()
