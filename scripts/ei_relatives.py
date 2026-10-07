"""When ElectionsIreland's own pages say that two of its candidate ids are two people.

Every ElectionsIreland candidate has a page, candidate.cfm?ID=<n>. Where two of its ids
are one family the page says so: Thomas McEllistrim 1 names Thomas McEllistrim 2 as his
son, and Brian Lenihan 1 Snr names Brian Joseph Lenihan 2 Jnr. That is the source stating
that the two ids are two people -- nobody is his own father -- and it is exactly what a
same-name rule cannot see. Father and son share a name, a party and often a seat, and
SAME-SEAT-SEQUENCE in merge_person_ids.py joined McEllistrim, Connaughton, Miley and Welby
across the generations; a 1992 Dublin West row with no id of its own was folded into
Brian Lenihan Jnr, four years before Jnr first stood, when it was his father's.

Two things on those pages count:
  * the Relatives list, with the relation it gives, read from either page;
  * a generational suffix in ElectionsIreland's own name for each id, one Snr and one Jnr
    ("Thomas (Tom) Welby 1 Snr" / "Thomas (Tom) Welby 2 Jnr").

The "Other candidates with same name" list does NOT count. It is a listing, not a finding:
ElectionsIreland filed the Waterford councillor Joe Kelly under two ids (2004-2014 as Joe
Kelly 2, 2024 as Joe Kelly 3) and lists each as the other's namesake, but he was elected
for Tramore-Waterford City West in 2014, 2019 and 2024. It is recorded for review only.

The pages are read by scripts/harvest_ei_candidate_ids.py --relatives into
data/elections/persons/ei-candidate-relatives.json.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
RELATIVES = os.path.join(REPO, 'data', 'elections', 'persons', 'ei-candidate-relatives.json')

GENERATION = re.compile(r'\b(snr|sr|senior|jnr|jr|junior)\b', re.I)


def load():
    """{'ei:<n>': {'name', 'relatives': {'ei:<m>': relation}, 'namesakes': [...], 'url'}}"""
    if not os.path.exists(RELATIVES):
        return {}
    with open(RELATIVES, encoding='utf-8') as fh:
        return json.load(fh).get('persons') or {}


def generation(name):
    found = GENERATION.search(name or '')
    if not found:
        return None
    return 'senior' if found.group(1).lower() in ('snr', 'sr', 'senior') else 'junior'


def distinct(people, ours, theirs):
    """Why ElectionsIreland's pages say no id in `ours` is the person of any id in
    `theirs`, or None. Ids are 'ei:<n>'; anything else is ignored."""
    for x in sorted(i for i in ours if i.startswith('ei:')):
        for y in sorted(i for i in theirs if i.startswith('ei:')):
            if x == y:
                continue
            px, py = people.get(x) or {}, people.get(y) or {}
            if y in (px.get('relatives') or {}):
                return f"ElectionsIreland {x} ({px.get('name')}) names {y} as {px['relatives'][y] or 'a relative'}"
            if x in (py.get('relatives') or {}):
                return f"ElectionsIreland {y} ({py.get('name')}) names {x} as {py['relatives'][x] or 'a relative'}"
            gx, gy = generation(px.get('name')), generation(py.get('name'))
            if gx and gy and gx != gy:
                return f"ElectionsIreland files {x} as {px.get('name')} and {y} as {py.get('name')}"
    return None
