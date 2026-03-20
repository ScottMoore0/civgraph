#!/usr/bin/env python3
"""
Parse and classify Belfast Gazette Agent and Notice of Poll PDFs.
Extracts election metadata from ~1,859 agent PDFs and ~470 notice of poll PDFs.

Most PDFs are general gazette content (company notices, legislation, civil service,
etc.) that matched search keywords. This script identifies genuinely election-related
documents (actual political election agent appointments and notices of poll) through
multi-factor scoring heuristics.
"""

import fitz  # PyMuPDF
import json
import os
import re
import sys
from collections import defaultdict, Counter

# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

NI_CONSTITUENCIES = [
    # Current Westminster (18)
    "Belfast East", "Belfast North", "Belfast South", "Belfast West",
    "East Antrim", "East Londonderry", "East Derry", "Fermanagh and South Tyrone",
    "Foyle", "Lagan Valley", "Mid Ulster", "Newry and Armagh",
    "North Antrim", "North Down", "South Antrim", "South Down",
    "Strangford", "Upper Bann", "West Tyrone",
    # Historical Stormont/Westminster constituencies
    "Mid Armagh", "North Armagh", "South Armagh",
    "North Belfast", "South Belfast", "East Belfast", "West Belfast", "Central Belfast",
    "North Londonderry", "South Londonderry", "Mid Londonderry",
    "North Derry", "South Derry", "Mid Derry",
    "Londonderry",
    "North Down", "South Down", "West Down",
    "North Tyrone", "South Tyrone", "Mid Tyrone",
    "North Fermanagh", "South Fermanagh",
    # Belfast wards / Stormont divisions
    "Falls", "Dock", "Cromac", "Woodvale", "Shankill",
    "St. Anne's", "St Anne's", "St. Anne",
    "Pottinger", "Ormeau", "Victoria", "Oldpark", "Clifton",
    "Court", "Smithfield", "Windsor", "Willowfield", "Bloomfield",
    "Ballynafeigh", "Duncairn", "Cliftonville",
    "Queen's University", "Queen's University of Belfast",
    "Lisnaskea", "Enniskillen",
    # Stormont divisions
    "Carrick", "Larne", "Bannside", "Mourne", "Iveagh",
    # Assembly / Stormont constituencies (modern)
    "Antrim East", "Antrim North", "Antrim South",
    "Down North", "Down South",
    "Tyrone West", "Tyrone Mid",
    "Armagh North", "Armagh South", "Armagh Mid",
    "Derry East", "Derry Mid",
    "Londonderry East",
    # Local council areas (pre-2014)
    "Antrim", "Ards", "Armagh", "Ballymena", "Ballymoney", "Banbridge",
    "Carrickfergus", "Castlereagh", "Coleraine", "Cookstown", "Craigavon",
    "Derry", "Down", "Dungannon", "Fermanagh", "Larne", "Limavady",
    "Lisburn", "Magherafelt", "Moyle", "Newry and Mourne", "Newtownabbey",
    "North Down", "Omagh", "Strabane",
    # 2014+ super-councils
    "Antrim and Newtownabbey", "Armagh City Banbridge and Craigavon",
    "Belfast", "Causeway Coast and Glens", "Derry City and Strabane",
    "Fermanagh and Omagh", "Lisburn and Castlereagh", "Mid and East Antrim",
    "Mid Ulster", "Newry Mourne and Down", "Ards and North Down",
]

NI_PARTIES = [
    "Sinn Fein", "Sinn F\u00e9in", "Democratic Unionist", "DUP",
    "Ulster Unionist", "UUP", "Official Unionist",
    "Social Democratic and Labour", "SDLP", "Alliance Party", "Alliance",
    "Traditional Unionist Voice", "TUV", "People Before Profit", "PBP",
    "Green Party", "Progressive Unionist", "PUP",
    "Workers Party", "Workers' Party", "Northern Ireland Labour",
    "Vanguard", "VUPP", "Republican Labour", "Nationalist Party",
    "Independent", "National Democratic Party", "Unity",
    "Republican Clubs", "Conservative", "Liberal", "Communist",
    "Natural Law", "UK Unionist", "UKUP",
    "NI Women's Coalition", "Women's Coalition",
]

# ---------------------------------------------------------------------------
# Classification indicators
# ---------------------------------------------------------------------------

# Phrases that indicate actual political election agent appointments
STRONG_AGENT_PHRASES = [
    "i hereby appoint",
    "hereby appoint as my election agent",
    "appointment of election agent",
    "name of election agent",
    "election agent appointed",
    "agents for candidates",
    "appointment of sub-agent",
    "appointed as election agent",
    "the election agent of",
    "the following agents have been appointed",
]

# Phrases for actual political notices of poll
STRONG_POLL_PHRASES = [
    "notice of poll",
    "notice is hereby given that a poll",
    "poll will be taken",
    "situation of polling station",
    "statement of persons nominated",
    "the following persons have been nominated",
    "candidates nominated",
    "the poll will be taken on",
    "vote for not more than",
    "description of polling station",
    "allotted polling station",
]

# Phrases indicating an actual political election context (not civil service, not legislation)
POLITICAL_ELECTION_PHRASES = [
    "member elected to serve",
    "elected to serve in the",
    "parliament of northern ireland",
    "house of commons",
    "northern ireland assembly",
    "district council election",
    "borough council election",
    "local government election",
    "general election",
    "by-election",
    "bye-election",
    "writ of election",
    "constituency of",
    "division of",
    "in the room of",  # "elected in the room of X, deceased/resigned"
    "nomination of candidates",
    "election of member",
    "election of a member",
    "member for the",
    "elected without a contest",
    "elected unopposed",
    "return of member",
]

# Moderate positive indicators
MODERATE_ELECTION_PHRASES = [
    "election agent",
    "returning officer",
    "polling agent",
    "counting agent",
    "personation agent",
    "representation of the people",
    "parliamentary election",
    "ballot paper",
    "ballot box",
    "nomination paper",
    "register of electors",
    "polling day",
    "hours of poll",
    "polling station",
]

# Civil Service / non-political election patterns (false positives)
CIVIL_SERVICE_ELECTION_PHRASES = [
    "civil service committee",
    "treasury regulations",
    "existing irish officers",
    "transferred to the government",
    "industrial and provident",
    "superannuation",
    "youth employment",
    "factory doctor",
    "housing act",
    "housing (ireland)",
    "legal aid",
    "factories act",
]

# Non-election gazette content
NON_ELECTION_PHRASES = [
    "companies act", "companies (northern ireland)",
    "winding up", "liquidat", "insolvency", "bankruptcy",
    "registered office", "limited company",
    "patent", "trade mark", "trademark",
    "town planning", "planning permission",
    "road traffic", "motor vehicle",
    "marriage", "deceased", "probate",
    "administration of estates",
    "industrial and provident", "friendly societ", "building societ",
    "land registry", "land purchase",
    "scale of charges", "authorised scale",
    "the belfast gazette is published",
    "notices and advertisements",
    "trunk road", "new road",
    "housing association", "housing act",
    "electricity supply", "gas supply", "water supply",
    "drainage", "sewerage",
]

# Legislation/rules text (not actual notices)
LEGISLATION_PHRASES = [
    "rules for the conduct",
    "election rules",
    "schedule to the",
    "shall be deemed to be",
    "notwithstanding anything",
    "for the purposes of this",
    "in this order",
    "the minister may",
    "shall come into operation",
    "made under section",
    "statutory rules and orders",
    "order in council",
    "provisions of this act",
    "provided that if",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_text_from_pdf(pdf_path):
    """Extract all text from a PDF using PyMuPDF."""
    try:
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text.strip()
    except Exception as e:
        return f"ERROR: {e}"


def extract_year(text, published_date=None):
    """Extract the election year from text."""
    pub_year = None
    if published_date:
        m = re.match(r'(\d{4})', published_date)
        if m:
            pub_year = int(m.group(1))

    year_pattern = r'\b(19[2-9]\d|20[0-2]\d)\b'
    all_years = [int(m) for m in re.findall(year_pattern, text)]

    # Find years near election-specific context
    election_context_years = []
    for kw in ["election", "poll", "nomination", "appointed", "candidate", "member elected"]:
        for m in re.finditer(kw, text.lower()):
            start = max(0, m.start() - 300)
            end = min(len(text), m.end() + 300)
            context = text[start:end]
            context_years = [int(y) for y in re.findall(year_pattern, context)]
            election_context_years.extend(context_years)

    if election_context_years:
        c = Counter(election_context_years)
        return c.most_common(1)[0][0]

    if pub_year:
        return pub_year

    if all_years:
        c = Counter(all_years)
        return c.most_common(1)[0][0]

    return None


def identify_election_type(text):
    """Identify the election type from text."""
    text_lower = text.lower()
    types_found = set()

    if any(kw in text_lower for kw in [
        "house of commons of northern ireland", "parliament of northern ireland",
        "northern ireland parliament", "stormont"
    ]):
        types_found.add("stormont")

    if any(kw in text_lower for kw in [
        "westminster", "imperial parliament", "parliament of the united kingdom",
        "united kingdom parliament"
    ]):
        types_found.add("westminster")

    if "house of commons" in text_lower:
        if "northern ireland" in text_lower:
            types_found.add("stormont")
        else:
            types_found.add("westminster")

    if any(kw in text_lower for kw in [
        "assembly election", "northern ireland assembly"
    ]):
        types_found.add("assembly")

    if any(kw in text_lower for kw in [
        "local government", "district council", "local election",
        "borough council", "urban district", "rural district",
        "county council election", "city council election",
        "district electoral area", "guardians"
    ]):
        types_found.add("local")

    if any(kw in text_lower for kw in [
        "european parliament", "european election"
    ]):
        types_found.add("european")

    if "forum election" in text_lower or "northern ireland forum" in text_lower:
        types_found.add("forum")

    if "constitutional convention" in text_lower:
        types_found.add("convention")

    is_by = any(kw in text_lower for kw in ["by-election", "bye-election", "byelection"])
    result = list(types_found) if types_found else ["unknown"]
    if is_by:
        result = [t + " by-election" if t != "unknown" else "by-election" for t in result]

    return result


def find_constituencies(text):
    """Find constituency names mentioned in the text."""
    found = []
    text_norm = re.sub(r'\s+', ' ', text)
    for const in NI_CONSTITUENCIES:
        pattern = r'\b' + re.escape(const) + r'\b'
        if re.search(pattern, text_norm, re.IGNORECASE):
            if const not in found:
                found.append(const)
    return found


def extract_names(text):
    """Extract candidate/agent names from text."""
    names = []
    patterns = [
        r'(?:appoint|appointed|elected)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})',
        r'(?:Mr|Mrs|Miss|Ms|Dr|Rev|Sir|Alderman|Councillor|Major|Captain|Colonel)[.\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})',
        r'(?:Name\s+of\s+(?:Agent|Candidate))[:\s]+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})',
    ]
    noise = {"belfast gazette", "northern ireland", "united kingdom", "returning officer",
             "polling station", "election agent", "the following", "this order", "the minister",
             "the right", "the honourable"}
    for pattern in patterns:
        matches = re.findall(pattern, text)
        for m in matches:
            name = m.strip()
            if len(name) > 4 and name not in names and not any(fp in name.lower() for fp in noise):
                names.append(name)
    return names[:30]


def find_parties(text):
    """Find political party mentions."""
    found = []
    for party in NI_PARTIES:
        if re.search(r'\b' + re.escape(party) + r'\b', text, re.IGNORECASE):
            if party not in found:
                found.append(party)
    return found


def classify_document(text, doc_type):
    """
    Classify a document as election-related using a scoring system.
    Distinguishes actual political election documents from:
    - Civil service election notices
    - Election legislation/rules
    - General gazette content
    Returns (is_election_related, confidence, score, category)
    """
    text_lower = text.lower()

    if len(text_lower) < 20:
        return False, "empty", 0, "empty"

    score = 0

    # === Strong positive: actual political election content ===
    political_hits = sum(1 for p in POLITICAL_ELECTION_PHRASES if p in text_lower)
    score += political_hits * 12

    strong_phrases = STRONG_AGENT_PHRASES if doc_type == "agents" else STRONG_POLL_PHRASES
    strong_hits = sum(1 for p in strong_phrases if p in text_lower)
    score += strong_hits * 8

    # === Moderate positive ===
    moderate_hits = sum(1 for p in MODERATE_ELECTION_PHRASES if p in text_lower)
    score += moderate_hits * 2

    # === Negatives ===
    # Civil service election (false positive)
    civil_hits = sum(1 for p in CIVIL_SERVICE_ELECTION_PHRASES if p in text_lower)
    score -= civil_hits * 8

    # Legislation text
    legislation_hits = sum(1 for p in LEGISLATION_PHRASES if p in text_lower)
    score -= legislation_hits * 3

    # Non-election gazette content
    non_election_hits = sum(1 for p in NON_ELECTION_PHRASES if p in text_lower)
    score -= non_election_hits * 5

    # === Structural bonuses ===
    if doc_type == "agents":
        if re.search(r'(?:name|address)\s+(?:of\s+)?(?:election\s+)?agent', text_lower):
            score += 15
        if re.search(r'i\s+hereby\s+appoint.*(?:election\s+agent|as\s+my\s+agent)', text_lower, re.DOTALL):
            score += 20

    elif doc_type == "notice_of_poll":
        if "notice of poll" in text_lower and any(
            kw in text_lower for kw in ["polling station", "poll will be taken", "hours of poll"]
        ):
            score += 20
        if re.search(r'statement\s+of\s+persons\s+nominated', text_lower):
            score += 20
        if "situation of polling station" in text_lower:
            score += 15
        if re.search(r'vote\s+for\s+not\s+more\s+than', text_lower):
            score += 15

    # "MEMBER elected to serve in the ... Parliament" is strong for both types
    if re.search(r'member\s+elected\s+to\s+serve\s+in\s+the\s+.*parliament', text_lower):
        score += 25

    # Determine category
    if score >= 15:
        category = "election_document"
    elif score >= 5:
        category = "election_related"
    elif non_election_hits >= 2:
        category = "non_election"
    else:
        category = "gazette_misc"

    is_election = score >= 15
    confidence = "high" if score >= 25 else ("medium" if score >= 15 else "low")

    return is_election, confidence, score, category


def extract_polling_station_details(text):
    """Extract polling station info from notice of poll PDFs."""
    stations = []
    for pattern in [
        r'(?:polling\s+station|polling\s+place)[:\s]+(.*?)(?:\n|$)',
        r'(?:situation\s+of\s+(?:polling\s+)?station)[:\s]+(.*?)(?:\n|$)',
    ]:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for m in matches:
            s = m.strip()
            if s and len(s) > 3:
                stations.append(s[:150])
    return stations[:50]


def extract_poll_dates(text):
    """Extract polling dates from text."""
    months = "(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    patterns = [
        rf'(\d{{1,2}})\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?({months})\s*,?\s*(\d{{4}})',
        rf'({months})\s+(\d{{1,2}})\s*(?:st|nd|rd|th)?\s*,?\s*(\d{{4}})',
    ]
    dates = []
    for pattern in patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            dates.append(m.group(0).strip())
    return list(set(dates))[:10]


def build_entries_lookup(entries_data):
    """Build filename -> entry lookup from entries.json."""
    lookup = {}
    for entry in entries_data:
        for link in entry.get("link", []):
            href = link.get("@href", "")
            issue_match = re.search(r'issue/(\d+)/page/(\d+)', href)
            if issue_match:
                fname = f"issue_{issue_match.group(1)}_page_{issue_match.group(2)}.pdf"
                lookup[fname] = entry
                break
    return lookup


def process_directory(dir_path, doc_type, entries_data):
    """Process all PDFs in a directory."""
    results = []
    pdfs = sorted([f for f in os.listdir(dir_path) if f.endswith('.pdf')])
    entries_lookup = build_entries_lookup(entries_data)

    total = len(pdfs)
    for i, pdf_name in enumerate(pdfs):
        if (i + 1) % 200 == 0:
            print(f"  Processing {i+1}/{total}...", file=sys.stderr)

        pdf_path = os.path.join(dir_path, pdf_name)
        text = extract_text_from_pdf(pdf_path)

        if text.startswith("ERROR:"):
            results.append({
                "filename": pdf_name,
                "year": None,
                "election_type": [],
                "constituencies": [],
                "is_election_related": False,
                "confidence": "error",
                "score": 0,
                "category": "error",
                "key_names": [],
                "parties": [],
                "text_preview": text[:300],
                "error": text,
            })
            continue

        entry = entries_lookup.get(pdf_name, {})
        published = entry.get("published", "")

        is_election, confidence, score, category = classify_document(text, doc_type)
        year = extract_year(text, published)
        election_type = identify_election_type(text) if is_election else []
        constituencies = find_constituencies(text)
        names = extract_names(text) if is_election else []
        parties = find_parties(text) if is_election else []

        record = {
            "filename": pdf_name,
            "year": year,
            "election_type": election_type,
            "constituencies": constituencies,
            "is_election_related": is_election,
            "confidence": confidence,
            "score": score,
            "category": category,
            "key_names": names,
            "parties": parties,
            "text_preview": re.sub(r'\s+', ' ', text[:400]),
        }

        if doc_type == "notice_of_poll" and is_election:
            record["polling_stations"] = extract_polling_station_details(text)
            record["poll_dates"] = extract_poll_dates(text)

        if published:
            record["gazette_published"] = published

        results.append(record)

    return results


def print_summary(agent_results, nop_results):
    """Print detailed summary."""
    print("\n" + "=" * 80)
    print("BELFAST GAZETTE PDF CLASSIFICATION SUMMARY")
    print("=" * 80)

    # ------ AGENTS ------
    print("\n" + "-" * 80)
    print("SECTION 1: ELECTION AGENT APPOINTMENTS")
    print("-" * 80)

    election_agents = [r for r in agent_results if r["is_election_related"]]
    non_election = [r for r in agent_results if not r["is_election_related"]]

    print(f"\nTotal agent PDFs processed: {len(agent_results)}")
    print(f"Election-related:          {len(election_agents)}")
    print(f"  High confidence:         {sum(1 for r in election_agents if r['confidence']=='high')}")
    print(f"  Medium confidence:       {sum(1 for r in election_agents if r['confidence']=='medium')}")
    print(f"Non-election:              {len(non_election)}")

    cats = Counter(r["category"] for r in agent_results)
    print(f"\nCategory breakdown:")
    for cat, cnt in cats.most_common():
        print(f"  {cat}: {cnt}")

    by_year_type = defaultdict(lambda: defaultdict(int))
    for r in election_agents:
        yr = r["year"] or "unknown"
        for et in r["election_type"]:
            by_year_type[yr][et] += 1

    if by_year_type:
        print(f"\nElection agents by year and type:")
        for yr in sorted(by_year_type.keys(), key=lambda x: (isinstance(x, str), x)):
            types = by_year_type[yr]
            type_str = ", ".join(f"{t}: {c}" for t, c in sorted(types.items()))
            print(f"  {yr}: {type_str} (total: {sum(types.values())})")

    if election_agents:
        print(f"\nDetailed election agent records:")
        for r in sorted(election_agents, key=lambda x: (x["year"] or 9999, x["filename"])):
            yr = r["year"] or "?"
            et = ", ".join(r["election_type"])
            const = ", ".join(r["constituencies"][:5]) if r["constituencies"] else "none"
            names_str = ", ".join(r["key_names"][:5]) if r["key_names"] else "none"
            parties_str = ", ".join(r["parties"][:3]) if r["parties"] else "none"
            print(f"  {r['filename']}")
            print(f"    Year: {yr} | Type: {et} | Score: {r['score']} | Confidence: {r['confidence']}")
            print(f"    Constituencies: {const}")
            print(f"    Names: {names_str}")
            print(f"    Parties: {parties_str}")
            print(f"    Preview: {r['text_preview'][:180]}...")

    # ------ NOTICES OF POLL ------
    print("\n" + "-" * 80)
    print("SECTION 2: NOTICES OF POLL")
    print("-" * 80)

    election_nop = [r for r in nop_results if r["is_election_related"]]
    non_election_nop = [r for r in nop_results if not r["is_election_related"]]

    print(f"\nTotal notice of poll PDFs processed: {len(nop_results)}")
    print(f"Election-related:                    {len(election_nop)}")
    print(f"  High confidence:                   {sum(1 for r in election_nop if r['confidence']=='high')}")
    print(f"  Medium confidence:                 {sum(1 for r in election_nop if r['confidence']=='medium')}")
    print(f"Non-election:                        {len(non_election_nop)}")

    cats_nop = Counter(r["category"] for r in nop_results)
    print(f"\nCategory breakdown:")
    for cat, cnt in cats_nop.most_common():
        print(f"  {cat}: {cnt}")

    by_year_type_nop = defaultdict(lambda: defaultdict(int))
    for r in election_nop:
        yr = r["year"] or "unknown"
        for et in r["election_type"]:
            by_year_type_nop[yr][et] += 1

    if by_year_type_nop:
        print(f"\nNotices of poll by year and type:")
        for yr in sorted(by_year_type_nop.keys(), key=lambda x: (isinstance(x, str), x)):
            types = by_year_type_nop[yr]
            type_str = ", ".join(f"{t}: {c}" for t, c in sorted(types.items()))
            print(f"  {yr}: {type_str} (total: {sum(types.values())})")

    if election_nop:
        print(f"\nDetailed notice of poll records:")
        for r in sorted(election_nop, key=lambda x: (x["year"] or 9999, x["filename"])):
            yr = r["year"] or "?"
            et = ", ".join(r["election_type"])
            const = ", ".join(r["constituencies"][:5]) if r["constituencies"] else "none"
            stations = r.get("polling_stations", [])
            dates = r.get("poll_dates", [])
            print(f"  {r['filename']}")
            print(f"    Year: {yr} | Type: {et} | Score: {r['score']} | Confidence: {r['confidence']}")
            print(f"    Constituencies: {const}")
            if dates:
                print(f"    Poll dates: {', '.join(dates[:3])}")
            if stations:
                print(f"    Polling stations ({len(stations)}): {stations[0][:80]}...")
            print(f"    Preview: {r['text_preview'][:180]}...")

    # ------ OVERALL ------
    print("\n" + "-" * 80)
    print("OVERALL SUMMARY")
    print("-" * 80)
    total_election = len(election_agents) + len(election_nop)
    total_non = len(non_election) + len(non_election_nop)
    print(f"Total PDFs processed:   {len(agent_results) + len(nop_results)}")
    print(f"Total election-related: {total_election}")
    print(f"Total non-election:     {total_non}")

    # Borderline documents for review
    borderline = [r for r in agent_results + nop_results if 5 <= r["score"] < 15]
    if borderline:
        print(f"\nBorderline documents (score 5-14, not classified as election): {len(borderline)}")
        for r in sorted(borderline, key=lambda x: -x["score"])[:25]:
            src = "agent" if r["filename"] in {x["filename"] for x in agent_results} else "nop"
            print(f"  [{src}] {r['filename']}: score={r['score']}, cat={r['category']}")
            print(f"    {r['text_preview'][:150]}...")

    # High-negative-score documents (sanity check)
    all_results = agent_results + nop_results
    negative = [r for r in all_results if r["score"] < -10]
    if negative:
        print(f"\nStrongly non-election documents (score < -10): {len(negative)}")


def main():
    base_dir = "C:/Users/scomo/boundaries-website/_tmp_gazette"
    agents_dir = os.path.join(base_dir, "belfast_agents")
    nop_dir = os.path.join(base_dir, "belfast_notice_of_poll")

    with open(os.path.join(agents_dir, "entries.json"), "r", encoding="utf-8") as f:
        agents_entries = json.load(f)
    with open(os.path.join(nop_dir, "entries.json"), "r", encoding="utf-8") as f:
        nop_entries = json.load(f)

    print("Processing agent PDFs...", file=sys.stderr)
    agent_results = process_directory(agents_dir, "agents", agents_entries)

    print("Processing notice of poll PDFs...", file=sys.stderr)
    nop_results = process_directory(nop_dir, "notice_of_poll", nop_entries)

    # Save results
    agents_output = os.path.join(agents_dir, "parsed_index.json")
    with open(agents_output, "w", encoding="utf-8") as f:
        json.dump(agent_results, f, indent=2, ensure_ascii=False)
    print(f"Saved {len(agent_results)} agent records to {agents_output}", file=sys.stderr)

    nop_output = os.path.join(nop_dir, "parsed_index.json")
    with open(nop_output, "w", encoding="utf-8") as f:
        json.dump(nop_results, f, indent=2, ensure_ascii=False)
    print(f"Saved {len(nop_results)} notice of poll records to {nop_output}", file=sys.stderr)

    print_summary(agent_results, nop_results)


if __name__ == "__main__":
    main()
