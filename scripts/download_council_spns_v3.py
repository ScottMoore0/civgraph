#!/usr/bin/env python
"""Download all discovered council SPN and Agent PDFs — v3 with real URLs."""

import re
import time
import urllib.request
from pathlib import Path

DELAY = 1.0

# All discovered URLs from web searches
DOWNLOADS = [
    # === ANTRIM & NEWTOWNABBEY ===
    ("spn", "2023_local_antrim-newtownabbey", "Macedon", "https://antrimandnewtownabbey.gov.uk/getmedia/cb44e45e-6ab5-4108-ad40-099afd02669e/Statement-of-Persons-Nominated-and-Notice-of-Poll-Macedon.pdf.aspx"),
    ("spn", "2023_local_antrim-newtownabbey", "Three-Mile-Water", "https://antrimandnewtownabbey.gov.uk/getmedia/d512cfa5-38d3-4f87-8c35-1a4d16da1fb4/THREE-MILE-WATER-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),

    # === ARMAGH, BANBRIDGE & CRAIGAVON ===
    ("spn", "2023_local_armagh-banbridge-craigavon", "Lurgan", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25957/lurgan.pdf"),
    ("spn", "2023_local_armagh-banbridge-craigavon", "Craigavon", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25955/craigavon.pdf"),
    # Try guessing the other DEAs based on the URL pattern /download/11325/statement-of-persons-nominated/{id}/{dea}.pdf
    ("spn", "2023_local_armagh-banbridge-craigavon", "Banbridge", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25953/banbridge.pdf"),
    ("spn", "2023_local_armagh-banbridge-craigavon", "Cusher", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25954/cusher.pdf"),
    ("spn", "2023_local_armagh-banbridge-craigavon", "Portadown", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25958/portadown.pdf"),
    ("spn", "2023_local_armagh-banbridge-craigavon", "The-Orchard", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25959/the-orchard.pdf"),

    # === CAUSEWAY COAST & GLENS (docx and pdf) ===
    ("spn", "2023_local_causeway-coast-glens", "The-Glens", "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_The_Glens.pdf"),
    ("spn", "2023_local_causeway-coast-glens", "Ballymoney-DEA", "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_Ballymoney_DEA.pdf"),
    ("spn", "2023_local_causeway-coast-glens", "Ballymoney-docx", "https://causewaycoastandglens.gov.uk/assets/files/Council/Local-Election-Results-2023/Ballymoney_Statement_of_Persons_Nominated_and_Notice_of_Poll.docx"),
    ("spn", "2023_local_causeway-coast-glens", "Bann-docx", "https://causewaycoastandglens.gov.uk/assets/files/Council/Local-Election-Results-2023/Bann__Statement_of_Persons_Nominated_and_Notice_of_Poll.docx"),
    ("spn", "2023_local_causeway-coast-glens", "Benbradagh-docx", "https://causewaycoastandglens.gov.uk/assets/files/Council/Local-Election-Results-2023/Benbradagh_Statement_of_Persons_Nominated_and_Notice_of_Poll.docx"),
    ("spn", "2023_local_causeway-coast-glens", "Causeway-docx", "https://causewaycoastandglens.gov.uk/assets/files/Council/Local-Election-Results-2023/Causeway_Statement_of_Persons_Nominated_and_Notice_of_Poll.docx"),
    ("spn", "2023_local_causeway-coast-glens", "Coleraine-docx", "https://causewaycoastandglens.gov.uk/assets/files/Council/Local-Election-Results-2023/Coleraine_Statement_of_Persons_Nominated_and_Notice_of_Poll.docx"),
    ("spn", "2023_local_causeway-coast-glens", "The-Glens-docx", "https://causewaycoastandglens.gov.uk/assets/files/Council/Local-Election-Results-2023/The_Glens_Statement_of_Persons_Nominated_and_Notice_of_Poll.docx"),
    ("spn", "2023_local_causeway-coast-glens", "Limavady-docx", "https://causewaycoastandglens.gov.uk/assets/files/Council/Local-Election-Results-2023/Limavady_Statement_of_Persons_Nominated_and_Notice_of_Poll.docx"),

    # === FERMANAGH & OMAGH ===
    ("spn", "2019_local_fermanagh-omagh", "Erne-East", "https://www.fermanaghomagh.com/app/uploads/2019/04/Statement-of-Persons-Nominated-Erne-East.pdf"),
    # Try 2023 and other DEAs
    ("spn", "2019_local_fermanagh-omagh", "Enniskillen", "https://www.fermanaghomagh.com/app/uploads/2019/04/Statement-of-Persons-Nominated-Enniskillen.pdf"),
    ("spn", "2019_local_fermanagh-omagh", "Erne-North", "https://www.fermanaghomagh.com/app/uploads/2019/04/Statement-of-Persons-Nominated-Erne-North.pdf"),
    ("spn", "2019_local_fermanagh-omagh", "Erne-West", "https://www.fermanaghomagh.com/app/uploads/2019/04/Statement-of-Persons-Nominated-Erne-West.pdf"),
    ("spn", "2019_local_fermanagh-omagh", "Mid-Tyrone", "https://www.fermanaghomagh.com/app/uploads/2019/04/Statement-of-Persons-Nominated-Mid-Tyrone.pdf"),
    ("spn", "2019_local_fermanagh-omagh", "Omagh", "https://www.fermanaghomagh.com/app/uploads/2019/04/Statement-of-Persons-Nominated-Omagh.pdf"),
    ("spn", "2019_local_fermanagh-omagh", "West-Tyrone", "https://www.fermanaghomagh.com/app/uploads/2019/04/Statement-of-Persons-Nominated-West-Tyrone.pdf"),
    # 2023
    ("spn", "2023_local_fermanagh-omagh", "Enniskillen", "https://www.fermanaghomagh.com/app/uploads/2023/04/Statement-of-Persons-Nominated-Enniskillen.pdf"),
    ("spn", "2023_local_fermanagh-omagh", "Erne-East", "https://www.fermanaghomagh.com/app/uploads/2023/04/Statement-of-Persons-Nominated-Erne-East.pdf"),
    ("spn", "2023_local_fermanagh-omagh", "Erne-North", "https://www.fermanaghomagh.com/app/uploads/2023/04/Statement-of-Persons-Nominated-Erne-North.pdf"),
    ("spn", "2023_local_fermanagh-omagh", "Erne-West", "https://www.fermanaghomagh.com/app/uploads/2023/04/Statement-of-Persons-Nominated-Erne-West.pdf"),
    ("spn", "2023_local_fermanagh-omagh", "Mid-Tyrone", "https://www.fermanaghomagh.com/app/uploads/2023/04/Statement-of-Persons-Nominated-Mid-Tyrone.pdf"),
    ("spn", "2023_local_fermanagh-omagh", "Omagh", "https://www.fermanaghomagh.com/app/uploads/2023/04/Statement-of-Persons-Nominated-Omagh.pdf"),
    ("spn", "2023_local_fermanagh-omagh", "West-Tyrone", "https://www.fermanaghomagh.com/app/uploads/2023/04/Statement-of-Persons-Nominated-West-Tyrone.pdf"),

    # === MID ULSTER (from web search + user-provided URLs) ===
    ("spn", "2023_local_mid-ulster", "Carntogher", "https://www.midulstercouncil.org/getmedia/b09dd57f-ec81-46eb-953a-a1cad60d21cb/Statement-of-Persons-Nominated-and-Notice-of-Poll-Carntogher-DEA.pdf.aspx"),
    ("spn", "2023_local_mid-ulster", "Torrent", "https://www.midulstercouncil.org/getmedia/313fddac-bcbe-4871-b8f7-5f8545174f26/Statement-of-Persons-Nominated-and-Notice-of-Poll-Torrent-DEA.pdf.aspx"),
    ("spn", "2023_local_mid-ulster", "Magherafelt", "https://www.midulstercouncil.org/getmedia/61306344-401c-4b4d-a1c6-c7a75d5205a5/Statement-of-Persons-Nominated-and-Notice-of-Poll-Magherafelt-DEA.pdf.aspx"),

    # === NEWRY, MOURNE & DOWN ===
    ("spn", "2023_local_newry-mourne-down", "Newry", "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_newry(1).pdf"),
    ("spn", "2023_local_newry-mourne-down", "Downpatrick", "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_downpatrick.pdf"),
    ("spn", "2023_local_newry-mourne-down", "Crotlieve", "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_crotlieve(2).pdf"),
    ("spn", "2023_local_newry-mourne-down", "Rowallane", "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_rowallane.pdf"),
    ("spn", "2023_local_newry-mourne-down", "Slieve-Croob", "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_slieve_croob(1).pdf"),
    ("spn", "2023_local_newry-mourne-down", "Slieve-Gullion", "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll__-_slieve_gullion.pdf"),
    ("spn", "2023_local_newry-mourne-down", "The-Mournes", "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll__-_the_mournes(2).pdf"),
]


def download(url, out_path):
    if out_path.exists() and out_path.stat().st_size > 1000:
        with open(out_path, "rb") as f:
            header = f.read(5)
            if header == b"%PDF-" or header[:2] == b"PK":  # PDF or DOCX
                return True

    out_path.parent.mkdir(parents=True, exist_ok=True)
    time.sleep(DELAY)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=30)
        data = resp.read()
        if len(data) > 500:
            out_path.write_bytes(data)
            return True
    except Exception as e:
        print(f"    Error: {e}")
    return False


def main():
    downloaded = 0
    failed = 0

    for doc_type, subdir, dea, url in DOWNLOADS:
        ext = ".docx" if url.endswith(".docx") else ".pdf"
        safe_dea = re.sub(r"[^a-zA-Z0-9_-]", "_", dea)
        base = Path("_tmp_eoni_spn") if doc_type == "spn" else Path("_tmp_eoni_agents")
        out_path = base / subdir / f"{doc_type}-{safe_dea}{ext}"

        print(f"  [{doc_type}] {subdir}/{safe_dea}...")
        if download(url, out_path):
            size = out_path.stat().st_size
            print(f"    OK ({size} bytes)")
            downloaded += 1
        else:
            print(f"    FAILED")
            failed += 1

    print(f"\nDownloaded: {downloaded}, Failed: {failed}")

    # Summary
    for base_label, base in [("SPN", Path("_tmp_eoni_spn")), ("Agent", Path("_tmp_eoni_agents"))]:
        for d in sorted(base.iterdir()):
            if d.is_dir() and "local" in d.name:
                files = [f for f in d.iterdir() if f.stat().st_size > 500]
                if files:
                    print(f"  {base_label}: {d.name}: {len(files)} files")


if __name__ == "__main__":
    main()
