"""The highest candidate person id ever issued, so a new person never takes a number that once
meant somebody else.

A registry rebuild hands every group it cannot carry forward a fresh id, and merge_person_ids.py
then folds some of those groups into an existing person. The folded-away ids ("drop" ids, also
called temporary ids) never become person pages, but they are not private: they are written to
person_id_merges.csv and the survivor's mergedFrom, loaded into D1's person_merges, and served
as person_aliases, so /browse/persons/<drop id> answers with a 301 to the survivor.

New ids used to start at the highest live id plus one, which is where the last build's drop ids
had started too. On 11 Nov 2026 that gave 149598, until then a live redirect to Roy Beggs (68301),
to a different man, and six more of the twelve new people took numbers that redirected to
Forum list entries. So the next id now starts above every id ever issued: every live id, every id
in a survivor's mergedFrom, every keep and drop id in the two merge logs, and the high-water mark
the last build recorded (registry key `idHighWater`), which keeps the mark when a merge log row
is later dropped. Registered non-candidates (900001+) are a block of their own and do not count.

The cost is that the drop ids of each rebuild sit above those of the last one, so the high-water
mark rises by the number of merged-away groups at every rebuild. An old drop id then stops
answering (404) instead of answering for someone else.
"""
import csv
import os

# Candidate ids are below the registered non-candidate block (build_person_registry_v2.py).
NONCANDIDATE_FIRST = 900001


def _candidate_id(value):
    """The int of a candidate person id, or None for anything else (blank, a key, a registered id)."""
    s = str(value if value is not None else '').strip()
    if not s.isdigit():
        return None
    n = int(s)
    return n if 0 < n < NONCANDIDATE_FIRST else None


def issued_high_water(registry_doc, merge_logs=()):
    """The highest candidate person id ever issued, as far as the previous registry and the merge
    logs record it (0 when there is nothing).

    registry_doc: the parsed previous person_registry.json, or None.
    merge_logs: paths of CSV merge logs with `keep` and `drop` columns; missing files are skipped.
    """
    hi = 0
    if registry_doc:
        hi = max(hi, _candidate_id(registry_doc.get('idHighWater')) or 0)
        for e in registry_doc.get('entities') or []:
            if e.get('keyedBy') == 'registered':
                continue
            for v in [e.get('personId')] + list(e.get('mergedFrom') or []):
                n = _candidate_id(v)
                if n:
                    hi = max(hi, n)
    for path in merge_logs:
        if not path or not os.path.exists(path):
            continue
        with open(path, encoding='utf-8', newline='') as fh:
            for row in csv.DictReader(fh):
                for col in ('keep', 'drop'):
                    n = _candidate_id(row.get(col))
                    if n:
                        hi = max(hi, n)
    return hi
