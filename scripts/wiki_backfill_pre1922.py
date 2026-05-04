#!/usr/bin/env python
"""Wikipedia candidate-name backfill for the 9 pre-1922 Westminster GEs
emitted by build_pre1922_westminster.py.

For each constituency:
- Resolve a Wikipedia article via en.wikipedia.org/w/api.php (action=parse)
- Find every wikitable with an election caption matching one of the 9 GEs
- Extract candidate rows: party, candidate name, votes, %
- Update the existing JSON files in election-viewer-package/data/elections/...
"""
import argparse, csv, json, re, sys, time, urllib.parse, urllib.request, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from bs4 import BeautifulSoup
from pathlib import Path
from collections import defaultdict
import unicodedata

REPO = Path(__file__).resolve().parent.parent
EVP = REPO / "election-viewer-package"
ELECTIONS_DIR = EVP / "data" / "elections" / "house-of-commons-of-the-united-kingdom"
RESULTS_CSV = REPO / "data" / "external" / "parlconst" / "pre1922_westminster_results.csv"
CACHE_DIR = REPO / "_tmp_parlconst" / "wiki_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 civgraph/parlconst-wiki-backfill (one-shot, polite, contact: civgraph)"

GE_DATES = {
    '1885':     '1885-11-24',
    '1886':     '1886-07-01',
    '1892':     '1892-07-04',
    '1895':     '1895-07-13',
    '1900':     '1900-09-26',
    '1906':     '1906-01-12',
    '1910 (J)': '1910-01-15',
    '1910 (D)': '1910-12-03',
    '1918':     '1918-12-14',
}

def caption_to_ge(caption):
    """Map a wikitable caption to a GE-year-key from our 9 dates, or None."""
    if not caption: return None
    cap = caption.strip()
    cap_l = cap.lower()
    # Skip by-elections — only process general elections.
    if 'by-election' in cap_l or 'by election' in cap_l:
        return None
    if 'general election' not in cap_l:
        return None
    # Find the year somewhere in the caption (1885 / 1886 / 1892 / 1895 / 1900 / 1906 / 1910 / 1918)
    years_in_cap = re.findall(r'\b(1885|1886|1892|1895|1900|1906|1910|1918)\b', cap)
    if not years_in_cap: return None
    # If multiple years, prefer the GE year (assume one of our 9)
    year = years_in_cap[0]
    if year == '1910':
        if re.search(r'january|jan\.?|15 jan', cap, re.I): return '1910 (J)'
        if re.search(r'december|dec\.?|3 dec', cap, re.I): return '1910 (D)'
        return None  # ambiguous 1910
    if year in GE_DATES: return year
    return None


def slugify(name):
    name = unicodedata.normalize('NFKD', name).encode('ascii','ignore').decode('ascii')
    s = re.sub(r"[^a-zA-Z0-9]+", '-', name).strip('-').lower()
    return re.sub(r'-+', '-', s)


SPECIAL_TITLES = {
    'Pembroke': ['Dublin Pembroke', 'Dublin Pembroke (UK Parliament constituency)'],
    'Rathmines': ['Dublin Rathmines', 'Dublin Rathmines (UK Parliament constituency)'],
    'Dublin County N': ['North Dublin (UK Parliament constituency)'],
    'Dublin County S': ['South Dublin (UK Parliament constituency)'],
    'Connemara': ['Galway Connemara', 'Galway Connemara (UK Parliament constituency)'],
    'Leix': ["Queen's County Leix", "Queen's County Leix (UK Parliament constituency)"],
    'Ossory': ["Queen's County Ossory", "Queen's County Ossory (UK Parliament constituency)"],
    'Birr': ["King's County Birr", 'Birr (UK Parliament constituency)'],
    'Tullamore': ["King's County Tullamore", 'Tullamore (UK Parliament constituency)'],
    'Galway City': ['Galway Borough', 'Galway City (UK Parliament constituency)'],
}


def candidate_titles(constituency):
    """Generate Wikipedia title candidates for a constituency name from
    the parlconst CSV style (e.g. 'Cork E' → 'East Cork ...')."""
    SUFFIX_TO_PREFIX = {
        'NE': 'North East', 'NW': 'North West',
        'SE': 'South East', 'SW': 'South West',
        'N':  'North', 'S': 'South', 'E': 'East', 'W': 'West',
        'Mid': 'Mid',
    }
    base = constituency.strip()
    candidates = list(SPECIAL_TITLES.get(base, []))
    # Direction-suffix style: "Cork E" → "East Cork"
    m = re.match(r'^(.+?)\s+(NE|NW|SE|SW|N|S|E|W|Mid)$', base)
    if m:
        county, suffix = m.group(1), m.group(2)
        prefix = SUFFIX_TO_PREFIX[suffix]
        candidates.append(f"{prefix} {county} (UK Parliament constituency)")
        candidates.append(f"{county} {suffix} (UK Parliament constituency)")
        candidates.append(f"{county} ({suffix})")
    # Plain name (county constituency variants for 1885+)
    candidates.append(f"{base} (UK Parliament constituency, 1885)")
    candidates.append(f"{base} County (UK Parliament constituency)")
    candidates.append(f"County {base} (UK Parliament constituency)")
    candidates.append(f"{base} (UK Parliament constituency)")
    candidates.append(base)
    # City variants
    if 'City' in base:
        candidates.append(base.replace(' City',''))
    # Dublin-prefixed: try without prefix and as plain area
    if base.startswith('Dublin '):
        rest = base[len('Dublin '):]
        candidates.insert(0, f"Dublin {rest} (UK Parliament constituency)")
        candidates.append(f"{rest} (UK Parliament constituency)")
        candidates.append(f"{rest} (Dublin)")
    # Apostrophe normalization (curly vs straight)
    if "'" in base or '’' in base:
        for c in list(candidates):
            candidates.append(c.replace("'", '’'))
            candidates.append(c.replace('’', "'"))
    return list(dict.fromkeys(candidates))  # dedup, preserve order


def wp_parse(title, sleep_s=0.4):
    """Return (resolved_title, html) or (None, None) on miss."""
    cache_key = title.replace('/', '_').replace('?', '').replace(':','-')[:200]
    cache_file = CACHE_DIR / f"{cache_key}.json"
    if cache_file.exists():
        d = json.loads(cache_file.read_text(encoding='utf-8'))
        return d.get('title'), d.get('html')
    qs = urllib.parse.urlencode({'action':'parse','page':title,'format':'json','prop':'text','redirects':1})
    url = f"https://en.wikipedia.org/w/api.php?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode('utf-8','replace'))
    except Exception:
        cache_file.write_text(json.dumps({'title': None, 'html': None}), encoding='utf-8')
        time.sleep(sleep_s)
        return None, None
    parse = data.get('parse') or {}
    title = parse.get('title')
    html = (parse.get('text') or {}).get('*')
    cache_file.write_text(json.dumps({'title': title, 'html': html}), encoding='utf-8')
    time.sleep(sleep_s)
    return title, html


def resolve_constituency(constituency):
    """Try each candidate Wikipedia title; return the one whose article
    has at least one election table caption mapping to one of our 9 GEs."""
    best = (None, None, 0)
    for title in candidate_titles(constituency):
        rtitle, html = wp_parse(title)
        if not html or len(html) < 1000: continue
        # Count tables that match our 9 GEs
        tables = parse_election_tables(html)
        n_match = sum(1 for ge in GE_DATES if ge in tables and tables[ge])
        if n_match > best[2]:
            best = (rtitle, html, n_match)
        if n_match >= 6:  # most of the 9 covered → good enough
            return rtitle, html
    return best[0], best[1]


def parse_election_tables(html):
    """Return dict: {ge_key: [{'party','candidate','votes','percent','status'}, ...]}"""
    soup = BeautifulSoup(html, 'html.parser')
    out = defaultdict(list)
    for t in soup.find_all('table', class_='wikitable'):
        cap = t.find('caption')
        cap_txt = cap.get_text(' ', strip=True) if cap else ''
        ge = caption_to_ge(cap_txt)
        if not ge: continue
        rows = t.find_all('tr')
        # Find data rows (skip header; stop at Majority/Turnout)
        for r in rows[1:]:
            cells = [c.get_text(' ', strip=True) for c in r.find_all(['td','th'])]
            if not cells: continue
            first = cells[0].lower()
            # skip non-candidate rows
            if any(s in first for s in ('majority','turnout','registered electors','swing')): continue
            # The first cell is often the colour swatch (empty) — second cell party, third candidate
            # OR sometimes party is first
            party = candidate = votes = pct = ''
            # Pattern A: ['', party, candidate, votes, %, ...]
            if len(cells) >= 5 and (cells[0] == '' or cells[0].endswith('hold') or cells[0].endswith('gain')):
                # bottom of table (gain/hold) row
                if cells[0].endswith('hold') or cells[0].endswith('gain'): continue
                party, candidate, votes, pct = cells[1], cells[2], cells[3], cells[4]
            # Pattern B: [party, candidate, votes, %]
            elif len(cells) >= 4:
                party, candidate, votes, pct = cells[0], cells[1], cells[2], cells[3]
            # Sanity: party should be a name, not 'Total' etc.
            if not candidate or candidate.lower() in ('candidate','total','n/a'): continue
            # Skip swing/gain/hold/result footer rows
            if candidate.lower() in ('swing',): continue
            party_l = party.lower()
            if any(k in party_l for k in (' gain ', ' hold', 'gain from', 'win (new seat)', 'majority', 'turnout', 'swing')):
                continue
            # Votes should be numeric or "Unopposed" — reject cells with weird values
            if votes and votes.lower() in ('n/a',):
                # but still keep the row if candidate looks real
                pass
            out[ge].append({
                'party': party,
                'candidate': candidate,
                'votes': votes,
                'percent': pct,
            })
    return dict(out)


def update_json_file(constituency, ge_key, candidates):
    """Update the existing per-constituency JSON file for this date."""
    if not candidates: return False
    date = GE_DATES[ge_key]
    slug = slugify(constituency)
    fpath = ELECTIONS_DIR / date / f'{slug}.json'
    if not fpath.exists():
        return False
    j = json.loads(fpath.read_text(encoding='utf-8'))
    # Build new countGroup from candidates
    new_group = []
    for i, c in enumerate(candidates):
        cn = c['candidate']
        # Split into Firstname / Surname (best-effort)
        parts = cn.rsplit(' ', 1)
        first = parts[0] if len(parts) > 1 else ''
        last = parts[-1]
        # Determine status — only top-vote candidate (or unopposed) wins
        status = 'Elected' if i == 0 else 'Not elected'
        new_group.append({
            'Candidate_First_Pref_Votes': c['votes'] or 'Unknown',
            'Candidate_Id': '',
            'Constituency_Number': '',
            'Count_Number': '1',
            'Firstname': first,
            'Occurred_On_Count': '',
            'Party_Colour': '#888888',  # keep neutral; original's party_colour is in the existing file
            'Party_Name': c['party'],
            'Status': status,
            'Surname': last,
            'Total_Votes': c['votes'] or '',
            'Transfers': '0.00',
            'candidateName': cn,
            'id': i,
        })
    # Preserve party-colour from existing winner if its party matches new winner's
    existing = (j.get('Constituency') or {}).get('countGroup') or []
    if existing and new_group and 'Party_Name' in existing[0]:
        old_party = existing[0].get('Party_Name','').lower()
        # Apply old colour to whichever new candidate has matching party
        old_colour = existing[0].get('Party_Colour','#888888')
        for c in new_group:
            if c['Party_Name'].lower().startswith(old_party.split()[0]) if old_party else False:
                c['Party_Colour'] = old_colour
    j['Constituency']['countGroup'] = new_group
    fpath.write_text(json.dumps(j, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()

    # Load constituencies
    constits = sorted({row['constituency'] for row in csv.DictReader(open(RESULTS_CSV, encoding='utf-8'))})
    if args.limit: constits = constits[:args.limit]
    print(f"backfilling {len(constits)} constituencies via Wikipedia")

    matched_titles = {}
    unresolved = []
    backfilled = defaultdict(int)
    no_data = defaultdict(int)
    started = time.time()

    for i, c in enumerate(constits, 1):
        rtitle, html = resolve_constituency(c)
        if not html:
            unresolved.append(c)
            print(f"  [{i:>3}/{len(constits)}] UNRESOLVED  {c!r}")
            continue
        matched_titles[c] = rtitle
        tables = parse_election_tables(html)
        msg = []
        for ge_key in GE_DATES:
            if ge_key in tables and tables[ge_key]:
                ok = update_json_file(c, ge_key, tables[ge_key])
                if ok:
                    backfilled[ge_key] += 1
                    msg.append(f"{ge_key}={len(tables[ge_key])}")
                else:
                    no_data[ge_key] += 1
        print(f"  [{i:>3}/{len(constits)}] {rtitle[:50]:<50}  candidates: {' '.join(msg)}")

    print(f"\nDone in {(time.time()-started)/60:.1f} min")
    print(f"\nBackfill counts per GE:")
    for ge in GE_DATES:
        print(f"  {ge}: {backfilled[ge]} constituencies updated")
    if unresolved:
        print(f"\nUNRESOLVED ({len(unresolved)}):")
        for c in unresolved: print(f"  {c}")
    Path('_tmp_parlconst/wiki_matched_titles.json').write_text(
        json.dumps(matched_titles, indent=1, ensure_ascii=False), encoding='utf-8')


if __name__ == "__main__":
    main()
