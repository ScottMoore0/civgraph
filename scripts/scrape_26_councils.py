#!/usr/bin/env python
"""Scrape 2014 and 2011 SPNs from the former 26 NI council websites via Internet Archive."""

import json
import re
import time
import urllib.request
import urllib.parse
from pathlib import Path

DELAY = 2.0

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


def fetch(url, timeout=30):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        return urllib.request.urlopen(req, timeout=timeout).read()
    except Exception:
        return None


def cdx_search(domain, pattern="*"):
    """Search CDX for URLs on a domain."""
    url = (
        f"https://web.archive.org/cdx/search/cdx?"
        f"url={domain}/{pattern}&output=json&limit=10000"
        f"&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=urlkey"
    )
    time.sleep(DELAY)
    data = fetch(url)
    if not data:
        return []
    rows = json.loads(data)
    return rows[1:] if rows else []


def find_election_pages(domain):
    """Find election-related pages on a council domain."""
    rows = cdx_search(domain, "*election*")
    rows += cdx_search(domain, "*nominated*")
    rows += cdx_search(domain, "*statement*person*")
    return rows


def find_spn_pdfs(domain):
    """Find SPN and Agent PDFs directly via CDX."""
    results = []
    for pattern in ["*Persons_Nominated*", "*Persons-Nominated*",
                     "*persons_nominated*", "*persons-nominated*",
                     "*Nominated*", "*Election_Agent*", "*election_agent*",
                     "*Election-Agent*", "*election-agent*"]:
        rows = cdx_search(domain, pattern)
        for ts, url, status in rows:
            low = url.lower()
            if ".pdf" in low or "filestore" in low or "upload" in low or "download" in low:
                is_agent = "agent" in low and "guide" not in low and "candidate" not in low
                if "nominated" in low or "notice-of-poll" in low or "notice_of_poll" in low:
                    results.append((ts, url, "spn"))
                elif is_agent:
                    results.append((ts, url, "agent"))
    return results


def download_pdf(url, ts, out_path):
    """Download a PDF from archive."""
    if out_path.exists() and out_path.stat().st_size > 1000:
        with open(out_path, "rb") as f:
            if f.read(5) == b"%PDF-":
                return True

    archive_url = f"https://web.archive.org/web/{ts}id_/{url}"
    time.sleep(DELAY)
    data = fetch(archive_url)
    if data and data[:5] == b"%PDF-" and len(data) > 1000:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        return True
    return False


def main():
    all_found = []

    for council_key, domain in COUNCILS:
        print(f"\n{'='*60}")
        print(f"  {council_key} ({domain})")
        print(f"{'='*60}")

        # Also try without www and with alternate TLDs
        domains_to_try = [domain]
        if domain.startswith("www."):
            domains_to_try.append(domain[4:])
        # Try .org.uk variant for strabane
        alt = domain.replace(".com", ".org.uk").replace(".org", ".gov.uk")
        if alt != domain:
            domains_to_try.append(alt)

        spn_pdfs = []
        for d in domains_to_try:
            results = find_spn_pdfs(d)
            if results:
                print(f"  Found {len(results)} PDFs on {d}")
                spn_pdfs.extend(results)
                break

        if not spn_pdfs:
            # Try finding election pages and extracting links
            for d in domains_to_try:
                pages = find_election_pages(d)
                election_pages = [(ts, url) for ts, url, _ in pages
                                  if "election" in url.lower() and url.lower().endswith((".htm", ".html", "/", ".asp", ".aspx", ".php"))]
                if election_pages:
                    print(f"  Found {len(election_pages)} election pages on {d}")
                    # Fetch the latest election page and extract PDF links
                    latest = max(election_pages, key=lambda x: x[0])
                    ts, page_url = latest
                    time.sleep(DELAY)
                    page_data = fetch(f"https://web.archive.org/web/{ts}/{page_url}")
                    if page_data:
                        html = page_data.decode("utf-8", errors="replace")
                        pdf_links = re.findall(r'href="([^"]*(?:\.pdf|filestore|upload|download)[^"]*(?:nominat|statement|agent|person|poll)[^"]*)"', html, re.I)
                        for link in pdf_links:
                            # Resolve relative URLs
                            if link.startswith("/web/"):
                                m = re.search(r"/web/\d+/(https?://[^\"]+)", link)
                                if m:
                                    spn_pdfs.append((ts, m.group(1), "spn" if "nominat" in link.lower() or "statement" in link.lower() else "agent"))
                            elif link.startswith("/"):
                                full = f"http://{d}{link}"
                                spn_pdfs.append((ts, full, "spn" if "nominat" in link.lower() or "statement" in link.lower() else "agent"))
                    break

        if not spn_pdfs:
            print(f"  No SPNs found")
            continue

        # Deduplicate
        by_url = {}
        for ts, url, ptype in spn_pdfs:
            if url not in by_url or ts > by_url[url][0]:
                by_url[url] = (ts, ptype)

        # Download
        for url, (ts, ptype) in sorted(by_url.items()):
            fname = url.split("/")[-1]
            safe_fname = re.sub(r"[^a-zA-Z0-9._-]", "_", fname)
            if not safe_fname.endswith(".pdf"):
                safe_fname += ".pdf"

            # Determine year from URL or timestamp
            year_match = re.search(r"(2011|2014)", url)
            year = year_match.group(1) if year_match else ("2014" if int(ts[:4]) >= 2014 else "2011")

            base = OUT_AGENT if ptype == "agent" else OUT_SPN
            out_dir = base / f"{year}_local_old26_{council_key}"
            out_path = out_dir / safe_fname

            print(f"  [{ptype}] {year} {safe_fname[:60]}...")
            ok = download_pdf(url, ts, out_path)
            if ok:
                print(f"    OK ({out_path.stat().st_size:,} bytes)")
                all_found.append({"council": council_key, "year": year, "type": ptype, "url": url, "file": str(out_path)})
            else:
                print(f"    FAILED")

    # Summary
    print(f"\n{'='*60}")
    print(f"  SUMMARY")
    print(f"{'='*60}")
    for base, label in [(OUT_SPN, "SPN"), (OUT_AGENT, "Agent")]:
        for d in sorted(base.iterdir()):
            if d.is_dir() and "old26" in d.name:
                count = sum(1 for f in d.glob("*.pdf") if f.stat().st_size > 1000)
                if count:
                    print(f"  {label}: {d.name}: {count}")

    # Save manifest
    Path("_tmp_old26_manifest.json").write_text(
        json.dumps(all_found, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
