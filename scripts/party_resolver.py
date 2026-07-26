#!/usr/bin/env python3
"""Shared resolver: (party string, body, date) -> a party_registry.json entity id.

Two passes, because a party string is not reliable evidence of what a candidate stood
as at the time. Six candidacies in this dataset carry a label outside the life of the
organisation named — three applied retrospectively (Samuel as 'Green' in 1987 and 1989,
McCartney as 'UKUP' in 1995) and three outliving the party (Craig, Dunlop and Overend as
Vanguard in 1982, four and a half years after it dissolved).

    pass 1  alias matches on string + body + alias window, AND the candidacy falls
            inside the entity's own [founded, dissolved) lifespan  ->  ('ok', id)
    pass 2  exactly one entity claims the string for that body, but the date is outside
            its lifespan                                            ->  ('outside', id)
    else    ('none', None) or ('ambiguous', [ids])

Pass 2 attributes the candidacy rather than dropping it, because the votes really do
belong to that organisation; the caller decides whether to count it and can report the
exposure. Dropping to the raw string instead would be worse than useless -- it splits
one party in two while silently merging another whose raw string happens to equal its
short name.
"""
import os, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
REG = os.path.join(REPO, 'data', 'elections', 'parties', 'party_registry.json')


def load(path=REG):
    doc = json.load(open(path, encoding='utf-8'))
    by_id, index = {}, collections.defaultdict(list)
    for e in doc['entities']:
        by_id[e['id']] = e
        for a in e['aliases']:
            if isinstance(a, str):
                index[a].append((e, None, None, None))
            else:
                index[a['string']].append((
                    e, set(a['bodies']) if a.get('bodies') else None,
                    a.get('from'), a.get('until')))
    return doc, by_id, index


def _alias_ok(bodies, fr, un, body, date):
    if bodies is not None and body not in bodies:
        return False
    if fr and date < fr:
        return False
    if un and date >= un:
        return False
    return True


def _in_life(e, date):
    if e.get('founded') and date < e['founded']:
        return False
    if e.get('dissolved') and date >= e['dissolved']:   # half-open
        return False
    return True


def resolve(index, s, body, date):
    cands = [e for e, b, fr, un in index.get(s, [])
             if _alias_ok(b, fr, un, body, date)]
    if not cands:
        return ('none', None)
    live = [e for e in cands if _in_life(e, date)]
    if len(live) == 1:
        return ('ok', live[0]['id'])
    if len(live) > 1:
        return ('ambiguous', [e['id'] for e in live])
    if len(cands) == 1:
        return ('outside', cands[0]['id'])
    return ('ambiguous', [e['id'] for e in cands])
