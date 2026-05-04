#!/usr/bin/env python
"""Scrape pre-1970 NI parliamentary election data from Wikipedia.

Handles two bodies:
  1. Parliament of Northern Ireland (Stormont) — 1921 to 1969
     - 1921, 1925: STV multi-seat constituencies (9 + QUB)
     - 1929–1969: FPTP single-seat constituencies (48 + QUB STV)
  2. House of Commons (Westminster) — 1922 to 1970
     - 1922–1945: mixed (some multi-seat bloc vote, most single-seat FPTP)
     - 1950–1970: all single-seat FPTP

Results are scraped from individual constituency Wikipedia articles, which
contain "Election box" templates (FPTP) or "STV Election box" templates (STV).

Outputs per election year (in _tmp_{year}_{body}/):
  raw/              — cached wikitext for each constituency
  parsed/           — parsed JSON per constituency
  bundle/           — _bundle.json files in election-viewer format
  parties.csv       — all party names for review/deduplication
  candidates.csv    — all candidates for PersonID assignment
  summary.json      — scrape summary
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from modern_lgov_wikipedia_common import (
    clean_wiki_value,
    extract_template_blocks,
    parse_candidate_name,
    parse_dea_title,
    parse_numeric,
    parse_template_params,
)

# ── Configuration ──────────────────────────────────────────────────────────

USER_AGENT = "civgraph/1.0 (parliamentary Wikipedia scraper)"
REQUEST_DELAY_SECONDS = 0.6
RETRY_DELAYS = [5, 10, 20, 40]

# ── Stormont constituencies ───────────────────────────────────────────────

# 1921-1925: STV multi-seat constituencies
STORMONT_STV_CONSTITUENCIES = [
    {"key": "antrim", "display": "Antrim", "article": "Antrim (Northern Ireland Parliament constituency)", "seats": 7},
    {"key": "armagh", "display": "Armagh", "article": "Armagh (Northern Ireland Parliament constituency)", "seats": 4},
    {"key": "belfast_east", "display": "Belfast East", "article": "Belfast East (Northern Ireland Parliament constituency)", "seats": 4},
    {"key": "belfast_north", "display": "Belfast North", "article": "Belfast North (Northern Ireland Parliament constituency)", "seats": 4},
    {"key": "belfast_south", "display": "Belfast South", "article": "Belfast South (Northern Ireland Parliament constituency)", "seats": 4},
    {"key": "belfast_west", "display": "Belfast West", "article": "Belfast West (Northern Ireland Parliament constituency)", "seats": 4},
    {"key": "down", "display": "Down", "article": "Down (Northern Ireland Parliament constituency)", "seats": 8},
    {"key": "fermanagh_and_tyrone", "display": "Fermanagh and Tyrone", "article": "Fermanagh and Tyrone (Northern Ireland Parliament constituency)", "seats": 8},
    {"key": "londonderry", "display": "Londonderry", "article": "Londonderry (Northern Ireland Parliament constituency)", "seats": 5},
    # QUB uses STV throughout 1921-1969
    {"key": "queens_university", "display": "Queen's University Belfast", "article": "Queen's University of Belfast (Northern Ireland Parliament constituency)", "seats": 4},
]

# 1929-1965/1969: FPTP single-seat constituencies (48) + QUB (4 seats, STV)
STORMONT_FPTP_CONSTITUENCIES = [
    # Antrim
    {"key": "antrim_borough", "display": "Antrim Borough", "article": "Antrim Borough (Northern Ireland Parliament constituency)"},
    {"key": "bannside", "display": "Bannside", "article": "Bannside (Northern Ireland Parliament constituency)"},
    {"key": "carrick", "display": "Carrick", "article": "Carrick (Northern Ireland Parliament constituency)"},
    {"key": "larne", "display": "Larne", "article": "Larne (Northern Ireland Parliament constituency)"},
    {"key": "mid_antrim", "display": "Mid Antrim", "article": "Mid Antrim (Northern Ireland Parliament constituency)"},
    {"key": "north_antrim", "display": "North Antrim", "article": "North Antrim (Northern Ireland Parliament constituency)"},
    {"key": "south_antrim", "display": "South Antrim", "article": "South Antrim (Northern Ireland Parliament constituency)"},
    # Armagh
    {"key": "central_armagh", "display": "Central Armagh", "article": "Central Armagh (Northern Ireland Parliament constituency)"},
    {"key": "mid_armagh", "display": "Mid Armagh", "article": "Mid Armagh (Northern Ireland Parliament constituency)"},
    {"key": "north_armagh", "display": "North Armagh", "article": "North Armagh (Northern Ireland Parliament constituency)"},
    {"key": "south_armagh", "display": "South Armagh", "article": "South Armagh (Northern Ireland Parliament constituency)"},
    # Belfast
    {"key": "belfast_ballynafeigh", "display": "Belfast Ballynafeigh", "article": "Belfast Ballynafeigh (Northern Ireland Parliament constituency)"},
    {"key": "belfast_bloomfield", "display": "Belfast Bloomfield", "article": "Belfast Bloomfield (Northern Ireland Parliament constituency)"},
    {"key": "belfast_central", "display": "Belfast Central", "article": "Belfast Central (Northern Ireland Parliament constituency)"},
    {"key": "belfast_clifton", "display": "Belfast Clifton", "article": "Belfast Clifton (Northern Ireland Parliament constituency)"},
    {"key": "belfast_cromac", "display": "Belfast Cromac", "article": "Belfast Cromac (Northern Ireland Parliament constituency)"},
    {"key": "belfast_dock", "display": "Belfast Dock", "article": "Belfast Dock (Northern Ireland Parliament constituency)"},
    {"key": "belfast_duncairn", "display": "Belfast Duncairn", "article": "Belfast Duncairn (Northern Ireland Parliament constituency)"},
    {"key": "belfast_falls", "display": "Belfast Falls", "article": "Belfast Falls (Northern Ireland Parliament constituency)"},
    {"key": "belfast_oldpark", "display": "Belfast Oldpark", "article": "Belfast Oldpark (Northern Ireland Parliament constituency)"},
    {"key": "belfast_pottinger", "display": "Belfast Pottinger", "article": "Belfast Pottinger (Northern Ireland Parliament constituency)"},
    {"key": "belfast_st_annes", "display": "Belfast St Anne's", "article": "Belfast St Anne's (Northern Ireland Parliament constituency)"},
    {"key": "belfast_shankill", "display": "Belfast Shankill", "article": "Belfast Shankill (Northern Ireland Parliament constituency)"},
    {"key": "belfast_victoria", "display": "Belfast Victoria", "article": "Belfast Victoria (Northern Ireland Parliament constituency)"},
    {"key": "belfast_willowfield", "display": "Belfast Willowfield", "article": "Belfast Willowfield (Northern Ireland Parliament constituency)"},
    {"key": "belfast_windsor", "display": "Belfast Windsor", "article": "Belfast Windsor (Northern Ireland Parliament constituency)"},
    {"key": "belfast_woodvale", "display": "Belfast Woodvale", "article": "Belfast Woodvale (Northern Ireland Parliament constituency)"},
    # Down
    {"key": "ards", "display": "Ards", "article": "Ards (Northern Ireland Parliament constituency)"},
    # Note: Bangor only existed from 1969 — see STORMONT_1969_CONSTITUENCIES
    {"key": "east_down", "display": "East Down", "article": "East Down (Northern Ireland Parliament constituency)"},
    {"key": "iveagh", "display": "Iveagh", "article": "Iveagh (Northern Ireland Parliament constituency)"},
    {"key": "mid_down", "display": "Mid Down", "article": "Mid Down (Northern Ireland Parliament constituency)"},
    {"key": "mourne", "display": "Mourne", "article": "Mourne (Northern Ireland Parliament constituency)"},
    {"key": "north_down", "display": "North Down", "article": "North Down (Northern Ireland Parliament constituency)"},
    {"key": "south_down", "display": "South Down", "article": "South Down (Northern Ireland Parliament constituency)"},
    {"key": "west_down", "display": "West Down", "article": "West Down (Northern Ireland Parliament constituency)"},
    # Fermanagh
    {"key": "enniskillen", "display": "Enniskillen", "article": "Enniskillen (Northern Ireland Parliament constituency)"},
    {"key": "lisnaskea", "display": "Lisnaskea", "article": "Lisnaskea (Northern Ireland Parliament constituency)"},
    {"key": "south_fermanagh", "display": "South Fermanagh", "article": "South Fermanagh (Northern Ireland Parliament constituency)"},
    # Londonderry
    {"key": "city_of_londonderry", "display": "City of Londonderry", "article": "City of Londonderry (Northern Ireland Parliament constituency)"},
    {"key": "foyle", "display": "Foyle", "article": "Foyle (Northern Ireland Parliament constituency)"},
    {"key": "mid_londonderry", "display": "Mid Londonderry", "article": "Mid Londonderry (Northern Ireland Parliament constituency)"},
    {"key": "north_londonderry", "display": "North Londonderry", "article": "North Londonderry (Northern Ireland Parliament constituency)"},
    {"key": "south_londonderry", "display": "South Londonderry", "article": "South Londonderry (Northern Ireland Parliament constituency)"},
    # Tyrone
    {"key": "east_tyrone", "display": "East Tyrone", "article": "East Tyrone (Northern Ireland Parliament constituency)"},
    {"key": "mid_tyrone", "display": "Mid Tyrone", "article": "Mid Tyrone (Northern Ireland Parliament constituency)"},
    {"key": "north_tyrone", "display": "North Tyrone", "article": "North Tyrone (Northern Ireland Parliament constituency)"},
    {"key": "south_tyrone", "display": "South Tyrone", "article": "South Tyrone (Northern Ireland Parliament constituency)"},
    {"key": "west_tyrone", "display": "West Tyrone", "article": "West Tyrone (Northern Ireland Parliament constituency)"},
]

# New constituencies added in 1969
STORMONT_1969_CONSTITUENCIES = [
    {"key": "larkfield", "display": "Larkfield", "article": "Larkfield (Northern Ireland Parliament constituency)"},
    {"key": "newtownabbey", "display": "Newtownabbey", "article": "Newtownabbey (Northern Ireland Parliament constituency)"},
    {"key": "bangor_new", "display": "Bangor", "article": "Bangor (Northern Ireland Parliament constituency)"},
    {"key": "lagan_valley", "display": "Lagan Valley", "article": "Lagan Valley (Northern Ireland Parliament constituency)"},
]

# ── Westminster constituencies ─────────────────────────────────────────────

# 1922-1945: 10 constituencies (13 seats — Antrim 2 seats, Fermanagh & Tyrone 2 seats, QUB 1 seat)
WESTMINSTER_1922_CONSTITUENCIES = [
    {"key": "antrim", "display": "Antrim", "article": "Antrim (UK Parliament constituency)", "seats": 2},
    {"key": "armagh", "display": "Armagh", "article": "Armagh (UK Parliament constituency)", "seats": 1},
    {"key": "belfast_east", "display": "Belfast East", "article": "Belfast East (UK Parliament constituency)", "seats": 1},
    {"key": "belfast_north", "display": "Belfast North", "article": "Belfast North (UK Parliament constituency)", "seats": 1},
    {"key": "belfast_south", "display": "Belfast South", "article": "Belfast South (UK Parliament constituency)", "seats": 1},
    {"key": "belfast_west", "display": "Belfast West", "article": "Belfast West (UK Parliament constituency)", "seats": 1},
    {"key": "down", "display": "Down", "article": "Down (UK Parliament constituency)", "seats": 2},
    {"key": "fermanagh_and_tyrone", "display": "Fermanagh and Tyrone", "article": "Fermanagh and Tyrone (UK Parliament constituency)", "seats": 2},
    {"key": "londonderry", "display": "Londonderry", "article": "Londonderry (UK Parliament constituency)", "seats": 1},
    {"key": "queens_university", "display": "Queen's University Belfast", "article": "Queen's University of Belfast (UK Parliament constituency)", "seats": 1},
]

# 1950-1970: 12 single-seat constituencies
WESTMINSTER_1950_CONSTITUENCIES = [
    {"key": "north_antrim", "display": "North Antrim", "article": "North Antrim (UK Parliament constituency)", "seats": 1},
    {"key": "south_antrim", "display": "South Antrim", "article": "South Antrim (UK Parliament constituency)", "seats": 1},
    {"key": "armagh", "display": "Armagh", "article": "Armagh (UK Parliament constituency)", "seats": 1},
    {"key": "belfast_east", "display": "Belfast East", "article": "Belfast East (UK Parliament constituency)", "seats": 1},
    {"key": "belfast_north", "display": "Belfast North", "article": "Belfast North (UK Parliament constituency)", "seats": 1},
    {"key": "belfast_south", "display": "Belfast South", "article": "Belfast South (UK Parliament constituency)", "seats": 1},
    {"key": "belfast_west", "display": "Belfast West", "article": "Belfast West (UK Parliament constituency)", "seats": 1},
    {"key": "north_down", "display": "North Down", "article": "North Down (UK Parliament constituency)", "seats": 1},
    {"key": "south_down", "display": "South Down", "article": "South Down (UK Parliament constituency)", "seats": 1},
    {"key": "fermanagh_and_south_tyrone", "display": "Fermanagh and South Tyrone", "article": "Fermanagh and South Tyrone (UK Parliament constituency)", "seats": 1},
    {"key": "londonderry", "display": "Londonderry", "article": "Londonderry (UK Parliament constituency)", "seats": 1},
    {"key": "mid_ulster", "display": "Mid Ulster", "article": "Mid Ulster (UK Parliament constituency)", "seats": 1},
]

# ── Election dates ─────────────────────────────────────────────────────────

STORMONT_ELECTIONS: dict[int, str] = {
    1921: "1921-05-24",
    1925: "1925-04-03",
    1929: "1929-05-22",
    1933: "1933-11-30",
    1938: "1938-02-09",
    1945: "1945-06-14",
    1949: "1949-02-10",
    1953: "1953-10-22",
    1958: "1958-03-20",
    1962: "1962-05-31",
    1965: "1965-11-25",
    1969: "1969-02-24",
}

WESTMINSTER_ELECTIONS: dict[int, str] = {
    1922: "1922-11-15",
    1923: "1923-12-06",
    1924: "1924-10-29",
    1929: "1929-05-30",
    1931: "1931-10-27",
    1935: "1935-11-14",
    1945: "1945-07-05",
    1950: "1950-02-23",
    1951: "1951-10-25",
    1955: "1955-05-26",
    1959: "1959-10-08",
    1964: "1964-10-15",
    1966: "1966-03-31",
}

# ── Party colours ──────────────────────────────────────────────────────────

PARTY_COLOURS: dict[str, str] = {
    "UUP": "#48A5EE",
    "Ulster Unionist Party": "#48A5EE",
    "DUP": "#D46A4C",
    "Democratic Unionist Party": "#D46A4C",
    "Sinn Féin": "#326760",
    "Sinn Fein": "#326760",
    "SDLP": "#2AA82C",
    "Social Democratic and Labour Party": "#2AA82C",
    "Alliance": "#F6CB2F",
    "Alliance Party of Northern Ireland": "#F6CB2F",
    "Independent": "#DCDCDC",
    "Independent Unionist": "#AADFFF",
    "Independent Nationalist": "#CDFFAB",
    "Independent Republican": "#CDFFAB",
    "Independent Labour": "#FF9999",
    "Nationalist Party": "#32CD32",
    "NI Labour": "#DC241F",
    "Northern Ireland Labour Party": "#DC241F",
    "Belfast Labour Party": "#DC241F",
    "Republican Labour Party": "#85DE59",
    "Republican Clubs": "#930C1A",
    "Workers Party": "#930C1A",
    "People's Democracy": "#FF0000",
    "PUP": "#2B45A2",
    "Progressive Unionist Party": "#2B45A2",
    "Vanguard Unionist Progressive Party": "#FF8C00",
    "Protestant Unionist": "#D46A4C",
    "Protestant Unionist Party": "#D46A4C",
    "Ulster Popular Unionist Party": "#FFDEAD",
    "Ulster Democratic Party": "#000000",
    "Unionist Party of Northern Ireland": "#FFA07A",
    "United Ulster Unionist Party": "#FF8C00",
    "Ulster Liberal Party": "#DAA520",
    "Liberal Party": "#FDBB30",
    "Communist Party of Northern Ireland": "#E3170D",
    "Communist Party of Ireland": "#E3170D",
    "Irish Labour Party": "#CC0000",
    "Irish Labour": "#CC0000",
    "Federation of Labour": "#CD5C5C",
    "Green / Ecology": "#8DC63F",
    "TUV": "#0C3A6A",
    "Conservative": "#0087DC",
    "National Democratic Party": "#90EE90",
    "Republican Sinn Féin": "#008800",
    "Anti H-Block": "#000000",
    "Unity": "#90EE90",
    "IRSP": "#FF0000",
    "Irish Republican Socialist Party": "#FF0000",
    "National League of the North": "#32CD32",
    "New Party": "#8B4513",
    "Ulster Progressive Unionist Association": "#87CEEB",
    "Commonwealth Labour Party": "#DC241F",
    "Socialist Republican Party": "#FF4500",
    "Midlands and West Tyrone Regional Party": "#808080",
    "Northern Ireland Civil Rights Association": "#FFD700",
    "Loyalist": "#FFD700",
}

# ── Party normalisation ────────────────────────────────────────────────────

PARTY_NORMALISATION: dict[str, str] = {
    "ulster unionist party": "UUP",
    "democratic unionist party": "DUP",
    "social democratic and labour party": "SDLP",
    "sinn féin": "Sinn Féin",
    "sinn fein": "Sinn Féin",
    "alliance party of northern ireland": "Alliance",
    "alliance party": "Alliance",
    "nationalist party (northern ireland)": "Nationalist Party",
    "nationalist party": "Nationalist Party",
    "national league of the north": "Nationalist Party",
    "northern ireland labour party": "NI Labour",
    "labour party of northern ireland": "NI Labour",
    "belfast labour party": "Belfast Labour Party",
    "commonwealth labour party": "Commonwealth Labour Party",
    "republican labour party": "Republican Labour Party",
    "republican clubs": "Republican Clubs",
    "workers' party (ireland)": "Workers Party",
    "workers' party": "Workers Party",
    "irish republican socialist party": "IRSP",
    "people's democracy (ireland)": "People's Democracy",
    "people's democracy": "People's Democracy",
    "independent (politician)": "Independent",
    "independent": "Independent",
    "independent unionist": "Independent Unionist",
    "independent nationalist": "Independent Nationalist",
    "independent republican (ireland)": "Independent Republican",
    "independent republican": "Independent Republican",
    "independent labour": "Independent Labour",
    "independent socialist": "Independent Socialist",
    "progressive unionist party": "PUP",
    "traditional unionist voice": "TUV",
    "vanguard unionist progressive party": "Vanguard Unionist Progressive Party",
    "protestant unionist party": "Protestant Unionist Party",
    "protestant unionist": "Protestant Unionist Party",
    "ulster popular unionist party": "Ulster Popular Unionist Party",
    "ulster democratic party": "Ulster Democratic Party",
    "unionist party of northern ireland": "Unionist Party of Northern Ireland",
    "united ulster unionist party": "United Ulster Unionist Party",
    "ulster liberal party": "Ulster Liberal Party",
    "liberal party (uk)": "Liberal Party",
    "liberal party": "Liberal Party",
    "communist party of northern ireland": "Communist Party of Northern Ireland",
    "communist party of ireland": "Communist Party of Ireland",
    "irish labour party": "Irish Labour Party",
    "irish labour": "Irish Labour Party",
    "federation of labour (ireland)": "Federation of Labour",
    "federation of labour": "Federation of Labour",
    "green party in northern ireland": "Green / Ecology",
    "green party of northern ireland": "Green / Ecology",
    "green party northern ireland": "Green / Ecology",
    "conservative party (uk)": "Conservative",
    "northern ireland conservatives": "Conservative",
    "national democratic party (northern ireland)": "National Democratic Party",
    "national democratic party": "National Democratic Party",
    "republican sinn féin": "Republican Sinn Féin",
    "anti h-block": "Anti H-Block",
    "unity (northern ireland)": "Unity",
    "new party (uk)": "New Party",
    "ulster progressive unionist association": "Ulster Progressive Unionist Association",
    "socialist republican party": "Socialist Republican Party",
}


# ── Fetching ───────────────────────────────────────────────────────────────

def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt, delay in enumerate([0, *RETRY_DELAYS]):
        if delay:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                text = response.read().decode("utf-8")
                time.sleep(REQUEST_DELAY_SECONDS)
                return text
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code != 429 or attempt == len(RETRY_DELAYS):
                raise
        except Exception as exc:
            last_error = exc
            if attempt == len(RETRY_DELAYS):
                raise
    raise RuntimeError(f"Failed after retries: {url}") from last_error


def fetch_raw_title(title: str) -> str | None:
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe=":'_()")
    url = f"https://en.wikipedia.org/wiki/{encoded}?action=raw"
    try:
        return fetch_text(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


# ── Parsing helpers ────────────────────────────────────────────────────────

def normalise_party(raw: str) -> str:
    if not raw:
        return "Independent"
    cleaned = raw.strip()
    if "|" in cleaned:
        cleaned = cleaned.split("|")[-1].strip()
    lowered = cleaned.lower()
    for needle, replacement in PARTY_NORMALISATION.items():
        if needle in lowered:
            return replacement
    return cleaned


def get_party_colour(party: str) -> str:
    colour = PARTY_COLOURS.get(party)
    if colour:
        return colour
    lowered = party.lower()
    for k, v in PARTY_COLOURS.items():
        if k.lower() == lowered:
            return v
    digest = hashlib.sha1(party.encode("utf-8")).hexdigest()
    r = (int(digest[0:2], 16) + 96) % 256
    g = (int(digest[2:4], 16) + 96) % 256
    b = (int(digest[4:6], 16) + 96) % 256
    return f"#{r:02X}{g:02X}{b:02X}"


def generate_temp_person_id(name: str) -> str:
    key = re.sub(r"\s+", " ", name.strip().lower())
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return f"T{int(digest[:8], 16)}"


def split_name(display_name: str) -> tuple[str, str]:
    parts = display_name.strip().split()
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return ("", parts[0])
    return (" ".join(parts[:-1]), parts[-1])


def clean_candidate_name(raw: str) -> str:
    """Extract display name from Election box candidate field."""
    # Remove wiki links: [[Foo|Bar]] → Bar, [[Foo]] → Foo
    cleaned = re.sub(r"\[\[([^|\]]*\|)?([^\]]*)\]\]", r"\2", raw)
    # Remove bold markers
    cleaned = cleaned.replace("'''", "")
    # Remove refs and templates
    cleaned = re.sub(r"<ref[^>]*>.*?</ref>", "", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"<ref[^/]*/?>", "", cleaned)
    cleaned = re.sub(r"\{\{[^}]*\}\}", "", cleaned)
    # Clean whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def parse_votes(raw: str) -> float | None:
    """Parse a vote count string, handling commas and special values."""
    if not raw:
        return None
    cleaned = raw.strip().replace(",", "").replace("&nbsp;", "")
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    cleaned = re.sub(r"\{\{[^}]*\}\}", "", cleaned)
    cleaned = cleaned.strip()
    if not cleaned or cleaned == "—" or cleaned == "-" or cleaned == "–":
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


# ── FPTP Election Box Parsing ──────────────────────────────────────────────

def parse_fptp_elections(wikitext: str, constituency_display: str) -> list[dict]:
    """Parse all FPTP Election box sections from a constituency page.

    Returns a list of election dicts, each with:
      year, title, seats, candidates[], turnout, majority, electorate
    """
    elections: list[dict] = []

    # Find all "Election box begin" blocks
    begin_blocks = extract_template_blocks(wikitext, "Election box begin")
    if not begin_blocks:
        return elections

    for idx, (begin_start, begin_end, begin_block) in enumerate(begin_blocks):
        # Region extends to next begin or end of text
        next_start = begin_blocks[idx + 1][0] if idx + 1 < len(begin_blocks) else len(wikitext)
        region = wikitext[begin_start:next_start]

        # Parse title to extract year
        _, params = parse_template_params(begin_block)
        title = params.get("title", "")
        # Clean title
        title_clean = clean_wiki_value(title)

        # Extract year from title
        year_match = re.search(r"(\d{4})", title_clean)
        if not year_match:
            continue
        year = int(year_match.group(1))

        # Determine number of seats from title (e.g., "(2 seats)")
        seats_match = re.search(r"\((\d+)\s*seats?\)", title_clean)
        seats = int(seats_match.group(1)) if seats_match else 1

        # Parse candidates — both "winning candidate" and regular "candidate" variants
        candidates: list[dict] = []
        # Find all candidate templates in order
        # Types: "Election box winning candidate with party link",
        #        "Election box candidate with party link",
        #        "Election box winning candidate no party link",
        #        "Election box candidate no party link",
        #        "Election box winning candidate no party"
        for template_name in [
            "Election box winning candidate with party link",
            "Election box candidate with party link",
            "Election box winning candidate no party link",
            "Election box candidate no party link",
            "Election box winning candidate with party link no change",
            "Election box candidate with party link no change",
            "Election box winning candidate no party",
        ]:
            for cstart, cend, cblock in extract_template_blocks(region, template_name):
                _, cparams = parse_template_params(cblock)
                cand_name = clean_candidate_name(cparams.get("candidate", ""))
                party_raw = clean_wiki_value(cparams.get("party", ""))
                votes = parse_votes(cparams.get("votes", ""))
                percentage = parse_votes(cparams.get("percentage", ""))
                is_winner = "winning" in template_name.lower()
                candidates.append({
                    "position": cstart,
                    "candidate": cand_name,
                    "party": party_raw,
                    "votes": votes,
                    "percentage": percentage,
                    "is_winner": is_winner,
                })

        if not candidates:
            continue

        # Sort by position in text to maintain correct order
        candidates.sort(key=lambda c: c["position"])
        for c in candidates:
            del c["position"]

        # Parse turnout
        turnout_blocks = extract_template_blocks(region, "Election box turnout")
        turnout = None
        if turnout_blocks:
            _, tparams = parse_template_params(turnout_blocks[0][2])
            turnout = parse_votes(tparams.get("votes", ""))

        # Parse registered electors
        elector_blocks = extract_template_blocks(region, "Election box registered electors")
        electorate = None
        if elector_blocks:
            _, eparams = parse_template_params(elector_blocks[0][2])
            electorate = parse_votes(eparams.get("reg. electors", ""))

        # Parse majority
        majority_blocks = extract_template_blocks(region, "Election box majority")
        majority = None
        if majority_blocks:
            _, mparams = parse_template_params(majority_blocks[0][2])
            majority = parse_votes(mparams.get("votes", ""))

        elections.append({
            "year": year,
            "title": title_clean,
            "seats": seats,
            "candidates": candidates,
            "turnout": turnout,
            "electorate": electorate,
            "majority": majority,
        })

    return elections


# ── STV Election Box Parsing ──────────────────────────────────────────────

def parse_stv_elections(wikitext: str, constituency_display: str) -> list[dict]:
    """Parse all STV Election box sections from a constituency page.

    Returns a list of election dicts with count-by-count data.
    """
    elections: list[dict] = []

    begin_blocks = extract_template_blocks(wikitext, "STV Election box begin2")
    if not begin_blocks:
        return elections

    for idx, (begin_start, begin_end, begin_block) in enumerate(begin_blocks):
        next_start = begin_blocks[idx + 1][0] if idx + 1 < len(begin_blocks) else len(wikitext)
        region = wikitext[begin_start:next_start]

        _, begin_params = parse_template_params(begin_block)
        title = begin_params.get("title", "")
        title_clean = clean_wiki_value(title)
        numcounts = int(parse_numeric(begin_params.get("numcounts", "")) or 0)

        # Extract year from title
        year_match = re.search(r"(\d{4})", title_clean)
        if not year_match:
            continue
        year = int(year_match.group(1))

        # Extract seats from title — handles both "— N seats" and "(N seats)"
        dea_name, seats = parse_dea_title(title)
        if seats is None:
            seats_match = re.search(r"\((\d+)\s+seats?\)", title_clean)
            if seats_match:
                seats = int(seats_match.group(1))

        # Parse candidates (both template types)
        cand_blocks_2 = extract_template_blocks(region, "STV Election box candidate2")
        cand_blocks_np = extract_template_blocks(region, "STV Election box candidate without party link")
        all_cand_blocks = sorted(cand_blocks_2 + cand_blocks_np, key=lambda b: b[0])

        # Parse end block for metadata
        end_blocks = extract_template_blocks(region, "STV Election box end2")
        end_params = parse_template_params(end_blocks[0][2])[1] if end_blocks else {}

        candidates: list[dict] = []
        for _, _, block in all_cand_blocks:
            _, cparams = parse_template_params(block)
            display_name, outcome = parse_candidate_name(cparams.get("candidate", ""))
            counts: list[float | None] = []
            for count_idx in range(1, numcounts + 1):
                value = parse_numeric(cparams.get(f"count{count_idx}", ""))
                counts.append(value)
            is_bold = "'''" in cparams.get("candidate", "")
            candidates.append({
                "party": clean_wiki_value(cparams.get("party", "")),
                "candidate_raw": cparams.get("candidate", ""),
                "candidate": display_name,
                "outcome": outcome,
                "is_bold": is_bold,
                "percentage": parse_numeric(cparams.get("percentage", "")),
                "counts": counts,
            })

        elections.append({
            "year": year,
            "title": title_clean,
            "seats": seats or 0,
            "numcounts": numcounts,
            "candidates": candidates,
            "electorate": parse_numeric(end_params.get("electorate", "")),
            "valid": parse_numeric(end_params.get("valid", "")),
            "spoilt": parse_numeric(end_params.get("spoilt", "")),
            "quota": parse_numeric(end_params.get("quota", "")),
            "turnout": parse_numeric(end_params.get("turnout", "")),
            "is_stv": True,
        })

    return elections


# ── Elected detection for STV ──────────────────────────────────────────────

def detect_stv_elected(election: dict) -> None:
    """Determine elected/excluded for STV election results."""
    seats = election["seats"]
    candidates = election["candidates"]
    quota = election.get("quota") or 0
    numcounts = election.get("numcounts", 0)
    valid = election.get("valid") or 0

    # Strategy 1: bold detection
    bold_elected = [c for c in candidates if c.get("is_bold")]
    bold_not = [c for c in candidates if not c.get("is_bold")]

    if len(bold_elected) == seats:
        for c in bold_elected:
            c["outcome"] = "Elected"
        for c in bold_not:
            c["outcome"] = "Excluded"
        return

    # Strategy 2: STV logic
    computed_quota = (int(valid) // (seats + 1)) + 1 if valid and seats else 0
    if quota and computed_quota and abs(quota - computed_quota) > computed_quota * 0.5:
        effective_quota = computed_quota
    else:
        effective_quota = quota or computed_quota

    scores: list[tuple[int, float, int, dict]] = []
    for cand in candidates:
        non_none = [(i + 1, v) for i, v in enumerate(cand["counts"]) if v is not None]
        if not non_none:
            scores.append((3, 0.0, 0, cand))
            continue
        max_votes = max(v for _, v in non_none)
        last_count_num = non_none[-1][0]
        final_votes = non_none[-1][1]
        reached_quota = effective_quota > 0 and max_votes >= effective_quota
        survived_final = last_count_num == numcounts

        if reached_quota:
            priority = 1
        elif survived_final:
            priority = 2
        else:
            priority = 3
        scores.append((priority, final_votes, last_count_num, cand))

    scores.sort(key=lambda x: (x[0], -x[1]))

    elected_count = 0
    for priority, _, _, cand in scores:
        if elected_count < seats and priority <= 2:
            cand["outcome"] = "Elected"
            elected_count += 1
        else:
            cand["outcome"] = "Excluded"

    # Fallback to bold
    if elected_count < seats:
        for cand in candidates:
            if cand["outcome"] != "Elected" and cand.get("is_bold"):
                cand["outcome"] = "Elected"
                elected_count += 1
                if elected_count >= seats:
                    break


# ── Bundle generation ──────────────────────────────────────────────────────

def fptp_election_to_bundle(
    election: dict,
    constituency_key: str,
    constituency_display: str,
    all_parties: list[dict],
    all_candidates: list[dict],
    year: int,
    body: str,
) -> dict:
    """Convert an FPTP election result to bundle format."""
    seats = election.get("seats", 1)
    turnout = election.get("turnout") or 0
    electorate = election.get("electorate") or 0
    # Compute valid poll (sum of candidate votes)
    valid_poll = sum(c["votes"] for c in election["candidates"] if c["votes"] is not None)
    spoiled = int(turnout - valid_poll) if turnout and valid_poll and turnout > valid_poll else 0

    count_group: list[dict] = []
    row_id = 0

    for cand in election["candidates"]:
        raw_party = cand["party"]
        normalised = normalise_party(raw_party)
        colour = get_party_colour(normalised)
        name = cand["candidate"]
        first_name, last_name = split_name(name)
        temp_id = generate_temp_person_id(name)
        votes = cand["votes"] or 0

        all_parties.append({
            "constituency": constituency_key,
            "raw_party": raw_party,
            "normalised_party": normalised,
            "colour": colour,
        })

        all_candidates.append({
            "year": year,
            "body": body,
            "constituency": constituency_key,
            "constituency_display": constituency_display,
            "candidate_name": name,
            "first_name": first_name,
            "last_name": last_name,
            "party": normalised,
            "raw_party": raw_party,
            "votes": f"{votes:.0f}" if votes else "0",
            "outcome": "Elected" if cand["is_winner"] else "",
            "temp_person_id": temp_id,
        })

        count_group.append({
            "Constituency_Number": "",
            "Candidate_Id": temp_id,
            "Count_Number": "1",
            "Firstname": first_name,
            "Surname": last_name,
            "Candidate_First_Pref_Votes": f"{votes:.2f}",
            "Transfers": "0.00",
            "Total_Votes": f"{votes:.2f}",
            "Status": "Elected" if cand["is_winner"] else "",
            "Occurred_On_Count": "1" if cand["is_winner"] else "",
            "Party_Name": normalised,
            "Deduplicated Party Name": normalised,
            "Wikipedia Party Name": raw_party,
            "Party_Colour": colour,
            "candidateName": name,
            "id": row_id,
        })
        row_id += 1

    count_info = {
        "Constituency_Name": constituency_display,
        "Constituency_Number": "",
        "Number_Of_Seats": str(seats),
        "Quota": "",
        "Total_Electorate": str(int(electorate)) if electorate else "",
        "Total_Poll": str(int(turnout)) if turnout else "",
        "Valid_Poll": str(int(valid_poll)) if valid_poll else "",
        "Spoiled": str(spoiled) if spoiled else "",
    }

    return {
        "Constituency": {
            "countInfo": count_info,
            "countGroup": count_group,
        }
    }


def stv_election_to_bundle(
    election: dict,
    constituency_key: str,
    constituency_display: str,
    all_parties: list[dict],
    all_candidates: list[dict],
    year: int,
    body: str,
) -> dict:
    """Convert an STV election result to bundle format."""
    seats = election.get("seats", 0)
    electorate = election.get("electorate") or 0
    valid = election.get("valid") or 0
    spoilt = election.get("spoilt") or 0
    quota = election.get("quota") or 0
    total_poll = (valid + spoilt) if valid else 0

    count_group: list[dict] = []
    row_id = 0

    for cand in election["candidates"]:
        raw_party = cand["party"]
        normalised = normalise_party(raw_party)
        colour = get_party_colour(normalised)
        name = cand["candidate"]
        first_name, last_name = split_name(name)
        temp_id = generate_temp_person_id(name)
        outcome = cand.get("outcome") or ""

        first_pref = cand["counts"][0] if cand["counts"] else 0
        if first_pref is None:
            first_pref = 0

        occurred_on_count = ""
        last_count_idx = 0
        for i, cv in enumerate(cand["counts"]):
            if cv is not None:
                last_count_idx = i + 1
        if outcome:
            occurred_on_count = str(last_count_idx)

        all_parties.append({
            "constituency": constituency_key,
            "raw_party": raw_party,
            "normalised_party": normalised,
            "colour": colour,
        })

        all_candidates.append({
            "year": year,
            "body": body,
            "constituency": constituency_key,
            "constituency_display": constituency_display,
            "candidate_name": name,
            "first_name": first_name,
            "last_name": last_name,
            "party": normalised,
            "raw_party": raw_party,
            "votes": f"{first_pref:.0f}" if first_pref else "0",
            "outcome": outcome,
            "temp_person_id": temp_id,
        })

        has_any_count = any(v is not None for v in cand["counts"])
        if not has_any_count and outcome == "Elected":
            count_group.append({
                "Constituency_Number": "",
                "Candidate_Id": temp_id,
                "Count_Number": "1",
                "Firstname": first_name,
                "Surname": last_name,
                "Candidate_First_Pref_Votes": "0.00",
                "Transfers": "0.00",
                "Total_Votes": "0.00",
                "Status": "Elected",
                "Occurred_On_Count": "1",
                "Party_Name": normalised,
                "Deduplicated Party Name": normalised,
                "Wikipedia Party Name": raw_party,
                "Party_Colour": colour,
                "candidateName": name,
                "id": row_id,
            })
            row_id += 1
        else:
            prev_total = 0.0
            for count_idx, count_val in enumerate(cand["counts"]):
                count_number = count_idx + 1
                if count_val is None:
                    continue
                total_votes = count_val
                transfers = 0.0 if count_number == 1 else total_votes - prev_total

                count_group.append({
                    "Constituency_Number": "",
                    "Candidate_Id": temp_id,
                    "Count_Number": str(count_number),
                    "Firstname": first_name,
                    "Surname": last_name,
                    "Candidate_First_Pref_Votes": f"{first_pref:.2f}",
                    "Transfers": f"{transfers:.2f}",
                    "Total_Votes": f"{total_votes:.2f}",
                    "Status": outcome if outcome else "",
                    "Occurred_On_Count": occurred_on_count,
                    "Party_Name": normalised,
                    "Deduplicated Party Name": normalised,
                    "Wikipedia Party Name": raw_party,
                    "Party_Colour": colour,
                    "candidateName": name,
                    "id": row_id,
                })
                row_id += 1
                prev_total = total_votes

    count_info = {
        "Constituency_Name": constituency_display,
        "Constituency_Number": "",
        "Number_Of_Seats": str(int(seats)) if seats else "",
        "Quota": str(int(quota)) if quota else "",
        "Total_Electorate": str(int(electorate)) if electorate else "",
        "Total_Poll": str(int(total_poll)) if total_poll else "",
        "Valid_Poll": str(int(valid)) if valid else "",
        "Spoiled": str(int(spoilt)) if spoilt else "",
    }

    return {
        "Constituency": {
            "countInfo": count_info,
            "countGroup": count_group,
        }
    }


# ── Wikitext caching ──────────────────────────────────────────────────────

def get_wikitext(article_title: str, cache_path: Path) -> tuple[str | None, str]:
    """Get wikitext from cache or fetch from Wikipedia.  Follows redirects."""
    if cache_path.exists():
        text = cache_path.read_text(encoding="utf-8")
        # Follow redirect if cached file is a redirect
        if text.strip().upper().startswith("#REDIRECT"):
            m = re.search(r"\[\[([^\]]+)\]\]", text)
            if m:
                redirect_title = m.group(1)
                redirect_text = fetch_raw_title(redirect_title)
                if redirect_text:
                    cache_path.write_text(redirect_text, encoding="utf-8")
                    return redirect_text, "redirect"
        return text, "cached"

    text = fetch_raw_title(article_title)
    if text:
        # Follow redirect
        if text.strip().upper().startswith("#REDIRECT"):
            m = re.search(r"\[\[([^\]]+)\]\]", text)
            if m:
                redirect_title = m.group(1)
                redirect_text = fetch_raw_title(redirect_title)
                if redirect_text:
                    text = redirect_text
        cache_path.write_text(text, encoding="utf-8")
        return text, "fetched"

    return None, "missing"


# ── Main processing ────────────────────────────────────────────────────────

def get_stormont_constituencies(year: int) -> list[dict]:
    """Return the appropriate constituency list for a Stormont election year."""
    if year <= 1925:
        return STORMONT_STV_CONSTITUENCIES
    elif year <= 1965:
        # 48 FPTP + QUB (STV)
        qub = [c for c in STORMONT_STV_CONSTITUENCIES if c["key"] == "queens_university"]
        return STORMONT_FPTP_CONSTITUENCIES + qub
    else:
        # 1969: 48 FPTP + 4 new constituencies (no more QUB)
        return STORMONT_FPTP_CONSTITUENCIES + STORMONT_1969_CONSTITUENCIES


def get_westminster_constituencies(year: int) -> list[dict]:
    """Return the appropriate constituency list for a Westminster election year."""
    if year < 1950:
        return WESTMINSTER_1922_CONSTITUENCIES
    else:
        return WESTMINSTER_1950_CONSTITUENCIES


def process_constituency(
    constituency: dict,
    year: int,
    body: str,
    raw_dir: Path,
    all_parties: list[dict],
    all_candidates: list[dict],
) -> dict | None:
    """Process a single constituency for a given year.

    Returns bundle data for the constituency, or None if no data found.
    """
    key = constituency["key"]
    display = constituency["display"]
    article = constituency["article"]
    expected_seats = constituency.get("seats", 1)

    cache_path = raw_dir / f"{key}.wiki"
    wikitext, resolution = get_wikitext(article, cache_path)

    if wikitext is None:
        return None

    # Try both STV and FPTP parsing — the article may contain either/both
    election_data = None

    def is_general_election(title: str) -> bool:
        t = title.lower()
        return "general election" in t and "by-election" not in t

    # Try STV first (for multi-seat STV like Stormont 1921-25 or QUB)
    stv_elections = parse_stv_elections(wikitext, display)
    stv_year_matches = [e for e in stv_elections if e["year"] == year]
    if stv_year_matches:
        election_data = next(
            (e for e in stv_year_matches if is_general_election(e["title"])),
            stv_year_matches[0],
        )
        # Skip if this is a by-election and not matching general election
        if "by-election" not in election_data["title"].lower():
            detect_stv_elected(election_data)
            return stv_election_to_bundle(
                election_data, key, display, all_parties, all_candidates, year, body
            )

    # Try FPTP (for single-seat or multi-seat bloc voting)
    fptp_elections = parse_fptp_elections(wikitext, display)
    fptp_year_matches = [e for e in fptp_elections if e["year"] == year]
    if fptp_year_matches:
        # Prefer general election over by-elections
        election_data = next(
            (e for e in fptp_year_matches if is_general_election(e["title"])),
            None,
        )
        # If no general election match, accept non-by-election
        if election_data is None:
            election_data = next(
                (e for e in fptp_year_matches if "by-election" not in e["title"].lower()),
                None,
            )
        # Last resort: accept first match (even by-election) only for single-seat
        if election_data is None and expected_seats == 1:
            election_data = fptp_year_matches[0]
    if election_data:
        return fptp_election_to_bundle(
            election_data, key, display, all_parties, all_candidates, year, body
        )

    # If no election box found for this year, it may be uncontested with no template
    return None


def process_election(body: str, year: int) -> dict:
    """Process a single election year for a body."""
    if body == "stormont":
        election_date = STORMONT_ELECTIONS[year]
        body_slug = "parliament-of-northern-ireland"
        constituencies = get_stormont_constituencies(year)
    else:
        election_date = WESTMINSTER_ELECTIONS[year]
        body_slug = "house-of-commons-of-the-united-kingdom"
        constituencies = get_westminster_constituencies(year)

    outdir = Path(f"_tmp_{year}_{body}")
    raw_dir = outdir / "raw"
    parsed_dir = outdir / "parsed"
    bundle_dir = outdir / "bundle"
    raw_dir.mkdir(parents=True, exist_ok=True)
    parsed_dir.mkdir(parents=True, exist_ok=True)
    bundle_dir.mkdir(parents=True, exist_ok=True)

    all_parties: list[dict] = []
    all_candidates: list[dict] = []
    scrape_results: list[dict] = []

    bundle_constituencies: dict[str, dict] = {}

    for const in constituencies:
        key = const["key"]
        display = const["display"]

        result = process_constituency(
            const, year, body, raw_dir, all_parties, all_candidates
        )

        if result:
            bundle_constituencies[display] = result
            cand_count = len(result["Constituency"]["countGroup"])
            elected_count = sum(
                1 for r in result["Constituency"]["countGroup"]
                if r["Status"] == "Elected"
            )
            # Deduplicate elected (same person may appear on multiple counts)
            elected_names = set(
                r["candidateName"] for r in result["Constituency"]["countGroup"]
                if r["Status"] == "Elected"
            )
            scrape_results.append({
                "constituency": key,
                "display": display,
                "found": True,
                "candidate_count": len(set(r["Candidate_Id"] for r in result["Constituency"]["countGroup"])),
                "elected_count": len(elected_names),
                "expected_seats": const.get("seats", 1),
            })
            print(f"  {display}: {len(elected_names)} elected / {const.get('seats', 1)} seats, "
                  f"{len(set(r['Candidate_Id'] for r in result['Constituency']['countGroup']))} candidates")
        else:
            # Check if uncontested (mentioned in article text)
            cache_path = raw_dir / f"{key}.wiki"
            if cache_path.exists():
                text = cache_path.read_text(encoding="utf-8")
                uncontested = "unopposed" in text.lower() and str(year) in text
                if uncontested:
                    print(f"  {display}: UNCONTESTED (no Election box)")
                    scrape_results.append({
                        "constituency": key, "display": display,
                        "found": True, "uncontested": True,
                        "candidate_count": 0, "elected_count": 0,
                        "expected_seats": const.get("seats", 1),
                    })
                else:
                    print(f"  {display}: NO DATA for {year}")
                    scrape_results.append({
                        "constituency": key, "display": display,
                        "found": False, "candidate_count": 0, "elected_count": 0,
                        "expected_seats": const.get("seats", 1),
                    })
            else:
                print(f"  {display}: ARTICLE MISSING")
                scrape_results.append({
                    "constituency": key, "display": display,
                    "found": False, "candidate_count": 0, "elected_count": 0,
                    "expected_seats": const.get("seats", 1),
                })

    # Write bundle
    bundle = {
        "body": body_slug,
        "date": election_date,
        "constituencies": bundle_constituencies,
    }
    (bundle_dir / "_bundle.json").write_text(
        json.dumps(bundle, indent=4, ensure_ascii=False), encoding="utf-8"
    )

    # Party review CSV
    unique_parties: dict[str, dict] = {}
    for p in all_parties:
        norm = p["normalised_party"]
        if norm not in unique_parties:
            unique_parties[norm] = {
                "normalised_party": norm,
                "raw_variants": set(),
                "colour": p["colour"],
                "count": 0,
            }
        unique_parties[norm]["raw_variants"].add(p["raw_party"])
        unique_parties[norm]["count"] += 1

    parties_csv = outdir / "parties.csv"
    with parties_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "normalised_party", "raw_variants", "colour", "candidate_count", "action",
        ])
        writer.writeheader()
        for party in sorted(unique_parties.values(), key=lambda p: -p["count"]):
            writer.writerow({
                "normalised_party": party["normalised_party"],
                "raw_variants": " | ".join(sorted(party["raw_variants"])),
                "colour": party["colour"],
                "candidate_count": party["count"],
                "action": "",
            })

    # Candidate review CSV
    candidates_csv = outdir / "candidates.csv"
    with candidates_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "candidate_name", "first_name", "last_name", "party",
            "constituency", "votes", "outcome",
            "temp_person_id", "assigned_person_id",
        ])
        writer.writeheader()
        for cand in sorted(all_candidates, key=lambda c: (c["last_name"], c["first_name"])):
            writer.writerow({
                "candidate_name": cand["candidate_name"],
                "first_name": cand["first_name"],
                "last_name": cand["last_name"],
                "party": cand["party"],
                "constituency": cand["constituency_display"],
                "votes": cand["votes"],
                "outcome": cand["outcome"],
                "temp_person_id": cand["temp_person_id"],
                "assigned_person_id": "",
            })

    # Verification
    total_elected = 0
    total_seats = 0
    total_candidates = 0
    contested = 0
    uncontested_count = 0
    mismatches: list[str] = []

    for r in scrape_results:
        total_candidates += r["candidate_count"]
        if r.get("uncontested"):
            uncontested_count += 1
            total_seats += r["expected_seats"]
            continue
        if r["found"]:
            contested += 1
            total_elected += r["elected_count"]
            total_seats += r["expected_seats"]
            if r["elected_count"] != r["expected_seats"]:
                mismatches.append(
                    f"{r['display']}: {r['elected_count']} elected vs {r['expected_seats']} seats"
                )

    summary = {
        "body": body,
        "year": year,
        "date": election_date,
        "constituencies_total": len(constituencies),
        "constituencies_contested": contested,
        "constituencies_uncontested": uncontested_count,
        "constituencies_no_data": len(constituencies) - contested - uncontested_count,
        "total_candidates": total_candidates,
        "total_elected": total_elected,
        "total_seats": total_seats,
        "elected_matches_seats": len(mismatches) == 0 and total_elected > 0,
        "unique_parties": len(unique_parties),
        "mismatches": mismatches,
        "output_files": {
            "parties_csv": str(parties_csv),
            "candidates_csv": str(candidates_csv),
            "bundle": str(bundle_dir / "_bundle.json"),
        },
        "constituencies": scrape_results,
    }
    (outdir / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    return summary


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(
        description="Scrape pre-1970 NI parliamentary elections from Wikipedia"
    )
    parser.add_argument(
        "--body", choices=["stormont", "westminster", "both"], default="both",
        help="Which body to scrape (default: both)"
    )
    parser.add_argument(
        "--years", nargs="*", type=int, default=None,
        help="Specific years to process (default: all for selected body)"
    )
    args = parser.parse_args()

    bodies = []
    if args.body in ("stormont", "both"):
        bodies.append(("stormont", STORMONT_ELECTIONS))
    if args.body in ("westminster", "both"):
        bodies.append(("westminster", WESTMINSTER_ELECTIONS))

    for body, election_dates in bodies:
        years = sorted(args.years or list(election_dates.keys()))

        grand_total_candidates = 0
        grand_total_elected = 0
        grand_total_seats = 0

        for year in years:
            if year not in election_dates:
                print(f"Unknown {body} year: {year}")
                continue

            body_label = "Stormont" if body == "stormont" else "Westminster"
            print(f"\n{'='*60}")
            print(f"  {year} {body_label} Election ({election_dates[year]})")
            print(f"{'='*60}")

            summary = process_election(body, year)

            status = "MATCH" if summary["elected_matches_seats"] else "MISMATCH"
            print(f"\n  Constituencies: {summary['constituencies_contested']} contested"
                  f" + {summary['constituencies_uncontested']} uncontested"
                  f" + {summary['constituencies_no_data']} no data"
                  f" / {summary['constituencies_total']} total")
            print(f"  Candidates: {summary['total_candidates']}")
            print(f"  Elected: {summary['total_elected']} / {summary['total_seats']} seats [{status}]")
            print(f"  Parties: {summary['unique_parties']}")
            if summary["mismatches"]:
                print(f"  Mismatches:")
                for m in summary["mismatches"]:
                    print(f"    {m}")

            grand_total_candidates += summary["total_candidates"]
            grand_total_elected += summary["total_elected"]
            grand_total_seats += summary["total_seats"]

        body_label = "Stormont" if body == "stormont" else "Westminster"
        print(f"\n{'='*60}")
        print(f"  {body_label} GRAND TOTAL")
        print(f"{'='*60}")
        print(f"  Years processed: {len(years)}")
        print(f"  Total candidates: {grand_total_candidates}")
        print(f"  Total elected: {grand_total_elected} / {grand_total_seats} seats")
        seats_status = "ALL MATCH" if grand_total_elected == grand_total_seats else "MISMATCHES EXIST"
        print(f"  Verification: {seats_status}")
        print()
        for year in years:
            print(f"  _tmp_{year}_{body}/  -- parties.csv, candidates.csv, bundle/")


if __name__ == "__main__":
    main()
