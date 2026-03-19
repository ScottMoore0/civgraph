#!/usr/bin/env python
"""Download all 2019 local government SPNs found by the search agent."""

import urllib.request
import time
from pathlib import Path

DELAY = 1.5

DOWNLOADS = [
    # BELFAST 2019
    ("2019_local_belfast", "Balmoral", "https://www.belfastcity.gov.uk/getmedia/d13f28cd-c2de-4fd7-b260-7ac3660c3b32/Balmoral-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Black-Mountain", "https://www.belfastcity.gov.uk/getmedia/038d7a3a-9545-45ef-9dc8-e3c11a86083d/Black-Mountain-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Botanic", "https://www.belfastcity.gov.uk/getmedia/0a596094-c63c-4ee2-a31d-3e3ed302f922/Botanic-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Castle", "https://www.belfastcity.gov.uk/getmedia/77b84dcb-381e-4f07-a912-04993a8317fb/Castle-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Collin", "https://www.belfastcity.gov.uk/getmedia/059eb36d-849e-47c1-950a-4246ce29ed61/Collin-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Court", "https://www.belfastcity.gov.uk/getmedia/b444a13c-6cf4-4bc6-aa61-1702f9af5077/Court-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Lisnasharragh", "https://www.belfastcity.gov.uk/getmedia/7dd10a38-ca8e-4325-a8c0-64bbb16e0070/Lisnasharragh-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Oldpark", "https://www.belfastcity.gov.uk/getmedia/22403978-5ac5-45e4-864d-0827f283f4e5/Oldpark-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Ormiston", "https://www.belfastcity.gov.uk/getmedia/5b7aacce-12b8-4305-97af-24108a3b00ed/Ormiston-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("2019_local_belfast", "Titanic", "https://www.belfastcity.gov.uk/getmedia/994d9680-83f5-4ae4-83e2-c27874dc73d0/Titanic-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),

    # ANTRIM & NEWTOWNABBEY 2019
    ("2019_local_antrim-newtownabbey", "Antrim", "https://antrimandnewtownabbey.gov.uk/getmedia/cd37cea4-c491-4c2a-b4ba-cd62fc739160/ANTRIM-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),
    ("2019_local_antrim-newtownabbey", "Ballyclare", "https://antrimandnewtownabbey.gov.uk/getmedia/e4416947-2d15-48c1-854c-8660fc6792be/BALLYCLARE-Statement-of-Persons-Nominated-and-Notice-of-Poll_1.pdf.aspx"),
    ("2019_local_antrim-newtownabbey", "Dunsilly", "https://antrimandnewtownabbey.gov.uk/getmedia/d8a12740-4310-4720-a005-370446ad49fe/Statement-of-Persons-Nominated-and-Notice-of-Poll-Dunsilly.pdf.aspx"),
    ("2019_local_antrim-newtownabbey", "Glengormley-Urban", "https://antrimandnewtownabbey.gov.uk/getmedia/e6eea68c-c745-403f-9d76-7ec3096ac088/GLENGORMLEY-URBAN-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),
    ("2019_local_antrim-newtownabbey", "Three-Mile-Water", "https://antrimandnewtownabbey.gov.uk/getmedia/d512cfa5-38d3-4f87-8c35-1a4d16da1fb4/THREE-MILE-WATER-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),

    # ARMAGH 2019 (via archive since site is down)
    ("2019_local_armagh-banbridge-craigavon", "Armagh", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25953/armagh.pdf"),
    ("2019_local_armagh-banbridge-craigavon", "Banbridge", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25952/banbridge.pdf"),
    ("2019_local_armagh-banbridge-craigavon", "Craigavon", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25955/craigavon.pdf"),
    ("2019_local_armagh-banbridge-craigavon", "Cusher", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25954/cusher.pdf"),
    ("2019_local_armagh-banbridge-craigavon", "Lagan-River", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25956/lagan-river.pdf"),
    ("2019_local_armagh-banbridge-craigavon", "Lurgan", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25957/lurgan.pdf"),
    ("2019_local_armagh-banbridge-craigavon", "Portadown", "https://www.armaghbanbridgecraigavon.gov.uk/download/11325/statement-of-persons-nominated/25958/portadown.pdf"),

    # DERRY & STRABANE 2019 (docx)
    ("2019_local_derry-strabane", "Derg", "https://www.derrystrabane.com/getattachment/9417da6c-d441-4a91-9d63-6299fa8d095e/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Derg_1.docx"),
    ("2019_local_derry-strabane", "Faughan", "https://www.derrystrabane.com/getmedia/4f3c694a-e18c-4d7b-b47d-d0be7b59724b/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Faughan.docx"),
    ("2019_local_derry-strabane", "Foyleside", "https://www.derrystrabane.com/getmedia/f91341d1-398d-4b67-b8b9-3529b47c2dd0/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Foyleside.docx"),
    ("2019_local_derry-strabane", "Sperrin", "https://www.derrystrabane.com/getmedia/a8147bdb-d6b8-4b35-8b69-08b511e177d8/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Sperrin.docx"),
    ("2019_local_derry-strabane", "Waterside", "https://www.derrystrabane.com/getmedia/3ad6bbf1-d8a6-45b2-b348-cf239e3b19ce/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Waterside.docx"),

    # MID ULSTER 2019 (same GUIDs as 2023 - these may be 2023 docs)
    ("2019_local_mid-ulster", "Carntogher", "https://www.midulstercouncil.org/getmedia/b09dd57f-ec81-46eb-953a-a1cad60d21cb/Statement-of-Persons-Nominated-and-Notice-of-Poll-Carntogher-DEA.pdf.aspx"),
    ("2019_local_mid-ulster", "Cookstown", "https://www.midulstercouncil.org/getmedia/f3708508-5918-4c8e-9dbb-c3dc6efa7b41/Statement-of-Persons-Nominated-and-Notice-of-Poll-Cookstown-DEA.pdf.aspx"),
    ("2019_local_mid-ulster", "Torrent", "https://www.midulstercouncil.org/getmedia/313fddac-bcbe-4871-b8f7-5f8545174f26/Statement-of-Persons-Nominated-and-Notice-of-Poll-Torrent-DEA.pdf.aspx"),
    ("2019_local_mid-ulster", "Magherafelt", "https://www.midulstercouncil.org/getmedia/61306344-401c-4b4d-a1c6-c7a75d5205a5/Statement-of-Persons-Nominated-and-Notice-of-Poll-Magherafelt-DEA.pdf.aspx"),
    ("2019_local_mid-ulster", "Clogher-Valley", "https://www.midulstercouncil.org/getmedia/0810078e-43a6-4733-83a3-c33197928c0f/Statement-of-Persons-Nominated-and-Notice-of-Poll-Clogher-Valley-DEA.pdf.aspx"),
    ("2019_local_mid-ulster", "Dungannon", "https://www.midulstercouncil.org/getmedia/3db9376c-0ee0-4972-9960-2cb940d05fd6/Statement-of-Persons-Nominated-and-Notice-of-Poll-Dungannon-DEA.pdf.aspx"),
    ("2019_local_mid-ulster", "Moyola", "https://www.midulstercouncil.org/getmedia/2735bec5-99d6-49d4-bc11-8c02179d5a72/Statement-of-Persons-Nominated-and-Notice-of-Poll-Moyola-DEA.pdf.aspx"),
]


def download(url, out_path):
    if out_path.exists() and out_path.stat().st_size > 5000:
        with open(out_path, "rb") as f:
            h = f.read(5)
            if h == b"%PDF-" or h[:2] == b"PK":
                return True

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Try live first
    time.sleep(DELAY)
    try:
        data = urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
            timeout=15,
        ).read()
        if len(data) > 2000 and (data[:5] == b"%PDF-" or data[:2] == b"PK"):
            out_path.write_bytes(data)
            return True
    except Exception:
        pass

    # Try archive
    time.sleep(DELAY)
    try:
        archive_url = f"https://web.archive.org/web/2023id_/{url}"
        data = urllib.request.urlopen(
            urllib.request.Request(archive_url, headers={"User-Agent": "Mozilla/5.0"}),
            timeout=30,
        ).read()
        if len(data) > 2000 and (data[:5] == b"%PDF-" or data[:2] == b"PK"):
            out_path.write_bytes(data)
            return True
    except Exception:
        pass

    return False


def main():
    ok = 0
    fail = 0
    for subdir, dea, url in DOWNLOADS:
        ext = ".docx" if url.endswith(".docx") else ".pdf"
        out = Path(f"_tmp_eoni_spn/{subdir}/spn-{dea}{ext}")
        if out.exists() and out.stat().st_size > 5000:
            ok += 1
            continue
        print(f"  {subdir}/{dea}...")
        if download(url, out):
            print(f"    OK ({out.stat().st_size:,} bytes)")
            ok += 1
        else:
            print(f"    FAILED")
            fail += 1

    print(f"\nDone: {ok} ok, {fail} failed")


if __name__ == "__main__":
    main()
