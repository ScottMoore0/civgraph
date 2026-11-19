"""Two men the papers tell apart stay two, whatever their names share.

A split made with declared identity keys (label-blanked-identity-keys.csv) gives each man his own
key, but the registry's name join and the merge pass can join the pieces again on the name alone:
the Derry shipwright John Sharkey of 1946-49 went straight back into the John Sharkey who stood for
Belfast North in 1970 (born about 1935, "Mr. Jack Sharkey (35)"), because the one is the only
council group of that name and the other the only Westminster one. Nothing in the name says they
are two; the papers do.

data/elections/persons/person_id_kept_apart.csv records such pairs, each side by the stable keys
the registry records for it (candidacy ids, declared identity keys, source person ids), with the
evidence. A group or person holding one of a row's keys_a is never joined to one holding one of its
keys_b: not on the name (build_person_registry_v2.py), not by a prior join, not by any class of
merge_person_ids.py. It only ever keeps apart; it joins nothing. It is the counterpart of
person_id_confirmed_merges.csv, which joins one man the papers show to be one.
"""
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
KEPT_APART = os.path.join(REPO, 'data', 'elections', 'persons', 'person_id_kept_apart.csv')


def split_keys(cell):
    """The keys of one side of a row: ' ; '-separated, as in person_id_confirmed_merges.csv."""
    return frozenset(k.strip() for k in str(cell or '').split(' ; ') if k.strip())


def load(path=KEPT_APART):
    """[(keys_a, keys_b)] for each row of the file; [] when there is none."""
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding='utf-8', newline='') as fh:
        for row in csv.DictReader(fh):
            a, b = split_keys(row.get('keys_a')), split_keys(row.get('keys_b'))
            if a and b:
                out.append((a, b))
    return out


def apart(rules, ours, theirs):
    """True when a rule says the side holding `ours` and the side holding `theirs` are two people:
    one holds a key of the rule's keys_a and the other a key of its keys_b."""
    ours, theirs = set(ours or ()), set(theirs or ())
    return any((ours & a and theirs & b) or (ours & b and theirs & a) for a, b in rules)


def group_keys(rows):
    """The keys a registry group holds: its rows' candidacy ids (declared keys included) and
    source person ids."""
    return {r['id'] for r in rows if r.get('id')} | {r['src'] for r in rows if r.get('src')}
