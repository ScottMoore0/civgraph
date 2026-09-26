#!/usr/bin/env python3
"""Harvest the election boxes of Wikipedia's Irish UK Parliament constituency articles, 1832-1922.

    python scripts/walker/harvest_wikipedia_constituency_boxes.py <article list JSON> [--cache DIR]

The primary source for the 1832-1880 general elections and the 1832-1922 by-elections: each
constituency article carries an election box per contest -- candidates, parties, votes or
"Unopposed", registered electors, turnout -- as rendered HTML, which reads cleanly where the
Walker scans need OCR. Walker's transcriptions and Wikipedia's lists of MPs are the checks
(scripts/walker/crosscheck_constituency_boxes.py).

Only names, parties and figures are kept (facts); each record cites its article.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import unquote

import requests
from bs4 import BeautifulSoup

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
UA = {'User-Agent': 'civgraph-election-research/1.0 (https://civgraph.net)'}
MONTHS = {m: i + 1 for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july',
                                          'august', 'september', 'october', 'november', 'december'])}
NUM = re.compile(r'^[\d,]+$')


def fetch(title, cache):
    path = os.path.join(cache, hashlib.sha1(title.encode()).hexdigest() + '.html')
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()
    url = 'https://en.wikipedia.org/api/rest_v1/page/html/' + requests.utils.quote(title.replace(' ', '_'), safe='')
    for attempt in range(3):
        r = requests.get(url, headers=UA, timeout=60)
        if r.status_code == 200:
            os.makedirs(cache, exist_ok=True)
            open(path, 'w', encoding='utf-8').write(r.text)
            time.sleep(0.4)
            return r.text
        time.sleep(3 * (attempt + 1))
    return None


def resolve_redirects(titles, cache):
    """Map each linked title to the article it lands on, so a person linked by two spellings
    ("Daniel O'Connell Jnr" and "Daniel O'Connell (junior)") is one key. Cached; 50 a query."""
    path = os.path.join(cache, 'redirects.json')
    known = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
    todo = sorted({t for t in titles if t and t not in known})
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        r = requests.get('https://en.wikipedia.org/w/api.php', headers=UA, timeout=60, params={
            'action': 'query', 'titles': '|'.join(batch), 'redirects': 1, 'format': 'json', 'formatversion': 2})
        r.raise_for_status()
        q = r.json()['query']
        norm = {n['from']: n['to'] for n in q.get('normalized', [])}
        redir = {n['from']: n['to'] for n in q.get('redirects', [])}
        missing = {p['title'] for p in q.get('pages', []) if p.get('missing')}
        for t in batch:
            n = norm.get(t, t)
            n = redir.get(n, n)
            known[t] = None if n in missing else n
        time.sleep(0.5)
    os.makedirs(cache, exist_ok=True)
    json.dump(known, open(path, 'w', encoding='utf-8'), indent=0, ensure_ascii=False, sort_keys=True)
    return known


def text(el):
    s = el.get_text(' ', strip=True)
    s = re.sub(r'\[\s*[^\]]{1,12}\s*\]', '', s)            # footnote markers
    return re.sub(r'\s+', ' ', s).replace('\xa0', ' ').strip()


def parse_caption(cap):
    """(kind, date or None, year, month, seats) from a box caption."""
    c = cap
    kind = 'by-election' if re.search(r'by-?election', c, re.I) else 'general'
    m = re.search(r'(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(1[89]\d{2})', c)
    date = f'{int(m.group(3)):04d}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}' if m else None
    y = re.search(r'(1[89]\d{2})', c)
    year = int(y.group(1)) if y else None
    mo = re.search(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+1[89]\d{2}', c)
    month = MONTHS[mo.group(1).lower()] if mo else None
    s = re.search(r'\((\d)\s+seats?\)', c)
    seats = int(s.group(1)) if s else None
    return kind, date, year, month, seats


def parse_box(table):
    cap = table.find('caption')
    if not cap:
        return None
    caption = text(cap)
    if not re.search(r'election', caption, re.I):
        return None
    kind, date, year, month, seats = parse_caption(caption)
    if not year or not (1832 <= year <= 1922):
        return None
    cands, extra = [], {}
    for tr in table.find_all('tr'):
        els = [td for td in tr.find_all(['td', 'th']) if text(td) != '']
        cells = [text(td) for td in els]
        if not cells:
            continue
        head = cells[0].lower()
        if head in ('party', 'candidate'):
            continue
        if head.startswith('registered electors') and len(cells) > 1 and NUM.match(cells[1]):
            extra['electorate'] = int(cells[1].replace(',', ''))
            continue
        if head.startswith('turnout') and len(cells) > 1:
            n = re.match(r'^([\d,]+)', cells[1])
            if n and '(est' not in ' '.join(cells).lower():
                extra['turnout'] = int(n.group(1).replace(',', ''))
            continue
        if head.startswith(('majority', 'swing')) or re.search(r'\b(hold|gain)\b', ' '.join(cells), re.I):
            continue
        # A candidate row: party, name, then votes (or "Unopposed"), share, change.
        if len(cells) >= 2:
            party, name = cells[0], cells[1]
            rest = cells[2:]
            votes, unopposed = None, False
            if rest and re.match(r'^unopposed', rest[0], re.I):
                unopposed = True
            elif rest and NUM.match(rest[0]):
                votes = int(rest[0].replace(',', ''))
            else:
                continue
            bold = bool(tr.find('b'))
            name = re.sub(r'\s*\(.*?\)\s*$', '', name).strip()
            # The article the name links to is who the candidate is: the Dundalk box shows
            # "Daniel O'Connell" and links "Daniel O'Connell Jnr". A red link still names the
            # intended article; a name with no link at all has no such key.
            a = els[1].find('a', href=re.compile(r'^\./'))
            article = unquote(a['href'][2:].split('?')[0].split('#')[0]).replace('_', ' ') if a else None
            cands.append({'name': name, 'party': party, 'votes': votes, 'unopposed': unopposed, 'bold': bold,
                          'article': article, 'redLink': bool(a and 'redlink=1' in a['href'])})
    if not cands:
        return None
    return {'caption': caption, 'kind': kind, 'date': date, 'year': year, 'month': month,
            'seats': seats, 'candidates': cands, **extra}


def harvest(titles, cache):
    out = []
    for t in titles:
        html = fetch(t, cache)
        if not html:
            continue
        soup = BeautifulSoup(html, 'html.parser')
        url = 'https://en.wikipedia.org/wiki/' + t.replace(' ', '_')
        # Wikipedia titles some county seats plainly ("Armagh", "Antrim") and others "County
        # X"; the article's opening says which kind of seat it was.
        lead = ' '.join(p.get_text(' ', strip=True) for p in soup.find_all('p')[:3]).lower()
        seat_type = ('county' if re.search(r'county constituency|county of \w+|\bthe county\b', lead)
                     and not re.search(r'borough constituency|parliamentary borough', lead)
                     else 'borough' if re.search(r'borough|city|university', lead) else None)
        for table in soup.find_all('table'):
            box = parse_box(table)
            if box:
                box['article'] = t
                box['url'] = url
                box['constituency'] = re.sub(r'\s*\(.*\)$', '', t)
                box['seatType'] = seat_type
                out.append(box)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('articles')
    ap.add_argument('--cache', default=os.path.join(ROOT, '.cache', 'wikipedia-constituencies'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'data', 'elections', 'wikipedia-irish-constituency-boxes-1832-1922.json'))
    args = ap.parse_args()
    titles = json.load(open(args.articles, encoding='utf-8'))
    boxes = harvest(titles, args.cache)
    landing = resolve_redirects([c['article'] for b in boxes for c in b['candidates']], args.cache)
    for b in boxes:
        for c in b['candidates']:
            c['person'] = landing.get(c['article']) if c['article'] else None
    doc = {'schemaVersion': 1,
           'description': ('Election boxes from Wikipedia\'s Irish UK Parliament constituency articles, 1832-1922: '
                           'the clean-source reading of the 1832-1880 general elections and the 1832-1922 '
                           'by-elections, checked against Walker and the lists of MPs before any import.'),
           'provenance': {'method': 'scripts/walker/harvest_wikipedia_constituency_boxes.py',
                          'licence': 'Wikipedia text is CC BY-SA 4.0; only names, parties and figures are kept, '
                                     'each record citing its article.'},
           'counts': {'articles': len(titles), 'boxes': len(boxes),
                      'general': sum(1 for b in boxes if b['kind'] == 'general'),
                      'byElection': sum(1 for b in boxes if b['kind'] == 'by-election')},
           'records': boxes}
    with open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(doc['counts']))


if __name__ == '__main__':
    main()
