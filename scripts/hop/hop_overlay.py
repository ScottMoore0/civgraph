"""The History of Parliament as a source for the 1801-1832 Irish contests.

Used by scripts/walker/import_walker_1801_1831.py. Walker stays the primary reading of a
contest; HoP (hop-crosscheck-1801-1832.json, from crosscheck_hop_1801_1832.py) is cited
where it agrees, settles contests the Wikipedia check left held, supplies what Walker and
Wikipedia do not print -- the electorate, the cause of a by-election, the outcome of a
petition -- and adds the contests Walker's scan lacks. Facts only: the Trust's narrative
is never copied, and every fact cites its HoP page.
"""
import collections
import json
import urllib.parse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'walker'))
import crosscheck_hop_1801_1832 as xc  # noqa: E402
from crosscheck_walker_1801_1831 import keys, fuzzy, near  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
HOP = os.path.join(ROOT, 'data', 'elections', 'hop')
ELECTORATE_LABELS = ('number of voters', 'number of registered freeholders', 'number qualified to vote',
                     'estimated number qualified to vote')
SMALL = {'of', 'and', 'the', 'de', 'la', 'le', 'van', 'von', 'vice'}


def cite(volume, url):
    v = VOLUMES[volume]
    return {'title': v['title'], 'editor': v.get('editor'), 'year': v.get('year'),
            'publisher': 'History of Parliament Trust', 'url': url}


def titled(name):
    """HoP prints the members returned in capitals: 'HON. JOHN BRUCE RICHARD O'NEILL'."""
    # "THOMAS WALLACE II": HoP's numeral tells namesakes apart; it is not part of the name.
    name = re.sub(r'\s+(I|II|III|IV)$', '', name.strip())
    if name != name.upper():
        return name
    words = []
    for i, w in enumerate(name.lower().split()):
        if i and w in SMALL:
            words.append(w)
            continue
        w = '-'.join(p[:1].upper() + p[1:] for p in w.split('-'))
        w = re.sub(r"^(O['’])([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)   # O'Neill
        w = re.sub(r'^(Mc)([a-z])', lambda m: m.group(1) + m.group(2).upper(), w)        # McNaghten
        words.append(w)
    return ' '.join(words)


STYLES = {'sir', 'hon', 'lord', 'lady', 'rt', 'right', 'col', 'lt', 'capt', 'maj', 'major', 'gen', 'adm', 'rev', 'dr',
          'viscount', 'visct', 'earl', 'baron', 'marquess', 'bt', 'the', 'knight', 'of', 'mr', 'jun', 'sen'}


def forenames(name):
    """The given names in a name, lower case: 'Hon. John Bruce Richard O'Neill' -> {john, bruce,
    richard}. A peer's family name in brackets is what counts: 'Viscount Castlereagh (Frederick
    William Robert Stewart)' -> {frederick, william, robert}."""
    # "(afterwards Viscount Dunlo)", "(formerly Foster)": a later or earlier name, not the
    # family name in a peer's brackets.
    name = re.sub(r'\s*[(]\s*(?:afterwards|formerly|later)\b[^)]*[)]', '', name, flags=re.I)
    inner = re.findall(r'[(]([^)]*)[)]', name)
    words = re.findall(r"[a-z]+", (inner[-1] if inner else re.sub(r',.*$', '', name)).lower())
    words = [w for w in words if w not in STYLES and w not in NUMERALS and len(w) > 1]
    return set(words[:-1])


NUMERALS = {'ii', 'iii', 'iv'}


def surname_words(heading):
    """Every word of a member's surname, and of any he took later: 'MASSY (afterwards MASSY
    DAWSON), James Hewitt' -> {massy, dawson}; 'PARNELL HAYES, William' -> {parnell, hayes}."""
    head = heading.split(',')[0].lower().replace('afterwards', ' ')
    return {w for w in re.findall(r'[a-z]+', re.sub(r"['’]", '', head)) if len(w) > 2}


def same_man(heading, display, name):
    """Whether a name in the results can be this HoP member: it carries a word of his surname
    (HoP's 'LATOUCHE' is the results' 'La Touche', so adjacent words are also read joined),
    and its forenames, if it gives any, do not contradict his. A surname word is not a
    forename: 'Christopher Hely-Hutchinson' is not John Hely-Hutchinson."""
    words = re.findall(r'[a-z]+', re.sub(r"['’]", '', name.lower()))
    tokens = set(words) | {a + b for a, b in zip(words, words[1:])}
    sur = surname_words(heading)
    # Spelt two ways is still the one name: Kiely and Keily, Smyth and Smythe.
    if not (sur & tokens or keys(heading.split(',')[0]) & keys(name)
            or any(near(a, b) for a in sur for b in tokens)):
        return False
    return forenames_agree(sur, forenames(name), forenames(display))


def forenames_agree(sur, given, his):
    # Words of the surname, whole or within a joined one ('la' of 'latouche'), are not forenames.
    drop = lambda names: {w for w in names if not any(w == t or w in t for t in sur)}
    given, his = drop(given), drop(his)
    # Gerrard and Gerard, Quinton and Quintin, Mathew and Matthew agree.
    return not given or not his or any(near(g, h) for g in given for h in his)


def same_man_forenames(m, name):
    return forenames_agree(surname_words(m['heading']), forenames(name), forenames(m['display']))


def parse_electorate(value):
    """'about 800 in 1812' / '3,261 in 1829; 1,078 in 1830' -> {year: (number, approximate)}."""
    out = {}
    for m in re.finditer(r'(about|c\.|approximately)?\s*([\d,]+)\s+in\s+(\d{4})', value):
        out[int(m.group(3))] = (int(m.group(2).replace(',', '')), bool(m.group(1)))
    return out


VOLUMES = {}


def page_key(path):
    """A member page's path as a lookup key. HoP's own links percent-encode the apostrophe
    in O'Grady (o%E2%80%99grady); Wikidata stores it as the character."""
    return urllib.parse.unquote(path).lower()


def member_identity(path, wd=None):
    """Who a member page describes. His Wikidata item where it has one: the two volumes can
    head one man differently ('FOSTER', later 'SKEFFINGTON') or disagree on an uncertain
    birth year (Ruthven ?1772, 1773). Else '/volume/1820-1832/member/prittie-hon-francis-
    1779-1853' -> 'prittie:1779-1853'."""
    qid = ((wd or {}).get(page_key(path)) or {}).get('wikidata')
    if qid:
        return qid
    slug = path.rstrip('/').rsplit('/', 1)[-1].lower().replace('%e2%80%99', '')
    slug = re.sub(r'[^a-z0-9-]', '', slug)                         # o’grady, as Wikidata spells it
    slug = re.sub(r'\d{4,}(?=[a-z])', '', slug)                  # "o8217brien"
    years = re.search(r'(\d{4})-(\d{4})$', slug) or re.search(r'(\d{4})$', slug)
    return f"{slug.split('-')[0]}:{years.group(0)}" if years else slug


def seat_end(seat):
    """The day a member's tenure ended; where HoP prints it loosely ('c. July 1805') and the
    extract has none, its year, never an open end."""
    if seat.get('to'):
        return seat['to']
    tail = (seat.get('dates') or '').split('-')[-1] if '-' in (seat.get('dates') or '') else ''
    year = re.findall(r'\d{4}', tail)
    return year[-1] if year else '9999'


class Overlay:
    def __init__(self):
        cons = json.load(open(os.path.join(HOP, 'hop-irish-constituencies.json'), encoding='utf-8'))
        VOLUMES.update(cons['volumes'])
        xc.HOP_BOROUGHS = {xc.hop_seat(c['slug'])[1] for c in cons['constituencies'] if xc.hop_seat(c['slug'])[0] == 'borough'}
        self.cross = json.load(open(os.path.join(HOP, 'hop-crosscheck-1801-1832.json'), encoding='utf-8'))['records']
        self.by_walker = {(r['walker']['page'], r['walker']['constituency'], r['walker']['date']): r
                          for r in self.cross if r.get('walker')}
        # Electorates by seat and year, from each volume's background block.
        self.electorate = collections.defaultdict(dict)
        for c in cons['constituencies']:
            seat = xc.hop_seat(c['slug'])
            for b in c['background']:
                if b['label'].lower() in ELECTORATE_LABELS:
                    for year, (n, approx) in parse_electorate(b['value']).items():
                        self.electorate[seat].setdefault(year, (n, approx, b['label'], c['volume'], c['url']))
        # Members by seat, for naming the people Walker and the lists leave unidentified.
        members = json.load(open(os.path.join(HOP, 'hop-irish-members.json'), encoding='utf-8'))['members']
        wd = {page_key('/volume/' + r['hop']): r for r in
              json.load(open(os.path.join(HOP, 'wikidata-hop-ids.json'), encoding='utf-8'))['records']}
        # One man has a page in each volume he sat in, not always under the same slug; his
        # surname and years are who he is. Every page of his answers with one key, so all his
        # candidacies become one person: his Wikipedia article if any page of his has one,
        # else his latest page.
        ident = collections.defaultdict(list)
        for m in members:
            ident[member_identity(m['path'], wd)].append(m)
        # Which HoP member each Wikipedia article is, by Wikidata, across every volume.
        self.article_identity = collections.defaultdict(set)
        for r in wd.values():
            if r.get('enwiki'):
                self.article_identity[r['enwiki']].add(member_identity('/volume/' + r['hop'], wd))
        canon = {}
        for i, pages in ident.items():
            enwiki = next((wd[page_key(p['path'])]['enwiki'] for p in pages if (wd.get(page_key(p['path'])) or {}).get('enwiki')), None)
            canon[i] = (enwiki, max(pages, key=lambda p: p['volume'])['path'])
        self.seat_members = collections.defaultdict(list)
        self.by_path = {}
        for m in members:
            i = member_identity(m['path'], wd)
            enwiki, path = canon[i]
            display = self._member_name(m['heading'])
            self.by_path[m['path'].lower()] = {'path': path, 'url': m['url'], 'volume': m['volume'],
                                               'enwiki': enwiki, 'display': display, 'identity': i}
            surname_keys = keys(re.sub(r'\(.*$', '', m['heading']).split(',')[0])
            for s in m['seats']:
                seat = xc.hop_seat(s['constituency'].rstrip('/').rsplit('/', 1)[-1])
                self.seat_members[seat].append({'from': (s['from'] or '0000'), 'to': seat_end(s), 'path': path,
                                                'url': m['url'], 'volume': m['volume'], 'keys': surname_keys,
                                                'heading': m['heading'], 'identity': i,
                                                'enwiki': enwiki, 'display': display})

    @staticmethod
    def _member_name(heading):
        """'O'NEILL, Hon. John Bruce Richard (1780-1855), of ...' -> 'Hon. John Bruce Richard O'Neill'."""
        head = re.sub(r'\s*\(afterwards[^)]*\)', '', heading)    # "BUTLER (afterwards BUTLER CLARKE ...), Hon. Charles"
        head = re.sub(r'\s*\(.*$', '', head)
        surname, _, rest = head.partition(',')
        rest = re.sub(r',?\s*\d+(st|nd|rd|th) (Bt|Bar|Baron|Visct|Earl)\.?.*$', '', rest, flags=re.I).strip()   # HoP prints '1st bt.'
        return re.sub(r'\s+', ' ', f'{rest} {titled(surname.strip())}').strip()

    def pair(self, walker_record):
        return self.by_walker.get((walker_record['page'], walker_record['constituency'], walker_record['date']))

    def seat(self, walker_name):
        return xc.walker_seat(walker_name)

    def electorate_for(self, seat, year):
        return self.electorate.get(seat, {}).get(int(year))

    def member_for(self, seat, date, name):
        """The one HoP member who held this seat on this date and bears this name."""
        k = keys(name)
        day = (date or '')[:10]
        # Forenames, where the name gives any, must not contradict the member's: Walker's
        # "John Stewart" at Down in 1826 shares a surname, not a man, with Viscount
        # Castlereagh (Frederick William Robert Stewart), who held the seat.
        hits = [m for m in self.seat_members.get(seat, [])
                if m['from'][:len(day)] <= day <= (m['to'] + '-12-31')[:10]
                and (same_man(m['heading'], m['display'], name) or k & m['keys'] or fuzzy(k, m['keys']))
                and same_man_forenames(m, name)]
        if len({m['identity'] for m in hits}) > 1:
            # In the year one man's tenure ends and another's begins ("1806 - 1812", "1812 -
            # 1818"), the contest that year returned the one who begins: the 2nd Earl of
            # Ranfurly at Tyrone in October 1812, not his father.
            hits = [m for m in hits if m['from'][:4] == day[:4]] or hits
        return hits[0] if len({m['identity'] for m in hits}) == 1 else None

    def contradicts(self, article, member):
        """Whether a Wikipedia article a list links is, by Wikidata, a different HoP member from
        the one who held the seat that day: the list's "Thomas Knox, 3rd Earl of Ranfurly" (born
        1816) for the Dungannon member of 1818-30, who was the 2nd Earl."""
        others = self.article_identity.get(article)
        return bool(others and member and member['identity'] not in others)

    def member_by_path(self, path):
        """A member the 1820-1832 tables link, losers included."""
        return self.by_path.get((path or '').lower())

    @staticmethod
    def person_key(member):
        return 'wikipedia:' + member['enwiki'] if member.get('enwiki') else 'hop:' + member['path'].replace('/volume/', '')

    def additions(self):
        """HoP contests Walker's scan lacks: not the 1801 'returns' (members carried over from
        the Irish Parliament at the Union, not elections), and not a petition's outcome, which
        belongs to the contest it ended."""
        for r in self.cross:
            if r['status'] != 'not in Walker':
                continue
            if len(r['date']) == 4 and r['date'] == '1801':
                continue
            if all(c.get('note') and 'on petition' in c['note'] for c in r['hop']):
                continue
            yield r
