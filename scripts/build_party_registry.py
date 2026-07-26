#!/usr/bin/env python3
"""Bootstrap data/elections/parties/party_registry.json — stable IDs for every party
and independent label in the election data.

WHY. Nothing in this dataset identifies a party. A candidacy carries only a free-text
`party` string; the browse registry has an `id`, but it is the name slugified
(`id == "party:" + slug` in 773/773 entries, `slug == slugify(canonicalName)` in
761/773), so it cannot distinguish two organisations with the same or similar name and
it fragments one organisation across spelling variants. This file gives every entity a
CURATED id that is independent of its display name, plus an explicit alias list.

RESOLUTION. An alias is a string, optionally narrowed by `bodies` and by a date window.
That is what separates same-named organisations:

    'Nationalist Party' on NI bodies      -> nationalist-party-ni
    'Nationalist Party' in the Dail       -> irish-parliamentary-party
    'Green' on NI bodies                  -> green-ni
    'Green' in the Republic               -> green-ie
    'Green / Ecology' before 1990-02-12   -> ecology-party-ni
    'Green / Ecology' from  1990-02-12    -> green-ni

TYPES. Not everything with a `party` string is a party, and conflating them is how
"Independent" ends up looking like the sixth largest party in Northern Ireland:

    party              an organisation
    independent-label  a ballot description, not an organisation
    banner             an agreed non-party label (Unity, Anti H-Block)
    joint-ticket       two parties standing jointly (UCUNF, Solidarity-PBP)
    referendum-option  Yes / No

PROVENANCE. Entities carrying real research — lifespans, disambiguations — are
`provisional: false` and cite a source. The long tail is emitted with
`provisional: true` and a single alias, so coverage is complete and every unreviewed
entity is visibly unreviewed. Curated entries are never overwritten by the tail.

This script BOOTSTRAPS the registry. After the first run party_registry.json is the
hand-editable source of truth; re-running would discard hand edits, so it refuses to
overwrite unless --force is given.
"""
import os, re, sys, json, glob, argparse, collections, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
OUT = os.path.join(REPO, 'data', 'elections', 'parties')
LIFE = os.path.join(OUT, 'party_lifespans.json')
REG = os.path.join(OUT, 'party_registry.json')

NI_BODIES = ['house-of-commons-of-the-united-kingdom', 'northern-ireland-assembly',
             'local-government', 'european-parliament', 'parliament-of-northern-ireland',
             'northern-ireland-constitutional-convention',
             'northern-ireland-forum-for-political-dialogue']
ROI_BODIES = ['dail-eireann', 'ireland-european', 'ireland-president', 'ireland-referendum']

SRC = 'curated 2026-07-26; lifespans supplied by repository owner'

# ---------------------------------------------------------------- curated entities
# Only entities that need a human decision: a name collision, an alias merge, a type
# that is not 'party', or a lifespan. Everything else is generated as provisional.
CURATED = [
    # --- name collisions: same or near-identical names, different organisations ---
    dict(id='nationalist-party-ni', type='party', name='Nationalist Party (Northern Ireland)',
         shortName='Nationalist Party',
         aliases=[{'string': 'Nationalist Party', 'bodies': NI_BODIES},
                  'Nationalist Party (Northern Ireland)'],
         notes="Shares the bare string 'Nationalist Party' with the Irish Parliamentary "
               "Party; separated by body."),
    dict(id='irish-parliamentary-party', type='party', name='Irish Parliamentary Party',
         shortName='IPP',
         aliases=[{'string': 'Nationalist Party', 'bodies': ROI_BODIES}],
         notes="The 1918-22 dail-eireann candidacies under the bare string 'Nationalist "
               "Party'. A different organisation from the NI Nationalist Party."),
    dict(id='pup', type='party', name='Progressive Unionist Party', shortName='PUP',
         aliases=['PUP', 'Progressive Unionist'],
         notes="ONLY the string 'PUP'. The 1938 Stormont string 'Progressive Unionist' "
               "is a DIFFERENT party and is entity progressive-unionist-1938; the alias "
               "here is date-scoped to keep them apart.",
         alias_overrides={'Progressive Unionist': {'from': '1979-01-01'}}),
    dict(id='progressive-unionist-1938', type='party',
         name='Progressive Unionist Party (1938)', shortName='Prog. Unionist 1938',
         aliases=[{'string': 'Progressive Unionist', 'until': '1979-01-01'}],
         notes="Ten candidacies at the 1938 Stormont election. Not the PUP founded 1979 "
               "and not connected to it; the name is a coincidence."),
    dict(id='green-ie', type='party', name='Green Party / Comhaontas Glas',
         shortName='Green (IE)',
         aliases=[{'string': 'Green', 'bodies': ROI_BODIES}],
         notes="The 264 'Green' candidacies in dail-eireann and ireland-european, 1984 "
               "onward. A separate organisation from green-ni, which claims the same "
               "string on NI bodies; no dates supplied for this one."),
    dict(id='protestant-unionist', type='party', name='Protestant Unionist Party',
         shortName='Protestant Unionist',
         aliases=['Protestant Unionist', 'Protestant Unionist Party'],
         notes="Paisley's pre-DUP party, 1969-70. Two string variants, one organisation."),
    dict(id='sinn-fein-pro-treaty', type='party', name='Pro-Treaty Sinn Féin',
         shortName='SF (Pro-Treaty)', aliases=['Pro-Treaty Sinn Féin']),
    dict(id='sinn-fein-anti-treaty', type='party', name='Anti-Treaty Sinn Féin',
         shortName='SF (Anti-Treaty)', aliases=['Anti-Treaty Sinn Féin']),
    dict(id='republican-sinn-fein', type='party', name='Republican Sinn Féin',
         shortName='RSF', aliases=['Republican Sinn Féin'],
         notes='Split from Sinn Féin in 1986. A separate organisation.'),
    dict(id='sinn-fein-workers', type='party', name="Sinn Féin – The Workers' Party",
         shortName="SF Workers'", aliases=["Sinn Féin Workers'"]),
    dict(id='workers-party', type='party', name="Workers' Party", shortName="Workers' Party",
         aliases=["Workers' Party", 'Workers Party'],
         notes="Two strings differing only by the apostrophe, overlapping in years and "
               "both used on NI bodies: treated as one organisation. If they are in fact "
               "distinct, split this entry."),
    dict(id='irish-unionist-alliance', type='party', name='Irish Unionist Alliance',
         shortName='Unionist (1918)', aliases=['Unionist'],
         notes="33 candidacies, all at the 1918 general election."),
    # --- not organisations ---
    dict(id='ind', type='independent-label', name='Independent', shortName='Independent',
         aliases=['Independent'],
         notes='A ballot description, not an organisation. Given an id so it can be '
               'counted and excluded deliberately rather than by accident.'),
    dict(id='ind-unionist', type='independent-label', name='Independent Unionist',
         shortName='Ind. Unionist', aliases=['Independent Unionist']),
    dict(id='ind-nationalist', type='independent-label', name='Independent Nationalist',
         shortName='Ind. Nationalist', aliases=['Independent Nationalist']),
    dict(id='ind-other', type='independent-label', name='Independent Other',
         shortName='Ind. Other', aliases=['Independent Other']),
    dict(id='ind-labour', type='independent-label', name='Independent Labour',
         shortName='Ind. Labour', aliases=['Independent Labour']),
    dict(id='ind-republican', type='independent-label', name='Independent Republican',
         shortName='Ind. Republican', aliases=['Independent Republican']),
    dict(id='ind-named', type='independent-label', name='Independent (named candidate)',
         shortName='Ind. (named)',
         aliases=['Independent (Alan Chambers)', 'Independent (Oliver McMuIlan)',
                  "Independent (Thomas O'Brien)", 'Independent (Arthur Templeton)'],
         notes="Four 1996 Forum labels naming the candidate. Grouped because the pattern "
               "is one thing, not four organisations; split if per-candidate ids are "
               "wanted. Note 'McMuIlan' has a capital I for the l, as in the source."),
    dict(id='unity', type='banner', name='Unity', shortName='Unity',
         aliases=['Unity', 'Unity (Northern Ireland)'],
         notes='Agreed anti-partitionist candidacies, 1966-77. A banner, not a party: no '
               'organisation, manifesto or whip.'),
    dict(id='anti-h-block', type='banner', name='Anti H-Block', shortName='Anti H-Block',
         aliases=['Anti H-Block'],
         notes='Sands and Carron, 1981. A banner, not a party.'),
    dict(id='ucunf', type='joint-ticket', name='Ulster Conservatives and Unionists – New Force',
         shortName='UCUNF', aliases=['UCUNF'],
         notes='UUP and Conservative joint ticket, 2010 only. A joint registration, not '
               'either component party.'),
    dict(id='solidarity-pbp', type='joint-ticket', name='Solidarity–People Before Profit',
         shortName='Solidarity-PBP', aliases=['Solidarity-PBP'],
         notes='Joint ticket in the Republic, 2019-24. Not the same registration as PBP.'),
    dict(id='ref-yes', type='referendum-option', name='Yes', shortName='Yes', aliases=['Yes']),
    dict(id='ref-no', type='referendum-option', name='No', shortName='No', aliases=['No']),
]


def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-') or 'x'


def scan_strings():
    used = collections.Counter()
    bodies = collections.defaultdict(collections.Counter)
    years = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        b = d.get('bodySlug') or ''
        y = (d.get('date') or '')[:4]
        for r in d.get('results') or []:
            for c in (r.get('candidates') or []):
                p = (c.get('party') or '').strip()
                if not p:
                    continue
                used[p] += 1
                bodies[p][b] += 1
                if y.isdigit():
                    years[p].append(int(y))
    return used, bodies, years


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true',
                    help='overwrite an existing registry (DISCARDS hand edits)')
    args = ap.parse_args()
    if os.path.exists(REG) and not args.force:
        sys.exit(f"{REG} already exists. It is the hand-edited source of truth; "
                 f"re-run with --force only if you mean to discard edits.")

    used, bodies, years = scan_strings()
    life = json.load(open(LIFE, encoding='utf-8'))['parties']

    entities = []
    claimed = set()

    def add_alias_strings(e):
        for a in e['aliases']:
            claimed.add(a if isinstance(a, str) else a['string'])

    # 1. the researched lifespans, carried over verbatim (ids preserved)
    for p in life:
        al = []
        for a in (p.get('partyStrings') or []):
            al.append(a if isinstance(a, str) else dict(a))
        for s in (p.get('corruptedStrings') or []):
            al.append({'string': s, 'corrupted': True})
        e = {'id': p['id'], 'type': 'party', 'name': p['name'],
             'shortName': p['shortName'], 'aliases': al,
             'founded': p.get('founded'), 'foundedPrecision': p.get('foundedPrecision'),
             'dissolved': p.get('dissolved'), 'status': p.get('status'),
             'source': p.get('source'), 'confidence': p.get('confidence'),
             'provisional': False}
        for k in ('predecessor', 'successor', 'splitFrom', 'notes'):
            if p.get(k):
                e[k] = p[k]
        entities.append(e)
        add_alias_strings(e)

    # 2. curated disambiguations and non-party entities
    byid = {e['id'] for e in entities}
    for c in CURATED:
        if c['id'] in byid:
            continue
        al = []
        for a in c['aliases']:
            if isinstance(a, str) and c.get('alias_overrides', {}).get(a):
                al.append({'string': a, **c['alias_overrides'][a]})
            else:
                al.append(a if isinstance(a, str) else dict(a))
        e = {'id': c['id'], 'type': c['type'], 'name': c['name'],
             'shortName': c['shortName'], 'aliases': al,
             'status': 'unknown', 'source': SRC, 'confidence': 'high',
             'provisional': False}
        if c.get('notes'):
            e['notes'] = c['notes']
        entities.append(e)
        add_alias_strings(e)

    # 3. provisional entities for everything still unclaimed, one per string
    ids = {e['id'] for e in entities}
    tail = 0
    for s, n in used.most_common():
        if s in claimed:
            continue
        base = slugify(s)
        i, k = base, 2
        while i in ids:
            i, k = f'{base}-{k}', k + 1
        ids.add(i)
        t = ('independent-label' if s.lower().startswith('independent') else 'party')
        entities.append({
            'id': i, 'type': t, 'name': s, 'shortName': s[:24], 'aliases': [s],
            'status': 'unknown', 'source': None, 'confidence': 'unreviewed',
            'provisional': True,
            'observed': {'candidacies': n,
                         'years': [min(years[s]), max(years[s])] if years[s] else None,
                         'bodies': dict(bodies[s].most_common())}})
        tail += 1

    doc = {
        'schemaVersion': 1,
        'description': 'Stable identifiers for every party and independent label in the '
                       'election data. The id is curated and independent of the display '
                       'name, so two organisations with the same name are distinguishable '
                       'and one organisation with several name spellings is not split.',
        'idPolicy': 'Ids are permanent. Renaming an organisation changes `name`, never '
                    '`id`. Where two entities would otherwise collide, the id carries a '
                    'disambiguator (green-ni / green-ie, pup / progressive-unionist-1938).',
        'types': {
            'party': 'an organisation',
            'independent-label': 'a ballot description, not an organisation',
            'banner': 'an agreed non-party label (Unity, Anti H-Block)',
            'joint-ticket': 'two parties standing jointly (UCUNF, Solidarity-PBP)',
            'referendum-option': 'Yes / No',
        },
        'aliasResolution': 'An alias is a string, optionally narrowed by `bodies` and by '
                           'a half-open date window [from, until). The first entity whose '
                           'alias matches string + body + date wins; a string may be '
                           'shared by several entities when their scopes are disjoint.',
        'provisional': 'true means auto-generated from a single observed string and not '
                       'reviewed: the id is a slug of the name, there is no source, and '
                       'no lifespan. Curating one means confirming the alias set, setting '
                       'a type, and adding dates and a source.',
        'entities': entities,
    }
    with open(REG, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write('\n')

    curated = sum(1 for e in entities if not e['provisional'])
    print(f"wrote {REG}")
    print(f"  {len(entities)} entities: {curated} curated, {tail} provisional")
    bytype = collections.Counter(e['type'] for e in entities)
    for t, n in bytype.most_common():
        print(f"    {n:5}  {t}")
    print(f"  {len(used)} distinct party strings in the data; "
          f"{len(claimed)} claimed by curated entities")


if __name__ == '__main__':
    main()
