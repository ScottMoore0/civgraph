#!/usr/bin/env python3
"""Harvest everything usable from the Wikipedia articles on UK elections in Ireland.

    python scripts/walker/harvest_wikipedia_full.py

This supersedes the first pass, which took only the party-level summary and missed three
things:

1. THIRTEEN OF THE FIFTY-EIGHT PAGES ARE REDIRECTS, not articles. Every one is a pre-1885
   Ireland election -- 1802 to 1852 -- pointing at the UK-WIDE article and tagged
   "R with possibilities", meaning no Ireland-specific article was ever written. The first
   pass followed them, got 163 characters each, and recorded "no party rows found" as
   though it were a parsing failure. Redirects are now resolved and reported as what they
   are, so the absence is visible instead of looking like a defect in the harvest.

2. Constituency-level tables were actively discarded. The parser was taught to prefer a
   summary table over a longer per-seat one, which is right for party totals and threw
   away the rows that can actually be checked against Civgraph contest by contest.

3. Dates were captured for only 16 of 58, and the "MPs elected" and "Candidates" sections
   were not read at all.

Wikipedia is a tertiary source: this is for detecting disagreement, not for establishing
truth. Article prose is CC BY-SA and is not reproduced; what is kept is figures, names,
dates and the citations each article gives.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wiki_tables import grid, parse_article, _num, _columns  # noqa: E402
from bs4 import BeautifulSoup                                 # noqa: E402

API = 'https://en.wikipedia.org/w/api.php'
UA = {'User-Agent': 'civgraph-election-research/1.0 (https://civgraph.net)'}
CATEGORIES = [
    'Category:General elections in Ireland to the Parliament of the United Kingdom',
    'Category:General elections in Northern Ireland to the Parliament of the United Kingdom',
]
OUT = os.path.join('data', 'elections', 'wikipedia-uk-elections-ireland.json')
PAUSE = 1.2          # the API returned 429 at a faster rate


def api(**params):
    params.setdefault('format', 'json')
    params.setdefault('formatversion', 2)
    url = f'{API}?{urllib.parse.urlencode(params)}'
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as fh:
                return json.load(fh)
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    raise RuntimeError('unreachable')


def members(category):
    out, cont = [], None
    while True:
        kw = {'action': 'query', 'list': 'categorymembers', 'cmtitle': category,
              'cmlimit': 500, 'cmtype': 'page'}
        if cont:
            kw['cmcontinue'] = cont
        d = api(**kw)
        out += [m['title'] for m in d.get('query', {}).get('categorymembers', [])]
        cont = d.get('continue', {}).get('cmcontinue')
        if not cont:
            return out


def resolve_redirects(titles):
    """{title: target} for those that are redirects rather than articles."""
    out = {}
    for i in range(0, len(titles), 40):
        d = api(action='query', titles='|'.join(titles[i:i + 40]), redirects=1)
        for r in d.get('query', {}).get('redirects', []):
            out[r['from']] = r['to']
        time.sleep(PAUSE)
    return out


# Must say constituency or division. Matching "seat" too caught "# of Seats" in the
# party summary header, and the 1885 summary was returned as per-seat rows whose
# "constituency" was "Irish Parliamentary".
CONSTITUENCY_HINT = re.compile(r'constituenc|division', re.I)
PARTYISH = re.compile(r'unionist|nationalist|conservative|liberal|labour|sinn|social '
                      r'democratic|alliance|dup|uup|sdlp|green|total|party', re.I)


def constituency_rows(html):
    """Per-seat rows, which the summary-preferring parser deliberately drops."""
    soup = BeautifulSoup(html, 'lxml')
    out = []
    for table in soup.find_all('table'):
        g = grid(table)
        if len(g) < 4:
            continue
        idx, names, head_n = _columns(g)
        header = ' '.join(names)
        # A per-seat table names a constituency column, or repeats party names down it.
        cons_i = next((i for i, n in enumerate(names)
                       if CONSTITUENCY_HINT.search(n)), None)
        if cons_i is None:
            continue
        for row in g[head_n:]:
            if cons_i >= len(row):
                continue
            name = row[cons_i][0]
            if not name or _num(name) is not None:
                continue
            if PARTYISH.fullmatch(name.strip()) or PARTYISH.match(name.strip()):
                continue                      # a party name in a summary table
            rec = {'constituency': name}
            for key in ('party', 'votes', 'share', 'seats'):
                i = idx.get(key)
                if i is not None and i < len(row):
                    v = row[i][0]
                    rec[key] = _num(v) if key != 'party' else v
            if len(rec) > 1:
                out.append(rec)
        if out:
            return out, header
    return out, None


def mps_elected(html):
    """The "MPs elected" list, where an article has one: constituency and member."""
    soup = BeautifulSoup(html, 'lxml')
    for h in soup.find_all(['h2', 'h3']):
        if not re.search(r'mps? elected|members elected', h.get_text(' ', strip=True), re.I):
            continue
        for sib in h.find_all_next(['table', 'h2']):
            if sib.name == 'h2':
                break
            g = grid(sib)
            if len(g) < 3:
                continue
            _idx, names, head_n = _columns(g)
            out = []
            rows = [[c[0] for c in row if c[0]] for row in g[head_n:]]
            rows = [r for r in rows if len(r) >= 2]
            if not rows:
                continue
            # Which of the two columns is the member and which the party? The header
            # often does not say, and taking them in order gave
            # member "Ulster Unionist", party "Charles Craig". A party repeats down the
            # column; a member's name is unique, so the column with more distinct values
            # is the member.
            def distinct(i):
                return len({r[i] for r in rows if i < len(r)})
            m_i, p_i = 1, 2 if any(len(r) > 2 for r in rows) else None
            if p_i is not None and distinct(p_i) > distinct(m_i):
                m_i, p_i = p_i, m_i
            for r in rows:
                out.append({'constituency': r[0],
                            'member': r[m_i] if m_i < len(r) else None,
                            'party': r[p_i] if (p_i is not None and p_i < len(r)) else None})
            if out:
                return out
    return []


def infobox_field(wikitext, field):
    m = re.search(rf'\|\s*{field}\s*=\s*(.+)', wikitext)
    if not m:
        return None
    s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]', r'\1', m.group(1))
    s = re.sub(r'\{\{[^{}]*\}\}', '', s)
    return re.sub(r"'''?|<[^>]+>", '', s).strip(" |'\n\t") or None


def parse_dates(wikitext):
    m = re.search(r'\{\{start and end dates\|(\d{4})\|(\d+)\|(\d+)\|(\d{4})\|(\d+)\|(\d+)', wikitext)
    if m:
        return {'from': f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}',
                'to': f'{m[4]}-{int(m[5]):02d}-{int(m[6]):02d}'}
    m = re.search(r'\{\{start date\|(\d{4})\|(\d+)\|(\d+)', wikitext)
    if m:
        d = f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}'
        return {'from': d, 'to': d}
    # many older articles give the span as plain prose in election_date
    raw = infobox_field(wikitext, 'election_date')
    if raw:
        m = re.search(r'(\d{1,2})\s+(\w+)\s*(?:–|-|to)\s*(\d{1,2})\s+(\w+)\s+(\d{4})', raw)
        if m:
            return {'text': raw}
        if re.search(r'\d{4}', raw):
            return {'text': raw}
    return None


def citations(wikitext):
    out = []
    for ref in re.findall(r'<ref[^>]*>(.*?)</ref>', wikitext, re.S):
        title = re.search(r'\|\s*title\s*=\s*([^|}]+)', ref)
        url = re.search(r'\|\s*url\s*=\s*([^\s|}]+)', ref)
        bare = re.search(r'https?://\S+', ref)
        rec = {}
        if title:
            rec['title'] = re.sub(r"\[\[|\]\]|'''?", '', title.group(1)).strip()
        if url:
            rec['url'] = url.group(1).strip()
        elif bare:
            rec['url'] = bare.group(0).rstrip('.,;')
        if rec and rec not in out:
            out.append(rec)
    return out


def quality_flags(parties, total, seats_for_election):
    flags = []
    seats = [p['seats'] for p in parties if p.get('seats') is not None]
    votes = [p['votes'] for p in parties if p.get('votes') is not None]
    shares = [p['share'] for p in parties if p.get('share') is not None]
    if not parties:
        flags.append('no party rows found')
    if not seats:
        flags.append('no seat figures')
    if not votes:
        flags.append('no vote figures')
    m = re.search(r'(\d+)\s+of', seats_for_election or '')
    expected = int(m.group(1)) if m else None
    if seats and expected and sum(seats) != expected:
        flags.append(f'seats sum to {sum(seats)}, infobox says {expected}')
    if votes and total and total.get('votes') and \
            abs(sum(votes) - total['votes']) > max(50, 0.01 * total['votes']):
        flags.append(f"votes sum to {sum(votes)}, table total says {total['votes']}")
    if shares and abs(sum(shares) - 100) > 5:
        flags.append(f'shares sum to {round(sum(shares), 1)}%')
    return flags or ['self-consistent']


def main():
    listed = []
    for cat in CATEGORIES:
        got = members(cat)
        print(f'{cat.split(":")[1][:48]}: {len(got)}')
        listed += [(cat, t) for t in got]
        time.sleep(PAUSE)

    redirects = resolve_redirects([t for _c, t in listed])
    print(f'redirects (no Ireland-specific article exists): {len(redirects)}')

    records = []
    for cat, title in listed:
        target = redirects.get(title)
        rec = {
            'title': title,
            'category': 'Northern Ireland' if 'Northern Ireland' in cat else 'Ireland',
            'year': int(re.search(r'(1[789]\d{2}|20\d{2})', title).group(1))
                    if re.search(r'(1[789]\d{2}|20\d{2})', title) else None,
            'url': 'https://en.wikipedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_')),
        }
        if target:
            rec.update({'isRedirect': True, 'redirectsTo': target,
                        'note': 'No Ireland-specific article exists; the category entry '
                                'points at the United Kingdom-wide article.',
                        'parties': [], 'constituencies': [], 'mpsElected': [],
                        'citations': [], 'quality': ['redirect, not an article']})
            records.append(rec)
            print(f'  {title[:54]}: REDIRECT -> {target[:38]}')
            continue
        try:
            wt = api(action='parse', page=title, prop='wikitext')['parse']['wikitext']
            time.sleep(PAUSE)
            html = api(action='parse', page=title, prop='text')['parse']['text']
        except Exception as exc:
            print(f'  ! {title}: {type(exc).__name__}')
            continue
        parties, total, cols = parse_article(html)
        cons, cons_header = constituency_rows(html)
        mps = mps_elected(html)
        rec.update({
            'isRedirect': False,
            'dates': parse_dates(wt),
            'seatsForElection': infobox_field(wt, 'seats_for_election'),
            'resultColumns': cols,
            'parties': parties,
            'total': total,
            'constituencies': cons,
            'constituencyColumns': cons_header,
            'mpsElected': mps,
            'citations': citations(wt),
            'wikitextChars': len(wt),
            'quality': quality_flags(parties, total, infobox_field(wt, 'seats_for_election')),
        })
        records.append(rec)
        print(f'  {title[:50]}: {len(parties)} party, {len(cons)} constituency, '
              f'{len(mps)} MPs, {len(rec["citations"])} cites')
        time.sleep(PAUSE)

    real = [r for r in records if not r.get('isRedirect')]
    doc = {
        'schemaVersion': 2,
        'description': (
            'Everything usable from the Wikipedia articles on United Kingdom general '
            'elections in Ireland and Northern Ireland: party-level results, '
            'constituency-level results where given, MPs elected, dates and the sources '
            'each article cites. Thirteen category entries are REDIRECTS to the '
            'UK-wide article rather than Ireland-specific articles -- all of them '
            'pre-1885 -- and are recorded as such, because that absence is itself the '
            'finding: the earliest elections have no Wikipedia counterpart to check '
            'Walker against. Wikipedia is tertiary; this detects disagreement rather '
            'than establishing truth.'),
        'provenance': {
            'method': 'scripts/walker/harvest_wikipedia_full.py',
            'categories': CATEGORIES,
            'licence': 'Figures, names, dates and the citations each article gives. '
                       'Wikipedia prose is CC BY-SA and is not reproduced.',
            'harvestedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        },
        'counts': {
            'listed': len(records),
            'articles': len(real),
            'redirects': sum(1 for r in records if r.get('isRedirect')),
            'withPartyResults': sum(1 for r in real if r['parties']),
            'withConstituencyResults': sum(1 for r in real if r['constituencies']),
            'withMpsElected': sum(1 for r in real if r['mpsElected']),
            'withDates': sum(1 for r in real if r.get('dates')),
            'partyRows': sum(len(r['parties']) for r in real),
            'constituencyRows': sum(len(r['constituencies']) for r in real),
            'mpRows': sum(len(r['mpsElected']) for r in real),
            'citations': sum(len(r['citations']) for r in real),
        },
        'records': sorted(records, key=lambda r: (r['year'] or 0, r['title'])),
    }
    out = OUT if os.path.isabs(OUT) else os.path.join(os.getcwd(), OUT)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'\nwrote {out}')
    for k, v in doc['counts'].items():
        print(f'  {k}: {v}')


if __name__ == '__main__':
    main()
