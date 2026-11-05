"""Load Civgraph's Northern Ireland election contests for checking against the Belfast Gazette.

Reads data/elections-source/data/elections/<body>/<date>/<slug>.json for the NI bodies and lays the
operations of data/elections/corrections/source-checked-fixes.json over each file, as
scripts/build-test2-election-manifest.mjs (applySourceCheckedFixes) does at build time, so the
comparison is against what the site shows rather than the raw import. Read-only.
"""
import copy, json, re, unicodedata
from pathlib import Path

NI_BODIES = [
    'parliament-of-northern-ireland', 'house-of-commons-of-the-united-kingdom', 'northern-ireland-assembly',
    'northern-ireland-constitutional-convention', 'northern-ireland-forum-for-political-dialogue',
    'local-government', 'european-parliament', 'belfast-county-borough-council',
    'belfast-county-borough-council-aldermen', 'strabane-urban-district-council',
    'bangor-urban-district-council', 'lisburn-urban-district-council', 'londonderry-county-borough-council',
    'armagh-county-council', 'armagh-urban-district-council', 'keady-urban-district-council', 'lurgan-borough-council', 'lurgan-rural-district-council', 'portadown-borough-council', 'armagh-rural-district-council', 'newry-no-2-rural-district-council', 'tandragee-rural-district-council', 'moira-rural-district-council', 'aghalee-rural-district-council', 'tandragee-urban-district-council', 'castleblayney-no-2-rural-district-council',
    'londonderry-county-borough-council-aldermen', 'antrim-town-commissioners', 'aughnacloy-town-commissioners', 'ballycastle-urban-district-council', 'ballyclare-urban-district-council', 'ballymena-borough-council', 'ballymoney-urban-district-council', 'banbridge-urban-district-council', 'bangor-borough-council', 'carrickfergus-borough-council', 'coleraine-borough-council', 'cookstown-urban-district-council', 'donaghadee-urban-district-council', 'downpatrick-urban-district-council', 'dromore-urban-district-council', 'dungannon-urban-district-council', 'enniskillen-borough-council', 'gilford-town-commissioners', 'holywood-urban-district-council', 'kilkeel-urban-district-council', 'larne-borough-council', 'limavady-urban-district-council', 'lisburn-borough-council', 'newcastle-urban-district-council', 'newry-urban-district-council', 'newtownabbey-urban-district-council', 'newtownards-borough-council', 'omagh-urban-district-council', 'portrush-urban-district-council', 'portstewart-urban-district-council', 'warrenpoint-urban-district-council', 'whitehead-urban-district-council',
]

# Westminster constituencies in Northern Ireland (1922 on), by normalised name, used to keep the
# all-UK Westminster folder down to NI contests.
NI_WESTMINSTER_WORDS = ('antrim', 'armagh', 'belfast', 'down', 'fermanagh', 'tyrone', 'londonderry', 'derry', 'foyle',
                        'queens university', 'lagan valley', 'strangford', 'newry', 'mid ulster', 'upper bann', 'mourne')


def norm(value):
    s = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode()
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = s.replace('&', ' and ')
    s = re.sub(r"['`’]", '', s)
    s = re.sub(r'[-_/.,()]', ' ', s)
    s = re.sub(r'\bconstituency\b', '', s, flags=re.I)
    return re.sub(r'\s+', ' ', s).strip().lower()


def row_name(row):
    return row.get('candidateName') or row.get('name') or f"{row.get('Firstname', '')} {row.get('Surname', '')}".strip()


def apply_fixes(raw, record):
    rows = lambda: raw.get('Constituency', {}).get('countGroup') or raw.get('candidates') or []
    for op in record.get('operations', []):
        kind = op.get('op')
        try:
            if kind == 'set':
                keys = str(op['path']).split('.')
                target = raw
                for k in keys[:-1]:
                    target = target.setdefault(k, {})
                target[keys[-1]] = op['value']
            elif kind in ('candidate', 'candidateCount'):
                for row in rows():
                    if norm(row_name(row)) == norm(op['name']) and (kind == 'candidate' or str(row.get('Count_Number')) == str(op.get('count'))):
                        row.update(op['set'])
            elif kind == 'candidateById':
                for row in rows():
                    if str(row.get('Candidate_Id', row.get('candidateId', ''))) == str(op['candidateId']):
                        row.update(op['set'])
            elif kind == 'addCandidate':
                lst = raw.get('Constituency', {}).get('countGroup')
                if lst is None:
                    lst = raw.setdefault('candidates', [])
                if not any(norm(row_name(r)) == norm(row_name(op['row'])) for r in lst):
                    lst.append(dict(op['row']))
            elif kind == 'addCandidateRows':
                lst = raw.get('Constituency', {}).get('countGroup')
                if lst is None:
                    lst = raw.setdefault('candidates', [])
                if op.get('rows') and not any(norm(row_name(r)) == norm(row_name(op['rows'][0])) for r in lst):
                    lst.extend(dict(r) for r in op['rows'])
            elif kind == 'replaceCandidates':
                raw['candidates'] = [dict(c) for c in op['candidates']]
                if 'Constituency' in raw:
                    raw['Constituency']['countGroup'] = []
            elif kind == 'replaceCountRows' and raw.get('Constituency', {}).get('countGroup') is not None:
                raw['Constituency']['countGroup'] = [dict(r) for r in op['rows']]
        except (KeyError, TypeError, AttributeError, IndexError):
            continue
    return raw


def num(v):
    try:
        return float(str(v).replace(',', ''))
    except (TypeError, ValueError):
        return None


def summarise(raw):
    """One contest: seats, electorate, candidates with first-count votes and status."""
    info = raw.get('Constituency', {}).get('countInfo', {}) if 'Constituency' in raw else {}
    cands = {}
    for row in raw.get('Constituency', {}).get('countGroup') or []:
        name = row_name(row)
        key = norm(name)
        if not key or key in ('non transferable', 'nontransferable', 'exhausted'):
            continue
        c = cands.setdefault(key, {'name': name, 'party': row.get('Party_Name') or '', 'status': '', 'votes': None,
                                   'id': row.get('Candidate_Id') or ''})
        if str(row.get('Count_Number', '1')) in ('1', ''):
            v = num(row.get('Candidate_First_Pref_Votes')) or num(row.get('Total_Votes'))
            if v is not None:
                c['votes'] = v
        if row.get('Status'):
            c['status'] = row['Status']
    for row in raw.get('candidates') or []:
        name = row.get('name') or row_name(row)
        key = norm(name)
        if not key:
            continue
        votes = row.get('first_pref')
        if votes is None and row.get('counts'):
            votes = row['counts'][0]
        cands[key] = {'name': name, 'party': row.get('party') or '', 'status': row.get('status') or '',
                      'votes': num(votes), 'id': row.get('sourcePersonId') or row.get('candidateId') or ''}
    vals = [c['votes'] for c in cands.values()]
    unopposed = all(v in (None, 0.0) for v in vals)
    return {
        'name': info.get('Constituency_Name') or raw.get('constituency') or '',
        'council': info.get('Council_Name') or '',
        'seats': info.get('Number_Of_Seats') or '',
        'electorate': info.get('Total_Electorate') or '',
        'valid_poll': info.get('Valid_Poll') or '',
        'candidates': list(cands.values()),
        'unopposed_or_no_figures': unopposed,
    }


def load(repo):
    repo = Path(repo)
    base = repo / 'data' / 'elections-source' / 'data' / 'elections'
    fixes_path = repo / 'data' / 'elections' / 'corrections' / 'source-checked-fixes.json'
    fixes = {}
    if fixes_path.exists():
        for rec in json.loads(fixes_path.read_text(encoding='utf-8')).get('records', []):
            fixes[rec['sourceFile'].replace('\\', '/')] = rec
    contests = []
    for body in NI_BODIES:
        bdir = base / body
        if not bdir.is_dir():
            continue
        for ddir in sorted(p for p in bdir.iterdir() if p.is_dir()):
            if body == 'house-of-commons-of-the-united-kingdom' and ddir.name < '1921':
                continue
            for f in sorted(ddir.glob('*.json')):
                if f.name.startswith('_'):
                    continue
                rel = f.relative_to(repo).as_posix()
                if body == 'house-of-commons-of-the-united-kingdom' and not any(re.search(r'\b' + w + r'\b', norm(f.stem.replace('-', ' '))) for w in NI_WESTMINSTER_WORDS):
                    continue
                try:
                    raw = json.loads(f.read_text(encoding='utf-8'))
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(raw, dict):
                    continue
                fixed = rel in fixes
                if fixed:
                    raw = apply_fixes(copy.deepcopy(raw), fixes[rel])
                s = summarise(raw)
                s.update({'body': body, 'date': ddir.name, 'slug': f.stem, 'file': rel, 'has_fix': fixed})
                if not s['name']:
                    s['name'] = f.stem.replace('-', ' ').title()
                contests.append(s)
    return contests
