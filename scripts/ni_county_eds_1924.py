"""
Northern Ireland county electoral divisions of the December 1923 schemes, drawn by dissolving
Civgraph's 1920s DEDs (ded-1930-04-01, NI_DEDs_1930.fgb, with Newcastle merged by
scripts/ni_deds_newcastle_merge.py).

The Ministry of Home Affairs divided each administrative county into county electoral divisions by
orders made on 3 and 5 Dec 1923 (Belfast Gazette issue 128, 7 Dec 1923, pages 536-540; Antrim 23,
Armagh 20, Down 20, Fermanagh 20, Londonderry 19, Tyrone 27: 129, as the 1926 Census counts them).
Every division is an urban district and/or a list of district electoral divisions, transcribed below
from the Gazette (OCR text checked against the page scans where the OCR dropped a name: Breagh in
Armagh, Portstewart's contents in Londonderry). Where the scheme names a single-DED town by the town
(Donaghadee, Limavady, North/South/West Omagh), the DED's name in the file is used.

Which dates the drawing is exact for: the DED file is the state of 1926-30, after Bangor UD's
extension (1 Jun 1924) and its DED change (20 Jun 1924). A division defined as an urban district
follows the district, so the drawing holds from 20 Jun 1924 until the Larne extension of 25 Nov 1930
(Census 1937: consequential CED changes). On 1 Apr 1924 the Bangor and Donaghadee divisions differed
by the Bangor extension, which no Civgraph DED geometry shows; that edition stays undrawn.

Matching: named DEDs by name within the county (exact after normalising, else the closest unused
name, every non-exact match printed for review); same-name DEDs by CSO_ID; an urban district by the
DEDs left over that lie in that district on the 1 Apr 1930 admin-areas file. Every county DED must
land in exactly one division, and each county must have its scheme's number of divisions.

  python scripts/ni_county_eds_1924.py     writes data/maps/electoral-divisions/<OUT> and the
                                            /test source cache copy
"""
from __future__ import annotations

import difflib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parent.parent
DEDS = ROOT / 'data' / 'maps' / 'electoral-divisions' / 'NI_DEDs_1930.fgb'
ADMIN_1930 = ROOT / 'data' / 'maps' / 'local-government' / 'Admin_Areas_01-04-1930.fgb'
OUT = ROOT / 'data' / 'maps' / 'electoral-divisions' / 'NI_County_Electoral_Divisions_1924-06-20.fgb'
CACHE = ROOT / 'render' / 'source-cache' / 'vector-intake' / 'county-ed-1924-06-20.fgb'
TO_IG = Transformer.from_crs(4326, 29903, always_xy=True)
ACRE = 4046.8564224

# Same-name DEDs, told apart by CSO_ID: (county, name as in the scheme, qualifier) -> CSO_ID
SAME_NAME = {
    ('ARMAGH', 'Killeen', 'Newry No. 2 Rural District'): '36068',
    ('ARMAGH', 'Killeen', 'Armagh Rural District'): '36031',
    ('DOWN', 'Glasdrumman', 'Kilkeel'): '38100',
    ('DOWN', 'Glasdrumman', 'Hillsborough'): '38085',
    ('DOWN', 'Crossgar', 'Ballynahinch'): '38059',
    ('DOWN', 'Crossgar', 'Garvaghy'): '38029',
    ('DOWN', 'Glen', 'Rathfriland'): '38125',
    ('LONDONDERRY', 'Ringsend', 'Letterloan'): '41021',
    ('LONDONDERRY', 'Ringsend', 'Salterstown'): '41079',
    ('LONDONDERRY', 'Waterside', 'Waterside'): '41060',
}
UD = 'UD:'  # an entry naming an urban district

# county -> [(division, [UD:<town> and/or DED names])], in the schedules' order
SCHEMES = {
    'ANTRIM': [
        ('Aghalee', ['Aghalee', 'Ballinderry', 'Ballyscolly', 'Glenavy', 'Lissue', 'Magheragall', 'Magheramesk', 'Montiaghs']),
        ('Ahoghill', ['Ahoghill', 'Ballyscullion', 'Cloghogue', 'Drumanaway', 'Portglenone', 'Toome']),
        ('Antrim', ['Antrim Rural', 'Antrim Urban', 'Donegore', 'Dunadry', 'Kilbride', 'Rashee']),
        ('Ballycastle', [UD + 'Ballycastle', 'Armoy', 'Ballycastle Rural', 'Ballintoy', 'Croagh', 'Drumtullagh', 'Dunseverick', 'Ramoan', 'Rathlin']),
        ('Ballyclare', [UD + 'Ballyclare', 'Ballyclare Rural', 'Carntall', 'Coggrey']),
        ('Ballygomartin', ['Ballyduff', 'Ballygolan', 'Ballygomartin', 'Ballysillan', 'Carnmoney']),
        ('Ballymena', [UD + 'Ballymena']),
        ('Ballymoney', [UD + 'Ballymoney', 'Dervock', 'Kilraghts', 'Kirkmoyle', 'Seacon', 'Stranocum']),
        ('Carrickfergus', [UD + 'Carrickfergus', 'Carrickfergus Rural', 'Eden', 'Middle Division']),
        ('Crumlin', ['Ballynadrentagh', 'Ballyrobin', 'Craigarogan', 'Crumlin', 'Dundesert', 'Muckamore', 'Seacash', 'Templepatrick']),
        ('Cushendall', ['Ballycregagh', 'Ballyhoe', 'Castlequarter', 'Corkey', 'Glenaan', 'Glenariff', 'Glendun', 'Glenmakeeran', 'Glenshesk', 'The Fair Head']),
        ('Dunminning', ['Ballyconnelly', 'Dunminning', 'Galgorm', 'Glenbuck', 'Lisnagarran', 'Tullaghgarley']),
        ('Dunmurry', ['Derryaghy', 'Dunmurry', 'Island Kelly', 'Lambeg', 'Lisnagarvey', 'Malone', 'Tullyrusk']),
        ('Glenarm', ['Ardclinis', 'Ballycor', 'Carncastle', 'Glenarm North', 'Glenarm South', 'Glencloy', 'Kilwaughter']),
        ('Island Magee', ['Ballynure', 'Glynn', 'Island Magee North', 'Island Magee South', 'Raloo', 'Templecorran', 'Whitehead']),
        ('Killoquin', ['Dirraw', 'Dunloy', 'Enagh', 'Killagan', 'Killoquin Lower', 'Killoquin Upper', 'The Vow']),
        ('Kirkinriola', ['Broughshane', 'Ballyclug', 'Cromkill', 'Kells', 'Kirkinriola']),
        ('Larne', [UD + 'Larne']),
        ('Lisburn', [UD + 'Lisburn']),
        ('Portrush', [UD + 'Portrush', 'Benvardin', 'Bushmills', 'Carnmoon', 'Dunluce', 'Port Cammon', 'Portrush Rural']),
        ('Randalstown', ['Cargin', 'Connor', 'Cranfield', 'Randalstown Rural', 'Randalstown Urban', 'Sharvogues', 'Shilvodan']),
        ('Slemish', ['Clogh', 'Glenravill', 'Glenwhirry', 'Longmore', 'Newtown Crommelin', 'Slemish']),
        ('Whiteabbey', ['Jordanstown', 'Monkstown', 'Whiteabbey', 'Whitehouse']),
    ],
    'ARMAGH': [
        ('Armagh', [UD + 'Armagh']),
        ('Bessbrook', ['Ballybot', 'Bessbrook North', 'Bessbrook South', 'Derrymore', 'Mullaghglass']),
        ('Breagh', ['Breagh', 'Carrowbrack', 'Portadown Rural']),
        ('Crossmaglen', ['Creggan', 'Crossmaglen', 'Cullaville', 'Dorsy', 'Glasdrumman', 'Moybane']),
        ('Crossmore', ['Ballyards', 'Brootally', 'Crossmore', 'Milford']),
        ('Drumcree', ['Drumcree', 'Killyman', 'Montiaghs', 'Tartaraghan']),
        ('Forkhill', ['Belleek', 'Cemly', 'Forkhill', 'Latbirget', 'Mullaghbane']),
        ('Hockley', ['Corporation East', 'Corporation West', 'Hockley', 'Kilmore']),
        ('Keady', [UD + 'Keady', 'Clay', 'Derrynoose', 'Drum', 'Middletown']),
        ('Kernan', ['Brownlows Derry', 'Cornakinnegar', 'Kernan', 'Lurgan Rural']),
        ('Killevy', ['Camlough', 'Drumintee', 'Fathom', 'Killeen|Newry No. 2 Rural District', 'Killevy', 'Moyra Castle']),
        ('Loughgall', ['Annaghmore', 'Charlemont', 'Loughgall', 'Tullyroan']),
        ('Lurgan', [UD + 'Lurgan']),
        ('Markethill', ['Clady', 'Glenanne', 'Lisnadill', 'Markethill']),
        ('Newtownhamilton', ['Armaghbrague', 'Ballymyre', 'Darkley', 'Newtownhamilton', 'Tullyvallan']),
        ('Portadown', [UD + 'Portadown']),
        ('Poyntz Pass', ['Ballysheil', 'Drumbanagher', 'Mountnorris', 'Poyntz Pass', 'Tullyhappy']),
        ('Rich Hill', ['Aghory', "Hamilton's Bawn", 'Killeen|Armagh Rural District', 'Rich Hill']),
        ('Tanderagee', [UD + 'Tandragee', 'Laurelvale', 'Mullaghbrack', 'Mullahead', 'Tanderagee Rural']),
        ('Tynan', ['Ballymartrim', 'Glenaul', 'Grange', 'Tynan']),
    ],
    'DOWN': [
        ('Ardglass', ['Ardglass', 'Clough', 'Killough', 'Raholp', 'Seaforde', 'Strangford', 'Tyrella']),
        ('Ballynahinch', ['Ballynahinch Rural', 'Ballynahinch Urban', 'Crossgar|Ballynahinch', 'Dunmore', 'Killinchy', 'Kilmore', 'Leggygowan']),
        ('Banbridge', [UD + 'Banbridge', 'Annaclone', 'Banbridge Rural', 'Loughbrickland', 'Scarva']),
        ('Bangor', [UD + 'Bangor']),
        ('Castlewellan', ['Ballyward', 'Bryansford', 'Castlewellan Rural', 'Castlewellan Urban', 'Clonduff', 'Cross', 'Dundrum', 'Fofanny', 'Leitrim']),
        ('Comber', ['Ballygowan', 'Ballymaglaff', 'Comber', 'Kilmood', 'Moneyreagh', 'Newtownards South']),
        ('Donaghadee', [UD + 'Donaghadee', 'Carrowdore', 'Crawfordsburn', 'Donaghadee Rural', 'Groomsport', 'Newtownards North']),
        ('Downpatrick', ['Downpatrick Rural', 'Downpatrick Urban', 'Inch', 'Killyleagh Rural', 'Killyleagh Urban']),
        ('Dromore', [UD + 'Dromore', 'Donaghcloney', 'Dromore Rural', 'Magheralin', 'Moira', 'Quilly']),
        ('Garvaghy', ['Balloolymore', 'Crossgar|Garvaghy', 'Garvaghy', 'Magherally', 'Skeagh', 'Tirkelly', 'Moneyslane']),
        ('Gilford', ['Ballyleny', 'Bleary', 'Clare', 'Gilford', 'Lenaderg', 'Loughans', 'Tullylish', 'Waringstown']),
        ('Hillsborough', ['Annahilt', 'Ballykeel', 'Ballyworfy', 'Blaris', 'Dromara', 'Glasdrumman|Hillsborough', 'Hillsborough', 'Maze']),
        ('Holywood', [UD + 'Holywood', 'Ballycultra', 'Ballyhackamore', 'Ballymaconaghy', 'Ballymiscaw', 'Castlereagh', 'Craigavad', 'Dundonald', 'Holywood Rural', 'Gilnahirk']),
        ('Kilkeel', [UD + 'Newcastle', 'Annalong', 'Ballinran', 'Ballymartin', 'Brackenagh', 'Dunnaman', 'Glasdrumman|Kilkeel', 'Kilkeel East', 'Kilkeel North', 'Kilkeel South', 'Maghera']),
        ('Newry', [UD + 'Newry']),
        ('Newtownards', [UD + 'Newtownards']),
        ('Portaferry', ['Ardkeen', 'Ballyhalbert', 'Ballywalter', 'Grey Abbey', 'Kircubbin', 'Portaferry', 'Quintin']),
        ('Rathfriland', ['Ballybrick', 'Ballycoshone', 'Carrickcrossan', 'Crobane', 'Damolly', 'Donaghmore', 'Drumgath', 'Glen|Rathfriland', 'Rathfriland North', 'Rathfriland South']),
        ('Saintfield', ['Ballymacbrennan', 'Ballyskeagh', 'Breda', 'Carryduff', 'Drumbo', 'Edenderry', 'Ouley', 'Saintfield']),
        ('Warrenpoint', [UD + 'Warrenpoint', 'Attical', 'Ballyholland', 'Clonallan', 'Drumreagh', 'Greencastle', 'Hilltown', 'Killowen', 'Lisnacree', 'Mayo', 'Rosstrevor']),
    ],
    'FERMANAGH': [
        ('Bellanamallard', ['Bellanamallard', 'Ballyreagh', 'Garvary', 'Newporton']),
        ('Brookeborough', ['Brookeborough', 'Colebrook', 'Corralongford', 'Mullaghfad']),
        ('Clonelly', ['Brookhill', 'Castlecaldwell', 'Clonelly', 'Drumrush']),
        ('Crum', ['Aghyoule', 'Crum', 'Derrysteaton', 'Drumshimuck']),
        ('Derrylea', ['Armagh Manor', 'Coolnamarrow', 'Derrylea', 'Kilmore']),
        ('Doon', ['Aghakillymaud', 'Drummully', 'Kinawley', 'Springtown']),
        ('Enniskillen Urban', ['Enniskillen East', 'Enniskillen North', 'Enniskillen South']),
        ('Enniskillen Rural', ['Ballycassidy', 'Castlecoole', 'Derrybrusk', 'Enniskillen Rural']),
        ('Florence Court', ['Corraglass', 'Florence Court', 'Killesher', 'Kinglass']),
        ('Holywell', ['Aghanaglack', 'Holywell', 'Lattone', 'Old Barr']),
        ('Irvinestown', ['Irvinestown', 'Killadeas', 'Lisnarrick', 'Milltown']),
        ('Inishmacsaint', ['Aghamuldowney', 'Belleek', 'Garrison', 'Inishmacsaint']),
        ('Lack', ['Ederny', 'Kesh', 'Lack', 'Magheraculmoney']),
        ('Laragh', ['Coolyermer', 'Drumane', 'Drummee', 'Lisbofin']),
        ('Lisbellaw', ['Clabby', 'Drumderg', 'Lisbellaw', 'Tempo']),
        ('Lisnaskea', ['Ballindarragh', 'Castlebalfour', 'Deerpark', 'Lisnaskea']),
        ('Maguiresbridge', ['Belle Isle', 'Cross', 'Greenhill', 'Maguiresbridge']),
        ('Monea', ['Church Hill', 'Doagh', 'Monea', 'Rahalton']),
        ('Newtownbutler', ['Clonkeelan', 'Magheraveely', 'Mullynagowan', 'Newtownbutler']),
        ('Rosslea', ['Carnmore', 'Dresternan', 'Eshnadarragh', 'Rosslea']),
    ],
    'LONDONDERRY': [
        ('Bellarena', ['Aghanloo', 'Ballykelly', 'Bellarena', 'Benone', 'Keady', 'Lislane', 'Myroe']),
        ('Castledawson', ['Aghagaskin', 'Bellaghy', 'Castledawson', 'Newbridge']),
        ('Clady', ['Ballynease', 'Clady', 'Gulladuff', 'Rocktown']),
        ('Claudy', ['Ardmore', 'Ballymullins', 'Banagher', 'Bondsglen', 'Claudy']),
        ('Coleraine', ['Coleraine']),
        ('Draperstown', ['Bancran', 'Carnamoney', 'Draperstown']),
        ('Dungiven', ['Ballyharigan', 'Dungiven', 'Feeny', 'Gelvin', 'Glenshane', 'Owenreagh', 'Scriggan']),
        ('Faughanvale', ['Drum', 'Drumraighland', 'Faughanvale', 'Fore Glen', 'Killywool', 'Straw']),
        ('Garvagh', ['Aghadowey', 'Agivey', 'Bovagh', 'Garvagh', 'Glenkeen', 'Slaght']),
        ('Kilrea', ['Bovedy', 'Hervey Hill', 'Kilrea', 'Lislea', 'The Grove']),
        ('Letterloan', ['Articlave', 'Downhill', 'Drumcroon', 'Letterloan', 'Ringsend|Letterloan', 'Somerset']),
        ('Liberties', ['Glendermot', 'Liberties Lower', 'Liberties Middle', 'Liberties Upper']),
        ('Limavady', ['Drumsurn', 'Fruithill', 'Limavady Urban', 'The Highlands']),
        ('Maghera', ['Maghera', 'Swatragh', 'Tullykeeran', 'Upperland']),
        ('Magherafelt', ['Desertmartin', 'Magherafelt', 'Tobermore']),
        ('Moneymore', ['Brackagh Slievegallion', 'Iniscarn', 'Lissan Upper', 'Moneymore']),
        ('Portstewart', ['Ballylagan', 'Bannbrook', 'Knockantern', 'Portstewart Rural', 'Portstewart Urban']),
        ('Salterstown', ['Ballyronan', 'Ringsend|Salterstown', 'Salterstown', 'The Loop']),
        ('Waterside', ['Eglinton', 'Lough Enagh', 'Tamnaherin', 'Waterside|Waterside']),
    ],
    'TYRONE': [
        ('Aughnacloy', ['Augher', 'Aughnacloy Rural', 'Aughnacloy Urban', 'Favor Royal', 'Tullyvar']),
        ('Ballygawley', ['Aghafad', 'Ballygawley', 'Errigall', 'Foremass', 'Killyfaddy', 'Newtownsaville']),
        ('Benburb', ['Benburb', 'Caledon', 'Minterburn']),
        ('Carrickmore', ['Carrickmore', 'Creggan', 'Fallagh', 'Loughmacrory', 'Mullaghslin', 'Sluggan']),
        ('Castlecaulfield', ['Aghnahoe', 'Castlecaulfield', 'Clonaneese', 'Granville']),
        ('Castlederg', ['Castlebane', 'Castlederg', 'Castlegore', 'Clare', 'Kirlish', 'Lisnacloon', 'Listymore', 'Magheracreggan']),
        ('Clogher', ['Aghintain', 'Ballagh', 'Clogher', 'Cole', 'Cullamore', 'Fivemiletown']),
        ('Coagh', ['Ballyclog', 'Coagh', 'Killycolpy', 'Mullanaboe', 'Munterevlin']),
        ('Coalisland', ['Coalisland', 'Meenagh', 'Mountjoy']),
        ('Cookstown', ['Cookstown Urban', 'Lissan Lower', 'Oritor']),
        ('Donaghmore', ['Altmore', 'Clonavaddy', 'Crossdernot', 'Donaghmore']),
        ('Douglas', ['Balix', 'Ballyfatten', 'Camus', 'Clady', 'Douglas', 'Edymore', 'Glenmornan', 'Sion']),
        ('Dromore', ['Camderry', 'Corlea', 'Dromore', 'Drumquin', 'Greenan', 'Moorfield']),
        ('Dunbreen', ['Castletown', 'Dunbreen', 'Gortin', 'Lislea', 'Mountjoy Forest East', 'Moyle']),
        ('Dungannon', ['Bernagh', 'Dungannon Central', 'Dungannon East', 'Dungannon West']),
        ('Dunnamanagh', ['Ballymagorry', 'Bready', 'Cullion', 'Dunnamanagh', 'Killyclooney', 'Leckpatrick', 'Tullyard']),
        ('Fintona', ['Dervaghroy', 'Ecclesville', 'Fallaghearn', 'Fintona', 'Loughmuck', 'Seskinore']),
        ('Killeter', ['Ardarver', 'Ballymongan', 'Clunahill', 'Corgary', 'Garvagh', 'Killen', 'Killeter', 'Longfield']),
        ('Moy', ['Bush', 'Killyman', 'Moy', 'Newmills']),
        ('Newtownstewart', ['Ardstraw', 'Baronscourt', 'Birnaghs', 'Carnkenny', 'Glentimon', 'Newtownstewart', 'Seein']),
        ('Omagh Rural', ['Bancran', 'Beragh', 'Edenderry', 'Maine', 'Mountjoy Forest West', 'Omagh Rural', 'Sixmilecross']),
        ('Omagh Urban', ['Omagh North Urban', 'Omagh South Urban', 'Omagh West Urban']),
        ('Plumbridge', ['Cranagh', 'Crockanboy', 'Doorat', 'Glenlark', 'Loughash', 'Plumbridge', 'Sperrin']),
        ('Pomeroy', ['Beaghmore', 'Killeenan', 'Oaklands', 'Pomeroy', 'Slate Quarry']),
        ('Stewartstown', ['Grange', 'Stewartstown', 'The Sandholes', 'Tullaghoge']),
        ('Strabane', ['Strabane East Urban', 'Strabane North Urban', 'Strabane South Urban', 'Strabane West Urban']),
        ('Trillick', ['Drumharvey', 'Kilskeery', 'Lifford', 'Rahony', 'Tattymoyle', 'Trillick']),
    ],
}
COUNTS = {'ANTRIM': 23, 'ARMAGH': 20, 'DOWN': 20, 'FERMANAGH': 20, 'LONDONDERRY': 19, 'TYRONE': 27}
BOROUGH_WARDS = {'37', '40'}  # CSO_ID prefixes of the Belfast and Londonderry county borough wards


def norm(s: str) -> str:
    s = s.upper().replace("'", '').replace('.', ' ')
    s = re.sub(r'\(([^)]*)\)', r'\1', s)
    return re.sub(r'\s+', ' ', s).strip()


def read(path: Path) -> list[dict]:
    out = subprocess.run(['ogr2ogr', '-f', 'GeoJSON', '/vsistdout/', str(path)], check=True, capture_output=True)
    return json.loads(out.stdout.decode('utf-8'))['features']


def ig(g):
    return transform(lambda x, y, z=None: TO_IG.transform(x, y), g)


def clean(geom) -> MultiPolygon:
    """Drop the degenerate slivers a union of neighbouring DEDs leaves (parts and holes under 1 m2)."""
    parts = []
    for poly in getattr(geom, 'geoms', [geom]):
        if poly.geom_type != 'Polygon' or ig(poly).area < 1:
            continue
        holes = [r for r in poly.interiors if ig(Polygon(r)).area >= 1]
        parts.append(Polygon(poly.exterior, holes))
    return MultiPolygon(parts)


def main() -> int:
    deds = [f for f in read(DEDS) if f['properties']['CSO_ID'][:2] not in BOROUGH_WARDS]
    admin = {f['properties']['AdministrativeArea']: shape(f['geometry']).buffer(0) for f in read(ADMIN_1930)}
    ok = True
    out = []
    for county, scheme in SCHEMES.items():
        pool = {i: f for i, f in enumerate(deds) if f['properties']['COUNTY'] == county}
        by_cso = {f['properties']['CSO_ID']: i for i, f in pool.items()}
        taken: dict[int, str] = {}
        if len(scheme) != COUNTS[county]:
            print(f'ERROR {county}: {len(scheme)} divisions, scheme says {COUNTS[county]}'); ok = False
        towns = []
        for ced, items in scheme:
            for item in items:
                if item.startswith(UD):
                    towns.append((ced, item[len(UD):]))
                    continue
                name, _, qual = item.partition('|')
                if qual:
                    i = by_cso[SAME_NAME[(county, name, qual)]]
                else:
                    free = {j: norm(pool[j]['properties']['ED_NAME']) for j in pool if j not in taken}
                    exact = [j for j, n in free.items() if n == norm(name)]
                    if len(exact) > 1:
                        print(f'ERROR {county} {ced}: {name} matches {len(exact)} DEDs; add it to SAME_NAME'); ok = False
                        continue
                    if exact:
                        i = exact[0]
                    else:
                        close = difflib.get_close_matches(norm(name), list(free.values()), n=1, cutoff=0.75)
                        if not close:
                            print(f'ERROR {county} {ced}: no DED for {name!r}'); ok = False
                            continue
                        i = next(j for j, n in free.items() if n == close[0])
                        print(f'  match {county} {ced}: {name!r} -> {pool[i]["properties"]["ED_NAME"]!r}')
                if i in taken:
                    print(f'ERROR {county}: {pool[i]["properties"]["ED_NAME"]} in {taken[i]} and {ced}'); ok = False
                taken[i] = ced
        # urban districts: the DEDs left over that lie in the district on the 1930 admin file
        for ced, town in towns:
            ud = next((g for n, g in admin.items() if n.startswith(town + ' ') and ('Urban' in n or 'Borough' in n)), None)
            if ud is None:
                print(f'ERROR {county} {ced}: no 1930 district for {town}'); ok = False
                continue
            hits = [j for j in pool if j not in taken and ud.contains(shape(pool[j]['geometry']).representative_point())]
            if not hits:
                print(f'ERROR {county} {ced}: no DEDs left inside {town}'); ok = False
            for j in hits:
                taken[j] = ced
            print(f'  {county} {ced}: urban district of {town} = '
                  + ', '.join(pool[j]['properties']['ED_NAME'] for j in hits))
        left = [pool[j]['properties']['ED_NAME'] for j in pool if j not in taken]
        if left:
            print(f'ERROR {county}: DEDs in no division: {left}'); ok = False
        for ced, _ in scheme:
            members = [j for j in pool if taken.get(j) == ced]
            if not members:
                continue
            geom = clean(unary_union([shape(pool[j]['geometry']).buffer(0) for j in members]).buffer(0))
            out.append({'type': 'Feature', 'geometry': mapping(geom), 'properties': {
                'CED': ced, 'COUNTY': county.title(), 'DED_COUNT': len(members),
                'DEDS': ', '.join(sorted(pool[j]['properties']['ED_NAME'].title() for j in members)),
                'AREA_ACRES': round(ig(geom).area / ACRE)}})
    print(f'{len(out)} divisions (census 129)')
    if len(out) != 129 or not ok:
        print('not written')
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'ceds.geojson'
        src.write_text(json.dumps({'type': 'FeatureCollection', 'features': out}), encoding='utf-8')
        if OUT.exists():
            OUT.unlink()
        subprocess.run(['ogr2ogr', '-f', 'FlatGeobuf', '-nln', OUT.stem, '-a_srs', 'EPSG:4326', '-nlt', 'MULTIPOLYGON',
                        '-lco', 'SPATIAL_INDEX=YES', str(OUT), str(src)], check=True)
    shutil.copyfile(OUT, CACHE)
    print(f'wrote {OUT.relative_to(ROOT)} and {CACHE.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
