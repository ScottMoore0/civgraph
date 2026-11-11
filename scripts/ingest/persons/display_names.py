"""The name a person's page shows, where the names they stood under disagree.

A person's display name is otherwise the one they already go by, while any of their candidacies
still uses it (build_person_registry_v2.py), so a spelling corrected on one candidacy would leave
the page under the old one: Ken O'Flynn stood as Kenneth O'Flynn from 2009 to 2020 on file, and
the Department's 2024 results book and his Oireachtas member page both name him Ken O'Flynn.
data/elections/persons/display-names.csv names the person (personId), the name the page shows,
and the source for it. The other names stay on the person as aliases, and each contest keeps the
name its own source printed.
"""
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
FILE = os.path.join(REPO, 'data', 'elections', 'persons', 'display-names.csv')


def load(path=FILE):
    """{personId (int): displayName}"""
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8', newline='') as fh:
        return {int(r['personId']): r['displayName'].strip() for r in csv.DictReader(fh)
                if (r.get('personId') or '').strip().isdigit() and (r.get('displayName') or '').strip()}


def apply(entity, chosen):
    """Give `entity` the display name recorded for its personId, keeping it as an alias."""
    name = chosen.get(int(entity['personId']))
    if not name:
        return entity
    entity['displayName'] = name
    aliases = list(entity.get('aliases') or [])
    if name not in aliases:
        entity['aliases'] = sorted(set(aliases) | {name}, key=lambda s: (-len(s), s))
    return entity
