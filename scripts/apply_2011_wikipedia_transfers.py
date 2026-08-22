#!/usr/bin/env python
"""Apply the Wikipedia-scraped 2011 count-by-count transfer data onto the
election-viewer per-ward files.

Pivot join via the deas-1993 geometry feature names (the canonical DEA list):
  - each of the 101 Wikipedia DEAs  -> a geometry feature  (built here, 101/101)
  - each existing per-ward JSON file -> the same geometry feature
so Wikipedia countGroup can be written onto the matching existing file, keeping
that file's identity (slug + Constituency_Name) intact so the build's geometry
match is unchanged. The one feature with no existing file (CARRICK CASTLE) gets
a new file created.

Existing files carry first-preferences only (Count_Number=1, no Transfers);
this replaces countGroup with the full multi-count transfer sheet and fills the
blank Number_Of_Seats (and any blank numeric countInfo field) from Wikipedia.
Constituency_Name is preserved from the existing file so nothing downstream moves.
"""
import json, glob, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_DATES = {1973: "1973-05-30", 1977: "1977-05-18", 1981: "1981-05-20",
          1985: "1985-05-15", 1989: "1989-05-17", 1993: "1993-05-19",
          1997: "1997-05-21", 2001: "2001-06-07", 2005: "2005-05-05",
          2011: "2011-05-05"}
YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2011
DATE = _DATES.get(YEAR, f"{YEAR}-05-05")
DIR = ROOT / f"election-viewer-package/data/elections/local-government/{DATE}"
WIKI = ROOT / f"_tmp_{YEAR}_lgov/bundle"
# boundary vintages: 1973-1981 -> deas-1972; 1985/1989 -> deas-1984; 1993+ -> deas-1993.
_GEOM = "deas-1972" if YEAR < 1985 else "deas-1984" if YEAR < 1993 else "deas-1993"
IDX = ROOT / f"render/metadata/feature-indexes/{_GEOM}-vector-test.json"

COUNCIL = {
    'antrim':'Antrim','ards':'Ards','armagh':'Armagh','ballymena':'Ballymena',
    'ballymoney':'Ballymoney','banbridge':'Banbridge','belfast':'Belfast',
    'carrickfergus':'Carrickfergus','castlereagh':'Castlereagh','coleraine':'Coleraine',
    'cookstown':'Cookstown','craigavon':'Craigavon','derry':'Derry','down':'Down',
    'dungannon_and_south_tyrone':'Dungannon and South Tyrone','fermanagh':'Fermanagh',
    'larne':'Larne','limavady':'Limavady','lisburn':'Lisburn','magherafelt':'Magherafelt',
    'moyle':'Moyle','newry_and_mourne':'Newry and Mourne','newtownabbey':'Newtownabbey',
    'north_down':'North Down','omagh':'Omagh','strabane':'Strabane',
}

def norm(s):
    s = (s or '').lower().strip()
    s = re.sub(r'\blg\d\d[- ]?[a-z]{2,3}[- ]', '', s)  # strip lg11-/lg05- council-code prefixes
    s = re.sub(r'\bcorrected\b', '', s)                # 'Pottinger corrected' -> pottinger
    s = re.sub(r'\bthe\b', '', s)
    s = re.sub(r'\band\b', '', s)
    s = s.replace('north west','northwest').replace('south east','southeast')
    s = s.replace('south west','southwest').replace('north east','northeast')
    return re.sub(r'[^a-z0-9]', '', s)

# 1. geometry features: norm -> canonical name
idx = json.load(open(IDX))['items']
geo = {norm(it['name']): it['name'] for it in idx}
# deas-1993 spelling aliases (mirrors SOURCE_NAME_ALIASES in build-test2-election-manifest.mjs):
# the geometry's canonical spelling differs from the ward-file/Wikipedia spelling.
_names = {it['name'] for it in idx}
for spelling, canonical in (
    ('Knockveagh', 'KNOCKIVEAGH'), ('Dunmurray Cross', 'DUNMURRY CROSS'),  # deas-1993
    ('Laganbank', 'LAGANSIDE'), ('Braid', 'BRAID VALLEY'),                 # deas-1984
):
    if canonical in _names:  # guard keeps each alias to its own geometry vintage
        geo[norm(spelling)] = canonical
# deas-1972 (1973-1981): the council was "Londonderry" then, ward files say "Derry".
for nm in _names:
    if nm.startswith('LONDONDERRY '):
        geo[norm(nm.replace('LONDONDERRY', 'Derry'))] = nm

# council-code map (reverse of LOCAL_GOVERNMENT_CODE_PREFIXES) to expand lgNN-<code>-<rest>
# placeholder ward slugs whose DEA name is bare ("lg81-NaM-Area-A" -> "Newry and Mourne Area A").
CODE2COUNCIL = {
    'ant':'Antrim','ard':'Ards','arm':'Armagh','bal':'Ballymena','bly':'Ballymoney',
    'ban':'Banbridge','bel':'Belfast','car':'Carrickfergus','cas':'Castlereagh','col':'Coleraine',
    'ckt':'Cookstown','crg':'Craigavon','der':'Derry','dow':'Down','dun':'Dungannon',
    'fer':'Fermanagh','lar':'Larne','lim':'Limavady','lis':'Lisburn','mag':'Magherafelt',
    'moy':'Moyle','nam':'Newry and Mourne','new':'Newtownabbey','nod':'North Down',
    'oma':'Omagh','str':'Strabane',
}

# 2. Wikipedia DEA -> feature, carrying the constituency payload
wiki_by_feat = {}
for f in glob.glob(str(WIKI / '*_bundle.json')):
    if '_combined' in f:
        continue
    key = os.path.basename(f).replace('_bundle.json', '')
    council = COUNCIL[key]
    d = json.load(open(f))
    for dea, payload in d['constituencies'].items():
        dea_n = norm(dea)
        cn = norm(council)
        stripped = dea_n[len(cn):] if dea_n.startswith(cn) and dea_n != cn else dea_n  # 'Craigavon Central' -> central
        for cand in (dea_n, norm(council + dea), norm(council.split()[0] + dea), stripped):
            if cand in geo:
                wiki_by_feat[geo[cand]] = (council, dea, payload)
                break
        else:
            print(f"  WARN unmatched wiki DEA: {council} / {dea}")
print(f"wiki DEAs matched to geometry: {len(wiki_by_feat)}/{len(idx)}")

# 3. existing files -> feature (norm + manual overrides for names the normalizer misses)
MANUAL = {
    'lough': 'LARNE LOUGH',
    'craigavon-central': 'CENTRAL',
    'omagh-west-tyrone': 'WEST TYRONE',
    'peninsula': 'ARDS PENINSULA',
    'lg89-lim-town': 'LIMAVADY TOWN',  # slug abbreviates the council; DEA name repeats it
}
file_by_feat = {}
for f in glob.glob(str(DIR / '*.json')):
    slug = os.path.basename(f)[:-5]
    if slug.startswith('_'):
        continue
    if slug in MANUAL:
        file_by_feat[MANUAL[slug]] = f
        continue
    cn = json.load(open(f))['Constituency']['countInfo'].get('Constituency_Name', '')
    cands = [norm(cn), norm(slug), norm(slug.replace('-', ' '))]
    m = re.match(r'lg\d\d-([a-z]{2,3})-(.+)', slug)  # expand lgNN-<code>-<rest> placeholder slugs
    if m and m.group(1) in CODE2COUNCIL:
        cands.append(norm(CODE2COUNCIL[m.group(1)] + ' ' + m.group(2).replace('-', ' ')))
    for cand in cands:
        if cand in geo:
            file_by_feat[geo[cand]] = f
            break
    else:
        print(f"  WARN unmatched existing file: {slug} ({cn})")

# 4. write
def merge_countinfo(existing, wiki):
    out = dict(existing)
    for k in ('Number_Of_Seats','Quota','Total_Electorate','Total_Poll','Valid_Poll','Spoiled'):
        if not out.get(k) and wiki.get(k):
            out[k] = wiki[k]
    return out

updated = created = skipped_empty = 0
for feat, (council, dea, payload) in wiki_by_feat.items():
    wiki_ci = payload['Constituency']['countInfo']
    wiki_cg = payload['Constituency']['countGroup']
    if not wiki_cg:
        # uncontested DEA (candidates returned unopposed) — Wikipedia has no poll
        # table, so there is nothing to add; keep the existing first-pref file.
        skipped_empty += 1
        print(f"  skip (uncontested, kept existing): {council} / {dea} [{feat}]")
        continue
    if feat in file_by_feat:
        path = file_by_feat[feat]
        existing = json.load(open(path))['Constituency']['countInfo']
        ci = merge_countinfo(existing, wiki_ci)
        updated += 1
    else:
        slug = re.sub(r'[^a-z0-9]+', '-', dea.lower()).strip('-')
        path = str(DIR / f"{slug}.json")
        ci = dict(wiki_ci)
        ci['Constituency_Name'] = dea
        created += 1
    out = {"Constituency": {"countInfo": ci, "countGroup": wiki_cg}}
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)

print(f"year: {YEAR} | features: {len(wiki_by_feat)} | updated: {updated} | created: {created} | skipped uncontested: {skipped_empty}")
missing = [it['name'] for it in idx if it['name'] not in file_by_feat]
print(f"features with NO existing file: {missing}")
