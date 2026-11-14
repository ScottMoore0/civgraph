"""The Seanad contests whose sources name only the winners (build_seanad.py's winners-only path):

  general elections 1938-1997 (houses 2-21): one contest per panel and university per house, the
      members the Houses of the Oireachtas seat for it on the day the house first met (its term's
      start), each with the member code (the source), the name, party and person id
      IrelandElection.com gives the same winner (its 1938-97 Seanad pages list the winners only);
  by-elections (houses 3-27): every other panel or university membership of a term, dated by its
      start, titled by the registry's byElectionTitle; the cause from Wikipedia's List of Seanad
      by-elections, and the count where a Wikipedia by-election article gives one (or "deemed
      elected unopposed", where it says so).

Every winners-only contest carries countInfo Candidates_Recorded "winners" (a poll was held; the
losers and the votes are not known). The winners IrelandElection.com names differently from the
Oireachtas, or not at all, are settled in data/elections/persons/seanad-member-checks.csv (verdicts:
accept, the IrelandElection.com winner is that member; unjoined, written from IrelandElection.com
with no member code; not-seated, an Oireachtas record that is not a winner of that contest, a
second or misnamed record of another member); anything left unsettled FAILs the build.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date as Date
from pathlib import Path

HOUSES_GENERAL = range(2, 22)   # 1938-1997; 2002-2025 are counted contests (build_seanad.py)
HOUSE_PANEL_ACT_1947 = 6        # the 1948 election was the first under the 1947 Act
WIKI_LIST = 'List of Seanad by-elections'
WIKI_LIST_URL = 'https://en.wikipedia.org/wiki/List_of_Seanad_by-elections'
OIREACHTAS_MEMBERS_URL = 'https://api.oireachtas.ie/v1/members?chamber=seanad&house_no={n}'
HONORIFIC = re.compile(r'^(?:prof|dr|col|senator|rev)\.?\s+', re.I)
GENERATION = re.compile(r'\s+(?:snr|jnr|sr|jr)\.?$', re.I)
MONTHS = {m: i for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                                      'September', 'October', 'November', 'December'], 1)}


def clean_name(name: str) -> str:
    """An Oireachtas full name without its honorific or Snr./Jnr. ("Prof. Michael Tierney",
    "Brian Lenihan Snr.")."""
    return GENERATION.sub('', HONORIFIC.sub('', str(name or '').strip())).strip()


def wiki_text(cache: Path, title: str) -> str:
    path = cache / 'wikipedia' / f"{title.replace(':', '_')}.json"  # as harvest_seanad.py names it
    if not path.exists():
        return ''
    doc = json.loads(path.read_text(encoding='utf-8'))
    return (doc.get('parse') or {}).get('wikitext') or ''


def strip_wiki(text: str) -> str:
    text = re.sub(r'<ref[^>]*/>', '', text)
    text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.S)
    text = re.sub(r'\{\{efn[^{}]*\}\}', '', text)
    text = re.sub(r'\{\{sortname\|([^|}]*)\|([^|}]*)[^}]*\}\}', r'\1 \2', text)
    text = re.sub(r'\{\{nowrap\|(.*?)\}\}', r'\1', text)
    text = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', text)
    return text.replace("'''", '').replace('&nbsp;', '').strip()


def template_fields(body: str) -> dict:
    """A template's fields, one a line ("|name = value")."""
    return {m.group(1): strip_wiki(m.group(2)) for m in re.finditer(r'^\s*\|\s*(\w+)\s*=[ \t]*(.*?)\s*$', body, re.M)}


def wiki_by_elections(cache: Path) -> list[dict]:
    """Wikipedia's List of Seanad by-elections: house, contest, date, outgoing member, reason,
    winner, party, article."""
    out = []
    for body in re.findall(r'\{\{Irish by election result(.*?)\n\}\}', wiki_text(cache, WIKI_LIST), re.S):
        f = template_fields(body)
        try:
            day = Date(int(f['year']), MONTHS[f['month']], int(f['date'])).isoformat()
        except (KeyError, ValueError):
            day = ''
        out.append({'house': int(f.get('housenum') or 0), 'contest': f.get('constit', ''), 'date': day,
                    'outgoing': f.get('outgoing', ''), 'reason': f.get('reason', ''), 'winner': f.get('winner', ''),
                    'article': f.get('article', '')})
    return out


def stv_boxes(text: str) -> list[dict]:
    """Every STV Election box of a Wikipedia article: its title, candidates (name, party, counts)
    and its end fields (electorate, valid, spoilt, quota)."""
    boxes = []
    for m in re.finditer(r'\{\{STV Election box begin2(.*?)\{\{STV Election box end2(.*?)\n\}\}', text, re.S):
        begin, end = m.group(1), m.group(2)
        title = strip_wiki(re.search(r'\|\s*title\s*=\s*([^\n]*)', begin).group(1)) if re.search(r'\|\s*title\s*=', begin) else ''
        cands = []
        for c in re.findall(r'\{\{STV Election box candidate2(.*?)\n\s*\}\}', begin + '\n}}', re.S):
            f = template_fields(c)
            counts = []
            for n in range(1, 60):
                key = f'count{n}'
                if key not in f:
                    break
                value = re.sub(r'[^\d.]', '', f[key])
                counts.append(float(value) if value else None)
            elected = bool(re.search(r"\|\s*candidate\s*=\s*'''", c))
            cands.append({'name': f.get('candidate', ''), 'party': f.get('party', ''), 'counts': counts, 'elected': elected})
        endf = {k: re.sub(r'[^\d.]', '', v) for k, v in template_fields(end).items()}
        boxes.append({'title': title, 'candidates': cands, 'end': endf})
    return boxes


def membership_party(member: dict, house_no: int, start: str) -> str:
    for wrapped in member['memberships']:
        ms = wrapped['membership']
        if ms['house']['houseCode'] != 'seanad' or str(ms['house']['houseNo']) != str(house_no):
            continue
        parties = [p['party'] for p in ms.get('parties') or []]
        for p in parties:
            r = p.get('dateRange') or {}
            if (r.get('start') or '') <= start and (not r.get('end') or start <= r['end']):
                return p['showAs']
        if parties:
            return parties[0]['showAs']
    return ''


def members(cache: Path, house_no: int, contests: list[str]) -> list[dict]:
    """The panel and university memberships of a house: code, names, contest, start, party."""
    doc = json.loads((cache / 'oireachtas' / f'house-{house_no}.json').read_text(encoding='utf-8'))
    out = []
    for row in doc['results']:
        member = row['member']
        for wrapped in member['memberships']:
            ms = wrapped['membership']
            if ms['house']['houseCode'] != 'seanad' or str(ms['house']['houseNo']) != str(house_no):
                continue
            for rep in ms['represents']:
                contest = rep['represent']['showAs']
                if contest in contests:
                    start = ms['dateRange']['start']
                    out.append({'code': member['memberCode'], 'name': clean_name(member['fullName']), 'first': member.get('firstName') or '',
                                'last': GENERATION.sub('', member.get('lastName') or ''), 'contest': contest, 'start': start,
                                'party': membership_party(member, house_no, start)})
    seen, unique = set(), []
    for m in out:
        if (m['code'], m['contest'], m['start']) not in seen:
            seen.add((m['code'], m['contest'], m['start']))
            unique.append(m)
    return unique


class WinnersOnly:
    """Writes the winners-only contests; collects the links, dates and report rows build_seanad.py
    writes out."""

    def __init__(self, ctx: dict, cache: Path, ie_dir: Path):
        self.c = ctx          # build_seanad.py's names: fold, slugify, SLUG, PANELS, CONTESTS, ...
        self.cache = cache
        self.ie_dir = ie_dir
        self.links: list[dict] = []
        self.dates: dict[str, list[dict]] = {}
        self.report: list[dict] = []
        self.files: dict[tuple[str, str], dict] = {}
        self.code_names: dict[str, str] = {}
        self.used_checks: set[tuple[str, str, str]] = set()

    # ---- helpers
    def compact(self, text: str) -> str:
        return self.c['fold'](text).replace(' ', '')

    def surname(self, name: str) -> str:
        words = self.c['fold'](name).split()
        return words[-1] if words else ''

    def check(self, election: str, contest: str, name: str) -> dict | None:
        key = (election, contest, name)
        row = self.c['CHECKED'].get(key)
        if row:
            self.used_checks.add(key)
        return row

    def ie_contests(self) -> dict[tuple[int, str], dict]:
        out = {}
        for line in (self.ie_dir / 'index.jsonl').read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            if r['election_type'] == 'seanad' and r['constituency'] in self.c['CONTESTS']:
                house = int(r['key'].split('_')[1]) - self.c['IE_FIRST_ELECTION'] + self.c['FIRST_HOUSE']
                if house in HOUSES_GENERAL:
                    out[(house, r['constituency'])] = r
        return out

    def party(self, label: str) -> str:
        return self.c['PARTY_LABELS'].get(label, label) or ''

    # ---- general elections
    def pair(self, election: str, contest: str, pool: list[dict], cands: list[dict]) -> list[tuple[dict | None, dict | None, str]]:
        """Each seat's (member, IrelandElection.com candidate, how): by the checks first, then by
        name, then by surname and first initial, then by surname alone (each unique in the
        contest). A surname-alone match must be in the checks."""
        pairs, free_m, free_c = [], list(pool), list(cands)
        for cand in list(free_c):
            chk = self.check(election, contest, cand['name'])
            if not chk:
                continue
            if chk['verdict'] == 'unjoined':
                pairs.append((None, cand, 'checked: unjoined'))
                free_c.remove(cand)
                # The record IrelandElection.com's winner was matched to by surname, if any, is
                # named not-seated in the checks.
                continue
            m = next((m for m in free_m if m['code'] == chk['oireachtas_code']), None)
            if chk['verdict'] == 'accept' and m:
                pairs.append((m, cand, 'checked'))
                free_m.remove(m)
                free_c.remove(cand)
            elif chk['verdict'] == 'accept':
                sys.exit(f"FAIL: seanad-member-checks.csv: {election} {contest} {cand['name']}: {chk['oireachtas_code']} does not sit for the contest then")
        for rule in ('name', 'surname and initial', 'surname alone'):
            for m in list(free_m):
                if rule == 'name':
                    hits = [k for k in free_c if self.compact(k['name']) == self.compact(m['name'])]
                elif rule == 'surname and initial':
                    hits = [k for k in free_c if self.surname(k['name']) == self.surname(m['last'] or m['name'])
                            and self.c['fold'](k['name'])[:1] == self.c['fold'](m['first'] or m['name'])[:1]]
                else:
                    hits = [k for k in free_c if self.surname(k['name']) == self.surname(m['last'] or m['name'])]
                if len(hits) == 1:
                    pairs.append((m, hits[0], rule))
                    free_m.remove(m)
                    free_c.remove(hits[0])
        for m in free_m:
            pairs.append((m, None, 'no IrelandElection.com winner'))
        for k in free_c:
            pairs.append((None, k, 'no Oireachtas member'))
        return pairs

    def general(self, house_no: int, house: dict) -> None:
        start = house['dateRange']['start']
        election = f"{self.c['SLUG']}__{start}"
        ie = self.ie_contests()
        pool_all = members(self.cache, house_no, self.c['CONTESTS'])
        for contest in self.c['CONTESTS']:
            entry = ie.get((house_no, contest))
            if not entry:
                sys.exit(f'FAIL: IrelandElection.com has no {contest} for the {house["showAs"]}')
            ie_doc = json.loads((self.ie_dir / 'contests' / f"{entry['key']}.json").read_text(encoding='utf-8'))
            cands = ie_doc['candidates']
            pool = []
            for m in pool_all:
                if m['contest'] != contest or m['start'] != start:
                    continue
                # A not-seated row is keyed by the record's member code (its name may be a winner's).
                chk = self.check(election, contest, m['code'])
                if chk and chk['verdict'] == 'not-seated':
                    continue
                pool.append(m)
            pairs = self.pair(election, contest, pool, cands)
            seats = int(entry['seats'])
            bad = [p for p in pairs if p[2] in ('surname alone', 'no IrelandElection.com winner', 'no Oireachtas member')]
            for m, k, how in bad:
                self.report.append({'election': election, 'contest': contest, 'name': (k or {}).get('name') or m['name'],
                                    'oireachtas': (m or {}).get('name', ''), 'code': (m or {}).get('code', ''), 'note': how})
            if len(pairs) != seats:
                self.report.append({'election': election, 'contest': contest, 'name': '', 'oireachtas': '', 'code': '',
                                    'note': f'{len(pairs)} winners for {seats} seats (IrelandElection.com)'})
            winners = []
            for m, k, how in pairs:
                ie_id = (k or {}).get('source_person_id') or ''
                known = self.c['IE_OFFICIAL'].get(ie_id, set())
                if m and known and f"oireachtas:{m['code']}" not in known:
                    self.report.append({'election': election, 'contest': contest, 'name': k['name'], 'oireachtas': m['name'], 'code': m['code'],
                                        'note': f"IrelandElection.com id {ie_id} is held with {', '.join(sorted(known))}: not carried"})
                    ie_id = ''
                winners.append({'name': (k or {}).get('name') or m['name'], 'party': self.party((k or {}).get('party') or (m or {}).get('party', '')),
                                'source_person_id': ie_id, 'code': (m or {}).get('code', ''), 'how': how})
                if m and k:
                    self.code_names.setdefault(m['code'], k['name'])
            self.write(election, start, contest, winners, house_no, house, kind='general', ie_url=(ie_doc.get('pages') or {}).get('election'))

    # ---- by-elections
    def by_elections(self, houses: dict[int, dict]) -> None:
        wiki = wiki_by_elections(self.cache)
        for house_no in sorted(n for n in houses if 3 <= n < 1000):  # the Free State Seanads (1922-34) are numbered by year
            house = houses[house_no]
            start = house['dateRange']['start']
            mids = [m for m in members(self.cache, house_no, self.c['CONTESTS']) if m['start'] != start]
            for m in mids:
                election = f"{self.c['SLUG']}__{m['start']}"
                w = self.wiki_match(wiki, house_no, m)
                winner = {'name': self.code_names.get(m['code']) or self.c['NAMES_BY_CODE'].get(m['code']) or m['name'],
                          'party': self.party(m['party']), 'source_person_id': '', 'code': m['code'], 'how': 'the member'}
                self.write(election, m['start'], m['contest'], [winner], house_no, house, kind='by-election', wiki=w, extra=self.by_count(w, m))

    def wiki_match(self, wiki: list[dict], house_no: int, m: dict) -> dict | None:
        contest = self.c['fold'](m['contest']).replace(' panel', '')
        alias = {'nui': 'national university of ireland', 'dublin university': 'university of dublin'}
        hits = [w for w in wiki if w['house'] == house_no and alias.get(self.c['fold'](w['contest']), self.c['fold'](w['contest'])) in (contest, self.c['fold'](m['contest']))
                and self.surname(w['winner']).rstrip('e') == self.surname(m['last'] or m['name']).rstrip('e')]  # Costelloe, Costello
        if len(hits) != 1:
            self.report.append({'election': f"{self.c['SLUG']}__{m['start']}", 'contest': m['contest'], 'name': m['name'], 'oireachtas': m['name'],
                                'code': m['code'], 'note': f'{len(hits)} entries in Wikipedia\'s list of Seanad by-elections'})
            return None
        return hits[0]

    def by_count(self, w: dict | None, m: dict) -> dict | None:
        """The count of a by-election, where its Wikipedia article gives one, or 'unopposed' where
        the article says the winner was deemed elected unopposed."""
        if not w or not w.get('article'):
            return None
        text = wiki_text(self.cache, w['article'])
        if not text:
            return None
        plain = strip_wiki(text)
        if re.search(r'deemed elected unopposed', plain) and self.surname(m['name']) in self.c['fold'](plain):
            return {'unopposed': True, 'article': w['article']}
        for name in re.findall(r'\{\{(\d{4} [^{}|]*by-election result)\}\}', text):
            text += '\n' + wiki_text(self.cache, f'Template:{name}')
        contest = m['contest'].replace('University of Dublin', 'Dublin University')
        boxes = [b for b in stv_boxes(text) if contest.lower() in b['title'].lower() or m['contest'].lower() in b['title'].lower()]
        if len(boxes) != 1:
            return None
        return {'box': boxes[0], 'article': w['article']}

    # ---- the file
    def write(self, election: str, day: str, contest: str, winners: list[dict], house_no: int, house: dict, kind: str,
              ie_url: str | None = None, wiki: dict | None = None, extra: dict | None = None) -> None:
        panel = contest in self.c['PANELS']
        key = (day, contest)
        held = self.files.get(key)
        if held:  # a second seat of one by-election (two vacancies on one panel, one poll)
            held['winners'].extend(winners)
            held['wiki'].append(wiki)
            return
        self.files[key] = {'election': election, 'day': day, 'contest': contest, 'winners': list(winners), 'house_no': house_no,
                           'house': house, 'kind': kind, 'ie_url': ie_url, 'wiki': [wiki], 'extra': extra, 'panel': panel}

    def flush(self) -> None:
        for (day, contest), f in sorted(self.files.items()):
            data, rows_info = self.contest_file(f)
            folder = self.c['OUT'] / day
            folder.mkdir(parents=True, exist_ok=True)
            name = f"{self.c['slugify'](contest)}.json"
            (folder / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
            self.dates.setdefault(day, []).append({'name': contest, 'seats': rows_info['seats'], 'candidates': rows_info['candidates'],
                                                   'quota': rows_info['quota'], 'file': name})

    def contest_file(self, f: dict) -> tuple[dict, dict]:
        c, contest, panel, house = self.c, f['contest'], f['panel'], f['house']
        winners, extra = f['winners'], f['extra'] or {}
        seats = len(winners)
        box = extra.get('box')
        unopposed = extra.get('unopposed')
        member_list = OIREACHTAS_MEMBERS_URL.format(n=f['house_no'])
        rows, candidates = [], []
        if box:
            rows, candidates, info = self.count_rows(f, box)
        else:
            for index, w in enumerate(winners):
                candidates.append(w)
                rows.append({
                    'Candidate_Id': str(index + 1), 'Count_Number': '1',
                    'Firstname': w['name'].split(' ', 1)[0], 'Surname': w['name'].split(' ', 1)[1] if ' ' in w['name'] else '',
                    'candidateName': w['name'], 'Party_Name': w['party'],
                    'Candidate_First_Pref_Votes': '', 'Transfers': '', 'Total_Votes': '',
                    'Status': 'Elected', 'Occurred_On_Count': '1', 'source_person_id': w['source_person_id'],
                })
            info = {'Constituency_Name': contest, 'Number_Of_Seats': str(seats), 'Seat_Type': 'Senator'}
            if not unopposed:
                info['Candidates_Recorded'] = 'winners'
        for index, w in enumerate(candidates):
            if w.get('code'):
                self.links.append({'system': 'oireachtas', 'id': w['code'], 'election': f['election'], 'constituency': contest,
                                   'name': w['name'], 'candidateId': str(index + 1), 'confidence': 'high'})
        general = f['kind'] == 'general'
        wiki = [w for w in f['wiki'] if w]
        if general:
            source = {
                'title': f"Houses of the Oireachtas, members of the {house['showAs']}: {contest}",
                'publisher': 'Houses of the Oireachtas',
                'url': member_list,
                'kind': 'web',
                'check': (f"The winners are the members the Houses of the Oireachtas seat for this {'panel' if panel else 'constituency'} on "
                          f"{f['day']}, the day the {house['showAs']} first met (api.oireachtas.ie, seanad-build, Nov 2026); "
                          f"IrelandElection.com names the same {seats} winners and gives no count."),
            }
            out_source_url = member_list
        elif box or unopposed:
            article = extra['article']
            source = {'title': f'Wikipedia, {article}', 'publisher': 'Wikimedia Foundation', 'url': 'https://en.wikipedia.org/wiki/' + article.replace(' ', '_'),
                      'kind': 'web', 'check': ('The count is the article\'s; the first preferences add up to its valid poll.' if box else
                                               'The article says the winner was deemed elected unopposed: only one candidate was nominated.')
                      + f" The winner is the member the Houses of the Oireachtas seat for this {'panel' if panel else 'constituency'} from {f['day']}."}
            out_source_url = source['url']
        else:
            source = {
                'title': f"Houses of the Oireachtas, members of the {house['showAs']}: {contest}",
                'publisher': 'Houses of the Oireachtas',
                'url': member_list,
                'kind': 'web',
                'check': (f"The winner{'s are the members' if seats > 1 else ' is the member'} the Houses of the Oireachtas seat for this "
                          f"{'panel' if panel else 'constituency'} from {f['day']}, during the {house['showAs']} (api.oireachtas.ie, seanad-build, Nov 2026)."),
            }
            out_source_url = member_list
        out = {
            'body': c['BODY'],
            'date': f['day'],
            'constituency': contest,
            'seats': seats,
            'source_url': out_source_url,
            'source': source,
        }
        if general and f.get('ie_url'):
            out['sources'] = [{'title': f"IrelandElection.com, Seanad election of {f['day'][:4]}: {contest}", 'publisher': 'IrelandElection.com',
                                         'url': f['ie_url'], 'kind': 'web', 'check': 'Names the winners and their parties; no count.'}]
        if wiki:
            out.setdefault('sources', []).append({'title': f'Wikipedia, {WIKI_LIST}', 'publisher': 'Wikimedia Foundation', 'url': WIKI_LIST_URL,
                                                            'kind': 'web', 'check': 'The vacancy filled: the member it replaced and why.'})
        franchise = self.franchise(contest, f['house_no'], general)
        if franchise:
            out['franchise'] = franchise
        if general:
            out['sourceNote'] = (f"Filed under {f['day']}, the day the Houses of the Oireachtas give as the start of the {house['showAs']}; "
                                 'a Seanad general election is held by post, and its polls close over several days.')
        else:
            notes = [f"Filed under {f['day']}, the day the Houses of the Oireachtas give as the start of the winner's membership."]
            for w in wiki:
                if w['date'] and w['date'] != f['day']:
                    notes.append(f"Wikipedia's List of Seanad by-elections gives {w['date']} for this by-election.")
            out['sourceNote'] = ' '.join(notes)
            causes = [f"{w['outgoing']} ({w['reason'][:1].lower()}{w['reason'][1:]})" for w in wiki if w['outgoing']]
            if causes:
                out['cause'] = f"To fill the seat{'s' if len(causes) > 1 else ''} of {' and '.join(causes)} (Wikipedia, {WIKI_LIST})"
        if box and panel:
            out['countSourceNote'] = ('Each valid ballot paper is valued at 1,000 so that fractions of a vote can be transferred; every figure is a value, '
                                      'not a number of papers.' if (info.get('Valid_Poll') or '0').endswith('000') else
                                      'The figures are as the article prints them.')
        out['Constituency'] = {'countInfo': info, 'countGroup': rows}
        return out, {'seats': seats, 'candidates': len(candidates), 'quota': info.get('Quota') or None}

    def franchise(self, contest: str, house_no: int, general: bool) -> str | None:
        if contest in self.c['UNIVERSITY_ELECTORATE']:
            return self.c['UNIVERSITY_ELECTORATE'][contest]
        if house_no < HOUSE_PANEL_ACT_1947:
            return None  # the 1937 Act's electorate, not the 1947 Act's; left unsaid
        if general:
            return self.c['PANEL_ELECTORATE']
        return 'the members of the Dáil and the Seanad (Seanad Electoral (Panel Members) Act 1947, s. 60)'

    def count_rows(self, f: dict, box: dict) -> tuple[list[dict], list[dict], dict]:
        """A by-election's count from its Wikipedia STV box: the winner (the Oireachtas member)
        and the other candidates, each count's total and the transfer it took."""
        member = f['winners'][0]
        rows, candidates = [], []
        ordered = sorted(box['candidates'], key=lambda k: -(k['counts'][0] or 0) if k['counts'] else 0)
        elected_names = [k for k in ordered if k['elected']]
        if len(elected_names) != len(f['winners']):
            sys.exit(f"FAIL: {f['day']} {f['contest']}: the Wikipedia count elects {len(elected_names)}, the Oireachtas seats {len(f['winners'])}")
        for index, k in enumerate(ordered):
            winner = next((w for w in f['winners'] if self.surname(w['name']) == self.surname(k['name'])), None) if k['elected'] else None
            if k['elected'] and not winner:
                sys.exit(f"FAIL: {f['day']} {f['contest']}: the Wikipedia winner {k['name']} is not the Oireachtas member")
            name = winner['name'] if winner else k['name']
            party = winner['party'] if winner else self.party({'Independent politician (Ireland)': 'Independent', 'Labour Party (Ireland)': 'Labour Party',
                                                                'Green Party (Ireland)': 'Green Party', 'Social Democrats (Ireland)': 'Social Democrats'}.get(k['party'], k['party']))
            cand = {'name': name, 'party': party, 'source_person_id': '', 'code': winner['code'] if winner else ''}
            candidates.append(cand)
            counts = k['counts']
            last = max((n for n, v in enumerate(counts) if v is not None), default=0)
            for n, total in enumerate(counts):
                if total is None:
                    continue
                prev = counts[n - 1] if n else None
                transfer = '' if n == 0 or prev is None else fmt(total - prev)
                status = ''
                if k['elected'] and n == last:
                    status = 'Elected'
                elif not k['elected'] and n == last and last + 1 < len(counts):
                    status = 'Excluded'
                rows.append({
                    'Candidate_Id': str(index + 1), 'Count_Number': str(n + 1),
                    'Firstname': name.split(' ', 1)[0], 'Surname': name.split(' ', 1)[1] if ' ' in name else '',
                    'candidateName': name, 'Party_Name': party,
                    'Candidate_First_Pref_Votes': fmt(counts[0] or 0), 'Transfers': transfer, 'Total_Votes': fmt(total),
                    'Status': status, 'Occurred_On_Count': str(last + 1), 'source_person_id': '',
                })
        end = box['end']
        first = sum((k['counts'][0] or 0) for k in box['candidates'] if k['counts'])
        info = {'Constituency_Name': f['contest'], 'Number_Of_Seats': str(len(f['winners'])), 'Quota': end.get('quota', ''),
                'Valid_Poll': fmt(first), 'Total_Electorate': end.get('electorate', '') if not f['panel'] else '', 'Seat_Type': 'Senator'}
        if end.get('spoilt') and not f['panel']:
            info['Spoiled'] = end['spoilt']
        if end.get('valid') and abs(float(end['valid']) - first) > 0.5:
            sys.exit(f"FAIL: {f['day']} {f['contest']}: the first preferences add up to {first}, the article's valid poll is {end['valid']}")
        return rows, candidates, info


def fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f'{value:.3f}'.rstrip('0').rstrip('.')
