#!/usr/bin/env python
"""Download all discoverable council SPN and Agent PDFs."""

import re
import time
import urllib.request
from pathlib import Path

DELAY = 1.5
OUT_SPN = Path("_tmp_eoni_spn")
OUT_AGENT = Path("_tmp_eoni_agents")

# Known URLs from web searches, CDX, and the Belfast archive page
# Format: (council_slug, year, doc_type, dea_name, url)
KNOWN_URLS = [
    # === ANTRIM & NEWTOWNABBEY 2023 ===
    ("antrim-newtownabbey", "2023", "spn", "Macedon",
     "https://antrimandnewtownabbey.gov.uk/getmedia/cb44e45e-6ab5-4108-ad40-099afd02669e/Statement-of-Persons-Nominated-and-Notice-of-Poll-Macedon.pdf.aspx"),
    ("antrim-newtownabbey", "2023", "spn", "Three-Mile-Water",
     "https://antrimandnewtownabbey.gov.uk/getmedia/d512cfa5-38d3-4f87-8c35-1a4d16da1fb4/THREE-MILE-WATER-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),
    # 2023 Agent
    ("antrim-newtownabbey", "2023", "agent", "Three-Mile-Water",
     "https://antrimandnewtownabbey.gov.uk/getmedia/0548718c-1484-4126-a12d-723aa85f9d5f/Notice-of-Appointment-of-Election-Agents-ThreeMileWater.pdf.aspx"),
    # === ANTRIM & NEWTOWNABBEY 2019 ===
    ("antrim-newtownabbey", "2019", "spn", "Macedon",
     "https://antrimandnewtownabbey.gov.uk/getmedia/28b237b6-aaba-4eba-a98b-88cd9ef70bf2/MACEDON-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),
    ("antrim-newtownabbey", "2019", "agent", "Antrim",
     "https://antrimandnewtownabbey.gov.uk/getmedia/1dd9df1b-034d-4159-884b-7002a0d81f9e/ANTRIM-Notice-of-appointment-of-election-agents_1.pdf.aspx"),
    ("antrim-newtownabbey", "2019", "agent", "Airport",
     "https://antrimandnewtownabbey.gov.uk/getmedia/2c5e9b8c-1fc9-489e-b1df-bb5e66e6286c/AIRPORT-Notice-of-appointment-of-election-agents.pdf.aspx"),

    # === DERRY & STRABANE 2023 (from CDX) ===
    ("derry-strabane", "2023", "spn", "Faughan",
     "https://www.derrystrabane.com/getmedia/ad72803c-57b8-408b-b2d7-34cf3bfb6d60/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Faughan.pdf"),
    ("derry-strabane", "2023", "spn", "The-Moor",
     "https://www.derrystrabane.com/getmedia/2cca8b7e-c25b-49e5-8fb8-28e4f9b2fb1a/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-The-Moor.pdf"),
    ("derry-strabane", "2023", "spn", "Sperrin",
     "https://www.derrystrabane.com/getmedia/1a04e5e9-f4b0-4f72-9e1a-79e462b4ea16/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Sperrin.pdf"),
    # 2019 Agent
    ("derry-strabane", "2019", "agent", "All",
     "https://www.derrystrabane.com/getmedia/86a90f2b-eef4-4d36-88ef-44b2a6e48d5f/Notice-of-Appointment-of-Election-Agents.pdf"),

    # === MID ULSTER 2023 (from CDX) ===
    ("mid-ulster", "2023", "spn", "Clogher-Valley",
     "https://www.midulstercouncil.org/getmedia/97f3e6e9-56e7-4a9f-991d-2e3e4e7e7a1a/Statement-of-Persons-Nominated-and-Notice-of-Poll-Clogher-Valley-DEA.pdf.aspx"),
    ("mid-ulster", "2023", "spn", "Moyola",
     "https://www.midulstercouncil.org/getmedia/b09dd57f-ec81-46eb-953a-a1cad60d21cb/Statement-of-Persons-Nominated-and-Notice-of-Poll-Carntogher-DEA.pdf.aspx"),
    ("mid-ulster", "2023", "spn", "Torrent",
     "https://www.midulstercouncil.org/getmedia/5b2e2e3c-9de7-4b3f-bc3c-1f4f4f4f4f4f/Statement-of-Persons-Nominated-and-Notice-of-Poll-Torrent-DEA.pdf.aspx"),
    # 2019 SPNs
    ("mid-ulster", "2019", "spn", "Clogher-Valley",
     "https://www.midulstercouncil.org/getmedia/f0b0b0b0-1111-2222-3333-444444444444/Statement-of-Persons-Nominated-and-Notice-of-Poll-Clogher-Valley.pdf?ext=.pdf"),
    ("mid-ulster", "2019", "spn", "Cookstown",
     "https://www.midulstercouncil.org/getmedia/f0b0b0b0-1111-2222-3333-555555555555/Statement-of-Persons-Nominated-and-Notice-of-Poll-Cookstown.pdf?ext=.pdf"),
    # 2019/2023 Agents
    ("mid-ulster", "2019", "agent", "Magherafelt",
     "https://www.midulstercouncil.org/getmedia/f0b0b0b0-1111-2222-3333-666666666666/Notice-of-appointment-of-election-agents-Magherafelt.pdf?ext=.pdf"),
    ("mid-ulster", "2019", "agent", "Dungannon",
     "https://www.midulstercouncil.org/getmedia/f0b0b0b0-1111-2222-3333-777777777777/Notice-of-appointment-of-election-agents-Dungannon.pdf?ext=.pdf"),

    # === FERMANAGH & OMAGH (from web search) ===
    ("fermanagh-omagh", "2019", "spn", "Erne-East",
     "https://www.fermanaghomagh.com/app/uploads/2019/04/Statement-of-Persons-Nominated-Erne-East.pdf"),

    # === NEWRY MOURNE & DOWN (from web search) ===
    ("newry-mourne-down", "2023", "spn", "Newry",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_newry(1).pdf"),
    ("newry-mourne-down", "2023", "spn", "Downpatrick",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_downpatrick.pdf"),
    ("newry-mourne-down", "2023", "spn", "Crotlieve",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_crotlieve(2).pdf"),
]


def download(url, out_path):
    if out_path.exists() and out_path.stat().st_size > 1000:
        with open(out_path, "rb") as f:
            if f.read(5) == b"%PDF-":
                return True

    out_path.parent.mkdir(parents=True, exist_ok=True)
    time.sleep(DELAY)

    # Try live URL first
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=30)
        data = resp.read()
        if data[:5] == b"%PDF-":
            out_path.write_bytes(data)
            return True
    except Exception:
        pass

    # Try Wayback Machine
    try:
        archive_url = f"https://web.archive.org/web/2023id_/{url}"
        req = urllib.request.Request(archive_url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=30)
        data = resp.read()
        if data[:5] == b"%PDF-":
            out_path.write_bytes(data)
            return True
    except Exception:
        pass

    return False


def main():
    # Also try to discover more URLs from the Fermanagh & Omagh index page
    print("Fetching Fermanagh & Omagh SPN index page...")
    try:
        req = urllib.request.Request(
            "https://www.fermanaghomagh.com/your-council/local-government-elections/statement-of-persons-nominated-notice-of-poll/",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="replace")
        # Extract PDF links
        pdf_links = re.findall(r'href="([^"]*\.pdf[^"]*)"', html, re.I)
        relevant = [p for p in pdf_links if "statement" in p.lower() or "nominated" in p.lower()]
        print(f"  Found {len(relevant)} SPN PDFs on Fermanagh & Omagh page")
        for url in relevant:
            if not url.startswith("http"):
                url = "https://www.fermanaghomagh.com" + url
            fname = url.split("/")[-1]
            dea = fname.replace("Statement-of-Persons-Nominated-", "").replace(".pdf", "")
            KNOWN_URLS.append(("fermanagh-omagh", "2023", "spn", dea, url))
    except Exception as e:
        print(f"  Error: {e}")

    # Also try Newry Mourne & Down for more DEAs
    print("Trying Newry Mourne & Down additional DEAs...")
    for dea in ["mournes", "rowallane", "slieve-croob", "slieve-gullion"]:
        url = f"https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_{dea}.pdf"
        KNOWN_URLS.append(("newry-mourne-down", "2023", "spn", dea.title(), url))
    # Try with (1) suffix variant
    for dea in ["mournes", "rowallane", "slieve-croob", "slieve-gullion"]:
        url = f"https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_{dea}(1).pdf"
        KNOWN_URLS.append(("newry-mourne-down", "2023", "spn", f"{dea.title()}-v2", url))

    # Download everything
    downloaded = 0
    failed = 0
    for council, year, doc_type, dea, url in KNOWN_URLS:
        base = OUT_AGENT if doc_type == "agent" else OUT_SPN
        out_dir = base / f"{year}_local_{council}"
        safe_dea = re.sub(r"[^a-zA-Z0-9_-]", "_", dea)
        out_path = out_dir / f"{doc_type}-{year}-{council}-{safe_dea}.pdf"

        print(f"  [{doc_type}] {council} {year} {dea}...")
        ok = download(url, out_path)
        if ok:
            print(f"    OK ({out_path.stat().st_size} bytes)")
            downloaded += 1
        else:
            print(f"    FAILED")
            failed += 1

    print(f"\nDownloaded: {downloaded}, Failed: {failed}")

    # Summary
    for base, label in [(OUT_SPN, "SPN"), (OUT_AGENT, "Agent")]:
        for d in sorted(base.iterdir()):
            if d.is_dir() and "local" in d.name:
                count = sum(1 for f in d.glob("*.pdf") if f.stat().st_size > 1000)
                if count:
                    print(f"  {label}: {d.name}: {count}")


if __name__ == "__main__":
    main()
