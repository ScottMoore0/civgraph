"""
Point the NI admin-areas editions in data/database/maps.json at the vintage
files written by scripts/ni_admin_areas_reconstruct.py, and add this work's
change notes and references.

Reads data/maps/local-government/_staged/editions.json. maps.json is shared
with other edits: it is read immediately before the write, only files.fgb and
cloneOf of admin-areas-* entries and the entries named in NOTES are touched,
references are appended (never replaced; de-duplicated by label), and
changeNote is set when empty or ours, otherwise appended. Idempotent.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / 'data' / 'database' / 'maps.json'
PLAN = ROOT / 'data' / 'maps' / 'local-government' / '_staged' / 'editions.json'
BASE = 'https://data.civgraph.net/data/maps/local-government/'
GAZ = 'https://www.thegazette.co.uk/Belfast/issue/{}/data.pdf'
RECON = ('Line reconstructed from the order or Act and its deposited map on OSNI Largescale '
         'townlands (2013); not legally definitive.')

NISRA = 'https://www.nisra.gov.uk/files/nisra/publications/'
C61 = {
    'antrim': {'label': 'Census of Population 1961: County Antrim', 'url': NISRA + '1961-census-antrim-county-report.pdf',
               'note': 'Changes 1951-61: Larne RD to Larne MB 1 Apr 1956; Belfast RD abolished 1 Apr 1958 (Newtownabbey UD; '
                       'rest to Antrim, Larne and Lisburn RDs). Areas: Larne MB 2,521 ac 2 r 18 p; Newtownabbey UD 6,006 ac '
                       '1 r 12 p; Ballyduff DED (Antrim RD) 4,112 ac; Ballygomartin DED (Lisburn RD) 10,558 ac.'},
    'armagh': {'label': 'Census of Population 1961: County Armagh', 'url': NISRA + '1961-census-armagh-county-report.pdf',
               'note': 'Changes 1951-61: Lurgan RD to Lurgan MB 1 Apr 1957. Lurgan MB 2,024 ac 2 r 4 p.'},
    'down': {'label': 'Census of Population 1961: County Down', 'url': NISRA + '1961-census-down-county-report.pdf',
             'note': 'Changes 1951-61: North Down RD to Bangor MB 1 Apr 1956. Bangor MB 2,404 ac 2 r 9 p.'},
}
C66 = {'label': 'Census of Population 1966: General Report', 'url': NISRA + '1966-census-general-report.pdf',
       'note': 'North Down RD (population 477 in 1961) to Bangor MB 1 Apr 1962; Bangor MB 2,664 ac 2 r 37 p.'}
SRO_1957_222 = {'label': 'Newtownabbey Urban District (Electoral Areas) Order (Northern Ireland) 1957 (S.R. & O. 1957 No. 222)',
                'url': 'https://www.legislation.gov.uk/nisro/1957/222/contents/made',
                'note': 'Seven wards of Newtownabbey UD; Ballyduff DED (Antrim RD), Ballygomartin DED (Lisburn RD) and an '
                        'addition to Carrickfergus Rural DED (Larne RD) formed from the transferred areas.'}
OUR_STARTS = ('Armagh UD', 'Lurgan UD extended', 'Bangor borough extended', 'Lurgan borough extended',
              'Belfast RD abolished', 'Armagh UD and Larne MB corrected')

NOTES = {
    'admin-areas-1945-04-01': {
        'changeNote': f'Armagh UD extended into Armagh RD (Armagh Urban District (Extension) Order, 1945). '
                      'Armagh UD, Keady UD and Armagh RD drawn.',
        'references': [
            {'label': 'Belfast Gazette issue 1239 (Armagh Urban District (Extension) Order, 1945)',
             'url': GAZ.format(1239),
             'note': '23 Mar 1945, page 69. Armagh County Council order of 13 Feb 1945, confirmed by the Ministry '
                     'of Health and Local Government 17 Mar 1945; in force from 1 Apr 1945. ' + RECON},
            {'label': 'Belfast Gazette issue 1254 (Armagh UD wards; Corporation East and West DEDs)',
             'url': GAZ.format(1254),
             'note': '6 Jul 1945, pages 151-152. Ministry orders of 27 Jun 1945 consequent on the extension.'},
        ],
    },
    'admin-areas-1946-06-11': {
        'changeNote': f'Armagh UD boundary altered and extended into Armagh RD (Armagh Urban District '
                      '(Alteration) Order, 1946).',
        'references': [
            {'label': 'Belfast Gazette issue 1309 (Armagh Urban District (Alteration) Order, 1946)',
             'url': GAZ.format(1309),
             'note': '26 Jul 1946, pages 183-184, with the full boundary description. County Council order of '
                     '11 Jun 1946, confirmed on appeal 17 Jul 1946; in force from 11 Jun 1946. 1951 Census: '
                     'Armagh UD 1,357 acres 3 roods 22 perches. ' + RECON},
            {'label': 'Belfast Gazette issue 1310 (Armagh UD wards; Corporation East, Corporation West and Grange DEDs)',
             'url': GAZ.format(1310),
             'note': '2 Aug 1946, pages 190-193. Ministry orders of 26 and 29 Jul 1946 consequent on the alteration.'},
        ],
    },
    'admin-areas-1938-04-01': {
        'changeNote': 'Lurgan UD extended into Lurgan RD (1937 order as modified on confirmation). '
                      '1951 Census: Lurgan 1,488 acres 0 roods 22 perches.',
        'references': [],
    },
    'admin-areas-1950-04-01': {
        'changeNote': 'Bangor borough extended (1950 Act). 1951 Census: Bangor MB 2,392 acres 1 rood 16 perches.',
        'references': [],
    },
    'admin-areas-1956-04-01': {
        'changeNote': 'Bangor borough extended (Bangor Borough (Extension) Order (NI) 1955) and Larne borough '
                      'extended (1956 Act), both in force 1 Apr 1956 (Census of Population 1961). ' + RECON,
        'references': [C61['down'], C61['antrim']],
    },
    'admin-areas-1957-04-01': {
        'changeNote': 'Lurgan borough extended into Lurgan RD, in force 1 Apr 1957 (Census of Population 1961; '
                      'instrument not yet identified). ' + RECON,
        'references': [C61['armagh']],
    },
    'admin-areas-1958-04-01': {
        'changeNote': 'Belfast RD abolished; Newtownabbey UD formed from part of it (whole townlands; the line west of '
                      'Glengormley is unresolved by about 100-200 acres). The rest went to Antrim, Lisburn and Larne '
                      'RDs, which are not drawn in this edition.',
        'references': [C61['antrim'], SRO_1957_222],
    },
    'admin-areas-1962-04-01': {
        'changeNote': 'Bangor borough extended (1962 Act). 1966 Census: Bangor MB 2,664 acres 2 roods 37 perches. ' + RECON,
        'references': [C66],
    },
    'admin-areas-1967-04-01': {
        'changeNote': 'Bangor borough extended (1966 Order, 1966 Act); line from the council's proposal map; the inquiry heard no objections, and the line's area (5,156 acres) is within 1% of the extended borough's in the 1971 Census (2,067.64 hectares, 5,109 acres). '
                      'Lurgan (Craigavon order) and Newtownabbey (1968) are not drawn from this edition.',
        'references': [],
    },
    'admin-areas-1966-07-04': {
        'changeNote': 'Armagh UD, Larne MB, Lurgan MB and Bangor MB corrected to the lines in force in 1966 (the source '
                      'layer had earlier extents), with their RDs adjusted; "Newtownabbey Rural District" (the old Belfast '
                      'RD extent) replaced by Newtownabbey UD, the rest of Belfast RD given to Antrim, Lisburn and Larne RDs.',
        'references': [C61['antrim'], C61['armagh'], C61['down'], C66],
    },
}


def main() -> None:
    plan = json.loads(PLAN.read_text(encoding='utf-8'))
    data = json.loads(PATH.read_text(encoding='utf-8'))  # read fresh, right before writing
    seen = set()
    for m in data['maps']:
        mid = m.get('id')
        if mid in plan:
            seen.add(mid)
            m.setdefault('files', {})['fgb'] = BASE + plan[mid]['file']
            if plan[mid]['cloneOf']:
                m['cloneOf'] = plan[mid]['cloneOf']
            else:
                m.pop('cloneOf', None)
        if mid in NOTES:
            note = NOTES[mid]
            cur = m.get('changeNote') or ''
            if not cur or cur.startswith(OUR_STARTS) or cur == note['changeNote']:
                m['changeNote'] = note['changeNote']
            elif note['changeNote'] not in cur:
                m['changeNote'] = cur + ' ' + note['changeNote']
            refs = m.get('references') or []
            have = {r.get('label') for r in refs}
            m['references'] = refs + [r for r in note['references'] if r['label'] not in have]
    missing = set(plan) - seen
    if missing:
        raise SystemExit(f'missing entries: {sorted(missing)}')
    with open(PATH, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f'patched {len(seen)} edition entries; notes on {len(NOTES)}')


if __name__ == '__main__':
    main()
