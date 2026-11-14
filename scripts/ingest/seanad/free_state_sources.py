#!/usr/bin/env python3
"""Gather what the sources hold on the Seanad of the Irish Free State (1922-1936) into one file,
data/elections/seanad-free-state.json, for the election files to be written from (facts and
citations only; offline, from the harvest_seanad.py cache).

  * the Houses of the Oireachtas member lists of the 1922, 1925, 1928, 1931 and 1934 Seanads
    (.cache/seanad/oireachtas/house-<year>.json): every member with the member code (the official
    person id) and the start of each membership: a start on the day a Seanad began is a general
    election (or, in 1922, a nomination); a start in mid-term is a by-election;
  * Wikipedia's articles on each Seanad (.cache/seanad/wikipedia/<year> Seanad.json): which of the
    1922 members were elected by the Dail and which nominated by the President of the Executive
    Council, the term each was elected for, each member's party, and the by-elections (who was
    elected, on what day, to replace whom);
  * Wikipedia's 1922 Seanad election article: the winners' first-preference values and the count
    each was elected at (the losers are not listed there);
  * Wikipedia's 1925 Seanad election article: every candidate's first preferences, final result
    and final count (after Coakley 2005), and the poll's totals.

Each member is joined to the Oireachtas list by name within the same Seanad; a member the list
does not hold is reported, never guessed.

  python scripts/ingest/seanad/free_state_sources.py [--check]
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CACHE = REPO / '.cache' / 'seanad'
OUT = REPO / 'data' / 'elections' / 'seanad-free-state.json'
HOUSES = ['1922', '1925', '1928', '1931', '1934']
MONTHS = {m: i + 1 for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                                         'September', 'October', 'November', 'December'])}
PARTIES = {'Independent politician (Ireland)': 'Independent', 'Labour Party (Ireland)': 'Labour Party',
           "Farmers' Party (Ireland)": "Farmers' Party", 'Cumann na nGaedheal': 'Cumann na nGaedheal', 'Fianna Fáil': 'Fianna Fáil',
           'Fine Gael': 'Fine Gael', 'Independent Fianna Fáil': 'Independent Fianna Fáil'}
WIKI = 'https://en.wikipedia.org/wiki/{}'


def fold(text: str) -> str:
    text = unicodedata.normalize('NFKD', str(text or '')).encode('ascii', 'ignore').decode('ascii').lower()
    text = re.sub(r"[’'`.]", '', text)
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def wikitext(title: str) -> str:
    return json.loads((CACHE / 'wikipedia' / f'{title}.json').read_text(encoding='utf-8'))['parse']['wikitext']


def strip_refs(text: str) -> str:
    text = re.sub(r'<ref[^>]*/>', '', text)
    text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.S)
    return re.sub(r'\{\{(efn|sfn)[^{}]*(\{\{[^{}]*\}\}[^{}]*)*\}\}', '', text)


def link_name(text: str) -> tuple[str, str]:
    """(display name, article title) of the first wiki link in text, else the text itself."""
    m = re.search(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', text)
    if not m:
        return text.strip(), ''
    return (m.group(2) or m.group(1)).strip(), m.group(1).strip()


def sortname(text: str) -> tuple[str, str]:
    """{{sortname|First|Last|Article|dab=...}}: the display name and the article title."""
    parts = [p.strip() for p in text.split('|')]
    first, last = parts[1], parts[2]
    named = {k.strip(): v.strip() for k, v in (p.split('=', 1) for p in parts[3:] if '=' in p)}
    positional = [p for p in parts[3:] if '=' not in p and p]
    name = f'{first} {last}'.strip()
    title = positional[0] if positional else (f"{name} ({named['dab']})" if 'dab' in named else name)
    return name, title


def members_of(house: str) -> list[dict]:
    doc = json.loads((CACHE / 'oireachtas' / f'house-{house}.json').read_text(encoding='utf-8'))
    out = []
    for row in doc['results']:
        member = row['member']
        for wrapped in member['memberships']:
            ms = wrapped['membership']
            if ms['house']['houseCode'] == 'seanad' and ms['house']['houseNo'] == house:
                parties = [p['party']['showAs'] for p in ms.get('parties') or []]
                out.append({'code': member['memberCode'], 'name': member['fullName'], 'first': member.get('firstName') or '',
                            'last': member.get('lastName') or '', 'start': ms['dateRange']['start'][:10],
                            'end': (ms['dateRange'].get('end') or '')[:10] or None, 'party': parties[0] if parties else ''})
    return out


def match(name: str, title: str, pool: list[dict]) -> dict | None:
    """The member of the Oireachtas list a Wikipedia name is: the same name (as Wikipedia shows
    it, or as its article is titled, a peer's title aside: "Bernard Forbes, 8th Earl of Granard"),
    matched against the list's name or the name in its member code ("William-Hutcheson-Poë"),
    Mac and Mc alike; else the only one with the same surname and first initial; else the only
    one with the same surname."""
    compact = lambda text: re.sub(r'^mac', 'mc', fold(text).replace(' ', ''))
    code_name = lambda m: re.sub(r'\.[SD]\.\d{4}-\d{2}-\d{2}$', '', m['code']).replace('-', ' ')
    keys = {compact(k) for k in (name, re.sub(r'\s*\(.*\)$', '', title), title.split(',')[0]) if k}
    exact = [m for m in pool if compact(m['name']) in keys or compact(code_name(m)) in keys]
    if len(exact) == 1:
        return exact[0]
    words = [re.sub(r'^mac', 'mc', w) for w in fold(re.sub(r'^(Sir|Dr|the|Countess of|Earl of|Marquess of)\s+', '', name, flags=re.I)).split()]
    if not words:
        return None
    has_surname = lambda m: any(compact(x).endswith(words[-1]) or compact(x).startswith(words[-1]) for x in (m['last'], m['name'], code_name(m)))
    surname = [m for m in pool if has_surname(m)]
    near = [m for m in surname if fold(m['first'])[:1] == words[0][:1]]
    if len(near) == 1:
        return near[0]
    return surname[0] if len(surname) == 1 else None


def list_groups(house: str) -> list[dict]:
    """The 'List of senators' of a Seanad article: each group ('Elected in 1928 for 9 years') and
    its members with their party."""
    text = wikitext(f'{house} Seanad')
    text = text[text.find('==List of senators'):]
    out = []
    for block in re.findall(r'\{\{Multi seat constituency\n(.*?)\n\}\}', text, re.S):
        group = re.search(r'\|name\s*=\s*([^\n]+)', block).group(1).strip()
        for n, member in re.findall(r'\|member(\d+)\s*=\s*([^\n]+)', block):
            party = re.search(rf'\|party{n}\s*=\s*([^\n]+)', block)
            if '{{sortname' in member:
                name, title = sortname(member.strip()[2:-2])
            else:
                name, title = link_name(member)
            out.append({'group': group, 'name': name, 'title': title, 'party': PARTIES.get(party.group(1).strip(), party.group(1).strip()) if party else ''})
    return out


def changes(house: str) -> list[dict]:
    """The by-elections of a Seanad article's 'Changes': day, who was elected, whom they replaced."""
    text = wikitext(f'{house} Seanad')
    out = []
    for m in re.finditer(r'\{\{Constituency changes\n(.*?)\n\}\}', text, re.S):
        block = m.group(1)
        field = lambda k: (re.search(rf'\|{k}\s*=\s*([^\n]*)', block) or [None, ''])[1].strip()
        note = strip_refs(field('note'))
        if 'elected' not in note or 'Dáil' in note:
            continue
        refs = re.findall(r'url=(https://www\.oireachtas\.ie/en/debates/debate/seanad/[^\s|}]+)', block)
        elected = re.match(r'\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\] elected', note)
        replaced = re.search(r'to replace (?:the )?(?:\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|(\w[\w\' ]+))', note)
        date = f"{int(field('year')):04d}-{MONTHS[field('month')]:02d}-{int(field('date')):02d}"
        out.append({'date': date, 'name': (elected.group(2) or elected.group(1)).strip(), 'title': elected.group(1).strip(),
                    'replaced': ((replaced.group(2) or replaced.group(1) or replaced.group(3)).strip() if replaced else None),
                    'party': PARTIES.get(field('gain'), field('gain')), 'debate': refs[-1] if refs else None})
    return out


def departures(house: str) -> list[dict]:
    """The members a Seanad article's 'Changes' says died or resigned in the term, with the group
    they were elected in ('Elected in 1928 for 9 years'): the list of senators shows the members
    at the term's end, so these complete an election's winners."""
    text = wikitext(f'{house} Seanad')
    out = []
    for m in re.finditer(r'\{\{Constituency changes\n(.*?)\n\}\}', text, re.S):
        block = m.group(1)
        field = lambda k: (re.search(rf'\|{k}\s*=\s*([^\n]*)', block) or [None, ''])[1].strip()
        note = strip_refs(field('note'))
        gone = (re.match(r'\s*(?:Death|Resignation) of (?:the )?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', note)
                or re.match(r'\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\] (?:elected to the \[\[\d+\w* Dáil|appointed )', note))
        if gone:
            out.append({'group': field('con'), 'name': (gone.group(2) or gone.group(1)).strip(), 'title': gone.group(1).strip(),
                        'party': PARTIES.get(field('loss'), field('loss'))})
    return out


def first_count_1922() -> list[dict]:
    text = wikitext('1922 Seanad election')
    out = []
    for block in re.findall(r'\{\{STV Election box candidate with party link(.*?)\n\}\}', text, re.S):
        field = lambda k: (re.search(rf'\|{k}\s*=\s*([^\n]*)', block) or [None, ''])[1].strip()
        name, title = link_name(field('candidate'))
        out.append({'name': name, 'title': title, 'party': PARTIES.get(field('party'), field('party')),
                    'firstPrefs': int(field('votes').replace(',', '')), 'seatOrder': int(field('seat')), 'electedAtCount': int(field('count'))})
    return out


def table_1925() -> list[dict]:
    text = wikitext('1925 Seanad election')
    text = text[text.find('|+Results of the 1925 Seanad election'):]
    text = text[:text.find('\n|}')]
    out = []
    for row in text.split('\n|-')[1:]:
        row = row.split('\n', 1)[1] if '\n' in row else row
        cells = [c.strip() for c in re.split(r'\|\||\n\|', row.strip().lstrip('|'))]
        if len(cells) < 8:
            continue
        sort = re.search(r'\{\{sort\|([^|]+)\|(.*)\}\}', cells[0])
        display = sort.group(2) if sort else cells[0]
        name, title = link_name(display) if '[[' in display else (display.strip("' "), '')
        nts = lambda c: int(re.search(r'\{\{nts\|([\d,]+)\}\}', c).group(1).replace(',', ''))
        # the final count as shown ("{{ntsh|65.5}} 65": a sort key, then the count)
        last = lambda c: int(re.findall(r'(\d+)\s*$', c)[0]) if re.search(r'\d+\s*$', c) else nts(c)
        result = re.sub(r'\{\{nowrap\|(.*?)\}\}', lambda m: m.group(1), cells[5]).strip()
        party = re.sub(r'\[\[(?:[^\]|]+\|)?([^\]]+)\]\]', lambda m: m.group(1), cells[7]).strip("' ")
        # Coakley's '(pro-CnaG)': an independent he counts as unofficially pro-Cumann na nGaedheal
        leaning = 'pro-Cumann na nGaedheal (Coakley)' if 'pro-CnaG' in party else None
        party = 'Independent' if leaning else party
        out.append({'name': name.strip("' "), 'title': title, 'county': link_name(cells[1])[0], 'nomination': cells[3],
                    'firstPrefs': nts(cells[4]), 'result': result, 'finalCount': last(cells[6]), 'party': party, **({'partyNote': leaning} if leaning else {})})
    return out


def main(argv: list[str]) -> int:
    problems = []
    members = {h: members_of(h) for h in HOUSES}
    starts = {h: min(m['start'] for m in members[h]) for h in HOUSES}

    def code_of(name: str, title: str, house: str) -> str | None:
        if house.startswith('*'):
            # a by-election ('*<day>'): the members whose membership began that day, else anyone of the Free State Seanad
            everyone = list({m['code']: m for h in HOUSES for m in members[h]}.values())
            found = match(name, title, [m for h in HOUSES for m in members[h] if m['start'] == house[1:]]) or match(name, title, everyone)
        else:
            found = match(name, title, members[house])
        if not found:
            problems.append(f'{house}: {name} is not in the Oireachtas list of that Seanad')
        return found['code'] if found else None

    events = []
    groups_1922 = list_groups('1922')
    nominated = [g for g in groups_1922 if g['group'].startswith('Nominated')]
    elected_1922 = {fold(g['name']): g for g in groups_1922 if g['group'].startswith('Elected')}
    events.append({'date': starts['1922'], 'kind': 'nomination', 'house': '1922',
                   'note': 'Nominated by the President of the Executive Council, W. T. Cosgrave (Constitution of the Irish Free State, Article 82).',
                   'members': [{'name': g['name'], 'code': code_of(g['name'], g['title'], '1922'), 'party': g['party'],
                                'termYears': int(re.search(r'(\d+) years', g['group']).group(1)), 'wikipedia': g['title']} for g in nominated]})
    winners_1922 = []
    for c in first_count_1922():
        group = elected_1922.get(fold(c['name'])) or next((g for k, g in elected_1922.items() if k.split()[-1:] == fold(c['name']).split()[-1:]), None)
        winners_1922.append({**c, 'code': code_of(c['name'], c['title'], '1922'),
                             'termYears': int(re.search(r'(\d+) years', group['group']).group(1)) if group else None, 'wikipedia': c.pop('title')})
    events.append({'date': starts['1922'], 'pollDate': '1922-12-07', 'kind': 'general', 'house': '1922', 'seats': 30,
                   'electorate': 'the members of Dáil Éireann who had taken the oath (Constitution of the Irish Free State, Article 82)',
                   'candidatesStood': 112, 'quota': 2613, 'validPoll': 81000, 'valueNote': 'each paper valued at 1,000',
                   'candidatesRecorded': 'winners', 'candidates': winners_1922})
    rows_1925 = table_1925()
    for row in rows_1925:
        row['code'] = code_of(row['name'], row['title'], '1925') if row['result'].startswith('Elected') else None
        row['wikipedia'] = row.pop('title')
    events.append({'date': starts['1925'], 'pollDate': '1925-09-17', 'kind': 'general', 'house': '1925', 'seats': 19,
                   'electorate': 'the electors of the Free State aged 30 and over (Constitution of the Irish Free State, Article 30)',
                   'quota': 15286, 'validPoll': 315167 - 9466, 'spoilt': 9466, 'totalPoll': 315167, 'electors': 1347195,
                   'candidatesRecorded': 'all', 'candidates': rows_1925})
    for house in HOUSES[2:]:
        groups = list_groups(house)
        new = [g for g in groups if re.match(rf'Elected in {house}\b', g['group'])]
        listed = {fold(g['name']) for g in new}
        new += [g for g in departures(house) if re.match(rf'Elected in {house}\b', g['group']) and fold(g['name']) not in listed]
        said = re.search(rf'In {house}, (\d+) [Ss]enators were elected', wikitext(f'{house} Seanad'))
        if said and int(said.group(1)) != len(new):
            problems.append(f'{house}: the article says {said.group(1)} senators were elected; its lists name {len(new)} (left open: seatsNote)')
        events.append({'date': starts[house], 'kind': 'general', 'house': house,
                       'electorate': 'the members of the Dáil and the Seanad (Constitution (Amendment No. 6) Act 1928)',
                       'seats': None, 'candidatesRecorded': 'winners',
                       **({'seatsNote': (f"Wikipedia's article says {said.group(1)} senators were elected in {house}; its lists of senators "
                                         f"name {len(new)} elected that year. Not settled: the newspapers' reports of the count are needed.")}
                          if said and int(said.group(1)) != len(new) else {}),
                       'candidates': [{'name': g['name'], 'code': code_of(g['name'], g['title'], house), 'party': g['party'],
                                       'termYears': int(re.search(r'(\d+) years', g['group']).group(1)) if 'years' in g['group'] else None,
                                       'wikipedia': g['title']} for g in new]})
    for house in HOUSES:
        gone = departures(house)
        for ch in changes(house):
            replaced = ch['replaced']
            if replaced and ' ' not in replaced:
                # "to replace Byrne": the member of that surname the article says left the Seanad
                full = [g['name'] for g in gone if fold(g['name']).split()[-1:] == fold(replaced).split()]
                replaced = full[0] if len(full) == 1 else replaced
            if replaced and re.match(r'(Marquess|Earl|Countess) of ', replaced):
                replaced = f'the {replaced}'
            events.append({'date': ch['date'], 'kind': 'by-election', 'house': house, 'replaced': replaced, 'candidatesRecorded': 'winners',
                           'debate': ch['debate'], 'candidates': [{'name': ch['name'], 'code': code_of(ch['name'], ch['title'], '*' + ch['date']),
                                                                   'party': ch['party'], 'wikipedia': ch['title']}]})
    # the members whose membership began on a day no event above accounts for
    covered = {(e['date'], c['code']) for e in events if e['kind'] == 'by-election' for c in e['candidates'] if c.get('code')}
    for house in HOUSES:
        for m in members[house]:
            if m['start'] != starts[house] and (m['start'], m['code']) not in covered:
                problems.append(f"{house}: {m['name']} ({m['code']}) began a membership on {m['start']}, which no by-election here accounts for")
    for e in events:
        if e['kind'] == 'general' and e['seats'] is None:
            e['seats'] = len(e['candidates'])
    events.sort(key=lambda e: (e['date'], {'nomination': 0, 'general': 1, 'by-election': 2}[e['kind']]))
    doc = {
        'schemaVersion': 1,
        'description': ("The Seanad of the Irish Free State (1922-1936): the 1922 nominations and election by the Dáil, the 1925 "
                        "popular election, the 1928, 1931 and 1934 elections by the Oireachtas, and the by-elections, as the sources "
                        "hold them (facts and citations only). Written by scripts/ingest/seanad/free_state_sources.py from the Houses "
                        "of the Oireachtas member lists (member codes, membership dates) and Wikipedia's articles on each Seanad and "
                        "on the 1922 and 1925 elections. An event is filed under the day its members' term began in the Oireachtas "
                        "list (pollDate is the day of the poll, where a source gives it). candidatesRecorded 'winners': only the "
                        "winners are on record here."),
        'sources': {
            'oireachtas': {'kind': 'official', 'title': 'Houses of the Oireachtas, members of the Seanad of 1922, 1925, 1928, 1931 and 1934',
                           'publisher': 'Houses of the Oireachtas', 'url': 'https://api.oireachtas.ie/', 'accessed': '2026-11-14'},
            **{f'wikipedia-{h}': {'kind': 'web', 'title': f'Wikipedia, "{h} Seanad"', 'url': WIKI.format(f'{h}_Seanad'), 'accessed': '2026-11-14'} for h in HOUSES},
            'wikipedia-1922-election': {'kind': 'web', 'title': 'Wikipedia, "1922 Seanad election"', 'url': WIKI.format('1922_Seanad_election'), 'accessed': '2026-11-14'},
            'wikipedia-1925-election': {'kind': 'web', 'title': 'Wikipedia, "1925 Seanad election"', 'url': WIKI.format('1925_Seanad_election'), 'accessed': '2026-11-14',
                                        'note': 'Its candidate table is after John Coakley, "Ireland\'s unique electoral experiment: the Senate election of 1925", Irish Political Studies 20 (2005), pp. 261-68.'},
        },
        'events': events,
    }
    print(f"{len(events)} events: {sum(1 for e in events if e['kind'] == 'general')} general elections, "
          f"{sum(1 for e in events if e['kind'] == 'by-election')} by-elections, 1 nomination; {len(problems)} problem(s)")
    for p in problems:
        print(f'  {p}')
    if '--check' not in argv:
        OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
