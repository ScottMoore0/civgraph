#!/usr/bin/env python
"""Record the Belfast Gazette's lists of members returned as checked sources for Civgraph contests.

Stage 3 of the Belfast Gazette extraction. Reads the cross-check written by
extract_election_notices.py (<gazette dir>/extracted/election-crosscheck.json), which matches every
member in a Gazette return ("members returned to serve in Parliament", Crown Office for Northern
Ireland; Stormont and Westminster) to a Civgraph contest file, and writes one web-check record per
contest and Gazette page into data/elections/web-checked-sources.json under the batch
'belfast-gazette-returns'. scripts/build-election-provenance.mjs reads that file: a record with
checked: true makes the contest 'verified'.

A contest is recorded as checked only when, against the contest as the site shows it now (the
source-checked-fixes overlay applied, by civgraph_elections.load):
  * every Civgraph winner is named in a Gazette return matched to it (same name, a fuller or formal
    form, initials, or an OCR misreading another Gazette notice settles);
  * no Gazette entry matched to it disagrees (a different member, a member Civgraph has as not
    elected, or a name the OCR leaves uncertain);
  * a by-election return is not matched to a general-election contest, nor the reverse.
Contests where the Gazette disagrees get a record with checked: false and the disagreement spelt
out (the existing web-check mechanism); contests the Gazette only partly covers or leaves uncertain
are not recorded, and are listed in the report.

The Gazette prints no votes, so the check covers the members returned (and, for by-elections, the
predecessor and cause of vacancy where printed), never the figures. Citations only: names are
facts and the Gazette is Crown copyright under the Open Government Licence.

  CIVGRAPH_GAZETTE_DIR=<data folder> python scripts/gazette/record_gazette_provenance.py
        [--gazette <dir>] [--dry-run] [--report <file>]

Rerun after each extraction run: the batch's records are replaced wholesale, so contests the crawl
newly covers are added and ones that no longer pass are dropped.
"""
import argparse, collections, datetime, json, os, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import civgraph_elections  # noqa: E402
from gazette_crosscheck import name_relation, place_score  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
WEB_CHECKED = REPO / 'data' / 'elections' / 'web-checked-sources.json'
PREFIX = 'data/elections-source/data/elections/'
BATCH = 'belfast-gazette-returns'
BATCH_NOTE = ("The Belfast Gazette's lists of members returned (Crown Office for Northern Ireland: the Parliament of "
              "Northern Ireland, general elections and by-elections, and Westminster seats in Northern Ireland), read from "
              "the Gazette's own text layer by scripts/gazette/extract_election_notices.py and matched to each contest by "
              "scripts/gazette/record_gazette_provenance.py. Checked where every Civgraph winner is named in the return and no "
              "entry disagrees; the Gazette prints no votes, so the check is of the members returned, not the figures. "
              "Crown copyright, Open Government Licence.")

CONFIRM = {'confirms', 'confirms-fuller-name', 'confirms-formal-name', 'confirms-name-form-differs', 'confirms-other-seat',
           'ocr-variant-resolved'}
DISAGREE = {'member-disagrees', 'status-disagrees', 'name-disagrees', 'civgraph-winner-not-returned', 'disagrees'}
UNCERTAIN = {'name-disagrees-ocr-uncertain'}
SAME_PERSON = ('same', 'fuller', 'initials', 'familiar')
BODY_LABEL = {
    'parliament-of-northern-ireland': 'the House of Commons of Northern Ireland',
    'house-of-commons-of-the-united-kingdom': 'the House of Commons of the United Kingdom',
}
# Gazette entries that name a Civgraph winner in a form the name matcher cannot see, each read and
# settled by hand: a peer named by his title, a familiar forename. (file, Gazette name, winner, note.)
REVIEWED = [
    # Settled 1 Nov 2026 against a second source (Wikipedia's article on the member):
    ('parliament-of-northern-ireland/1969-02-24/north-tyrone.json', 'William S. Fyfe', 'William Samuel Fyffe',
     'William S. Fyfe; he is William Samuel Fyffe'),
    ('parliament-of-northern-ireland/1970-11-12/belfast-st-annes.json', 'James Dunn LAIRD', 'John Laird',
     'James Dunn Laird, a misprint for John Dunn Laird'),
    ('parliament-of-northern-ireland/1945-06-14/belfast-bloomfield.json', 'Gtentoran', 'Herbert Dixon',
     'Lord Glentoran, the title Herbert Dixon took in 1939; the text layer reads Gtentoran'),
    ('parliament-of-northern-ireland/1949-02-10/belfast-bloomfield.json', 'Glentoran', 'Herbert Dixon',
     'Lord Glentoran, the title Herbert Dixon took in 1939'),
    ('parliament-of-northern-ireland/1950-10-31/belfast-bloomfield.json', 'Glentoran', 'Daniel Dixon',
     'Lord Glentoran, the title Daniel Dixon inherited from his father in 1950'),
    ('parliament-of-northern-ireland/1953-10-22/belfast-bloomfield.json', 'Glentoran', 'Daniel Dixon',
     'Lord Glentoran, the title Daniel Dixon inherited in 1950'),
    ('parliament-of-northern-ireland/1953-10-22/lisnaskea.json', 'Brookeborough', 'Basil Brooke',
     'Viscount Brookeborough, the title Basil Brooke took in 1952'),
    ('parliament-of-northern-ireland/1951-02-02/antrim-borough.json', 'Nathaniel Owens Minford', 'Nat Minford',
     'Nathaniel Owens Minford'),
    ('parliament-of-northern-ireland/1953-10-22/antrim-borough.json', 'Nathaniel Owens Minford', 'Nat Minford',
     'Nathaniel Owens Minford'),
    ('parliament-of-northern-ireland/1969-02-24/antrim-borough.json', 'Nathaniel Owens Minford', 'Nat Minford',
     'Nathaniel Owens Minford'),
    ('parliament-of-northern-ireland/1958-03-20/belfast-bloomfield.json', 'Glentoran', 'Daniel Dixon',
     'Lord Glentoran, the title Daniel Dixon inherited in 1950'),
    ('parliament-of-northern-ireland/1958-03-20/lisnaskea.json', 'Basil Stanlake', 'Basil Brooke',
     'Basil Stanlake, Viscount Brookeborough, the title Basil Brooke took in 1952'),
    ('parliament-of-northern-ireland/1962-05-31/lisnaskea.json', 'Basil Stanlake', 'Basil Brooke',
     'Basil Stanlake, Viscount Brookeborough, the title Basil Brooke took in 1952'),
    ('parliament-of-northern-ireland/1965-11-25/lisnaskea.json', 'Basil Stanlake', 'Basil Brooke',
     'Basil Stanlake, Viscount Brookeborough, the title Basil Brooke took in 1952'),
    ('house-of-commons-of-the-united-kingdom/1964-10-15/fermanagh-and-south-tyrone.json', 'The Marquis of Hamilton', 'James Hamilton',
     "the Marquis of Hamilton, James Hamilton's courtesy title"),
    ('house-of-commons-of-the-united-kingdom/1966-03-31/fermanagh-and-south-tyrone.json', 'The Marquis of Hamilton', 'James Hamilton',
     "the Marquis of Hamilton, James Hamilton's courtesy title"),
    ('parliament-of-northern-ireland/1965-11-25/belfast-victoria.json', 'Robert Hamilton Bradford', 'Roy Bradford',
     'Robert Hamilton Bradford, known as Roy'),
    ('parliament-of-northern-ireland/1969-02-24/belfast-victoria.json', 'Robert Hamilton Bradford', 'Roy Bradford',
     'Robert Hamilton Bradford, known as Roy'),
    # The Gazette's spelling differs from Civgraph's; the same member (one seat, one winner).
    ('house-of-commons-of-the-united-kingdom/1950-02-23/belfast-north.json', 'Harford Montgomery Hyde', 'Hartford Hyde',
     'Harford Montgomery Hyde; Civgraph spells the forename Hartford'),
    ('house-of-commons-of-the-united-kingdom/1951-10-25/belfast-north.json', 'Harford Montgomery Hyde', 'Hartford Hyde',
     'Harford Montgomery Hyde; Civgraph spells the forename Hartford'),
    ('house-of-commons-of-the-united-kingdom/1955-05-26/belfast-north.json', 'Harford Montgomery Hyde', 'Hartford Hyde',
     'Harford Montgomery Hyde; Civgraph spells the forename Hartford'),
    ('parliament-of-northern-ireland/1925-04-03/belfast-west.json', 'William McMullan', 'William McMullen',
     'William McMullan, so spelt on the printed page; Civgraph has McMullen'),
    ('parliament-of-northern-ireland/1945-06-14/mid-antrim.json', 'Robert Nicholl Wilson', 'Robert Nichol Wilson',
     'Robert Nicholl Wilson; Civgraph spells the middle name Nichol'),
    ('parliament-of-northern-ireland/1949-02-10/mid-antrim.json', 'Robert Nicholl Wilson', 'Robert Nichol Wilson',
     'Robert Nicholl Wilson; Civgraph spells the middle name Nichol'),
    # Text-layer misreadings, settled from the page image (the printed name in the note).
    ('house-of-commons-of-the-united-kingdom/1946-06-06/down.json', 'Lieutenant Charles Heron Muli.An', 'Charles Mullan',
     'Charles Heron Mullan on the printed page; the text layer reads Muli.An'),
    ('parliament-of-northern-ireland/1929-05-22/belfast-clifton.json', 'Samuel Herbert Hall-Thornpso.il', 'Samuel Hall-Thompson',
     'Major Samuel Herbert Hall-Thompson on the printed page; the text layer reads Hall-Thornpso.il'),
    ('parliament-of-northern-ireland/1929-05-22/belfast-dock.json', 'Charles Blakistori-Houston', 'Charles Blakiston-Houston',
     'Major Charles Blakiston-Houston on the printed page; the text layer reads Blakistori-Houston'),
    ('parliament-of-northern-ireland/1929-05-22/belfast-st-annes.json', "James Haiina M'Conniek", 'James Hanna McCormick',
     "Major James Hanna M'Cormick on the printed page; the text layer reads M'Conniek"),
    ('parliament-of-northern-ireland/1933-11-30/south-armagh.json', 'Patrick Joseph Me Logan', 'Paddy McLogan',
     'Patrick Joseph McLogan on the printed page; the text layer reads Me Logan'),
    ('parliament-of-northern-ireland/1969-02-24/larkfield.json', 'William Basil Mclvor', 'Basil McIvor',
     'William Basil McIvor; the text layer reads Mclvor'),
]
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November',
          'December']


def long_date(iso):
    try:
        d = datetime.date.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso
    return f'{d.day} {MONTHS[d.month - 1]} {d.year}'


def is_winner(c):
    return (c.get('status') or '').lower().startswith('elect')


PREFIXED = re.compile(r'^(.*?)\s*\bConstituency\b\s*(.*)$')
PREDECESSOR_PHRASE = re.compile(r'^(?:in the )?(?:place|room) of\b', re.I)
NOT_A_NAME = re.compile(r'\b(?:office|privy|council|exchequer|revenue|receipts)\b', re.I)


def split_prefix(name):
    """1969-style entries carry their heading: 'East Down Constituency The Right Honourable ...'."""
    m = PREFIXED.match(name or '')
    return (m.group(1).strip(), m.group(2).strip()) if m and m.group(1).strip() else (None, name or '')


def own_name(row, contest):
    """The member's name with a heading for this contest stripped (or as printed)."""
    prefix, rest = split_prefix(row.get('gazette_name'))
    return rest if prefix and place_score(prefix, contest['name']) >= 0.75 else (row.get('gazette_name') or '')


def reviewed(key, row, contest):
    name = own_name(row, contest)
    return next(((w, note) for f, g, w, note in REVIEWED if f == key and g == name), None)


def misread(row, contest, election):
    """Why this entry is not a claim about this contest (a parser artefact), or None."""
    name = row.get('gazette_name') or ''
    if PREDECESSOR_PHRASE.match(name):
        return 'the predecessor phrase read as a member'
    prefix, rest = split_prefix(name)
    if prefix and place_score(prefix, contest['name']) < 0.75:
        return f'the entry for {prefix} Constituency, read under this heading'
    if NOT_A_NAME.search(name):
        return 'not a name: text from elsewhere on the page'
    others = [o for o in election if o['file'] != contest['file']]
    if any(place_score(name, o['name']) >= 0.9 for o in others):
        return 'a constituency heading read as a member'
    for o in others:
        if any(is_winner(x) and name_relation(rest, x['name']) in SAME_PERSON for x in o['candidates']):
            return f"the member for {o['name']}, read under this heading"
    return None


def covers(row, name, contest):
    """Does this confirming Gazette entry name this Civgraph winner?"""
    if name_relation(own_name(row, contest), name) in SAME_PERSON or name_relation(row.get('gazette_name'), name) in SAME_PERSON:
        return True
    other = (row.get('other_gazette_reading') or {}).get('name')
    if row['verdict'] == 'ocr-variant-resolved' and other and name_relation(other, name) in SAME_PERSON:
        return True
    return bool(row.get('_reviewed') and row['_reviewed'][0] == name)


def describe(row, winner, contest):
    g = own_name(row, contest)
    if row.get('_reviewed'):
        return f"{winner} (the Gazette gives {row['_reviewed'][1]})"
    if row['verdict'] == 'ocr-variant-resolved':
        o = row.get('other_gazette_reading') or {}
        return f"{winner} (the text layer reads {g}; {o.get('citation')} prints {o.get('name')})"
    if name_relation(g, winner) == 'same':
        return winner
    return f'{winner} (the Gazette gives {g})'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--gazette', default=os.environ.get('CIVGRAPH_GAZETTE_DIR'),
                    help='the Gazette data folder (gazette.sqlite, extracted/); or set CIVGRAPH_GAZETTE_DIR')
    ap.add_argument('--crosscheck', help='default <gazette>/extracted/election-crosscheck.json')
    ap.add_argument('--report', help='default <gazette>/extracted/gazette-provenance-report.json')
    ap.add_argument('--dry-run', action='store_true', help='report only; do not write web-checked-sources.json')
    args = ap.parse_args()
    if not args.gazette and not args.crosscheck:
        sys.exit('Give --gazette or set CIVGRAPH_GAZETTE_DIR.')
    gdir = Path(args.gazette) if args.gazette else None
    xpath = Path(args.crosscheck) if args.crosscheck else gdir / 'extracted' / 'election-crosscheck.json'
    rpath = Path(args.report) if args.report else (gdir or xpath.parent.parent) / 'extracted' / 'gazette-provenance-report.json'
    rows = json.loads(xpath.read_text(encoding='utf-8'))
    summary_path = xpath.parent / 'election-notices-summary.json'
    accessed = None
    if summary_path.exists():
        accessed = (json.loads(summary_path.read_text(encoding='utf-8')).get('generated') or '')[:10] or None

    contests = {c['file']: c for c in civgraph_elections.load(REPO)}
    by_election = collections.defaultdict(list)
    for c in contests.values():
        by_election[(c['body'], c['date'])].append(c)

    by_file = collections.defaultdict(list)
    unmatched = collections.Counter()
    notice_size = collections.Counter()
    for r in rows:
        if r.get('type') != 'return-of-members':
            continue
        if not r.get('civgraph_file'):
            unmatched[r['verdict']] += 1
            continue
        notice_size[r['notice']['citation']] += 1
        by_file[r['civgraph_file']].append(r)

    records, report = [], {'verified': [], 'disagrees': [], 'uncertain': [], 'partial': [], 'kind-mismatch': [],
                           'missing-file': [], 'entries-set-aside': []}
    for f, rs in sorted(by_file.items()):
        c = contests.get(f)
        key = f.replace(PREFIX, '')
        if not c:
            report['missing-file'].append({'file': key, 'gazette': sorted({r['notice']['citation'] for r in rs})})
            continue
        election = by_election[(c['body'], c['date'])]
        general = len(election) > 3
        winners = [x['name'] for x in c['candidates'] if is_winner(x)]
        # Entries the parser put under this contest that make no claim about it.
        kept = []
        for r in rs:
            why = misread(r, c, election) if r['verdict'] not in CONFIRM else None
            if why:
                report['entries-set-aside'].append({'file': key, 'gazette_name': r.get('gazette_name'), 'why': why,
                                                    'citation': r['notice']['citation']})
            else:
                kept.append(r)
        rs = kept
        for r in rs:
            r['_reviewed'] = reviewed(key, r, c) if r['verdict'] not in CONFIRM else None
            if not r['_reviewed'] and r['verdict'] not in CONFIRM and any(name_relation(own_name(r, c), w) in SAME_PERSON for w in winners):
                r['_restated'] = True
        if not rs:
            continue
        cites = sorted({(r['notice']['issue'], r['notice']['page'] or 0): r['notice'] for r in rs}.items())
        notices = [n for _, n in cites]
        base = {'file': key, 'civgraph_winners': winners, 'gazette': [
            {'name': r.get('gazette_name'), 'printed_place': r.get('place_printed'), 'verdict': r['verdict'],
             'predecessor': r.get('predecessor'), 'citation': r['notice']['citation'], 'url': r['notice']['url']} for r in rs]}

        ok = lambda r: r['verdict'] in CONFIRM or r.get('_reviewed') or r.get('_restated')  # noqa: E731
        bad = [r for r in rs if not ok(r) and r['verdict'] in DISAGREE]
        unsure = [r for r in rs if not ok(r) and r['verdict'] not in DISAGREE]
        # A by-election return (it names the predecessor) on a general-election contest, or a
        # general-election return (many members) on a by-election contest.
        kind = [r for r in rs if ok(r) and ((general and r.get('predecessor'))
                                            or (not general and notice_size[r['notice']['citation']] > 3))]
        good = [r for r in rs if ok(r) and r not in kind]
        uncovered = [w for w in winners if not any(covers(r, w, c) for r in good)]

        def record(checked, check, disagreements, n):
            label = BODY_LABEL.get(c['body'], c['body'])
            return {
                'batch': BATCH,
                'file': key,
                'title': f"The Belfast Gazette, issue {n['issue']}, {long_date(n['issue_date'])}, p. {n['page']}: members returned to serve in {label}",
                'publisher': 'The Belfast Gazette (Crown Office for Northern Ireland)',
                'url': n['url'],
                **({'accessed': accessed} if accessed else {}),
                'kind': 'official',
                'scope': 'this contest',
                'checked': checked,
                'compared': ['members returned'] + (['predecessor'] if any(r.get('predecessor') for r in rs) else []),
                'disagreements': disagreements,
                'check': check,
            }

        if bad:
            dis = []
            for r in bad:
                if r['verdict'] == 'status-disagrees':
                    dis.append(f"the Gazette returns {r.get('gazette_name')}, whom Civgraph has as {r.get('civgraph_status') or 'not elected'}"
                               + ('' if winners else ' (Civgraph marks no winner for this contest)'))
                elif r['verdict'] == 'civgraph-winner-not-returned':
                    dis.append(f"Civgraph's winner {r.get('civgraph_name')} is not in the Gazette's return ({', '.join(r.get('gazette_returned') or [])})")
                elif r.get('civgraph_name'):
                    dis.append(f"the Gazette returns {r.get('gazette_name')}; Civgraph has {r.get('civgraph_name')}")
                else:
                    dis.append(f"the Gazette returns {r.get('gazette_name')}; Civgraph's winner{'s are' if len(winners) != 1 else ' is'} {', '.join(winners) or 'not recorded'}")
            for n in notices:
                if not any(r['notice']['url'] == n['url'] for r in bad):
                    continue
                records.append(record(False, 'Members returned compared with the Gazette\'s list: ' + '; '.join(dis)
                                      + '. Not settled; the Gazette prints no votes.', dis, n))
            report['disagrees'].append({**base, 'differences': dis})
            continue
        if unsure:
            report['uncertain'].append(base)
            continue
        if kind:
            report['kind-mismatch'].append({**base, 'note': 'by-election return matched to a general-election contest, or the reverse'})
            continue
        if not winners or uncovered:
            report['partial'].append({**base, 'not_in_gazette': uncovered})
            continue
        for n in notices:
            mine = [r for r in good if r['notice']['url'] == n['url']]
            if not mine:
                continue
            named = [describe(next(r for r in mine if covers(r, w, c)), w, c) for w in winners if any(covers(r, w, c) for r in mine)]
            pred = [r for r in mine if r.get('predecessor')]
            text = (f"Members returned compared with the Gazette's list ({n['citation']}): "
                    f"{', '.join(named)} {'is' if len(named) == 1 else 'are'} returned for {c['name']}, as Civgraph has")
            if pred:
                p = pred[0]
                prev = p.get('civgraph_previous_winners') or []
                text += (f"; the Gazette names the predecessor as {p['predecessor']}"
                         + (f" (Civgraph's previous winner{'s' if len(prev) != 1 else ''}: {', '.join(prev)})" if prev else ''))
            if len(named) < len(winners):
                text += '; the other winner(s) are confirmed on another page of the same return'
            text += '. The Gazette prints no votes, so the figures are not checked here.'
            records.append(record(True, text, [], n))
        report['verified'].append({'file': key, 'body': c['body'], 'date': c['date'], 'winners': winners,
                                   'gazette': [n['citation'] for n in notices]})

    doc = json.loads(WEB_CHECKED.read_text(encoding='utf-8'))
    kept = [r for r in doc.get('records', []) if r.get('batch') != BATCH]
    # A record that says the same as before keeps its accessed date, so a re-run touches only
    # the records whose finding changed.
    before = {(r['file'], r['url']): r for r in doc.get('records', []) if r.get('batch') == BATCH}
    for r in records:
        old = before.get((r['file'], r['url']))
        if old and old.get('accessed') and {k: v for k, v in old.items() if k != 'accessed'} == {k: v for k, v in r.items() if k != 'accessed'}:
            r['accessed'] = old['accessed']
    records.sort(key=lambda r: (r['file'], r['url']))
    doc['records'] = kept + records
    batches = [b for b in doc.get('batches', []) if b.get('id') != BATCH]
    batches.append({'id': BATCH, 'note': BATCH_NOTE})
    doc['batches'] = batches

    seg = collections.Counter()
    for v in report['verified']:
        seg[(v['body'], v['date'][:4])] += 1
    out = {'generated': datetime.datetime.now().isoformat(timespec='seconds'), 'crosscheck': str(xpath.name),
           'counts': {k: len(v) for k, v in report.items()}, 'unmatched_entries': dict(unmatched),
           'records_written': len(records), **report}
    rpath.parent.mkdir(parents=True, exist_ok=True)
    rpath.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    if not args.dry_run:
        WEB_CHECKED.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"contests with Gazette entries: {len(by_file)}; records {'(dry run) ' if args.dry_run else ''}written: {len(records)}")
    for k, v in report.items():
        print(f'  {k:14} {len(v)}')
    print(f'  entries not matched to a contest: {dict(unmatched)}')
    print(f'  report: {rpath}')


if __name__ == '__main__':
    main()
