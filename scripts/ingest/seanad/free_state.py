"""The Seanad of the Irish Free State (1922-1936) as election files (build_seanad.py's Free State
path), from data/elections/seanad-free-state.json (free_state_sources.py):

  the 1922 election by the Dáil, and the 1928, 1931 and 1934 elections by the Oireachtas: the
      winners only (countInfo Candidates_Recorded "winners"; the 1922 winners' first-preference
      values stay in the data file, as the losers' are not on record);
  the 1925 popular election: every candidate's first preferences and the count at which each was
      elected or excluded (the stage-by-stage figures are not on file);
  the by-elections: the winner only.

Every Free State seat was national, so each contest's constituency is "Irish Free State", and its
franchise says who voted. The 1922 nominations by the President of the Executive Council are not
elections: build_seanad_nominees.py writes them as tenures.
"""
from __future__ import annotations

import json
from pathlib import Path

CONSTITUENCY = 'Irish Free State'
SOURCE_FILE = 'data/elections/seanad-free-state.json'
BY_ELECTION_FRANCHISE = None  # who filled a casual vacancy is not stated in the sources on file


def contests(repo: Path, slug: str, body: str) -> list[tuple[str, dict, list[dict]]]:
    """(day, contest file, Oireachtas links) for every Free State election event."""
    doc = json.loads((repo / SOURCE_FILE).read_text(encoding='utf-8'))
    sources = doc['sources']
    out = []
    for event in doc['events']:
        if event['kind'] == 'nomination':
            continue
        day = event['date']
        cited = [sources['oireachtas']]
        if event['kind'] == 'general':
            cited.append(sources.get(f"wikipedia-{event['house']}-election") or sources[f"wikipedia-{event['house']}"])
            if event['house'] in ('1922', '1925'):
                cited.append(sources[f"wikipedia-{event['house']}"])
        else:
            cited.append(sources[f"wikipedia-{event['house']}"])
        rows, links = [], []
        full = event.get('candidatesRecorded') == 'all'
        ordered = sorted(event['candidates'], key=lambda c: -(c.get('firstPrefs') or 0)) if full else event['candidates']
        for index, cand in enumerate(ordered):
            name = cand['name']
            elected = cand.get('result', 'Elected').startswith('Elected')
            first, last = (name.split(' ', 1) + [''])[:2]
            row = {
                'Candidate_Id': str(index + 1), 'Count_Number': '1', 'Firstname': first, 'Surname': last, 'candidateName': name,
                'Party_Name': cand.get('party') or '',
                'Candidate_First_Pref_Votes': str(cand['firstPrefs']) if full else '', 'Transfers': '',
                'Total_Votes': str(cand['firstPrefs']) if full else '',
                'Status': 'Elected' if elected else 'Excluded',
                'Occurred_On_Count': str(cand.get('finalCount') or 1) if full else '1', 'source_person_id': '',
            }
            rows.append(row)
            if cand.get('code'):
                links.append({'system': 'oireachtas', 'id': cand['code'], 'election': f'{slug}__{day}', 'constituency': CONSTITUENCY,
                              'name': name, 'candidateId': str(index + 1), 'confidence': 'high'})
        seats = event.get('seats') or sum(1 for r in rows if r['Status'] == 'Elected')
        info = {'Constituency_Name': CONSTITUENCY, 'Number_Of_Seats': str(seats), 'Seat_Type': 'Senator'}
        if full:
            info.update({'Quota': str(event['quota']), 'Valid_Poll': str(event['validPoll']), 'Spoiled': str(event['spoilt']),
                         'Total_Poll': str(event['totalPoll']), 'Total_Electorate': str(event['electors'])})
        else:
            info['Candidates_Recorded'] = 'winners'
        notes = [f"Filed under {day}, the day the Houses of the Oireachtas give as the start of the "
                 + ("winner's membership." if event['kind'] == 'by-election' else f"{event['house']} Seanad's term.")]
        if event.get('pollDate'):
            notes.append(f"The poll was held on {event['pollDate']}.")
        if event['house'] == '1922' and event['kind'] == 'general':
            notes.append(f"{event['candidatesStood']} candidates stood; Wikipedia gives the first-preference values of the {seats} winners "
                         f"(kept in {SOURCE_FILE}), but not the others', so no figures are shown.")
        if full:
            notes.append('Only the first count and the count at which each candidate was elected or excluded are on file; '
                         'the transfers of the 65 counts are not.')
        if event.get('seatsNote'):
            notes.append(event['seatsNote'])
        source = cited[1]
        data = {
            'body': body, 'date': day, 'constituency': CONSTITUENCY, 'seats': seats,
            'source_url': source['url'],
            'source': {'title': source['title'], 'publisher': 'Wikimedia Foundation', 'url': source['url'], 'kind': 'web',
                       'check': ('The winners are the members the Houses of the Oireachtas seat from this day (api.oireachtas.ie, member '
                                 'codes); the article names them' + (', with the count.' if full else '.'))},
            'sources': [{'title': c['title'], 'publisher': c.get('publisher') or 'Wikimedia Foundation', 'url': c['url'], 'kind': c['kind']}
                        for c in cited if c is not source],
        }
        if event.get('electorate'):
            data['franchise'] = event['electorate']
        if event['kind'] == 'by-election' and event.get('replaced'):
            data['cause'] = f"To fill the seat of {event['replaced']} (Wikipedia, {event['house']} Seanad)"
        data['sourceNote'] = ' '.join(notes)
        data['Constituency'] = {'countInfo': info, 'countGroup': rows}
        out.append((day, data, links))
    return out
