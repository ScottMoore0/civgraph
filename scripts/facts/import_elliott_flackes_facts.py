#!/usr/bin/env python3
"""Load offices, tenures, party events and affiliations from the Elliott & Flackes extraction.

Input: the staged extraction of Sydney Elliott and W. D. Flackes, Northern Ireland: A Political
Directory 1968-1999 (facts.jsonl: one fact per line, each with its book page and a short subject
in the extractor's own words). Nothing from the book's text is copied: only names, offices,
parties and dates, each cited to its page.

Output (the facts model, docs/facts-model.md):
  data/offices/offices.json                       the offices the facts name
  data/offices/tenures/<group>.json               who held them, when, cited
  data/elections/parties/party-events.json        founding, dissolution, renaming, splits
  data/elections/persons/affiliations.json        dated party (or group, or whip) membership
  data/elections/persons/non-candidate-persons.json   people who never stood (NIO ministers ...)
  <unmapped.csv>                                  every in-scope fact (or part) not loaded, and why

People are matched to existing person ids only where the name AND the dates AND a party or the
body of the office agree; a name alone never decides (see Persons.match). A person is registered
as a non-candidate only when no record of the name exists, or the office is one people who never
stood in an Irish election held (the Northern Ireland Office, Whitehall, the civil service).

Usage:
  python scripts/facts/import_elliott_flackes_facts.py --facts PATH [--unmapped PATH --write]
Without --write it reports what it would load.
"""
import argparse
import collections
import csv
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ef_offices  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PERSONS_DIR = os.path.join(REPO, 'data', 'elections', 'persons')
PARTIES_DIR = os.path.join(REPO, 'data', 'elections', 'parties')
OFFICES_DIR = os.path.join(REPO, 'data', 'offices')
# The staged extraction and the unmapped report live outside the repository: pass them, or set
# CIVGRAPH_EF_FACTS and CIVGRAPH_FACTS_UNMAPPED.
DEFAULT_FACTS = os.environ.get('CIVGRAPH_EF_FACTS')
DEFAULT_UNMAPPED = os.environ.get('CIVGRAPH_FACTS_UNMAPPED')
NONCANDIDATE_BLOCK = 900001

BOOK = ('Sydney Elliott and W. D. Flackes, Northern Ireland: A Political Directory 1968-1999 '
        '(Belfast: Blackstaff Press, 1999)')
SECTIONS = {
    'dictionary': 'Dictionary', 'chronology': 'Chronology of Major Events',
    'office-holders': 'Office Holders 1968-99', 'systems-of-government': 'Systems of Government',
    'election-results': 'Election Results 1968-99',
}
# Which section wins when two pages give one tenure different dates: the tables first.
SECTION_RANK = {'office-holders': 0, 'systems-of-government': 1, 'chronology': 2, 'dictionary': 3}

# Internal contests are written as election files by hand (data/elections-source/data/elections/
# <party>-leadership/...); these facts are what they rest on, so they are not listed as unmapped.
CONTEST_FACTS = {
    'dD-0139': 'uup-leadership__1969-05-01', 'dC-0026': 'fianna-fail-leadership__1979-12-07',
    'cA-0045': 'uup-leadership__1995-03-18', 'dD-0101': 'uup-leadership__1995-03-18',
    'dF-0096': 'uup-leadership__1995-03-18', 'cA-0049': 'uup-leadership__1995-09-08',
    'dF-0027': 'uup-leadership__1995-09-08', 'dE-0074': 'uup-leadership__1995-09-08',
    'dE-0137': 'uup-leadership__1995-09-08', 'dD-0040': 'uup-leadership__1995-09-08',
    'dF-0012': 'uup-leadership__1995-09-08', 'dF-0097': 'uup-leadership__1995-09-08',
    'dC-0193': 'fianna-fail-presidential-nomination__1997-09-17',
}
# The tenure each contest began (office, contest key); the importer links them.
CONTEST_WINNERS = {
    ('ni-prime-minister', '1969'): 'uup-leadership__1969-05-01',
    ('fianna-fail-leader', '1979'): 'fianna-fail-leadership__1979-12-07',
    ('uup-leader', '1995'): 'uup-leadership__1995-09-08',
}


def citation(fact):
    page = str(fact['book_page'])
    return {
        'kind': 'book',
        'title': f"{BOOK}, {SECTIONS.get(fact['section'], fact['section'])}, p. {page}",
        'publisher': 'Blackstaff Press',
        'url': None,
        'page': page,
        'citation': f'Elliott & Flackes (1999), p. {page}',
        'fact': fact['id'],
    }


DATE_RE = re.compile(r'^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$')


def parse_date(value):
    """(date, precision, qualifier). A date the source qualifies ('by 1974', 'c.1977') is not a date."""
    if value is None or value == '':
        return None, None, None
    s = str(value).strip()
    m = DATE_RE.match(s)
    if m and 1800 < int(m.group(1)) < 2100 and (not m.group(2) or 1 <= int(m.group(2)) <= 12) and (not m.group(3) or 1 <= int(m.group(3)) <= 31):
        return s, ('day' if m.group(3) else 'month' if m.group(2) else 'year'), None
    return None, None, s


def year_of(*dates):
    for d in dates:
        if d and DATE_RE.match(str(d)):
            return int(str(d)[:4])
    return None


def strip_accents(s):
    s = unicodedata.normalize('NFKD', str(s or '').replace('\ufffd', ''))
    return ''.join(c for c in s if not unicodedata.combining(c))


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', strip_accents(s).lower()).strip()


# ---------------------------------------------------------------- parties

PARTY_MAP = {
    'uup': 'uup', 'ulster unionist': 'uup', 'ulster unionist party': 'uup', 'unionist': 'uup', 'uup leader': 'uup',
    'unionist pro o neill': 'uup', 'pro o neill unionist': 'uup',
    'dup': 'dup', 'democratic unionist party': 'dup', 'alliance': 'alliance', 'sdlp': 'sdlp',
    'sinn fein': 'sinn-fein', 'sinn fein provisional': 'sinn-fein',
    'workers party': 'workers-party', 'workers party republican clubs': 'workers-party',
    'official sinn fein workers party': 'workers-party', 'republican clubs official sinn fein': 'workers-party',
    'republican clubs workers party': 'workers-party', 'republican clubs': 'workers-party',
    'fianna fail': 'fianna-fail', 'fine gael': 'fine-gael', 'labour party ireland': 'irish-labour', 'irish labour': 'irish-labour',
    'progressive democrats': 'progressive-democrats', 'democratic left': 'democratic-left',
    'vanguard unionist progressive party': 'vanguard', 'vupp': 'vanguard',
    'uuup': 'uuup', 'united ulster unionist party': 'uuup',
    'unionist party of northern ireland': 'unionist-party-of-northern-ireland', 'upni': 'unionist-party-of-northern-ireland',
    'faulkner unionists upni': 'unionist-party-of-northern-ireland',
    'irish independence party': 'irish-independence-party', 'united unionist assembly party': 'united-unionist-coalition',
    'northern ireland unionist party': 'niup', 'niup': 'niup', 'ukup': 'ukup', 'uk unionist party': 'ukup',
    'united kingdom unionist party': 'ukup',
    'independent unionist': 'ind-unionist', 'independent': 'ind', 'none independent': 'ind',
    'ulster popular unionist party': 'ulster-popular-unionist-party', 'upup': 'ulster-popular-unionist-party',
    'conservative': 'conservative', 'conservative ni': 'conservative', 'conservative ni area': 'conservative',
    'nationalist party': 'nationalist-party-ni', 'nationalist': 'nationalist-party-ni',
    'republican labour party': 'republican-labour', 'republican labour': 'republican-labour',
    'unity': 'unity', 'pup': 'pup', 'progressive unionist party': 'pup',
    'irsp': 'irsp', 'irish republican socialist party': 'irsp',
    'labour 87': 'labour-87', 'ulster democratic party': 'ulster-democratic-party', 'udp': 'ulster-democratic-party',
    'ulster loyalist democratic party': 'ulster-democratic-party', 'uldp': 'ulster-democratic-party',
    'ulster loyalist democratic party uldp': 'ulster-democratic-party',
    'ulster independence committee': 'ulster-independence-movement',
    'ulster independence committee later ulster independence movement': 'ulster-independence-movement',
    'independent fianna fail': 'independent-fianna-fail', 'ni labour': 'ni-labour', 'nilp': 'ni-labour',
    'northern ireland labour party': 'ni-labour', 'ni labour former': 'ni-labour',
    'united labour party': 'united-labour-party', 'protestant unionist': 'protestant-unionist',
    'protestant unionist party': 'protestant-unionist', 'republican sinn fein': 'republican-sinn-fein',
    'national democratic party': 'national-democratic-party', 'natural law party': 'natural-law-party',
    'people s democracy': 'people-s-democracy', 'communist party of ireland': 'communist-party-of-ireland',
    'green party northern ireland': 'green-party-ni', 'sdp': 'sdp', 'social democratic party': 'sdp',
    'british ulster dominion party': 'british-ulster-dominion-party', 'volunteer political party': 'volunteer-political-party',
    'northern ireland women s coalition': 'northern-ireland-women-s-coalition',
    'uuup former': 'uuup',
    'ni labour party': 'ni-labour', 'newtownabbey labour party': 'newtownabbey-labour',
    'communist party of northern ireland': 'communist-ni',
}
# Strings that name no single party at a single time: never guessed.
PARTY_REFUSED = {
    'vanguard': 'Ulster Vanguard (the 1972 movement) and the Vanguard party (from March 1973) are not distinguished',
    'ulster vanguard': 'the 1972 Ulster Vanguard movement predates the registry party (founded March 1973)',
}


class Parties:
    def __init__(self):
        reg = json.load(open(os.path.join(PARTIES_DIR, 'party_registry.json'), encoding='utf-8'))
        self.entities = {e['id']: e for e in reg['entities']}
        self.alias = {}
        for e in reg['entities']:
            for a in [e['name'], e.get('shortName')] + [x if isinstance(x, str) else x.get('string') for x in e.get('aliases') or []]:
                k = norm(a)
                if k and k not in self.alias:
                    self.alias[k] = e['id']

    def resolve(self, s):
        """(party_id, None) or (None, reason)."""
        k = norm(s)
        if not k:
            return None, 'no party'
        if k in PARTY_REFUSED:
            return None, PARTY_REFUSED[k]
        pid = PARTY_MAP.get(k) or self.alias.get(k)
        if pid and pid in self.entities:
            return pid, None
        return None, f'party not in the Civgraph registry: {s}'

    def resolve_label(self, s):
        """Party ids a candidacy label string resolves to (for a person's party evidence)."""
        k = norm(s)
        pid = PARTY_MAP.get(k) or self.alias.get(k)
        return pid


# ---------------------------------------------------------------- persons

NICK = [
    {'james', 'jim', 'jimmy', 'jas'}, {'william', 'bill', 'billy', 'willie', 'will', 'wm'}, {'robert', 'bob', 'bobby', 'rab', 'robin'},
    {'thomas', 'tom', 'tommy'}, {'patrick', 'paddy', 'pat', 'packy', 'padraig'}, {'john', 'jack', 'johnny', 'sean', 'jackie'},
    {'edward', 'eddie', 'ted', 'ned', 'eamon', 'eamonn'}, {'joseph', 'joe', 'joey'}, {'michael', 'mick', 'mickey', 'mike'},
    {'daniel', 'dan', 'danny'}, {'richard', 'dick', 'dickie', 'rick'}, {'samuel', 'sam', 'sammy'}, {'francis', 'frank', 'frankie'},
    {'gerard', 'gerry', 'ger'}, {'charles', 'charlie'}, {'albert', 'bertie', 'bert'}, {'herbert', 'bertie', 'herb'},
    {'henry', 'harry', 'hal'}, {'harold', 'harry'}, {'desmond', 'des'}, {'kenneth', 'ken', 'kenny'},
    {'alexander', 'alex', 'sandy', 'alasdair', 'alastair', 'alistair'}, {'margaret', 'maggie', 'peggy'},
    {'ronald', 'ron', 'ronnie'}, {'raymond', 'ray'}, {'reginald', 'reg'}, {'frederick', 'fred', 'freddie'},
    {'anthony', 'tony'}, {'ernest', 'ernie'}, {'laurence', 'larry', 'lawrence'}, {'nicholas', 'nick'},
    {'christopher', 'chris'}, {'timothy', 'tim'}, {'gregory', 'greg'}, {'maurice', 'mo'}, {'marjorie', 'mo'},
    {'seamus', 'james'}, {'proinsias', 'francis'}, {'tomas', 'thomas'}, {'ruairi', 'rory'}, {'mary', 'maire'},
    {'elizabeth', 'betty', 'liz', 'lily'}, {'catherine', 'kathleen', 'kate'}, {'dorothy', 'dot'},
    {'hugh', 'hughie'}, {'peter', 'pete'}, {'david', 'dave', 'davy'}, {'andrew', 'andy'}, {'stephen', 'steve'},
    {'oliver', 'ollie'}, {'cecil'}, {'malachy', 'malachi'}, {'denis', 'dennis'}, {'jeffrey', 'jeff'},
]
NICK_OF = collections.defaultdict(set)
for group in NICK:
    for n in group:
        NICK_OF[n] |= group
TITLES = {'sir', 'rev', 'reverend', 'dr', 'lord', 'lady', 'prof', 'professor', 'mrs', 'ms', 'mr', 'miss', 'baroness',
          'dame', 'canon', 'senator', 'councillor', 'cllr', 'alderman', 'the', 'hon', 'junior', 'senior', 'jnr', 'snr', 'jr', 'sr', 'qc', 'mp'}
# The name a person stood under where the book uses another form of it (research: Ruairí Ó
# Brádaigh contested the 1957 and 1961 Dáil elections as Rory Brady).
PERSON_ALIASES = {
    'ruairi o bradaigh': 'Rory Brady',
}
NOT_A_NAME = re.compile(r'\b(not named|unnamed|councillors?)\b', re.I)


def name_tokens(name):
    s = re.sub(r'\([^)]*\)', ' ', str(name or ''))
    s = strip_accents(s).lower().replace("'", '').replace('\u2019', '')
    toks = [t for t in re.split(r'[^a-z\-]+', s) if t]
    toks = [t for t in toks if t not in TITLES]
    # Irish surnames written as two words ("Mac Giolla", "O Bradaigh", "De Rossa") are one.
    out = []
    for t in toks:
        if out and out[-1] in ('mac', 'mc', 'o', 'de', 'du', 'van', 'von', 'ni', 'nic', 'ui'):
            out[-1] = out[-1] + t
        else:
            out.append(t)
    return out


def given_compatible(a, b):
    """Given-name lists a (the fact's) and b (a record's) can be one person's."""
    if not a or not b:
        return True
    def same(x, y):
        x, y = x.strip('-'), y.strip('-')
        return x == y or y in NICK_OF.get(x, ()) or x in NICK_OF.get(y, ())
    a0, b0 = a[0].strip('-'), b[0].strip('-')
    # An initial stands only for the FIRST given name ("R. Burke" is not Ray Burke because
    # Ulick R. Burke has an R in the middle).
    if len(a0) == 1 or len(b0) == 1:
        return a0[0] == b0[0]
    # The record's first given name must be one of the fact's (a middle name used as the
    # usual name: "Robert Lloyd Hall-Thompson" for Lloyd Hall-Thompson), or the other way round.
    return any(same(b0, x) for x in a if len(x) > 1) or any(same(a0, y) for y in b if len(y) > 1)


class Persons:
    def __init__(self, parties):
        reg = json.load(open(os.path.join(PERSONS_DIR, 'person_registry.json'), encoding='utf-8'))
        cw = json.load(open(os.path.join(PERSONS_DIR, 'official-person-crosswalk.json'), encoding='utf-8'))
        self.entities = {e['personId']: e for e in reg['entities'] if e.get('keyedBy') != 'registered'}
        self.by_surname = collections.defaultdict(list)
        self.party_ids = {}
        self.life = {}
        for pid, e in self.entities.items():
            seen = set()
            for n in [e['displayName']] + list(e.get('aliases') or []):
                toks = name_tokens(n)
                if len(toks) >= 1 and (toks[-1], tuple(toks[:-1])) not in seen:
                    seen.add((toks[-1], tuple(toks[:-1])))
                    self.by_surname[toks[-1]].append((toks[:-1], pid))
            self.party_ids[pid] = {parties.resolve_label(p) for p in e.get('parties') or []} - {None}
            qids = set()
            for o in e.get('officialPersonIds') or []:
                if o.startswith('wikidata:'):
                    qids.add(o.split(':', 1)[1])
                elif cw['ids'].get(o):
                    qids.add(cw['ids'][o])
            if len(qids) == 1:
                self.life[pid] = cw['people'].get(next(iter(qids))) or {}

    def candidates(self, name):
        toks = name_tokens(name)
        if len(toks) < 2:
            return None, []
        sur, given = toks[-1], toks[:-1]
        pids = sorted({pid for g, pid in self.by_surname.get(sur, []) if given_compatible(given, g)})
        return toks, pids

    def add_party_evidence(self, pid, party_id):
        """A cited affiliation (affiliations.json) is party evidence for the person too."""
        if pid in self.party_ids and party_id:
            self.party_ids[pid].add(party_id)

    def match(self, name, year, party_ids=(), bodies=(), late=25):
        """(person_id, how) or (None, reason). Name AND dates AND party-or-body, never the name alone.

        `late` is how many years after a person's last candidacy the office may fall (a party
        presidency often goes to a member long after his last election)."""
        if not name or NOT_A_NAME.search(str(name)):
            return None, 'no person named'
        toks, pool = self.candidates(name)
        if toks is None:
            return None, f'name too short to match: {name}'
        if not pool:
            return None, 'no-record'
        party_ids, bodies = set(party_ids or ()), set(bodies or ())
        fits, in_era = [], []
        for pid in pool:
            e = self.entities[pid]
            lo, hi = e.get('firstYear'), e.get('lastYear')
            life = self.life.get(pid) or {}
            if year:
                if lo and hi and not (lo - 20 <= year <= hi + late):
                    continue
                born, died = (life.get('born') or '')[:4], (life.get('died') or '')[:4]
                if born.isdigit() and year < int(born) + 16:
                    continue
                if died.isdigit() and year > int(died):
                    continue
            in_era.append(pid)
            ctx = (party_ids & self.party_ids[pid]) or (bodies & set(e.get('bodies') or []))
            if not ctx:
                continue
            fits.append(pid)
        if not in_era:
            # Every record of the name is somebody else: too early, too late or dead.
            return None, 'no-record'
        if len(fits) == 1:
            return fits[0], 'name, dates and ' + ('party' if party_ids & self.party_ids[fits[0]] else 'body')
        if len(fits) > 1:
            if year:
                tight = [p for p in fits if (self.entities[p].get('firstYear') or 0) - 2 <= year <= (self.entities[p].get('lastYear') or 9999) + 2]
                if len(tight) == 1:
                    return tight[0], 'name, dates and party/body; the only record whose career spans the date'
            # Where one of the fitting records is a parliamentarian with official identifiers
            # and the others have none, the office-holder is the parliamentarian; the others are
            # shorter same-name council records (the registry keeps such splits apart until a
            # merge is proven, so this picks the record, it does not merge them).
            official = [p for p in fits if self.entities[p].get('officialPersonIds')]
            if len(official) == 1:
                return official[0], 'name, dates and party/body; the one fitting record with official identifiers'
            return None, 'ambiguous: several records fit (' + ', '.join(f'p{p}' for p in fits) + ')'
        return None, 'name-only: records share the name but none fits by dates and party or body (' + ', '.join(f'p{p}' for p in pool[:6]) + ')'


class NonCandidates:
    """People registered without a candidacy, in their own id block (900001+)."""

    def __init__(self):
        self.path = os.path.join(PERSONS_DIR, 'non-candidate-persons.json')
        self.doc = json.load(open(self.path, encoding='utf-8')) if os.path.exists(self.path) else None
        self.by_key = {}
        self.next = NONCANDIDATE_BLOCK
        for p in (self.doc or {}).get('persons', []):
            self.by_key[p['key']] = p
            self.next = max(self.next, int(p['personId']) + 1)
        self.used = set()

    def get(self, name, cite, office_id):
        toks = name_tokens(name)
        titled = len(toks) < 2
        # First given name and surname: "Gerard B. Newe" and "Gerard Newe" are one man.
        key = norm(name) if titled else f'{toks[0]} {toks[-1]}'
        p = self.by_key.get(key)
        if not p:
            display = re.sub(r'\s+', ' ', re.sub(r'\([^)]*\)', '', str(name))).strip()
            # Peers are known by their titles ("Lord Elton"); knights and clergy by their names.
            display = re.sub(r'^(Sir|Rev\.?|Dr\.?|Dame)\s+', '', display)
            p = {'personId': str(self.next), 'key': key, 'displayName': display, 'aliases': [display],
                 'officialPersonIds': [], 'basis': [], 'citations': []}
            self.next += 1
            self.by_key[key] = p
        if office_id not in p['basis']:
            p['basis'].append(office_id)
        if cite['fact'] not in {c.get('fact') for c in p['citations']}:
            p['citations'].append(cite)
        self.used.add(key)
        return p['personId']


# ---------------------------------------------------------------- flattening

def flatten_office_fact(f):
    """(person name, office string, party string, start, end, extra) items of an office or party-leader fact."""
    d = f['details']
    items = []
    base_party = d.get('party')
    person = d.get('person') or d.get('holder_identified') or d.get('leader')
    if f['section'] in ('office-holders', 'systems-of-government') and not d.get('person'):
        person = d.get('holder_identified') or (d.get('holder') if d.get('holder') and not str(d.get('holder')).isupper() else None)
    if isinstance(d.get('offices'), list):
        for o in d['offices']:
            if isinstance(o, dict):
                items.append((o.get('person') or person, o.get('office'), o.get('party') or base_party, o.get('start'), o.get('end'), o))
        return items
    for key in ('successions', 'leaders'):
        if isinstance(d.get(key), list):
            for o in d[key]:
                if isinstance(o, dict):
                    items.append((o.get('person'), d.get('office') or 'Leader', base_party, o.get('start'), o.get('end'), o))
            return items
    if isinstance(d.get('office_holders'), list):
        for o in d['office_holders']:
            items.append((o.get('person'), o.get('office'), base_party, d.get('start'), d.get('end'), o))
        return items
    if isinstance(d.get('terms'), list):
        for t in d['terms']:
            if isinstance(t, (list, tuple)) and len(t) == 2:
                items.append((person, d.get('office'), base_party, t[0], t[1], d))
        return items
    if d.get('incoming') or d.get('outgoing'):
        when = d.get('date') or f.get('date')
        if d.get('outgoing'):
            items.append((d['outgoing'], d.get('office') or 'Leader', base_party, None, when, {'_role': 'outgoing'}))
        if d.get('incoming'):
            items.append((d['incoming'], d.get('office') or 'Leader', base_party, when, None, {'_role': 'incoming'}))
        return items
    office = d.get('office')
    # "Minister for Justice (1973-7); Minister for Defence (1982-6)": each office its own dates.
    if office and ';' in office:
        parts = [p.strip() for p in office.split(';')]
        dated = [re.match(r'^(.*?)\s*\((\d{4})(?:\s*[-–]\s*(\d{1,4}))?\)\s*$', p) for p in parts]
        if any(dated):
            for p, m in zip(parts, dated):
                if not m:
                    items.append((person, p, base_party, None, None, d))
                    continue
                lo, hi = m.group(2), m.group(3)
                if hi:
                    hi = lo[:4 - len(hi)] + hi
                    if hi < lo:
                        hi = None
                items.append((person, m.group(1), base_party, lo, hi, d))
            return items
    if f['type'] == 'party-leader' and not office:
        office = 'Leader' if person else None
    start, end = d.get('start'), d.get('end')
    if not start and not end and f['section'] == 'chronology':
        # A chronology entry is dated: "named as leader" on that day is the start.
        if d.get('event') and re.search(r'resign|stood down', str(d.get('event'))):
            end = d.get('date') or f.get('date')
        elif f['type'] == 'party-leader' and re.search(r'named|elected|became|succeed|new', f['subject'], re.I):
            start = f.get('date')
        elif f['type'] == 'office' and re.search(r'appointed|became|elected|named|succeed|took office|new', f['subject'], re.I):
            start = f.get('date')
    if not start and d.get('in_office_on'):
        pass
    items.append((person, office, base_party, start, end, d))
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--facts', default=DEFAULT_FACTS)
    ap.add_argument('--unmapped', default=DEFAULT_UNMAPPED)
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    if not args.facts or (args.write and not args.unmapped):
        ap.error('--facts (and, with --write, --unmapped) are required: both live outside the repository')

    facts = [json.loads(line) for line in open(args.facts, encoding='utf-8') if line.strip()]
    parties = Parties()
    persons = Persons(parties)
    noncands = NonCandidates()
    unmapped = []

    def miss(f, item, reason):
        unmapped.append({'fact': f['id'], 'type': f['type'], 'book_page': f['book_page'], 'section': f['section'],
                         'subject': f['subject'], 'item': item, 'reason': reason})

    # ------------------------------------------------ affiliations
    changes = collections.defaultdict(list)
    for f in facts:
        if f['type'] != 'party-change':
            continue
        d = f['details']
        names = []
        if d.get('person'):
            names = [d['person']]
        elif isinstance(d.get('persons'), list):
            names = [p if isinstance(p, str) else p.get('name') for p in d['persons']]
        if not names:
            miss(f, json.dumps(d, ensure_ascii=False)[:120], 'no person named')
            continue
        if d.get('moves') or (isinstance(d.get('persons'), list) and any(isinstance(p, dict) and p.get('from_party') for p in d['persons'])):
            miss(f, ', '.join(map(str, names)), 'several moves in one fact; needs manual reading')
            continue
        event = str(d.get('event') or '')
        # The change's own date, else the fact's; a 'start' key is often another office's
        # start (Hall-Thompson's Convention seat), so it is not the date of the move.
        raw_date = d.get('date') or (f.get('date') if not d.get('event') or 'whip' in event else None)
        date, prec, qual = parse_date(raw_date)
        for name in names:
            label = f"{name} | {d.get('from_party')} -> {d.get('to_party') or d.get('to_group') or event} | {raw_date}"
            if 'whip' in event:
                pid_party, why = parties.resolve(d.get('party'))
                if not pid_party:
                    miss(f, label, why)
                    continue
                if 'withdrawn' in event or 'removed' in event or 'lost' in event:
                    kind_from, kind_to = pid_party, None
                else:
                    miss(f, label, 'whip event not modelled')
                    continue
                if not date:
                    miss(f, label, 'no date given')
                    continue
                pid, how = persons.match(name, year_of(date), {pid_party}, ())
                if not pid:
                    miss(f, label, how)
                    continue
                end2, _, _ = parse_date(d.get('end'))
                changes[str(pid)].append({'from': pid_party, 'to': None, 'date': date, 'prec': prec, 'kind': 'whip',
                                          'endEvent': 'whip-withdrawn', 'restored': end2, 'cite': citation(f), 'how': how,
                                          'fact': f, 'label': label})
                continue
            if event and not d.get('from_party'):
                miss(f, label, 'event not modelled as an affiliation change')
                continue
            from_id, why_from = parties.resolve(d.get('from_party')) if d.get('from_party') else (None, 'no from-party')
            if from_id and from_id == parties.resolve(d.get('to_party'))[0]:
                miss(f, label, 'left and rejoined one party; needs manual reading')
                continue
            to_raw = d.get('to_party') if 'to_party' in d else d.get('to_group')
            to_id, why_to = (parties.resolve(to_raw) if to_raw else (None, None))
            to_label = None
            if to_raw and not to_id and d.get('to_group'):
                to_label = to_raw
            if to_raw and not to_id and not to_label:
                if re.search(r'32[ -]county sovereignty', norm(to_raw)):
                    to_label = '32 County Sovereignty Committee'
                elif norm(to_raw) in ('none',):
                    to_raw = None
                else:
                    miss(f, label, f'to-party not resolved: {why_to}')
                    continue
            if not from_id:
                miss(f, label, f'from-party not resolved: {why_from}')
                continue
            if not date:
                miss(f, label, 'no date given' + (f' (only: {qual})' if qual else ''))
                continue
            pid, how = persons.match(name, year_of(date), {from_id, to_id} - {None}, ())
            if not pid:
                miss(f, label, how)
                continue
            changes[str(pid)].append({'from': from_id, 'to': to_id, 'toLabel': to_label, 'date': date, 'prec': prec, 'kind': 'party',
                                      'cite': citation(f), 'how': how, 'fact': f, 'label': label})

    affiliations = []
    for pid, chs in changes.items():
        # One change cited on several pages is one change.
        uniq = []
        for c in sorted(chs, key=lambda c: (c['date'], -len(c['date']))):
            same = next((u for u in uniq if u['from'] == c['from'] and u['to'] == c['to'] and u.get('toLabel') == c.get('toLabel')
                         and u['kind'] == c['kind'] and (u['date'].startswith(c['date']) or c['date'].startswith(u['date']))), None)
            near = same or next((u for u in uniq if u['from'] == c['from'] and u['to'] == c['to'] and u.get('toLabel') == c.get('toLabel')
                                 and u['kind'] == c['kind'] and abs(int(u['date'][:4]) - int(c['date'][:4])) <= 1), None)
            if near and not same:
                # The same move dated differently on two pages (Roche left the UKUP in
                # December 1998, the party he joined was formed in January 1999): the first
                # date is kept and the other page listed.
                miss(c['fact'], c['label'], f"the same move is dated {near['date']} by {near['cites'][0]['citation']}; that date is kept")
                continue
            if same:
                if len(c['date']) > len(same['date']):
                    same['date'], same['prec'] = c['date'], c['prec']
                if c['cite']['fact'] not in {x['fact'] for x in same['cites']}:
                    same['cites'].append(c['cite'])
            else:
                c['cites'] = [c['cite']]
                uniq.append(c)
        ivs = []
        for c in sorted(uniq, key=lambda c: c['date']):
            kind = 'independent' if (c['from'] or '').startswith('ind') else c['kind']
            open_iv = next((iv for iv in ivs if iv['partyId'] == c['from'] and iv['end'] is None and iv['kind'] in ('party', 'independent', 'whip')), None)
            to_is_party = c.get('to') and not c['to'].startswith('ind')
            end_event = c.get('endEvent') or ('joined-party' if kind == 'independent' else 'defected-to' if to_is_party else 'left')
            if open_iv:
                open_iv.update(end=c['date'], endPrecision=c['prec'], endEvent=end_event)
                open_iv['citations'] += [x for x in c['cites'] if x['fact'] not in {y['fact'] for y in open_iv['citations']}]
            else:
                ivs.append({'personId': pid, 'partyId': c['from'], 'kind': kind, 'start': None, 'startPrecision': None, 'startEvent': None,
                            'end': c['date'], 'endPrecision': c['prec'], 'endEvent': end_event, 'citations': list(c['cites']), 'matchedBy': c['how']})
            if c['kind'] == 'whip' and c.get('restored'):
                ivs.append({'personId': pid, 'partyId': c['from'], 'kind': 'whip', 'start': c['restored'], 'startPrecision': parse_date(c['restored'])[1],
                            'startEvent': 'whip-restored', 'end': None, 'endPrecision': None, 'endEvent': None, 'citations': list(c['cites']), 'matchedBy': c['how']})
            if c.get('to') or c.get('toLabel'):
                iv = {'personId': pid, 'partyId': c.get('to'), 'kind': 'independent' if (c.get('to') or '').startswith('ind') else ('group' if c.get('toLabel') else 'party'),
                      'start': c['date'], 'startPrecision': c['prec'], 'startEvent': 'joined' if to_is_party or c.get('toLabel') else 'left-party',
                      'end': None, 'endPrecision': None, 'endEvent': None, 'citations': list(c['cites']), 'matchedBy': c['how']}
                if c.get('toLabel'):
                    iv['label'] = c['toLabel']
                ivs.append(iv)
        for iv in ivs:
            ref = iv['partyId'] or norm(iv.get('label') or 'group').replace(' ', '-')
            iv['id'] = f"{pid}:{ref}:{iv['start'] or ('to-' + (iv['end'] or 'open'))}:{iv['kind']}"
            affiliations.append(iv)

    # Cited affiliations are party evidence when matching the same people to offices.
    for a in affiliations:
        if a.get('partyId') and int(a['personId']) in persons.party_ids:
            persons.add_party_evidence(int(a['personId']), a['partyId'])

    # ------------------------------------------------ tenures
    # Pass 1: each item's office, dates and context; people are matched in pass 2.
    items = []
    for f in facts:
        if f['type'] not in ('office', 'party-leader'):
            continue
        d = f['details']
        if f['id'] in ('dD-0101', 'dF-0096', 'dE-0074', 'dE-0137', 'cA-0045', 'dD-0102'):
            continue   # a contest or a resignation already carried by its tenure: not a tenure of its own
        for name, office_raw, party_raw, start_raw, end_raw, extra in flatten_office_fact(f):
            label = f'{name or "?"} | {office_raw or "?"} | {start_raw or ""}-{end_raw or ""}'
            if not office_raw:
                miss(f, label, 'no office named')
                continue
            party_id = None
            if party_raw:
                party_id, why = parties.resolve(party_raw)
            if d.get('polling_date') and start_raw == f.get('date'):
                start_raw = None
            start, sp, sq = parse_date(start_raw)
            end, ep, eq = parse_date(end_raw)
            year = year_of(start, end, f.get('date'))
            oid, why = ef_offices.match(office_raw, party_id, year, f['section'])
            if oid is None and why is None:
                if party_raw and not party_id:
                    miss(f, label, parties.resolve(party_raw)[1])
                    continue
                oid, why = ef_offices.match_party_office(office_raw, party_id)
            if not oid:
                miss(f, label, why or 'office not modelled')
                continue
            if not start and not end:
                why = 'no start or end date given'
                if d.get('polling_date'):
                    why = 'only the polling day is given, not the start of the tenure'
                miss(f, label, why + (f' (only: {sq or eq})' if sq or eq else ''))
                continue
            if start and end and end < start[:len(end)]:
                miss(f, label, f'end {end} before start {start}')
                continue
            if not name:
                miss(f, label, 'holder not named or not identified')
                continue
            note = None
            if sq or eq:
                note = 'The source dates this only as: ' + '; '.join(x for x in (sq and f'start {sq}', eq and f'end {eq}') if x)
            began = 'acting' if re.search(r'\bacting\b', str(office_raw), re.I) else None
            ended = None
            # How a tenure ended: only for a tenure the source ends, and only from what the fact
            # says of that end (a cause, a resignation, the chronology's own entry). A note about
            # someone else ("after Molyneaux resigned") says nothing about this tenure.
            cause = ' '.join(str(extra.get(k) or '') for k in ('cause', 'reason', 'event')) if isinstance(extra, dict) and end else ''
            if end and f['section'] == 'chronology':
                cause += ' ' + f['subject']
            if re.search(r'\bresign', cause, re.I) or (end and isinstance(extra, dict) and extra.get('resigned')):
                ended = 'resigned'
            elif re.search(r'\bdismiss|\bsacked\b', cause, re.I):
                ended = 'dismissed'
            elif re.search(r'\bdied\b|\bdeath\b|\bkilled\b', cause, re.I):
                ended = 'died'
            items.append({'f': f, 'name': name, 'oid': oid, 'party_id': party_id, 'year': year, 'label': label,
                          'start': start, 'sp': sp, 'end': end, 'ep': ep, 'note': note, 'began': began, 'ended': ended,
                          'pred': extra.get('predecessor') if isinstance(extra, dict) else None,
                          'succ': extra.get('successor') if isinstance(extra, dict) else None})

    # Co-options: council seats filled by co-option are tenures, not elections.
    for f in facts:
        d = f['details']
        if f['type'] != 'council-by-election' or str(d.get('method') or '').lower() != 'co-option':
            continue
        council = d.get('council') or d.get('body') or ''
        stem = ef_offices._council(ef_offices.norm(council))
        label = f"{d.get('person')} | co-opted to {council} | {d.get('date') or f.get('date')}"
        if not stem:
            miss(f, label, 'council not in the catalogue')
            continue
        start, sp, _ = parse_date(d.get('date') or f.get('date'))
        items.append({'f': f, 'name': d.get('person'), 'oid': f'councillor-{stem}', 'year': year_of(start), 'label': label,
                      'party_id': parties.resolve(d.get('party'))[0] if d.get('party') else None,
                      'start': start, 'sp': sp, 'end': None, 'ep': None, 'note': None, 'began': 'co-opted', 'ended': None,
                      'pred': None, 'succ': None})

    # Pass 2: people. A dictionary entry is about one person, so where one of its offices
    # matches by the evidence, its other offices under the same name are that person too
    # (David Cook's Police Authority chair beside his Lord Mayoralty, p. 215).
    def entry_key(it):
        toks = name_tokens(PERSON_ALIASES.get(norm(it['name']), it['name']))
        return (toks[0] if toks else '', toks[-1] if toks else '')

    for it in items:
        off = ef_offices.OFFICES[it['oid']]
        ctx = {it['party_id']} - {None}
        if off.get('partyId'):
            ctx.add(off['partyId'])
        party_kind = ef_offices.INSTITUTIONS[off['institution']]['kind'] == 'party'
        it['pid'], it['how'] = persons.match(PERSON_ALIASES.get(norm(it['name']), it['name']), it['year'], ctx, off['bodies'], late=45 if party_kind else 25)
    entries = {}
    for it in items:
        if it['pid'] and it['f']['section'] == 'dictionary':
            entries.setdefault((it['f']['book_page'], entry_key(it)), set()).add(it['pid'])
    raw_tenures = []
    for it in items:
        f, off, name = it['f'], ef_offices.OFFICES[it['oid']], it['name']
        pid, how = it['pid'], it['how']
        cite = citation(f)
        if pid is None and f['section'] == 'dictionary':
            found = set()
            for page in (f['book_page'] - 1, f['book_page'], f['book_page'] + 1):
                found |= entries.get((page, entry_key(it)), set())
            if len(found) == 1:
                pid, how = next(iter(found)), 'the same dictionary entry as another office matched by name, dates and party/body'
        if pid is None:
            no_record = how == 'no-record'
            uk_level = off['institution'] in ('northern-ireland-office', 'uk-government', 'ni-civil-service', 'uk-house-of-commons')
            # A peer the book names by title alone ("Lord Elton") is registered under it.
            titled = how.startswith('name too short') and re.match(r'^(Lord|Baroness|Lady)\s+\S+$', str(name).strip())
            if off['noncandidates'] and (no_record or (uk_level and (how.startswith('name-only') or titled))):
                pid = noncands.get(name, cite, it['oid'])
                how = 'registered non-candidate'
            else:
                miss(f, it['label'], how if how != 'no-record' else 'no person record of this name (and the office is one candidates hold)')
                continue
        raw_tenures.append({
            'officeId': it['oid'], 'personId': str(pid), 'start': it['start'], 'startPrecision': it['sp'], 'end': it['end'], 'endPrecision': it['ep'],
            'began': it['began'], 'ended': it['ended'], 'note': it['note'], 'how': how, 'citations': [cite], 'rank': SECTION_RANK.get(f['section'], 9),
            'fact': f['id'], 'predecessorName': it['pred'], 'successorName': it['succ'], 'label': it['label'], 'factObj': f,
        })

    # A generic "NIO minister" or "Minister of State" tenure the chronology dates is the same
    # tenure as the portfolio the tables give that person at that date: one tenure, both citations.
    portfolio = [t for t in raw_tenures if t['officeId'].startswith('nio-minister-') and t['officeId'] != 'nio-minister-of-state']
    folded = []
    for t in raw_tenures:
        if t['officeId'] not in ('nio-minister', 'nio-minister-of-state'):
            continue
        y0, y1 = int((t['start'] or t['end'])[:4]), int((t['end'] or t['start'])[:4])
        hits = [p for p in portfolio if p['personId'] == t['personId'] and int((p['start'] or p['end'])[:4]) <= y1 and int((p['end'] or '9999')[:4]) >= y0]
        if len(hits) == 1:
            h = hits[0]
            for field, prec in (('start', 'startPrecision'), ('end', 'endPrecision')):
                if t[field] and h[field] and t[field].startswith(h[field]) and len(t[field]) > len(h[field]):
                    h[field], h[prec] = t[field], t[prec]
            h['citations'] += t['citations']
            h['ended'] = h['ended'] or t['ended']
            folded.append(t)
    raw_tenures = [t for t in raw_tenures if t not in folded]

    # Merge one tenure cited on several pages. Two records of one person in one office whose
    # years overlap are one tenure: dates that agree (one more precise than the other) merge;
    # where they disagree the tables' date is kept and the other page is listed as unmapped.
    def compatible(a, b):
        return a is None or b is None or a.startswith(b) or b.startswith(a)

    def years(t):
        lo = int((t['start'] or t['end'])[:4])
        hi = int((t['end'] or t['start'])[:4])
        return lo, hi

    def before(a, b):
        n = min(len(a), len(b))
        return a[:n] < b[:n]

    def same_tenure(m, t):
        """Two records of one person in one office are one tenure unless one ends before the
        other starts, or they give starts (or ends) in different years: two terms."""
        for x, y in ((m, t), (t, m)):
            if x['end'] and y['start'] and before(x['end'], y['start']):
                return False
        if m['start'] and t['start'] and m['start'][:4] != t['start'][:4]:
            return False
        if m['end'] and t['end'] and m['end'][:4] != t['end'][:4]:
            return False
        return True

    merged = []
    for t in sorted(raw_tenures, key=lambda t: (t['officeId'], t['personId'], t['rank'], t['start'] or '', t['end'] or '')):
        hit = next((m for m in merged if m['officeId'] == t['officeId'] and m['personId'] == t['personId'] and same_tenure(m, t)), None)
        if not hit:
            merged.append(dict(t))
            continue
        disagree = []
        for field, prec in (('start', 'startPrecision'), ('end', 'endPrecision')):
            if compatible(hit[field], t[field]):
                if t[field] and (not hit[field] or len(t[field]) > len(hit[field])):
                    hit[field], hit[prec] = t[field], t[prec]
            else:
                disagree.append(f'{field} {t[field]} where {hit["citations"][0]["citation"]} gives {hit[field]}')
        if disagree:
            miss(t['factObj'], t['label'], 'dates disagree with another page; the tables\' (or first) date is kept: ' + '; '.join(disagree))
        hit['citations'] += [c for c in t['citations'] if c['fact'] not in {x['fact'] for x in hit['citations']}]
        for k in ('began', 'ended', 'predecessorName', 'successorName'):
            if t.get(k) and not hit.get(k):
                hit[k] = t[k]
        if t.get('note') and not hit.get('note'):
            hit['note'] = t['note']

    # Predecessors and successors where the book names them and they resolve to a holder of the office.
    holders = collections.defaultdict(set)
    for t in merged:
        holders[t['officeId']].add(t['personId'])
    name_of = lambda pid: (persons.entities.get(int(pid)) or {}).get('displayName') if str(pid).isdigit() and int(pid) in persons.entities else None
    for t in merged:
        for field in ('predecessor', 'successor'):
            raw = t.pop(f'{field}Name', None)
            if not raw:
                continue
            raw = re.split(r'\s*\(', str(raw))[0]
            toks = name_tokens(raw)
            hits = [h for h in holders[t['officeId']] if h != t['personId'] and (
                (name_of(h) and name_tokens(name_of(h))[-1:] == toks[-1:]) or
                (any(p['personId'] == h and p['key'].split()[-1:] == toks[-1:] for p in noncands.by_key.values())))]
            if len(hits) == 1:
                t[field] = hits[0]

    # Contest links and ids.
    tenures = []
    seen_ids = collections.Counter()
    for t in merged:
        key = (t['officeId'], (t['start'] or '')[:4])
        if key in CONTEST_WINNERS:
            t['contest'] = CONTEST_WINNERS[key]
            t['began'] = t['began'] or 'elected'
        base = f"{t['officeId']}:{t['personId']}:{t['start'] or ('to-' + t['end'])}"
        seen_ids[base] += 1
        tid = base if seen_ids[base] == 1 else f'{base}:{seen_ids[base]}'
        out = {'id': tid, 'personId': t['personId'], 'officeId': t['officeId'],
               'start': t['start'], 'startPrecision': t['startPrecision'], 'end': t['end'], 'endPrecision': t['endPrecision'],
               'began': t['began'], 'ended': t['ended']}
        for k in ('predecessor', 'successor', 'contest', 'note'):
            if t.get(k):
                out[k] = t[k]
        out['matchedBy'] = t['how']
        out['citations'] = sorted(t['citations'], key=lambda c: (SECTION_RANK.get(c['title'], 9), int(c['page'])))
        tenures.append(out)

    # ------------------------------------------------ party events
    # One fact can state several events (founded in one year, renamed in the next): each dated
    # key is its own event; the fact's event wording types an undated remainder.
    events = []
    EVENT_WORDS = [
        (r'reunif', 're-formed'), (r'\binto\b|merged with|merger$|^merger\b(?!/found)', 'merged-into'),
        (r'renam', 'renamed'), (r'split', 'split'),
        (r'dissol|wound up|disband|ceased|folded|absorbed', 'dissolved'),
        (r're-?form|reviv', 're-formed'), (r'suspend', 'suspended'),
        (r'organis|organiz|affiliat', 'began-organising-in-ni'),
        (r'first contest', 'first-contested'),
        (r'found|formed|launch|emerg|establish|creat|merger', 'founded'),
    ]
    SAME_FAMILY = {'split-from': 'split', 'split': 'split'}

    def add_event(f, pid, etype, date, prec, related=(), people=(), note=None):
        fam = SAME_FAMILY.get(etype, etype)
        for e in events:
            if e['partyId'] != pid or SAME_FAMILY.get(e['type'], e['type']) != fam:
                continue
            if e['date'].startswith(date) or date.startswith(e['date']):
                if len(date) > len(e['date']):
                    e['date'], e['precision'] = date, prec
                if etype == 'split-from':
                    e['type'] = 'split-from'
                for r in related:
                    if r not in e.setdefault('relatedParties', []):
                        e['relatedParties'].append(r)
                if f['id'] not in {c['fact'] for c in e['citations']}:
                    e['citations'].append(citation(f))
                return
            if abs(int(e['date'][:4]) - int(date[:4])) <= 1:
                keep_new = len(date) > len(e['date'])
                old_cite = e['citations'][0]['citation']
                if keep_new:
                    miss(e['_fact'], f"{pid} | {e['type']} | {e['date']}", f'date disagrees with {citation(f)["citation"]} ({date}); the more precise date is kept')
                    e.update(date=date, precision=prec, citations=[citation(f)], _fact=f)
                else:
                    miss(f, f'{pid} | {etype} | {date}', f'date disagrees with {old_cite} ({e["date"]}); the more precise date is kept')
                return
        e = {'id': f'{pid}:{etype}:{date}', 'partyId': pid, 'date': date, 'precision': prec, 'type': etype}
        if related:
            e['relatedParties'] = list(related)
        if people:
            e['persons'] = list(people)
        if note:
            e['note'] = note
        e['citations'] = [citation(f)]
        e['_fact'] = f
        events.append(e)

    def rel(raw, relation, pid):
        out = []
        for x in (raw if isinstance(raw, list) else [raw]):
            rid, _ = parties.resolve(x) if x else (None, None)
            if rid and rid != pid:
                out.append({'partyId': rid, 'relation': relation})
        return out

    for f in facts:
        if f['type'] != 'party':
            continue
        d = f['details']
        label = f"{d.get('party')} | {d.get('event')}"
        pid, why = parties.resolve(d.get('party'))
        if not pid:
            miss(f, label, why)
            continue
        ev = str(d.get('event') or '')
        people = []
        founders = d.get('founders') or d.get('founders_include') or ([d['founder']] if d.get('founder') else [])
        planned = []
        for key, etype in (('founded', 'founded'), ('renamed', 'renamed'), ('dissolved', 'dissolved'), ('ended', 'dissolved'), ('split', 'split')):
            date, prec, qual = parse_date(d.get(key)) if isinstance(d.get(key), str) else (None, None, None)
            if date:
                planned.append((etype, date, prec))
        if not planned:
            etype = next((t for pat, t in EVENT_WORDS if re.search(pat, ev, re.I)), None)
            if not etype:
                miss(f, label, 'event not modelled (a decision or statement, not a lifecycle event)')
                continue
            date, prec, qual = parse_date(d.get('date') or f.get('date'))
            if not date:
                miss(f, label, 'no date given' + (f' (only: {qual})' if qual else ''))
                continue
            planned.append((etype, date, prec))
        for etype, date, prec in planned:
            related = []
            if etype == 'founded':
                related += rel(d.get('split_from'), 'split from', pid) + rel(d.get('from_party'), 'split from', pid)
                related += rel(d.get('merged_from'), 'formed by merger of', pid)
                if re.search(r'replac', json.dumps(d), re.I):
                    related += rel(d.get('replaced'), 'replaced', pid)
            if etype in ('split',):
                if d.get('from_party') or d.get('split_from'):
                    etype = 'split-from'
                    related += rel(d.get('from_party') or d.get('split_from'), 'split from', pid)
            if etype in ('dissolved', 'merged-into'):
                related += rel(d.get('successor'), 'succeeded by', pid) + rel(d.get('into'), 'merged into', pid)
            if etype == 're-formed':
                related += rel(d.get('from'), 'formed by merger of', pid)
            people = []
            if etype == 'founded':
                for name in founders if isinstance(founders, list) else [founders]:
                    ppid, _ = persons.match(PERSON_ALIASES.get(norm(name), name), year_of(date), {pid}, ())
                    if ppid:
                        people.append({'personId': str(ppid), 'role': 'founder'})
            note = None
            former = d.get('founded_as') or d.get('original_name')
            if former and etype == 'founded':
                note = f'Founded as the {former}.' if not str(former).lower().startswith('the ') else f'Founded as {former}.'
            add_event(f, pid, etype, date, prec, related, people, note)
    for e in events:
        e.pop('_fact', None)
    # ------------------------------------------------ in-scope facts nothing else covers
    used = {c['fact'] for t in tenures for c in t['citations']} | {c['fact'] for e in events for c in e['citations']} \
        | {c['fact'] for a in affiliations for c in a['citations']} | set(CONTEST_FACTS)
    listed = {u['fact'] for u in unmapped}
    for f in facts:
        if f['type'] in ('office', 'party-leader', 'party-change', 'party') and f['id'] not in used and f['id'] not in listed:
            miss(f, '', 'nothing loadable in the fact')

    # ------------------------------------------------ output
    offices_used = sorted({t['officeId'] for t in tenures})
    report = collections.Counter()
    for t in tenures:
        for c in t['citations']:
            ftype = next(x['type'] for x in facts if x['id'] == c['fact'])
            report[f'tenure facts ({ftype})'] += 1
    print(f'tenures             : {len(tenures)} (offices {len(offices_used)})')
    for k, v in sorted(report.items()):
        print(f'  {k}: {v}')
    print(f'party events        : {len(events)} from {len({c["fact"] for e in events for c in e["citations"]})} facts')
    print(f'affiliations        : {len(affiliations)} intervals for {len(changes)} people from {len({c["fact"] for a in affiliations for c in a["citations"]})} facts')
    print(f'non-candidates      : {len(noncands.used)}')
    print(f'unmapped rows       : {len(unmapped)} ({len({u["fact"] for u in unmapped})} facts)')
    reasons = collections.Counter(re.sub(r'\(p\d.*|: .*', '', u['reason']).strip() for u in unmapped)
    for r, n in reasons.most_common(25):
        print(f'  {n:4} {r}')

    if not args.write:
        return

    def dump(path, doc):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=1)
            fh.write('\n')

    institutions_used = sorted({ef_offices.OFFICES[o]['institution'] for o in offices_used})
    office_rows = []
    for oid in offices_used:
        o = ef_offices.OFFICES[oid]
        row = {'id': oid, 'name': o['name'], 'institution': o['institution'], 'jurisdiction': o['jurisdiction'], 'kind': o['kind']}
        if o.get('partyId'):
            row['partyId'] = o['partyId']
        row['start'], row['startPrecision'], row['end'], row['endPrecision'] = None, None, None, None
        row['nameHistory'] = o['nameHistory']
        if o.get('note'):
            row['note'] = o['note']
        row['citations'] = []
        office_rows.append(row)
    dump(os.path.join(OFFICES_DIR, 'offices.json'), {
        'schemaVersion': 1,
        'description': 'Offices people held: ministries, mayoralties, party leaderships, council seats filled by co-option. '
                       'Who held each, and when, is in data/offices/tenures/*.json. Ids are permanent; a renamed office keeps '
                       'its id and gains a nameHistory entry. Dates an office existed are given only where a source states them. '
                       'Schema: data/schemas/offices.schema.json; see docs/facts-model.md.',
        'institutions': [{'id': i, **ef_offices.INSTITUTIONS[i]} for i in institutions_used],
        'offices': office_rows,
    })
    groups = collections.defaultdict(list)
    GROUP_OF = {'government': None, 'legislature': None, 'council': 'councils', 'party': 'parties', 'civil-service': 'public-bodies',
                'public-body': 'public-bodies', 'head-of-state': 'ireland'}
    for t in tenures:
        inst = ef_offices.OFFICES[t['officeId']]['institution']
        kind = ef_offices.INSTITUTIONS[inst]['kind']
        group = GROUP_OF.get(kind) or {'ni-government': 'ni-government', 'ni-parliament': 'ni-government', 'ni-executive-1974': 'ni-executive-1974',
                                       'northern-ireland-office': 'direct-rule', 'uk-government': 'direct-rule', 'uk-house-of-commons': 'direct-rule',
                                       'ie-government': 'ireland', 'european-commission': 'public-bodies'}.get(inst, 'ni-assemblies')
        groups[group].append(t)
    for old in os.listdir(os.path.join(OFFICES_DIR, 'tenures')) if os.path.isdir(os.path.join(OFFICES_DIR, 'tenures')) else []:
        if old.endswith('.json') and old[:-5] not in groups:
            os.remove(os.path.join(OFFICES_DIR, 'tenures', old))
    for group, rows in groups.items():
        rows.sort(key=lambda t: (t['officeId'], t['start'] or t['end'] or '', t['personId']))
        dump(os.path.join(OFFICES_DIR, 'tenures', f'{group}.json'), {
            'schemaVersion': 1,
            'description': f'Tenures of offices ({group}): who held an office of data/offices/offices.json, from when to when, how the '
                           'tenure began and ended where the source says, each cited. Dates carry their precision; none is invented. '
                           'Schema: data/schemas/tenures.schema.json.',
            'tenures': rows,
        })
    events.sort(key=lambda e: (e['partyId'], e['date'], e['type']))
    dump(os.path.join(PARTIES_DIR, 'party-events.json'), {
        'schemaVersion': 1,
        'description': 'Dated events in a party\'s life (founded, dissolved, renamed, split, merged, began organising in Northern '
                       'Ireland ...), each cited. Party ids are data/elections/parties/party_registry.json ids. These complement '
                       'the narrative events of party-lineage.json and relabel no candidacy. Schema: data/schemas/party-events.schema.json.',
        'events': events,
    })
    affiliations.sort(key=lambda a: (int(a['personId']), a['start'] or a['end'] or '', a['kind']))
    dump(os.path.join(PERSONS_DIR, 'affiliations.json'), {
        'schemaVersion': 1,
        'description': 'A person\'s party affiliation over time, as dated intervals (party, independent, group or whip), each cited. '
                       'It complements the label each candidacy carries and never overwrites it: where the two disagree, Browse '
                       'shows both. A start or end the source does not give is null. Schema: data/schemas/affiliations.schema.json.',
        'affiliations': affiliations,
    })
    persons_out = sorted((p for k, p in noncands.by_key.items() if k in noncands.used or k in {x['key'] for x in (noncands.doc or {}).get('persons', [])}),
                         key=lambda p: int(p['personId']))
    dump(noncands.path, {
        'schemaVersion': 1,
        'description': 'People in Civgraph who never stood in an election it holds (Northern Ireland Office ministers, civil servants, '
                       'party officers), registered so tenures can name them. Their ids are a block of their own (900001 and up) that '
                       'the candidate id assignment never uses; scripts/build_person_registry_v2.py adds them to person_registry.json '
                       'with keyedBy "registered". A person here who later stands must be merged into the candidate record, not '
                       'registered twice (scripts/validate-facts-model.mjs checks). Schema: data/schemas/non-candidate-persons.schema.json.',
        'idBlock': {'from': NONCANDIDATE_BLOCK, 'to': 999999},
        'persons': persons_out,
    })
    os.makedirs(os.path.dirname(args.unmapped), exist_ok=True)
    with open(args.unmapped, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['fact', 'type', 'book_page', 'section', 'subject', 'item', 'reason'])
        w.writeheader()
        for u in sorted(unmapped, key=lambda u: (u['type'], u['fact'])):
            w.writerow(u)
    print('written')


if __name__ == '__main__':
    main()
