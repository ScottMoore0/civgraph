#!/usr/bin/env python3
"""Gallagher's general-election tables, 1922-44: first preferences and counts, checked and
compared with what Civgraph holds. A review deliverable: nothing here touches the site
data, the corrections files or the manifest.

    python scripts/walker/harvest_gallagher_ge.py <path to the PDF>

Writes:
  data/elections/gallagher-general-elections-1922-44.json
      every general-election contest: figures, candidates (party heading as printed, first
      preferences, elected), and where Gallagher prints it the count table (per count: what
      was transferred, each candidate's transfer and running total, non-transferable
      papers). Where he gives only first preferences, or the first few counts, the figures
      his note adds (who was elected on which count with how many votes, the runner-up,
      the order of elimination) are given as fields, never as his text. Each contest
      carries its own arithmetic check.
  data/elections/gallagher-ge-crosscheck.json
      per contest, against the ElectionsIreland-derived Dail files and the count sidecars:
      first-preference disagreements, candidates missing on either side, elected
      disagreements, count totals that differ, and contests where Gallagher has counts and
      Civgraph has none (the 1922 gaps of docs/dail-post-1921-transfer-gap-research.md).

The book is in copyright: only figures are taken (see gallagher.py).
"""
import argparse
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gallagher  # noqa: E402
import harvest_gallagher as hg  # noqa: E402
import pymupdf  # noqa: E402

ROOT = hg.ROOT
EI_DIR = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'dail-eireann')
WIKI_DIR = os.path.join(ROOT, 'data', 'elections', 'dail-wikipedia-counts')
OUT = os.path.join(ROOT, 'data', 'elections', 'gallagher-general-elections-1922-44.json')
XCHECK = os.path.join(ROOT, 'data', 'elections', 'gallagher-ge-crosscheck.json')
SITE_DIR = os.path.join(ROOT, 'render', 'metadata', 'elections-test2')

# Dublin South 1937 (p. 194): the book itself prints Lawlor's and McCabe's counts 3-7 run
# together ("+2134301 + 294330 ..."). Split back into transfer and total; every count then
# balances to zero and Lawlor's carried total (5743 at count 8) agrees.
GARBLED = {
    (1937, None, 'Dublin South'): {
        'Lawlor, Thomas': {3: (213, 4301), 4: (29, 4330), 5: (57, 4387), 6: (1316, 5703), 7: (40, 5743)},
        'McCabe, John': {3: (188, 1827), 4: (20, 1847), 5: (58, 1905), 6: (-1905, None)},
    },
}

# The figures in Gallagher's notes, where he prints only first preferences or the first
# few counts. Surnames as he gives them. elected: votes when elected and the count;
# eliminated: in order, with votes at elimination where he gives them.
NOTE_FACTS = {
    (1922, None, 'Tipperary North, South And Mid'): {
        'elected': [{'surname': 'Moloney', 'count': 2}],
        'unknown': 'distribution of Bourke surplus at count 2'},
    (1923, None, 'Cork North'): {
        'elected': [{'surname': 'Nagle', 'votes': 5224, 'count': 3}, {'surname': 'Vaughan', 'votes': 5206, 'count': 3}],
        'runnerUp': {'surname': 'Neville', 'votes': 4701}},
    (1923, None, 'Galway'): {
        'elected': [{'surname': 'Nicolls', 'votes': 4920, 'count': 15}, {'surname': 'Brodrick', 'votes': 4648, 'count': 19},
                    {'surname': "O’Dea", 'votes': 4338, 'count': 19}, {'surname': "O’Connell", 'votes': 4039, 'count': 19},
                    {'surname': 'Cosgrave', 'votes': 3495, 'count': 19}],
        'runnerUp': {'surname': 'O Gaora', 'votes': 3340}, 'numCounts': 19},
    (1923, None, 'Limerick'): {
        'validVotesProbablyCorrect': 50810,
        'elected': [{'surname': 'Hayes', 'votes': 10498, 'count': 1}, {'surname': 'Leddin', 'votes': 8256, 'count': 2},
                    {'surname': 'Carroll', 'votes': 6451, 'count': 8}, {'surname': 'Colbert', 'votes': 7081, 'count': 12},
                    {'surname': 'Nolan', 'votes': 7361, 'votesAlternative': 7631, 'count': 16},
                    {'surname': 'Hogan', 'votes': 5932, 'count': 17}, {'surname': 'Clancy', 'votes': 5360, 'count': 17}],
        'runnerUp': {'surname': 'Murphy', 'votes': 4774, 'count': 17}, 'numCounts': 17,
        'eliminated': [{'surname': s, 'votes': v} for s, v in [
            ('Mackey', 143), ('Larkin', 509), ("J. O’Brien", 766), ('Cleary', 996), ("O’Callaghan", 1159),
            ("W. O’Brien", 1273), ('Walshe', 1706), ('Laffin', 2197), ('Colivet', 2249), ('Quaide', 2468),
            ('Keyes', 2808), ('Smyth', 3509)]]},
    (1923, None, 'Longford-Westmeath'): {
        # the table's first preferences are these scaled by 35,408 / 34,845
        'firstPreferencesAsFirstReported': {
            'Byrne': 5299, 'Gavin': 1150, 'Killane': 2757, 'Victory': 1634, 'Carrigy': 708, 'McGuinness': 3454,
            'Shaw': 5147, 'Redmond': 1285, 'Wilson': 1590, 'Garahan': 1991, 'Groarke': 877, 'McKenna': 3274,
            'Phillips': 1091, 'Lyons': 4452, "O’Farrell": 136},
        'validVotesAsFirstReported': 34845, 'quotaAsFirstReported': 5808, 'firstPreferencesScaled': True,
        'elected': [{'surname': 'Byrne', 'votes': 6152, 'count': 6}, {'surname': 'Shaw', 'votes': 5891, 'count': 10},
                    {'surname': 'Lyons', 'votes': 5793, 'count': 10}, {'surname': 'Killane', 'votes': 5569, 'count': 10},
                    {'surname': 'McKenna', 'votes': 5434, 'count': 10}],
        'runnerUp': {'surname': 'McGuinness', 'votes': 5249, 'count': 10}, 'numCounts': 10,
        'eliminated': [{'surname': s, 'votes': v} for s, v in [
            ("O’Farrell", 138), ('Carrigy', 735), ('Groarke', 924), ('Phillips', 1203), ('Gavin', 1244),
            ('Redmond', 1396), ('Victory', 1851), ('Wilson', 2689), ('Garahan', 2793)]]},
    (1927, 'June', 'Dublin County'): {
        'elected': [{'surname': 'Good', 'votes': 8152, 'count': 15}, {'surname': 'Johnson', 'votes': 7983, 'count': 15},
                    {'surname': 'MacEntee', 'votes': 9370, 'count': 18}, {'surname': "O’Connor", 'votes': 6505, 'count': 18}],
        'runnerUp': {'surname': 'Curran', 'votes': 4505, 'count': 18}, 'numCounts': 18,
        'lostDeposit': ['Tench', 'Morris', 'Byrne', 'Brennan', 'Guinness', 'McCabe', 'Rooney', 'Lynn']},
    (1932, None, 'Limerick'): {'unknown': 'counts after the sixth'},
    (1932, None, 'Roscommon'): {
        'counts': [{'count': 5, 'source': 'MacDermot', 'kind': 'surplus', 'transferred': 418, 'detail': 'unknown'},
                   {'count': 6, 'source': "O’Dowd", 'kind': 'votes'}],
        'totalsAtCount': [{'surname': "O’Rourke", 'votes': 10289, 'count': 6}, {'surname': 'Boland', 'votes': 9237, 'count': 6}],
        'runnerUp': {'surname': "O’Dowd"}, 'numCounts': 6},
    (1938, None, 'Mayo North'): {'unknown': "split of Lindsay's votes at count 4 between Jordan and non-transferable"},
    (1943, None, 'Clare'): {'unknown': 'separate figures for the successive eliminations of Hughes, Seán Hogan and Halpin (counts 3-5)'},
    (1943, None, 'Cork Borough'): {'unknown': 'transfers to Anthony at counts 5 and 6 separately'},
    (1943, None, 'Wicklow'): {'unknown': 'separate figures for counts 2 and 3'},
    (1943, None, 'Dublin North-East'): {
        'counts': [{'count': 2, 'source': 'Traynor, Byrne', 'kind': 'surplus'}, {'count': 4, 'source': 'Bell', 'kind': 'votes', 'transferred': 631},
                   {'count': 5, 'source': 'Colley', 'kind': 'votes', 'transferred': 5835}],
        'elected': [{'surname': 'Larkin', 'votes': 8568, 'count': 5}],
        'runnerUp': {'surname': 'Mulcahy', 'votes': 7813, 'count': 5}, 'nonTransferableFinal': 3123, 'numCounts': 5},
    (1943, None, 'Dublin North-West'): {
        'eliminated': [{'surname': 'Love', 'votes': 604, 'count': 3}, {'surname': 'Murray', 'votes': 648, 'count': 4},
                       {'surname': 'Cunningham', 'votes': 673, 'count': 5}, {'surname': 'Staines', 'votes': 807, 'count': 6},
                       {'surname': 'Sheppard', 'votes': 1548, 'count': 7}, {'surname': 'Keogh', 'count': 8},
                       {'surname': 'Macken', 'count': 9}, {'surname': 'Davin', 'count': 10}],
        'elected': [{'surname': 'Byrne', 'votes': 7821, 'count': 8}, {'surname': 'Breathnach', 'votes': 7942, 'count': 11},
                    {'surname': "O’Sullivan", 'votes': 7833, 'count': 12}, {'surname': 'McGilligan', 'votes': 7479, 'count': 12}],
        'runnerUp': {'surname': "O’Connor"}, 'numCounts': 12, 'depositThreshold': 2598},
    (1943, None, 'Dublin South'): {
        'elected': [{'surname': 'Doyle', 'votes': 7078, 'count': 10}, {'surname': 'McCann', 'votes': 7180, 'count': 11},
                    {'surname': 'Lynch', 'votes': 6683, 'count': 11}, {'surname': 'Briscoe', 'votes': 6678, 'count': 13},
                    {'surname': 'Dockrell', 'votes': 6887, 'count': 14}, {'surname': 'Larkin', 'votes': 5606, 'count': 16}],
        'runnerUp': {'surname': 'Beirne', 'votes': 5360, 'count': 16}, 'numCounts': 16, 'depositThreshold': 2214},
    (1943, None, 'Dublin Townships'): {
        'counts': [{'count': 2, 'source': 'MacEntee', 'kind': 'surplus'}, {'count': 3, 'source': 'Browne', 'kind': 'votes'},
                   {'count': 4, 'source': 'Cawley', 'kind': 'votes'}],
        'elected': [{'surname': 'Benson', 'votes': 9807, 'count': 4}, {'surname': 'Butler', 'votes': 9000, 'count': 4}],
        'runnerUp': {'surname': 'Costello', 'votes': 8794, 'count': 4}, 'numCounts': 4},
    (1943, None, 'Dublin County'): {
        'elected': [{'surname': 'Cosgrave', 'votes': 11392, 'count': 5}, {'surname': 'Dockrell', 'votes': 12496, 'count': 15},
                    {'surname': 'Tunney', 'votes': 9306, 'count': 15}],
        'runnerUp': {'surname': "O’Rourke", 'votes': 8777, 'count': 15}, 'numCounts': 15, 'depositThreshold': 3741},
    (1943, None, 'Mayo North'): {
        'eliminated': [{'surname': 'McCormick', 'votes': 2671, 'count': 4}, {'surname': 'Hardy', 'votes': 3577, 'count': 5}],
        'counts': [{'count': 6, 'source': 'Ruttledge', 'kind': 'surplus', 'transferred': 963}],
        'elected': [{'surname': 'Ruttledge', 'votes': 7125, 'count': 5}, {'surname': 'Kilroy', 'votes': 6408, 'count': 6},
                    {'surname': 'Browne', 'votes': 6057, 'count': 6}],
        'runnerUp': {'surname': "O’Hara", 'votes': 5070, 'count': 6}, 'numCounts': 6},
    (1944, None, 'Dublin North-West'): {
        'elected': [{'surname': 'Breathnach', 'votes': 7217, 'count': 4}, {'surname': "O’Sullivan", 'votes': 8388, 'count': 7},
                    {'surname': 'McGilligan', 'votes': 7268, 'count': 8}, {'surname': "O’Connor", 'votes': 6853, 'count': 10}],
        'runnerUp': {'surname': 'Byrne'}, 'numCounts': 10, 'depositThreshold': 2375},
    (1944, None, 'Dublin South'): {
        'elected': [{'surname': 'Lynch', 'votes': 6332, 'count': 3}, {'surname': 'Doyle', 'votes': 6565, 'count': 7},
                    {'surname': 'Larkin', 'votes': 6658, 'count': 9}, {'surname': 'Dockrell', 'votes': 6051, 'count': 9},
                    {'surname': 'Briscoe', 'votes': 6029, 'count': 9}],
        'runnerUp': {'surname': 'Clarkin', 'votes': 5238, 'count': 9}, 'numCounts': 9, 'depositThreshold': 2050},
    (1944, None, 'Dublin County'): {
        'elected': [{'surname': 'Fogarty', 'votes': 10905, 'count': 8}, {'surname': 'Burke', 'votes': 11049, 'count': 10},
                    {'surname': 'Dockrell', 'votes': 10698, 'count': 10}], 'numCounts': 10},
    (1944, None, 'Dublin Townships'): {'unknown': 'separate figures for the MacEntee and Costello surpluses (counts 2 and 3)'},
    (1944, None, 'Wicklow'): {'unknown': 'separate figures for the Cogan and Everett surpluses'},
}

# The post-1921 rows docs/dail-post-1921-transfer-gap-research.md (2026-06-08) listed as
# lacking a count table, for 1922-44, by its own row names.
DOCUMENTED_GAPS = {
    '1922-06-16': ['Tipperary Mid, North & South', 'Cork East & North East', 'Cork Mid, North, South, South East & West',
                   'Leix Offaly', 'Clare', 'Donegal', 'Dublin University', 'Limerick City and East', 'Mayo North & West',
                   'Kerry Limerick West', 'Leitrim Roscommon North', 'Mayo South Roscommon South', 'National University',
                   'Sligo Mayo East', 'Waterford Tipperary East'],
    '1923-08-27': ['Leix Offaly', 'Dublin University', 'National University'],
    '1927-06-09': ['Leix Offaly', 'Dublin University', 'National University'],
    '1927-09-15': ['Leix Offaly', 'Dublin University', 'National University'],
    '1932-02-16': ['Leix Offaly', 'Dublin University', 'National University'],
    '1933-01-24': ['Leix Offaly', 'Dublin University', 'National University'],
    '1937-07-01': ['Leix Offaly'], '1938-06-17': ['Leix Offaly', 'Donegal West', 'Kerry South'],
    '1943-06-22': ['Leix Offaly'], '1944-05-30': ['Leix Offaly', 'Monaghan', 'Donegal West'],
}


def ascii_key(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z]', '', s)


def surname_key(s):
    """Surname for matching: "O’Higgins" / "O'Higgins" / "Ó hUiginn" are not reconciled,
    but apostrophes, accents and Mac/Mc are."""
    k = ascii_key(s)
    return re.sub(r'^mac', 'mc', k)


def fix_garbled(rec):
    fix = GARBLED.get((rec['year'], rec['month'], rec['constituency']))
    if not fix:
        return
    nums = rec['countNumbers']
    for c in rec['candidateList']:
        rows = fix.get(c['nameAsPrinted'])
        if not rows:
            continue
        for n, (tr, tot) in rows.items():
            i = nums.index(n)
            c['transfers'][i], c['printedTotals'][i] = tr, tot
        run = [c['firstPreferences']]
        for i in range(1, len(nums)):
            t, tr = c['printedTotals'][i], c['transfers'][i]
            run.append(t if t is not None else (run[-1] or 0) + (tr or 0))
        c['runningTotals'] = run
        c['figuresReconstructed'] = sorted(rows)


def apply_notes(rec):
    facts = NOTE_FACTS.get((rec['year'], rec['month'], rec['constituency']))
    if not facts:
        return
    rec['noteFacts'] = facts
    by = {surname_key(c['nameAsPrinted'].split(',')[0]): c for c in rec['candidateList']}
    for e in facts.get('elected', []):
        c = by.get(surname_key(e['surname']))
        if c is not None:
            if not c['elected']:
                c['elected'], c['electedFrom'] = True, 'note'
            if not c.get('electedAtCount'):
                c['electedAtCount'] = e.get('count')


def validate(rec):
    """The contest's own arithmetic. Issues are strings; [] means it balances."""
    issues = []
    cands = rec['candidateList']
    polled = [c for c in cands if not c.get('returnedAutomatically') and not c.get('unopposed')]
    if rec.get('candidates') and len(cands) != rec['candidates']:
        issues.append(f"{len(cands)} candidates read, {rec['candidates']} printed")
    elected = sum(1 for c in cands if c['elected'])
    if elected != rec.get('seats'):
        issues.append(f"{elected} elected for {rec.get('seats')} seats")
    if rec['shape'] == 'unopposed':
        return issues
    fps = [c['firstPreferences'] for c in polled]
    if None in fps:
        issues.append('a first preference not read')
    elif sum(fps) != rec.get('validVotes'):
        issues.append(f"first preferences sum to {sum(fps)}, valid poll {rec.get('validVotes')} ({sum(fps) - rec['validVotes']:+d})")
    nums = rec.get('countNumbers', [1])
    carry = 0
    for i, cnt in enumerate(rec.get('counts', []), start=1):
        n = nums[i]
        run = [c['runningTotals'][i] for c in polled]
        nt = cnt['nonTransferableRunning']
        if None in run or nt is None:
            # transfers given over two counts: the intermediate totals are unknown; the
            # balance is checked over both counts below
            trs = [c['transfers'][i] for c in polled if c['transfers'][i] is not None]
            ntt = (cnt.get('nonTransferable') or {}).get('transfer')
            spans = [c['transferOverTwoCounts'][n] for c in polled if n in (c.get('transferOverTwoCounts') or {})]
            nts = (cnt.get('nonTransferable') or {}).get('transferOverTwoCounts')
            carry += sum(trs) + (ntt or 0) + sum(spans) + (nts or 0)
            continue
        total = sum(run) + nt
        if abs(total - rec['validVotes']) > 2:
            issues.append(f"count {n}: totals + non-transferable = {total} ({total - rec['validVotes']:+d})")
        trs = [c['transfers'][i] for c in polled if c['transfers'][i] is not None]
        ntt = (cnt.get('nonTransferable') or {}).get('transfer')
        # transfers given over two counts are checked with the next count
        spans = [c['transferOverTwoCounts'][n] for c in polled if n in (c.get('transferOverTwoCounts') or {})]
        nts = (cnt.get('nonTransferable') or {}).get('transferOverTwoCounts')
        bal = carry + sum(trs) + (ntt or 0) + sum(spans) + (nts or 0)
        if spans or nts is not None:
            carry = bal
        else:
            carry = 0
            if bal:
                issues.append(f"count {n}: transfers do not balance ({bal:+d})")
        for c in polled:
            pt, tr, prev = c['printedTotals'][i], c['transfers'][i], c['runningTotals'][i - 1]
            if pt is not None and tr is not None and prev is not None and prev + tr != pt:
                issues.append(f"count {n}: {c['nameAsPrinted']} {prev}{tr:+d} printed as {pt}")
    for c in polled:
        for k, v in c.get('carried', {}).items():
            i = nums.index(int(k))
            if c['runningTotals'][i] != v:
                issues.append(f"{c['nameAsPrinted']}: carried {v} into the continued table, count {k} total {c['runningTotals'][i]}")
    return issues


def tidy(rec, date):
    out = {'date': date, 'year': rec['year'], 'constituency': rec['constituency'], 'page': rec['page']}
    for k in ('electorate', 'validVotes', 'turnout', 'quota', 'seats', 'contestedSeats'):
        if rec.get(k) is not None:
            out[k] = rec[k]
    out['candidatesPrinted'] = rec.get('candidates')
    out['shape'] = rec['shape']
    if rec['shape'] in ('counts', 'partialCounts'):
        out['countNumbers'] = rec['countNumbers']
        out['counts'] = [{k: v for k, v in c.items() if v is not None or k in ('source', 'kind')} for c in rec['counts']]
    cands = []
    for c in rec['candidateList']:
        d = {'name': c['name'], 'nameAsPrinted': c['nameAsPrinted'], 'outgoing': c['outgoing'], 'party': c['party']}
        if c.get('partyNote'):
            d['partyNote'] = c['partyNote']
        d['firstPreferences'] = c['firstPreferences']
        d['elected'] = c['elected']
        for k in ('electedAtCount', 'electedFrom', 'unopposed', 'returnedAutomatically', 'figuresReconstructed'):
            if c.get(k):
                d[k] = c[k]
        if rec['shape'] in ('counts', 'partialCounts') and 'transfers' in c:
            d['transfers'] = c['transfers']
            d['printedTotals'] = c['printedTotals']
            d['runningTotals'] = c['runningTotals']
            if c.get('transferOverTwoCounts'):
                d['transferOverTwoCounts'] = c['transferOverTwoCounts']
        cands.append(d)
    out['candidates'] = cands
    if rec.get('noteFacts'):
        out['noteFacts'] = rec['noteFacts']
    return out


# --- cross-check -------------------------------------------------------------------------

def load_dir(path, skip=('_index.json',)):
    out = {}
    if not os.path.isdir(path):
        return out
    for f in sorted(os.listdir(path)):
        if not f.endswith('.json') or f in skip:
            continue
        d = json.load(open(os.path.join(path, f), encoding='utf-8'))
        if isinstance(d, dict) and d.get('candidates') is not None:
            out[hg.key(d.get('constituency') or f[:-5])] = (f, d)
    return out


def match(gcands, others, name_of, fp_of):
    """Pair Gallagher's candidates with another source's: first an identical first
    preference with the same forename and surname initials (so Burke/Bourke namesakes
    spelt the other way round pair by their votes), then surname (forename initial, then
    nearest first preference, to split namesakes), then first preferences alone for what
    is left (Irish/English name forms)."""
    pairs, used = {}, set()
    for i, g in enumerate(gcands):
        if g['firstPreferences'] is None:
            continue
        sk = surname_key(g['nameAsPrinted'].split(',')[0])
        opts = [j for j, o in enumerate(others) if j not in used and fp_of(o) == g['firstPreferences']
                and ascii_key(name_of(o).split()[-1])[:1] == sk[:1]
                and ascii_key(g['name'])[:1] in [ascii_key(w)[:1] for w in name_of(o).split()[:-1]]]
        if len(opts) == 1:
            pairs[i] = opts[0]
            used.add(opts[0])
    for i, g in enumerate(gcands):
        if i in pairs:
            continue
        sk = surname_key(g['nameAsPrinted'].split(',')[0].split('(')[0])
        fi = ascii_key(g['name'])[:1]
        opts = [j for j, o in enumerate(others) if j not in used and surname_key(name_of(o).split()[-1]) == sk]
        if not opts:
            opts = [j for j, o in enumerate(others) if j not in used and sk and sk in ascii_key(name_of(o))]
        if len(opts) > 1:
            byf = [j for j in opts if fi and any(ascii_key(w)[:1] == fi for w in name_of(others[j]).split()[:-1])]
            opts = byf or opts
            if len(opts) > 1 and g['firstPreferences'] is not None:
                opts.sort(key=lambda j: abs((fp_of(others[j]) or 0) - g['firstPreferences']))
        if opts:
            pairs[i] = opts[0]
            used.add(opts[0])
    for i, g in enumerate(gcands):
        # spelling variants: Walshe/Walsh, Leddin/Ledden (same forename initial, surname prefix)
        if i in pairs:
            continue
        sk = surname_key(g['nameAsPrinted'].split(',')[0].split('(')[0])
        fi = ascii_key(g['name'])[:1]
        opts = [j for j, o in enumerate(others) if j not in used and len(sk) >= 4
                and surname_key(name_of(o).split()[-1])[:4] == sk[:4]
                and fi in [ascii_key(w)[:1] for w in name_of(o).split()[:-1]]]
        if len(opts) == 1:
            pairs[i] = opts[0]
            used.add(opts[0])
    for i, g in enumerate(gcands):
        if i in pairs or g['firstPreferences'] is None:
            continue
        opts = [j for j, o in enumerate(others) if j not in used and fp_of(o) is not None
                and abs(fp_of(o) - g['firstPreferences']) <= max(3, g['firstPreferences'] * 0.01)]
        if len(opts) == 1:
            pairs[i] = opts[0]
            used.add(opts[0])
    return pairs, used


def compare_candidates(g, polled, others, name_of, fp_of, elected_of):
    pairs, used = match(polled, others, name_of, fp_of)
    fpd, eld, nd = [], [], []
    for i, j in pairs.items():
        gc, o = polled[i], others[j]
        gs = surname_key(gc['nameAsPrinted'].split(',')[0].split('(')[0])
        if gs != surname_key(name_of(o).split()[-1]) and gs not in ascii_key(name_of(o)):
            nd.append({'gallagher': gc['nameAsPrinted'], 'civgraph': name_of(o)})
        ofp = fp_of(o)
        if gc['firstPreferences'] is not None and ofp not in (None, 0) and gc['firstPreferences'] != ofp:
            fpd.append({'gallagher': gc['name'], 'civgraph': name_of(o), 'gallagherFirstPreferences': gc['firstPreferences'],
                        'civgraphFirstPreferences': ofp, 'difference': ofp - gc['firstPreferences']})
        if g['shape'] != 'unopposed' and bool(elected_of(o)) != gc['elected']:
            eld.append({'gallagher': gc['name'], 'civgraph': name_of(o), 'gallagherElected': gc['elected'],
                        'civgraphElected': bool(elected_of(o))})
    out = {'firstPreferenceDisagreements': fpd,
           'missingInCivgraph': [polled[i]['name'] for i in range(len(polled)) if i not in pairs],
           'notInGallagher': [name_of(o) for j, o in enumerate(others) if j not in used],
           'electedDisagreements': eld, 'surnameSpellings': nd}
    if g['shape'] == 'unopposed':
        out.pop('firstPreferenceDisagreements')
    return out, pairs


def compare_totals(g, polled, pairs, others, totals_of):
    """Gallagher's running totals against another source's, count by count. A total
    Gallagher leaves blank (surplus or elimination just transferred) is not compared."""
    diffs, compared = [], 0
    nums = g['countNumbers']
    for i, j in pairs.items():
        gc, theirs = polled[i], totals_of(others[j])
        if 'runningTotals' not in gc:
            continue
        for idx, n in enumerate(nums):
            tv = theirs.get(n)
            gv = gc['runningTotals'][idx]
            if tv is None or gv is None:
                continue
            if gc['printedTotals'][idx] is None and idx > 0 and gc['transfers'][idx] is not None:
                continue
            compared += 1
            if tv != gv:
                diffs.append({'candidate': gc['name'], 'count': n, 'gallagher': gv, 'civgraph': tv})
    return {'cellsCompared': compared, 'cellsDiffering': len(diffs), 'differences': diffs[:25]}


def ei_elected(o):
    return (len(o.get('counts') or []) > 3 and (o['counts'][3] or 0) > 0) or o.get('status') in ('Elected', 'Made Quota')


def crosscheck(records):
    ei_by_date, wiki_by_date, site_by_date = {}, {}, {}
    no_transfer = json.load(open(os.path.join(WIKI_DIR, '_no-transfer.json'), encoding='utf-8'))['records']
    nt_keys = {(r.get('date'), hg.key(r.get('constituency'))) for r in no_transfer}
    gap_keys = {(d, hg.key(n)) for d, ns in DOCUMENTED_GAPS.items() for n in ns}
    out = []
    for g in records:
        date = g['date']
        if date not in ei_by_date:
            ei_by_date[date] = load_dir(os.path.join(EI_DIR, date))
            wiki_by_date[date] = load_dir(os.path.join(WIKI_DIR, date))
            built = json.load(open(os.path.join(SITE_DIR, f'dail-eireann__{date}.json'), encoding='utf-8'))
            site_by_date[date] = {hg.key(r['constituency']): r for r in built['results']}
        k = hg.key(g['constituency'])
        ei, wiki, site = ei_by_date[date].get(k), wiki_by_date[date].get(k), site_by_date[date].get(k)
        polled = g['candidates']
        has_counts = g['shape'] in ('counts', 'partialCounts') and len(g.get('countNumbers', [])) > 1
        row = {'date': date, 'constituency': g['constituency'], 'page': g['page'], 'gallagherShape': g['shape'],
               'gallagherNumCounts': (g.get('countNumbers') or [1])[-1]}
        # what the site shows (built Dail metadata: source file plus corrections and overlays)
        if site:
            cmp, pairs = compare_candidates(g, polled, site['candidates'], lambda o: o['name'],
                                            lambda o: o.get('firstPrefs'), lambda o: o.get('elected'))
            # count detail that only repeats each first preference is a placeholder
            moving = any(k.get('total') not in (None, c.get('firstPrefs')) for c in site['candidates'] for k in c.get('counts') or [])
            row['site'] = {'constituency': site['constituency'], 'sourceFile': site.get('sourceFile'),
                           'hasCountDetail': bool(site.get('hasCountDetail')), 'countDetailHasTransfers': moving,
                           'countNumbers': site.get('countNumbers'), **cmp}
            if has_counts and site.get('hasCountDetail') and moving:
                row['site']['counts'] = compare_totals(
                    g, polled, pairs, site['candidates'],
                    lambda o: {c['count']: c.get('total') for c in o.get('counts') or []})
        else:
            row['site'] = None
        # the ElectionsIreland-derived source file (many later files carry names only)
        if ei and ei[1]['candidates']:
            f, d = ei
            cmp, _ = compare_candidates(g, polled, d['candidates'], lambda o: o['name'], lambda o: o.get('first_pref'), ei_elected)
            row['ei'] = {'file': f'data/elections-source/data/elections/dail-eireann/{date}/{f}', **cmp}
        else:
            row['ei'] = {'file': f'data/elections-source/data/elections/dail-eireann/{date}/{ei[0]}', 'candidateFigures': False} if ei else None
        # count sidecar (Wikipedia; Gallagher-derived for by-elections)
        if wiki:
            f, w = wiki
            row['countSidecar'] = {'file': f'data/elections/dail-wikipedia-counts/{date}/{f}', 'source': w.get('source'),
                                   'numCounts': w.get('numCounts')}
            if has_counts:
                pairs, _ = match(polled, w['candidates'], lambda o: o['name'], lambda o: (o.get('counts') or [None])[0])
                row['countSidecar'].update(compare_totals(
                    g, polled, pairs, w['candidates'],
                    lambda o: {n + 1: v for n, v in enumerate(o.get('counts') or []) if v is not None}))
                row['countSidecar']['numCountsAgree'] = w.get('numCounts') == g['countNumbers'][-1]
        else:
            row['countSidecar'] = None
        row['noTransferRecord'] = (date, k) in nt_keys
        row['documentedGap'] = (date, k) in gap_keys
        row['gallagherHasCounts'] = has_counts
        civ_counts = bool(wiki) or bool(site and site.get('hasCountDetail') and row['site']['countDetailHasTransfers'])
        row['civgraphHasCounts'] = civ_counts
        row['gallagherClosesCountGap'] = has_counts and not civ_counts
        out.append(row)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    args = ap.parse_args()
    doc = pymupdf.open(args.pdf)
    raw = gallagher.general_election_results(doc)
    records, failing = [], []
    for rec in raw:
        date = hg.GE_DATES[(rec['year'], rec['month'])]
        fix_garbled(rec)
        apply_notes(rec)
        t = tidy(rec, date)
        t['validation'] = validate(rec)
        if t['validation']:
            failing.append(f"{date} {rec['constituency']}: " + '; '.join(t['validation']))
        records.append(t)
    shapes = {}
    for r in records:
        shapes[r['shape']] = shapes.get(r['shape'], 0) + 1
    doc_out = {
        'schemaVersion': 1,
        'description': 'Every 1922-44 Dail general-election contest from Gallagher: first preferences, and the count '
                       'tables where printed. Figures only. Arrays per candidate (transfers, printedTotals, '
                       'runningTotals) are indexed like countNumbers; printedTotals is null where Gallagher leaves '
                       'the total blank, and runningTotals then carries the previous total plus the transfer.',
        'provenance': {'method': 'scripts/walker/harvest_gallagher_ge.py (reader: gallagher.general_election_results)',
                       'source': hg.SOURCE},
        'counts': {'contests': len(records), 'byShape': shapes,
                   'candidates': sum(len(r['candidates']) for r in records),
                   'validationFailures': len(failing)},
        'validationFailures': failing,
        'records': records,
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(doc_out, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    rows = crosscheck(records)
    by_year = {}
    for r in rows:
        y = r['date'][:7] if r['date'][:4] == '1927' else r['date'][:4]
        s_ = by_year.setdefault(y, {'contests': 0, 'site': {'firstPreferenceDisagreements': 0, 'contestsWithFpDisagreement': 0,
                                                           'missingInCivgraph': 0, 'notInGallagher': 0, 'electedDisagreements': 0,
                                                           'contestsWithCountDifferences': 0, 'countCellsDiffering': 0},
                                    'eiSourceFile': {'firstPreferenceDisagreements': 0, 'contestsWithFpDisagreement': 0,
                                                     'missingInCivgraph': 0, 'notInGallagher': 0},
                                    'countSidecarContestsWithDifferences': 0, 'gallagherClosesCountGap': 0})
        s_['contests'] += 1
        for src, blk in (('site', r['site']), ('eiSourceFile', r['ei'])):
            if not blk or blk.get('candidateFigures') is False:
                continue
            n = len(blk.get('firstPreferenceDisagreements', []))
            t = s_[src]
            t['firstPreferenceDisagreements'] += n
            t['contestsWithFpDisagreement'] += bool(n)
            t['missingInCivgraph'] += len(blk['missingInCivgraph'])
            t['notInGallagher'] += len(blk['notInGallagher'])
            if src == 'site':
                t['electedDisagreements'] += len(blk['electedDisagreements'])
                if blk.get('counts'):
                    t['contestsWithCountDifferences'] += bool(blk['counts']['cellsDiffering'])
                    t['countCellsDiffering'] += blk['counts']['cellsDiffering']
        if r['countSidecar'] and r['countSidecar'].get('cellsDiffering'):
            s_['countSidecarContestsWithDifferences'] += 1
        s_['gallagherClosesCountGap'] += r['gallagherClosesCountGap']
    xc = {
        'schemaVersion': 1,
        'description': "Gallagher's 1922-44 general-election contests against Civgraph's Dail files (ElectionsIreland "
                       'flat schema) and count sidecars. Review only: nothing applied.',
        'provenance': {'method': 'scripts/walker/harvest_gallagher_ge.py', 'gallagher': 'data/elections/gallagher-general-elections-1922-44.json'},
        'summaryByElection': by_year,
        'countGapsGallagherCloses': [{'date': r['date'], 'constituency': r['constituency'], 'page': r['page'],
                                      'documentedGap': r['documentedGap'], 'noTransferRecord': r['noTransferRecord'],
                                      'gallagherShape': r['gallagherShape'], 'gallagherNumCounts': r['gallagherNumCounts']}
                                     for r in rows if r['gallagherClosesCountGap']],
        'documentedGapsStillWithoutCounts': [{'date': r['date'], 'constituency': r['constituency'], 'gallagherShape': r['gallagherShape']}
                                             for r in rows if r['documentedGap'] and not r['gallagherHasCounts'] and not r['countSidecar']],
        'records': rows,
    }
    with open(XCHECK, 'w', encoding='utf-8') as fh:
        json.dump(xc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f"contests {len(records)} {shapes}; validation failures {len(failing)}")
    for f in failing:
        print('  ', f[:220])
    for y, v in by_year.items():
        print(y, json.dumps(v))


if __name__ == '__main__':
    main()
