#!/usr/bin/env python3
"""Import the 1801-1831 Irish Westminster results read from Walker's pages.

    python scripts/walker/import_walker_1801_1831.py [--write]

Walker is the source (walker-1801-1831-results.json, read off the printed page) and
Wikipedia the check (walker-1801-1831-crosscheck.json). A contest is imported when its
members agree with Wikipedia's list of MPs or list of by-elections, or when DECISIONS below
records, after reading both, that they are the same men under another name or style. The
rest are held and reported in walker-1801-1831-import-report.json.

Each member returned is given the Wikipedia article his listed name links to as
sourcePersonId (wikipedia-member-links-ireland-1801-1831.json), the key the 1832-1922
candidacies carry, so a member who sat either side of 1832 is one person. Defeated
candidates have no such link and are keyed by name. No party is printed before 1832.

The History of Parliament (scripts/hop) is the third reading. Where it agrees it is cited;
it settles contests the Wikipedia check left held (a second source where the lists are
silent; the date where Walker and the lists disagree; the member returned at Athlone in
1830, where Walker prints a double return); it gives the electorate, the cause of a
by-election and the outcome of a petition; it names a member Walker and the lists leave
unidentified, as his Wikipedia article or else his HoP page; and it adds the contests
Walker's scan lacks (the 1810-12 contests on the missing book page, and the by-elections of
August 1831 to 1832). The 1801 "returns" -- members carried over from the Irish Parliament
at the Union -- are not elections and are not added.
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crosscheck_constituency_boxes import exact, surname  # noqa: E402
from crosscheck_walker_1801_1831 import keys, fuzzy, member, plain, seat_keys  # noqa: E402
from import_wikipedia_boxes import BODY, SRC, WALKER, slug  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'hop'))
from hop_overlay import Overlay, cite, titled, forenames, forenames_agree  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
D = os.path.join(ROOT, 'data', 'elections')
# Figures settled by reading Walker's page against the History of Parliament where the two
# disagreed (scripts/hop: hop-vote-review.json): (constituency, date, candidate) -> figure.
VOTE_REVIEW = os.path.join(D, 'hop', 'hop-vote-review.json')
# The first polling day of each general election, from Wikipedia's article on it (the
# same convention as the 1832-1880 dates in import_wikipedia_boxes.py).
GE_DATES = {1802: '1802-07-05', 1806: '1806-10-29', 1807: '1807-05-04', 1812: '1812-10-05', 1818: '1818-06-17',
            1820: '1820-03-06', 1826: '1826-06-07', 1830: '1830-07-29', 1831: '1831-04-28'}

# Contests the check could not settle by itself, decided after reading both sources. Key:
# (kind, year, Walker's constituency). 'import' = same men, the list names them otherwise.
DECISIONS = {
    ('general', 1802, 'Mayo county'): ('import', 'Henry Augustus Dillon is the list\'s Henry Dillon-Lee'),
    ('general', 1812, 'Cork county'): ('import', 'Hon. Richard Hare is the list\'s Viscount Ennismore, his later style'),
    ('general', 1818, 'Cork county'): ('import', 'Hon. Richard Hare is the list\'s Viscount Ennismore, his later style'),
    ('general', 1818, 'Donegal county'): ('import', 'Mountcharles and Mount Charles are one title'),
    ('general', 1820, 'Donegal county'): ('import', 'the list names only the Earl of Mount Charles; Walker gives Hart as well'),
    ('general', 1826, 'Donegal county'): ('import', 'Mountcharles and Mount Charles are one title'),
    ('general', 1830, 'Donegal county'): ('import', 'Mountcharles and Mount Charles are one title'),
    ('general', 1818, 'Wicklow county'): ('import', 'William Hayes Parnell is the list\'s William Parnell-Hayes'),
    ('general', 1820, 'Wicklow county'): ('import', 'William Hayes Parnell is the list\'s William Parnell-Hayes'),
    ('general', 1818, 'Carlow'): ('import', 'Charles Harvey is the list\'s Charles Harvey-Saville-Onley'),
    ('general', 1826, 'Mallow'): ('import', 'Charles Denham Orlando Jephson is the list\'s Sir Denham Jephson-Norreys'),
    ('general', 1830, 'Mallow'): ('import', 'Charles Denham Orlando Jephson is the list\'s Sir Denham Jephson-Norreys'),
    ('general', 1831, 'Mallow'): ('import', 'Charles Denham Orlando Jephson is the list\'s Sir Denham Jephson-Norreys'),
    ('general', 1830, 'Clare county'): ('import', 'The O\'Gorman Mahon is the list\'s James Patrick Mahon'),
    ('general', 1831, 'Dublin city'): ('import', 'the list names the same two members'),
    ('general', 1820, "Queen's County"): ('import', 'the list names one member; Walker gives Parnell as the second'),
    ('general', 1831, 'Kildare county'): ('import', 'Walker prints "Hart"; the member is Sir Josiah William Hort, 2nd Bt, '
                                                    'as the list has him'),
    ('by-election', 1801, 'Kerry county'): ('import', 'the knight of Kerry is the list\'s Maurice FitzGerald'),
    ('by-election', 1827, 'Kerry county'): ('import', 'the knight of Kerry is the list\'s Maurice FitzGerald'),
    ('by-election', 1830, 'Kerry county'): ('import', 'the knight of Kerry is the list\'s Maurice FitzGerald'),
    ('by-election', 1817, 'Wicklow county'): ('import', 'William Hayes Parnell is the list\'s William Parnell Hayes'),
    ('by-election', 1825, 'Donegal county'): ('import', 'Mountcharles and Mount Charles are one title'),
}
NAME_FIXES = {('general', 1831, 'Kildare county', 'Sir Josiah William Hart, bt'): 'Sir Josiah William Hort, bt'}


def display(name):
    return re.sub(r'\s+', ' ', plain(name)).strip()


def apply_hop(doc, hp, hop, seat_id, day, report):
    """What the History of Parliament adds to a contest: the citation, the cause of a
    by-election, the electorate that year, and how a petition ended."""
    doc['sources'].append(cite(hp['hopVolume'], hp['hopUrl']))
    f = hop.franchise_for(seat_id, day)
    if f:
        doc['franchise'] = f[0][:1].upper() + f[0][1:]
        report['franchise from the History of Parliament'] += 1
    returned = [h for h in hp['hop'] if h['returned']]
    cause = next((h['note'] for h in returned if h.get('note') and re.match(r'^(vice|re-elected)\b', h['note'])), None)
    if hp['byElection'] and cause and not doc.get('cause'):
        doc['cause'] = cause[0].upper() + cause[1:] + ' (History of Parliament)'
        report['by-election cause from the History of Parliament'] += 1
    e = hop.electorate_for(seat_id, (day or '')[:4]) if day else None
    if e:
        n, approx, label, _, _ = e
        if approx:
            doc['electorateNote'] = f'{label}: about {n:,} in {day[:4]} (History of Parliament)'
        else:
            doc['Constituency']['countInfo']['Total_Electorate'] = str(n)
            doc['electorateSource'] = f'{label}, {day[:4]} (History of Parliament)'
        report['electorate from the History of Parliament'] += 1
    notes = [doc['note']] if doc.get('note') else []
    for p in hp.get('petitions') or []:
        if not any('petition' in n.lower() for n in notes):
            notes.append(f"On petition {titled(p['seated'])} was seated in place of {p['unseated']}"
                         + (f", {p['date']}" if p.get('date') else '') + ' (History of Parliament).')
            report['petition outcome from the History of Parliament'] += 1
    for o in hp.get('outcomes') or []:
        if not any(o.lower()[:20] in n.lower() for n in notes):
            notes.append(o.rstrip('.') + '.')
    if notes:
        doc['note'] = ' '.join(notes)


def hop_supplies(doc):
    """The facts a contest takes from its HoP page, named on the citation."""
    out = []
    if doc.get('cause'):
        out.append('the cause of the by-election')
    if doc.get('electorateSource'):
        out.append(f"the electorate ({int(doc['Constituency']['countInfo']['Total_Electorate']):,})")
    if doc.get('electorateNote'):
        out.append('the estimated electorate')
    if 'On petition' in (doc.get('note') or ''):
        out.append('the outcome of the petition')
    return out


def main(write=False):
    walker = json.load(open(os.path.join(D, 'walker-1801-1831-results.json'), encoding='utf-8'))['records']
    checks = json.load(open(os.path.join(D, 'walker-1801-1831-crosscheck.json'), encoding='utf-8'))['records']
    links = json.load(open(os.path.join(D, 'wikipedia-member-links-ireland-1801-1831.json'), encoding='utf-8'))['records']
    check_of = {(c['page'], c['kind'], c['year'], c['constituency'], c['date']): c for c in checks}
    general_links = collections.defaultdict(list)
    bye_links = collections.defaultdict(list)
    for r in links:
        if r['kind'] == 'general':
            general_links[(r['election'], exact(r['constituency']))].append(r)
        else:
            bye_links[(r['date'], exact(r['constituency']))].append(r)

    hop = Overlay()
    review = {}
    if os.path.exists(VOTE_REVIEW):
        for v in json.load(open(VOTE_REVIEW, encoding='utf-8')):
            if v.get('recommended') is not None:
                review[(v['constituency'], v['date'], v['candidate'])] = v

    review_rows = collections.defaultdict(list)
    if os.path.exists(VOTE_REVIEW):
        for v in json.load(open(VOTE_REVIEW, encoding='utf-8')):
            review_rows[(v['constituency'], v['date'])].append(v)
    hop_check = {}
    relinked = []
    report, held, files = collections.Counter(), [], []
    hop_used = set()
    for w in walker:
        c = check_of[(w['page'], w['kind'], w['electionYear'], w['constituency'], w['date'])]
        decision = DECISIONS.get((w['kind'], w['electionYear'], w['constituency']))
        hp = hop.pair(w)
        # A HoP contest paired with Walker's confirms it. The 15 the cross-check reports as
        # 'members differ' were each read: 14 are the same men under another name or style
        # (the knight of Kerry is FitzGerald; Viscount Dunlo is Richard Trench), and the
        # 15th is Athlone 1830, where Walker marks nobody returned and HoP says who was.
        nobody = not any(x.get('returned') for x in w['candidates'])
        hop_confirms = bool(hp)
        ok = c['status'] in ('agrees', 'agrees after petition') or (decision and decision[0] == 'import')
        settled_by_hop = False
        if not ok and hop_confirms:
            ok, settled_by_hop = True, True
            report['held contest settled by the History of Parliament'] += 1
        date = GE_DATES.get(w['electionYear']) if w['kind'] == 'general' else w['date']
        if w['kind'] == 'by-election' and hp and len(hp['date']) == 10 and (not date or hp['date'] != date):
            # Walker's day disagreed with the list's, or he printed none: HoP decides, and
            # it is taken only where it matches the list or Walker gave no date at all.
            if not date or hp['date'] == c.get('listDate'):
                date = hp['date']
                report['by-election dated from the History of Parliament'] += 1
        if hp:
            hop_used.add(id(hp))
        if not ok or not date:
            held.append({'kind': w['kind'], 'year': w['electionYear'], 'date': w['date'], 'constituency': w['constituency'],
                         'why': 'no date printed' if ok else c['status'], 'page': w['page'],
                         'listDate': c.get('listDate')})
            report[f"{w['kind']} held"] += 1
            continue
        # Who each member is: the article his name links to on the list that confirmed him.
        # The list seat the check matched; failing that, the one seat the name can only mean.
        seat_names = [exact(c['listSeat'])] if c.get('listSeat') else seat_keys(w['constituency'])[0]
        if w['kind'] == 'general':
            listed = [r for k in seat_names for r in general_links.get((w['electionYear'], k), [])]
        else:
            listed = [r for k in seat_names for r in bye_links.get((c.get('listDate') or w['date'], k), [])]
        if len({r['constituency'] for r in listed}) > 1:
            listed = []
        rows = []
        seat_id = hop.seat(w['constituency'])
        contest_day = w['date'] or date
        supplied = []
        for i, cand in enumerate(w['candidates']):
            name = NAME_FIXES.get((w['kind'], w['electionYear'], w['constituency'], cand['name']), cand['name'])
            person, full = None, display(name)
            if nobody and hp:
                # Walker prints a double return (Athlone 1830); HoP records who sat.
                cand = {**cand, 'returned': any(h['returned'] and (keys(h['name']) & keys(name)) for h in hp['hop'])}
            fix = review.get((hp['constituency'], hp['date'], next((h['name'] for h in hp['hop'] if keys(h['name']) & keys(name)), None))) if hp else None
            # The review row names our figure for the man ('ours'): two Hills at Carrickfergus
            # share a surname, and only the row's own figure is replaced.
            if fix and fix['ours'] == cand.get('votes') and fix['recommended'] != cand.get('votes'):
                cand = {**cand, 'votes': fix['recommended']}
                report['figure corrected against the History of Parliament'] += 1
                supplied.append(f"{display(name)}'s {fix['recommended']:,} votes taken from this page in place of {fix['ours']:,}")
            if cand.get('returned') or name in (w.get('seatedOnPetition') or []):
                hit = [r for r in listed if keys(r['name']) & keys(name)] or \
                      [r for r in listed if fuzzy(keys(r['name']), keys(name))]
                # A surname is not a man where two of the contest's candidates share it: the
                # 1802 list links Rt Hon. John Stewart for Tyrone and not his colleague James
                # Stewart, who must not take his article. With one candidate of the name, the
                # list's man is Walker's even where their forenames differ (Walter Bagenal,
                # whom Walker prints as William).
                namesakes = [x for x in w['candidates'] if keys(x['name']) & keys(name)]
                if len(namesakes) > 1:
                    hit = [r for r in hit if forenames_agree(keys(name) | keys(r['name']), forenames(name), forenames(r['name']))]
                if len(hit) == 1:
                    person = hit[0]['person']
                    # "Rowley re-elected": Walker prints the surname only; the list has the name.
                    if len(full.split()) == 1:
                        full = member(hit[0]['name'])
                    # The list links the wrong man where Wikidata makes its article a
                    # different HoP member from the one who held the seat that day.
                    m = hop.member_for(seat_id, contest_day, name)
                    if hop.contradicts(person, m):
                        relinked.append({'contest': f"{w['constituency']} {contest_day}", 'name': name,
                                         'list': person, 'hop': hop.person_key(m), 'hopPage': m['url']})
                        report['list link replaced by the History of Parliament member'] += 1
                        person = None
            hop_key = None
            if not person and (cand.get('returned') or name in (w.get('seatedOnPetition') or [])):
                # The HoP member who held this seat on this day under this name: his
                # Wikipedia article if Wikidata gives one, else his HoP page. One key for
                # every candidacy of his, so a man the lists do not link is still one person
                # (Charles Harward Butler stood as four before this). Only for a man who won
                # the seat: a defeated candidate is not its member, whatever his surname.
                m = hop.member_for(seat_id, contest_day, name)
                if m:
                    hop_key = hop.person_key(m)
                    report['candidacies identified through the History of Parliament'] += 1
                    if len(full.split()) == 1:
                        full = m['display']
            votes = cand.get('votes')
            # A peer's family name is in brackets: "Viscount Castlereagh (Robert Stewart)".
            inner = re.findall(r'[(]([^)]*)[)]', full)
            parts = (inner[-1] if inner else re.sub(r',.*$', '', full)).split()
            rows.append({
                'Candidate_First_Pref_Votes': f'{votes:,}' if votes is not None else '',
                'Candidate_Id': '', 'Constituency_Number': '', 'Count_Number': '1',
                'Firstname': ' '.join(parts[:-1]), 'Occurred_On_Count': '', 'Party_Colour': '#888888', 'Party_Name': '',
                'Status': 'Elected' if cand.get('returned') else 'Not elected',
                'Surname': parts[-1] if parts else '', 'Total_Votes': f'{votes:,}' if votes is not None else '',
                'Transfers': '0.00', 'candidateName': full, 'id': i,
                **({'unopposed': True} if votes is None else {}),
                **({'sourcePersonId': 'wikipedia:' + person} if person else {}),
                **({'sourcePersonId': hop_key} if hop_key else {}),
            })
        # A contest HoP settles is one the list did not match, so the list's seat is not
        # trusted for it; it takes the seat's name from the contests the list did match.
        seat = w['constituency'] if settled_by_hop else (c.get('listSeat') or w['constituency'])
        if settled_by_hop:
            summary = ('read from Walker\'s printed page; members agree with the History of Parliament'
                       + (' (Wikipedia\'s list ' + {'not on the list of by-elections': 'omits it',
                                                    'no seat on the list of MPs': 'omits the seat',
                                                    'agrees, dates differ': 'gives the same winner, dated as HoP dates it'}
                          .get(c['status'], 'differs') + ')'))
        else:
            summary = ('read from Walker\'s printed page; '
                       + ('members agree with Wikipedia\'s list of MPs' if w['kind'] == 'general'
                          else 'winner agrees with Wikipedia\'s list of by-elections')
                       + (' (after petition)' if c['status'] == 'agrees after petition' else '')
                       + ('; and with the History of Parliament' if hp else ''))
        if decision:
            summary += f'; {decision[1]}'
        doc = {'Constituency': {'countInfo': {
            'Constituency_Name': seat, 'Constituency_Number': '', 'Number_Of_Seats': str(w.get('seats') or 1),
            'Spoiled': '', 'Total_Electorate': '', 'Total_Poll': '', 'Valid_Poll': ''}, 'countGroup': rows},
            'kind': w['kind'],
            'sources': [dict(WALKER)] + ([] if settled_by_hop and not listed else [
                {'title': 'List of MPs elected in the United Kingdom general election'
                 if w['kind'] == 'general' else 'List of United Kingdom by-elections',
                 'publisher': 'Wikipedia', 'url': (listed[0]['list'] if listed else None)}]),
            'checked': summary,
            # No party was printed against a candidate before 1832; the site says so.
            'partyLabels': 'none-recorded'}
        if w.get('dateAsPrinted') and w['kind'] == 'general':
            doc['pollDate'] = w['date']
        if w.get('outcomeFacts'):
            doc['note'] = w['outcomeFacts']
        elif not any(x.get('votes') is not None for x in w['candidates']):
            doc['note'] = 'Returned unopposed.'
        if hp:
            apply_hop(doc, hp, hop, seat_id, contest_day, report)
            # What the citation can claim: the members were compared, and the figures; where
            # HoP prints another figure and Walker's is kept, the citation says so.
            kept = [v for v in review_rows.get((hp['constituency'], hp['date']), [])
                    if v['verdict'] == 'genuine difference' and v['ours'] is not None and v['recommended'] == v['ours']]
            differ = [f"this page gives {titled(v['candidate'])} {', '.join(f'{n:,}' for n in v['hop'])}; Walker's {v['ours']:,} is shown"
                      for v in kept]
            if any(v['recommended'] is None and v['ours'] is not None for v in review_rows.get((hp['constituency'], hp['date']), [])):
                differ.append('figures this page gives otherwise are under review; Walker\'s are shown')
            hop_check[id(doc)] = {'checked': True,
                                  'check': 'members returned read from this page and agreed with ours'
                                           + ('' if differ else '; so did every figure it prints'),
                                  'supplies': supplied + differ + hop_supplies(doc)}
        files.append((date, seat, doc, seat_id, settled_by_hop))
        report[f"{w['kind']} imported"] += 1
        report['members given a Wikipedia person'] += sum(1 for r in rows if r.get('sourcePersonId'))

    # The contests only HoP has: built from its table, named as the imported contests name
    # the seat, and cited to its page alone.
    # The lists name one seat several ways ("Londonderry" is the city in 1802 and the county
    # in 1820): the commonest name not already taken that day.
    names = collections.defaultdict(collections.Counter)
    for date, seat, doc, sid, settled in files:
        if not settled:
            names[sid][seat] += 1
    taken = {(date, slug(seat)) for date, seat, doc, sid, settled in files if not settled}

    def name_for(sid, date):
        free = [n for n, _ in names[sid].most_common() if (date, slug(n)) not in taken]
        return free[0] if free else None
    for i, (date, seat, doc, sid, settled) in enumerate(files):
        if settled and name_for(sid, date):
            seat = name_for(sid, date)
            doc['Constituency']['countInfo']['Constituency_Name'] = seat
            files[i] = (date, seat, doc, sid, settled)
            taken.add((date, slug(seat)))
    files = [f[:3] for f in files]
    for r in hop.additions():
        sid = tuple(r['seat'].split('/'))
        year = int(r['date'][:4])
        general = not r['byElection'] and year in GE_DATES
        date = GE_DATES[year] if general else r['date']
        seat = name_for(sid, date)
        if not seat:
            report['History of Parliament contest with no seat name'] += 1
            print('no seat name:', r['seat'], r['date'])
            continue
        rows = []
        for i, h in enumerate(r['hop']):
            m = hop.member_by_path(h['member']) if h.get('member') else None
            m = m or (hop.member_for(sid, r['date'], h['name']) if h['returned'] else None)
            full = titled(h['name'])
            if m and len(full.split()) <= 2 and full == full.title() and h['name'] == h['name'].upper():
                full = m['display']   # "O'NEILL re-elected": HoP prints the surname only
            if h.get('designation') and not re.match(r'(?i)^bt\.?$', h['designation']):
                full = f"{re.sub(r'^Visct\.', 'Viscount', h['designation'])} ({full})"
            votes = h['votes'][0] if h['votes'] else None
            inner = re.findall(r'[(]([^)]*)[)]', full)
            parts = (inner[-1] if inner else full).split()
            rows.append({
                'Candidate_First_Pref_Votes': f'{votes:,}' if votes is not None else '',
                'Candidate_Id': '', 'Constituency_Number': '', 'Count_Number': '1',
                'Firstname': ' '.join(parts[:-1]), 'Occurred_On_Count': '', 'Party_Colour': '#888888', 'Party_Name': '',
                'Status': 'Elected' if h['returned'] else 'Not elected',
                'Surname': parts[-1] if parts else '', 'Total_Votes': f'{votes:,}' if votes is not None else '',
                'Transfers': '0.00', 'candidateName': full, 'id': i,
                **({'unopposed': True} if votes is None else {}),
                **({'sourcePersonId': hop.person_key(m)} if m else {}),
            })
        doc = {'Constituency': {'countInfo': {
            'Constituency_Name': seat, 'Constituency_Number': '', 'Number_Of_Seats': str(sum(1 for h in r['hop'] if h['returned']) if general else 1),
            'Spoiled': '', 'Total_Electorate': '', 'Total_Poll': '', 'Valid_Poll': ''}, 'countGroup': rows},
            'kind': 'general' if general else 'by-election',
            'sources': [],
            'checked': 'from the History of Parliament; Walker\'s pages as scanned do not print it',
            'partyLabels': 'none-recorded'}
        # A by-election Walker prints but misdates (or leaves undated) and so was held: HoP's
        # day settles it, and Walker's page is cited beside it.
        wh = next((x for x in held if x['kind'] == 'by-election' and not general and hop.seat(x['constituency']) == sid
                   and (x['date'] is None and x['year'] == year
                        or x['date'] and (x['date'][:4] == r['date'][:4] or x['date'][4:] == r['date'][4:]))), None)
        if wh:
            held.remove(wh)
            report['by-election held'] -= 1
            report['held by-election dated by the History of Parliament'] += 1
            doc['sources'].append(dict(WALKER))
            doc['checked'] = (f"read from Walker's printed page, which dates it {wh['date'] or 'not at all'}; "
                              f"dated by the History of Parliament"
                              + (", as Wikipedia's list of by-elections dates it" if wh.get('listDate') == r['date'] else ''))
        if general:
            doc['pollDate'] = r['date']
        if not any(h['votes'] for h in r['hop']):
            doc['note'] = 'Returned unopposed.'
        apply_hop(doc, {**r, 'petitions': r.get('petitions') or [], 'outcomes': r.get('hopNotes') or []},
                  hop, sid, r['date'], report)
        hop_check[id(doc)] = {'checked': False,
                              'check': 'results taken from this page; no second reading to check them against'
                                       if not wh else 'the date taken from this page; Walker prints the result',
                              'supplies': hop_supplies(doc)}
        files.append((date, seat, doc))
        if not wh:
            report['added from the History of Parliament'] += 1

    seen, unique = set(), []
    for date, seat, doc in files:
        k = (date, slug(seat))
        if k in seen:
            report['duplicate seat-date dropped'] += 1
            print('duplicate:', date, seat, doc['checked'][:60])
            continue
        seen.add(k)
        unique.append((date, seat, doc))
    # Files before 1832 are this script's own; --overwrite rewrites them. Nothing later is touched.
    existing = {(d, f[:-5]) for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d))
                and not ('--overwrite' in sys.argv and d < '1832')
                for f in os.listdir(os.path.join(SRC, d)) if f.endswith('.json')}
    report['would overwrite an existing file'] = sum(1 for d, s, _ in unique if (d, slug(s)) in existing)
    json.dump({'schemaVersion': 1, 'counts': dict(report), 'held': held, 'relinkedByHistoryOfParliament': relinked},
              open(os.path.join(D, 'walker-1801-1831-import-report.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(json.dumps(dict(report), indent=1))
    if not write:
        print('dry run; --write to apply')
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
    # The HoP page each contest cites, for build-election-provenance.mjs: the only way a
    # contest file's citation reaches the site.
    cites = []
    for date, seat, doc in unique:
        h = next((x for x in doc['sources'] if x.get('publisher') == 'History of Parliament Trust'), None)
        if h:
            cites.append({'file': f'{BODY}/{date}/{slug(seat)}.json', **h, **hop_check.get(id(doc), {})})
    with open(os.path.join(D, 'hop', 'hop-contest-citations.json'), 'w', encoding='utf-8') as fh:
        json.dump({'schemaVersion': 1, 'source': 'History of Parliament Online: the constituency pages of the '
                   '1790-1820 and 1820-1832 volumes. Facts and citations only; no text is reproduced.',
                   'records': sorted(cites, key=lambda r: r['file'])}, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
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


if __name__ == '__main__':
    main('--write' in sys.argv)
