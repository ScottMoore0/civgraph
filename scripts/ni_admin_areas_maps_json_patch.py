"""
Point the NI admin-areas editions in data/database/maps.json at the vintage
files written by scripts/ni_admin_areas_reconstruct.py, and add this work's
change notes and references.

Reads data/maps/local-government/_staged/editions.json. maps.json is shared
with other edits: it is read immediately before the write, only files.fgb and
cloneOf of admin-areas-* entries and the entries named in NOTES are touched,
references are appended (never replaced; de-duplicated by label), and
changeNote is set when empty or ours, otherwise appended. Idempotent.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / 'data' / 'database' / 'maps.json'
PLAN = ROOT / 'data' / 'maps' / 'local-government' / '_staged' / 'editions.json'
BASE = 'https://data.civgraph.net/data/maps/local-government/'
GAZ = 'https://www.thegazette.co.uk/Belfast/issue/{}/data.pdf'
RECON = ('Line reconstructed from the order or Act and its deposited map on OSNI Largescale '
         'townlands (2013); not legally definitive.')

NISRA = 'https://www.nisra.gov.uk/files/nisra/publications/'
C61 = {
    'antrim': {'label': 'Census of Population 1961: County Antrim', 'url': NISRA + '1961-census-antrim-county-report.pdf',
               'note': 'Changes 1951-61: Larne RD to Larne MB 1 Apr 1956; Belfast RD abolished 1 Apr 1958 (Newtownabbey UD; '
                       'rest to Antrim, Larne and Lisburn RDs). Areas: Larne MB 2,521 ac 2 r 18 p; Newtownabbey UD 6,006 ac '
                       '1 r 12 p; Ballyduff DED (Antrim RD) 4,112 ac; Ballygomartin DED (Lisburn RD) 10,558 ac.'},
    'armagh': {'label': 'Census of Population 1961: County Armagh', 'url': NISRA + '1961-census-armagh-county-report.pdf',
               'note': 'Changes 1951-61: Lurgan RD to Lurgan MB 1 Apr 1957. Lurgan MB 2,024 ac 2 r 4 p.'},
    'down': {'label': 'Census of Population 1961: County Down', 'url': NISRA + '1961-census-down-county-report.pdf',
             'note': 'Changes 1951-61: North Down RD to Bangor MB 1 Apr 1956. Bangor MB 2,404 ac 2 r 9 p.'},
}
C66 = {'label': 'Census of Population 1966: General Report', 'url': NISRA + '1966-census-general-report.pdf',
       'note': 'North Down RD (population 477 in 1961) to Bangor MB 1 Apr 1962; Bangor MB 2,664 ac 2 r 37 p.'}
SRO_1957_222 = {'label': 'Newtownabbey Urban District (Electoral Areas) Order (Northern Ireland) 1957 (S.R. & O. 1957 No. 222)',
                'url': 'https://www.legislation.gov.uk/nisro/1957/222/contents/made',
                'note': 'Seven wards of Newtownabbey UD; Ballyduff DED (Antrim RD), Ballygomartin DED (Lisburn RD) and an '
                        'addition to Carrickfergus Rural DED (Larne RD) formed from the transferred areas.'}
# Census reports (combined PDFs per holdings-register.md section 3; Crown copyright expired). Cited by
# section and item, which survive any reprint; printed pages where the report numbers them.
CEN = {
    '26GR': {'label': 'Census of Population of Northern Ireland 1926: General Report'},
    '26TI': {'label': 'Census of Population of Northern Ireland 1926: Topographical Index'},
    '26Ant': {'label': 'Census of Population of Northern Ireland 1926: County of Antrim'},
    '26Dn': {'label': 'Census of Population of Northern Ireland 1926: County of Down'},
    '26Ldy': {'label': 'Census of Population of Northern Ireland 1926: County and County Borough of Londonderry'},
    '37PR': {'label': 'Census of Population of Northern Ireland 1937: Preliminary Report'},
    '37TS': {'label': 'Census of Population of Northern Ireland 1937: Supplement to the 1926 Topographical Index'},
    '51PR': {'label': 'Census of Population of Northern Ireland 1951: Preliminary Report'},
    '51Dn': {'label': 'Census of Population of Northern Ireland 1951: County of Down'},
    '61GR': {'label': 'Census of Population 1961: General Report'},
    '61Dn': {'label': 'Census of Population 1961: County Down', 'url': NISRA + '1961-census-down-county-report.pdf'},
    '66PR': {'label': 'Census of Population 1966: Preliminary Report'},
    '71PR': {'label': 'Census of Population 1971: Preliminary Report'},
}
OUR_STARTS = ('Kilkeel RD renamed South Down RD', 'Armagh UD', 'Lurgan UD extended', 'Bangor borough extended', 'Lurgan borough extended',
              'Belfast RD abolished', 'Armagh UD and Larne MB corrected')

NOTES = {
    'admin-areas-1945-04-01': {
        'changeNote': f'Armagh UD extended into Armagh RD (Armagh Urban District (Extension) Order, 1945). '
                      'Armagh UD, Keady UD and Armagh RD drawn. Also 1 Apr 1945: Enniskillen UD extended into '
                      'Enniskillen RD, the first of two stages (Census 1951); Enniskillen is not in this file.',
        'references': [
            {'label': 'Belfast Gazette issue 1239 (Armagh Urban District (Extension) Order, 1945)',
             'url': GAZ.format(1239),
             'note': '23 Mar 1945, page 69. Armagh County Council order of 13 Feb 1945, confirmed by the Ministry '
                     'of Health and Local Government 17 Mar 1945; in force from 1 Apr 1945. ' + RECON},
            {'label': 'Belfast Gazette issue 1254 (Armagh UD wards; Corporation East and West DEDs)',
             'url': GAZ.format(1254),
             'note': '6 Jul 1945, pages 151-152. Ministry orders of 27 Jun 1945 consequent on the extension.'},
        ],
    },
    'admin-areas-1946-06-11': {
        'changeNote': f'Armagh UD boundary altered and extended into Armagh RD (Armagh Urban District '
                      '(Alteration) Order, 1946).',
        'references': [
            {'label': 'Belfast Gazette issue 1309 (Armagh Urban District (Alteration) Order, 1946)',
             'url': GAZ.format(1309),
             'note': '26 Jul 1946, pages 183-184, with the full boundary description. County Council order of '
                     '11 Jun 1946, confirmed on appeal 17 Jul 1946; in force from 11 Jun 1946. 1951 Census: '
                     'Armagh UD 1,357 acres 3 roods 22 perches. ' + RECON},
            {'label': 'Belfast Gazette issue 1310 (Armagh UD wards; Corporation East, Corporation West and Grange DEDs)',
             'url': GAZ.format(1310),
             'note': '2 Aug 1946, pages 190-193. Ministry orders of 26 and 29 Jul 1946 consequent on the alteration.'},
        ],
    },
    'admin-areas-1938-04-01': {
        'changeNote': 'Lurgan UD extended into Lurgan RD (1937 order as modified on confirmation). '
                      '1951 Census: Lurgan 1,488 acres 0 roods 22 perches.',
        'references': [],
    },
    'admin-areas-1950-04-01': {
        'changeNote': 'Bangor borough extended (1950 Act). 1951 Census: Bangor MB 2,392 acres 1 rood 16 perches. '
                      'Newtownards borough also extended into Newtownards RD the same day (1950 Act; Census 1951); '
                      'Newtownards is not in this file.',
        'references': [CEN['51PR'] | {'note': 'Changes in administrative areas since 1937, Co. Down items (12)-(14): '
                                                'Newtownards MB and Bangor MB extended into Newtownards RD (1 Apr 1950).'}],
    },
    'admin-areas-1956-04-01': {
        'changeNote': 'Bangor borough extended (Bangor Borough (Extension) Order (NI) 1955) and Larne borough '
                      'extended (1956 Act), both in force 1 Apr 1956 (Census of Population 1961). ' + RECON,
        'references': [C61['down'], C61['antrim']],
    },
    'admin-areas-1957-04-01': {
        'changeNote': 'Lurgan borough extended into Lurgan RD by the Lurgan Borough (Extension) Order (Northern Ireland) '
                      '1956, in force 1 Apr 1957 (Census of Population 1961); certified copies of the Order\'s map are at '
                      'PRONI (LA/52/8/JA/4; OS/31/2/2, 1:2,500). ' + RECON,
        'references': [C61['armagh']],
    },
    'admin-areas-1958-04-01': {
        'changeNote': 'Belfast RD abolished; Newtownabbey UD formed from part of it (whole townlands; the line west of '
                      'Glengormley is unresolved by about 100-200 acres). The rest went to Antrim, Lisburn and Larne '
                      'RDs, which are not drawn in this edition.',
        'references': [C61['antrim'], SRO_1957_222],
    },
    'admin-areas-1962-04-01': {
        'changeNote': 'Bangor borough extended (1962 Act). 1966 Census: Bangor MB 2,664 acres 2 roods 37 perches. ' + RECON +
                      ' Also 1 Apr 1962 (Census 1966): Coleraine MB extended into Coleraine RD (not in this file), and '
                      'Antrim ceased to be a Towns Improvement Act town, its functions passing to Antrim RD.',
        'references': [C66, CEN['66PR'] | {'note': 'Changes in administrative areas: Co. Antrim (1), town of Antrim; '
                                                   'Co. Down (2), Bangor MB; Co. Londonderry (1), Coleraine RD to Coleraine '
                                                   'MB (population 598 in 1961), all 1 Apr 1962.'}],
    },
    'admin-areas-1967-04-01': {
        'changeNote': "Bangor borough extended (1966 Order, 1966 Act); line from the council's proposal map; the inquiry heard no objections, and the line's area (5,156 acres) is within 1% of the extended borough's in the 1971 Census (2,067.64 hectares, 5,109 acres). "
                      'Lurgan (Craigavon order) and Newtownabbey (1968) are not drawn from this edition. Also 1 Apr 1967 '
                      '(Census 1971): part of Lurgan RD to Lurgan MB, then Lurgan RD abolished and re-designated Craigavon '
                      'UD; part of East Down RD to Downpatrick UD (not in this file).',
        'references': [CEN['71PR'] | {'note': 'Changes in administrative areas: Co. Armagh (1)-(2), Lurgan RD to Lurgan MB '
                                                  'and Lurgan RD re-designated Craigavon UD; Co. Down (1)-(2), East Down RD '
                                                  'to Downpatrick UD and North Down RD to Bangor MB; all 1 Apr 1967.'}],
    },
    'admin-areas-1966-07-04': {
        'changeNote': 'Kilkeel RD renamed South Down RD on 4 Jul 1966, the date of this edition (Census 1966). '
                      'Armagh UD, Larne MB, Lurgan MB and Bangor MB corrected to the lines in force in 1966 (the source '
                      'layer had earlier extents), with their RDs adjusted; "Newtownabbey Rural District" (the old Belfast '
                      'RD extent) replaced by Newtownabbey UD, the rest of Belfast RD given to Antrim, Lisburn and Larne RDs.',
        'references': [C61['antrim'], C61['armagh'], C61['down'], C66,
                       CEN['66PR'] | {'note': 'Changes in administrative areas, Co. Down (3): the name of Kilkeel Rural '
                                              'District was changed to South Down Rural District (4 Jul 1966).'}],
    },
}



def _c(key: str, note: str) -> dict:
    return CEN[key] | {'note': note}


# ---- NI census boundary-change audit, 2026-11-01 (decisions-2026-11-01/census-boundary-changes-ni-1926-1971.md):
# change notes from the census reports for editions at the right date that said nothing, census
# confirmation of dates marked inferred, re-dated and new editions. A note says when the district
# concerned is not in the edition's (partial) file.
NOT_IN = " {} is not in this edition's file."
CENSUS_NOTES = {
    'eds-1915-04-01': (
        'Portrush UD extended (1 Apr 1915): part of County Londonderry (Coleraine RD; population 269 in 1911) '
        'transferred to County Antrim, and part of Ballymoney RD to Portrush UD (LGB (Ireland) Provisional Order '
        'Confirmation (No. 3) Act 1914; Census 1926).',
        [_c('26GR', 'Changes since 1911, p. xviii, items (a)-(d): part of Londonderry County to Antrim County on the '
                    'extension of Portrush UD; Coleraine RD and Union reduced; part of Ballymoney RD to Portrush UD; '
                    'Ballymoney Union enlarged (all 1 Apr 1915).')]),
    'eds-1916-01-26': (
        'Portstewart DED divided into Portstewart Urban and Portstewart Rural by the Local Government Board order '
        'made on 26 Jan 1916, the date of this edition. The 1926 Census gives 1 Apr 1916 as the day Portstewart '
        'Urban District was formed out of Coleraine RD.',
        [_c('26GR', 'Changes since 1911, p. xviii, item (e): Portstewart Urban District formed out of portion of '
                    'Coleraine Rural District (1 Apr 1916).'),
         _c('26Ldy', 'Part I, changes since 1911, item (c): Portstewart Urban District formed (1 Apr 1916).')]),
    'eds-1921-03-21': (
        'Ballycastle DED divided into Ballycastle Urban and Ballycastle Rural by the Local Government Board order '
        'made on 21 Mar 1921, the date of this edition. The 1926 Census gives 1 Apr 1921 as the day Ballycastle '
        'Urban District was formed out of Ballycastle RD.',
        [_c('26GR', 'Changes since 1911, p. xviii, item (h): Ballycastle Urban District formed out of portion of '
                    'Ballycastle Rural District (1 Apr 1921).'),
         _c('26Ant', 'Part I, p. vii, item (e): Ballycastle Urban District formed (1 Apr 1921), later divided into '
                     'two wards (6 Nov 1922).')]),
    'ded-1922-11-13': (
        'Newry UD wards reconstituted (13 Nov 1922; Census 1926).',
        [_c('26Dn', 'Part I, p. vi, item (c): wards in Newry Urban District reconstituted (13 Nov 1922). Confirms '
                    'the date the Gazette reference leaves unconfirmed.')]),
    'ded-1924-04-01': (
        'District electoral divisions reconstituted under the 1923 orders, in force 1 Apr 1924: 701 in Northern '
        'Ireland (681 in the counties, plus 15 Belfast and 5 Londonderry wards). Also 1 Apr 1924: Portaferry, '
        'Quintin and part of Ardkeen DEDs (Portaferry dispensary district) moved from Downpatrick RD to '
        'Newtownards RD (Census 1926).',
        [_c('26TI', 'Introduction, p. vi: the district electoral divisions were reconstituted in 1923 and now '
                    'number 701; the county electoral divisions number 129.'),
         _c('26Dn', 'Part I, p. vii, item (d): portion of Downpatrick RD and Union transferred to Newtownards RD '
                    'and Union (1 Apr 1924); Portaferry, Quintin and part of Ardkeen DEDs (Portaferry Dispensary '
                    'District).')]),
    'county-ed-1924-04-01': (
        'County electoral divisions reconstituted under the schemes of December 1923: 129 in the six counties '
        '(Antrim 23, Armagh 20, Down 20, Fermanagh 20, Londonderry 19, Tyrone 27; Census 1926).',
        [{'label': 'Belfast Gazette issue 128 (Administrative County of Down (county electoral divisions))',
          'url': 'https://www.thegazette.co.uk/Belfast/issue/128/page/537',
          'note': '7 Dec 1923, pages 537-538. Made 5 Dec 1923. Divides County Down into 20 county electoral '
                  'divisions, each an urban district or a group of district electoral divisions set out in a '
                  'schedule (Ardglass, Ballynahinch, Banbridge, Bangor, Castlewellan, Comber, Donaghadee, '
                  'Downpatrick, Dromore, Garvaghy, Gilford, Hillsborough, Holywood, Kilkeel, Newry, Newtownards, '
                  'Portaferry, Rathfriland, Saintfield, Warrenpoint). Made under section 7 of the Local Government '
                  'Act (Northern Ireland) 1922 for the election of county councillors; the scheme prints no date of '
                  "effect, so it is listed with the 1 Apr 1924 edition. Read from the Gazette's OCR text."},
         _c('26TI', 'Introduction, p. vi: the county electoral divisions in Northern Ireland were reconstituted in '
                    '1923 and now number 129.')]),
    'admin-areas-1924-04-01': (
        'Part of Downpatrick RD and Union (Portaferry dispensary district: Portaferry, Quintin and part of Ardkeen '
        "DEDs) transferred to Newtownards RD and Union (1 Apr 1924; Census 1926). Neither RD is in this edition's "
        'file.',
        [_c('26GR', 'Changes since 1911, p. xviii, item (r): portion of Downpatrick RD and Union transferred to '
                    'Newtownards RD and Union (1 Apr 1924).'),
         _c('26Dn', 'Part I, p. vii, item (d), and table notes: Portaferry, Quintin and part of Ardkeen DEDs '
                    '(Portaferry Dispensary District) transferred from Downpatrick RD on 1 Apr 1924.')]),
    'admin-areas-1924-06-01': (
        'Bangor UD extended into Newtownards RD (1 Jun 1924; Census 1926).',
        [_c('26GR', 'Changes since 1911, p. xviii, item (s): portion of Newtownards RD transferred to Bangor UD '
                    '(1 Jun 1924). Confirms the day the Gazette reference infers.')]),
    'ded-1924-06-01': (
        'Bangor UD extended (1 Jun 1924) and its wards altered the same day; its DEDs followed on 20 Jun 1924 '
        '(Census 1926).',
        [_c('26Dn', 'Part I, p. vii, items (e)-(f): portion of Newtownards RD transferred to Bangor UD (1 Jun '
                    '1924); wards and DEDs in Bangor UD altered (1 and 20 Jun 1924 respectively).')]),
    'admin-areas-1925-04-01': (
        'Downpatrick, a Towns Improvement Act town in Downpatrick RD, created an urban district (1 Apr 1925; '
        'Census 1926).' + NOT_IN.format('Downpatrick UD'),
        [_c('26GR', 'Changes since 1911, p. xviii, item (t): Downpatrick created an urban district (1 Apr 1925). '
                    'Confirms the day the Gazette reference leaves undated.')]),
    'ded-1925-04-01': (
        'Downpatrick UD created out of Downpatrick RD (1 Apr 1925); Whitehead constituted a Towns Improvement Act '
        'town in Larne RD (1 Apr 1925; Census 1926).',
        [_c('26Dn', 'Part I, p. vii, item (g): Downpatrick created an urban district (1 Apr 1925).'),
         _c('26Ant', 'Part I, p. vii, item (g): Whitehead constituted a town under the Towns Improvement Act 1854 '
                     '(1 Apr 1925), with consequential changes to Island Magee South, Templecorran and Whitehead '
                     'DEDs (24 Jun 1925).')]),
    'admin-areas-1927-04-01': (
        'Whitehead, a Towns Improvement Act town in Larne RD, made an urban district (1 Apr 1927; Census 1937).'
        + NOT_IN.format('Whitehead UD'),
        [_c('37PR', 'Changes in administrative areas since 1926, p. vi, item (a): Whitehead made an urban district '
                    '(1 Apr 1927). Confirms the day the Gazette reference infers.')]),
    'ded-1927-04-01': (
        'Whitehead made an urban district out of Larne RD (1 Apr 1927; Census 1937).',
        [_c('37TS', 'Changes in administrative areas, p. viii, item (a): Whitehead made an urban district (1 Apr '
                    '1927). Confirms the day the Gazette reference infers.')]),
    'admin-areas-1928-01-23': (
        'Bangor UD made a municipal borough (23 Jan 1928; Census 1937).',
        [_c('37PR', 'Changes in administrative areas since 1926, p. vi, item (b): Bangor UD made a municipal '
                    'borough (23 Jan 1928).')]),
    'ded-1928-04-17': (
        'Part of Newry North Ward transferred to the South Ward (17 Apr 1928); the corresponding part of Newry '
        'North urban DED followed on 22 Aug 1929, which has no edition of its own (Census 1937). Not drawn: no '
        "Civgraph DED geometry shows Newry's urban DEDs after the change.",
        [_c('37TS', 'Changes in administrative areas, p. viii, item (c): part of Newry North Ward to South Ward '
                    '(17 Apr 1928), and the corresponding part of Newry North urban DED to Newry South urban DED '
                    '(22 Aug 1929).')]),
    'ded-1929-01-01': (
        'The only change the 1937 Census records on this date is a dispensary one: Londonderry Dispensary and '
        "Registrars' Districts Nos. 2 and 3 created out of No. 2. No DED, ward or district line changed.",
        [_c('37TS', 'Changes in administrative areas, p. viii, item (d) (1 Jan 1929).')]),
    'admin-areas-1929-01-01': (
        'No district line changed on this date; the 1937 Census records only a dispensary change (Londonderry '
        'Dispensary Districts Nos. 2 and 3 created, 1 Jan 1929).',
        []),
    'admin-areas-1929-01-23': (
        'Coleraine UD made a municipal borough (23 Jan 1929; Census 1937).' + NOT_IN.format('Coleraine'),
        [_c('37PR', 'Changes in administrative areas since 1926, p. vi, item (c): Coleraine UD made a municipal '
                    'borough (23 Jan 1929).')]),
    'admin-areas-1930-04-01': (
        'Roadway areas of under half an acre exchanged between Warrenpoint UD and Newry No. 1 RD (1 Apr 1930; '
        'Census 1937).',
        [_c('37TS', 'Changes in administrative areas, p. viii, item (g): approximately equal areas of less than '
                    'half an acre (portions of roadway) exchanged between Warrenpoint UD and Newry No. 1 RD (1 Apr '
                    '1930).')]),
    'ded-1930-04-01': (
        'Newry North and South urban DEDs are drawn as before the transfer of 22 Aug 1929 (Census 1937); no '
        'Civgraph geometry shows the new line. Newcastle UD is one DED (Newcastle) with two wards, as the 1926 '
        'Census lists it.',
        [_c('37TS', 'Changes in administrative areas, p. viii, item (c): part of Newry North urban DED to Newry '
                    'South urban DED (22 Aug 1929), after the ward change of 17 Apr 1928.'),
         _c('26Dn', 'Newcastle Urban District: one D.E.D. (Newcastle) of two wards, North and South (table of '
                    'townlands, Newcastle UD; Part I, item (a): divided into two wards 6 Nov 1922). The county has '
                    '146 DEDs.')]),
    'admin-areas-1930-11-25': (
        'Part of Larne RD (population 161 in 1926, 255 in 1937) transferred to Larne UD, with consequential ward, '
        'DED and CED changes (25 Nov 1930; Census 1937). Larne is not drawn from this edition to 1 Apr 1955: no '
        'Civgraph line shows the extended town (1937 Census about 1,124 acres; the 1930 line is 629, the 1956 '
        'line 2,517).',
        [_c('37PR', 'Changes in administrative areas since 1926, p. vi, item (e): portion of Larne RD transferred to '
                    'Larne UD (25 Nov 1930).'),
         _c('37TS', 'Changes in administrative areas, p. viii, item (h): the same, with consequential changes to the '
                    'wards, DEDs and CEDs affected.')]),
    'ded-1930-11-25': (
        'Larne UD extended into Larne RD, with consequential changes to the wards and DEDs affected (25 Nov 1930; '
        'Census 1937).',
        [_c('37TS', 'Changes in administrative areas, p. viii, item (h) (25 Nov 1930).')]),
    'county-ed-1930-11-25': (
        'Larne UD extended into Larne RD, with consequential changes to the county electoral divisions affected '
        '(25 Nov 1930; Census 1937).',
        [_c('37TS', 'Changes in administrative areas, p. viii, item (h) (25 Nov 1930).')]),
    'ded-1933-04-24': (
        "Portadown UD's three wards abolished and its three urban DEDs amalgamated as Portadown Urban DED (24 Apr "
        '1933; Census 1937).',
        [_c('37TS', 'Changes in administrative areas, p. viii, item (i) (24 Apr 1933).')]),
    'ded-1935-06-26': (
        "Omagh UD's three DEDs made coterminous with its wards, which were reconstituted the day before (25-26 Jun "
        '1935; Census 1937).',
        [_c('37TS', 'Changes in administrative areas, p. ix, item (k): the three wards of Omagh UD reconstituted '
                    '(25 Jun 1935) and the three DEDs made coterminous with them (26 Jun 1935).')]),
    'ded-1936-04-01': (
        'The only change the 1937 Census records on this date is a dispensary one: part of Derrymore DED moved '
        "from Ballybot to Mullaghglass Dispensary and Registrar's District (Newry Union). No DED, ward or "
        'district line changed.',
        [_c('37TS', 'Changes in administrative areas, p. ix, item (l) (1 Apr 1936).')]),
    'admin-areas-1936-04-01': (
        'No district line changed on this date; the 1937 Census records only a dispensary change in Newry Union '
        '(1 Apr 1936).',
        []),
    'ded-1937-04-01': (
        'Kilkeel UD formed out of Kilkeel RD (1 Apr 1937). Also, with no edition of its own: Donaghadee UD divided '
        'into North and South Wards from the ordinary day of election, 15 May 1937 (order of 12 Jun 1936). Not '
        'drawn: Civgraph has no DED or ward geometry for these years.',
        [_c('51Dn', 'Notes to the table of urban districts (b): Donaghadee UD divided into two wards under Order '
                    'dated 12 Jun 1936 (effective as from 15 May 1937); (d): Kilkeel made an urban district on 1 Apr '
                    '1937.'),
         {'label': 'Belfast Gazette issue 782 (Urban District of Donaghadee (wards))',
          'url': 'https://www.thegazette.co.uk/Belfast/issue/782/data.pdf',
          'note': '19 Jun 1936, pages 220-221. Ministry of Home Affairs order dividing Donaghadee UD into a North '
                  'Ward and a South Ward, with the councillors to be elected for each on 15 May 1937. Read from the '
                  "Gazette's OCR text."}]),
    'ded-1938-05-15': (
        "Londonderry County Borough's wards reduced from five to three (15 May 1938; Census 1951). Also, with no "
        'edition of its own: Kilkeel UD constituted a single DED by order dated 11 May 1938. Not drawn.',
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Londonderry item (19): the wards of Londonderry '
                    'County Borough were reduced from five to three (15 May 1938).'),
         _c('51Dn', 'Notes to the table of urban districts (d): Kilkeel constituted a D.E.D. under Order dated 11 May '
                    '1938.')]),
    'admin-areas-1938-05-15': (
        "Londonderry County Borough's wards reduced from five to three (15 May 1938; Census 1951); the county "
        "borough's outer line did not change. This edition was dated 16 May 1938 until the census date was "
        'checked; 15 May 1938, the ordinary day of election, was a Sunday.',
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Londonderry item (19) (15 May 1938).')]),
    'county-ed-1938-05-15': (
        "Londonderry County Borough's wards reduced from five to three (15 May 1938; Census 1951).",
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Londonderry item (19) (15 May 1938).')]),
    'admin-areas-1938-05-23': (
        'Newtownards UD made a municipal borough (23 May 1938; Census 1951).' + NOT_IN.format('Newtownards'),
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Down item (12): Newtownards UD made a '
                    'municipal borough (23 May 1938).')]),
    'ded-1938-05-23': (
        'Newtownards UD made a municipal borough (23 May 1938). Also, with no edition of its own: its wards '
        'reduced from five to four on 27 Jun 1938 (Census 1951). Not drawn.',
        [_c('51Dn', 'Notes to the table of urban districts (e): Newtownards made a municipal borough on 23 May 1938, '
                    'and the number of wards reduced from 5 to 4 on 27 Jun 1938.')]),
    'admin-areas-1939-05-23': (
        'Ballymena UD and Larne UD made municipal boroughs (23 May 1939; Census 1951). Ballymena is named a '
        'municipal borough from this edition; Larne is not drawn from 25 Nov 1930 to 1 Apr 1955.',
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Antrim items (1)-(2) (23 May 1939).')]),
    'admin-areas-1946-04-01': (
        'Carrickfergus UD extended into Larne RD (population 1,613 in 1937) and Holywood UD into Castlereagh RD '
        "(population 404 in 1937), 1 Apr 1946 (Census 1951). Neither town is in this edition's file.",
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Antrim items (3)-(4) and Co. Down items '
                    '(15)-(16) (1 Apr 1946).')]),
    'admin-areas-1947-04-01': (
        'Portadown UD extended into Lurgan RD (population 2,363 in 1937), Enniskillen UD extended (second stage) '
        'and Cookstown UD extended into Cookstown RD (population 389 in 1937), 1 Apr 1947 (Census 1951). None of '
        "the three is in this edition's file.",
        [_c('51PR', 'Changes in administrative areas since 1937, items (9)-(10), (17)-(18), (20) and (22) (1 Apr '
                    '1947).')]),
    'admin-areas-1947-10-02': (
        'Portadown UD made a municipal borough (2 Oct 1947; Census 1951).' + NOT_IN.format('Portadown'),
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Armagh item (9) (2 Oct 1947).')]),
    'admin-areas-1948-04-01': (
        'Larne borough extended into Larne RD (population 22 in 1937) and Keady UD extended into Armagh RD (an '
        "uninhabited area), 1 Apr 1948 (Census 1951). Larne is not in this edition's file.",
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Antrim items (2), (4) and Co. Armagh items '
                    '(6)-(7) (1 Apr 1948). Confirms the day the Larne Act reference leaves unstated.')]),
    'ded-1948-04-01': (
        'Larne borough extended (1 Apr 1948; Census 1951) and Keady UD extended, with Crossmore DED reduced.',
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Antrim item (2): the boundary of Larne MB was '
                    'extended (1 Apr 1948). Confirms the day the Larne Act reference leaves unstated.')]),
    'admin-areas-1949-04-01': (
        'Dungannon UD extended into Dungannon RD (population 1,023 in 1937), 1 Apr 1949 (Census 1951).',
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Tyrone items (21) and (23) (1 Apr 1949).')]),
    'admin-areas-1949-05-30': (
        'Enniskillen UD made a municipal borough (30 May 1949; Census 1951).' + NOT_IN.format('Enniskillen'),
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Fermanagh item (17) (30 May 1949).')]),
    'admin-areas-1949-07-01': (
        'Carrickfergus UD made a municipal borough (1 Jul 1949; Census 1951).' + NOT_IN.format('Carrickfergus'),
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Antrim item (3) (1 Jul 1949).')]),
    'admin-areas-1949-07-07': (
        'Lurgan UD made a municipal borough (7 Jul 1949; Census 1951).',
        [_c('51PR', 'Changes in administrative areas since 1937, Co. Armagh item (8) (7 Jul 1949).')]),
    'admin-areas-1954-08-01': (
        'Newtownards RD renamed North Down RD (1 Aug 1954; Census 1961). This edition was dated 1 Apr 1954 until '
        'the census date was checked; no change on 1 Apr 1954 is recorded.' + NOT_IN.format('North Down RD'),
        [_c('61Dn', 'Part I, changes in administrative areas (1): the name of Newtownards Rural District was changed '
                    'to North Down Rural District (1 Aug 1954).'),
         _c('61GR', 'Changes in administrative areas, Co. Down (i) (1 Aug 1954).')]),
    'ded-1954-08-01': (
        'Newtownards RD renamed North Down RD (1 Aug 1954; Census 1961); no DED line changed. Dated 1 Apr 1954 '
        'until the census date was checked.',
        [_c('61Dn', 'Part I, changes in administrative areas (1) (1 Aug 1954).')]),
    'county-ed-1954-08-01': (
        'Newtownards RD renamed North Down RD (1 Aug 1954; Census 1961); no county electoral division changed. '
        'Dated 1 Apr 1954 until the census date was checked.',
        [_c('61Dn', 'Part I, changes in administrative areas (1) (1 Aug 1954).')]),
    'admin-areas-1955-04-01': (
        'Part of Lisburn RD (population 1,206 in 1951) transferred to Lisburn UD (1 Apr 1955; Census 1961).'
        + NOT_IN.format('Lisburn'),
        [_c('61GR', 'Changes in administrative areas, Co. Antrim (i) (1 Apr 1955).')]),
    'admin-areas-1962-01-01': (
        'Downpatrick RD renamed East Down RD (1 Jan 1962; Census 1961 and 1966); no line changed.'
        + NOT_IN.format('East Down RD'),
        [_c('66PR', 'Changes in administrative areas, Co. Down (1): the name of Downpatrick Rural District was '
                    'changed to East Down Rural District (1 Jan 1962).'),
         _c('61Dn', 'Part I: since the Census was taken, the name of Downpatrick Rural District was changed to East '
                    'Down Rural District (1 Jan 1962).')]),
    'ded-1962-01-01': (
        'Downpatrick RD renamed East Down RD (1 Jan 1962; Census 1966); no DED line changed.',
        [_c('66PR', 'Changes in administrative areas, Co. Down (1) (1 Jan 1962).')]),
    'county-ed-1962-01-01': (
        'Downpatrick RD renamed East Down RD (1 Jan 1962; Census 1966); no county electoral division changed.',
        [_c('66PR', 'Changes in administrative areas, Co. Down (1) (1 Jan 1962).')]),
    'admin-areas-1963-04-01': (
        'Part of Cookstown RD (population 184 in 1961) transferred to Cookstown UD (1 Apr 1963; Census 1966).'
        + NOT_IN.format('Cookstown'),
        [_c('66PR', 'Changes in administrative areas, Co. Tyrone (1) (1 Apr 1963).')]),
    'admin-areas-1964-06-02': (
        'Lisburn UD made a municipal borough (2 Jun 1964; Census 1966).' + NOT_IN.format('Lisburn'),
        [_c('66PR', 'Changes in administrative areas, Co. Antrim (3) (2 Jun 1964).')]),
    'admin-areas-1968-04-01': (
        'Part of Antrim RD (population 52) transferred to Newtownabbey UD, and part of North Down RD (population '
        "448) to Newtownards MB, 1 Apr 1968 (Census 1971). Neither town is in this edition's file.",
        [_c('71PR', 'Changes in administrative areas, Co. Antrim (1) and Co. Down (3) (1 Apr 1968).')]),
    'admin-areas-1969-04-02': (
        'Londonderry RD abolished and its area re-designated Londonderry UD (2 Apr 1969; Census 1971); no line '
        'changed.',
        [_c('71PR', 'Changes in administrative areas, Co. Londonderry (1): Londonderry Rural District was abolished '
                    'and re-designated as Londonderry Urban District (2 Apr 1969).')]),
    'ded-1969-04-02': (
        'Londonderry RD abolished and re-designated Londonderry UD (2 Apr 1969; Census 1971); no DED line changed.',
        [_c('71PR', 'Changes in administrative areas, Co. Londonderry (1) (2 Apr 1969).')]),
    'county-ed-1969-04-02': (
        'Londonderry RD abolished and re-designated Londonderry UD (2 Apr 1969; Census 1971); no county '
        'electoral division changed.',
        [_c('71PR', 'Changes in administrative areas, Co. Londonderry (1) (2 Apr 1969).')]),
}
# County electoral divisions of the December 1923 schemes, drawn by scripts/ni_county_eds_1924.py from the
# 1930 DED map. Exact from 20 Jun 1924 (Bangor's DEDs altered after its extension) to the Larne extension
# of 25 Nov 1930; the editions in between share the file.
CED_FILE = 'https://data.civgraph.net/data/maps/electoral-divisions/NI_County_Electoral_Divisions_1924-06-20.fgb'
CED_CANON = 'county-ed-1924-06-20'
CED_CLONES = ['county-ed-1925-04-01', 'county-ed-1925-06-24', 'county-ed-1927-04-01', 'county-ed-1928-01-23',
              'county-ed-1928-04-17', 'county-ed-1929-01-01', 'county-ed-1929-01-23', 'county-ed-1930-04-01']
CED_NOTE = ('The 129 county electoral divisions of the December 1923 schemes (Antrim 23, Armagh 20, Down 20, '
            'Fermanagh 20, Londonderry 19, Tyrone 27), each drawn as the urban district and district electoral '
            "divisions its scheme lists, joined on the 1930 DED map. Drawn from 20 Jun 1924, when Bangor's DEDs "
            'were altered after its extension, to the Larne extension of 25 Nov 1930.')
CED_REFS = [
    {'label': 'Belfast Gazette issue 128 (county electoral division schemes for the six counties)',
     'url': 'https://www.thegazette.co.uk/Belfast/issue/128/page/536',
     'note': '7 Dec 1923, pages 536-540. Orders of the Ministry of Home Affairs made 3 Dec (Tyrone) and 5 Dec 1923 '
             'under section 7 of the Local Government Act (Northern Ireland) 1922, each dividing a county into '
             'county electoral divisions made up of urban districts and named district electoral divisions. '
             'Transcribed from the OCR text, checked against the page scans for Armagh (Breagh) and Londonderry '
             '(Portstewart).'},
    {'label': 'District Electoral Divisions 1 Apr 1930 (ded-1930-04-01)',
     'note': 'The DED lines the divisions are joined from (Paddy Matthews), with Newcastle as one DED.'},
    CEN['26TI'] | {'note': 'Introduction, p. vi: the county electoral divisions were reconstituted in 1923 and now '
                           'number 129.'},
]

CENSUS_NOTES['county-ed-1924-06-20'] = (CED_NOTE, CED_REFS)
CENSUS_NOTES['deds-ni-1926'] = (
    'Newcastle UD is one DED (Newcastle) with a North and a South Ward, as the 1926 Census lists it; the two wards '
    "were drawn as two DEDs, giving 702 against the census's 701 (Topographical Index p. vi).", [])
CENSUS_NOTES['county-ed-1924-04-01'] = (
    CENSUS_NOTES['county-ed-1924-04-01'][0] + ' Not drawn for 1 Apr 1924: the Bangor and Donaghadee divisions then '
    'lay on a line before the Bangor extension that no Civgraph DED map shows; the divisions are drawn from 20 Jun '
    '1924 (county-ed-1924-06-20).', CENSUS_NOTES['county-ed-1924-04-01'][1])
for _id, (_note, _refs) in CENSUS_NOTES.items():
    if _id in NOTES:
        raise SystemExit(f'{_id} is in NOTES and CENSUS_NOTES')
    NOTES[_id] = {'changeNote': _note, 'references': _refs}
OUR_STARTS = OUR_STARTS + tuple(v[0][:40] for v in CENSUS_NOTES.values())

# Editions re-dated to the census date. The id encodes the date, so the id changes too; old links are
# redirected by LEGACY_LAYER_ID_PREFIXES in app/src/app.js.
REDATE = {
    'admin-areas-1954-04-01': '1954-08-01', 'ded-1954-04-01': '1954-08-01', 'county-ed-1954-04-01': '1954-08-01',
    'admin-areas-1938-05-16': '1938-05-15', 'ded-1938-05-16': '1938-05-15', 'county-ed-1938-05-16': '1938-05-15',
}
# New editions on the shared date grid: date -> the existing same-series edition each is modelled on.
NEW_EDITIONS = {'1962-01-01': '1958-04-01', '1969-04-02': '1969-04-01'}
GRID_CLASSES = {'admin-areas': 'ni-admin-areas', 'ded': 'ni-deds', 'county-ed': 'ni-county-eds'}
# county-ed-1957-04-01 served Counties_1957.fgb, the 32 county outlines (Phelim Birch's 1957 county map,
# geometrically identical to counties-ireland-1957), not county electoral divisions: now a placeholder like
# the other county-ed editions after 1924.
PLACEHOLDER_NOW = {
    'county-ed-1957-04-01': 'The file this edition used to show (Counties_1957.fgb) is the 1957 county outlines, not '
                            'county electoral divisions; the same map is Counties of Ireland 1957 '
                            '(counties-ireland-1957).',
}
MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()


def display(d: str) -> str:
    y, m, dd = d.split('-')
    return f'{int(dd)} {MONTHS[int(m) - 1]} {y}'


def restructure(data: dict) -> tuple[list[str], dict]:
    """Re-date, add and blank editions, and keep the three grid classes in date order. Idempotent."""
    log = []
    maps = data['maps']
    renamed = {}
    for old, new_date in REDATE.items():
        new = old[:-10] + new_date
        m = next((m for m in maps if m['id'] == old), None)
        if m is None:
            renamed[old] = new
            continue
        if any(x['id'] == new for x in maps):
            raise SystemExit(f'{old}: {new} already exists')
        old_date = m['date']
        m['id'] = m['slug'] = new
        m['date'] = new_date
        m['name'] = m['name'].replace(display(old_date), display(new_date))
        renamed[old] = new
        log.append(f'renamed {old} -> {new}')
    for m in maps:
        if m.get('cloneOf') in renamed:
            m['cloneOf'] = renamed[m['cloneOf']]
    for when, model_date in NEW_EDITIONS.items():
        for series in GRID_CLASSES:
            new = f'{series}-{when}'
            if any(m['id'] == new for m in maps):
                continue
            at = next(i for i, m in enumerate(maps) if m['id'] == f'{series}-{model_date}')
            src = maps[at]
            entry = {k: v for k, v in src.items() if k not in ('changeNote', 'references', 'cloneOf')}
            entry['id'] = entry['slug'] = new
            entry['date'] = when
            entry['name'] = src['name'].replace(display(model_date), display(when))
            # each series runs newest first: before the model when newer, after it when older
            maps.insert(at if when > model_date else at + 1, entry)
            log.append(f'added {new}')
    for mid, note in PLACEHOLDER_NOW.items():
        m = next((m for m in maps if m['id'] == mid), None)
        if m is None or m.get('placeholder'):
            continue
        for k in list(m):
            if k not in ('id', 'name', 'slug', 'category', 'date', 'featured'):
                del m[k]
        m.update({'placeholder': True, 'featured': True, 'provider': [],
                  'keywords': ['county', 'ed', 'electoral', 'divisions', 'placeholder'], 'changeNote': note})
        log.append(f'{mid} made a placeholder')
    by_id = {m['id']: m for m in maps}
    for series, cid in GRID_CLASSES.items():
        cls = next(c for c in data['classes'] if c['id'] == cid)
        members = [renamed.get(x, x) for x in cls['maps']]
        members += [f'{series}-{when}' for when in NEW_EDITIONS]
        cls['maps'] = sorted(dict.fromkeys(members), key=lambda x: by_id[x]['date'], reverse=True)
    return log, renamed


def ced_editions(data: dict) -> list[str]:
    log = []
    maps = data['maps']
    for mid in [CED_CANON] + CED_CLONES:
        m = next(x for x in maps if x['id'] == mid)
        if not m.get('placeholder') and m.get('files', {}).get('fgb') == CED_FILE:
            continue
        m.pop('placeholder', None)
        m['provider'] = ['Paddy Matthews']
        m['keywords'] = ['county', 'ed', 'electoral', 'divisions', '1924', 'northern ireland']
        m['files'] = {'fgb': CED_FILE}
        m['style'] = {'color': '#00A9E6', 'weight': 2}
        m['labelProperty'] = 'CED'
        if mid != CED_CANON:
            m['cloneOf'] = CED_CANON
        log.append(f'{mid} drawn ({"canonical" if mid == CED_CANON else "clone"})')
    return log


def main() -> None:
    plan = json.loads(PLAN.read_text(encoding='utf-8'))
    data = json.loads(PATH.read_text(encoding='utf-8'))  # read fresh, right before writing
    log, renamed = restructure(data)
    log += ced_editions(data)
    for line in log:
        print(' ', line)
    plan = {renamed.get(k, k): v | ({'cloneOf': renamed.get(v['cloneOf'], v['cloneOf'])} if v.get('cloneOf') else {})
            for k, v in plan.items()}
    seen = set()
    for m in data['maps']:
        mid = m.get('id')
        if mid in plan:
            seen.add(mid)
            m.setdefault('files', {})['fgb'] = BASE + plan[mid]['file']
            if plan[mid]['cloneOf']:
                m['cloneOf'] = plan[mid]['cloneOf']
            else:
                m.pop('cloneOf', None)
        if mid in NOTES:
            note = NOTES[mid]
            cur = m.get('changeNote') or ''
            if not cur or cur.startswith(OUR_STARTS) or cur == note['changeNote']:
                m['changeNote'] = note['changeNote']
            elif note['changeNote'] not in cur:
                m['changeNote'] = cur + ' ' + note['changeNote']
            refs = m.get('references') or []
            have = {r.get('label') for r in refs}
            m['references'] = refs + [r for r in note['references'] if r['label'] not in have]
            if not m['references']:
                del m['references']
    missing = set(plan) - seen
    if missing:
        raise SystemExit(f'missing entries: {sorted(missing)}')
    unplanned = sorted(m['id'] for m in data['maps'] if m['id'].startswith('admin-areas-19') and m['id'] not in plan
                       and m['id'] not in ('admin-areas-1930-04-01', 'admin-areas-1966-07-04'))
    if unplanned:
        print(f'  NOTE no staged file yet for {unplanned}: run scripts/ni_admin_areas_reconstruct.py, then this again')
    with open(PATH, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f'patched {len(seen)} edition entries; notes on {len(NOTES)}')


if __name__ == '__main__':
    main()
