#!/usr/bin/env python3
"""Check Gallagher's 1923-44 by-elections against ElectionsIreland and Wikipedia.

    python scripts/walker/crosscheck_gallagher_byelections.py

Two further sources, fetched and compared contest by contest:
  ElectionsIreland.org  result page per by-election (from its by-election index): electorate,
                        quota, each candidate's first preferences, who took the seat, and the
                        candidate ids that identify the same person across elections.
  Wikipedia             "List of Dail by-elections": date, constituency, winner, the member
                        whose seat fell vacant.
ElectionsIreland may itself draw on Gallagher for these years, so agreement with it is
corroboration rather than independent proof; Wikipedia's list is compiled from the Dail's own
records and names the people, not the figures.

Each record of data/elections/gallagher-byelections-1923-44.json gains `crosscheck`, and each
candidate the ElectionsIreland id where one is found. Nothing else is changed.
"""
import difflib
import json
import os
import re
import sys
import time
import unicodedata

import httpx
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
import harvest_ei_candidate_ids as ei  # noqa: E402
from wiki_tables import grid  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FILE = os.path.join(ROOT, 'data', 'elections', 'gallagher-byelections-1923-44.json')
UA = {'User-Agent': 'civgraph-election-research/1.0 (https://civgraph.net)'}
MONTHS = {m: i + 1 for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july',
                                          'august', 'september', 'october', 'november', 'december'])}


def key(s):
    # Dashes first: an en dash dropped by the ASCII fold would fuse Carlow–Kilkenny.
    s = (s or '').replace('–', ' ').replace('—', ' ').replace('-', ' ')
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\[.*?\]', ' ', s)
    s = s.replace('nui', 'national university').replace('laois', 'leix').replace(' and ', ' ')
    return ' '.join(sorted(re.sub(r'[^a-z ]', ' ', s).split()))


def surname(name):
    s = unicodedata.normalize('NFKD', name or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\b(snr|jnr|sr|jr)\b|\d+$', '', s.strip()).replace("o'", 'o').replace("'", '')
    s = re.sub(r'(^|\s)(mac|mc)\s+', r'\1\2', s)          # Mac Eoin is MacEoin
    toks = [t for t in re.split(r'[^a-z]+', s) if t]
    return toks[-1] if toks else ''


def iso(text):
    m = re.search(r'(\d{1,2}) ([A-Za-z]+) (\d{4})', text or '')
    if not m or m.group(2).lower() not in MONTHS:
        return None
    return f'{int(m.group(3)):04d}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}'


def ei_pages(client):
    html, _ = ei.fetch(client, ei.BYELECTION_INDEX)
    soup = BeautifulSoup(html, 'html.parser')
    out = {}
    for a in soup.find_all('a', href=True):
        if 'result.cfm' not in a['href']:
            continue
        row = a.find_parent('tr')
        cells = [re.sub(r'\s+', ' ', td.get_text(strip=True)) for td in row.find_all('td')] if row else []
        date = next((iso(x) for x in cells if iso(x)), None)
        if date:
            out[(date, key(a.get_text(strip=True)))] = 'https://electionsireland.org/' + a['href'].split('/')[-1].lstrip('./')
    return out


def ei_result(client, url):
    html, _ = ei.fetch(client, url)
    if not html:
        return None
    soup = BeautifulSoup(html, 'html.parser')
    text = soup.get_text(' ', strip=True)
    res = {'url': url, 'candidates': []}
    m = re.search(r'Electorate:\s*([\d,]+)', text)
    res['electorate'] = int(m.group(1).replace(',', '')) if m else None
    m = re.search(r'Quota:\s*([\d,]+)', text)
    res['quota'] = int(m.group(1).replace(',', '')) if m else None
    ids = {c['name']: c['id'] for c in ei.parse_candidate_ids(html)}
    for tr in soup.find_all('tr'):
        cells = [re.sub(r'\s+', ' ', td.get_text(' ', strip=True)) for td in tr.find_all('td')]
        vals = [c for c in cells if c]
        if len(vals) < 4 or not re.fullmatch(r'[\d,]+', vals[1] or ''):
            continue
        if not re.search(r'%', ' '.join(vals)):
            continue
        name = re.sub(r'\s+\d+$', '', vals[0]).strip()
        # Status reads "Made Quota" or "Elected" for a winner; "Not Elected", "Eliminated",
        # "Lost Deposit" otherwise.
        status = next((v for v in vals if re.search(r'Quota|Elected|Eliminated|Deposit', v)), '')
        res['candidates'].append({'name': name, 'firstPreferences': int(vals[1].replace(',', '')),
                                  'elected': bool(re.search(r'Made Quota|^Elected', status)),
                                  'eiCandidateId': ids.get(name) or next((v for k, v in ids.items() if surname(k) == surname(name)), None)})
    return res


def wikipedia_list():
    """Rows of the list's main table, keyed by constituency; each carries its date. The table
    has a two-row header ("Vacancy" / "By-election" over the column names)."""
    html = requests.get('https://en.wikipedia.org/api/rest_v1/page/html/List_of_D%C3%A1il_by-elections',
                        headers=UA, timeout=60).text
    soup = BeautifulSoup(html, 'html.parser')
    out = {}
    for tb in soup.find_all('table', class_=re.compile('wikitable')):
        g = grid(tb)
        if len(g) < 3 or 'winner' not in ' '.join(t.lower() for t, _ in g[1]):
            continue
        head = [t.lower() for t, _ in g[1]]
        for row in g[2:]:
            cells = [re.sub(r'\s*\[.*?\]', '', t).strip() for t, _ in row]
            col = dict(zip(head, cells))
            date = iso(col.get('date'))
            if not date or not ('1923' <= date[:4] <= '1944'):
                continue
            out.setdefault(key(col.get('constituency')), []).append(
                {'date': date, 'winner': col.get('winner'), 'outgoing': col.get('outgoing'), 'cause': col.get('cause')})
    return out


def near(a, b, days=10):
    from datetime import date
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    return abs((da - db).days) <= days


# Where the sources disagree, what was decided and why.
DECISIONS = {
    ('1924-11-19', 'Cork Borough'): (
        "Gallagher's figures (Egan 27,021, French 14,703) are kept. Walker (1992) and ElectionsIreland give "
        "27,717 and 12,399, a total of 40,116; Gallagher's total of 41,724 fits his quota (20,863) and turnout "
        "(64.26%), and Wikipedia's article gives the same turnout (64.3%) and shares (64.8%, 35.2%)."),
    ('1925-03-11', 'Cavan'): (
        "Gallagher's 10,285 for O'Hanlon is kept. Walker and ElectionsIreland print 10,280, but Walker's own "
        "quota, 16,310, requires a valid poll of 32,619, which is Gallagher's total; 10,280 gives 32,614."),
}
NAMES = {
    ('1924-03-12', 'James O’Meara'): ("James O'Mara", "ElectionsIreland and Wikipedia spell it O'Mara; Gallagher prints O'Meara."),
}


def main():
    doc = json.load(open(FILE, encoding='utf-8'))
    client = httpx.Client(headers=ei.HEADERS, timeout=60.0, follow_redirects=True)
    pages = ei_pages(client)
    wiki = wikipedia_list()
    tally = {'ei found': 0, 'ei winner agrees': 0, 'ei first preferences agree': 0, 'ei electorate agrees': 0,
             'wikipedia found': 0, 'wikipedia winner agrees': 0}
    problems = []
    for b in doc['records']:
        k = (b['date'], key(b['constituency']))
        cc = {}
        url = pages.get(k)
        ei_date_differs = None
        if not url:
            # ElectionsIreland dates Roscommon's 1925 by-election to February 1926. A page for
            # the same seat within a year is taken only if every first preference is identical.
            for (d, kk), u in pages.items():
                if kk == k[1] and d != b['date'] and near(d, b['date'], 400):
                    probe = ei_result(client, u)
                    figs = sorted(c['firstPreferences'] for c in (probe or {}).get('candidates', []))
                    if figs and figs == sorted(c['firstPreferences'] for c in b['candidates'] if c['firstPreferences']):
                        url, ei_date_differs = u, d
                        break
        if url:
            r = ei_result(client, url)
            time.sleep(0.2)
            if r and r['candidates']:
                tally['ei found'] += 1
                eis = {surname(c['name']): c for c in r['candidates']}
                # A few ElectionsIreland rows put the surname first ("O'Mullane Michael").
                for c in r['candidates']:
                    eis.setdefault(surname(c['name'].split()[0]) if c['name'] else '', c)
                # A spelling apart (O'Meara/O'Mara) is the same candidate when the figures
                # agree; a different surname with the same figure (Conlan/Curton) is left
                # unlinked and reported, because the name itself is in dispute.
                for c in b['candidates']:
                    s = surname(c['name'])
                    if s in eis:
                        continue
                    close = [e for e in r['candidates'] if e['firstPreferences'] == c['firstPreferences']
                             and difflib.SequenceMatcher(None, s, surname(e['name'])).ratio() >= 0.75]
                    if len(close) == 1:
                        eis[s] = close[0]
                        c['spellingElsewhere'] = close[0]['name']
                    elif any(e['firstPreferences'] == c['firstPreferences'] for e in r['candidates']):
                        other = next(e for e in r['candidates'] if e['firstPreferences'] == c['firstPreferences'])
                        c['nameInDispute'] = {'electionsIreland': other['name']}
                fp_diffs = [(c['name'], c['firstPreferences'], eis.get(surname(c['name']), {}).get('firstPreferences'))
                            for c in b['candidates']
                            if eis.get(surname(c['name']), {}).get('firstPreferences') != c['firstPreferences']]
                win_g = sorted(surname(c['name']) for c in b['candidates'] if c['elected'])
                win_e = sorted(surname(c['name']) for c in r['candidates'] if c['elected'])
                cc['electionsIreland'] = {'url': url, 'electorate': r['electorate'], 'quota': r['quota'],
                                          **({'datedThere': ei_date_differs} if ei_date_differs else {}),
                                          'winnerAgrees': win_g == win_e,
                                          'firstPreferencesAgree': not fp_diffs and len(r['candidates']) == len(b['candidates']),
                                          'electorateAgrees': r['electorate'] == b.get('electorate'),
                                          **({'differences': fp_diffs} if fp_diffs else {})}
                tally['ei winner agrees'] += win_g == win_e
                tally['ei first preferences agree'] += cc['electionsIreland']['firstPreferencesAgree']
                tally['ei electorate agrees'] += r['electorate'] == b.get('electorate')
                for c in b['candidates']:
                    hit = eis.get(surname(c['name']))
                    if hit and hit.get('eiCandidateId'):
                        c['eiCandidateId'] = hit['eiCandidateId']
                if win_g != win_e or fp_diffs:
                    problems.append((b['date'], b['constituency'], 'EI', win_g, win_e, fp_diffs))
        w = [x for x in wiki.get(key(b['constituency']), []) if near(x['date'], b['date'])]
        if w:
            tally['wikipedia found'] += 1
            wins = sorted(surname(x['winner']) for x in w if x['winner'])
            mine = sorted(surname(c['name']) for c in b['candidates'] if c['elected'])
            agrees = wins == mine
            cc['wikipedia'] = {'list': 'https://en.wikipedia.org/wiki/List_of_D%C3%A1il_by-elections',
                               'date': w[0]['date'], 'winners': [x['winner'] for x in w],
                               'outgoing': [x['outgoing'] for x in w], 'cause': [x['cause'] for x in w],
                               'winnerAgrees': agrees}
            tally['wikipedia winner agrees'] += agrees
            if not agrees:
                problems.append((b['date'], b['constituency'], 'WIKI', mine, wins))
        b['crosscheck'] = cc
        if (b['date'], b['constituency']) in DECISIONS:
            b['decision'] = DECISIONS[(b['date'], b['constituency'])]
        for c in b['candidates']:
            fix = NAMES.get((b['date'], c['name']))
            if fix:
                c['nameAdopted'], c['nameNote'] = fix
    doc['counts']['crosscheck'] = tally
    with open(FILE, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(tally))
    if '--write' in sys.argv:
        import harvest_gallagher
        written = harvest_gallagher.write_byelection_files(doc['records'])
        print(f'wrote {len(written)} by-election source files')
    for p in problems:
        print('  ', p)


if __name__ == '__main__':
    main()
