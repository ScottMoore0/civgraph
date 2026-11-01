#!/usr/bin/env python
"""Record the formal names the Belfast Gazette prints for people Civgraph shows by a familiar or
shorter name ("John Beattie" for Jack Beattie, "Charles Curtis Craig" for Charles Craig).

The display name is not changed: the names go to data/elections/persons/reference-names.json, keyed
by person id, each with its Gazette citation, and the Browse person page lists them and search finds
them. Read from the election extractor's proposals (election-fix-proposals.json, categories "names"
with verdict confirms-fuller-name / confirms-formal-name, and "person-identity"). A name is taken
only when its surname matches Civgraph's and every word looks like a word, since much of the Gazette
text before 1950 is an OCR layer; the rest are listed in the report for checking by eye.

  python scripts/gazette/build_reference_names.py [--proposals <file>] [--out <json>] [--report <md>]
"""
import argparse, collections, csv, glob, json, os, re, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GAZ = os.environ.get('CIVGRAPH_GAZETTE_DIR', '')
META = os.path.join(ROOT, 'render', 'metadata', 'elections-test2')
SRC = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections')
OUT = os.path.join(ROOT, 'data', 'elections', 'persons', 'reference-names.json')
IDENTITY = re.compile(r"The Gazette prints (.+?)'s formal name as (.+?) \((.+?)\)")
WORD = re.compile(r"^(?:[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)*|[A-Z]\.?|Mc[A-Z][a-z]+|Mac[A-Z][a-z]+|O'[A-Z][a-z]+|M'[A-Z][a-z]+|de|la|van)$")


def fold(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'^ma?c|^m\'', 'mc', re.sub(r'[^a-z]', '', s))


# Misreadings in the OCR layer, confirmed against another printing of the same name.
OCR_FIXES = {'Fullon': 'Fulton'}
# A Gazette misprint, settled by another source: his own 1945 election-expenses return (Belfast
# News-Letter, 13 Aug 1945) and his obituary (Northern Whig, 19 Oct 1954) give "Brown".
NAME_FIXES = {'Robert Browne Alexander': 'Robert Brown Alexander'}
# Formal names the Gazette prints for rows the matcher cannot reach, because Civgraph's own name for
# the row was wrong when the proposals were made (checked by hand, 1 Nov 2026).
EXTRA = [
    ('103824', 'Thomas Gibson Henderson', 'Tommy Henderson', 'Belfast Gazette, issue 1445, 4 March 1949, p. 48',
     'https://www.thegazette.co.uk/Belfast/issue/1445/page/48'),
    ('106042', 'Charles Heron Mullan', 'Charles Mullan', 'Belfast Gazette, issue 1303, 14 June 1946, p. 43',
     'https://www.thegazette.co.uk/Belfast/issue/1303/page/43'),
    ('104349', 'Basil Stanlake Brooke', 'Basil Brooke', 'Belfast Gazette, issue 414, 31 May 1929, p. 636',
     'https://www.thegazette.co.uk/Belfast/issue/414/page/636'),
    ('104236', 'Robert Brown Alexander', 'Robert Alexander', 'Belfast Gazette, issue 1256, 20 July 1945, p. 163',
     'https://www.thegazette.co.uk/Belfast/issue/1256/page/163'),
    ('103830', 'John Warden Brooke', 'John Brooke', 'Belfast Gazette, issue 2475, 29 March 1968, p. 105',
     'https://www.thegazette.co.uk/Belfast/issue/2475/page/105'),
]

TITLES = re.compile(r"^(?:(?:Mr|Mrs|Airs|Miss|Dr|Rev|Sir|Major|Captain|Capt|Colonel|Col|Lieutenant|Lieut|Lt|Professor|Prof|"
                    r"The|Right|Rt|Honourable|Hon|Lady|Lord)\.?\s+)+")


def tidy(formal):
    """Drop the heading text OCR runs into the name ('of Belfast: ', 'Ulster: Miss ') and titles;
    write M' as Mc and capitals in the surname as the name is usually written."""
    # A colon or dash with a space after it ends the heading; a hyphen inside a surname
    # (Hall-Thompson) does not.
    s = re.split(r':\s*|\s[\-—]\s*|—\s*|\.\s+(?=[A-Z])', formal)[-1]
    s = re.sub(r'^(?:[A-Za-z/]{1,3}\s+)?(?:of\s+)?(?:Belfast|Londonderry|Ulster)\s+', '', s.strip())
    s = re.sub(r'^.*\bConstituency\s+', '', s)
    s = TITLES.sub('', s.strip())
    s = re.sub(r"\bM['’](?=[A-Z])", 'Mc', s)
    s = re.sub(r"\b(Mc|Mac)?([A-Z]{2,})\b", lambda m: (m.group(1) or '') + m.group(2).capitalize(), s)
    s = ' '.join(OCR_FIXES.get(w, w) for w in s.split())
    return re.sub(r'\s+', ' ', s).strip(' .,;-')


def plausible(formal, shown):
    shown = re.sub(r'\s*\(.*?\)', '', shown)
    words = formal.split()
    if len(words) < 2 or not all(WORD.match(w) for w in words):
        return False
    # A formal name adds to the shown one (Charles Curtis Craig) or replaces a familiar form
    # (John for Jack); one that only drops words (Herbert Dixon for the 1st Baron Glentoran
    # Herbert Dixon) tells nothing.
    if set(map(fold, words)) <= set(map(fold, shown.split())):
        return False
    return fold(words[-1]) == fold(shown.split()[-1])


def contest_people():
    """(source file, candidate name) -> person id, from the built election metadata."""
    by_key = {}
    for f in glob.glob(os.path.join(META, '*.json')):
        d = json.load(open(f, encoding='utf-8'))
        for c in d.get('mainLikeCandidateSummary') or []:
            if c.get('personId'):
                by_key[(d.get('bodySlug') or d.get('body'), d.get('date'), fold(c.get('constituency')), fold(c.get('name')))] = c['personId']
                by_key.setdefault((d.get('bodySlug') or d.get('body'), d.get('date'), None, fold(c.get('name'))), c['personId'])
    return by_key


def constituency_of(source_file):
    try:
        d = json.load(open(os.path.join(ROOT, source_file), encoding='utf-8'))
        return d['Constituency']['countInfo'].get('Constituency_Name')
    except (OSError, KeyError, ValueError):
        return None


def add(found, pid, formal, shown, citation, url):
    entry = found[str(pid)].setdefault(formal, {'name': formal, 'shownAs': shown, 'source': 'belfast-gazette', 'citations': []})
    cite = {'citation': citation, 'url': url}
    if cite not in entry['citations']:
        entry['citations'].append(cite)


def merged_into(pid):
    """The surviving id of a person merged by scripts/merge_person_ids.py (person_id_merges.csv)."""
    if not hasattr(merged_into, 'map'):
        merged_into.map = {}
        path = os.path.join(ROOT, 'data', 'elections', 'persons', 'person_id_merges.csv')
        if os.path.exists(path):
            for row in csv.DictReader(open(path, encoding='utf-8')):
                merged_into.map[str(row['drop'])] = str(row['keep'])
    pid, seen = str(pid), set()
    while pid in merged_into.map and pid not in seen:
        seen.add(pid)
        pid = merged_into.map[pid]
    return pid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--proposals', default=os.path.join(GAZ, 'extracted', 'election-fix-proposals.json'))
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--report')
    args = ap.parse_args()
    recs = json.load(open(args.proposals, encoding='utf-8'))['records']
    people = contest_people()
    found, skipped = collections.defaultdict(dict), []
    for r in recs:
        pairs = []
        if r['category'] == 'names' and set(r['verdicts']) & {'confirms-fuller-name', 'confirms-formal-name'}:
            pairs = [(op['name'], op['set']['candidateName']) for op in r.get('operations', []) if op.get('op') == 'candidate']
        elif r['category'] == 'person-identity':
            pairs = [(m.group(1), m.group(2)) for m in IDENTITY.finditer(r['reason'])]
        if not pairs:
            continue
        sf = r.get('sourceFile') or ''
        parts = sf.replace('\\', '/').split('/')
        body, date = (parts[-3], parts[-2]) if len(parts) >= 3 else (None, None)
        cons = fold(constituency_of(sf)) if sf else None
        for shown, formal in pairs:
            formal = tidy(formal)
            pid = people.get((body, date, cons, fold(shown))) or people.get((body, date, None, fold(shown)))
            why = None if pid else 'no person id for the candidate'
            if not why and fold(formal) == fold(re.sub(r'\s*\(.*?\)', '', shown)):
                continue
            if not why and not plausible(formal, shown):
                why = 'surname differs or the text looks garbled'
            if why:
                skipped.append((shown, formal, r['source']['title'], why))
                continue
            add(found, merged_into(pid), NAME_FIXES.get(formal, formal), shown, r['source']['title'], r['source']['url'])
    for pid, formal, shown, citation, url in EXTRA:
        add(found, merged_into(pid), formal, shown, citation, url)
    doc = {
        'schemaVersion': 1,
        'description': ('Formal names printed for people in official notices, where Civgraph shows a familiar or '
                        'shorter name. The display name is unchanged; these are listed on the person record and '
                        'found by search. Built by scripts/gazette/build_reference_names.py.'),
        'sources': {'belfast-gazette': {'title': 'The Belfast Gazette', 'publisher': 'The Stationery Office',
                                        'licence': 'Open Government Licence v3.0 (Crown copyright)'}},
        'people': {pid: sorted(names.values(), key=lambda e: e['name']) for pid, names in sorted(found.items(), key=lambda kv: int(kv[0]))},
    }
    with open(args.out, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    n = sum(len(v) for v in doc['people'].values())
    print(f'{n} formal name(s) for {len(doc["people"])} people; {len(skipped)} left for checking by eye')
    if args.report:
        with open(args.report, 'w', encoding='utf-8') as fh:
            fh.write('| Civgraph | Gazette | Citation | Why not recorded |\n|---|---|---|---|\n')
            for row in skipped:
                fh.write('| ' + ' | '.join(x.replace('|', '/') for x in row) + ' |\n')


if __name__ == '__main__':
    main()
