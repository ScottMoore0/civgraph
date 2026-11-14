#!/usr/bin/env python3
"""Write the senators nominated by the Taoiseach as tenures of the office seanad-taoiseach-nominee
(the facts model, docs/facts-model.md): an appointment, not an election, so no contest files.

Reads the Oireachtas members harvest (harvest_seanad.py: .cache/seanad/oireachtas/house-<n>.json,
the Seanads of 1938 on), whose memberships say "Nominated by the Taoiseach", and writes:
  data/offices/tenures/seanad.json                  one tenure per nominated membership
  data/offices/offices.json                         the institution seanad-eireann and the office
                                                    (added once, never rewritten)
  data/elections/persons/non-candidate-persons.json a registered person for each nominee who never
                                                    stood in an election Civgraph holds

Who each nominee is:
  1. the person the registry holds with the nominee's Oireachtas member code (a candidate record:
     data/elections/persons/person_registry.json, officialPersonIds oireachtas:<code>);
  2. else the row of data/elections/persons/seanad-nominee-checks.csv (checked by hand against the
     nominee's biography): 'join' names the person, 'register' makes a registered non-candidate
     (the one already registered with that code, or a new id in the 900001 block), 'hold' writes
     no tenure (the check could not settle who the nominee is);
  3. else the build fails: a nominee is never joined by name alone.
A code join that disagrees with a 'join' row of the checks file is reported (the code wins).

  python scripts/ingest/seanad/build_seanad_nominees.py [--check]
"""
from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
import urllib.parse
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CACHE = REPO / '.cache' / 'seanad' / 'oireachtas'
OFFICES = REPO / 'data' / 'offices' / 'offices.json'
TENURES = REPO / 'data' / 'offices' / 'tenures' / 'seanad.json'
REGISTRY = REPO / 'data' / 'elections' / 'persons' / 'person_registry.json'
NON_CANDIDATES = REPO / 'data' / 'elections' / 'persons' / 'non-candidate-persons.json'
CHECKS = REPO / 'data' / 'elections' / 'persons' / 'seanad-nominee-checks.csv'
NOMINATED = 'Nominated by the Taoiseach'
OFFICE_ID = 'seanad-taoiseach-nominee'
INSTITUTION = {'id': 'seanad-eireann', 'name': 'Seanad Éireann', 'kind': 'legislature', 'jurisdiction': 'ireland', 'bodySlug': 'seanad-eireann'}
OFFICE = {
    'id': OFFICE_ID, 'name': 'Senator nominated by the Taoiseach', 'institution': 'seanad-eireann', 'jurisdiction': 'ireland',
    'kind': 'nominated-member', 'start': '1938-04-27', 'startPrecision': 'day', 'end': None, 'endPrecision': None, 'nameHistory': [],
    'note': ('Eleven of the sixty senators are nominated by the Taoiseach (Bunreacht na hÉireann, Article 18.3), among them '
             'nominations to fill a vacancy. Each tenure is a membership of one Seanad, as the Houses of the Oireachtas record it.'),
    'citations': [{'kind': 'official', 'title': 'Bunreacht na hÉireann, Article 18.3', 'publisher': 'Government of Ireland',
                   'url': 'https://www.irishstatutebook.ie/eli/cons/en/html'}],
}
FREE_STATE = REPO / 'data' / 'elections' / 'seanad-free-state.json'
FREE_STATE_OFFICE = {
    'id': 'seanad-free-state-nominee', 'name': 'Senator nominated by the President of the Executive Council', 'institution': 'seanad-eireann',
    'jurisdiction': 'ireland', 'kind': 'nominated-member', 'start': '1922-12-06', 'startPrecision': 'day', 'end': '1934-12-05',
    'endPrecision': 'day', 'nameHistory': [],
    'note': ('Thirty of the first sixty senators of the Irish Free State were nominated by the President of the Executive Council, '
             'W. T. Cosgrave, on 6 December 1922, fifteen for six years and fifteen for twelve (Constitution of the Irish Free State, '
             'Article 82). A vacancy among them was filled by election.'),
    'citations': [{'kind': 'web', 'title': 'Wikipedia, "1922 Seanad"', 'url': 'https://en.wikipedia.org/wiki/1922_Seanad', 'accessed': '2026-11-14'}],
}
ACCESSED = '2026-11-14'
MEMBER_URL = 'https://www.oireachtas.ie/en/members/member/{code}/'


def fold(text: str) -> str:
    text = unicodedata.normalize('NFKD', str(text or '')).encode('ascii', 'ignore').decode('ascii').lower()
    text = re.sub(r"[’'`.]", '', text)
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def ordinal(n: int) -> str:
    if n >= 1922:
        return str(n)  # the Free State Seanads are named by year
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def member_citation(code: str, name: str) -> dict:
    return {'kind': 'official', 'title': f'Houses of the Oireachtas, member record: {name}', 'publisher': 'Houses of the Oireachtas',
            'url': MEMBER_URL.format(code=urllib.parse.quote(code, safe="-.'")), 'accessed': ACCESSED}


def nominations() -> list[dict]:
    """Every nominated membership of the Seanads of 1938 on: member code, name, date of death, the
    Seanad and its dates, and the membership's own dates."""
    houses = json.loads((CACHE / 'houses.json').read_text(encoding='utf-8'))
    terms = {int(r['house']['houseNo']): r['house'] for r in houses['results'] if int(r['house']['houseNo']) < 100}
    out = []
    for number in sorted(terms):
        doc = json.loads((CACHE / f'house-{number}.json').read_text(encoding='utf-8'))
        for row in doc['results']:
            member = row['member']
            for wrapped in member['memberships']:
                ms = wrapped['membership']
                if ms['house']['houseCode'] != 'seanad' or str(ms['house']['houseNo']) != str(number):
                    continue
                if not any(r['represent']['showAs'] == NOMINATED for r in ms['represents']):
                    continue
                out.append({'code': member['memberCode'], 'name': member['fullName'], 'died': (member.get('dateOfDeath') or '')[:10],
                            'house': number, 'houseEnd': terms[number]['dateRange'].get('end'),
                            'start': ms['dateRange']['start'][:10], 'end': (ms['dateRange'].get('end') or '')[:10] or None})
    out.sort(key=lambda n: (n['start'], fold(n['name'])))
    for n in out:
        n['office'], n['note'] = OFFICE_ID, f"{ordinal(n['house'])} Seanad"
    return out + free_state_nominations()


def free_state_nominations() -> list[dict]:
    """The thirty senators the President of the Executive Council nominated on 6 December 1922
    (data/elections/seanad-free-state.json), each for six or twelve years: the tenure runs from
    that day through the member's unbroken membership of the Free State Seanads, to the end of the
    term or the day the membership ended before it."""
    doc = json.loads(FREE_STATE.read_text(encoding='utf-8'))
    event = next(e for e in doc['events'] if e['kind'] == 'nomination')
    spans: dict[str, list[tuple[str, str | None]]] = {}
    died: dict[str, str] = {}
    for house in ('1922', '1925', '1928', '1931', '1934'):
        for row in json.loads((CACHE / f'house-{house}.json').read_text(encoding='utf-8'))['results']:
            member = row['member']
            died[member['memberCode']] = (member.get('dateOfDeath') or '')[:10]
            for wrapped in member['memberships']:
                ms = wrapped['membership']
                if ms['house']['houseCode'] == 'seanad' and ms['house']['houseNo'] == house:
                    spans.setdefault(member['memberCode'], []).append((ms['dateRange']['start'][:10], (ms['dateRange'].get('end') or '')[:10] or None))
    out = []
    for m in event['members']:
        if not m.get('code'):
            sys.exit(f"FAIL: {FREE_STATE.name}: the 1922 nominee {m['name']} has no member code")
        start = event['date']
        term_end = f"{int(start[:4]) + m['termYears']}-12-05"
        end = start
        for s, e in sorted(spans.get(m['code'], [])):
            if s > end and (date.fromisoformat(s) - date.fromisoformat(end)).days > 1:
                break  # a later membership after a break is another seat
            end = min(e or term_end, term_end)
            if end == term_end:
                break
        out.append({'code': m['code'], 'name': m['name'], 'died': died.get(m['code'], ''), 'house': 1922, 'houseEnd': term_end,
                    'start': start, 'end': end, 'office': FREE_STATE_OFFICE['id'],
                    'note': f"Nominated for {m['termYears']} years (Constitution of the Irish Free State, Article 82)"})
    return out


def read_checks() -> dict[str, dict]:
    if not CHECKS.exists():
        return {}
    out = {}
    with open(CHECKS, encoding='utf-8', newline='') as handle:
        for row in csv.DictReader(handle):
            if row['oireachtas_code'] in out or row['verdict'] not in ('join', 'register', 'hold'):
                sys.exit(f"FAIL: {CHECKS.name}: {row['oireachtas_code']} is listed twice or has an unknown verdict")
            if row['verdict'] == 'join' and not re.fullmatch(r'[1-9]\d*', row['person_id'] or ''):
                sys.exit(f"FAIL: {CHECKS.name}: {row['oireachtas_code']} joins no person id")
            out[row['oireachtas_code']] = row
    return out


def ended(n: dict) -> str | None:
    if not n['end']:
        return None
    if n['died'] and n['died'] == n['end']:
        return 'died'
    if n['houseEnd'] and n['end'] == n['houseEnd'][:10]:
        return 'term-ended'
    return None


def main(argv: list[str]) -> int:
    check_only = '--check' in argv
    registry = json.loads(REGISTRY.read_text(encoding='utf-8'))['entities']
    candidate_of: dict[str, str] = {}
    known_ids = {str(e['personId']) for e in registry}
    candidate_names: set[str] = set()
    for entity in registry:
        if entity.get('keyedBy') == 'registered':
            continue
        candidate_names.update(fold(k) for k in [entity.get('displayName'), *(entity.get('aliases') or []), *(entity.get('matchKeys') or [])] if k)
        for official in entity.get('officialPersonIds') or []:
            if official.startswith('oireachtas:'):
                candidate_of[official[len('oireachtas:'):]] = str(entity['personId'])
    nc_doc = json.loads(NON_CANDIDATES.read_text(encoding='utf-8'))
    registered_of = {o[len('oireachtas:'):]: p['personId'] for p in nc_doc['persons'] for o in p['officialPersonIds'] if o.startswith('oireachtas:')}
    checks = read_checks()
    rows = nominations()

    tenures, held, unsettled, conflicts, new_people = [], [], [], [], []
    next_id = max(int(p['personId']) for p in nc_doc['persons']) + 1
    for n in rows:
        code, check = n['code'], checks.get(n['code'])
        if code in candidate_of:
            person, how = candidate_of[code], 'Oireachtas member code, held with the candidate record'
            if check and check['verdict'] != 'hold' and check.get('person_id') and check['person_id'] != person:
                conflicts.append(f"{code}: member code joins {person}, {CHECKS.name} says {check['verdict']} {check['person_id']}")
        elif check and check['verdict'] == 'join':
            person, how = check['person_id'], f'name and career, checked against the biography ({CHECKS.name})'
            if person not in known_ids:
                sys.exit(f'FAIL: {CHECKS.name}: {code} joins {person}, which is not in {REGISTRY.name}')
        elif (check and check['verdict'] == 'register') or (not check and code in registered_of) or (not check and fold(n['name']) not in candidate_names):
            # registered: the check says so, or the member is registered already, or no candidate
            # record of the name exists at all (a name alone never joins, and never needs to here)
            person = registered_of.get(code)
            if not person:
                person = f'{next_id:06d}'
                next_id += 1
                registered_of[code] = person
                new_people.append({'personId': person, 'key': fold(n['name']), 'displayName': n['name'], 'aliases': [n['name']],
                                   'officialPersonIds': [f'oireachtas:{code}'], 'basis': [n['office']],
                                   'citations': [member_citation(code, n['name'])],
                                   **({'died': n['died'], 'lifeSource': 'Houses of the Oireachtas'} if n['died'] else {})})
            how = 'registered non-candidate (Oireachtas member code)' if check or code in registered_of else 'registered non-candidate: no candidate record of the name (Oireachtas member code)'
        elif check and check['verdict'] == 'hold':
            held.append(f"{code} ({n['name']}, {ordinal(n['house'])} Seanad)")
            continue
        else:
            unsettled.append(f"{code} ({n['name']}, {ordinal(n['house'])} Seanad)")
            continue
        tenures.append({
            'id': f"{n['office']}:{int(person)}:{n['start']}", 'personId': str(int(person)), 'officeId': n['office'],
            'start': n['start'], 'startPrecision': 'day', 'end': n['end'], 'endPrecision': 'day' if n['end'] else None,
            'began': 'appointed', 'ended': ended(n), 'note': n['note'], 'matchedBy': how,
            'citations': [member_citation(code, n['name'])],
        })
    if unsettled:
        print(f'FAIL: {len(unsettled)} nominee(s) join no person by member code and are not in {CHECKS.name}:', file=sys.stderr)
        for line in unsettled:
            print(f'  {line}', file=sys.stderr)
        return 1
    ids = [t['id'] for t in tenures]
    if len(ids) != len(set(ids)):
        sys.exit('FAIL: two tenures share an id')

    print(f'{len(tenures)} tenures of {len({t["personId"] for t in tenures})} people from {len(rows)} nominated memberships; '
          f'{len(new_people)} newly registered; {len(held)} held back (not written); {len(conflicts)} code/check disagreement(s)')
    for line in held:
        print(f'  held: {line}')
    for line in conflicts:
        print(f'  disagreement: {line}')
    if check_only:
        return 0

    offices = json.loads(OFFICES.read_text(encoding='utf-8'))
    if not any(i['id'] == INSTITUTION['id'] for i in offices['institutions']):
        offices['institutions'].append(INSTITUTION)
    for office in (OFFICE, FREE_STATE_OFFICE):
        if not any(o['id'] == office['id'] for o in offices['offices']):
            offices['offices'].append(office)
    OFFICES.write_text(json.dumps(offices, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    TENURES.write_text(json.dumps({
        'schemaVersion': 1,
        'description': ('Tenures of Seanad Éireann offices: the senators nominated by the Taoiseach, one tenure per membership of a '
                        'Seanad, and the thirty nominated by the President of the Executive Council in 1922, from the Houses of the '
                        'Oireachtas member records (api.oireachtas.ie). Written by '
                        'scripts/ingest/seanad/build_seanad_nominees.py; the people are joined by member code, or by the checks in '
                        'data/elections/persons/seanad-nominee-checks.csv. Schema: data/schemas/tenures.schema.json.'),
        'tenures': tenures,
    }, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    if new_people:
        nc_doc['persons'].extend(new_people)
        NON_CANDIDATES.write_text(json.dumps(nc_doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
