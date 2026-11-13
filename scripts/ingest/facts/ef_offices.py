"""The office catalogue the Elliott & Flackes (1999) import resolves office strings against.

Each office here becomes a row of data/offices/offices.json. `match` turns the extraction's
free-text office string (plus the fact's party and date) into an office id, or None.

Offices are things a person HOLDS: a ministry, a mayoralty, a party leadership, a council
seat filled by co-option. Honours (peerages, knighthoods, Privy Counsellor), memberships of a
body (senator, MEP) and posts in non-party organisations (the Orange Order) are not offices
here; `match` reports them as not modelled so the import lists them as unmapped.
"""
import os
import re
import unicodedata

NI, IE, UK, EU = 'northern-ireland', 'ireland', 'united-kingdom', 'europe'

INSTITUTIONS = {
    'ni-government': {'name': 'Government of Northern Ireland', 'kind': 'government', 'jurisdiction': NI},
    'ni-parliament': {'name': 'Parliament of Northern Ireland', 'kind': 'legislature', 'jurisdiction': NI, 'bodySlug': 'parliament-of-northern-ireland'},
    'ni-executive-1974': {'name': 'Northern Ireland Executive (1974)', 'kind': 'government', 'jurisdiction': NI},
    'ni-assembly-1973': {'name': 'Northern Ireland Assembly (1973-74)', 'kind': 'legislature', 'jurisdiction': NI, 'bodySlug': 'northern-ireland-assembly'},
    'ni-assembly-1982': {'name': 'Northern Ireland Assembly (1982-86)', 'kind': 'legislature', 'jurisdiction': NI, 'bodySlug': 'northern-ireland-assembly'},
    'ni-assembly-1998': {'name': 'Northern Ireland Assembly (1998-)', 'kind': 'legislature', 'jurisdiction': NI, 'bodySlug': 'northern-ireland-assembly'},
    'ni-forum': {'name': 'Northern Ireland Forum for Political Dialogue', 'kind': 'legislature', 'jurisdiction': NI, 'bodySlug': 'northern-ireland-forum-for-political-dialogue'},
    'northern-ireland-office': {'name': 'Northern Ireland Office', 'kind': 'government', 'jurisdiction': UK},
    'uk-government': {'name': 'Government of the United Kingdom', 'kind': 'government', 'jurisdiction': UK},
    'uk-house-of-commons': {'name': 'House of Commons of the United Kingdom', 'kind': 'legislature', 'jurisdiction': UK, 'bodySlug': 'house-of-commons-of-the-united-kingdom'},
    'ni-civil-service': {'name': 'Northern Ireland Civil Service', 'kind': 'civil-service', 'jurisdiction': NI},
    'ie-government': {'name': 'Government of Ireland', 'kind': 'government', 'jurisdiction': IE},
    'ie-presidency': {'name': 'President of Ireland', 'kind': 'head-of-state', 'jurisdiction': IE},
    'police-authority-ni': {'name': 'Police Authority for Northern Ireland', 'kind': 'public-body', 'jurisdiction': NI},
    'european-commission': {'name': 'Commission of the European Communities', 'kind': 'government', 'jurisdiction': EU},
}

# Councils whose offices the book names: office-id stem (institution council-<stem>) ->
# (official name, the forms the book uses). The Northern Ireland councils come from the
# councils registry (data/registries/councils.json: officialName and officialNameAliases, read
# by scripts/ingest/councils_registry.py). The registry does not give the Republic's two city
# councils those fields yet, so they are named here until it does.
_CR = __import__('runpy').run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'councils_registry.py'))
COUNCILS = {
    **_CR['office_councils'](),
    'dublin': ('Dublin City Council', ['dublin']),
    'cork': ('Cork City Council', ['cork']),
}
COUNCIL_ALIAS = {}
for stem, (name, aliases) in COUNCILS.items():
    for a in aliases:
        COUNCIL_ALIAS[a] = stem
    INSTITUTIONS[f'council-{stem}'] = {'name': name, 'kind': 'council', 'jurisdiction': IE if stem in ('dublin', 'cork') else NI}

LOCAL_BODIES = ['local-government']

# The parties whose internal offices the book names: id -> (display name).
PARTY_INSTITUTIONS = {
    'uup': 'Ulster Unionist Party', 'dup': 'Democratic Unionist Party', 'alliance': 'Alliance Party of Northern Ireland',
    'sdlp': 'Social Democratic and Labour Party', 'sinn-fein': 'Sinn Féin', 'workers-party': "Workers' Party",
    'fianna-fail': 'Fianna Fáil', 'fine-gael': 'Fine Gael', 'irish-labour': 'Labour Party (Ireland)',
    'progressive-democrats': 'Progressive Democrats', 'democratic-left': 'Democratic Left',
    'unionist-party-of-northern-ireland': 'Unionist Party of Northern Ireland', 'uuup': 'United Ulster Unionist Party',
    'vanguard': 'Vanguard Unionist Progressive Party', 'irsp': 'Irish Republican Socialist Party',
    'irish-independence-party': 'Irish Independence Party', 'republican-labour': 'Republican Labour Party',
    'nationalist-party-ni': 'Nationalist Party', 'ulster-democratic-party': 'Ulster Democratic Party',
    'conservative': 'Conservative Party (Northern Ireland)', 'republican-sinn-fein': 'Republican Sinn Féin',
    'pup': 'Progressive Unionist Party', 'united-unionist-coalition': 'United Unionist Assembly Party',
    'ulster-independence-movement': 'Ulster Independence Movement', 'ukup': 'United Kingdom Unionist Party',
}
for pid, name in PARTY_INSTITUTIONS.items():
    INSTITUTIONS[f'party-{pid}'] = {'name': name, 'kind': 'party', 'jurisdiction': IE if pid in ('fianna-fail', 'fine-gael', 'irish-labour', 'progressive-democrats', 'democratic-left') else NI, 'partyId': pid}
INSTITUTIONS['ulster-unionist-council'] = {'name': 'Ulster Unionist Council', 'kind': 'party', 'jurisdiction': NI, 'partyId': 'uup'}

OFFICES = {}


def office(oid, name, institution, kind, bodies=(), noncandidates=False, party=None, names=None, note=None):
    OFFICES[oid] = {
        'id': oid, 'name': name, 'institution': institution, 'kind': kind,
        'jurisdiction': INSTITUTIONS[institution]['jurisdiction'],
        'partyId': party or INSTITUTIONS[institution].get('partyId'),
        'bodies': list(bodies), 'noncandidates': noncandidates,
        'nameHistory': names or [], 'note': note,
    }
    return oid


STORMONT = ['parliament-of-northern-ireland']
ASSEMBLY = ['northern-ireland-assembly']
WESTMINSTER = ['house-of-commons-of-the-united-kingdom']
DAIL = ['dail-eireann']

# --- Government of Northern Ireland (to March 1972)
office('ni-prime-minister', 'Prime Minister of Northern Ireland', 'ni-government', 'head-of-government', STORMONT)
for stem, label in [('home-affairs', 'Home Affairs'), ('finance', 'Finance'), ('commerce', 'Commerce'),
                    ('education', 'Education'), ('agriculture', 'Agriculture'),
                    ('health-and-social-services', 'Health and Social Services'),
                    ('health-and-local-government', 'Health and Local Government'),
                    ('development', 'Development'), ('community-relations', 'Community Relations'),
                    ('labour', 'Labour and National Insurance')]:
    office(f'ni-minister-of-{stem}', f'Minister of {label} (Northern Ireland)', 'ni-government', 'minister', STORMONT, noncandidates=True,
           names=[{'name': 'Minister of Labour (Northern Ireland)'}] if stem == 'labour' else None)
office('ni-minister-of-state-home-affairs', 'Minister of State, Ministry of Home Affairs (Northern Ireland)', 'ni-government', 'minister-of-state', STORMONT, True)
office('ni-minister-of-state-finance', 'Minister of State, Ministry of Finance (Northern Ireland)', 'ni-government', 'minister-of-state', STORMONT, True)
office('ni-minister-of-state-pm', "Minister of State, Prime Minister's Department (Northern Ireland)", 'ni-government', 'minister-of-state', STORMONT, True)
for stem, label in [('home-affairs', 'Home Affairs'), ('education', 'Education'), ('agriculture', 'Agriculture')]:
    office(f'ni-parliamentary-secretary-{stem}', f'Parliamentary Secretary, Ministry of {label} (Northern Ireland)', 'ni-government', 'junior-minister', STORMONT, True)
office('ni-chief-whip', 'Government Chief Whip (Northern Ireland)', 'ni-government', 'chief-whip', STORMONT, True)
office('ni-leader-of-the-house', 'Leader of the House of Commons (Northern Ireland)', 'ni-parliament', 'leader-of-house', STORMONT, True)
office('ni-leader-of-the-senate', 'Leader of the Senate (Northern Ireland)', 'ni-parliament', 'leader-of-house', STORMONT, True)
office('ni-speaker', 'Speaker of the House of Commons of Northern Ireland', 'ni-parliament', 'speaker', STORMONT, True)
office('ni-attorney-general', 'Attorney General for Northern Ireland', 'ni-government', 'law-officer', STORMONT, True)

# --- Northern Ireland Executive, January-May 1974
office('ni-executive-chief-executive', 'Chief Executive, Northern Ireland Executive (1974)', 'ni-executive-1974', 'head-of-government', ASSEMBLY)
office('ni-executive-deputy-chief-executive', 'Deputy Chief Executive, Northern Ireland Executive (1974)', 'ni-executive-1974', 'deputy-head-of-government', ASSEMBLY)
for stem, label in [('finance', 'Finance'), ('commerce', 'Commerce'), ('agriculture', 'Agriculture'), ('education', 'Education'),
                    ('environment', 'the Environment'), ('health-and-social-services', 'Health and Social Services'),
                    ('housing-planning-and-local-government', 'Housing, Planning and Local Government'),
                    ('manpower-services', 'Manpower Services'), ('community-relations', 'Community Relations'),
                    ('information', 'Information')]:
    office(f'ni-executive-{stem}', f'Head of the Department of {label}, Northern Ireland Executive (1974)', 'ni-executive-1974', 'minister', ASSEMBLY,
           names=[{'name': f'Minister of {label} (Northern Ireland Executive, 1974)'}])
office('ni-executive-law-reform', 'Head of the Office of Law Reform, Northern Ireland Executive (1974)', 'ni-executive-1974', 'minister', ASSEMBLY)
office('ni-executive-planning', 'Head of the Department of Executive Planning and Co-ordination, Northern Ireland Executive (1974)', 'ni-executive-1974', 'minister', ASSEMBLY)
office('ni-executive-chief-whip', 'Chief Whip, Northern Ireland Executive (1974)', 'ni-executive-1974', 'chief-whip', ASSEMBLY)

# --- Assemblies and the Forum
office('ni-assembly-1973-speaker', 'Speaker of the Northern Ireland Assembly (1973-74)', 'ni-assembly-1973', 'speaker', ASSEMBLY)
office('ni-assembly-1982-speaker', 'Speaker of the Northern Ireland Assembly (1982-86)', 'ni-assembly-1982', 'speaker', ASSEMBLY)
office('ni-assembly-1982-deputy-speaker', 'Deputy Speaker of the Northern Ireland Assembly (1982-86)', 'ni-assembly-1982', 'deputy-speaker', ASSEMBLY)
office('ni-assembly-presiding-officer', 'Presiding Officer of the Northern Ireland Assembly', 'ni-assembly-1998', 'presiding-officer', ASSEMBLY)
office('ni-first-minister', 'First Minister of Northern Ireland', 'ni-assembly-1998', 'head-of-government', ASSEMBLY,
       names=[{'name': 'First Minister (designate)', 'note': 'the title before devolution took effect'}])
office('ni-deputy-first-minister', 'Deputy First Minister of Northern Ireland', 'ni-assembly-1998', 'deputy-head-of-government', ASSEMBLY,
       names=[{'name': 'Deputy First Minister (designate)', 'note': 'the title before devolution took effect'}])
office('ni-forum-chair', 'Chairman of the Northern Ireland Forum for Political Dialogue', 'ni-forum', 'chair', ['northern-ireland-forum-for-political-dialogue'], True)

# --- Direct rule: the Northern Ireland Office and Whitehall
office('secretary-of-state-ni', 'Secretary of State for Northern Ireland', 'northern-ireland-office', 'secretary-of-state', WESTMINSTER, True)
office('nio-minister-of-state', 'Minister of State, Northern Ireland Office', 'northern-ireland-office', 'minister-of-state', WESTMINSTER, True)
office('nio-minister', 'Northern Ireland Office minister', 'northern-ireland-office', 'minister', WESTMINSTER, True,
       note='a Northern Ireland Office ministerial post where the book gives no portfolio')
for stem, label in [('health-and-social-services', 'Health and Social Services'), ('agriculture', 'Agriculture'),
                    ('education', 'Education'), ('environment', 'the Environment'), ('finance', 'Finance'),
                    ('economic-development', 'Economic Development'), ('commerce', 'Commerce'),
                    ('manpower-services', 'Manpower Services'), ('community-relations', 'Community Relations'),
                    ('development', 'Development'), ('housing-planning-and-local-government', 'Housing, Planning and Local Government'),
                    ('home-affairs', 'Home Affairs')]:
    names = [{'name': 'Northern Ireland Office minister responsible for Finance and Personnel', 'note': 'the department was Finance and Personnel from 1982'}] if stem == 'finance' else None
    office(f'nio-minister-{stem}', f'Northern Ireland Office minister responsible for {label}', 'northern-ireland-office', 'minister', WESTMINSTER, True, names=names)
office('uk-home-secretary', 'Home Secretary', 'uk-government', 'secretary-of-state', WESTMINSTER, True,
       note='held Cabinet responsibility for Northern Ireland until direct rule in 1972')
office('uk-ni-affairs-committee-chair', 'Chairman of the Northern Ireland Affairs Select Committee', 'uk-house-of-commons', 'chair', WESTMINSTER, True)
office('head-ni-civil-service', 'Head of the Northern Ireland Civil Service', 'ni-civil-service', 'civil-service-head', (), True)
office('police-authority-ni-chair', 'Chairman of the Police Authority for Northern Ireland', 'police-authority-ni', 'chair', (), True)
office('eec-commissioner', 'Member of the Commission of the European Communities', 'european-commission', 'commissioner', (), True)

# --- Ireland
office('taoiseach', 'Taoiseach', 'ie-government', 'head-of-government', DAIL)
office('tanaiste', 'Tánaiste', 'ie-government', 'deputy-head-of-government', DAIL)
for stem, label in [('foreign-affairs', 'Foreign Affairs'), ('finance', 'Finance'), ('justice', 'Justice'),
                    ('defence', 'Defence'), ('agriculture', 'Agriculture'), ('education', 'Education'),
                    ('industry-and-commerce', 'Industry and Commerce'), ('health', 'Health'), ('labour', 'Labour'),
                    ('social-welfare', 'Social Welfare'), ('posts-and-telegraphs', 'Posts and Telegraphs'),
                    ('enterprise-and-employment', 'Enterprise and Employment')]:
    office(f'ie-minister-for-{stem}', f'Minister for {label} (Ireland)', 'ie-government', 'minister', DAIL, True)
office('president-of-ireland', 'President of Ireland', 'ie-presidency', 'head-of-state', ['ireland-president'], True)

# --- Councils
for stem, (name, _) in COUNCILS.items():
    inst = f'council-{stem}'
    bodies = ['ireland-local', 'dail-eireann'] if stem in ('dublin', 'cork') else LOCAL_BODIES
    if stem == 'belfast':
        office('lord-mayor-belfast', 'Lord Mayor of Belfast', inst, 'mayor', bodies)
        office('deputy-lord-mayor-belfast', 'Deputy Lord Mayor of Belfast', inst, 'deputy-mayor', bodies)
        office('high-sheriff-belfast', 'High Sheriff of Belfast', inst, 'high-sheriff', bodies)
    elif stem in ('dublin', 'cork'):
        office(f'lord-mayor-{stem}', f'Lord Mayor of {stem.title()}', inst, 'mayor', bodies)
    else:
        title = 'Derry' if stem == 'derry' else name.replace(' Borough Council', '').replace(' District Council', '').replace(' City Council', '').replace(' Urban District Council', '')
        office(f'mayor-{stem}', f'Mayor of {title}', inst, 'mayor', bodies,
               names=[{'name': 'Mayor of Londonderry', 'note': 'the title the book also uses'}] if stem == 'derry' else None)
        office(f'deputy-mayor-{stem}', f'Deputy Mayor of {title}', inst, 'deputy-mayor', bodies)
        office(f'chair-{stem}', f'Chairman of {name}', inst, 'council-chair', bodies)
    office(f'councillor-{stem}', f'Member of {name}', inst, 'councillor', bodies,
           note='used for seats filled by co-option, which are tenures, not elections')


def party_office(pid, kind, label, inst=None):
    oid = f'{pid}-{kind}'
    office(oid, f'{label}, {PARTY_INSTITUTIONS[pid]}', inst or f'party-{pid}', f'party-{kind}', (), True, party=pid)
    return oid


PARTY_KINDS = {
    'leader': 'Leader', 'deputy-leader': 'Deputy Leader', 'president': 'President', 'vice-president': 'Vice-President',
    'chair': 'Chairman', 'vice-chair': 'Vice-Chairman', 'general-secretary': 'General Secretary', 'chief-whip': 'Chief Whip',
    'secretary': 'Party Secretary',
}


def party_office_id(pid, kind):
    oid = f'{pid}-{kind}'
    if oid not in OFFICES:
        party_office(pid, kind, PARTY_KINDS[kind])
    return oid


# UUP bodies and groups the book names
office('uuc-president', 'President of the Ulster Unionist Council', 'ulster-unionist-council', 'party-president', (), True)
office('uuc-vice-president', 'Vice-President of the Ulster Unionist Council', 'ulster-unionist-council', 'party-vice-president', (), True)
office('uuc-standing-committee-chair', 'Chairman of the Ulster Unionist Council standing committee', 'ulster-unionist-council', 'party-chair', (), True)
office('uup-executive-chair', 'Chairman of the Ulster Unionist Party executive', 'party-uup', 'party-chair', (), True)
office('uup-westminster-leader', 'Leader of the Ulster Unionist MPs at Westminster', 'party-uup', 'party-group-leader', WESTMINSTER, True)
office('uup-general-secretary', 'General Secretary, Ulster Unionist Party', 'party-uup', 'party-general-secretary', (), True)
office('alliance-parliamentary-leader', 'Leader of the Alliance Parliamentary Party (Stormont)', 'party-alliance', 'party-group-leader', STORMONT, True)
office('workers-party-northern-chair', "Northern Chairman, Workers' Party", 'party-workers-party', 'party-chair', (), True)
office('vanguard-joint-leader', 'Joint Leader, Vanguard Unionist Progressive Party', 'party-vanguard', 'party-leader', (), True)


def norm(s):
    s = unicodedata.normalize('NFKD', str(s or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c)).replace('�', '')
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


NOT_OFFICES = [
    (r'\blife peer\b|\bpeerage\b|\bduke of\b|\bknighthood\b|\bprivy counsell?or\b|\blord lieutenant\b|\bhm lieutenant\b', 'honour or peerage, not an office'),
    (r'\bsenator\b|\bmember of (the )?senate\b|\bmember of seanad\b|\bmep\b|\bmember european parliament\b|\bmp stormont\b|\bborough councillor\b|\bcouncil member\b',
     'membership of a body, not an office'),
    (r'\bmember\b.*\b(committee of the regions|inter parliamentary|council of europe)\b', 'membership of a body, not an office'),
    (r'\bgrand master\b|\borange order\b|\broyal black\b|\bcivil rights association\b', 'office in a non-party organisation, not modelled'),
    (r'\bspokes(man|person|woman)\b', 'party spokesperson role, not modelled'),
    (r'\bboundaries commissioner\b', 'one-off public appointment, not modelled'),
    (r'\bleader of fianna fail in seanad\b|\bfine gael leader in the seanad\b|\bleader of the opposition in the senate\b|\bsdlp group\b|\buuuc parliamentary group\b',
     'parliamentary or council group role, not modelled'),
    (r'\bsix county executive\b|\bregional chairman\b', 'regional party post, not modelled'),
    (r'\bpatron\b|\bjoint honorary secretary\b|\bsecretary and chief executive\b|\bdirector of publicity\b|\bfounder\b(?!.*leader)', 'party post not modelled'),
]

NIO_PORTFOLIOS = [
    ('health and social services', 'health-and-social-services'), ('agriculture', 'agriculture'),
    ('education', 'education'), ('environment', 'environment'), ('economic development', 'economic-development'),
    ('finance', 'finance'), ('commerce', 'commerce'), ('manpower', 'manpower-services'),
    ('community relations', 'community-relations'), ('housing planning', 'housing-planning-and-local-government'),
    ('development', 'development'), ('home affairs', 'home-affairs'),
]
NI_MINISTRIES = [
    ('health and social services', 'health-and-social-services'), ('health and local government', 'health-and-local-government'),
    ('home affairs', 'home-affairs'), ('finance', 'finance'), ('commerce', 'commerce'), ('education', 'education'),
    ('agriculture', 'agriculture'), ('development', 'development'), ('community relations', 'community-relations'),
    ('labour', 'labour'),
]
EXEC_DEPTS = [
    ('health and social services', 'health-and-social-services'), ('housing planning', 'housing-planning-and-local-government'),
    ('finance', 'finance'), ('commerce', 'commerce'), ('agriculture', 'agriculture'), ('education', 'education'),
    ('environment', 'environment'), ('manpower', 'manpower-services'), ('community relations', 'community-relations'),
    ('information', 'information'), ('law reform', 'law-reform'), ('planning and co ordination', 'planning'),
]
IE_MINISTRIES = [
    ('foreign affairs', 'foreign-affairs'), ('finance', 'finance'), ('justice', 'justice'), ('defence', 'defence'),
    ('agriculture', 'agriculture'), ('education', 'education'), ('industry and commerce', 'industry-and-commerce'),
    ('health', 'health'), ('social welfare', 'social-welfare'), ('posts and telegraphs', 'posts-and-telegraphs'),
    ('enterprise', 'enterprise-and-employment'), ('labour', 'labour'),
]


def _council(text):
    t = text
    for alias in sorted(COUNCIL_ALIAS, key=len, reverse=True):
        if re.search(rf'\b{alias}\b', t):
            return COUNCIL_ALIAS[alias]
    return None


def match(raw, party_id=None, year=None, section=None):
    """(office_id, None) or (None, reason)."""
    t = norm(raw)
    if not t:
        return None, 'no office named'
    if ';' in re.sub(r'\([^)]*\)', '', str(raw)):
        return None, 'several offices in one string; needs manual reading'
    for pattern, reason in NOT_OFFICES:
        if re.search(pattern, t):
            return None, reason
    # Direct rule
    if 'secretary of state for northern ireland' in t:
        return 'secretary-of-state-ni', None
    if t.startswith('home secretary'):
        return 'uk-home-secretary', None
    if 'nio minister' in t or 'northern ireland office' in t or re.search(r'\bnio\b', t):
        if 'parliamentary under secretary then minister of state' in t:
            return None, 'two posts in one string; needs manual reading'
        for key, stem in NIO_PORTFOLIOS:
            if key in t:
                return f'nio-minister-{stem}', None
        if 'minister of state' in t:
            return 'nio-minister-of-state', None
        if re.search(r'\bminister\b', t):
            return 'nio-minister', None
    if 'northern ireland affairs select committee' in t:
        return 'uk-ni-affairs-committee-chair', None
    if 'head of the northern ireland civil service' in t:
        return 'head-ni-civil-service', None
    if 'police authority' in t:
        return 'police-authority-ni-chair', None
    if re.search(r'\b(eec|ec) commissioner\b', t):
        return 'eec-commissioner', None
    if 'minister of state' in t and 'employment' in t:
        return None, 'Whitehall post outside Northern Ireland, not modelled'
    # NI Executive 1974
    if 'executive' in t and ('1974' in t or 'ni executive' in t or 'northern ireland executive' in t) or (year and 1973 <= year <= 1974 and re.search(r'^head\b', t)):
        if 'deputy chief executive' in t:
            return 'ni-executive-deputy-chief-executive', None
        if 'chief executive' in t:
            return 'ni-executive-chief-executive', None
        if 'chief whip' in t:
            return 'ni-executive-chief-whip', None
        if 'office of information' in t:
            return None, 'civil service post in the 1974 Executive, not a ministerial office'
        for key, stem in EXEC_DEPTS:
            if key in t:
                return f'ni-executive-{stem}', None
        if 'legal' in t:
            return 'ni-executive-law-reform', None
    if t.startswith('deputy chief executive'):
        return 'ni-executive-deputy-chief-executive', None
    if t.startswith('chief executive'):
        return 'ni-executive-chief-executive', None
    if 'head of department of executive planning' in t:
        return 'ni-executive-planning', None
    # Assemblies
    if 'deputy first minister' in t:
        return 'ni-deputy-first-minister', None
    if 'first minister' in t:
        return 'ni-first-minister', None
    if 'presiding officer' in t:
        return 'ni-assembly-presiding-officer', None
    if 'speaker' in t and ('assembly' in t):
        dep = 'deputy' in t
        if year and 1982 <= year <= 1986:
            return ('ni-assembly-1982-deputy-speaker' if dep else 'ni-assembly-1982-speaker'), None
        if year and 1973 <= year <= 1974 and not dep:
            return 'ni-assembly-1973-speaker', None
        return None, 'Assembly speakership with no date to tell which Assembly'
    if 'speaker' in t and 'house of commons of northern ireland' in t:
        return 'ni-speaker', None
    if 'leader of the assembly' in t:
        return None, 'Assembly post not modelled'
    if re.search(r'\bchairman\b.*\b(ni|northern ireland) forum\b', t):
        return 'ni-forum-chair', None
    # Government of Northern Ireland
    if 'prime minister of northern ireland' in t:
        return 'ni-prime-minister', None
    if 'attorney general' in t:
        return 'ni-attorney-general', None
    if 'leader of the senate' in t:
        return 'ni-leader-of-the-senate', None
    if 'leader of the house of commons' in t:
        return 'ni-leader-of-the-house', None
    if re.search(r'\b(government )?chief whip\b', t) and ('government' in t or ' ni' in f' {t}' or 'northern ireland' in t) and not party_id:
        return 'ni-chief-whip', None
    if re.search(r'^government whip', t):
        return None, 'junior whip post not modelled'
    if 'minister of state' in t and ('prime minister' in t):
        return 'ni-minister-of-state-pm', None
    if 'minister of state' in t and 'home affairs' in t:
        return 'ni-minister-of-state-home-affairs', None
    if 'minister of state' in t and 'finance' in t:
        return 'ni-minister-of-state-finance', None
    if t.startswith('parliamentary secretary'):
        for key, stem in [('home affairs', 'home-affairs'), ('education', 'education'), ('agriculture', 'agriculture')]:
            if key in t:
                return f'ni-parliamentary-secretary-{stem}', None
        return None, 'parliamentary secretaryship with no ministry, or one not modelled'
    if re.search(r'^minister of\b', t) and (' ni' in f' {t}' or 'northern ireland' in t or (year and year < 1973 and 'ireland' not in t)):
        for key, stem in NI_MINISTRIES:
            if key in t:
                return f'ni-minister-of-{stem}', None
    # Ireland
    if t.startswith('taoiseach'):
        return 'taoiseach', None
    if t.startswith('tanaiste'):
        return 'tanaiste', None
    if 'president of ireland' in t:
        return 'president-of-ireland', None
    if re.search(r'^minister for\b', t):
        for key, stem in IE_MINISTRIES:
            if key in t:
                return f'ie-minister-for-{stem}', None
        return None, 'Irish ministry not modelled'
    if t.startswith('minister of state'):
        return None, 'junior ministry not modelled'
    # Councils
    if 'lord mayor' in t:
        stem = _council(t)
        if stem == 'belfast':
            return ('deputy-lord-mayor-belfast' if 'deputy' in t else 'lord-mayor-belfast'), None
        if stem in ('dublin', 'cork') and 'deputy' not in t:
            return f'lord-mayor-{stem}', None
    if 'high sheriff' in t:
        return ('high-sheriff-belfast', None) if 'belfast' in t else (None, 'high sheriff outside Belfast, not modelled')
    if re.search(r'\bmayor\b', t):
        stem = _council(t)
        if stem and stem not in ('belfast', 'dublin', 'cork'):
            return (f'deputy-mayor-{stem}' if 'deputy' in t else f'mayor-{stem}'), None
        return None, 'mayoralty of a council not in the catalogue'
    if re.search(r'^chair(man|person|woman)?\b.*\b(district|borough|urban district) council\b', t) or re.search(r'^chair(man|person)? of\b.*council', t):
        stem = _council(t)
        if stem:
            return f'chair-{stem}', None
        return None, 'council chair of a council not in the catalogue'
    return None, None   # not a government or civic office: try the party offices


PARTY_OFFICE_PATTERNS = [
    (r'^(acting )?(party )?leader\b(?! of the (house|senate|assembly))|^leader (of|,)|\bleader of the (labour party|progressive democrats|alliance party|fianna fail)\b|^founder and leader|^northern leader', 'leader'),
    (r'^deputy leader\b', 'deputy-leader'),
    (r'^(acting )?president\b(?! of (ireland|the ulster unionist council))', 'president'),
    (r'^vice president\b(?! ulster unionist council)', 'vice-president'),
    (r'^(party )?chair(man|person|woman)?\b(?! of the (police|northern ireland affairs))|^national chairwoman', 'chair'),
    (r'^vice chair(man)?\b', 'vice-chair'),
    (r'^general secretary\b', 'general-secretary'),
    (r'^chief whip\b', 'chief-whip'),
    (r'^party secretary\b', 'secretary'),
]


def match_party_office(raw, party_id):
    t = norm(raw)
    if not party_id:
        return None, 'party office with no party'
    if 'ulster unionist council' in t or re.search(r'\buuc\b', t):
        if 'vice president' in t:
            return 'uuc-vice-president', None
        if 'president' in t:
            return 'uuc-president', None
        if 'standing committee' in t:
            return 'uuc-standing-committee-chair', None
        return None, 'Ulster Unionist Council post not modelled'
    if party_id == 'uup':
        if 'executive' in t and 'chair' in t:
            return 'uup-executive-chair', None
        if 'westminster' in t and ('leader' in t or 'chairman' in t):
            return 'uup-westminster-leader', None
        if 'general secretary' in t:
            return 'uup-general-secretary', None
        if 'chief whip' in t and 'parliamentary party' in t:
            return None, 'parliamentary party whip, not modelled'
    if party_id == 'alliance' and 'parliamentary party' in t:
        return 'alliance-parliamentary-leader', None
    if party_id == 'workers-party' and ('northern leader' in t or 'ni chairman' in t):
        return 'workers-party-northern-chair', None
    if party_id == 'vanguard' and 'joint leader' in t:
        return 'vanguard-joint-leader', None
    if party_id not in PARTY_INSTITUTIONS:
        return None, 'party offices of this party not modelled'
    if '/' in t or ' then ' in t or 'later' in t or 'and president' in t or ';' in str(raw):
        return None, 'several party posts in one string; needs manual reading'
    for pattern, kind in PARTY_OFFICE_PATTERNS:
        if re.search(pattern, t):
            if kind == 'president' and party_id in ('uup',):
                return None, 'party president of the UUP is the Ulster Unionist Council presidency; not stated'
            return party_office_id(party_id, kind), None
    return None, 'party post not modelled'
