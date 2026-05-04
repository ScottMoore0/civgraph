#!/usr/bin/env python
"""Scrape 2011 NI local council election data from 26 Wikipedia articles.

Outputs:
  _tmp_2011_lgov/raw/              — cached wikitext for each council
  _tmp_2011_lgov/parsed/           — full parsed JSON per council
  _tmp_2011_lgov/bundle/           — _bundle.json in election-viewer format
  _tmp_2011_lgov/parties.csv       — all party names for review/deduplication
  _tmp_2011_lgov/candidates.csv    — all candidates for PersonID assignment
  _tmp_2011_lgov/summary.json      — scrape summary
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
    parse_count_tables,
    parse_template_params,
)

# ── Configuration ──────────────────────────────────────────────────────────

YEAR = 2011
ELECTION_DATE = "2011-05-05"

USER_AGENT = "civgraph/1.0 (2011 lgov Wikipedia scraper)"
REQUEST_DELAY_SECONDS = 0.6
RETRY_DELAYS = [5, 10, 20, 40]

OUTDIR = Path("_tmp_2011_lgov")

# The 26 old councils, keyed to match the existing COUNCILS list in
# scrape_and_compare_lgov_wikipedia.py.  The "display" value is the
# council name as it should appear in the election viewer.
COUNCILS = [
    {"key": "antrim",                     "display": "Antrim",                      "variants": ["Antrim Borough Council"]},
    {"key": "ards",                       "display": "Ards",                        "variants": ["Ards Borough Council"]},
    {"key": "armagh",                     "display": "Armagh",                      "variants": ["Armagh City and District Council", "Armagh District Council", "Armagh City Council"]},
    {"key": "ballymena",                  "display": "Ballymena",                   "variants": ["Ballymena Borough Council"]},
    {"key": "ballymoney",                 "display": "Ballymoney",                  "variants": ["Ballymoney Borough Council"]},
    {"key": "banbridge",                  "display": "Banbridge",                   "variants": ["Banbridge District Council"]},
    {"key": "belfast",                    "display": "Belfast",                     "variants": ["Belfast City Council"]},
    {"key": "carrickfergus",              "display": "Carrickfergus",               "variants": ["Carrickfergus Borough Council"]},
    {"key": "castlereagh",               "display": "Castlereagh",                "variants": ["Castlereagh Borough Council"]},
    {"key": "coleraine",                  "display": "Coleraine",                   "variants": ["Coleraine Borough Council"]},
    {"key": "cookstown",                  "display": "Cookstown",                   "variants": ["Cookstown District Council"]},
    {"key": "craigavon",                  "display": "Craigavon",                   "variants": ["Craigavon Borough Council"]},
    {"key": "derry",                      "display": "Derry",                       "variants": ["Derry City Council"]},
    {"key": "down",                       "display": "Down",                        "variants": ["Down District Council"]},
    {"key": "dungannon_and_south_tyrone", "display": "Dungannon and South Tyrone",  "variants": ["Dungannon and South Tyrone Borough Council", "Dungannon and South Tyrone District Council"]},
    {"key": "fermanagh",                  "display": "Fermanagh",                   "variants": ["Fermanagh District Council"]},
    {"key": "larne",                      "display": "Larne",                       "variants": ["Larne Borough Council"]},
    {"key": "limavady",                   "display": "Limavady",                    "variants": ["Limavady Borough Council"]},
    {"key": "lisburn",                    "display": "Lisburn",                     "variants": ["Lisburn City Council", "Lisburn Borough Council"]},
    {"key": "magherafelt",                "display": "Magherafelt",                 "variants": ["Magherafelt District Council"]},
    {"key": "moyle",                      "display": "Moyle",                       "variants": ["Moyle District Council"]},
    {"key": "newry_and_mourne",           "display": "Newry and Mourne",            "variants": ["Newry and Mourne District Council"]},
    {"key": "newtownabbey",               "display": "Newtownabbey",                "variants": ["Newtownabbey Borough Council"]},
    {"key": "north_down",                 "display": "North Down",                  "variants": ["North Down Borough Council"]},
    {"key": "omagh",                      "display": "Omagh",                       "variants": ["Omagh District Council"]},
    {"key": "strabane",                   "display": "Strabane",                    "variants": ["Strabane District Council"]},
]

# Party colour palette — matches SPECIFIED_PARTY_COLOURS from party_colours.py
# plus additional entries for parties likely to appear in 2011
PARTY_COLOURS: dict[str, str] = {
    "SDLP": "#2AA82C",
    "Social Democratic and Labour Party": "#2AA82C",
    "UUP": "#48A5EE",
    "Ulster Unionist Party": "#48A5EE",
    "Alliance": "#F6CB2F",
    "Alliance Party of Northern Ireland": "#F6CB2F",
    "Alliance Party": "#F6CB2F",
    "DUP": "#D46A4C",
    "Democratic Unionist Party": "#D46A4C",
    "Sinn Féin": "#326760",
    "Sinn Fein": "#326760",
    "Independent": "#DCDCDC",
    "Independent Unionist": "#AADFFF",
    "Independent Nationalist": "#CDFFAB",
    "Independent Other": "#DCDCDC",
    "Green Party": "#8DC63F",
    "Green / Ecology": "#8DC63F",
    "Green Party in Northern Ireland": "#8DC63F",
    "TUV": "#0C3A6A",
    "Traditional Unionist Voice": "#0C3A6A",
    "PUP": "#2B45A2",
    "Progressive Unionist Party": "#2B45A2",
    "UKIP": "#6D3177",
    "UK Independence Party": "#6D3177",
    "People Before Profit Alliance": "#E91D50",
    "People Before Profit": "#E91D50",
    "Workers Party": "#930C1A",
    "Workers' Party": "#930C1A",
    "Workers Party / Republican Clubs": "#930C1A",
    "Socialist Party": "#FF3300",
    "BNP": "#2E3B74",
    "British National Party": "#2E3B74",
    "Conservative": "#0087DC",
    "NI Conservatives": "#0087DC",
    "Northern Ireland Conservatives": "#0087DC",
    "Cross-Community Labour Alternative": "#CD5C5C",
    "NI Labour": "#DC241F",
    "Labour": "#DC241F",
    "Northern Ireland Labour Representation Committee": "#DC241F",
    "IRSP": "#FF0000",
    "Republican Sinn Féin": "#008800",
    "éirígí": "#006400",
}

# Party name normalisation — map variant spellings to a canonical label
PARTY_NORMALISATION: dict[str, str] = {
    "social democratic and labour party": "SDLP",
    "democratic unionist party": "DUP",
    "ulster unionist party": "UUP",
    "alliance party of northern ireland": "Alliance",
    "alliance party": "Alliance",
    "sinn féin": "Sinn Féin",
    "sinn fein": "Sinn Féin",
    "green party in northern ireland": "Green / Ecology",
    "green party": "Green / Ecology",
    "green party northern ireland": "Green / Ecology",
    "traditional unionist voice": "TUV",
    "progressive unionist party": "PUP",
    "uk independence party": "UKIP",
    "united kingdom independence party": "UKIP",
    "people before profit alliance": "People Before Profit Alliance",
    "people before profit": "People Before Profit Alliance",
    "workers' party": "Workers Party",
    "workers party (ireland)": "Workers Party",
    "northern ireland conservatives": "Conservative",
    "conservative party": "Conservative",
    "british national party": "BNP",
    "socialist party (northern ireland)": "Socialist Party",
    "socialist party (ireland)": "Socialist Party",
    "independent": "Independent",
    "éirígí": "Éirígí",
    "eirigi": "Éirígí",
    "irish republican socialist party": "IRSP",
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
    """Normalise a Wikipedia party label to a canonical name."""
    if not raw:
        return "Independent"
    lowered = raw.strip().lower()
    for needle, replacement in PARTY_NORMALISATION.items():
        if needle in lowered:
            return replacement
    return raw.strip()


def get_party_colour(party: str) -> str:
    """Look up party colour, falling back to hash-based colour."""
    colour = PARTY_COLOURS.get(party)
    if colour:
        return colour
    # Try case-insensitive
    lowered = party.lower()
    for k, v in PARTY_COLOURS.items():
        if k.lower() == lowered:
            return v
    # Fallback: generate a deterministic colour from the party name
    digest = hashlib.sha1(party.encode("utf-8")).hexdigest()
    r = (int(digest[0:2], 16) + 96) % 256
    g = (int(digest[2:4], 16) + 96) % 256
    b = (int(digest[4:6], 16) + 96) % 256
    return f"#{r:02X}{g:02X}{b:02X}"


def generate_temp_person_id(name: str) -> str:
    """Generate a temporary PersonID from candidate name using MD5 hash.

    These are temporary — the user will review and assign proper IDs.
    Prefixed with 'T' to clearly mark them as temporary.
    """
    key = re.sub(r"\s+", " ", name.strip().lower())
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return f"T{int(digest[:8], 16)}"


def split_name(display_name: str) -> tuple[str, str]:
    """Split 'Firstname Surname' into (first, last)."""
    parts = display_name.strip().split()
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return ("", parts[0])
    return (" ".join(parts[:-1]), parts[-1])


# ── Main processing ───────────────────────────────────────────────────────

def scrape_council(council: dict, raw_dir: Path) -> tuple[str | None, str | None, str]:
    """Fetch wikitext for a council's 2011 election article."""
    cache_file = raw_dir / f"{council['key']}.wiki"
    if cache_file.exists():
        text = cache_file.read_text(encoding="utf-8")
        return council["variants"][0], text, "cached"

    for variant in council["variants"]:
        title = f"{YEAR} {variant} election"
        text = fetch_raw_title(title)
        if text:
            cache_file.write_text(text, encoding="utf-8")
            return title, text, "exact"

    return None, None, "missing"


def parsed_to_bundle_constituency(
    district: dict,
    council_key: str,
    all_parties: list[dict],
    all_candidates: list[dict],
) -> tuple[str, dict]:
    """Convert a parsed district into _bundle.json constituency format."""
    dea_name = district["dea_name"]
    seats = district["seats"] or 0
    numcounts = district["numcounts"]
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

        # Determine outcome
        outcome = cand.get("outcome") or ""
        if not outcome:
            # Check if candidate was elected based on count data
            # Elected candidates typically have their final count equal to or above quota
            pass

        # Determine occurred_on_count from the last non-None count
        occurred_on_count = ""
        last_count_idx = 0
        for i, count_val in enumerate(cand["counts"]):
            if count_val is not None:
                last_count_idx = i + 1
        if outcome:
            occurred_on_count = str(last_count_idx)

        # First preference votes
        first_pref = cand["counts"][0] if cand["counts"] else 0
        if first_pref is None:
            first_pref = 0

        # Track party for review
        all_parties.append({
            "council": council_key,
            "dea": dea_name,
            "raw_party": raw_party,
            "normalised_party": normalised_party,
            "colour": colour,
        })

        # Track candidate for PersonID review
        all_candidates.append({
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

        # Build one row per count (matching existing bundle format)
        prev_total = 0.0
        for count_idx, count_val in enumerate(cand["counts"]):
            count_number = count_idx + 1
            if count_val is None:
                # Candidate was eliminated before this count — skip
                continue
            total_votes = count_val
            if count_number == 1:
                transfers = 0.0
            else:
                transfers = total_votes - prev_total

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


def detect_elected_from_bold(wikitext: str, parsed: dict) -> None:
    """Detect elected candidates from bold formatting in 2011 wikitext.

    In 2011 Wikipedia articles, elected candidates have bold-formatted names
    ('''name''') while the † marker used in 2014+ is not present.
    The * marker indicates outgoing councillor, not elected status.
    """
    for district in parsed["districts"]:
        dea_name = district["dea_name"]
        numcounts = district["numcounts"]

        for cand in district["candidates"]:
            candidate_raw = cand.get("candidate_raw", "")
            # Check if the raw candidate value contains bold markers
            if "'''" in candidate_raw:
                cand["outcome"] = "Elected"
            else:
                # Not elected — either eliminated early (fewer counts) or
                # survived to the final count without being elected
                cand["outcome"] = "Excluded"


def main() -> None:
    raw_dir = OUTDIR / "raw"
    parsed_dir = OUTDIR / "parsed"
    bundle_dir = OUTDIR / "bundle"
    raw_dir.mkdir(parents=True, exist_ok=True)
    parsed_dir.mkdir(parents=True, exist_ok=True)
    bundle_dir.mkdir(parents=True, exist_ok=True)

    all_parties: list[dict] = []
    all_candidates: list[dict] = []
    scrape_results: list[dict] = []

    for council in COUNCILS:
        key = council["key"]
        display = council["display"]
        print(f"Processing {display}...", end=" ", flush=True)

        title, text, resolution = scrape_council(council, raw_dir)
        if text is None or title is None:
            print(f"MISSING ({resolution})")
            scrape_results.append({
                "council": key, "display": display,
                "title": "", "resolution": resolution,
                "found": False, "dea_count": 0, "candidate_count": 0,
            })
            continue

        # Parse using shared infrastructure
        parsed = parse_count_tables(title, text)

        # Detect elected/excluded status from bold formatting
        # (must run before writing parsed JSON)
        detect_elected_from_bold(text, parsed)

        (parsed_dir / f"{key}.json").write_text(
            json.dumps(parsed, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        # Build bundle constituencies
        constituencies: dict[str, dict] = {}
        for district in parsed["districts"]:
            dea_name, constituency_data = parsed_to_bundle_constituency(
                district, key, all_parties, all_candidates
            )
            constituencies[dea_name] = constituency_data

        # Write per-council bundle
        council_bundle = {
            "body": "local-government",
            "date": ELECTION_DATE,
            "council": display,
            "constituencies": constituencies,
        }
        (bundle_dir / f"{key}_bundle.json").write_text(
            json.dumps(council_bundle, indent=4, ensure_ascii=False), encoding="utf-8"
        )

        total_candidates = sum(d["candidate_count"] for d in parsed["districts"])
        print(f"{parsed['district_count']} DEAs, {total_candidates} candidates")
        scrape_results.append({
            "council": key, "display": display,
            "title": title, "resolution": resolution,
            "found": True,
            "dea_count": parsed["district_count"],
            "candidate_count": total_candidates,
        })

    # Also build the combined _bundle.json (all 26 councils merged)
    # In the existing system, each council is a separate "body" in the elections_index,
    # so the combined bundle groups constituencies by council.
    combined_bundle = {
        "body": "local-government",
        "date": ELECTION_DATE,
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

    # ── Write party review CSV ─────────────────────────────────────────
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

    parties_csv = OUTDIR / "parties.csv"
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
                "action": "",  # For user to fill in: keep / rename / merge
            })

    # ── Write candidate review CSV ─────────────────────────────────────
    candidates_csv = OUTDIR / "candidates.csv"
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
                "assigned_person_id": "",  # For user to fill in
            })

    # ── Summary ────────────────────────────────────────────────────────
    total_deas = sum(r["dea_count"] for r in scrape_results)
    total_candidates = sum(r["candidate_count"] for r in scrape_results)
    found_councils = sum(1 for r in scrape_results if r["found"])
    unique_party_count = len(unique_parties)

    summary = {
        "year": YEAR,
        "date": ELECTION_DATE,
        "councils_requested": len(COUNCILS),
        "councils_found": found_councils,
        "total_deas": total_deas,
        "total_candidates": total_candidates,
        "unique_parties": unique_party_count,
        "output_files": {
            "parties_csv": str(parties_csv),
            "candidates_csv": str(candidates_csv),
            "per_council_bundles": str(bundle_dir),
            "combined_bundle": str(bundle_dir / "_combined_bundle.json"),
        },
        "councils": scrape_results,
    }
    (OUTDIR / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print()
    print(f"Done. {found_councils}/{len(COUNCILS)} councils scraped.")
    print(f"  DEAs: {total_deas}")
    print(f"  Candidates: {total_candidates}")
    print(f"  Unique parties: {unique_party_count}")
    print()
    print(f"Review files:")
    print(f"  Parties:    {parties_csv}")
    print(f"  Candidates: {candidates_csv}")
    print(f"  Bundles:    {bundle_dir}")


if __name__ == "__main__":
    main()
