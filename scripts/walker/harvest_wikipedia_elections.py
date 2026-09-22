#!/usr/bin/env python3
"""Harvest the Wikipedia articles for UK general elections in Ireland and Northern Ireland.

    python scripts/walker/harvest_wikipedia_elections.py

Two categories, 58 articles, 1802 to 2024:

    Category:General elections in Ireland to the Parliament of the United Kingdom
    Category:General elections in Northern Ireland to the Parliament of the United Kingdom

WHY THIS SITS BESIDE THE WALKER WORK

The 1802-1880 figures harvested from Walker have no second source: Civgraph holds nothing
before 1885, so an OCR misread there has nothing to contradict it. These articles give
party-level totals -- seats, votes and share -- for the same elections. They cannot check
an individual constituency, but summing Walker's constituency votes by party and comparing
against the national total is a real independent check on the transcription, and the only
one available for that century.

Wikipedia is a tertiary source and its own figures are not authoritative; what this
provides is disagreement-detection, not truth. Text is not reproduced: the harvest keeps
figures, dates, party names and the citations each article gives.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wiki_tables import parse_article  # noqa: E402

API = 'https://en.wikipedia.org/w/api.php'
UA = {'User-Agent': 'civgraph-election-research/1.0 (https://civgraph.net)'}
CATEGORIES = [
    'Category:General elections in Ireland to the Parliament of the United Kingdom',
    'Category:General elections in Northern Ireland to the Parliament of the United Kingdom',
]
OUT = os.path.join('data', 'elections', 'wikipedia-uk-elections-ireland.json')


def api(**params):
    params.setdefault('format', 'json')
    params.setdefault('formatversion', 2)
    url = f'{API}?{urllib.parse.urlencode(params)}'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as fh:
        return json.load(fh)


def members(category):
    out = []
    cont = None
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


def clean_cell(s):
    """A wikitable cell down to its plain value."""
    s = re.sub(r'\{\{(?:increase|decrease|steady|nochange)\}\}', '', s, flags=re.I)
    s = re.sub(r'\{\{party name with color\|([^}|]+)[^}]*\}\}', r'\1', s, flags=re.I)
    s = re.sub(r'\{\{[^{}]*\}\}', '', s)
    s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]', r'\1', s)
    s = re.sub(r"'''?", '', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'\b(align|style|colspan|rowspan|scope|class|width|bgcolor)\s*=\s*[^|]+', '', s)
    return s.strip(" |'\n\t")


def num(s):
    s = (s or '').replace(',', '').replace('%', '').strip()
    m = re.match(r'^-?\d+(?:\.\d+)?$', s)
    return float(s) if m and '.' in s else (int(s) if m else None)


def _cells(chunk):
    """Split a wikitable row into cells. Cells are separated by a newline pipe OR by a
    double pipe on one line, and both appear across these articles."""
    parts = []
    for piece in re.split(r'\n\|(?!\})|\n!', '\n' + chunk):
        for sub in re.split(r'\|\||!!', piece):
            c = clean_cell(sub)
            if c:
                parts.append(c)
    return parts


def _map_columns(cols):
    idx = {}
    for i, c in enumerate(cols):
        lc = c.lower()
        if lc.startswith('party') or lc.startswith('affiliation'):
            idx.setdefault('party', i)
        elif 'change' in lc or lc.startswith('+/'):
            continue
        elif 'seat' in lc and '%' not in lc:
            idx.setdefault('seats', i)
        elif 'vote' in lc and '%' not in lc:
            idx.setdefault('votes', i)
        elif '%' in lc and 'vote' in lc:
            idx.setdefault('share', i)
    return idx


def parse_results(wikitext):
    """Party rows from whichever wikitable in the article is the results table.

    The articles do not agree on markup. Some head the table with one row of simple
    columns; 1885 uses two header rows with rowspan and colspan, so the real column
    names are on the SECOND row; 1950 opens with a candidate-count table and puts the
    results in a later one. So every table is parsed and the best scoring one wins,
    rather than trusting the first.
    """
    best = ([], None, [])
    best_score = 0
    for block in re.findall(r'\{\|(.*?)\n\|\}', wikitext, re.S):
        chunks = block.split('|-')
        # Header rows are the leading chunks whose content is mostly "!" cells.
        header_rows = [c for c in chunks[:3] if c.count('!') >= 2]
        if not header_rows:
            header_rows = chunks[:1]
        cols, idx = [], {}
        for hr in header_rows:                     # later header row wins: it is the
            cand = _cells(hr)                      # detailed one under a spanned title
            cand_idx = _map_columns(cand)
            if len(cand_idx) >= len(idx):
                cols, idx = cand, cand_idx
        if 'seats' not in idx and 'votes' not in idx:
            continue
        rows, total = [], None
        for chunk in chunks[len(header_rows):]:
            cells = _cells(chunk)
            if len(cells) < 2 or not cells[0]:
                continue
            rec = {'party': cells[idx.get('party', 0)] if idx.get('party', 0) < len(cells)
                   else cells[0]}
            for key in ('seats', 'votes', 'share'):
                i = idx.get(key)
                rec[key] = num(cells[i]) if (i is not None and i < len(cells)) else None
            if re.fullmatch(r'total[s]?', rec['party'], re.I):
                total = rec
            elif rec['seats'] is not None or rec['votes'] is not None:
                rows.append(rec)
        score = len(rows) + (2 if any(r['votes'] for r in rows) else 0)             + (2 if any(r['seats'] for r in rows) else 0) + (1 if total else 0)
        if score > best_score:
            best, best_score = (rows, total, cols), score
    return best


def infobox_field(wikitext, field):
    m = re.search(rf'\|\s*{field}\s*=\s*(.+)', wikitext)
    return clean_cell(m.group(1)) if m else None


def parse_dates(wikitext):
    m = re.search(r'\{\{start and end dates\|(\d{4})\|(\d+)\|(\d+)\|(\d{4})\|(\d+)\|(\d+)',
                  wikitext)
    if m:
        a = f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
        b = f'{m.group(4)}-{int(m.group(5)):02d}-{int(m.group(6)):02d}'
        return {'from': a, 'to': b}
    m = re.search(r'\|\s*election_date\s*=\s*\{\{start date\|(\d{4})\|(\d+)\|(\d+)', wikitext)
    if m:
        d = f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
        return {'from': d, 'to': d}
    return None


def citations(wikitext):
    """Sources the article cites, as titles and URLs only."""
    out = []
    for ref in re.findall(r'<ref[^>]*>(.*?)</ref>', wikitext, re.S):
        title = re.search(r'\|\s*title\s*=\s*([^|}]+)', ref)
        url = re.search(r'\|\s*url\s*=\s*([^\s|}]+)', ref)
        bare = re.search(r'https?://\S+', ref)
        rec = {}
        if title:
            rec['title'] = clean_cell(title.group(1))
        if url:
            rec['url'] = url.group(1).strip()
        elif bare:
            rec['url'] = bare.group(0).rstrip('.,;')
        if rec and rec not in out:
            out.append(rec)
    return out


def quality_flags(parties, total, seats_for_election):
    """What in this article's figures looks self-consistent, and what does not.

    Seats in particular cannot be trusted uniformly: some tables put a seat-change
    column where the seat count is expected, so the 2019 article reports the DUP on
    zero. Rather than fix each article, the arithmetic is checked and reported.
    """
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
    expected = None
    m = re.search(r'(\d+)\s+of', seats_for_election or '')
    if m:
        expected = int(m.group(1))
    if seats and expected and sum(seats) != expected:
        flags.append(f'seats sum to {sum(seats)}, infobox says {expected}')
    if seats and total and total.get('seats') and sum(seats) != total['seats']:
        flags.append(f"seats sum to {sum(seats)}, table total says {total['seats']}")
    if votes and total and total.get('votes'):
        if abs(sum(votes) - total['votes']) > max(50, 0.01 * total['votes']):
            flags.append(f"votes sum to {sum(votes)}, table total says {total['votes']}")
    if shares and abs(sum(shares) - 100) > 5:
        flags.append(f'shares sum to {round(sum(shares), 1)}%')
    return flags or ['self-consistent']


def main():
    titles = []
    for cat in CATEGORIES:
        got = members(cat)
        print(f'{cat}: {len(got)} articles')
        titles += [(cat, t) for t in got]

    records = []
    for cat, title in titles:
        try:
            wt = api(action='parse', page=title, prop='wikitext')['parse']['wikitext']
            html = api(action='parse', page=title, prop='text')['parse']['text']
        except Exception as exc:
            print(f'  ! {title}: {type(exc).__name__}')
            continue
        # Tables are read from the rendered HTML, where a cell is a cell; the wikitext
        # is still fetched for the infobox, dates and citations.
        parties, total, cols = parse_article(html)
        year = re.search(r'(1[789]\d{2}|20\d{2})', title)
        records.append({
            'title': title,
            'category': 'Northern Ireland' if 'Northern Ireland' in cat else 'Ireland',
            'year': int(year.group(1)) if year else None,
            'url': 'https://en.wikipedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_')),
            'dates': parse_dates(wt),
            'seatsForElection': infobox_field(wt, 'seats_for_election'),
            'resultColumns': cols,
            'parties': parties,
            'total': total,
            'citations': citations(wt),
            'wikitextChars': len(wt),
            'quality': quality_flags(parties, total, infobox_field(wt, 'seats_for_election')),
        })
        print(f'  {title}: {len(parties)} party rows, '
              f"{'total' if total else 'no total'}, {len(records[-1]['citations'])} citations")
        time.sleep(0.2)

    doc = {
        'schemaVersion': 1,
        'description': (
            'Party-level results for United Kingdom general elections in Ireland and '
            'Northern Ireland, harvested from the two Wikipedia categories covering them. '
            'Held as an independent cross-check on figures transcribed from print, most '
            'importantly for 1802-1880 where Civgraph has no data of its own and the '
            'Walker transcription otherwise has nothing to contradict it. Wikipedia is a '
            'tertiary source: this detects disagreement, it does not establish truth.'),
        'provenance': {
            'method': 'scripts/walker/harvest_wikipedia_elections.py',
            'categories': CATEGORIES,
            'licence': 'Figures, dates, party names and the citations each article gives. '
                       'Wikipedia text is CC BY-SA and is not reproduced here.',
            'harvestedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        },
        'counts': {
            'articles': len(records),
            'withPartyResults': sum(1 for r in records if r['parties']),
            'withTotal': sum(1 for r in records if r['total']),
            'partyRows': sum(len(r['parties']) for r in records),
            'citations': sum(len(r['citations']) for r in records),
        },
        'records': sorted(records, key=lambda r: (r['year'] or 0, r['title'])),
    }
    out = OUT if os.path.isabs(OUT) else os.path.join(os.getcwd(), OUT)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f"\nwrote {out}")
    for k, v in doc['counts'].items():
        print(f'  {k}: {v}')


if __name__ == '__main__':
    main()
