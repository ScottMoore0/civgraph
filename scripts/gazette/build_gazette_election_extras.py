#!/usr/bin/env python
"""Turn the Belfast Gazette polling and expenses notices into the Browse election extras.

Reads (read-only) the extractors' output in <gazette>/extracted:

  polling-notices.jsonl    from extract_polling_notices.py
  expenses-notices.jsonl   from extract_expenses_notices.py

and the repo's election manifest (render/metadata/elections-test2.json), and writes the COMMITTED
file data/elections/gazette-election-extras.json, which scripts/build-browse-indexes.mjs merges
into the Browse election and contest records. The site build never needs the Gazette folder.

  contests[<contest key>].pollingDistricts   a printed polling-district schedule for that contest
  elections[<election key>].pollingDistricts a schedule that names no constituency (attached to the
                                              election, with a note saying so)
  elections[<election key>].rulesAndCosts    a short list, each item with its Gazette citation:
      - the returning officers' charges scale: the latest scale for that body notified in the
        Gazette before polling day (by-election and general-election scales kept apart; none
        when the latest is more than MAX_SCALE_AGE_YEARS old, since later scales may be unprinted)
      - the candidates' election expenses limit (local elections, 1981 and 1985 Orders)
      - the Exchequer issues for returning officers' expenses in the financial year of the
        election, where the year's final monthly statement printed a figure

Keys are the Browse keys: an election is "<body>__<date>" and a contest "<election>::<slug>",
as in build-browse-indexes.mjs.

OCR: the schedule rows are corrected with OCR_FIXES, every entry checked against the printed page
(issue 118, p. 451; issue 1301, p. 126). A row is kept as printed when no fix applies.

Polling places are locality and public-building names only; the extractor drops anything that
reads as a private address and this script adds none.

  python scripts/gazette/build_gazette_election_extras.py --gazette <dir>     (or CIVGRAPH_GAZETTE_DIR)
  python scripts/gazette/build_gazette_election_extras.py --gazette <dir> --check

<dir> is the Gazette data folder (holding extracted/) or the extracted folder itself.
"""
import argparse, datetime, json, os, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'data' / 'elections' / 'gazette-election-extras.json'
MANIFEST = REPO / 'render' / 'metadata' / 'elections-test2.json'
LICENCE = 'Belfast Gazette (thegazette.co.uk), Open Government Licence v3.0'
MAX_SCALE_AGE_YEARS = 8
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
          'October', 'November', 'December']

# Gazette body -> Browse election-key prefix.
BODY_PREFIX = {
    'house-of-commons-of-the-united-kingdom': 'house-of-commons-of-the-united-kingdom',
    'parliament-of-northern-ireland': 'parliament-of-northern-ireland',
    'local-government': 'local-government-local-government-districts',
}
# Bodies whose returning officers were paid from the Northern Ireland Consolidated Fund.
EXCHEQUER_BODIES = ('house-of-commons-of-the-united-kingdom', 'parliament-of-northern-ireland')

# Printed reading of each OCR-damaged name in the schedules (checked against the page images).
OCR_FIXES = {
    # County Tyrone, issue 118, 28 September 1923, p. 451
    'Anghnacloy': 'Aughnacloy', 'Glonaneese': 'Clonaneese', 'Castlecaulfleld': 'Castlecaulfield',
    'Coaiisland': 'Coalisland', 'Dungannon (Hural)': 'Dungannon (Rural)', 'KHlyman': 'Killyman',
    'Newmllls': 'Newmills', 'andholes': 'Sandholes', 'ullaghoge': 'Tullaghoge',
    'Aitlgarvan': 'Artigarvan', 'Castledeig': 'Castlederg', 'Dromquln': 'Drumquin',
    'Altdogbal': 'Altdoghal', 'Omagh Kurat': 'Omagh Rural',
    'Tattymqyle': 'Tattymoyle', 'Mountjoy Forest Wes': 'Mountjoy Forest West', 'Gortla': 'Gortin',
    'Longhmuck': 'Loughmuck', 'Omagh Bural': 'Omagh Rural', 'Mullaehslib': 'Mullaghslin',
    'Sekkinore': 'Seskinore', 'LIfford': 'Lifford', 'Monrfleld': 'Moorfield',
    'Aughnacl6y (Bural)': 'Aughnacloy (Rural)', 'Foremags': 'Foremass', 'Kdllyfaddy': 'Killyfaddy',
    'Cloeber': 'Clogher', 'Flvemiletown': 'Fivemiletown', 'Acrhnahoe': 'Aghnahoe', 'Coagb': 'Coagh',
    'MunterevUn': 'Munterevlin', 'Pameroy': 'Pomeroy', 'Sandholea': 'Sandholes',
    'Tullaghbge': 'Tullaghoge', 'BaUymongan': 'Ballymongan', 'Baronscdurt': 'Baronscourt',
    'Clnnahill': 'Clunahill', 'Drumauln': 'Drumquin', 'Klrllsh': 'Kirlish', 'Longfleld': 'Longfield',
    'Ktllyclooney': 'Killyclooney', 'Tollyard': 'Tullyard', 'Llslea': 'Lislea', 'Seeln': 'Seein',
    'KBUony': 'Rahony', 'Collion': 'Cullion',
    'GUlygooly': 'Gillygooly', 'TrUlick': 'Trillick', 'Fivemlletowor': 'Fivemiletown',
    'Castlecanlfleldl': 'Castlecaulfield', 'Meenascallagb': 'Meenascallagh',
    'Btewartstown': 'Stewartstown', 'T ullaghoge': 'Tullaghoge', 'DrumQuin': 'Drumquin',
    'Dtmnamanagh': 'Dunnamanagh', 'Lougbmacrory': 'Loughmacrory', 'Glenamy': 'Glenarny',
    # Belfast, issue 1301, 31 May 1946, p. 126
    'Wood vale': 'Woodvale', 'Or mean': 'Ormeau',
}

# What each schedule is, in a sentence, and where it attaches (by its polling-schedule citation URL).
SCHEDULES = {
    'https://www.thegazette.co.uk/Belfast/issue/118/page/451': {
        'title': 'County Tyrone polling districts, 1923',
        'areaLabel': 'District electoral divisions',
        'note': ('Polling districts and polling places for County Tyrone, as altered by the Ministry of '
                 'Home Affairs order of 27 September 1923. The County Fermanagh part of the '
                 'constituency is not in this notice.'),
        'attach': 'contests',
        # Printed order: the schedule's left column, then its right.
        'firstRow': 'Ardstraw',
    },
    'https://www.thegazette.co.uk/Belfast/issue/1301/page/126': {
        'title': 'Belfast polling districts with a separate register timetable, 1946',
        'areaLabel': 'Ward',
        'districtPrefix': ('No. ', 'Nos. '),
        'note': ('A Ministry of Home Affairs notice of 23 May 1946 set a separate electoral-register '
                 'timetable (claims and objections to 1 July 1946) for these Belfast polling districts. '
                 'It gives their wards, not their constituencies, and names no polling places or '
                 'election; it is shown on the first election held after it, the Belfast Central '
                 'by-election of 22 August 1946.'),
        'attach': 'first-election',
    },
}

# Corrections to the expenses records, keyed by citation URL (read from the printed pages).
EXPENSES_OVERRIDES = {
    'https://www.thegazette.co.uk/Belfast/issue/1253': {'skip': True},  # page not identified
    'https://www.thegazette.co.uk/Belfast/issue/411/page/543': {'skip': True},  # the p. 542 notice, continued
    'https://www.thegazette.co.uk/Belfast/issue/1284/page/28': {'sr_number': None},
    'https://www.thegazette.co.uk/Belfast/issue/1338/page/43': {'sr_number': '1946 No. 229'},
    'https://www.thegazette.co.uk/Belfast/issue/1910/page/33': {'sr_number': '1957 No. 263', 'made_by': 'Ministry of Home Affairs'},
    'https://www.thegazette.co.uk/Belfast/issue/2133/page/173': {
        'title': 'Electoral Law (Returning Officers Remuneration and Expenses) Regulations (Northern Ireland) 1962'},
    'https://www.thegazette.co.uk/Belfast/issue/537/page/994': {
        'subject': 'Scale of Maximum Charges of Returning Officers at Parliamentary Elections in Northern Ireland'},
    'https://www.thegazette.co.uk/Belfast/issue/153/page/819': {'amending': True},
    'https://www.thegazette.co.uk/Belfast/issue/1850/page/341': {'sr_number': '1956 No. 173', 'made_by': 'Ministry of Home Affairs'},
    'https://www.thegazette.co.uk/Belfast/issue/3922/page/253': {
        'title': "Northern Ireland (Variation of Limits of Candidates' Expenses) Order 1981",
        'made_date': '1981-02-18'},
    'https://www.thegazette.co.uk/Belfast/issue/4556/page/381': {
        'title': 'Local Elections (Northern Ireland) Order 1985', 'sr_number': 'S.I. 1985 No. 454'},
}


def fmt_date(iso):
    d = datetime.date.fromisoformat(iso[:10])
    return f'{d.day} {MONTHS[d.month - 1]} {d.year}'


def money(pounds):
    if pounds >= 1:
        return f'£{pounds:,.0f}' if float(pounds).is_integer() else f'£{pounds:,.2f}'
    pence = round(pounds * 100, 2)
    return f'{pence:g}p'


def fix(name):
    name = re.sub(r'\s+', ' ', (name or '').strip())
    return OCR_FIXES.get(name, name)


def source(rec, note=None):
    out = {'citation': rec['citation'], 'url': rec['url']}
    if note:
        out['note'] = note
    return out


def read_jsonl(path):
    with open(path, encoding='utf-8') as fh:
        return [json.loads(line) for line in fh if line.strip()]


def browse_election_key(gazette_key):
    """'<body>/<date>[/<slug>]' -> (election key, contest key or None)."""
    parts = gazette_key.split('/')
    prefix = BODY_PREFIX.get(parts[0], parts[0])
    election = f'{prefix}__{parts[1]}'
    return election, (f'{election}::{parts[2]}' if len(parts) > 2 else None)


def load_elections():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    out = []
    for e in manifest.get('elections', []):
        date = str(e.get('date') or '')[:10]
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', date):
            continue
        out.append({'key': e['key'], 'date': date, 'byElection': bool(e.get('isByElection'))
                    or e.get('kind') == 'by-election'})
    return out


def contest_slugs(election_key):
    """The contest slugs Browse makes for an election (slugified result names)."""
    path = REPO / 'render' / 'metadata' / 'elections-test2' / f'{election_key}.json'
    if not path.exists():
        return set()
    detail = json.loads(path.read_text(encoding='utf-8'))
    slugs = set()
    for r in detail.get('results') or []:
        name = r.get('constituency') or r.get('featureName') or r.get('matchName') or ''
        slugs.add(re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', name.lower().replace('&', ' and '))))
    return slugs


# ---------------------------------------------------------------------------------------------
# Polling districts

def polling_tables(records, elections):
    schedules = {r['url']: r for r in records if r['record'] == 'polling-schedule'}
    rows_by_url = {}
    for r in records:
        if r['record'] == 'polling-district':
            rows_by_url.setdefault(r['url'], []).append(r)
    contests, by_election = {}, {}
    for url, rows in rows_by_url.items():
        spec, sched = SCHEDULES.get(url), schedules.get(url)
        if not spec or not sched:
            print(f'skip polling schedule {url}: not described in SCHEDULES', file=sys.stderr)
            continue
        if spec.get('firstRow'):
            start = next((i for i, r in enumerate(rows) if fix(r.get('polling_district')) == spec['firstRow']), 0)
            rows = rows[start:] + rows[:start]
        table_rows = []
        for r in rows:
            nums = r.get('polling_district_numbers') or []
            district = fix(r.get('polling_district')) if r.get('polling_district') else (
                spec.get('districtPrefix', ('', ''))[len(nums) > 1] + ', '.join(nums) if nums else '')
            row = {'district': district, 'area': [fix(a) for a in r.get('area_printed') or []]}
            if r.get('polling_place'):
                row['place'] = fix(r['polling_place'])
            table_rows.append(row)
        table = {
            'title': spec['title'],
            'areaLabel': spec['areaLabel'],
            'note': spec['note'],
            'rows': table_rows,
            'source': source(sched),
        }
        keys = sched.get('civgraph_keys') or [sched.get('civgraph_key')]
        if spec['attach'] == 'contests':
            for gk in keys:
                election, contest = browse_election_key(gk)
                slug = contest.split('::', 1)[1] if contest else None
                if not contest or slug not in contest_slugs(election):
                    print(f'warn: {gk} has no Browse contest; not attached', file=sys.stderr)
                    continue
                contests.setdefault(contest, {})['pollingDistricts'] = table
        else:
            # The first election (by date) among the matches.
            firsts = sorted({browse_election_key(gk)[0] for gk in keys}, key=lambda k: k.split('__')[1])
            known = {e['key'] for e in elections}
            first = next((k for k in firsts if k in known), None)
            if first:
                by_election.setdefault(first, {})['pollingDistricts'] = table
    return contests, by_election


# ---------------------------------------------------------------------------------------------
# Rules and costs

def apply_overrides(records):
    out = []
    for r in records:
        o = EXPENSES_OVERRIDES.get(r['url'])
        if o and o.get('skip'):
            continue
        out.append({**r, **{k: v for k, v in (o or {}).items() if k != 'skip'}})
    return out


def instrument_date(r):
    return r.get('made_date') or r.get('notice_date') or r['issue_date']


def charges_item(r):
    maker = r.get('made_by')
    what = r.get('title')
    if not what:
        subject = (r.get('subject') or '').strip()
        subject = subject[:1].upper() + subject[1:].lower() if subject.isupper() else subject
        what = subject[:1].upper() + subject[1:] if subject else 'Scale of maximum charges of returning officers'
        if r.get('amending'):
            what = 'Amending regulations: ' + what[:1].lower() + what[1:]
    scope = r.get('election_scope')
    if scope and not r.get('subject') and not r.get('title'):
        what += ' at by-elections' if scope == 'by-elections' else ' at general elections'
    bits = [what]
    if r.get('sr_number'):
        sr = r['sr_number']
        bits.append(f"({sr if sr.startswith('S.') else 'S.R. & O. ' + sr})")
    made = r.get('made_date')
    tail = []
    if maker:
        tail.append(f'made by the {maker}' if not maker.startswith('Privy') else 'made by Order in Council')
    if made:
        tail.append(f'on {fmt_date(made)}')
    text = ' '.join(bits) + (', ' + ' '.join(tail) if tail else '') + '.'
    if r.get('scale_printed'):
        text += ' The scale is printed in the Gazette.'
    text += ' The latest scale for this kind of election notified in the Gazette before polling day.'
    return {'kind': 'returning-officers-charges', 'label': "Returning officers' charges", 'text': text,
            'sources': [source(r)]}


def rules_and_costs(expenses, elections):
    items = {}

    def add(key, item):
        items.setdefault(key, []).append(item)

    # 1. Returning officers' charges in force.
    charges = [r for r in expenses if r['kind'] == 'returning-officer-charges']
    for body, prefix in BODY_PREFIX.items():
        scales = sorted((r for r in charges if body in (r.get('bodies') or [])),
                        key=lambda r: (instrument_date(r), not r.get('made_date'), r['issue'], r['page']))
        if not scales:
            continue
        for e in elections:
            if not e['key'].startswith(prefix + '__'):
                continue
            wanted = [r for r in scales if instrument_date(r) < e['date'] and r['issue_date'] <= e['date']
                      and r.get('election_scope') != ('general-elections' if e['byElection'] else 'by-elections')]
            if not wanted:
                continue
            latest_date = instrument_date(wanted[-1])
            # One instrument may be printed twice (e.g. 24 Aug and 14 Sep 1923): cite the first notice.
            pick = next(r for r in wanted if instrument_date(r) == latest_date)
            age = (datetime.date.fromisoformat(e['date']) - datetime.date.fromisoformat(latest_date)).days / 365.25
            if age > MAX_SCALE_AGE_YEARS:
                continue
            add(e['key'], charges_item(pick))

    # 2. Candidates' election expenses limits (local elections).
    for r in expenses:
        if r['kind'] != 'candidate-expense-limits':
            continue
        for gk in r.get('civgraph_keys') or []:
            key, _ = browse_election_key(gk)
            limits = {x['part']: x for x in r.get('limits') or []}
            if limits.get('fixed sum') and limits.get('additional sum'):
                f, a = limits['fixed sum'], limits['additional sum']
                text = (f"{money(f['now_pounds'])} plus {money(a['now_pounds'])} for each entry in the register "
                        f"of electors (up from {money(f['was_pounds'])} plus {money(a['was_pounds'])}), "
                        f"set by the {r['title']}" + (f" ({r['sr_number']})" if r.get('sr_number') else '') + '.')
                srcs = [source(r)]
            else:
                # The 1981 notice names the Order but not the sums; the 1985 notice recites them.
                later = next((x for x in expenses if x['kind'] == 'candidate-expense-limits' and x.get('limits')
                              and (x.get('previous_change') or '').endswith(r['issue_date'][:4])), None)
                if not later:
                    continue
                lim = {x['part']: x for x in later['limits']}
                text = (f"{money(lim['fixed sum']['was_pounds'])} plus {money(lim['additional sum']['was_pounds'])} "
                        f"for each entry in the register of electors, set by the {r['title']}, made on "
                        f"{fmt_date(r['made_date'])} (the first rise since the Representation of the People Act 1977).")
                srcs = [source(r), source(later, 'the sums, as recited when they were next raised')]
            add(key, {'kind': 'candidate-expense-limit', 'label': "Candidates' election expenses limit",
                      'text': text, 'sources': srcs})

    # 3. Exchequer issues for returning officers' expenses in the election's financial year.
    finals = {}
    for r in expenses:
        if r['kind'] != 'exchequer-returning-officers-expenses' or r.get('total_to_date') is None:
            continue
        until = r.get('total_to_date_until')
        if not until or until > r['issue_date']:
            continue
        d = datetime.date.fromisoformat(until)
        fy = d.year if d.month >= 4 else d.year - 1
        if fy not in finals or until > finals[fy]['total_to_date_until']:
            finals[fy] = r
    for fy, r in finals.items():
        start, until = f'{fy}-04-01', r['total_to_date_until']
        for e in elections:
            if not e['key'].split('__')[0] in EXCHEQUER_BODIES or not (start <= e['date'] <= until):
                continue
            text = (f"{money(r['total_to_date'])} issued from the Northern Ireland Exchequer for returning "
                    f"officers' expenses from {fmt_date(start)} to {fmt_date(until)}. The account gives one "
                    f"figure for every election paid in the year.")
            add(e['key'], {'kind': 'exchequer-returning-officers-expenses',
                           'label': "Returning officers' expenses (Exchequer)", 'text': text,
                           'sources': [source(r)]})
    return items


# ---------------------------------------------------------------------------------------------

def build(extracted):
    elections = load_elections()
    polling = read_jsonl(extracted / 'polling-notices.jsonl')
    expenses = apply_overrides(read_jsonl(extracted / 'expenses-notices.jsonl'))
    contests, by_election = polling_tables(polling, elections)
    for key, items in rules_and_costs(expenses, elections).items():
        by_election.setdefault(key, {})['rulesAndCosts'] = items
    return {
        'schemaVersion': 1,
        'generatedBy': 'scripts/gazette/build_gazette_election_extras.py',
        'source': LICENCE,
        'note': ('Polling-district schedules and election rules and costs from the Belfast Gazette, '
                 'merged into the Browse election and contest records by scripts/build-browse-indexes.mjs.'),
        'contests': dict(sorted(contests.items())),
        'elections': dict(sorted(by_election.items())),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--gazette', default=os.environ.get('CIVGRAPH_GAZETTE_DIR'),
                    help='Gazette data folder or its extracted/ folder (or set CIVGRAPH_GAZETTE_DIR)')
    ap.add_argument('--out', default=str(OUT))
    ap.add_argument('--check', action='store_true', help='fail if the committed file is out of date')
    args = ap.parse_args()
    if not args.gazette:
        sys.exit('Give --gazette <dir> or set CIVGRAPH_GAZETTE_DIR.')
    base = Path(args.gazette)
    extracted = base if (base / 'polling-notices.jsonl').exists() else base / 'extracted'
    data = build(extracted)
    text = json.dumps(data, ensure_ascii=False, indent=1) + '\n'
    out = Path(args.out)
    if args.check:
        current = out.read_text(encoding='utf-8') if out.exists() else ''
        if current != text:
            sys.exit(f'{out} is out of date; rerun without --check.')
        print(f'{out} is up to date.')
        return
    out.write_text(text, encoding='utf-8', newline='\n')
    n_items = sum(len(v.get('rulesAndCosts') or []) for v in data['elections'].values())
    print(f"wrote {out.relative_to(REPO) if out.is_relative_to(REPO) else out}: "
          f"{len(data['contests'])} contests with polling districts, "
          f"{sum(1 for v in data['elections'].values() if v.get('pollingDistricts'))} elections with polling districts, "
          f"{sum(1 for v in data['elections'].values() if v.get('rulesAndCosts'))} elections with {n_items} rules-and-costs items")


if __name__ == '__main__':
    main()
