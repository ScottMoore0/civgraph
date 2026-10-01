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
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'walker'))
import crosscheck_hop_1801_1832 as xc  # noqa: E402
from crosscheck_walker_1801_1831 import keys, fuzzy  # noqa: E402

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


def parse_electorate(value):
    """'about 800 in 1812' / '3,261 in 1829; 1,078 in 1830' -> {year: (number, approximate)}."""
    out = {}
    for m in re.finditer(r'(about|c\.|approximately)?\s*([\d,]+)\s+in\s+(\d{4})', value):
        out[int(m.group(3))] = (int(m.group(2).replace(',', '')), bool(m.group(1)))
    return out


VOLUMES = {}


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
        wd = {('/volume/' + r['hop']).lower(): r for r in
              json.load(open(os.path.join(HOP, 'wikidata-hop-ids.json'), encoding='utf-8'))['records']}
        self.seat_members = collections.defaultdict(list)
        self.by_path = {}
        for m in members:
            self.by_path[m['path'].lower()] = {'path': m['path'], 'url': m['url'], 'volume': m['volume'],
                                               'enwiki': (wd.get(m['path'].lower()) or {}).get('enwiki'),
                                               'display': self._member_name(m['heading'])}
            enwiki = (wd.get(m['path'].lower()) or {}).get('enwiki')
            surname_keys = keys(re.sub(r'\(.*$', '', m['heading']).split(',')[0])
            display = self._member_name(m['heading'])
            for s in m['seats']:
                seat = xc.hop_seat(s['constituency'].rstrip('/').rsplit('/', 1)[-1])
                self.seat_members[seat].append({'from': (s['from'] or '0000'), 'to': (s['to'] or '9999'), 'path': m['path'],
                                                'url': m['url'], 'volume': m['volume'], 'keys': surname_keys,
                                                'enwiki': enwiki, 'display': display})

    @staticmethod
    def _member_name(heading):
        """'O'NEILL, Hon. John Bruce Richard (1780-1855), of ...' -> 'Hon. John Bruce Richard O'Neill'."""
        head = re.sub(r'\s*\(.*$', '', heading)
        surname, _, rest = head.partition(',')
        rest = re.sub(r',?\s*\d+(st|nd|rd|th) (Bt|Baron|Visct|Earl)\.?.*$', '', rest).strip()
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
        hits = [m for m in self.seat_members.get(seat, [])
                if m['from'][:len(day)] <= day <= (m['to'] + '-12-31')[:10]
                and (k & m['keys'] or fuzzy(k, m['keys']))]
        paths = {m['path'] for m in hits}
        return hits[0] if len(paths) == 1 else None

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
