#!/usr/bin/env python
"""Scrape Parliament of Northern Ireland (Stormont) general election results
from Wikipedia and emit per-constituency JSON files matching the existing
election viewer schema.

Source: each constituency's own Wikipedia page (categories
'Constituencies of the Northern Ireland Parliament' and
'Constituencies of the Northern Ireland Parliament in Belfast').

Each constituency page contains one wikitable per election it contested,
titled "General Election <date> : <Constituency>" or
"By-election <date> : <Constituency>". We only keep general elections
matching the 12 Stormont GE dates.

Output: election-viewer-package/data/elections/parliament-of-northern-ireland/<date>/<slug>.json
"""
import html as html_lib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / "_tmp_stormont" / "pages"
CACHE.mkdir(parents=True, exist_ok=True)
OUT_BASE = REPO / "election-viewer-package" / "data" / "elections" / "parliament-of-northern-ireland"

UA = "Mozilla/5.0 boundaries-website-scraper (scomoni@gmail.com) - historical NI election archive"

# Wikipedia's comprehensive list — gives us (year, constituency) -> exact date
# for every Stormont by-election. Used to resolve year-only by-election titles
# on individual constituency pages.
BYELECTIONS_LIST_URL = "https://en.wikipedia.org/wiki/List_of_Northern_Ireland_Parliament_by-elections"

# 12 Stormont general elections. Map ISO date -> human form used in tables.
ELECTION_DATES = {
    "1921-05-24": "24 May 1921",
    "1925-04-03": "3 April 1925",
    "1929-05-22": "22 May 1929",
    "1933-11-30": "30 November 1933",
    "1938-02-09": "9 February 1938",
    "1945-06-14": "14 June 1945",
    "1949-02-10": "10 February 1949",
    "1953-10-22": "22 October 1953",
    "1958-03-20": "20 March 1958",
    "1962-05-31": "31 May 1962",
    "1965-11-25": "25 November 1965",
    "1969-02-24": "24 February 1969",
}
# Reverse: human-form lowercase -> iso
HUMAN_TO_ISO = {v.lower(): k for k, v in ELECTION_DATES.items()}
# Year-only fallback (Wikipedia tables sometimes use "General Election 1929"
# without the day/month). Each Stormont GE year is unique.
YEAR_TO_ISO = {iso[:4]: iso for iso in ELECTION_DATES}

# Known constituency Wikipedia titles. From the two MediaWiki categories,
# excluding parent articles. URL form (spaces -> _; ' kept).
CONSTITUENCIES = [
    # Constituencies of the Northern Ireland Parliament
    "Antrim", "Antrim Borough", "South Antrim",
    "Ards", "Armagh", "Bangor", "Bannside",
    "Belfast Ballynafeigh", "Belfast Cromac", "Belfast East", "Belfast North",
    "Belfast South", "Belfast West",
    "Central Armagh", "City of Londonderry",
    "Down", "East Down", "East Tyrone", "South Tyrone",
    "Enniskillen", "Fermanagh and Tyrone", "South Fermanagh", "Foyle",
    "Iveagh", "Lagan Valley", "Larkfield", "Larne",
    "Lisnaskea", "Londonderry", "South Londonderry",
    "Mid Antrim", "Mid Armagh", "Mid Down", "Mid Londonderry", "Mid Tyrone",
    "Mourne", "Newtownabbey",
    "North Antrim", "North Armagh", "North Down", "North Londonderry", "North Tyrone",
    "Queen's University of Belfast",
    "South Armagh", "South Down",
    "West Down", "West Tyrone",
    # Constituencies of the Northern Ireland Parliament in Belfast (extras)
    "Belfast Bloomfield", "Belfast Central", "Belfast Clifton", "Belfast Dock",
    "Belfast Duncairn", "Belfast Falls", "Belfast Oldpark", "Belfast Pottinger",
    "Belfast Shankill", "Belfast St Anne's", "Belfast Victoria", "Belfast Willowfield",
    "Belfast Windsor", "Belfast Woodvale",
    # Carrick (in Stormont1929 FGB but Wikipedia article is at "Carrick (Northern Ireland Parliament constituency)")
    "Carrick",
]


def url_for(name: str) -> str:
    import urllib.parse
    title = name.replace(" ", "_") + "_(Northern_Ireland_Parliament_constituency)"
    safe_chars = "_'()"
    return "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title, safe=safe_chars)


def fetch(url: str, cache_key: str) -> str:
    p = CACHE / f"{cache_key}.html"
    if p.exists() and p.stat().st_size > 5000:
        return p.read_text(encoding="utf-8")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read().decode("utf-8")
    except Exception as e:
        print(f"  ! fetch fail {url}: {e}")
        return ""
    p.write_text(data, encoding="utf-8")
    time.sleep(0.4)  # politeness
    return data


def slugify(s: str) -> str:
    s = s.lower().replace("&", "and")
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    return s


# Party colours — minimal subset appropriate for Stormont era.
PARTY_LABEL = {
    "uup": "Ulster Unionist Party",
    "ulster unionist party": "Ulster Unionist Party",
    "ulster unionist": "Ulster Unionist Party",
    "ulster unionist (anti-o'neill)": "Ulster Unionist Party (Anti-O'Neill)",
    "ulster unionist (pro-o'neill)": "Ulster Unionist Party (Pro-O'Neill)",
    "u": "Ulster Unionist Party",
    "ind unionist": "Independent Unionist",
    "ind. unionist": "Independent Unionist",
    "independent unionist": "Independent Unionist",
    "ulster liberal": "Ulster Liberal Party",
    "liberal": "Liberal",
    "nationalist": "Nationalist Party",
    "irish nationalist": "Nationalist Party",
    "nationalist party": "Nationalist Party",
    "nat": "Nationalist Party",
    "republican labour": "Republican Labour Party",
    "republican labour party": "Republican Labour Party",
    "socialist republican": "Socialist Republican Party",
    "republican": "Republican",
    "ind republican": "Independent Republican",
    "ind. republican": "Independent Republican",
    "independent republican": "Independent Republican",
    "anti-partition": "Anti-Partitionist",
    "anti-partitionist": "Anti-Partitionist",
    "sinn féin": "Sinn Féin",
    "sinn fein": "Sinn Féin",
    "sf": "Sinn Féin",
    "labour": "Northern Ireland Labour Party",
    "nilp": "Northern Ireland Labour Party",
    "ni labour": "Northern Ireland Labour Party",
    "northern ireland labour": "Northern Ireland Labour Party",
    "northern ireland labour party": "Northern Ireland Labour Party",
    "ind labour": "Independent Labour",
    "ind. labour": "Independent Labour",
    "independent labour": "Independent Labour",
    "commonwealth labour": "Commonwealth Labour Party",
    "commonwealth labour party": "Commonwealth Labour Party",
    "people's democracy": "People's Democracy",
    "peoples democracy": "People's Democracy",
    "pd": "People's Democracy",
    "national democratic": "National Democratic Party",
    "ndp": "National Democratic Party",
    "national democratic party": "National Democratic Party",
    "protestant unionist": "Protestant Unionist",
    "pu": "Protestant Unionist",
    "republican clubs": "Republican Clubs",
    "communist": "Communist Party",
    "communist party": "Communist Party",
    "ind": "Independent",
    "independent": "Independent",
}

PARTY_COLOURS = {
    "Ulster Unionist Party": "#48A5EE",
    "Ulster Unionist Party (Anti-O'Neill)": "#1E5C9E",
    "Ulster Unionist Party (Pro-O'Neill)": "#9CC6E8",
    "Independent Unionist": "#AADFFF",
    "Ulster Liberal Party": "#DAA520",
    "Liberal": "#FAA61A",
    "Nationalist Party": "#32CD32",
    "Republican Labour Party": "#85DE59",
    "Socialist Republican Party": "#FF6666",
    "Republican": "#90EE90",
    "Independent Republican": "#CDFFAB",
    "Anti-Partitionist": "#228B22",
    "Sinn Féin": "#326760",
    "Northern Ireland Labour Party": "#DC241F",
    "Independent Labour": "#FF9999",
    "Commonwealth Labour Party": "#FF6666",
    "People's Democracy": "#FF0000",
    "National Democratic Party": "#3CB371",
    "Protestant Unionist": "#D46A4C",
    "Republican Clubs": "#930C1A",
    "Communist Party": "#E3170D",
    "Independent": "#DCDCDC",
}


def normalise_party(raw: str) -> str:
    s = raw.strip().rstrip(".")
    s_low = s.lower().strip()
    if s_low in PARTY_LABEL:
        return PARTY_LABEL[s_low]
    # Try without parenthetical bits and footnote markers
    s2 = re.sub(r"\[\d+\]", "", s_low).strip()
    if s2 in PARTY_LABEL:
        return PARTY_LABEL[s2]
    return s


def party_colour(name: str) -> str:
    return PARTY_COLOURS.get(name, "#A0A0A0")


def candidate_id(date: str, slug: str, last: str, first: str) -> str:
    base = f"{date}|{slug}|{last}|{first}".lower()
    h = 0
    for ch in base:
        h = (h * 131 + ord(ch)) & 0xFFFFFF
    return str(h)


def strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    s = html_lib.unescape(s)
    s = re.sub(r"\[\d+\]", "", s)  # footnote markers
    s = re.sub(r"\xa0", " ", s)
    return s


def split_tables(html: str):
    """Yield (start_idx, end_idx, inner_html) for each <table class="wikitable...">."""
    pat = re.compile(r'<table[^>]*class="[^"]*wikitable[^"]*"', re.I)
    matches = [m.start() for m in pat.finditer(html)]
    for start in matches:
        depth = 0
        i = start
        while i < len(html):
            if html.startswith("<table", i):
                depth += 1
                i = html.find(">", i) + 1
            elif html.startswith("</table>", i):
                depth -= 1
                end = i + len("</table>")
                if depth == 0:
                    yield start, end, html[start:end]
                    break
                i = end
            else:
                i += 1


# Year cell — "1929", "1929 (b)", "MPs (1929)", "MPs 1929", etc.
YEAR_RE = re.compile(r"^(?:MPs\s*\(?\s*)?(\d{4})\s*\)?\s*(\(b\)|\(B\)|by)?\s*$")
GE_YEARS = {int(iso[:4]): iso for iso in ELECTION_DATES}
# Prose-format range header — split on these and parse each segment.
PROSE_HEADER_RE = re.compile(r"(\d{4})\s*[–—\-]\s*(\d{4})\s*:\s*", re.I)


def parse_prose_mps(html: str):
    """Look for a 'Members of Parliament' section that lists MPs in prose
    form rather than a table. Returns list of (start_year, end_year, name,
    party) tuples. End_year is exclusive (next MP took over)."""
    sec = None
    m = re.search(r'<h[23]\s+id="Members_of_Parliament"[^>]*>.*?</h[23]>(.*?)(?:<h[23]|<table\s+class=)', html, re.S)
    if m:
        sec = m.group(1)
    if not sec:
        return []
    # Replace tags with a single space so name/party text concatenates
    # cleanly. Then split on each "YYYY – YYYY:" header.
    text = re.sub(r"<[^>]+>", " ", sec)
    text = html_lib.unescape(text)
    text = re.sub(r"\s+", " ", text)
    out = []
    matches = list(PROSE_HEADER_RE.finditer(text))
    for i, m in enumerate(matches):
        start = int(m.group(1))
        end = int(m.group(2))
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end].strip()
        # Body looks like "Name , Party (extras...)". Find the first comma.
        if "vacant" in body.lower()[:30]:
            continue
        # Strip trailing source markers / footnotes
        body = re.sub(r"Source\s*:.*$", "", body, flags=re.I).strip().rstrip("|").strip()
        if "," not in body:
            continue
        name, _, rest = body.partition(",")
        name = name.strip()
        # Party = up to next " (" parenthesis or end
        party = rest.strip()
        # Strip trailing parenthetical annotations like "(1969–70); ..."
        party = re.split(r"\s*\(", party)[0].strip().rstrip(";").strip()
        if not re.search(r"[A-Z]", name) or len(name) > 60:
            continue
        if not party or len(party) > 80:
            continue
        out.append((start, end, name, party))
    return out


def incumbent_at_prose(prose_list, ge_year):
    """Find (name, party) holding the seat at ge_year using prose ranges."""
    for start, end, name, party in prose_list:
        if start <= ge_year <= end:
            return name, party
    return None


def parse_summary_table(table_html: str):
    """Parse a constituency's 'Members of Parliament' summary table.

    Returns an ordered list of (year:int, member:str|None, party:str|None,
    is_by_election:bool). Continuation rows (blank member/party) inherit
    from the most recent prior row with values. Both Style-A (every year
    listed) and Style-B (only MP-change rows) tables are handled.
    """
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.S)
    events = []
    cur_member, cur_party = None, None
    for row in rows:
        cells_html = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
        cells = [strip_tags(c).strip() for c in cells_html]
        if not cells:
            continue
        # Skip header rows
        if any(h.lower() in {"election", "elected", "member", "members", "party", "name"}
               for h in cells if h):
            continue
        # Find first cell that looks like a year
        year = None
        is_by = False
        rest = []
        for c in cells:
            if year is None:
                m = YEAR_RE.match(c)
                if m:
                    year = int(m.group(1))
                    is_by = bool(m.group(2))
                    continue
            if c:
                rest.append(c)
        if year is None:
            continue
        # Of the remaining text cells, identify member-name and party.
        member = None
        party = None
        for c in rest:
            if not c: continue
            # Skip abolition / merger notes
            cl = c.lower()
            if any(k in cl for k in ("abolished", "constituency abolished", "merged",
                                     "see ", "list of")):
                continue
            # Check if it's a known party label (case-insensitive)
            if c.lower() in PARTY_LABEL or normalise_party(c) in PARTY_COLOURS:
                if party is None:
                    party = normalise_party(c)
                continue
            # Otherwise treat as member name (must contain a space and capital)
            if member is None and re.search(r"[A-Z]", c) and " " in c and len(c) <= 60:
                member = c
                continue
        # Apply inheritance for continuation rows
        if member is None:
            member = cur_member
        else:
            cur_member = member
        if party is None:
            party = cur_party
        else:
            cur_party = party
        events.append((year, member, party, is_by))
    return events


def incumbent_at(events, ge_year):
    """Find the (member, party) holding the seat at a given GE year.
    Use the latest event whose year <= ge_year.
    """
    best = None
    for ev_year, member, party, is_by in events:
        if ev_year <= ge_year:
            best = (member, party, ev_year, is_by)
    return best


_MONTHS = {m: i for i, m in enumerate(
    ["January","February","March","April","May","June",
     "July","August","September","October","November","December"], start=1)}

def parse_human_date(s):
    """'2 April 1942' -> '1942-04-02'."""
    if not s: return None
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$", s.strip())
    if not m: return None
    day = int(m.group(1)); year = int(m.group(3))
    mon = _MONTHS.get(m.group(2).capitalize())
    if mon is None: return None
    return f"{year:04d}-{mon:02d}-{day:02d}"


def _normalise_const(s):
    s = s.strip().lower().replace("'", "").replace("'", "")
    s = re.sub(r"\s+", " ", s)
    return s


def fetch_byelection_lookup():
    """Build a {(year, normalised_constituency): iso_date} map from
    Wikipedia's 'List of Northern Ireland Parliament by-elections' page.
    Used to resolve year-only by-election titles on constituency pages."""
    html = fetch(BYELECTIONS_LIST_URL, "_byelections_list")
    if not html: return {}, []
    parts = html.split('class="wikitable')
    if len(parts) < 2: return {}, []
    table = '<table class="wikitable' + parts[1].split('</table>')[0] + '</table>'
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)
    lookup = {}
    all_rows = []
    for r in rows:
        cells_html = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)
        cells = []
        for c in cells_html:
            t = strip_tags(c).strip()
            cells.append(t)
        if not cells or not cells[0] or cells[0].lower().startswith("date"):
            continue
        date_str = cells[0]
        const_str = cells[1] if len(cells) > 1 else ""
        iso = parse_human_date(date_str)
        if iso is None or not const_str:
            continue
        year = int(iso[:4])
        key = (year, _normalise_const(const_str))
        # If a year sees multiple by-elections in the same constituency
        # (rare), prefer first; record all in `all_rows` for completeness.
        if key not in lookup:
            lookup[key] = iso
        all_rows.append((iso, const_str))
    return lookup, all_rows


def parse_table(table_html: str, constituency: str):
    """Return (iso_date, seats, candidate_rows) or None if not a Stormont GE.

    Two title orderings appear on Wikipedia:
      "General Election <DD Month YYYY> : <Constituency>"        (single-member)
      "<DD Month YYYY> General Election : <Constituency> (N seats)"  (STV multi-member)
    """
    text = strip_tags(table_html)
    # Title patterns. Returns ('ge', iso) or ('by', iso) depending on type.
    iso = None
    kind = None
    flags = re.I

    # By-election patterns first (they're easier to identify):
    #   "By-election <DD Month YYYY> : <Constituency>"
    #   "<DD Month YYYY> by-election : <Constituency>"
    #   "<YYYY> <Constituency> by-election"  (year-only — needs lookup)
    by_m = re.search(r"by-?election\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*:", text, flags)
    if not by_m:
        by_m = re.search(r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+by-?election", text, flags)
    if by_m:
        iso = parse_human_date(by_m.group(1).strip())
        if iso:
            kind = "by"
    if iso is None:
        # Year-only by-election: "<YYYY> <Constituency> by-election"
        ym = re.search(r"(\d{4})\s+[^<]+?by-?election", text, flags)
        if ym:
            year = int(ym.group(1))
            key = (year, _normalise_const(constituency))
            iso_lookup = BY_LOOKUP.get(key)
            if iso_lookup:
                iso = iso_lookup
                kind = "by"
    # GE patterns:
    if iso is None:
        m = re.search(r"General Election\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*:", text, flags)
        if not m:
            m = re.search(r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+General Election\s*:", text, flags)
        if m:
            date_human = m.group(1).strip().lower()
            iso = HUMAN_TO_ISO.get(date_human)
            if iso is None:
                year = date_human.split()[-1]
                iso = YEAR_TO_ISO.get(year)
            if iso: kind = "ge"
    if iso is None:
        m = re.search(r"General Election\s+(\d{4})\s*:", text, flags)
        if not m:
            m = re.search(r"(\d{4})\s+General Election\s*:", text, flags)
        if m:
            iso = YEAR_TO_ISO.get(m.group(1))
            if iso: kind = "ge"
    if iso is None or kind is None:
        return None
    # Detect "(N seats)" annotation in the title for multi-member STV
    seats = 1
    sm = re.search(r"\((\d+)\s*seats?\)", text)
    if sm:
        seats = int(sm.group(1))

    # Walk <tr> elements. The first row is the header; skip any whose first
    # data cell contains "Party"/"Candidate"/"Votes". Candidate rows have at
    # least 4 data cells: party, candidate, votes, percent.
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.S)
    candidates = []
    for row in rows:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
        if not cells: continue
        cell_text = [strip_tags(c).strip() for c in cells]
        # Skip header-style rows
        if any(re.match(r"^(Party|Candidate|Votes|%|Election|Member|Status)$", x, re.I) for x in cell_text[:6]):
            continue
        # Skip aggregate rows ("Majority", "Turnout", "Registered electors", swing rows)
        joined = " ".join(cell_text).lower()
        if any(k in joined for k in ("majority", "turnout", "registered", "rejected ballots",
                                     "swing", "hold", "gain", "win", "death of", "elevation",
                                     "resignation", "appointed", "death", "by-election")):
            continue
        # A candidate row needs a non-empty party + candidate cell.
        # First cell may be empty or a party-colour swatch; party usually in cell 1.
        # Try to identify (party, name, votes, pct) by scanning the row.
        # Heuristic: party = first non-numeric cell that's a party-ish word; name = next text cell;
        #            votes = first integer / "Unopposed"; pct = first cell ending in %.
        party = ""
        name = ""
        votes = ""
        pct = ""
        for c in cell_text:
            if not c: continue
            if not party and not re.match(r"^[\d,]+$", c) and not c.endswith("%") and c.lower() != "n/a":
                # crude: party label is short (<= 60 chars) and not a number
                if len(c) <= 60 and not re.match(r"^new$", c, re.I):
                    party = c
                    continue
            if party and not name and not re.match(r"^[\d,]+$", c) and not c.endswith("%") and c.lower() not in ("unopposed","n/a","new","yes","no"):
                if len(c) <= 80:
                    name = c
                    continue
            if name and not votes:
                if c.lower() == "unopposed":
                    votes = "Unopposed"; continue
                if re.match(r"^[\d,]+$", c):
                    votes = c.replace(",", ""); continue
            if not pct and c.endswith("%"):
                pct = c.rstrip("%").strip()
                continue
        if party and name:
            candidates.append({"party_raw": party, "name": name, "votes": votes, "pct": pct})
    return iso, seats, candidates, kind


def parse_name(name_raw: str):
    s = name_raw.strip()
    elected = s.endswith("*")
    if elected: s = s[:-1].strip()
    if "," in s:
        last, first = s.split(",", 1)
        return first.strip(), last.strip(), elected
    parts = s.rsplit(maxsplit=1)
    if len(parts) == 2:
        return parts[0], parts[1], elected
    return s, "", elected


def emit_constituency(date_iso: str, constituency: str, candidates: list, seats: int = 1):
    slug = slugify(constituency)
    cands_sorted = sorted(candidates, key=lambda c: (-9999 if c["votes"] == "Unopposed" else -int(c["votes"]) if c["votes"].isdigit() else 0))
    countGroup = []
    for idx, c in enumerate(cands_sorted):
        first, last, _ = parse_name(c["name"])
        party = normalise_party(c["party_raw"])
        v = c["votes"]
        if v == "Unopposed":
            fp = "Unopposed"; tot = ""
        elif v.isdigit():
            fp = f"{int(v):.2f}"; tot = fp
        else:
            fp = ""; tot = ""
        countGroup.append({
            "Candidate_First_Pref_Votes": fp,
            "Candidate_Id": candidate_id(date_iso, slug, last, first),
            "Constituency_Number": "",
            "Count_Number": "1",
            "Firstname": first,
            "Occurred_On_Count": "",
            "Party_Colour": party_colour(party),
            "Party_Name": party,
            "Status": "Elected" if idx < seats else "",
            "Surname": last,
            "Total_Votes": tot,
            "Transfers": "0.00",
            "candidateName": (first + " " + last).strip(),
            "id": idx,
        })
    return {
        "Constituency": {
            "countInfo": {
                "Constituency_Name": constituency,
                "Constituency_Number": "",
                "Number_Of_Seats": str(seats),
                "Spoiled": "",
                "Total_Electorate": "",
                "Total_Poll": "",
                "Valid_Poll": "",
            },
            "countGroup": countGroup,
        }
    }, slug


# Wikipedia titles whose article uses an unusual disambiguator suffix or name
# variant. Map our local label -> exact URL title.
URL_OVERRIDES = {
    "Belfast St Anne's": "Belfast_St_Anne's",
    "Down": "Down",  # disambig page also exists; prefer constituency one
}

# Constituencies that ceased to exist at a known year — don't synthesise
# entries for GE dates after that. The abolition cut-off is the LAST GE the
# constituency contested.
ABOLISHED_AFTER = {
    "Queen's University of Belfast": 1965,  # abolished 1968 for 1969 election
    # 1921-1929 county multi-member STV constituencies (replaced by 1929 redistricting):
    "Antrim":              1925,  # ANTRIM borough seat continues post-1929 (separate Wikipedia page "Antrim Borough")
    "Armagh":              1925,
    "Down":                1925,
    "Fermanagh and Tyrone": 1925,
}


def main():
    import urllib.parse as _up
    global urllib  # for url_for
    urllib.parse = _up

    # Build by-election lookup first (so parse_table can resolve year-only
    # by-election titles via the global BY_LOOKUP).
    global BY_LOOKUP
    BY_LOOKUP, _ = fetch_byelection_lookup()
    print(f"By-election lookup: {len(BY_LOOKUP)} entries")

    summary = {iso: [] for iso in ELECTION_DATES}
    by_summary = {}  # iso_date -> list of constituency names
    synth_count = 0
    for const in CONSTITUENCIES:
        title = URL_OVERRIDES.get(const, const).replace(" ", "_") + "_(Northern_Ireland_Parliament_constituency)"
        url = f"https://en.wikipedia.org/wiki/{_up.quote(title, safe='_()')}"
        cache_key = re.sub(r"[^\w-]", "_", const)
        html = fetch(url, cache_key)
        if not html or len(html) < 5000:
            print(f"  ! {const}: no page content")
            continue

        # Pass 1: detailed result tables (GE + by-election)
        tables = list(split_tables(html))
        contested_dates = set()
        n_emitted = 0
        n_by = 0
        for _, _, table in tables:
            parsed = parse_table(table, const)
            if not parsed: continue
            iso, seats, candidates, kind = parsed
            if not candidates: continue
            obj, slug = emit_constituency(iso, const, candidates, seats)
            out_dir = OUT_BASE / iso
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{slug}.json").write_text(
                json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
            if kind == "ge":
                summary[iso].append(const)
                contested_dates.add(iso)
                n_emitted += 1
            else:
                by_summary.setdefault(iso, []).append(const)
                n_by += 1

        # Pass 2: synthesise unopposed entries for any GE date without a
        # contested result. Try the first wikitable as a "Members of
        # Parliament" summary; if that yields no events (or the table looks
        # like a detail-result table because it has no summary table), fall
        # back to a prose parser for the "Members of Parliament" section.
        n_synth = 0
        events = []
        if tables:
            first_table_html = tables[0][2]
            events = parse_summary_table(first_table_html)
        prose = parse_prose_mps(html) if not events else []
        if events or prose:
            cutoff = ABOLISHED_AFTER.get(const)
            for ge_year, ge_iso in GE_YEARS.items():
                if ge_iso in contested_dates:
                    continue
                if cutoff is not None and ge_year > cutoff:
                    continue
                member, party = None, None
                if events:
                    inc = incumbent_at(events, ge_year)
                    if inc:
                        m, p, _, _ = inc
                        member, party = m, p
                if (not member or not party) and prose:
                    inc = incumbent_at_prose(prose, ge_year)
                    if inc:
                        member, party = inc
                if not member or not party:
                    continue
                cand = [{"party_raw": party, "name": member,
                         "votes": "Unopposed", "pct": ""}]
                obj, slug = emit_constituency(ge_iso, const, cand, 1)
                out_dir = OUT_BASE / ge_iso
                out_dir.mkdir(parents=True, exist_ok=True)
                out_path = out_dir / f"{slug}.json"
                if out_path.exists():
                    continue
                out_path.write_text(json.dumps(obj, indent=2, ensure_ascii=False),
                                    encoding="utf-8")
                summary[ge_iso].append(const)
                n_synth += 1
        synth_count += n_synth
        print(f"  {const}: {n_emitted} GE + {n_synth} synth + {n_by} by-elec")
    # Write summary
    summary_payload = []
    for iso, names in summary.items():
        unique = sorted(set(names))
        summary_payload.append({"date": iso, "constituencies": unique})
    OUT_BASE.mkdir(parents=True, exist_ok=True)
    (OUT_BASE / "_index.json").write_text(
        json.dumps(summary_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\nPer-election counts:")
    for iso in sorted(ELECTION_DATES):
        print(f"  {iso}: {len(set(summary[iso]))} constituencies")
    print(f"\nTotal synthesised unopposed entries: {synth_count}")
    # By-election summary
    by_payload = [{"date": iso, "constituencies": sorted(set(names))}
                  for iso, names in sorted(by_summary.items())]
    OUT_BASE.mkdir(parents=True, exist_ok=True)
    (OUT_BASE / "_byelections_index.json").write_text(
        json.dumps(by_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"By-elections: {sum(len(v) for v in by_summary.values())} contests "
          f"across {len(by_summary)} dates")
    print(f"Summary written: {OUT_BASE / '_index.json'}")

if __name__ == "__main__":
    main()
