#!/usr/bin/env python3
"""Build the Seanad Eireann election files from IrelandElection.com's parsed contests and the
Oireachtas members harvest (harvest_seanad.py).

Writes, for each Seanad general election whose count is on file:
  data/elections-source/data/elections/seanad-eireann/<date>/<contest>.json  (+ _index.json)
  the seanad-eireann body of data/elections-source/data/elections_index.json
  the Seanad links of data/elections/persons/official-person-ids.json (system oireachtas: the
    member code of each elected senator, matched in the Oireachtas list of that Seanad's members
    for the same panel or university)
and prints the arithmetic checks and the winners it could not match (the doubtful ones), which
it also writes to the report file given with --report.

An election is filed under the day the Oireachtas gives as the start of that Seanad's term
(api.oireachtas.ie houses): polling for a Seanad general election runs by post over several
weeks, and the term starts when the panel polls close. A contest is written only when its count
adds up (see check_contest); one that does not is reported and left out, never forced.

  python scripts/ingest/seanad/build_seanad.py --ie <irelandelection structured dir> [--report <csv>]
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CACHE = REPO / '.cache' / 'seanad'
OUT = REPO / 'data' / 'elections-source' / 'data' / 'elections' / 'seanad-eireann'
INDEX = REPO / 'data' / 'elections-source' / 'data' / 'elections_index.json'
OFFICIAL = REPO / 'data' / 'elections' / 'persons' / 'official-person-ids.json'
BODY = 'Seanad Éireann'
SLUG = 'seanad-eireann'
# IrelandElection.com numbers the Seanad general elections from 250 (April 1938, the 2nd Seanad).
IE_FIRST_ELECTION, FIRST_HOUSE = 250, 2
PANELS = ['Administrative Panel', 'Agricultural Panel', 'Cultural and Educational Panel', 'Industrial and Commercial Panel', 'Labour Panel']
UNIVERSITIES = ['National University of Ireland', 'University of Dublin']
CONTESTS = PANELS + UNIVERSITIES
PAPER_VALUE = 1000  # Seanad Electoral (Panel Members) Act 1947, Second Schedule: each paper is worth 1,000
PARTY_LABELS = {'Labour Party': 'Irish Labour', 'Green Party': 'Green', 'Solidarity - People Before Profit': 'Solidarity-PBP'}
PANEL_ELECTORATE = ('the members of the incoming Dáil, the outgoing Seanad and the city and county councils '
                    '(Seanad Electoral (Panel Members) Act 1947, s. 44)')
UNIVERSITY_ELECTORATE = {
    'National University of Ireland': "the university's graduates who are Irish citizens and registered (Seanad Electoral (University Members) Act 1937)",
    'University of Dublin': "the university's graduates and scholars who are Irish citizens and registered (Seanad Electoral (University Members) Act 1937)",
}
OIREACHTAS_MEMBER_URL = 'https://www.oireachtas.ie/en/members/member/{id}/'


def fold(text: str) -> str:
    text = unicodedata.normalize('NFKD', str(text or '')).encode('ascii', 'ignore').decode('ascii').lower()
    text = re.sub(r"[’'`.]", '', text)
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def slugify(text: str) -> str:
    return fold(text).replace(' ', '-')


def houses() -> dict[int, dict]:
    doc = json.loads((CACHE / 'oireachtas' / 'houses.json').read_text(encoding='utf-8'))
    return {int(r['house']['houseNo']): r['house'] for r in doc['results'] if str(r['house']['houseNo']).isdigit()}


def members_of(house_no: int) -> list[dict]:
    """The members elected to a panel or university at the start of a term: code, names, contest."""
    doc = json.loads((CACHE / 'oireachtas' / f'house-{house_no}.json').read_text(encoding='utf-8'))
    out = []
    for row in doc['results']:
        member = row['member']
        for wrapped in member['memberships']:
            ms = wrapped['membership']
            if ms['house']['houseCode'] != 'seanad' or str(ms['house']['houseNo']) != str(house_no):
                continue
            for rep in ms['represents']:
                contest = rep['represent']['showAs']
                if contest in CONTESTS:
                    out.append({'code': member['memberCode'], 'name': member['fullName'], 'first': member.get('firstName') or '',
                                'last': member.get('lastName') or '', 'contest': contest, 'start': ms['dateRange']['start']})
    return out


def match_winner(name: str, contest: str, members: list[dict], term_start: str) -> tuple[dict | None, str]:
    """The Oireachtas member a winner is: one of those seated for the same panel or university
    within four months of the term's start, by the same name (accents, punctuation and spacing
    aside), else the only one with the same surname and first initial, else the only one with
    the same surname."""
    seen, pool = set(), []
    for m in members:
        if m['contest'] == contest and abs(day_number(m['start']) - day_number(term_start)) <= 120 and m['code'] not in seen:
            seen.add(m['code'])
            pool.append(m)
    compact = lambda text: fold(text).replace(' ', '')
    exact = [m for m in pool if compact(m['name']) == compact(name)]
    if len(exact) == 1:
        return exact[0], 'name'
    words = fold(name).split()
    surname = lambda m: compact(m['last']).endswith(compact(words[-1])) if words else False
    near = [m for m in pool if surname(m) and fold(m['first'])[:1] == words[0][:1]]
    if len(near) == 1:
        return near[0], 'surname and initial'
    by_surname = [m for m in pool if surname(m)]
    if len(by_surname) == 1:
        return by_surname[0], 'surname alone'
    return None, f'{len(exact)} by name, {len(near)} by surname and initial, {len(by_surname)} by surname'


def day_number(iso: str) -> int:
    from datetime import date
    return date.fromisoformat(iso[:10]).toordinal()


def check_contest(contest: str, ie: dict) -> list[str]:
    """The arithmetic: first preferences add up to the valid poll (valued at 1,000 a paper on a
    panel), the quota is the Droop quota of that poll, no count's total exceeds it, and the
    winners fill the seats."""
    problems = []
    seats = int(ie['seats'])
    value = PAPER_VALUE if contest in PANELS else 1
    firsts = [c['first_pref'] or 0 for c in ie['candidates']]
    poll = sum(firsts)
    quota = poll // (seats + 1) + 1
    if ie.get('quota') and int(ie['quota']) != quota:
        problems.append(f'quota {ie["quota"]}, but the first preferences ({poll}) over {seats} seats give {quota}')
    if ie.get('valid') and poll > int(ie['valid']) * value:
        problems.append(f'first preferences add up to {poll}, more than the valid poll {ie["valid"]} x {value}')
    for n in range(max((len(c['counts']) for c in ie['candidates']), default=0)):
        total = sum((c['counts'][n] or 0) for c in ie['candidates'] if n < len(c['counts']) and c['counts'][n] is not None)
        if total > poll:
            problems.append(f'count {n + 1} totals {total}, more than the valid poll {poll}')
    for c in ie['candidates']:
        counts, transfers = c['counts'], c['transfers']
        for n in range(1, len(counts)):
            if counts[n] is None or counts[n - 1] is None or transfers[n] is None:
                continue
            if counts[n - 1] + transfers[n] != counts[n]:
                problems.append(f'{c["name"]}: count {n} {counts[n - 1]} {transfers[n]:+d} is not count {n + 1} {counts[n]}')
    elected = sum(1 for c in ie['candidates'] if c['elected'])
    if elected != seats:
        problems.append(f'{elected} elected for {seats} seats')
    return problems


def contest_file(contest: str, date: str, house: dict, ie: dict, links: list, doubtful: list, members: list) -> dict:
    panel = contest in PANELS
    seats = int(ie['seats'])
    rows = []
    for index, cand in enumerate(sorted(ie['candidates'], key=lambda c: -(c['first_pref'] or 0))):
        name = cand['name']
        counts = cand['counts']
        last = max((n for n, v in enumerate(counts) if v is not None), default=0)
        decided = cand.get('elected_at_count') if cand['elected'] else last + 1
        party = PARTY_LABELS.get(cand['party'], cand['party']) or ''
        for n, total in enumerate(counts):
            if total is None:
                continue
            status = ''
            if cand['elected'] and n + 1 == cand.get('elected_at_count'):
                status = 'Elected'
            elif not cand['elected'] and n == last:
                status = 'Excluded'
            transfer = cand['transfers'][n] if n < len(cand['transfers']) else None
            rows.append({
                'Candidate_Id': str(index + 1),
                'Count_Number': str(n + 1),
                'Firstname': name.split(' ', 1)[0],
                'Surname': name.split(' ', 1)[1] if ' ' in name else '',
                'candidateName': name,
                'Party_Name': party,
                'Candidate_First_Pref_Votes': str(cand['first_pref'] or 0),
                'Transfers': '' if transfer is None else str(transfer),
                'Total_Votes': str(total),
                'Status': status,
                'Occurred_On_Count': str(decided or n + 1),
                'source_person_id': cand.get('source_person_id') or '',
            })
        if cand['elected']:
            member, how = match_winner(name, contest, members, house['dateRange']['start'])
            if member:
                links.append({'system': 'oireachtas', 'id': member['code'], 'election': f'{SLUG}__{date}', 'constituency': contest,
                              'name': name, 'candidateId': str(index + 1), 'confidence': 'high' if how == 'name' else 'medium'})
                if how != 'name':
                    doubtful.append({'election': date, 'contest': contest, 'name': name, 'oireachtas': member['name'], 'code': member['code'], 'note': f'matched by {how}'})
            else:
                doubtful.append({'election': date, 'contest': contest, 'name': name, 'oireachtas': '', 'code': '', 'note': f'no Oireachtas member matched ({how})'})
    valid_poll = sum(c['first_pref'] or 0 for c in ie['candidates'])
    info = {
        'Constituency_Name': contest,
        'Number_Of_Seats': str(seats),
        'Quota': str(ie['quota'] or ''),
        'Valid_Poll': str(valid_poll),
        'Total_Electorate': '' if panel else str(ie.get('electorate') or ''),
        'Spoiled': '' if panel or ie.get('spoilt') is None else str(ie['spoilt']),
        'Total_Poll': '' if panel or ie.get('spoilt') is None else str(valid_poll + int(ie['spoilt'])),
        'Seat_Type': 'Senator',
    }
    ie_url = ie['pages'].get('electiondetail') or ie['pages'].get('election')
    out = {
        'body': BODY,
        'date': date,
        'constituency': contest,
        'seats': seats,
        'source_url': ie_url,
        'source': {
            'title': f"IrelandElection.com, {ie['election_label']}: {ie['constituency']}",
            'publisher': 'IrelandElection.com',
            'url': ie_url,
            'kind': 'web',
            'check': (f"The count is IrelandElection.com's; the first preferences add up to the valid poll and the {seats} winners "
                      f"fill the seats. Each winner was checked against the Houses of the Oireachtas list of the members of the "
                      f"{house['showAs']} for this {'panel' if panel else 'constituency'} (api.oireachtas.ie, seanad-build, Nov 2026)."),
        },
        'franchise': PANEL_ELECTORATE if panel else UNIVERSITY_ELECTORATE[contest],
        'sourceNote': (f"Filed under {date}, the day the Houses of the Oireachtas give as the start of the {house['showAs']}; "
                       'a Seanad general election is held by post, and its polls close over several days.'),
    }
    papers_given = ie.get('valid')
    if papers_given and valid_poll < int(papers_given) * (PAPER_VALUE if panel else 1):
        out['correctionNote'] = (f"IrelandElection.com gives {int(papers_given):,} valid papers, but the first preferences add up to "
                                 f"{valid_poll:,}{' (' + format(valid_poll // PAPER_VALUE, ',') + ' papers)' if panel else ''}, and the quota of "
                                 f"{int(ie['quota']):,} is the quota of that poll: the valid poll here is the first preferences' total.")
    if panel:
        papers = valid_poll // PAPER_VALUE
        out['countSourceNote'] = (f'Each valid ballot paper is valued at 1,000 so that fractions of a vote can be transferred '
                                  f'(Seanad Electoral (Panel Members) Act 1947): {int(papers):,} valid papers make a valid poll of {valid_poll:,}, '
                                  'and every figure is a value, not a number of papers.' if papers else
                                  'Each valid ballot paper is valued at 1,000 so that fractions of a vote can be transferred; every figure is a value.')
        if ie.get('electorate'):
            out['electorateNote'] = f"{int(ie['electorate']):,} electors: {PANEL_ELECTORATE}."
        out['note'] = ('The panel has two sub-panels, candidates nominated by members of the Oireachtas and candidates '
                       'nominated by registered nominating bodies, and a minimum number of seats goes to each.')
    out['Constituency'] = {'countInfo': {k: v for k, v in info.items()}, 'countGroup': rows}
    return out


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--ie', required=True, help="IrelandElection.com's structured folder (index.jsonl, contests/)")
    parser.add_argument('--report', help='write the doubtful matches and the contests left out to this CSV')
    args = parser.parse_args(argv)
    ie_dir = Path(args.ie)
    terms = houses()
    contests = [json.loads(line) for line in (ie_dir / 'index.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    contests = [c for c in contests if c['election_type'] == 'seanad' and c['constituency'] in CONTESTS and c['num_counts']]
    links, doubtful, left_out, dates = [], [], [], {}
    for entry in sorted(contests, key=lambda c: (c['key'].split('_')[1], CONTESTS.index(c['constituency']))):
        house_no = int(entry['key'].split('_')[1]) - IE_FIRST_ELECTION + FIRST_HOUSE
        house = terms[house_no]
        date = house['dateRange']['start']
        ie = json.loads((ie_dir / 'contests' / f"{entry['key']}.json").read_text(encoding='utf-8'))
        problems = check_contest(entry['constituency'], ie)
        if problems:
            left_out.append({'election': date, 'contest': entry['constituency'], 'name': '', 'oireachtas': '', 'code': '', 'note': '; '.join(problems)})
            print(f"{date} {entry['constituency']}: does not add up: {'; '.join(problems)}", file=sys.stderr)
            continue
        data = contest_file(entry['constituency'], date, house, ie, links, doubtful, members_of(house_no))
        folder = OUT / date
        folder.mkdir(parents=True, exist_ok=True)
        name = f"{slugify(entry['constituency'])}.json"
        (folder / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        dates.setdefault(date, []).append({'name': entry['constituency'], 'seats': int(ie['seats']), 'candidates': len(ie['candidates']),
                                           'quota': ie['quota'], 'file': name})
    for date, items in dates.items():
        (OUT / date / '_index.json').write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

    index = json.loads(INDEX.read_text(encoding='utf-8'))
    body = {'name': BODY, 'slug': SLUG, 'dates': [{'date': d, 'constituencies': [i['name'] for i in items]} for d, items in sorted(dates.items(), reverse=True)]}
    bodies = [b for b in index['bodies'] if b.get('slug') != SLUG]
    at = next((i for i, b in enumerate(bodies) if b.get('slug') == 'dail-eireann'), len(bodies) - 1) + 1
    bodies.insert(at, body)
    index['bodies'] = bodies
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

    official = json.loads(OFFICIAL.read_text(encoding='utf-8'))
    official['links'] = [l for l in official['links'] if not str(l.get('election', '')).startswith(f'{SLUG}__')] + links
    OFFICIAL.write_text(json.dumps(official, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')

    print(f'{sum(len(v) for v in dates.values())} contests in {len(dates)} elections; {len(links)} winners linked to Oireachtas member codes; '
          f'{len(doubtful)} doubtful; {len(left_out)} contests left out')
    if args.report:
        with open(args.report, 'w', encoding='utf-8', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=['election', 'contest', 'name', 'oireachtas', 'code', 'note'])
            writer.writeheader()
            writer.writerows(doubtful + left_out)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
