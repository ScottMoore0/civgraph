"""The councils registry (data/registries/councils.json) as the Python ingest scripts read it.

The scrapers and the Elliott & Flackes office tables used to carry their own council lists; they
read these views instead, so a council is added or renamed in one place. The registry's schema
and its JavaScript views are packages/registries (schemas/councils.schema.json, src/councils.mjs).
Every view keeps the registry's order, but office_councils, which is in stem order. Load it as scripts/records/paths.py is loaded:

    _CR = __import__('runpy').run_path(os.path.join(REPO, 'scripts', 'ingest', 'councils_registry.py'))
    COUNCILS = _CR['council_websites']()
"""
import json
import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
REGISTRY = os.path.join(REPO_ROOT, 'data', 'registries', 'councils.json')

# The council type a Wikipedia title form ends with ("Armagh City and District Council").
_TITLE_TYPE = re.compile(r'\s+(?:City and District|Borough|District|City)\s+Council$')


def councils(path=REGISTRY):
    """Every council in the registry, in its order."""
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)['councils']


def council_websites(path=REGISTRY):
    """(key, [hosts]) for each council whose old website the 26-council scraper searches."""
    return [(c['websites']['key'], list(c['websites']['hosts'])) for c in councils(path) if c.get('websites')]


def wikipedia_councils(generation, path=REGISTRY):
    """{'key', 'variants'} for each council of a generation ('1973' or '2014') with Wikipedia
    election articles: the key the scrapers file its pages under, and the council names the
    article titles use, the usual one first."""
    return [{'key': c['wikipedia']['key'], 'variants': list(c['wikipedia']['titleVariants'])}
            for c in councils(path) if c.get('generation') == generation and c.get('wikipedia')]


def wikipedia_display(generation, path=REGISTRY):
    """key -> the council's name, for each council of a generation with Wikipedia articles."""
    return {c['wikipedia']['key']: c['name'] for c in councils(path) if c.get('generation') == generation and c.get('wikipedia')}


def wikipedia_title_name(variant):
    """The place a Wikipedia title form names, without its council type:
    'Dungannon and South Tyrone Borough Council' -> 'Dungannon and South Tyrone'."""
    return _TITLE_TYPE.sub('', variant)


def office_councils(path=REGISTRY):
    """stem -> (official name, [aliases]) for each council whose offices the Elliott & Flackes
    directory names: the councils with an officialName and the forms the book uses for it
    (officialNameAliases). The stem is the first form as a slug ('newry and mourne' ->
    'newry-and-mourne'); the council's offices institution is 'council-<stem>'. In stem order."""
    out = {}
    for c in councils(path):
        aliases = list(c.get('officialNameAliases') or [])
        if not c.get('officialName') or not aliases:
            continue
        out[re.sub(r'[^a-z0-9]+', '-', aliases[0].lower()).strip('-')] = (c['officialName'], aliases)
    return dict(sorted(out.items()))
