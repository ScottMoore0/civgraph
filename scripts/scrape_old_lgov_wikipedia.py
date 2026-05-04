#!/usr/bin/env python
"""Scrape 1973–2005 NI local council election data from Wikipedia.

Processes all 9 election years (1973, 1977, 1981, 1985, 1989, 1993, 1997,
2001, 2005) using the old 26-council system.  Uses cached wikitext from
_tmp_xls2rar_extract/out/wiki_lgov/raw/ if available, otherwise fetches
from Wikipedia.

Outputs per year (in _tmp_{year}_lgov/):
  raw/              — cached wikitext for each council
  parsed/           — full parsed JSON per council
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
    parse_count_tables,
    parse_dea_title,
    parse_numeric,
    parse_template_params,
)

# ── Configuration ──────────────────────────────────────────────────────────

ELECTION_DATES: dict[int, str] = {
    1973: "1973-05-30",
    1977: "1977-05-18",
    1981: "1981-05-20",
    1985: "1985-05-15",
    1989: "1989-05-17",
    1993: "1993-05-19",
    1997: "1997-05-21",
    2001: "2001-06-07",
    2005: "2005-05-05",
}

USER_AGENT = "civgraph/1.0 (old lgov Wikipedia scraper)"
REQUEST_DELAY_SECONDS = 0.6
RETRY_DELAYS = [5, 10, 20, 40]

# Existing cached wikitext directory from earlier scraping runs
CACHED_RAW_DIR = Path("_tmp_xls2rar_extract/out/wiki_lgov/raw")

COUNCILS = [
    {"key": "antrim",                     "display": "Antrim",                      "variants": ["Antrim Borough Council", "Antrim District Council"]},
    {"key": "ards",                       "display": "Ards",                        "variants": ["Ards Borough Council", "Ards District Council"]},
    {"key": "armagh",                     "display": "Armagh",                      "variants": ["Armagh City and District Council", "Armagh District Council", "Armagh City Council"]},
    {"key": "ballymena",                  "display": "Ballymena",                   "variants": ["Ballymena Borough Council", "Ballymena District Council"]},
    {"key": "ballymoney",                 "display": "Ballymoney",                  "variants": ["Ballymoney Borough Council", "Ballymoney District Council"]},
    {"key": "banbridge",                  "display": "Banbridge",                   "variants": ["Banbridge District Council"]},
    {"key": "belfast",                    "display": "Belfast",                     "variants": ["Belfast City Council"]},
    {"key": "carrickfergus",              "display": "Carrickfergus",               "variants": ["Carrickfergus Borough Council", "Carrickfergus District Council"]},
    {"key": "castlereagh",               "display": "Castlereagh",                "variants": ["Castlereagh Borough Council", "Castlereagh District Council"]},
    {"key": "coleraine",                  "display": "Coleraine",                   "variants": ["Coleraine Borough Council", "Coleraine District Council"]},
    {"key": "cookstown",                  "display": "Cookstown",                   "variants": ["Cookstown District Council"]},
    {"key": "craigavon",                  "display": "Craigavon",                   "variants": ["Craigavon Borough Council", "Craigavon District Council"]},
    {"key": "derry",                      "display": "Derry",                       "variants": ["Derry City Council", "Londonderry City Council"]},
    {"key": "down",                       "display": "Down",                        "variants": ["Down District Council"]},
    {"key": "dungannon_and_south_tyrone", "display": "Dungannon and South Tyrone",  "variants": ["Dungannon and South Tyrone Borough Council", "Dungannon and South Tyrone District Council", "Dungannon District Council"]},
    {"key": "fermanagh",                  "display": "Fermanagh",                   "variants": ["Fermanagh District Council"]},
    {"key": "larne",                      "display": "Larne",                       "variants": ["Larne Borough Council", "Larne District Council"]},
    {"key": "limavady",                   "display": "Limavady",                    "variants": ["Limavady Borough Council", "Limavady District Council"]},
    {"key": "lisburn",                    "display": "Lisburn",                     "variants": ["Lisburn City Council", "Lisburn Borough Council", "Lisburn District Council"]},
    {"key": "magherafelt",                "display": "Magherafelt",                 "variants": ["Magherafelt District Council"]},
    {"key": "moyle",                      "display": "Moyle",                       "variants": ["Moyle District Council"]},
    {"key": "newry_and_mourne",           "display": "Newry and Mourne",            "variants": ["Newry and Mourne District Council"]},
    {"key": "newtownabbey",               "display": "Newtownabbey",                "variants": ["Newtownabbey Borough Council", "Newtownabbey District Council"]},
    {"key": "north_down",                 "display": "North Down",                  "variants": ["North Down Borough Council", "North Down District Council"]},
    {"key": "omagh",                      "display": "Omagh",                       "variants": ["Omagh District Council"]},
    {"key": "strabane",                   "display": "Strabane",                    "variants": ["Strabane District Council"]},
]

# ── Party colours ──────────────────────────────────────────────────────────
# Comprehensive palette covering all parties from 1973–2005,
# matching SPECIFIED_PARTY_COLOURS from party_colours.py where applicable.

PARTY_COLOURS: dict[str, str] = {
    # Major parties
    "DUP": "#D46A4C",
    "Democratic Unionist Party": "#D46A4C",
    "UUP": "#48A5EE",
    "Ulster Unionist Party": "#48A5EE",
    "Sinn Féin": "#326760",
    "Sinn Fein": "#326760",
    "SDLP": "#2AA82C",
    "Social Democratic and Labour Party": "#2AA82C",
    "Alliance": "#F6CB2F",
    "Alliance Party of Northern Ireland": "#F6CB2F",
    "Alliance Party": "#F6CB2F",
    # Independents
    "Independent": "#DCDCDC",
    "Independent Unionist": "#AADFFF",
    "Independent Nationalist": "#CDFFAB",
    "Independent Other": "#DCDCDC",
    "Independent Republican": "#CDFFAB",
    "Independent Labour": "#FF9999",
    "Independent Conservative": "#B0D0FF",
    "Independent Socialist": "#FF6666",
    # Green
    "Green / Ecology": "#8DC63F",
    "Green Party": "#8DC63F",
    "Green Party in Northern Ireland": "#8DC63F",
    "Green Party of Northern Ireland": "#8DC63F",
    # Unionist parties
    "TUV": "#0C3A6A",
    "Traditional Unionist Voice": "#0C3A6A",
    "PUP": "#2B45A2",
    "Progressive Unionist Party": "#2B45A2",
    "Vanguard Unionist Progressive Party": "#FF8C00",
    "Vanguard Progressive Unionist Party": "#FF8C00",
    "Unionist Party of Northern Ireland": "#FFA07A",
    "United Ulster Unionist Party": "#FF8C00",
    "Ulster Popular Unionist Party": "#FFDEAD",
    "Ulster Democratic Party": "#000000",
    "Ulster Independence Movement": "#A9A9A9",
    "Ulster Constitution Party": "#000000",
    "Northern Ireland Unionist Party": "#FF8C00",
    "UK Unionist Party": "#660066",
    "UKUP": "#660066",
    "Protestant Unionist": "#D46A4C",
    "Loyalist": "#FFD700",
    "Loyalist Coalition": "#FFD700",
    "United Loyalist": "#FFD700",
    "United Loyalist Coalition": "#FFD700",
    "United Unionist": "#88BBFF",
    "United Unionist Coalition": "#88BBFF",
    "United Unionist Assembly Party": "#88BBFF",
    "South Belfast Unionists": "#DCDCDC",
    "British Ulster Dominion Party": "#A9A9A9",
    "Dominion Party": "#A9A9A9",
    # Nationalist / Republican
    "Nationalist Party": "#32CD32",
    "Republican Clubs": "#930C1A",
    "Workers Party / Republican Clubs": "#930C1A",
    "Workers Party": "#930C1A",
    "Workers' Party": "#930C1A",
    "Republican Labour Party": "#85DE59",
    "Republican Sinn Féin": "#008800",
    "Unity": "#90EE90",
    "Anti H-Block": "#000000",
    "Irish Independence Party": "#228B22",
    "Irish Republican Socialist Party": "#FF0000",
    "IRSP": "#FF0000",
    "Éirígí": "#006400",
    "People's Democracy": "#FF0000",
    # Labour / Left
    "NI Labour": "#DC241F",
    "Labour": "#DC241F",
    "Northern Ireland Labour Party": "#DC241F",
    "Labour Party of Northern Ireland": "#DC241F",
    "Newtownabbey Labour Party": "#DC241F",
    "Newtownabbey Labour": "#DC241F",
    "Labour '87": "#DC241F",
    "Labour and Trade Union Group": "#DC241F",
    "Labour Coalition": "#DC241F",
    "Northern Ireland Labour Representation Committee": "#DC241F",
    "Cross-Community Labour Alternative": "#CD5C5C",
    "Irish Labour Party": "#CC0000",
    "Democratic Left": "#CC6666",
    "Socialist Party": "#FF3300",
    "Socialist Environmental Alliance": "#BB0000",
    "Communist Party of Ireland": "#E3170D",
    "People Before Profit Alliance": "#E91D50",
    "People Before Profit": "#E91D50",
    # Conservative
    "Conservative": "#0087DC",
    "Northern Ireland Conservatives": "#0087DC",
    "NI Conservatives": "#0087DC",
    # Far right
    "BNP": "#2E3B74",
    "British National Party": "#2E3B74",
    "National Front": "#191970",
    # UKIP
    "UKIP": "#6D3177",
    "UK Independence Party": "#6D3177",
    "United Kingdom Independence Party": "#6D3177",
    # Others
    "Northern Ireland Women's Coalition": "#00FFFF",
    "Natural Law Party": "#FFE4E1",
    "NI21": "#008080",
    "Ulster Liberal Party": "#DAA520",
    "Ulster Third Way": "#A9A9A9",
    "Third Way": "#A9A9A9",
    "All Night Party": "#FFD700",
    "Newtownabbey Ratepayers": "#C0C0C0",
    "Newtownabbey Ratepayers Association": "#C0C0C0",
    "Vote For Yourself / Rainbow Dream Ticket / Make Politicians History": "#FFC0CB",
    "Procapitalism": "#000000",
}

# ── Party normalisation ────────────────────────────────────────────────────
# Map variant spellings/Wikipedia link artifacts to canonical labels.
# Uses the same canonical labels as the existing election data where possible.

PARTY_NORMALISATION: dict[str, str] = {
    # Major parties
    "social democratic and labour party": "SDLP",
    "democratic unionist party": "DUP",
    "ulster unionist party": "UUP",
    "alliance party of northern ireland": "Alliance",
    "alliance party": "Alliance",
    "sinn féin": "Sinn Féin",
    "sinn fein": "Sinn Féin",
    # Green
    "green party in northern ireland": "Green / Ecology",
    "green party of northern ireland": "Green / Ecology",
    "green party northern ireland": "Green / Ecology",
    "green party": "Green / Ecology",
    # Unionist
    "traditional unionist voice": "TUV",
    "progressive unionist party": "PUP",
    "vanguard unionist progressive party": "Vanguard Unionist Progressive Party",
    "vanguard progressive unionist party": "Vanguard Unionist Progressive Party",
    "unionist party of northern ireland": "Unionist Party of Northern Ireland",
    "united ulster unionist party": "United Ulster Unionist Party",
    "ulster popular unionist party": "Ulster Popular Unionist Party",
    "ulster democratic party": "Ulster Democratic Party",
    "ulster independence movement": "Ulster Independence Movement",
    "ulster constitution party": "Ulster Constitution Party",
    "northern ireland unionist party": "Northern Ireland Unionist Party",
    "uk unionist party": "UKUP",
    "protestant unionist": "Protestant Unionist",
    "british ulster dominion party": "British Ulster Dominion Party",
    "dominion party": "British Ulster Dominion Party",
    "united unionist assembly party": "United Unionist Assembly Party",
    # UKIP
    "uk independence party": "UKIP",
    "united kingdom independence party": "UKIP",
    # Nationalist / Republican
    "nationalist party (northern ireland)": "Nationalist Party",
    "nationalist party": "Nationalist Party",
    "republican clubs": "Workers Party / Republican Clubs",
    "workers' party (ireland)": "Workers Party",
    "workers party (ireland)": "Workers Party",
    "workers' party": "Workers Party",
    "republican labour party": "Republican Labour Party",
    "republican sinn féin": "Republican Sinn Féin",
    "irish independence party": "Irish Independence Party",
    "irish republican socialist party": "IRSP",
    "anti h-block": "Anti H-Block",
    "people's democracy (ireland)": "People's Democracy",
    "people's democracy": "People's Democracy",
    "unity (northern ireland)": "Unity",
    "éirígí": "Éirígí",
    "eirigi": "Éirígí",
    # Labour / Left
    "northern ireland labour party": "NI Labour",
    "labour party of northern ireland": "NI Labour",
    "newtownabbey labour party": "Newtownabbey Labour Party",
    "newtownabbey labour": "Newtownabbey Labour Party",
    "labour '87": "Labour '87",
    "labour and trade union group": "Labour and Trade Union Group",
    "labour coalition": "Labour Coalition",
    "northern ireland labour representation committee": "Northern Ireland Labour Representation Committee",
    "cross-community labour alternative": "Cross-Community Labour Alternative",
    "irish labour party": "Irish Labour Party",
    "democratic left (ireland)": "Democratic Left",
    "democratic left": "Democratic Left",
    "socialist party (northern ireland)": "Socialist Party",
    "socialist party (ireland)": "Socialist Party",
    "socialist environmental alliance": "Socialist Environmental Alliance",
    "communist party of ireland": "Communist Party of Ireland",
    "people before profit alliance": "People Before Profit Alliance",
    "people before profit": "People Before Profit Alliance",
    # Conservative
    "northern ireland conservatives": "Conservative",
    "conservative party": "Conservative",
    # Far right
    "british national party": "BNP",
    "national front (uk)": "National Front",
    "national front": "National Front",
    # Others
    "northern ireland women's coalition": "Northern Ireland Women's Coalition",
    "natural law party": "Natural Law Party",
    "ulster liberal party": "Ulster Liberal Party",
    "third way (uk organisation)": "Ulster Third Way",
    "ulster third way": "Ulster Third Way",
    "all night party": "All Night Party",
    "newtownabbey ratepayers association": "Newtownabbey Ratepayers",
    "newtownabbey ratepayers": "Newtownabbey Ratepayers",
    # Generic
    "independent": "Independent",
    "independent (politician)": "Independent",
    "independent unionist": "Independent Unionist",
    "independent nationalist": "Independent Nationalist",
    "independent republican (ireland)": "Independent Republican",
    "independent republican": "Independent Republican",
    "independent labour": "Independent Labour",
    "independent conservative": "Independent Conservative",
    "independent socialist": "Independent Socialist",
    "loyalist": "Loyalist",
    "loyalist coalition": "Loyalist Coalition",
    "united loyalist coalition": "United Loyalist Coalition",
    "united loyalist": "United Loyalist Coalition",
    "united unionist": "United Unionist",
    "united unionist coalition": "United Unionist",
}


# ── Enhanced parser ────────────────────────────────────────────────────────
# The shared parse_count_tables() only extracts "STV Election box candidate2"
# blocks.  Older articles also use "STV Election box candidate without party link"
# which has the same parameters but a different template name.  This wrapper
# merges both into a single parse result.

def parse_count_tables_extended(title: str, wikitext: str) -> dict:
    """Like parse_count_tables but also handles 'candidate without party link'."""
    begin_blocks = extract_template_blocks(wikitext, "STV Election box begin2")

    districts: list[dict] = []
    for idx, (begin_start, begin_end, begin_block) in enumerate(begin_blocks):
        next_begin_start = begin_blocks[idx + 1][0] if idx + 1 < len(begin_blocks) else len(wikitext)
        region = wikitext[begin_start:next_begin_start]
        _, begin_params = parse_template_params(begin_block)
        dea_name, seats = parse_dea_title(begin_params.get("title", ""))
        numcounts = int(parse_numeric(begin_params.get("numcounts", "")) or 0)

        # Collect both template types, sorted by position in the region
        cand_blocks_2: list[tuple[int, int, str]] = extract_template_blocks(region, "STV Election box candidate2")
        cand_blocks_np: list[tuple[int, int, str]] = extract_template_blocks(region, "STV Election box candidate without party link")
        all_cand_blocks = sorted(cand_blocks_2 + cand_blocks_np, key=lambda b: b[0])

        district_end_blocks = [block for _, _, block in extract_template_blocks(region, "STV Election box end2")]
        end_params = parse_template_params(district_end_blocks[0])[1] if district_end_blocks else {}

        parsed_candidates = []
        non_blank_count_columns: set[int] = set()
        for _, _, block in all_cand_blocks:
            _, cparams = parse_template_params(block)
            display_name, outcome = parse_candidate_name(cparams.get("candidate", ""))
            counts: list[float | None] = []
            for count_idx in range(1, numcounts + 1):
                value = parse_numeric(cparams.get(f"count{count_idx}", ""))
                counts.append(value)
                if value is not None:
                    non_blank_count_columns.add(count_idx)
            parsed_candidates.append({
                "party": clean_wiki_value(cparams.get("party", "")),
                "candidate_raw": cparams.get("candidate", ""),
                "candidate": display_name,
                "outcome": outcome,
                "percentage": parse_numeric(cparams.get("percentage", "")),
                "counts": counts,
            })

        districts.append({
            "dea_name": dea_name,
            "seats": seats,
            "numcounts": numcounts,
            "candidate_count": len(parsed_candidates),
            "non_blank_count_columns": sorted(non_blank_count_columns),
            "electorate": parse_numeric(end_params.get("electorate", "")),
            "valid": parse_numeric(end_params.get("valid", "")),
            "spoilt": parse_numeric(end_params.get("spoilt", "")),
            "quota": parse_numeric(end_params.get("quota", "")),
            "turnout": parse_numeric(end_params.get("turnout", "")),
            "candidates": parsed_candidates,
        })

    return {
        "title": title,
        "district_count": len(districts),
        "all_use_begin2": bool(begin_blocks),
        "districts": districts,
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
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe=":_()'")
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
    # Strip wiki link residue: "Foo|Bar" → "Bar", "Foo (disambiguation)|Foo" → "Foo"
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


# ── Processing ─────────────────────────────────────────────────────────────

def get_wikitext(year: int, council: dict, raw_dir: Path) -> tuple[str | None, str | None, str]:
    """Get wikitext from cache or fetch from Wikipedia."""
    key = council["key"]

    # Check our output cache first
    local_cache = raw_dir / f"{key}.wiki"
    if local_cache.exists():
        text = local_cache.read_text(encoding="utf-8")
        return council["variants"][0], text, "cached"

    # Check the pre-existing cache from scrape_and_compare_lgov_wikipedia.py
    existing_cache = CACHED_RAW_DIR / f"{year}-{key}.wiki"
    if existing_cache.exists():
        text = existing_cache.read_text(encoding="utf-8")
        local_cache.write_text(text, encoding="utf-8")
        return council["variants"][0], text, "existing-cache"

    # Fetch from Wikipedia
    for variant in council["variants"]:
        title = f"{year} {variant} election"
        text = fetch_raw_title(title)
        if text:
            local_cache.write_text(text, encoding="utf-8")
            return title, text, "fetched"

    return None, None, "missing"


def detect_elected(wikitext: str, parsed: dict) -> None:
    """Determine elected/excluded status using multiple strategies.

    Strategy 1 — Bold formatting: elected candidates have '''name''' in wikitext.
    Strategy 2 — STV logic fallback: if bold detection doesn't match the seat
    count, use count data to determine outcomes:
      a) Candidates whose vote total reaches/exceeds quota → elected
      b) Candidates still present in the final count → deemed elected
         (fills remaining seats, sorted by final vote total descending)
      c) Everyone else → excluded
    """
    for district in parsed["districts"]:
        seats = district["seats"] or 0
        quota = district.get("quota") or 0
        numcounts = district["numcounts"]
        candidates = district["candidates"]

        # Strategy 1: bold detection
        bold_elected = []
        bold_not = []
        for cand in candidates:
            if "'''" in cand.get("candidate_raw", ""):
                bold_elected.append(cand)
            else:
                bold_not.append(cand)

        if len(bold_elected) == seats:
            # Bold detection matches perfectly — use it
            for cand in bold_elected:
                cand["outcome"] = "Elected"
            for cand in bold_not:
                cand["outcome"] = "Excluded"
            continue

        # Strategy 2: STV logic
        # Compute quota from valid votes if the stored quota looks wrong
        valid = district.get("valid") or 0
        computed_quota = (valid // (seats + 1)) + 1 if valid and seats else 0
        # Use the more plausible quota (stored vs computed)
        if quota and computed_quota and abs(quota - computed_quota) > computed_quota * 0.5:
            # Stored quota is implausible (>50% off from computed) — use computed
            effective_quota = computed_quota
        else:
            effective_quota = quota or computed_quota

        # Classify each candidate
        scores: list[tuple[int, float, int, dict]] = []
        for cand in candidates:
            non_none = [(i + 1, v) for i, v in enumerate(cand["counts"]) if v is not None]
            if not non_none:
                scores.append((0, 0.0, 0, cand))
                continue
            max_votes = max(v for _, v in non_none)
            last_count_num = non_none[-1][0]
            final_votes = non_none[-1][1]
            reached_quota = effective_quota > 0 and max_votes >= effective_quota
            survived_final = last_count_num == numcounts

            # Priority: 1=reached quota, 2=survived final, 3=eliminated
            if reached_quota:
                priority = 1
            elif survived_final:
                priority = 2
            else:
                priority = 3
            scores.append((priority, final_votes, last_count_num, cand))

        # Sort: quota-reachers first, then final-survivors, then by votes desc
        scores.sort(key=lambda x: (x[0], -x[1]))

        elected_count = 0
        for priority, final_votes, last_count, cand in scores:
            if elected_count < seats and priority <= 2:
                cand["outcome"] = "Elected"
                elected_count += 1
            else:
                cand["outcome"] = "Excluded"

        # If we still haven't filled all seats (very incomplete data),
        # fall back to bold detection for any remaining
        if elected_count < seats:
            for cand in candidates:
                if cand["outcome"] != "Elected" and "'''" in cand.get("candidate_raw", ""):
                    cand["outcome"] = "Elected"
                    elected_count += 1
                    if elected_count >= seats:
                        break


def parsed_to_bundle_constituency(
    district: dict,
    council_key: str,
    all_parties: list[dict],
    all_candidates: list[dict],
    year: int,
) -> tuple[str, dict]:
    """Convert a parsed district into _bundle.json constituency format."""
    dea_name = district["dea_name"]
    seats = district["seats"] or 0
    electorate = district.get("electorate") or 0
    valid = district.get("valid") or 0
    spoilt = district.get("spoilt") or 0
    quota = district.get("quota") or 0
    total_poll = (valid + spoilt) if valid else 0

    count_group: list[dict] = []
    row_id = 0

    for cand in district["candidates"]:
        raw_party = cand["party"]
        normalised_party = normalise_party(raw_party)
        colour = get_party_colour(normalised_party)
        display_name = cand["candidate"]
        first_name, last_name = split_name(display_name)
        temp_id = generate_temp_person_id(display_name)

        outcome = cand.get("outcome") or ""

        # Determine occurred_on_count from the last non-None count
        occurred_on_count = ""
        last_count_idx = 0
        for i, count_val in enumerate(cand["counts"]):
            if count_val is not None:
                last_count_idx = i + 1
        if outcome:
            occurred_on_count = str(last_count_idx)

        first_pref = cand["counts"][0] if cand["counts"] else 0
        if first_pref is None:
            first_pref = 0

        all_parties.append({
            "council": council_key,
            "dea": dea_name,
            "raw_party": raw_party,
            "normalised_party": normalised_party,
            "colour": colour,
        })

        all_candidates.append({
            "year": year,
            "council": council_key,
            "dea": dea_name,
            "candidate_name": display_name,
            "first_name": first_name,
            "last_name": last_name,
            "party": normalised_party,
            "raw_party": raw_party,
            "temp_person_id": temp_id,
            "first_pref_votes": f"{first_pref:.2f}" if first_pref else "0.00",
            "outcome": outcome or "",
        })

        # Build one row per count
        has_any_count = any(v is not None for v in cand["counts"])
        if not has_any_count and outcome == "Elected":
            # Uncontested seat — no vote data, generate a single placeholder row
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
                "Party_Name": normalised_party,
                "Deduplicated Party Name": normalised_party,
                "Wikipedia Party Name": raw_party,
                "Party_Colour": colour,
                "candidateName": display_name,
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
                    "Party_Name": normalised_party,
                    "Deduplicated Party Name": normalised_party,
                    "Wikipedia Party Name": raw_party,
                    "Party_Colour": colour,
                    "candidateName": display_name,
                    "id": row_id,
                })
                row_id += 1
                prev_total = total_votes

    count_info = {
        "Constituency_Name": dea_name,
        "Constituency_Number": "",
        "Number_Of_Seats": str(int(seats)) if seats else "",
        "Quota": str(int(quota)) if quota else "",
        "Total_Electorate": str(int(electorate)) if electorate else "",
        "Total_Poll": str(int(total_poll)) if total_poll else "",
        "Valid_Poll": str(int(valid)) if valid else "",
        "Spoiled": str(int(spoilt)) if spoilt else "",
    }

    return dea_name, {
        "Constituency": {
            "countInfo": count_info,
            "countGroup": count_group,
        }
    }


def process_year(year: int) -> dict:
    """Process a single election year and return summary."""
    election_date = ELECTION_DATES[year]
    outdir = Path(f"_tmp_{year}_lgov")
    raw_dir = outdir / "raw"
    parsed_dir = outdir / "parsed"
    bundle_dir = outdir / "bundle"
    raw_dir.mkdir(parents=True, exist_ok=True)
    parsed_dir.mkdir(parents=True, exist_ok=True)
    bundle_dir.mkdir(parents=True, exist_ok=True)

    all_parties: list[dict] = []
    all_candidates: list[dict] = []
    scrape_results: list[dict] = []

    for council in COUNCILS:
        key = council["key"]
        display = council["display"]

        title, text, resolution = get_wikitext(year, council, raw_dir)
        if text is None or title is None:
            print(f"  {display}: MISSING ({resolution})")
            scrape_results.append({
                "council": key, "display": display,
                "title": "", "resolution": resolution,
                "found": False, "dea_count": 0, "candidate_count": 0,
            })
            continue

        parsed = parse_count_tables_extended(title, text)
        detect_elected(text, parsed)

        (parsed_dir / f"{key}.json").write_text(
            json.dumps(parsed, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        constituencies: dict[str, dict] = {}
        for district in parsed["districts"]:
            dea_name, constituency_data = parsed_to_bundle_constituency(
                district, key, all_parties, all_candidates, year
            )
            constituencies[dea_name] = constituency_data

        council_bundle = {
            "body": "local-government",
            "date": election_date,
            "council": display,
            "constituencies": constituencies,
        }
        (bundle_dir / f"{key}_bundle.json").write_text(
            json.dumps(council_bundle, indent=4, ensure_ascii=False), encoding="utf-8"
        )

        total_candidates = sum(d["candidate_count"] for d in parsed["districts"])
        scrape_results.append({
            "council": key, "display": display,
            "title": title, "resolution": resolution,
            "found": True,
            "dea_count": parsed["district_count"],
            "candidate_count": total_candidates,
        })

    # Combined bundle
    combined_bundle = {
        "body": "local-government",
        "date": election_date,
        "councils": {},
    }
    for council in COUNCILS:
        key = council["key"]
        council_file = bundle_dir / f"{key}_bundle.json"
        if council_file.exists():
            data = json.loads(council_file.read_text(encoding="utf-8"))
            combined_bundle["councils"][council["display"]] = data["constituencies"]

    (bundle_dir / "_combined_bundle.json").write_text(
        json.dumps(combined_bundle, indent=4, ensure_ascii=False), encoding="utf-8"
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
            "council", "dea", "first_pref_votes", "outcome",
            "temp_person_id", "assigned_person_id",
        ])
        writer.writeheader()
        for cand in sorted(all_candidates, key=lambda c: (c["last_name"], c["first_name"], c["council"])):
            writer.writerow({
                "candidate_name": cand["candidate_name"],
                "first_name": cand["first_name"],
                "last_name": cand["last_name"],
                "party": cand["party"],
                "council": cand["council"],
                "dea": cand["dea"],
                "first_pref_votes": cand["first_pref_votes"],
                "outcome": cand["outcome"],
                "temp_person_id": cand["temp_person_id"],
                "assigned_person_id": "",
            })

    # Verify elected counts
    total_elected = 0
    total_seats = 0
    mismatches: list[str] = []
    for council in COUNCILS:
        key = council["key"]
        council_file = bundle_dir / f"{key}_bundle.json"
        if not council_file.exists():
            continue
        data = json.loads(council_file.read_text(encoding="utf-8"))
        for dea_name, dea_data in data["constituencies"].items():
            info = dea_data["Constituency"]["countInfo"]
            seats = int(info["Number_Of_Seats"]) if info["Number_Of_Seats"] else 0
            elected_names = set()
            for row in dea_data["Constituency"]["countGroup"]:
                if row["Status"] == "Elected":
                    elected_names.add(row["candidateName"])
            total_elected += len(elected_names)
            total_seats += seats
            if len(elected_names) != seats and seats > 0:
                mismatches.append(f"{council['display']}/{dea_name}: {len(elected_names)} elected vs {seats} seats")

    # Summary
    total_deas = sum(r["dea_count"] for r in scrape_results)
    total_candidates = sum(r["candidate_count"] for r in scrape_results)
    found_councils = sum(1 for r in scrape_results if r["found"])
    unique_party_count = len(unique_parties)

    summary = {
        "year": year,
        "date": election_date,
        "councils_requested": len(COUNCILS),
        "councils_found": found_councils,
        "total_deas": total_deas,
        "total_candidates": total_candidates,
        "total_elected": total_elected,
        "total_seats": total_seats,
        "elected_matches_seats": total_elected == total_seats,
        "unique_parties": unique_party_count,
        "mismatches": mismatches,
        "output_files": {
            "parties_csv": str(parties_csv),
            "candidates_csv": str(candidates_csv),
            "per_council_bundles": str(bundle_dir),
            "combined_bundle": str(bundle_dir / "_combined_bundle.json"),
        },
        "councils": scrape_results,
    }
    (outdir / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    return summary


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Scrape 1973-2005 NI local elections from Wikipedia")
    parser.add_argument("--years", nargs="*", type=int, default=list(ELECTION_DATES.keys()),
                        help="Specific years to process (default: all)")
    args = parser.parse_args()

    years = sorted(args.years, reverse=True)
    grand_total_candidates = 0
    grand_total_elected = 0
    grand_total_seats = 0

    for year in years:
        if year not in ELECTION_DATES:
            print(f"Unknown year: {year}")
            continue
        print(f"\n{'='*60}")
        print(f"  {year} NI Local Elections ({ELECTION_DATES[year]})")
        print(f"{'='*60}")

        summary = process_year(year)

        status = "MATCH" if summary["elected_matches_seats"] else "MISMATCH"
        print(f"\n  Councils: {summary['councils_found']}/{summary['councils_requested']}")
        print(f"  DEAs: {summary['total_deas']}")
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

    print(f"\n{'='*60}")
    print(f"  GRAND TOTAL")
    print(f"{'='*60}")
    print(f"  Years processed: {len(years)}")
    print(f"  Total candidates: {grand_total_candidates}")
    print(f"  Total elected: {grand_total_elected} / {grand_total_seats} seats")
    seats_match = "ALL MATCH" if grand_total_elected == grand_total_seats else "MISMATCHES EXIST"
    print(f"  Verification: {seats_match}")
    print()
    for year in years:
        print(f"  _tmp_{year}_lgov/  — parties.csv, candidates.csv, bundle/")


if __name__ == "__main__":
    main()
