"""A person's known life, for the person-id steps: the veto that keeps a candidacy (or a vote)
off a person who was dead, or under 18, at the time.

check:person-lifespans (scripts/check/rules/person-activity-after-death.mjs) fails on any
candidacy or vote dated after the death, or before the 18th birthday, of the person it is
stamped with, by the dates the person page shows. Those dates come, in this order, from:

  1. History of Parliament's biographies (data/elections/hop), reached through a candidacy's
     sourcePersonId ("hop:<page>", "wikipedia:<article>") or a person:<id> link
     (link_hop_members.py). A page reached through its own id or Wikidata outranks one matched
     by seat and surname; pages for two different members on one record give no dates.
  2. Wikidata, through the record's official person ids (official-person-crosswalk.json
     `people`), where exactly one Wikidata item holds them.
  3. A published reference work (reference-dates.json, by Civgraph person id), where Wikidata
     gives no date or the entry is marked preferOver for that field.

This module reads the same files the same way (build-browse-indexes.mjs buildPersons: loadHopPages,
officialProfiles, lifeDate), so the veto and the check agree on who was alive when.

PRECISION IS THE TOLERANCE. A date known only to the year rules out the next year, not the
rest of its own: died "1940" rules out 1941 but not December 1940; born "1950" is 18 for all of
1968. A month works the same way. This is the only tolerance, and it is the check's own rule
(isAfter / isBefore18 there, is_after / is_before_18 here; tests/unit/person-lifespans.test.mjs
holds the two together), so nothing the veto lets through can fail the check on precision.
"""
import collections
import json
import os
import re
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PERSONS = os.path.join(REPO, 'data', 'elections', 'persons')
HOP = os.path.join(REPO, 'data', 'elections', 'hop')
_DATE = re.compile(r'^\d{4}(-\d{2}){0,2}$')


def is_after(date, limit):
    """True when an ISO date (or a shorter one) falls after `limit`, a date given at year,
    month or day precision: "1940" rules out 1941 but not 1940-12-01."""
    d, lim = str(date or ''), str(limit or '')
    if not d or not _DATE.match(lim):
        return False
    return d[:len(lim)] > lim


def is_before_18(date, born):
    """True when an ISO date falls before the 18th birthday of someone born on `born`, at its
    own precision: born "1950" is 18 in 1968, so only dates before 1968 count."""
    d, b = str(date or ''), str(born or '')
    if not d or not _DATE.match(b):
        return False
    eighteen = '%d%s' % (int(b[:4]) + 18, b[4:])
    return d[:len(eighteen)] < eighteen


def outside(date, life):
    """'after-death', 'before-18' or None for a date against a life {born, died}."""
    if not life:
        return None
    if is_after(date, life.get('died')):
        return 'after-death'
    if is_before_18(date, life.get('born')):
        return 'before-18'
    return None


def _hop_page_key(p):
    return unquote(str(p or '')).lower()


def _member_identity(path):
    slug = re.sub(r'^.*/member/', '', path)
    slug = re.sub(r'\d{4,}(?=[a-z])', '', slug)
    m = re.search(r'(\d{4})-(\d{4})$', slug)
    return '%s:%s-%s' % (slug.split('-')[0], m.group(1), m.group(2)) if m else slug


def _preciser(a, b):
    return b if not a else a if not b else (b if len(b) > len(a) else a)


def _read(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


class Lifespans:
    def __init__(self):
        cw = _read(os.path.join(PERSONS, 'official-person-crosswalk.json'), {})
        self.crosswalk = cw.get('ids') or {}
        self.wikidata = cw.get('people') or {}
        ref = _read(os.path.join(PERSONS, 'reference-dates.json'), {})
        works = ref.get('sources') or {}
        self.reference = {str(pid): r for pid, r in (ref.get('people') or {}).items() if works.get(r.get('source'))}
        self.hop = self._load_hop()
        # Findings reviewed and accepted (the check's allowlist): the veto accepts them too.
        exc = _read(os.path.join(PERSONS, 'lifespan-exceptions.json'), {}).get('exceptions') or []
        self.exceptions = {'%s|%s|%s' % (e.get('personId'), e.get('kind'), e.get('date') or '') for e in exc}

    def excepted(self, person_id, kind, date):
        """True when lifespan-exceptions.json accepts this finding (for this date, or for every
        date of its kind), as check:person-lifespans does."""
        return person_id is not None and kind is not None and (
            '%s|%s|%s' % (person_id, kind, date or '') in self.exceptions or '%s|%s|' % (person_id, kind) in self.exceptions)

    def outside(self, date, life, person_id=None):
        """outside(), less the findings the allowlist accepts for person_id."""
        why = outside(date, life)
        return None if why and self.excepted(person_id, why, date) else why

    @staticmethod
    def _load_hop():
        members = (_read(os.path.join(HOP, 'hop-irish-members.json'), {}).get('members') or [])
        if not members:
            return {}
        records = _read(os.path.join(HOP, 'wikidata-hop-ids.json'), {}).get('records') or []
        enwiki = {_hop_page_key('/volume/' + r['hop']): r['enwiki'] for r in records if r.get('enwiki')}
        item = {_hop_page_key('/volume/' + r['hop']): r['wikidata'] for r in records if r.get('wikidata')}
        by_key = collections.defaultdict(dict)   # key -> {url: [page, strong]}

        def add(key, page, strong):
            if not key:
                return
            seen = by_key[key].get(page['url'])
            if seen is None:
                by_key[key][page['url']] = [page, strong]
            elif strong:
                seen[1] = True

        page_of = {}
        for m in members:
            k = _hop_page_key(m['path'])
            page = {'url': m.get('url'), 'born': m.get('born'), 'died': m.get('died'),
                    'member': item.get(k) or _member_identity(m['path'])}
            page_of[k] = page
            add('hop:' + re.sub(r'^/volume/', '', m['path']), page, True)
            if enwiki.get(k):
                add('wikipedia:' + enwiki[k], page, True)
        for link in _read(os.path.join(HOP, 'hop-person-links.json'), {}).get('links') or []:
            page = page_of.get(_hop_page_key(link.get('hop')))
            if page and link.get('personKey'):
                add(link['personKey'], page, link.get('method') == 'wikidata')
        return by_key

    def qids(self, official_ids):
        out = set()
        for o in official_ids or ():
            if o.startswith('wikidata:'):
                out.add(o[9:])
            elif o in self.crosswalk:
                out.add(self.crosswalk[o])
        return out

    def life(self, source_keys=(), official_ids=(), person_id=None):
        """{born, died, source} as the person page would show them, or None.

        source_keys: the record's sourcePersonIds (hop:, wikipedia:, ei:, ...); person:<id> is
        added for person_id. official_ids: its official person ids (wikidata: ones included)."""
        keys = set(source_keys or ())
        if person_id is not None:
            keys.add('person:%s' % person_id)
        reached = {}
        for k in keys:
            for url, (page, strong) in self.hop.get(k, {}).items():
                if url not in reached:
                    reached[url] = [page, strong]
                elif strong:
                    reached[url][1] = True
        strong = [p for p, s in reached.values() if s]
        pages = strong or [p for p, _ in reached.values()]
        if len({p['member'] for p in pages}) > 1:
            pages = []
        if pages:
            born = died = None
            for p in pages:
                born, died = _preciser(born, p.get('born')), _preciser(died, p.get('died'))
            return {'born': born, 'died': died, 'source': 'History of Parliament'} if born or died else None
        q = self.qids(official_ids)
        wd = self.wikidata.get(next(iter(q))) or {} if len(q) == 1 else {}
        ref = self.reference.get(str(person_id)) if person_id is not None else None
        out = {}
        for field in ('born', 'died'):
            r = (ref or {}).get(field)
            preferred = bool(((ref or {}).get('preferOver') or {}).get(field))
            if r and (preferred or not wd.get(field)):
                out[field] = r
            elif wd.get(field):
                out[field] = wd[field]
        if not out:
            return None
        out['source'] = 'Wikidata' if wd else 'reference work'
        return out


_cache = None


def load():
    global _cache
    if _cache is None:
        _cache = Lifespans()
    return _cache
