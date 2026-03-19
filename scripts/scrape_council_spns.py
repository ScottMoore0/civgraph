#!/usr/bin/env python
"""Scrape local government SPN and Agent PDFs from NI council websites
via the Internet Archive and live sites."""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

DELAY = 2.0
OUT_SPN = Path("_tmp_eoni_spn")
OUT_AGENT = Path("_tmp_eoni_agents")

COUNCILS = {
    "belfast": {
        "name": "Belfast",
        "domain": "www.belfastcity.gov.uk",
        "2023_url": "https://www.belfastcity.gov.uk/council/elections/local-government-elections-2023",
        "2019_url": "https://www.belfastcity.gov.uk/council/elections/local-government-elections-2019",
    },
    "antrim-newtownabbey": {
        "name": "Antrim and Newtownabbey",
        "domain": "antrimandnewtownabbey.gov.uk",
    },
    "ards-north-down": {
        "name": "Ards and North Down",
        "domain": "www.ardsandnorthdown.gov.uk",
    },
    "armagh-banbridge-craigavon": {
        "name": "Armagh, Banbridge and Craigavon",
        "domain": "www.armaghbanbridgecraigavon.gov.uk",
    },
    "causeway-coast-glens": {
        "name": "Causeway Coast and Glens",
        "domain": "www.causewaycoastandglens.gov.uk",
    },
    "derry-strabane": {
        "name": "Derry City and Strabane",
        "domain": "www.derrystrabane.com",
    },
    "fermanagh-omagh": {
        "name": "Fermanagh and Omagh",
        "domain": "www.fermanaghomagh.com",
    },
    "lisburn-castlereagh": {
        "name": "Lisburn and Castlereagh",
        "domain": "www.lisburncastlereagh.gov.uk",
    },
    "mid-east-antrim": {
        "name": "Mid and East Antrim",
        "domain": "www.midandeastantrim.gov.uk",
    },
    "mid-ulster": {
        "name": "Mid Ulster",
        "domain": "www.midulstercouncil.org",
    },
    "newry-mourne-down": {
        "name": "Newry, Mourne and Down",
        "domain": "www.newrymournedown.org",
    },
}


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        return resp.read()
    except Exception as e:
        print(f"    FAILED: {e}")
        return None


def fetch_archive_page(url):
    """Fetch a page from the Internet Archive, trying multiple timestamps."""
    # First check CDX for best timestamp
    cdx_url = (
        f"https://web.archive.org/cdx/search/cdx?"
        f"url={urllib.parse.quote(url, safe='')}"
        f"&output=json&limit=5&fl=timestamp,original,statuscode"
        f"&filter=statuscode:200&sort=reverse"
    )
    time.sleep(DELAY)
    data = fetch(cdx_url)
    if not data:
        return None, None
    rows = json.loads(data)
    if len(rows) <= 1:
        return None, None
    ts = rows[1][0]  # Latest 200 response
    archive_url = f"https://web.archive.org/web/{ts}/{url}"
    time.sleep(DELAY)
    page_data = fetch(archive_url)
    if page_data:
        return page_data.decode("utf-8", errors="replace"), ts
    return None, None


def download_pdf(url, ts, out_path):
    if out_path.exists() and out_path.stat().st_size > 1000:
        with open(out_path, "rb") as f:
            if f.read(5) == b"%PDF-":
                return True

    archive_url = f"https://web.archive.org/web/{ts}id_/{url}"
    time.sleep(DELAY)
    data = fetch(archive_url)
    if data and data[:5] == b"%PDF-":
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        return True

    # Try live URL
    time.sleep(DELAY)
    data = fetch(url)
    if data and data[:5] == b"%PDF-":
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        return True

    return False


def extract_pdf_links(html, domain):
    """Extract SPN and Agent PDF links from a council election page."""
    spn_links = []
    agent_links = []

    # Find all PDF links
    for match in re.finditer(r'href="([^"]*\.pdf[^"]*)"', html, re.I):
        url = match.group(1)
        # Resolve relative URLs
        if url.startswith("/"):
            url = f"https://{domain}{url}"
        elif url.startswith("/web/"):
            # Extract original URL from archive link
            m = re.search(r"/web/\d+/(https?://[^\"]+)", url)
            if m:
                url = m.group(1)
            else:
                continue

        low = url.lower()
        fname = url.split("/")[-1].lower()
        if "statement" in low or "nominated" in low or "persons" in low:
            if "rejected" not in low and "postal" not in low:
                spn_links.append(url)
        elif "agent" in fname and "guide" not in low:
            agent_links.append(url)

    # Also find getmedia links without .pdf extension
    for match in re.finditer(r'href="([^"]*getmedia/[^"]*(?:statement|nominated|person|agent)[^"]*)"', html, re.I):
        url = match.group(1)
        if url.startswith("/web/"):
            m = re.search(r"/web/\d+/(https?://[^\"]+)", url)
            if m:
                url = m.group(1)
        elif url.startswith("/"):
            url = f"https://{domain}{url}"

        low = url.lower()
        if "rejected" in low or "postal" in low or "guide" in low:
            continue
        if "statement" in low or "nominated" in low or "person" in low:
            spn_links.append(url)
        elif "agent" in low:
            agent_links.append(url)

    return list(set(spn_links)), list(set(agent_links))


def process_council(key, council, year):
    """Process a single council for a given election year."""
    domain = council["domain"]
    name = council["name"]

    print(f"\n{'='*60}")
    print(f"  {name} - {year}")
    print(f"{'='*60}")

    # Try known URL if available
    url_key = f"{year}_url"
    if url_key in council:
        base_url = council[url_key]
    else:
        # Try common patterns
        patterns = [
            f"https://{domain}/council/elections/local-government-elections-{year}",
            f"https://{domain}/council/elections/{year}-local-government-election",
            f"https://{domain}/elections/local-government-elections-{year}",
            f"https://{domain}/your-council/elections/local-government-elections-{year}",
            f"https://{domain}/council/elections-{year}",
            f"https://{domain}/elections/{year}",
            f"https://{domain}/residents/your-council/elections/local-government-elections-{year}",
        ]
        base_url = None
        for pattern in patterns:
            cdx_url = (
                f"https://web.archive.org/cdx/search/cdx?"
                f"url={urllib.parse.quote(pattern, safe='')}"
                f"&output=json&limit=1&fl=timestamp,original,statuscode"
                f"&filter=statuscode:200"
            )
            time.sleep(0.5)
            data = fetch(cdx_url)
            if data:
                rows = json.loads(data)
                if len(rows) > 1:
                    base_url = pattern
                    print(f"  Found: {pattern}")
                    break
        if not base_url:
            # Try CDX wildcard search
            cdx_url = (
                f"https://web.archive.org/cdx/search/cdx?"
                f"url={domain}/*{year}*election*&output=json&limit=10"
                f"&fl=timestamp,original,statuscode&filter=statuscode:200"
            )
            time.sleep(DELAY)
            data = fetch(cdx_url)
            if data:
                rows = json.loads(data)
                for row in rows[1:]:
                    if "election" in row[1].lower() and str(year) in row[1]:
                        base_url = row[1]
                        print(f"  Found via search: {base_url}")
                        break

        if not base_url:
            print(f"  No election page found for {name} {year}")
            return 0, 0

    # Fetch the page
    html, ts = fetch_archive_page(base_url)
    if not html:
        print(f"  Could not fetch page")
        return 0, 0

    # Extract PDF links
    spn_links, agent_links = extract_pdf_links(html, domain)
    print(f"  SPN PDFs: {len(spn_links)}")
    print(f"  Agent PDFs: {len(agent_links)}")

    # Download SPNs
    spn_count = 0
    safe_name = re.sub(r"[^a-zA-Z0-9]", "-", name).strip("-").lower()
    for url in spn_links:
        fname = url.split("/")[-1]
        safe_fname = re.sub(r"[^a-zA-Z0-9._-]", "_", fname)
        if not safe_fname.endswith(".pdf"):
            safe_fname += ".pdf"
        out_path = OUT_SPN / f"{year}_local_{safe_name}" / safe_fname
        print(f"    SPN: {safe_fname[:60]}...")
        if download_pdf(url, ts or "20230501", out_path):
            spn_count += 1
            print(f"      OK")
        else:
            print(f"      FAILED")

    # Download Agents
    agent_count = 0
    for url in agent_links:
        fname = url.split("/")[-1]
        safe_fname = re.sub(r"[^a-zA-Z0-9._-]", "_", fname)
        if not safe_fname.endswith(".pdf"):
            safe_fname += ".pdf"
        out_path = OUT_AGENT / f"{year}_local_{safe_name}" / safe_fname
        print(f"    Agent: {safe_fname[:60]}...")
        if download_pdf(url, ts or "20230501", out_path):
            agent_count += 1
            print(f"      OK")
        else:
            print(f"      FAILED")

    return spn_count, agent_count


def main():
    total_spn = 0
    total_agent = 0

    for year in [2023, 2019]:
        for key, council in COUNCILS.items():
            spn, agent = process_council(key, council, year)
            total_spn += spn
            total_agent += agent

    print(f"\n{'='*60}")
    print(f"  GRAND TOTAL")
    print(f"{'='*60}")
    print(f"  SPN PDFs: {total_spn}")
    print(f"  Agent PDFs: {total_agent}")

    # Summary by directory
    for base, label in [(OUT_SPN, "SPN"), (OUT_AGENT, "Agent")]:
        for d in sorted(base.iterdir()):
            if d.is_dir() and "local" in d.name:
                count = sum(1 for f in d.glob("*.pdf") if f.stat().st_size > 1000)
                if count:
                    print(f"  {label}: {d.name}: {count} PDFs")


if __name__ == "__main__":
    main()
