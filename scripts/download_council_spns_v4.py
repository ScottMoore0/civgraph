#!/usr/bin/env python
"""Download newly discovered council SPN and Agent PDFs — v4.

Covers councils/DEAs with zero or partial SPN coverage from earlier scripts.
Many URLs are from pages that have since gone offline but remain on the
Internet Archive, so the script tries both the live site and the Wayback
Machine for each download.
"""

import re
import time
import urllib.request
from pathlib import Path

DELAY = 1.5

# ── All discovered URLs ──────────────────────────────────────────────
# Format: (doc_type, subdir, dea_name, url)
#
# Notes on year assignment:
#   - Ards & North Down, Mid & East Antrim, Causeway Coast & Glens: the
#     /uploads/general/ and /downloads/ paths hosted BOTH 2019 and 2023
#     documents at the same URLs (or only 2023 is archived). The PDFs
#     themselves contain the election date, so year is assigned based on
#     the document content where possible.
#   - Newry Mourne & Down: plain filenames are 2019; filenames with (1)/(2)
#     suffixes are 2023 (already in v3).
#   - Derry & Strabane: docx files from getmedia with _1 suffix appear to
#     be 2019; the getmedia PDF URLs appear to be 2023.

DOWNLOADS = [
    # =====================================================================
    # ARDS & NORTH DOWN — 2023 (ZERO prior coverage)
    # Pattern: /images/assets/{DEA}_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf
    # Live site returns 404 but Internet Archive has copies.
    # =====================================================================
    ("spn", "2023_local_ards-north-down", "Ards-Peninsula",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Ards_Peninsula_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_ards-north-down", "Bangor-Central",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Bangor_Central_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_ards-north-down", "Bangor-East-and-Donaghadee",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Bangor_East_and_Donaghadee_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_ards-north-down", "Bangor-West",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Bangor_West_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_ards-north-down", "Comber",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Comber_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_ards-north-down", "Holywood-and-Clandeboye",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Holywood_and_Clandeboye_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_ards-north-down", "Newtownards",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Newtownards_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),

    # Ards & North Down — 2019 (same pattern, same URLs — PDFs may actually
    # be 2019 or 2023; the site hosted only one set. Classify as 2019 attempt.)
    ("spn", "2019_local_ards-north-down", "Ards-Peninsula",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Ards_Peninsula_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_ards-north-down", "Bangor-Central",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Bangor_Central_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_ards-north-down", "Bangor-East-and-Donaghadee",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Bangor_East_and_Donaghadee_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_ards-north-down", "Bangor-West",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Bangor_West_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_ards-north-down", "Comber",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Comber_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_ards-north-down", "Holywood-and-Clandeboye",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Holywood_and_Clandeboye_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_ards-north-down", "Newtownards",
     "https://www.ardsandnorthdown.gov.uk/images/assets/Newtownards_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),

    # =====================================================================
    # MID & EAST ANTRIM — 2023 (ZERO prior coverage)
    # Pattern: /downloads/{DEA}_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf
    # Live site returns 404 but Internet Archive has copies.
    # =====================================================================
    ("spn", "2023_local_mid-east-antrim", "Ballymena",
     "https://www.midandeastantrim.gov.uk/downloads/BALLYMENA_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_mid-east-antrim", "Bannside",
     "https://www.midandeastantrim.gov.uk/downloads/BANNSIDE_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_mid-east-antrim", "Braid",
     "https://www.midandeastantrim.gov.uk/downloads/BRAID_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_mid-east-antrim", "Carrick-Castle",
     "https://www.midandeastantrim.gov.uk/downloads/CARRICK_CASTLE_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_mid-east-antrim", "Coast-Road",
     "https://www.midandeastantrim.gov.uk/downloads/COAST_ROAD_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_mid-east-antrim", "Knockagh",
     "https://www.midandeastantrim.gov.uk/downloads/KNOCKAGH_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2023_local_mid-east-antrim", "Larne-Lough",
     "https://www.midandeastantrim.gov.uk/downloads/LARNE_LOUGH_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),

    # Mid & East Antrim — 2019 (same URLs — may contain 2019 or 2023 data)
    ("spn", "2019_local_mid-east-antrim", "Ballymena",
     "https://www.midandeastantrim.gov.uk/downloads/BALLYMENA_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_mid-east-antrim", "Bannside",
     "https://www.midandeastantrim.gov.uk/downloads/BANNSIDE_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_mid-east-antrim", "Braid",
     "https://www.midandeastantrim.gov.uk/downloads/BRAID_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_mid-east-antrim", "Carrick-Castle",
     "https://www.midandeastantrim.gov.uk/downloads/CARRICK_CASTLE_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_mid-east-antrim", "Coast-Road",
     "https://www.midandeastantrim.gov.uk/downloads/COAST_ROAD_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_mid-east-antrim", "Knockagh",
     "https://www.midandeastantrim.gov.uk/downloads/KNOCKAGH_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),
    ("spn", "2019_local_mid-east-antrim", "Larne-Lough",
     "https://www.midandeastantrim.gov.uk/downloads/LARNE_LOUGH_-_Statement_of_Persons_Nominated_and_Notice_of_Poll.pdf"),

    # =====================================================================
    # BELFAST — 2023 (all 10 DEAs missing for 2023)
    # Same GUIDs as the 2019 URLs in download_2019_spns.py — Belfast uses
    # getmedia with stable GUIDs that serve the most recent document.
    # =====================================================================
    ("spn", "2023_local_belfast", "Balmoral",
     "https://www.belfastcity.gov.uk/getmedia/d13f28cd-c2de-4fd7-b260-7ac3660c3b32/Balmoral-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Black-Mountain",
     "https://www.belfastcity.gov.uk/getmedia/038d7a3a-9545-45ef-9dc8-e3c11a86083d/Black-Mountain-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Botanic",
     "https://www.belfastcity.gov.uk/getmedia/0a596094-c63c-4ee2-a31d-3e3ed302f922/Botanic-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Castle",
     "https://www.belfastcity.gov.uk/getmedia/77b84dcb-381e-4f07-a912-04993a8317fb/Castle-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Collin",
     "https://www.belfastcity.gov.uk/getmedia/059eb36d-849e-47c1-950a-4246ce29ed61/Collin-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Court",
     "https://www.belfastcity.gov.uk/getmedia/b444a13c-6cf4-4bc6-aa61-1702f9af5077/Court-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Lisnasharragh",
     "https://www.belfastcity.gov.uk/getmedia/7dd10a38-ca8e-4325-a8c0-64bbb16e0070/Lisnasharragh-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Oldpark",
     "https://www.belfastcity.gov.uk/getmedia/22403978-5ac5-45e4-864d-0827f283f4e5/Oldpark-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Ormiston",
     "https://www.belfastcity.gov.uk/getmedia/5b7aacce-12b8-4305-97af-24108a3b00ed/Ormiston-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),
    ("spn", "2023_local_belfast", "Titanic",
     "https://www.belfastcity.gov.uk/getmedia/994d9680-83f5-4ae4-83e2-c27874dc73d0/Titanic-Statement-of-Persons-Nominated-and-Notice-of-P.pdf"),

    # =====================================================================
    # ANTRIM & NEWTOWNABBEY — 2019 missing: Airport, Macedon
    # (Macedon 2019 already in v2; Airport 2019 found via search)
    # =====================================================================
    ("spn", "2019_local_antrim-newtownabbey", "Airport",
     "https://antrimandnewtownabbey.gov.uk/getmedia/3bdecc64-a5bd-4c2f-b49f-88c824fb62c7/AIRPORT-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),

    # ANTRIM & NEWTOWNABBEY — 2023 missing: Airport, Antrim, Ballyclare,
    # Dunsilly, Glengormley Urban
    ("spn", "2023_local_antrim-newtownabbey", "Airport",
     "https://antrimandnewtownabbey.gov.uk/getmedia/4c364c21-db88-4bda-8291-7eff345d0240/Statement-of-Persons-Nominated-and-Notice-of-Poll-Airport-A3-1-copy.pdf.aspx"),
    ("spn", "2023_local_antrim-newtownabbey", "Antrim",
     "https://antrimandnewtownabbey.gov.uk/getmedia/cd37cea4-c491-4c2a-b4ba-cd62fc739160/ANTRIM-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),
    ("spn", "2023_local_antrim-newtownabbey", "Ballyclare",
     "https://antrimandnewtownabbey.gov.uk/getmedia/f530f3a7-27f2-4f37-89ca-485ac111ea3b/Statement-of-Persons-Nominated-and-Notice-of-Poll-Ballyclare.pdf.aspx"),
    ("spn", "2023_local_antrim-newtownabbey", "Dunsilly",
     "https://antrimandnewtownabbey.gov.uk/getmedia/d8a12740-4310-4720-a005-370446ad49fe/Statement-of-Persons-Nominated-and-Notice-of-Poll-Dunsilly.pdf.aspx"),
    ("spn", "2023_local_antrim-newtownabbey", "Glengormley-Urban",
     "https://antrimandnewtownabbey.gov.uk/getmedia/e6eea68c-c745-403f-9d76-7ec3096ac088/GLENGORMLEY-URBAN-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf.aspx"),

    # =====================================================================
    # DERRY & STRABANE — 2019 missing: Ballyarnett, The Moor
    # The Derg docx (with _1 suffix) was already in download_2019_spns.py.
    # Faughan, Foyleside, Sperrin, Waterside docx files also in that script.
    # Ballyarnett and The Moor were NOT found in any script.
    # These use the getmedia/getattachment pattern with docx format.
    # =====================================================================
    ("spn", "2019_local_derry-strabane", "Ballyarnett",
     "https://www.derrystrabane.com/getmedia/ad72803c-57b8-408b-b2d7-34cf3bfb6d60/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Ballyarnett.docx"),
    ("spn", "2019_local_derry-strabane", "The-Moor",
     "https://www.derrystrabane.com/getmedia/2cca8b7e-c25b-49e5-8fb8-28e4f9b2fb1a/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-The-Moor.docx"),

    # DERRY & STRABANE — 2023 missing: Ballyarnett, Derg, Foyleside, Waterside
    # (Faughan, The Moor, Sperrin already in v3)
    ("spn", "2023_local_derry-strabane", "Ballyarnett",
     "https://www.derrystrabane.com/getmedia/ad72803c-57b8-408b-b2d7-34cf3bfb6d60/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Ballyarnett.pdf"),
    ("spn", "2023_local_derry-strabane", "Derg",
     "https://www.derrystrabane.com/getattachment/9417da6c-d441-4a91-9d63-6299fa8d095e/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Derg_1.docx"),
    ("spn", "2023_local_derry-strabane", "Foyleside",
     "https://www.derrystrabane.com/getmedia/f91341d1-398d-4b67-b8b9-3529b47c2dd0/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Foyleside.docx"),
    ("spn", "2023_local_derry-strabane", "Waterside",
     "https://www.derrystrabane.com/getmedia/3ad6bbf1-d8a6-45b2-b348-cf239e3b19ce/Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-Waterside.docx"),

    # =====================================================================
    # CAUSEWAY COAST & GLENS — 2019 (all 7 DEAs missing)
    # The /uploads/general/ PDFs appear to be from 2019. The 2023 versions
    # are in /assets/files/Council/Local-Election-Results-2023/ as docx
    # (already in v3).
    # =====================================================================
    ("spn", "2019_local_causeway-coast-glens", "Ballymoney",
     "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_Ballymoney_DEA.pdf"),
    ("spn", "2019_local_causeway-coast-glens", "Bann",
     "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_Bann.pdf"),
    ("spn", "2019_local_causeway-coast-glens", "Benbradagh",
     "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_Benbradagh.pdf"),
    ("spn", "2019_local_causeway-coast-glens", "Causeway",
     "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_Causeway.pdf"),
    ("spn", "2019_local_causeway-coast-glens", "Coleraine",
     "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_Coleraine.pdf"),
    ("spn", "2019_local_causeway-coast-glens", "The-Glens",
     "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_The_Glens.pdf"),
    ("spn", "2019_local_causeway-coast-glens", "Limavady",
     "https://causewaycoastandglens.gov.uk/uploads/general/Statement_of_Persons_Nominated_and_Notice_of_Poll_Limavady.pdf"),

    # =====================================================================
    # MID ULSTER — 2023 missing: Clogher Valley, Cookstown, Dungannon, Moyola
    # (Carntogher, Magherafelt, Torrent already in v3)
    # =====================================================================
    ("spn", "2023_local_mid-ulster", "Clogher-Valley",
     "https://www.midulstercouncil.org/getmedia/0810078e-43a6-4733-83a3-c33197928c0f/Statement-of-Persons-Nominated-and-Notice-of-Poll-Clogher-Valley-DEA.pdf.aspx"),
    ("spn", "2023_local_mid-ulster", "Cookstown",
     "https://www.midulstercouncil.org/getmedia/f3708508-5918-4c8e-9dbb-c3dc6efa7b41/Statement-of-Persons-Nominated-and-Notice-of-Poll-Cookstown-DEA.pdf.aspx"),
    ("spn", "2023_local_mid-ulster", "Dungannon",
     "https://www.midulstercouncil.org/getmedia/3db9376c-0ee0-4972-9960-2cb940d05fd6/Statement-of-Persons-Nominated-and-Notice-of-Poll-Dungannon-DEA.pdf.aspx"),
    ("spn", "2023_local_mid-ulster", "Moyola",
     "https://www.midulstercouncil.org/getmedia/2735bec5-99d6-49d4-bc11-8c02179d5a72/Statement-of-Persons-Nominated-and-Notice-of-Poll-Moyola-DEA.pdf.aspx"),

    # =====================================================================
    # ARMAGH BANBRIDGE CRAIGAVON — 2023 missing: Armagh, Lagan River
    # (Lurgan, Craigavon, Banbridge, Cusher, Portadown, The Orchard in v3)
    # Found wp-content URLs which are the 2023 versions.
    # =====================================================================
    ("spn", "2023_local_armagh-banbridge-craigavon", "Armagh",
     "https://www.armaghbanbridgecraigavon.gov.uk/wp-content/uploads/2023/04/Armagh-DEA-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf"),
    ("spn", "2023_local_armagh-banbridge-craigavon", "Lagan-River",
     "https://www.armaghbanbridgecraigavon.gov.uk/wp-content/uploads/2023/04/Lagan-River-DEA-Statement-of-Persons-Nominated-and-Notice-of-Poll.pdf"),

    # =====================================================================
    # NEWRY MOURNE & DOWN — 2019 (all 7 DEAs missing)
    # The plain filenames (no parenthetical suffixes) appear to be 2019.
    # The (1)/(2) suffixed versions are 2023 and already in v3.
    # =====================================================================
    ("spn", "2019_local_newry-mourne-down", "Newry",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_newry.pdf"),
    ("spn", "2019_local_newry-mourne-down", "Downpatrick",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_downpatrick.pdf"),
    ("spn", "2019_local_newry-mourne-down", "Crotlieve",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_crotlieve.pdf"),
    ("spn", "2019_local_newry-mourne-down", "Rowallane",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_rowallane.pdf"),
    ("spn", "2019_local_newry-mourne-down", "Slieve-Croob",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_slieve_croob.pdf"),
    ("spn", "2019_local_newry-mourne-down", "Slieve-Gullion",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll__-_slieve_gullion.pdf"),
    ("spn", "2019_local_newry-mourne-down", "The-Mournes",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll_-_the_mournes.pdf"),

    # Also try The Mournes with double underscore (variant seen in search results)
    ("spn", "2019_local_newry-mourne-down", "The-Mournes-v2",
     "https://www.newrymournedown.org/media/uploads/statement_of_persons_nominated_and_notice_of_poll__-_the_mournes.pdf"),

    # =====================================================================
    # LISBURN & CASTLEREAGH — ZERO prior coverage
    # No SPN PDFs could be found via web search, Internet Archive CDX, or
    # URL pattern guessing. The council's website is heavily JS-rendered
    # (Liferay CMS) and does not appear to publish SPN PDFs publicly.
    # The 2019 "Statement of Nominations" page exists at:
    #   https://www.lisburncastlereagh.gov.uk/council/local-council-elections-may-2019/statement-of-nominations
    # but it's JS-rendered and no downloadable PDF links were found.
    #
    # NOTE: If you find Lisburn & Castlereagh SPN URLs, add them here.
    # =====================================================================
]

# ── Election Agent PDFs (bonus finds) ────────────────────────────────
AGENT_DOWNLOADS = [
    # Newry Mourne & Down — election agents
    ("agent", "2019_local_newry-mourne-down", "Slieve-Croob",
     "https://www.newrymournedown.org/media/uploads/notice_of_appointment_of_election_agents_-_slieve_croob.pdf"),
    ("agent", "2019_local_newry-mourne-down", "Slieve-Croob-v2",
     "https://www.newrymournedown.org/media/uploads/notice_of_appointment_of_election_agents_-_slieve_croob(2).pdf"),

    # Derry & Strabane — election agents (Ballyarnett)
    ("agent", "2019_local_derry-strabane", "Ballyarnett",
     "https://www.derrystrabane.com/getattachment/728b0ea6-da96-4ff7-a2ae-b883106680cb/Local-Council-Elections-Notice-of-appointment-of-election-agents-Ballyarnett-(1).doc"),

    # Mid & East Antrim — election agents page exists at:
    # https://www.midandeastantrim.gov.uk/council/elections/local-council-elections-2023/notice-of-appointment-of-election-agents
    # but is JS-rendered; no direct PDF links found.
]


def download(url, out_path):
    """Try to download from live URL first, then Internet Archive."""
    if out_path.exists() and out_path.stat().st_size > 1000:
        with open(out_path, "rb") as f:
            header = f.read(5)
            if header == b"%PDF-" or header[:2] == b"PK":  # PDF or DOCX/DOC
                return True

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Try live URL
    time.sleep(DELAY)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=20)
        data = resp.read()
        if len(data) > 500 and (data[:5] == b"%PDF-" or data[:2] == b"PK"):
            out_path.write_bytes(data)
            return True
    except Exception:
        pass

    # Try Wayback Machine (generic redirect to best capture)
    time.sleep(DELAY)
    try:
        archive_url = f"https://web.archive.org/web/2023id_/{url}"
        req = urllib.request.Request(archive_url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=30).read()
        if len(data) > 500 and (data[:5] == b"%PDF-" or data[:2] == b"PK"):
            out_path.write_bytes(data)
            return True
    except Exception:
        pass

    # Try Wayback with 2019 timestamp
    time.sleep(DELAY)
    try:
        archive_url = f"https://web.archive.org/web/2019id_/{url}"
        req = urllib.request.Request(archive_url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=30).read()
        if len(data) > 500 and (data[:5] == b"%PDF-" or data[:2] == b"PK"):
            out_path.write_bytes(data)
            return True
    except Exception:
        pass

    return False


def main():
    downloaded = 0
    failed = 0

    all_items = [(d, s, n, u) for d, s, n, u in DOWNLOADS] + \
                [(d, s, n, u) for d, s, n, u in AGENT_DOWNLOADS]

    for doc_type, subdir, dea, url in all_items:
        ext = ".pdf"
        if url.endswith(".docx"):
            ext = ".docx"
        elif url.endswith(".doc"):
            ext = ".doc"

        safe_dea = re.sub(r"[^a-zA-Z0-9_-]", "_", dea)
        base = Path("_tmp_eoni_spn") if doc_type == "spn" else Path("_tmp_eoni_agents")
        out_path = base / subdir / f"{doc_type}-{safe_dea}{ext}"

        print(f"  [{doc_type}] {subdir}/{safe_dea}...")
        if download(url, out_path):
            size = out_path.stat().st_size
            print(f"    OK ({size:,} bytes)")
            downloaded += 1
        else:
            print(f"    FAILED")
            failed += 1

    print(f"\nDownloaded: {downloaded}, Failed: {failed}")

    # Summary by directory
    for base_label, base in [("SPN", Path("_tmp_eoni_spn")), ("Agent", Path("_tmp_eoni_agents"))]:
        if not base.exists():
            continue
        for d in sorted(base.iterdir()):
            if d.is_dir() and "local" in d.name:
                files = [f for f in d.iterdir() if f.stat().st_size > 500]
                if files:
                    print(f"  {base_label}: {d.name}: {len(files)} files")


if __name__ == "__main__":
    main()
