"""Check parsed Belfast Gazette election notices against Civgraph and draft fix proposals.

Used by extract_election_notices.py; proposals are written in the record shape of
data/elections/corrections/source-checked-fixes.json but never applied.
"""
import collections, datetime, difflib, json, re

import civgraph_elections

STOP = re.compile(r'\b(?:county|of|the|division|parliamentary|constituency|borough|city|and|ward|electoral|area|district|council|'
                  r'urban|rural|in|for|northern ireland)\b')


def clean_ws(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def place_key(s):
    s = civgraph_elections.norm(s)
    s = re.sub(r'\bqueen ?s university( of belfast)?\b|\buniversity of belfast\b', 'queens university', s)
    s = re.sub(r'\bderry\b', 'londonderry', s)
    return clean_ws(STOP.sub(' ', s))


def place_score(a, b):
    ka, kb = place_key(a), place_key(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    sa, sb = set(ka.split()), set(kb.split())
    if sa == sb:
        return 0.98
    if (sb <= sa or sa <= sb) and abs(len(sa) - len(sb)) <= 1:
        return 0.8
    return difflib.SequenceMatcher(None, ka, kb).ratio() * 0.9


TITLES = re.compile(r'\b(?:Sir|Dr|Captain|Capt|Major|Colonel|Col|Lieut|Lieutenant|Field[ -]Marshal|Professor|Prof|Rev|Rt|Hon|Mrs|Mr|Miss|'
                    r'Brigadier|General|Commander|Admiral|Lord|Lady|Viscount|Earl|Dame)\b\.?', re.I)


def person_key(name):
    n = re.sub(r"\bM'(?=[A-Z])|\bMac(?=[A-Z])", 'Mc', name or '')
    return civgraph_elections.norm(TITLES.sub(' ', n))


FAMILIAR = {
    'jack': 'john', 'johnny': 'john', 'tommy': 'thomas', 'tom': 'thomas', 'sam': 'samuel', 'sammy': 'samuel', 'harry': 'henry',
    'bill': 'william', 'billy': 'william', 'will': 'william', 'willie': 'william', 'bob': 'robert', 'bobby': 'robert',
    'jim': 'james', 'jimmy': 'james', 'joe': 'joseph', 'paddy': 'patrick', 'pat': 'patrick', 'dick': 'richard', 'ted': 'edward',
    'ned': 'edward', 'eddie': 'edward', 'frank': 'francis', 'charlie': 'charles', 'gerry': 'gerard', 'mick': 'michael',
    'mickey': 'michael', 'micky': 'michael', 'dan': 'daniel', 'danny': 'daniel', 'alex': 'alexander', 'andy': 'andrew',
    'davy': 'david', 'dave': 'david', 'fred': 'frederick', 'freddie': 'frederick', 'tony': 'anthony', 'hughie': 'hugh',
    'archie': 'archibald', 'seamus': 'james', 'liam': 'william', 'padraig': 'patrick', 'ken': 'kenneth', 'ron': 'ronald',
    'ray': 'raymond', 'bertie': 'albert', 'wully': 'william',
}


def name_relation(gaz, civ):
    """'same' | 'fuller' (Gazette gives more forenames) | 'initials' | 'familiar' (Jack/John) | 'variant' | 'different'."""
    g, c = person_key(gaz).split(), person_key(civ).split()
    if not g or not c:
        return 'different'
    if g == c:
        return 'same'
    sg, sc = g[-1], c[-1]
    if sg != sc and difflib.SequenceMatcher(None, sg, sc).ratio() < 0.7:
        return 'different'
    fg, fc = g[:-1], c[:-1]
    if sg == sc:
        if not fc and fg:
            return 'fuller'
        if not fg:
            return 'initials'
        cover = all(any(x == y or (len(x) == 1 and y.startswith(x)) for y in fg) for x in fc)
        if cover and len(fg) > len(fc):
            return 'fuller'
        if any(FAMILIAR.get(x) in fg for x in fc):
            return 'familiar'
        if fg[0][0] == fc[0][0]:
            return 'initials' if any(len(x) == 1 for x in fg + fc) else 'variant'
        if any(x in fg for x in fc):
            return 'fuller'
        return 'variant'
    return 'variant'  # near-identical surname: OCR or spelling


def contest_date(c):
    try:
        return datetime.date.fromisoformat(c['date'][:10])
    except ValueError:
        return datetime.date(int(c['date'][:4]), 6, 30) if re.match(r'^\d{4}$', c['date']) else None


def match_contest(by_body, body, place, date, before=150, after=21):
    """Best Civgraph contest for a place near a date (notice date minus contest date in [-after, before])."""
    try:
        d = datetime.date.fromisoformat(date)
    except (TypeError, ValueError):
        return None
    bodies = [body] if body else list(by_body)
    best = None
    for b in bodies:
        for c in by_body.get(b, []):
            cd = contest_date(c)
            if cd is None:
                continue
            delta = (d - cd).days
            if delta < -after or delta > before:
                continue
            s = place_score(place, c['name'])
            if c.get('council'):
                s = max(s, place_score(place, c['council'] + ' ' + c['name']))
            if s < 0.75:
                continue
            score = s - abs(delta) / 2000
            if not best or score > best[0]:
                best = (score, c, delta)
    return best


def ref(n):
    return {'issue': n['issue'], 'issue_date': n['issue_date'], 'page': n.get('page'), 'citation': n['citation'], 'url': n['url'],
            'notice_date': n.get('notice_date'), 'confidence': n['confidence'], 'text_layer': n.get('text_layer')}


RANK = ['same', 'fuller', 'initials', 'familiar', 'variant', 'different']


def compare(notices, contests):
    by_body = collections.defaultdict(list)
    for c in contests:
        by_body[c['body']].append(c)
    rows = []
    for n in notices:
        if n['confidence'] == 'low':
            continue
        body = n.get('body')
        if n['type'] == 'return-of-members':
            for m in n.get('members') or []:
                place = m.get('constituency_printed') or ''
                when = n.get('notice_date') or n['issue_date']
                best = match_contest(by_body, body, place, when) if place else None
                row = {'notice': ref(n), 'type': n['type'], 'body': body, 'place_printed': place, 'gazette_name': m.get('name'),
                       'predecessor': m.get('predecessor'), 'vacancy_cause': m.get('vacancy_cause'), 'ocr_flags': m.get('ocr_flags', [])}
                if not best:
                    row['verdict'] = 'gap' if place else 'unplaced'
                    rows.append(row)
                    continue
                score, c, delta = best
                row.update({'civgraph_file': c['file'], 'civgraph_date': c['date'], 'civgraph_place': c['name'], 'days_after_poll': delta,
                            'place_score': round(score, 3)})
                elected = [x for x in c['candidates'] if (x.get('status') or '').lower().startswith('elect')]
                pool = elected + [x for x in c['candidates'] if x not in elected]
                rels = sorted(((name_relation(m.get('name'), x['name']), x) for x in pool), key=lambda r: (RANK.index(r[0]), r[1] not in elected))
                rel, cand = rels[0] if rels else ('different', None)
                if rel != 'different' and cand not in elected:
                    row['civgraph_status'] = cand.get('status') or ''
                    row['returned_but_not_elected_in_civgraph'] = True
                if rel == 'different':
                    cand = None
                row.update({'civgraph_name': cand['name'] if cand else None, 'civgraph_party': cand.get('party') if cand else None,
                            'civgraph_person_id': cand.get('id') if cand else None, 'name_relation': rel,
                            'civgraph_seats': c.get('seats'), 'civgraph_elected': [x['name'] for x in elected]})
                # The predecessor: Civgraph's previous winner for the seat (same body, earlier contest).
                if m.get('predecessor'):
                    prev = [x for x in by_body.get(c['body'], []) if place_score(c['name'], x['name']) >= 0.98 and contest_date(x) and contest_date(x) < contest_date(c)]
                    prev.sort(key=contest_date)
                    if prev:
                        won = [x['name'] for x in prev[-1]['candidates'] if (x.get('status') or '').lower().startswith('elect')]
                        row['civgraph_previous_winners'] = won
                        row['predecessor_relation'] = min((name_relation(m['predecessor'], w) for w in won), key=RANK.index, default='different')
                row['verdict'] = {'same': 'confirms', 'fuller': 'confirms-fuller-name', 'initials': 'confirms-name-form-differs',
                                  'familiar': 'confirms-formal-name',
                                  'variant': 'name-disagrees-ocr-uncertain' if m.get('ocr_flags') or n.get('text_layer') == 'ocr' else 'name-disagrees',
                                  'different': 'member-disagrees'}[rel]
                if row.get('returned_but_not_elected_in_civgraph'):
                    row['verdict'] = 'status-disagrees'
                rows.append(row)
        elif n['type'] in ('statement-of-persons-nominated', 'notice-of-poll', 'declaration-of-result'):
            place = n.get('constituency_printed') or ''
            when = n.get('election_date') or n.get('notice_date') or n['issue_date']
            best = match_contest(by_body, body, place, when, 60, 60) if place else None
            row = {'notice': ref(n), 'type': n['type'], 'body': body, 'place_printed': place,
                   'gazette_candidates': [{k: c.get(k) for k in ('name', 'description', 'votes')} for c in n.get('candidates', [])],
                   'gazette_election_date': n.get('election_date'), 'uncontested': n.get('uncontested', False)}
            if not best:
                row['verdict'] = 'gap' if place else 'unplaced'
                rows.append(row)
                continue
            score, c, delta = best
            row.update({'civgraph_file': c['file'], 'civgraph_date': c['date'], 'civgraph_place': c['name'], 'place_score': round(score, 3)})
            matched, missing, diffs = [], [], []
            for g in n.get('candidates', []):
                hit = next((x for x in c['candidates'] if name_relation(g['name'], x['name']) in ('same', 'fuller', 'initials')), None)
                if not hit:
                    missing.append(g['name'])
                    continue
                matched.append(hit['name'])
                if g.get('votes') is not None and hit.get('votes') is not None and int(hit['votes']) != g['votes']:
                    diffs.append({'name': hit['name'], 'gazette_votes': g['votes'], 'civgraph_votes': hit['votes']})
                if g.get('description') and hit.get('party') and place_key(g['description'])[:5] != place_key(hit['party'])[:5]:
                    diffs.append({'name': hit['name'], 'gazette_description': g['description'], 'civgraph_party': hit['party']})
                if name_relation(g['name'], hit['name']) == 'fuller':
                    diffs.append({'name': hit['name'], 'gazette_full_name': g['name']})
            extra = [x['name'] for x in c['candidates'] if x['name'] not in matched]
            row.update({'matched': matched, 'gazette_only': missing, 'civgraph_only': extra, 'differences': diffs})
            if n.get('election_date') and n['election_date'] != c['date'][:10]:
                row['date_disagrees'] = {'gazette': n['election_date'], 'civgraph': c['date']}
            if n['type'] == 'declaration-of-result' and bool(n.get('uncontested')) != bool(c['unopposed_or_no_figures']):
                row['contest_status_disagrees'] = {'gazette_uncontested': bool(n.get('uncontested')), 'civgraph_no_figures': c['unopposed_or_no_figures']}
            bad = missing or row.get('date_disagrees') or row.get('contest_status_disagrees') or any('gazette_votes' in d or 'gazette_description' in d for d in diffs)
            row['verdict'] = 'disagrees' if bad else 'confirms'
            rows.append(row)
        elif n['type'] in ('writ-or-vacancy', 'casual-vacancy'):
            place = n.get('constituency_printed') or n.get('ward_or_area_printed') or ''
            when = n.get('notice_date') or n['issue_date']
            best = None
            if place:
                try:
                    shifted = (datetime.date.fromisoformat(when) + datetime.timedelta(days=60)).isoformat()
                    best = match_contest(by_body, body, place, shifted, 75, 60)
                except ValueError:
                    pass
            row = {'notice': ref(n), 'type': n['type'], 'body': body, 'place_printed': place, 'predecessor': n.get('predecessor'),
                   'vacancy_cause': n.get('vacancy_cause')}
            if best:
                row.update({'civgraph_file': best[1]['file'], 'civgraph_date': best[1]['date'], 'verdict': 'by-election-present'})
            else:
                row['verdict'] = 'gap' if place else 'unplaced'
            rows.append(row)
    # Civgraph winners the Gazette's return does not list (per notice and contest).
    by_contest = collections.defaultdict(list)
    for r in rows:
        if r['type'] == 'return-of-members' and r.get('civgraph_file'):
            by_contest[(r['notice']['citation'], r['civgraph_file'])].append(r)
    contest_by_file = {c['file']: c for c in contests}
    for (cit, f), rs in by_contest.items():
        c = contest_by_file[f]
        got = [r['gazette_name'] for r in rs]
        for x in c['candidates']:
            if (x.get('status') or '').lower().startswith('elect') and not any(name_relation(g, x['name']) != 'different' for g in got):
                if len(rs) >= 2 or str(c.get('seats')) == '1':
                    rows.append({'notice': rs[0]['notice'], 'type': 'return-of-members', 'body': rs[0]['body'], 'place_printed': rs[0]['place_printed'],
                                 'civgraph_file': f, 'civgraph_date': c['date'], 'civgraph_name': x['name'], 'civgraph_party': x.get('party'),
                                 'gazette_returned': got, 'verdict': 'civgraph-winner-not-returned'})
    # A member the Gazette returns whom the matched contest lacks may sit in another contest of
    # the same election (the place heading misread: 'Londonderry Division' for Mid Londonderry).
    elected_by_election = collections.defaultdict(list)
    for c in contests:
        for x in c['candidates']:
            if (x.get('status') or '').lower().startswith('elect'):
                elected_by_election[(c['body'], c['date'])].append((x, c))
    for r in rows:
        if r.get('verdict') != 'member-disagrees' or not r.get('civgraph_file'):
            continue
        c0 = contest_by_file[r['civgraph_file']]
        hits = [(x, c) for x, c in elected_by_election[(c0['body'], c0['date'])]
                if c['file'] != c0['file'] and name_relation(r['gazette_name'], x['name']) in ('same', 'fuller', 'initials', 'familiar')]
        if len(hits) == 1:
            x, c = hits[0]
            r.update({'verdict': 'confirms-other-seat', 'civgraph_file': c['file'], 'civgraph_place': c['name'], 'civgraph_name': x['name'],
                      'note': f"the place heading reads '{r['place_printed']}'; Civgraph has this member in {c['name']}"})
            rows[:] = [w for w in rows if not (w.get('verdict') == 'civgraph-winner-not-returned' and w['civgraph_file'] == c['file']
                                               and name_relation(r['gazette_name'], w['civgraph_name']) != 'different')]
    # Pair one unmatched Gazette member with one unmatched Civgraph winner in the same contest:
    # the same seat holder under a misread or differently styled name.
    groups = collections.defaultdict(lambda: {'g': [], 'c': []})
    for r in rows:
        if r['type'] == 'return-of-members' and r.get('civgraph_file'):
            if r.get('verdict') == 'member-disagrees':
                groups[(r['notice']['citation'], r['civgraph_file'])]['g'].append(r)
            elif r.get('verdict') == 'civgraph-winner-not-returned':
                groups[(r['notice']['citation'], r['civgraph_file'])]['c'].append(r)
    drop = []
    for key, gc in groups.items():
        if len(gc['g']) == 1 and len(gc['c']) == 1:
            g, w = gc['g'][0], gc['c'][0]
            ocr = bool(g.get('ocr_flags')) or g['notice'].get('text_layer') == 'ocr'
            g.update({'civgraph_name': w['civgraph_name'], 'civgraph_party': w.get('civgraph_party'),
                      'verdict': 'name-disagrees-ocr-uncertain' if ocr else 'name-disagrees', 'paired_with_unreturned_winner': True})
            drop.append(id(w))
    rows[:] = [r for r in rows if id(r) not in drop]
    # A general-election entry whose place could not be matched while its siblings were is a
    # misread heading, not a missing contest.
    matched_notices = {r['notice']['citation'] for r in rows if r.get('civgraph_file')}
    for r in rows:
        if r.get('verdict') == 'gap' and r['type'] == 'return-of-members' and not r.get('predecessor') and r['notice']['citation'] in matched_notices:
            r['verdict'] = 'unmatched-entry'
    # Cross-check within the Gazette: a spelling that differs from Civgraph in one OCR'd notice but
    # agrees in another notice for the same person is an OCR misreading, not a disagreement.
    readings = [(r['gazette_name'], r['notice']['citation']) for r in rows if r['type'] == 'return-of-members' and r.get('gazette_name')]
    for r in rows:
        if r.get('verdict') in ('name-disagrees', 'name-disagrees-ocr-uncertain') and r.get('civgraph_name'):
            other = next(((g, c) for g, c in readings if c != r['notice']['citation'] and name_relation(g, r['civgraph_name']) in ('same', 'fuller')
                          and name_relation(g, r['gazette_name']) in ('variant', 'same', 'fuller', 'initials')), None)
            if other:
                r['verdict'] = 'ocr-variant-resolved'
                r['other_gazette_reading'] = {'name': other[0], 'citation': other[1]}
    return rows


def split_name(name):
    parts = name.split()
    return ' '.join(parts[:-1]), parts[-1] if parts else ''


def proposal_items(r, uncertain):
    """(category, reason sentence, operations) for one cross-check row, or None."""
    v = r['verdict']
    g, c, place = r.get('gazette_name'), r.get('civgraph_name'), r.get('place_printed')
    ocr_note = ' The Gazette text here is an OCR layer; check the page image before applying.' if uncertain else ''
    if v == 'confirms-fuller-name':
        first, sur = split_name(g)
        return ('names', f"the Gazette prints the member returned for {place} as {g} (Civgraph: {c}); the fuller name helps settle "
                         f"person identity.{ocr_note}",
                [{'op': 'candidate', 'name': c, 'set': {'Firstname': first, 'Surname': sur, 'candidateName': g}}])
    if v == 'confirms-formal-name':
        return ('person-identity', f"the Gazette prints {c}'s formal name as {g} ({place}); keep the familiar display name, record the "
                                   f"formal name against the person.{ocr_note}", [])
    if v == 'name-disagrees-ocr-uncertain' and g and c:
        sg, sc = person_key(g).split()[-1:], person_key(c).split()[-1:]
        if sg and sc and difflib.SequenceMatcher(None, sg[0], sc[0]).ratio() >= 0.75:
            return None  # an OCR misreading of the same surname: nothing to propose
    if v in ('name-disagrees', 'name-disagrees-ocr-uncertain'):
        return ('names', f"the Gazette's return for {place} reads {g} where Civgraph has {c}; needs a second source before changing.{ocr_note}", [])
    if v == 'status-disagrees':
        return ('winners', f"the Gazette returns {g} for {place}, whom Civgraph shows as not elected (status '{r.get('civgraph_status', '')}').",
                [{'op': 'candidate', 'name': c, 'set': {'Status': 'Elected'}}])
    if v == 'civgraph-winner-not-returned':
        return ('winners', f"Civgraph shows {c} elected for {place}, but the Gazette's return of members ({', '.join(r['gazette_returned'])}) "
                           f"does not include them.", [{'op': 'candidate', 'name': c, 'set': {'Status': ''}}])
    if v == 'member-disagrees':
        first, sur = split_name(g)
        return ('missing-candidates', f"the Gazette returns {g} for {place}, who is not among Civgraph's candidates "
                                      f"(Civgraph elected: {', '.join(r.get('civgraph_elected') or []) or 'none'}).{ocr_note}",
                [{'op': 'addCandidate', 'row': {'Constituency_Number': '', 'Candidate_Id': 'gazette-' + civgraph_elections.norm(g).replace(' ', '-'),
                                                'Count_Number': '1', 'Firstname': first, 'Surname': sur, 'Candidate_First_Pref_Votes': '',
                                                'Transfers': '', 'Total_Votes': '', 'Status': 'Elected', 'Occurred_On_Count': '',
                                                'Party_Name': '', 'candidateName': g}}])
    if v == 'disagrees':
        ops = [{'op': 'candidate', 'name': d['name'], 'set': {'Candidate_First_Pref_Votes': f"{d['gazette_votes']}.00"}}
               for d in r.get('differences', []) if 'gazette_votes' in d and not uncertain]
        parts = [
            f"candidates not in Civgraph: {', '.join(r['gazette_only'])}" if r.get('gazette_only') else '',
            f"Civgraph candidates not in the notice: {', '.join(r['civgraph_only'])}" if r.get('civgraph_only') else '',
            f"differences: {json.dumps(r['differences'], ensure_ascii=False)}" if r.get('differences') else '',
            f"election date Gazette {r['date_disagrees']['gazette']} vs Civgraph {r['date_disagrees']['civgraph']}" if r.get('date_disagrees') else '',
            f"contest status: {json.dumps(r['contest_status_disagrees'])}" if r.get('contest_status_disagrees') else '',
        ]
        return ('figures' if ops else 'missing-candidates',
                f"Gazette {r['type'].replace('-', ' ')} for {place}: " + '; '.join(p for p in parts if p) + '.' + ocr_note, ops)
    if v == 'gap' and r['type'] == 'return-of-members':
        first, sur = split_name(g or '')
        return ('missing-contest', f"the Gazette records {g} returned for {place} ({r['body'] or 'body unclear'})"
                                   f"{', in the place of ' + r['predecessor'] if r.get('predecessor') else ''}"
                                   f"{' (vacancy: ' + r['vacancy_cause'] + ')' if r.get('vacancy_cause') else ''}, notice dated "
                                   f"{r['notice']['notice_date']}; Civgraph has no contest for the seat in the 150 days before. A return does "
                                   f"not print the poll date: take it from a newspaper or Walker.{ocr_note}",
                [{'op': 'addCandidate', 'row': {'Firstname': first, 'Surname': sur, 'candidateName': g, 'Status': 'Elected'}}])
    if v == 'gap' and r['type'] in ('statement-of-persons-nominated', 'notice-of-poll', 'declaration-of-result'):
        cands = r['gazette_candidates']
        return ('missing-contest', f"the Gazette's {r['type'].replace('-', ' ')} for {place} ({r['body'] or 'body unclear'}) lists "
                                   f"{', '.join(x['name'] for x in cands) or 'no legible candidates'}; Civgraph has no matching contest.{ocr_note}",
                [{'op': 'replaceCandidates', 'candidates': [{'name': x['name'], 'party': x.get('description') or '',
                                                             **({'first_pref': x['votes']} if x.get('votes') is not None else {})} for x in cands]}] if cands else [])
    if v == 'gap' and r['type'] in ('writ-or-vacancy', 'casual-vacancy'):
        return ('missing-contest', f"the Gazette gives notice of a vacancy for {place} ({r['body'] or 'body unclear'})"
                                   f"{' (' + (r['vacancy_cause'] or 'cause unclear') + ' of ' + r['predecessor'] + ')' if r.get('predecessor') else ''}; "
                                   f"Civgraph has no by-election for it within about four months.", [])
    return None


def proposals(rows, accessed):
    """One record per Civgraph file (the corrections file is keyed by sourceFile), or per missing contest."""
    batch = 'belfast-gazette-proposals-' + accessed
    groups = collections.OrderedDict()
    returned_by = collections.defaultdict(set)
    for r in rows:
        if r['type'] == 'return-of-members' and r.get('civgraph_file') and r.get('gazette_name') and not r.get('predecessor'):
            returned_by[(r['civgraph_file'], r['notice']['citation'])].add(person_key(r['gazette_name']))
    for r in rows:
        uncertain = bool(r.get('ocr_flags')) or r['notice']['confidence'] != 'high' or r['notice'].get('text_layer') == 'ocr'
        item = proposal_items(r, uncertain)
        if not item:
            continue
        key = r.get('civgraph_file') or ('missing', r.get('body'), place_key(r.get('place_printed') or ''), r['notice']['citation'])
        groups.setdefault(key, []).append((r, uncertain, item))
    out = []
    order = ['winners', 'missing-candidates', 'figures', 'names', 'person-identity', 'missing-contest']
    for key, items in groups.items():
        cats = sorted({it[2][0] for it in items}, key=order.index)
        cites = list(collections.OrderedDict.fromkeys(it[0]['notice']['citation'] for it in items))
        urls = list(collections.OrderedDict.fromkeys(it[0]['notice']['url'] for it in items))
        note = ' The Gazette text here is an OCR layer; check the page image before applying.'
        reason = ' '.join(s[0].upper() + s[1:] for s in (it[2][1].replace(note, '') for it in items))
        if any(it[1] for it in items):
            reason += note
        # Seat count: a general-election return listing more members than the contest's seats.
        ops = [op for it in items for op in it[2][2]]
        returned = max((returned_by[(key, c)] for c in cites), key=len, default=set()) if isinstance(key, str) else set()
        seats = next((it[0].get('civgraph_seats') for it in items if it[0].get('civgraph_seats')), None)
        if seats and len(returned) > int(seats or 0) and not any(it[0].get('predecessor') for it in items):
            ops.insert(0, {'op': 'set', 'path': 'Constituency.countInfo.Number_Of_Seats', 'value': str(len(returned))})
            reason += f" The Gazette returns {len(returned)} members where Civgraph has {seats} seat(s)."
        rec = {
            'batch': batch, 'proposal': True,
            'sourceFile': key if isinstance(key, str) else None,
            'source': {'title': '; '.join(cites), 'publisher': 'The Belfast Gazette (Crown copyright, Open Government Licence)',
                       'url': urls[0], **({'otherUrls': urls[1:]} if len(urls) > 1 else {}), 'accessed': accessed},
            'category': cats[0], 'categories': cats,
            'ocrUncertain': any(it[1] for it in items),
            'verdicts': sorted({it[0]['verdict'] for it in items}),
            'reason': reason,
            'operations': ops,
        }
        if not isinstance(key, str):
            rec['body'] = key[1]
            rec['place'] = items[0][0].get('place_printed')
        out.append(rec)
    out.sort(key=lambda p: (order.index(p['category']), p['sourceFile'] or ''))
    return out
