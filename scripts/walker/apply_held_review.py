#!/usr/bin/env python3
"""Apply the review of the 1832-1922 contests import_wikipedia_boxes.py held back.

    python scripts/walker/apply_held_review.py [--write]

import_wikipedia_boxes.py held 176 contests that its checks could not settle. Each was then
read against Walker's printed page (data/elections/wikipedia-box-held-review.json, one
record per held contest, with what the page says and a recommendation). This script carries
out those recommendations:

  import-as-box               the Wikipedia box is right as it stands (132);
  fix-date-or-kind            the box is right, filed under the day Walker gives (22);
  import-with-walker-figures  the box with the printed page's figures where they differ (3);
  import-from-walker          no box exists; built from the printed page (4);
  drop                        not a contest of its own: a petition award (recorded as a note
                              on the contest it ended), a duplicate row, or not an Irish seat (15).

Where the review left a choice open, the decision taken is in CHOICES below. Files already
on disk are left alone, except 1874-05-29/mayo.json, which the review found wrong (OVERWRITE).
Without --write this reports what it would do.
"""
import collections
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crosscheck_constituency_boxes import exact, surname  # noqa: E402
from import_wikipedia_boxes import BODY, D, GE_DATES, ROOT, SRC, WALKER, contest_file, load, slug  # noqa: E402

REVIEW = os.path.join(D, 'wikipedia-box-held-review.json')

# Where the review asked for a decision, the one taken (2026-10-03; each was the reviewer's
# proposed default, accepted).
CHOICES = {
    ('by-election', '1874-05-29', 'County Mayo'): 'two seats: Browne and O\'Connor Power both elected',
    ('by-election', '1917-05-10', 'South Longford'): "McGuinness 1,498 as the box has it (majority 37); Walker prints 1,493",
    ('by-election', '1906-07-05', 'East Tyrone'): "MacCaw 3,000 as the box has it; Walker's 3,022 is a misprint that would make him the winner",
    ('general', 1865, 'County Kilkenny'): "Walker's figures: Bryan 2,728, Agar-Ellis 2,913 (the box swaps them)",
    ('general', 1832, 'Monaghan'): "Perrin 1,452 from the printed page (the box has 1,454)",
    ('general', 1874, 'Athlone'): 'the petition-amended poll, 153-148, with the declared 140-140 tie in a note',
    ('by-election', '1853-07-04', 'Clare'): "H. S. Burton's 3 votes kept, as the box has them; Walker omits him",
    ('by-election', '1875-02-13', 'County Tipperary'): "dated 16 February 1875, as Walker dates it (the list has 13 February)",
}

# The day each corrected contest is filed under (the review's fix-date-or-kind).
DATE_FIX = {
    ('by-election', '1856-02-18', 'New Ross'): '1856-03-18',
    ('by-election', '1864-03-23', 'County Armagh'): '1864-03-23',
    ('by-election', '1866-11-22', 'Belfast'): '1866-11-22',
    ('by-election', '1867-02-12', 'Galway Borough'): '1867-02-12',
    ('by-election', '1867-02-12', 'Dublin University'): '1867-02-12',
    ('by-election', '1867-03-30', 'Dublin University'): '1867-03-30',
    ('by-election', '1867-04-01', 'Galway Borough'): '1867-04-01',
    ('by-election', '1872-12-06', 'Cork City'): '1872-12-10',
    ('by-election', '1873-04-07', 'County Tyrone'): '1873-04-16',
    ('by-election', '1875-02-13', 'County Tipperary'): '1875-02-16',
    ('by-election', '1875-03-11', 'County Tipperary'): '1875-03-11',
    ('by-election', '1880-05-21', 'County Londonderry'): '1880-05-19',
    ('by-election', '1880-05-22', 'County Meath'): '1880-05-20',
    ('by-election', '1880-05-31', 'County Mayo'): '1880-05-25',
    ('by-election', '1883-06-15', 'County Wexford'): '1883-06-13',
    ('by-election', '1884-06-14', 'Athlone'): '1884-06-12',
    ('by-election', '1900-02-27', 'South Mayo'): '1900-02-27',
    ('by-election', '1906-07-05', 'East Tyrone'): '1906-07-25',
    ('by-election', '1917-02-05', 'Dublin University'): '1917-02-05',
    ('by-election', '1917-05-10', 'South Longford'): '1917-05-09',
    ('by-election', '1917-10-05', 'Dublin University'): '1917-10-05',
}
# Antrim "1833" is the 1832 general election, polled 2 January 1833.
GE_REFILE = {('general', 1833, 'Antrim'): (1832, '1833-01-02')}

# Two seats filled at one by-election, after both members were unseated on petition.
SEATS = {('by-election', '1842-08-19', 'Belfast'): 2, ('by-election', '1853-07-04', 'Clare'): 2,
         ('by-election', '1874-05-29', 'County Mayo'): 2}
OVERWRITE = {('by-election', '1874-05-29', 'County Mayo'): '1874-05-29/mayo.json'}

# Spellings the printed page corrects.
NAME_FIX = {('by-election', '1835-09-21', 'County Waterford'): [('Villiers-Stewart', 'Villiers-Stuart')],
            ('by-election', '1866-11-22', 'Belfast'): [('McMeechan', 'McMechan')]}

# What happened after the poll, from the printed page.
NOTES = {
    ('general', 1874, 'Athlone'): 'Declared poll: Sheil 140, Ennis 140, Sheil declared elected; on petition the poll was '
                                 'amended to Sheil 153, Ennis 148 (Walker).',
    ('general', 1841, 'Waterford City'): 'On petition Christmas and Reade were unseated and Wyse and Barron declared '
                                        'elected, 13 June 1842 (Walker).',
    ('by-election', '1875-03-11', 'County Tipperary'): 'On petition Mitchel was again declared ineligible and the seat '
                                                       'assigned to Stephen Moore, 26 May 1875 (Walker).',
}
# Petition awards the lists file as by-elections: a note on the contest each one ended.
PETITION_NOTES = {
    '1834-05-17/monaghan.json': 'On petition Westenra was unseated and Lucas declared elected, 30 July 1834, '
                                "Westenra's poll being amended to 973 (Walker).",
    '1835-04-24/drogheda.json': "On petition O'Dwyer was unseated and Plunkett declared elected, 21 June 1835 (Walker).",
    '1835-06-15/county-carlow.json': 'On petition Vigors and Raphael were unseated and Kavanagh and Bruen declared '
                                     'elected, 19 August 1835, 105 votes each being struck off Vigors and Raphael (Walker).',
    '1836-12-30/longford.json': 'On petition White was unseated and Fox declared elected, 5 May 1837 (Walker).',
    '1839-02-27/carlow.json': 'On petition Bruen was unseated and Gisborne declared elected, 12 July 1839, '
                              'the poll being amended (Walker).',
    '1872-02-08/county-galway.json': 'On petition Nolan was unseated and Trench declared elected, 13 June 1872 (Walker).',
}

# The four by-elections with no box, built from the printed page.
WALKER_BUILT = {
    ('by-election', '1913-06-09', 'Leix'): {'seat': 'Leix', 'electorate': 4785,
        'candidates': [('Patrick Joseph Meehan', 'Irish Parliamentary', None)], 'cause': 'Death of Patrick Aloysius Meehan'},
    ('by-election', '1914-12-08', 'Tullamore'): {'seat': 'Tullamore', 'electorate': 4547,
        'candidates': [('Edward John Graham', 'Independent Nationalist', 1667), ('P. F. Adams', 'Irish Parliamentary', 1588)]},
    ('by-election', '1916-04-28', 'Ossory'): {'seat': 'Ossory', 'electorate': 4842,
        'candidates': [('John Lalor Fitzpatrick', 'Irish Parliamentary', 2003), ('James J. Aird', 'Irish Parliamentary', 1616)]},
    ('by-election', '1918-04-19', 'Tullamore'): {'seat': 'Tullamore', 'electorate': 4601,
        'candidates': [('Patrick McCartan', 'Sinn Féin', None)], 'cause': 'Death of Edward John Graham'},
}


def key(r):
    return (r['kind'], r.get('date') or r.get('year'), r['constituency'])


def day(s):
    try:
        return datetime.date.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def main():
    write = '--write' in sys.argv
    review = load(os.path.basename(REVIEW))
    boxes = load('wikipedia-irish-constituency-boxes-1832-1922.json')['records']
    ge_cc = {(r['year'], r['constituency']): r for r in load('wikipedia-boxes-crosscheck-1832-1880.json')['records']}
    by_cc = {(r['date'], r['constituency']): r for r in load('wikipedia-byelection-crosscheck-1832-1922.json')['records']}
    report, files, notes_for, problems = collections.Counter(), [], {}, []

    by_url_year = collections.defaultdict(list)
    for b in boxes:
        if b['kind'] == 'general':
            by_url_year[(b['url'], b['year'])].append(b)
    by_boxes = [b for b in boxes if b['kind'] == 'by-election']

    def by_box(name, target, cc):
        """The by-election box for this seat nearest the day (an undated box by its year and
        month), within a year: the lists' and boxes' days are what the review corrects."""
        t = day(target)
        url = (cc or {}).get('article')
        pool = [b for b in by_boxes if (url and b['url'] == url) or exact(b['constituency']) == exact(name)]
        if not pool:
            # The review writes "County Mayo" where the box has "Mayo" (the county seat's article).
            bare = re.sub(r'^county ', '', exact(name))
            pool = [b for b in by_boxes if exact(b['constituency']) == bare]
        scored = []
        for b in pool:
            bd = day(b['date']) or (day(f"{b['year']}-{b.get('month') or 1:02d}-15") if b.get('year') else None)
            if bd and t and abs((bd - t).days) <= 400:
                scored.append((abs((bd - t).days), b))
        scored.sort(key=lambda x: x[0])
        if not scored or (len(scored) > 1 and scored[0][0] == scored[1][0]):
            return None
        return scored[0][1]

    def winners_of(box, seats):
        bold = [c for c in box['candidates'] if c.get('bold')]
        if bold:
            return bold[:seats] if len(bold) > seats else bold
        polled = [c for c in box['candidates'] if c['votes'] is not None]
        return sorted(polled, key=lambda c: -c['votes'])[:seats] if polled else box['candidates'][:seats]

    for r in review:
        k, rec = key(r), r['recommendation']
        checked = (f"held at import ({r['why'].split(':')[0]}); read against Walker's printed page, p. {r['walkerPage']}"
                   + (f"; {CHOICES[k]}" if k in CHOICES else ''))
        if rec == 'drop':
            report['dropped'] += 1
            continue
        if rec == 'import-from-walker':
            w = WALKER_BUILT[k]
            box = {'constituency': w['seat'], 'kind': 'by-election', 'url': None, 'article': None,
                   'electorate': w['electorate'],
                   'candidates': [{'name': n, 'party': p, 'votes': v} for n, p, v in w['candidates']]}
            doc = contest_file(box, r['date'], 1, {'fixes': {}, 'summary': 'built from Walker\'s printed page, '
                                                    f"p. {r['walkerPage']}; Wikipedia has no box for it"},
                               {surname(box['candidates'][0]['name'])})
            doc.pop('source_url', None)
            doc['sources'] = [dict(WALKER)]
            if w.get('cause'):
                doc['cause'] = w['cause']
            files.append((r['date'], box['constituency'], doc, k))
            report['built from Walker'] += 1
            continue
        if r['kind'] == 'general':
            year = r['year']
            cc = ge_cc.get((year, r['constituency']))
            cands = by_url_year.get((cc['article'], year), []) if cc else []
            box = cands[0] if len(cands) == 1 else None
            if not box:
                problems.append((k, 'no single box'))
                continue
            year, poll = GE_REFILE.get(k, (year, None))
            date = GE_DATES[year]
            # The 1865 check kept one winner per seat; the box marks every member returned.
            seats = max(cc['seats'], sum(1 for c in box['candidates'] if c.get('bold')))
        else:
            cc = by_cc.get((r['date'], r['constituency']))
            date = DATE_FIX.get(k, r['date'])
            box = by_box(r['constituency'], date, cc)
            if not box:
                problems.append((k, 'no box found near ' + date))
                continue
            poll = None
            seats = SEATS.get(k) or box.get('seats') or 1
        fixes, electorate = {}, None
        if rec == 'import-with-walker-figures':
            for f in r['figures'] or []:
                if f.get('field') == 'electorate':
                    electorate = f['walker']
                elif f.get('box') is not None:
                    fixes[(surname(f['name']), f['box'])] = {'printed': f['walker']}
        for old, new in NAME_FIX.get(k, []):
            for c in box['candidates']:
                c['name'] = c['name'].replace(old, new)
        win = winners_of(box, seats)
        doc = contest_file(box, date, seats, {'fixes': fixes, 'summary': checked}, {surname(c['name']) for c in win},
                           None)
        # Winners by who they are, not by surname: Mayo 1847 had two Brownes and one was returned.
        won = {i for i, c in enumerate(box['candidates']) if any(c is w for w in win)}
        for row in doc['Constituency']['countGroup']:
            row['Status'] = 'Elected' if row['id'] in won else 'Not elected'
        if electorate:
            doc['Constituency']['countInfo']['Total_Electorate'] = str(electorate)
        if poll:
            doc['pollDate'] = poll
        if cc and r['kind'] == 'by-election' and cc.get('cause'):
            doc['cause'] = cc['cause']
        if k in NOTES:
            doc['note'] = NOTES[k] if not doc.get('note') else doc['note'] + ' ' + NOTES[k]
        files.append((date, box['constituency'], doc, k))
        report[rec] += 1

    existing = {(d, f[:-5]) for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d))
                for f in os.listdir(os.path.join(SRC, d)) if f.endswith('.json')}
    out, seen = [], set()
    for date, seat, doc, k in files:
        name = OVERWRITE.get(k, f'{date}/{slug(seat)}.json')
        d, f = name.split('/')
        if (d, f[:-5]) in seen:
            report['duplicate dropped'] += 1
            continue
        seen.add((d, f[:-5]))
        if (d, f[:-5]) in existing and k not in OVERWRITE:
            report['already on disk, left alone'] += 1
            problems.append((k, f'{name} exists'))
            continue
        out.append((d, f, seat, doc))
    print(json.dumps(dict(report), indent=1))
    for p in problems:
        print('  !', p)
    for d, f, seat, doc in out:
        win = [x['candidateName'] for x in doc['Constituency']['countGroup'] if x['Status'] == 'Elected']
        print(f"  {d}/{f}: {seat}; seats {doc['Constituency']['countInfo']['Number_Of_Seats']}; elected {win}")
    if not write:
        print('dry run; --write to apply')
        return

    by_date = collections.defaultdict(set)
    for d, f, seat, doc in out:
        os.makedirs(os.path.join(SRC, d), exist_ok=True)
        with open(os.path.join(SRC, d, f), 'w', encoding='utf-8') as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        by_date[d].add(seat)
    for name, text in PETITION_NOTES.items():
        path = os.path.join(SRC, *name.split('/'))
        doc = json.load(open(path, encoding='utf-8'))
        if text not in (doc.get('note') or ''):
            doc['note'] = (doc['note'] + ' ' + text) if doc.get('note') else text
            with open(path, 'w', encoding='utf-8') as fh:
                json.dump(doc, fh, indent=2, ensure_ascii=False)
                fh.write('\n')
            report['petition note added'] += 1
    ipath = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections_index.json')
    raw = open(ipath, encoding='utf-8').read()
    index = json.loads(raw)
    body = next(x for x in index['bodies'] if x['slug'] == BODY)
    for d, seats in by_date.items():
        e = next((x for x in body['dates'] if x['date'] == d), None)
        if e is None:
            body['dates'].append({'date': d, 'constituencies': sorted(seats)})
        else:
            e['constituencies'] = sorted(set(e['constituencies']) | seats)
    body['dates'].sort(key=lambda x: x['date'], reverse=True)
    indent = len(re.search(r'\n( +)"bodies"', raw).group(1))
    open(ipath, 'w', encoding='utf-8').write(json.dumps(index, indent=indent, ensure_ascii=False) + ('\n' if raw.endswith('\n') else ''))
    json.dump({'schemaVersion': 1, 'counts': dict(report), 'choices': {' | '.join(map(str, k)): v for k, v in CHOICES.items()},
               'written': [f'{d}/{f}' for d, f, _, _ in out]},
              open(os.path.join(D, 'wikipedia-box-held-applied.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(f"wrote {len(out)} files; {report['petition note added']} petition notes")
    import stamp_wikipedia_person_ids
    stamp_wikipedia_person_ids.main(write=True)


if __name__ == '__main__':
    main()
