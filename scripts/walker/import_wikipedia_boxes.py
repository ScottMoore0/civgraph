#!/usr/bin/env python3
"""Import the cross-checked Wikipedia election boxes as Civgraph source files.

    python scripts/walker/import_wikipedia_boxes.py [--write]

Takes, from the checks already run:
  - the 1832-1880 general elections whose winners agree with Wikipedia's lists of MPs (or,
    for 1865, with Walker), and whose every figure compared with Walker either agreed or was
    settled against the printed page (data/elections/wikipedia-box-vote-review.json);
  - the 1832-1922 by-elections whose box winner is the winner on Wikipedia's lists of
    by-elections, on the same terms for figures;
and writes each as data/elections-source/data/elections/house-of-commons-of-the-united-kingdom/
<date>/<seat>.json in the schema of the 1885-1918 files, with its sources and what was checked,
and the dates in elections_index.json. Where the printed Walker page gives a different figure
from the box, the printed figure is used and the box's recorded. Anything held is left out and
listed in data/elections/wikipedia-boxes-import-report.json.

Without --write this reports what it would do.
"""
import collections
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crosscheck_constituency_boxes import surname, exact  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
D = os.path.join(ROOT, 'data', 'elections')
BODY = 'house-of-commons-of-the-united-kingdom'
SRC = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections', BODY)
# The day each United Kingdom general election began: Civgraph files a general election under one
# date. Irish seats polled over the following weeks; a box records only the year.
GE_DATES = {1832: '1832-12-08', 1835: '1835-01-06', 1837: '1837-07-24', 1841: '1841-06-29', 1847: '1847-07-29',
            1852: '1852-07-07', 1857: '1857-03-27', 1859: '1859-04-28', 1865: '1865-07-11', 1868: '1868-11-17',
            1874: '1874-01-31', 1880: '1880-03-31'}
WALKER = {'title': 'Parliamentary Election Results in Ireland, 1801-1922', 'editor': 'Brian M. Walker (ed.)',
          'publisher': 'Royal Irish Academy', 'year': 1978,
          'note': 'Printed volume, in copyright and not reproduced.'}


def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def load(name):
    return json.load(open(os.path.join(D, name), encoding='utf-8'))


def verdicts():
    out = {}
    for r in load('wikipedia-box-vote-review.json')['records']:
        out[(exact(r['constituency']), surname(r['candidate']), r['wikipedia'])] = r
    return out


def contest_file(box, date, seats, checks, winners_names, list_row=None):
    polled = [c for c in box['candidates'] if c['votes'] is not None]
    rows = []
    for i, c in enumerate(box['candidates']):
        votes = c['votes']
        fix = checks['fixes'].get((surname(c['name']), votes))
        if fix:
            votes = fix['printed']
        elected = (surname(c['name']) in winners_names)
        rows.append({
            'Candidate_First_Pref_Votes': f'{votes:,}' if votes is not None else '',
            'Candidate_Id': '', 'Constituency_Number': '', 'Count_Number': '1',
            'Firstname': ' '.join(c['name'].split(',')[0].split()[:-1]), 'Occurred_On_Count': '',
            'Party_Colour': '#888888', 'Party_Name': c['party'],
            'Status': 'Elected' if elected else 'Not elected',
            'Surname': c['name'].split(',')[0].split()[-1] if c['name'] else '',
            'Total_Votes': f'{votes:,}' if votes is not None else '', 'Transfers': '0.00',
            'candidateName': c['name'].split(',')[0].strip(), 'id': i,
            **({'unopposed': True} if votes is None else {}),
            **({'figureFromWalker': {'wikipedia': c['votes'], 'printed': votes}} if fix else {}),
        })
    valid = sum(v for v in (c['votes'] for c in box['candidates']) if v is not None) if polled else None
    doc = {'Constituency': {'countInfo': {
        'Constituency_Name': box['constituency'], 'Constituency_Number': '', 'Number_Of_Seats': str(seats),
        'Spoiled': '', 'Total_Electorate': str(box['electorate']) if box.get('electorate') else '',
        'Total_Poll': '', 'Valid_Poll': ''}, 'countGroup': rows},
        'kind': box['kind'],
        'source_url': box['url'],
        'sources': [{'title': box['article'], 'publisher': 'Wikipedia', 'url': box['url']},
                    dict(WALKER)] + ([{'title': 'List of United Kingdom by-elections', 'publisher': 'Wikipedia',
                                       'url': list_row['list']}] if list_row else []),
        'checked': checks['summary']}
    if list_row and list_row.get('cause'):
        doc['cause'] = list_row['cause']
    if not polled:
        doc['note'] = 'Returned unopposed.'
    return doc


def main():
    write = '--write' in sys.argv
    boxes = load('wikipedia-irish-constituency-boxes-1832-1922.json')['records']
    ge_cc = load('wikipedia-boxes-crosscheck-1832-1880.json')['records']
    by_cc = load('wikipedia-byelection-crosscheck-1832-1922.json')['records']
    lists = load('wikipedia-uk-byelection-lists-ireland.json')['records']
    vr = verdicts()
    report = collections.Counter()
    held, files = [], []

    def settle(seat, diffs):
        """(ok, fixes) for the vote differences of one contest."""
        fixes = {}
        for d in diffs:
            v = vr.get((exact(seat), surname(d['name']), d['wikipedia']))
            if not v or v['verdict'] == 'hold':
                return False, {}
            if v['verdict'] == 'walker-printed':
                fixes[(surname(d['name']), d['wikipedia'])] = v
        return True, fixes

    # General elections, 1832-1880.
    box_of = {(b['url'], b['year'], b['caption']): b for b in boxes}
    by_url_year = collections.defaultdict(list)
    for b in boxes:
        if b['kind'] == 'general':
            by_url_year[(b['url'], b['year'])].append(b)
    for r in ge_cc:
        year = 1832 if r['year'] == 1833 else r['year']
        if year == 1865:
            # Wikipedia's 1865 list of MPs is incomplete and Walker's 1865 transcription broken,
            # so 43 of its 66 seats have no second source. Published with a third of its seats
            # it would mislead; the whole election is held.
            held.append({'kind': 'general', 'year': 1865, 'constituency': r['constituency'],
                         'why': '1865 held whole: most seats have no second source'})
            report['general held'] += 1
            continue
        date = GE_DATES.get(year)
        cands = by_url_year.get((r['article'], r['year']), [])
        box = cands[0] if len(cands) == 1 else None
        diffs = (r.get('walker') or {}).get('differences', [])
        ok, fixes = settle(r['constituency'], diffs)
        winners_ok = r.get('mpListAgrees')
        if not (date and box and winners_ok and ok):
            held.append({'kind': 'general', 'year': r['year'], 'constituency': r['constituency'],
                         'why': 'no date' if not date else 'no single box' if not box else
                                'winners not confirmed' if not winners_ok else 'a figure held for review'})
            report['general held'] += 1
            continue
        summary = ('winners agree with Wikipedia\'s list of MPs' + (' (Walker for 1865)' if r['year'] == 1865 else '')
                   + (f"; {r['walker']['compared']} figure(s) compared with Walker"
                      + (f", {len(fixes)} taken from his printed page" if fixes else ', all agreeing') if r.get('walker') and r['walker']['compared'] else
                      '; figures not compared (Walker has none for this seat)'))
        doc = contest_file(box, date, r['seats'], {'fixes': fixes, 'summary': summary},
                           {surname(n) for n in r['winners']})
        files.append((date, box['constituency'], doc))
        report['general imported'] += 1

    # By-elections, 1832-1922 (before the Northern Ireland general election of November 1922).
    list_of = {(x['date'], exact(x['constituency']), x['winner']): x for x in lists}
    boxes_by_url = collections.defaultdict(list)
    for b in boxes:
        if b['kind'] == 'by-election':
            boxes_by_url[b['url']].append(b)
    for r in by_cc:
        if r['date'] >= '1922-11-15':
            continue
        if r['status'] == 'held':
            held.append({'kind': 'by-election', 'date': r['date'], 'constituency': r['constituency'], 'why': r.get('why')})
            report['by-election held'] += 1
            continue
        ok, fixes = settle(r['constituency'], r['walker']['differences'])
        box = next((b for b in boxes_by_url.get(r['article'], [])
                    if (b['date'] == r['date'] or (not b['date'] and b['year'] == int(r['date'][:4])))
                    and any(surname(c['name']) == surname(r['winnerOnList']) for c in b['candidates'])), None)
        if not (ok and box):
            held.append({'kind': 'by-election', 'date': r['date'], 'constituency': r['constituency'],
                         'why': 'a figure held for review' if not ok else 'box not found again'})
            report['by-election held'] += 1
            continue
        summary = ("winner agrees with Wikipedia's list of by-elections"
                   + (f"; {r['walker']['compared']} figure(s) compared with Walker"
                      + (f", {len(fixes)} taken from his printed page" if fixes else ', all agreeing')
                      if r['walker']['compared'] else '; figures not compared with Walker'))
        polled = [c for c in box['candidates'] if c['votes'] is not None]
        seats = box.get('seats') or 1
        winners = sorted(polled, key=lambda c: -c['votes'])[:seats] if polled else box['candidates'][:seats]
        lrow = list_of.get((r['date'], exact(r['constituency']), r['winnerOnList']))
        doc = contest_file(box, r['date'], seats, {'fixes': fixes, 'summary': summary},
                           {surname(c['name']) for c in winners}, lrow)
        files.append((r['date'], box['constituency'], doc))
        report['by-election imported'] += 1

    # Two files for one seat on one date would overwrite each other: keep the first, report the rest.
    seen, unique = set(), []
    for date, seat, doc in files:
        k = (date, slug(seat))
        if k in seen:
            report['duplicate seat-date dropped'] += 1
            continue
        seen.add(k)
        unique.append((date, seat, doc))
    existing = {(d, f[:-5]) for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d))
                for f in os.listdir(os.path.join(SRC, d)) if f.endswith('.json')}
    clash = [(d, s) for d, s, _ in unique if (d, slug(s)) in existing]
    report['would overwrite an existing file'] = len(clash)
    print(json.dumps(dict(report)))
    json.dump({'schemaVersion': 1, 'counts': dict(report), 'held': held},
              open(os.path.join(D, 'wikipedia-boxes-import-report.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    if not write:
        print('dry run; clashes:', clash[:5])
        return
    by_date = collections.defaultdict(set)
    for date, seat, doc in unique:
        if (date, slug(seat)) in existing:
            continue
        os.makedirs(os.path.join(SRC, date), exist_ok=True)
        with open(os.path.join(SRC, date, slug(seat) + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        by_date[date].add(seat)
    ipath = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections_index.json')
    raw = open(ipath, encoding='utf-8').read()
    index = json.loads(raw)
    body = next(x for x in index['bodies'] if x['slug'] == BODY)
    for date, seats in by_date.items():
        e = next((x for x in body['dates'] if x['date'] == date), None)
        if e is None:
            body['dates'].append({'date': date, 'constituencies': sorted(seats)})
        else:
            e['constituencies'] = sorted(set(e['constituencies']) | seats)
    body['dates'].sort(key=lambda x: x['date'], reverse=True)
    indent = len(re.search(r'\n( +)"bodies"', raw).group(1))
    open(ipath, 'w', encoding='utf-8').write(json.dumps(index, indent=indent, ensure_ascii=False) + ('\n' if raw.endswith('\n') else ''))
    print(f'wrote {sum(len(v) for v in by_date.values())} files over {len(by_date)} dates')
    # Who each candidate is comes from the article his name links to; see that script.
    import stamp_wikipedia_person_ids
    stamp_wikipedia_person_ids.main(write=True)


if __name__ == '__main__':
    main()
