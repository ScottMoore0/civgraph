#!/usr/bin/env python3
"""Extract the Irish facts from a local copy of History of Parliament Online.

    python scripts/hop/extract_hop_ireland.py --archive <archive.sqlite>
    (or set HOP_ARCHIVE)

The History of Parliament covers Ireland's Westminster seats from the Union: the volumes
1790-1820 (ed. R. Thorne, 1986), 1820-1832 (ed. D.R. Fisher, 2009) and 1832-1868 (in
progress, online). From each Irish constituency page this takes the facts in its
"Background Information" block (registered electors, freeholders) and its Elections
table -- every contest's date, the candidates, their votes, who was returned and the cause
of a by-election -- and from each Irish member's page the seats held with their dates and
the dates of birth and death. Nothing of the Trust's narrative (biographies, constituency
essays, end notes) is taken: each fact records the page it came from, so Civgraph cites
and links to it instead. The user cleared this use on 2026-10-01.

The archive is the scraper's database (table `responses`: url, status, body), not the
HTML mirror beside it, whose files include thousands of "Bot check" refusal pages.

Output: data/elections/hop/hop-irish-constituencies.json and hop-irish-members.json.
"""
import argparse
import gzip
import html
import json
import os
import re
import sqlite3
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'elections', 'hop')
SITE = 'https://www.historyofparliamentonline.org'
VOLUMES = {
    '1790-1820': {'title': 'The History of Parliament: the House of Commons 1790-1820', 'editor': 'R. Thorne', 'year': 1986},
    '1820-1832': {'title': 'The History of Parliament: the House of Commons 1820-1832', 'editor': 'D.R. Fisher', 'year': 2009},
    '1832-1868': {'title': 'The History of Parliament: the House of Commons 1832-1868', 'editor': 'P. Salmon and K. Rix',
                  'year': None, 'note': 'in progress; published online in draft'},
}
IRISH_COUNTY = re.compile(r'^(co|county)-')
IRISH_BOROUGHS = {'armagh', 'athlone', 'bandon', 'belfast', 'carlow', 'carrickfergus', 'cashel', 'clonmel', 'coleraine',
                  'cork', 'downpatrick', 'drogheda', 'dublin', 'dublin-university', 'dundalk', 'dungannon', 'dungarvan',
                  'ennis', 'enniskillen', 'galway', 'kilkenny', 'kinsale', 'limerick', 'lisburn', 'londonderry', 'mallow',
                  'new-ross', 'newry', 'bandon-bridge', 'portarlington', 'sligo', 'tralee', 'waterford', 'wexford', 'youghal',
                  'kings-county', 'queens-county', 'queens-co'}
MONTHS = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'june': 6, 'jun': 6, 'july': 7, 'jul': 7, 'aug': 8,
          'sept': 9, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
PAGE = re.compile(r'https?://(?:www\.)?historyofparliamentonline\.org(/volume/(1790-1820|1820-1832|1832-1868)/'
                  r'(constituencies|member)/([^/?#]+?))/?$')


def decode(b):
    if b is None:
        return ''
    if isinstance(b, str):
        return b
    for f in (lambda x: x, zlib.decompress, gzip.decompress):
        try:
            raw = f(b)
            break
        except Exception:
            raw = None
    if raw is None:
        return ''
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('cp1252', 'replace')   # the pages are Windows-1252 (curly apostrophes)


def text(fragment):
    t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', fragment or ''))).replace(' ,', ',').strip()
    # HoP's own pages carry U+FFFD where a curly apostrophe was lost (O�FERRALL) and a
    # backtick for one in places (O`HARA).
    return t.replace('�', "'").replace('`', "'")


def iso(date_text):
    """'23 Mar. 1820' -> 1820-03-23; '1830' -> 1830; '11 Sept. 1820' -> 1820-09-11."""
    t = date_text.strip().rstrip('.')
    m = re.match(r'^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$', t)
    if m and m.group(2).lower() in MONTHS:
        return f'{int(m.group(3)):04d}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}'
    m = re.match(r'^([A-Za-z]+)\.?\s+(\d{4})$', t)
    if m and m.group(1).lower() in MONTHS:
        return f'{int(m.group(2)):04d}-{MONTHS[m.group(1).lower()]:02d}'
    m = re.match(r'^(\d{4})$', t)
    return m.group(1) if m else None


def is_irish(slug):
    return bool(IRISH_COUNTY.match(slug)) or slug in IRISH_BOROUGHS


def constituency(path, volume, page):
    name = text((re.search(r'<title>(.*?)\|', page, re.S) or re.search(r'<title>(.*?)</title>', page, re.S)).group(1))
    background = [{'label': text(h).rstrip(':'), 'value': text(v)}
                  for h, v in re.findall(r'<div class="con-bgrndinfo"><h4>(.*?)</h4><div class="con-bgrndinfo-data">(.*?)</div>', page, re.S)]
    elections, current = [], None
    table = re.search(r'<table class="hop_mp_table.*?</table>', page, re.S)
    for tr in re.findall(r'<tr class="hop_mp_table_tr([^"]*)">(.*?)</tr>', table.group(0) if table else '', re.S):
        cls, row = tr
        cells = re.findall(r'<td class="([^"]*)"[^>]*>(.*?)</td>', row, re.S)
        date_cell = next((v for c, v in cells if 'date' in c), '')
        cand = next(((c, v) for c, v in cells if 'date' not in c and 'votes' not in c), ('', ''))
        votes = [v for c, v in cells if 'votes' in c]
        date_text = text(date_cell)
        if date_text:
            current = {'dateText': date_text, 'date': iso(date_text), 'byElection': '<i>' in date_cell or '<em>' in date_cell,
                       'candidates': [], 'petitions': [], 'outcomes': []}
            elections.append(current)
        if current is None:
            continue
        link = re.search(r'<a href="(/volume/[^"]+/member/[^"]+)"', cand[1])
        span = re.search(r'<span>(.*?)</span>', cand[1], re.S)
        # What follows the name is either the rest of it (", Visct. Duncannon"; "Bt." after
        # "SIR GEORGE FITZGERALD HILL,") or what happened ("vice Butler, become a peer of
        # Ireland"; "re-elected after appointment to office").
        rest = text(re.sub(r'<a [^>]*>.*?</a>|<span>.*?</span>', ' ', cand[1], flags=re.S))
        cname = text(span.group(1)) if span else ''
        designation = None
        if rest.startswith(',') or (cname.endswith(',') and rest):
            # "..., Visct. Duncannon" / "SIR ROBERT HARRY INGLIS," "bt. vice Hartopp, deceased":
            # the title or style, then what happened, if anything.
            cname = cname.rstrip(',').strip()
            m = re.match(r'^,?\s*(.*?)\s*((?:vice|re-elected|on petition)\b.*)?$', rest)
            designation, rest = (m.group(1) or None), (m.group(2) or '')
        elif cname.endswith(','):
            cname = cname.rstrip(',').strip()
        nums = [int(n.replace(',', '')) for v in votes for n in re.findall(r'\d[\d,]*', text(v))]
        if not cname:
            if rest:
                m = re.match(r"^([A-Z][\w'’ .-]*?) re-elected\b(.*)$", rest)
                if m and not current['candidates']:
                    current['candidates'].append({'name': m.group(1).strip(), 'designation': None, 'member': None,
                                                  'returned': True, 'votes': nums, 'note': 're-elected' + m.group(2)})
                else:
                    current['outcomes'].append(rest)   # "Election declared void, 8 Aug. 1831"
            continue
        if rest and re.search(r'\bon petition\b', rest) and current['candidates']:
            # "BLAKE vice Ponsonby, on petition, 18 June 1813": how the contest ended, not a
            # further candidate.
            mv = re.match(r'^vice\s+(.+?),\s*on petition(?:,\s*(.+))?$', rest)
            when = mv.group(2) if mv and mv.group(2) else None
            current['petitions'].append({'seated': cname, 'member': link.group(1) if link else None,
                                         'unseated': mv.group(1).strip() if mv else None,
                                         'date': (iso(when) or when) if when else None, 'text': rest})
            continue
        current['candidates'].append({'name': cname, 'designation': designation,
                                      'member': link.group(1) if link else None,
                                      'returned': 'election_win' in cand[0], 'votes': nums, 'note': rest or None})
    slug = path.rsplit('/', 1)[-1]
    seat_type = 'county' if IRISH_COUNTY.match(slug) or slug in ('kings-county', 'queens-county', 'queens-co') else         'university' if slug == 'dublin-university' else 'borough'
    return {'path': path, 'url': SITE + path, 'volume': volume, 'slug': slug, 'name': name,
            'seatType': seat_type, 'background': background, 'elections': elections}


def member(path, volume, page):
    title = text((re.search(r'<title>(.*?)\|', page, re.S) or re.search(r'<title>(.*?)</title>', page, re.S)).group(1))
    seats = []
    for cons, dates in re.findall(r'<div class="cons_name">.*?<a href="([^"]+)">.*?</a>.*?<div class="cons_date">(.*?)</div>', page, re.S):
        d = text(dates)
        a, _, b = d.partition(' - ')
        seats.append({'constituency': cons, 'dates': d, 'from': iso(a) if a else None, 'to': iso(b) if b else None})
    fam = re.search(r'<h3 id="family-relations"[^>]*>.*?</h3>(.*?)<h3', page, re.S)
    fam_text = re.sub(r'\b([bmd]|educ|suc)\s+\.', r'\1.', text(fam.group(1)) if fam else '')
    # The heading's years are the member's own; the family paragraph also dates his father's
    # and wife's deaths, and "d." there can be "daughter". A dated b./d. is taken only when its
    # year is the heading's (Sir John Stewart, 1758-1825, is not the "d. 28 May 1795" of a
    # relative); otherwise the heading's year stands.
    life = re.search(r'\((?:c\.\s*|\?)?(\d{4})?\??-(?:c\.\s*|\?)?(\d{4})\??\)', title)
    date = r'(\d{1,2}\s+[A-Za-z]+\.?\s+\d{4}|[A-Za-z]+\.?\s+\d{4}|\d{4})'
    def own(marker, year):
        hits = [m.group(1) for m in re.finditer(r'\b' + marker + r'\.\s*(?:c\.\s*)?' + date, fam_text)]
        if year:
            hits = [h for h in hits if h[-4:] == year]
            return iso(hits[-1 if marker == 'd' else 0]) if hits else year
        if marker == 'd':
            # No year to check against: only the paragraph's closing "d. <date>." is his.
            end = re.search(r'\bd\.\s*' + date + r'\.?\s*$', fam_text)
            return iso(end.group(1)) if end else None
        return iso(hits[0]) if hits else None
    return {'path': path, 'url': SITE + path, 'volume': volume, 'heading': title,
            'born': own('b', life.group(1) if life else None),
            'died': own('d', life.group(2) if life else None),
            'seats': seats}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--archive', default=os.environ.get('HOP_ARCHIVE'))
    args = ap.parse_args()
    if not args.archive or not os.path.exists(args.archive):
        raise SystemExit('give --archive <archive.sqlite> or set HOP_ARCHIVE')
    db = sqlite3.connect(args.archive)
    pages = {}
    for url, status, body in db.execute("select url, status, body from responses where status = 200 and url like '%/volume/%'"):
        m = PAGE.match(url.strip())
        if m:
            pages[(m.group(3), m.group(2), m.group(4).lower())] = (m.group(1), body)
    cons = []
    for (kind, vol, slug), (path, body) in sorted(pages.items()):
        if kind == 'constituencies' and is_irish(slug):
            page = decode(body)
            if 'Bot check' in page[:3000] or 'restricted to logged in users' in page:
                continue   # 1832-1868 pages are behind a login: nothing to read
            cons.append(constituency(path, vol, page))
    # Who the Irish members were. The 1820-1832 tables link each name to a biography; the
    # 1790-1820 tables print names only. So every member page is read, and kept when any
    # seat it lists is Irish; a linked name whose page is missing is reported.
    members, missing, kept = [], [], set()
    for (kind, vol, slug), (path, body) in sorted(pages.items()):
        if kind != 'member':
            continue
        page = decode(body)
        if 'Bot check' in page[:3000] or 'restricted to logged in users' in page:
            continue
        rec = member(path, vol, page)
        if any(is_irish(s['constituency'].rstrip('/').rsplit('/', 1)[-1].lower()) for s in rec['seats']):
            members.append(rec)
            kept.add(path)
    wanted = {c['member'] for x in cons for e in x['elections'] for c in e['candidates'] if c['member']} - kept
    for path in sorted(wanted):
        m = PAGE.match(SITE + path)
        hit = pages.get(('member', m.group(2), m.group(4).lower())) if m else None
        if not hit:
            missing.append(path)
            continue
        page = decode(hit[1])
        if 'Bot check' in page[:3000]:
            missing.append(path)
            continue
        members.append(member(path, m.group(2), page))
    os.makedirs(OUT, exist_ok=True)
    meta = {'source': 'History of Parliament Online, https://www.historyofparliamentonline.org',
            'rightsHolder': 'History of Parliament Trust', 'volumes': VOLUMES,
            'note': 'Facts only (dates, votes, names, who was returned, electorates, seat tenures, life dates). '
                    'The Trust\'s narrative text is not reproduced; each record carries the page it came from.',
            'method': 'scripts/hop/extract_hop_ireland.py'}
    json.dump({**meta, 'counts': {'constituencies': len(cons), 'elections': sum(len(c['elections']) for c in cons)},
               'constituencies': cons},
              open(os.path.join(OUT, 'hop-irish-constituencies.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    json.dump({**meta, 'counts': {'members': len(members), 'notInArchive': len(missing)}, 'members': members,
               'notInArchive': missing},
              open(os.path.join(OUT, 'hop-irish-members.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    per = {}
    for c in cons:
        per.setdefault(c['volume'], [0, 0])
        per[c['volume']][0] += 1
        per[c['volume']][1] += len(c['elections'])
    print(json.dumps({'constituencies by volume [pages, elections]': per, 'members': len(members),
                      'members not in archive': len(missing)}))


if __name__ == '__main__':
    main()
