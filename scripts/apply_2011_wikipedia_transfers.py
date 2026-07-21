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
import json, glob, os, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "election-viewer-package/data/elections/local-government/2011-05-05"
WIKI = ROOT / "_tmp_2011_lgov/bundle"
IDX = ROOT / "test/metadata/feature-indexes/deas-1993-vector-test.json"

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
    s = re.sub(r'\blg11[- ]?[a-z]{2,3}[- ]', '', s)
    s = re.sub(r'\bthe\b', '', s)
    s = re.sub(r'\band\b', '', s)
    s = s.replace('north west','northwest').replace('south east','southeast')
    s = s.replace('south west','southwest').replace('north east','northeast')
    return re.sub(r'[^a-z0-9]', '', s)

# 1. geometry features: norm -> canonical name
idx = json.load(open(IDX))['items']
geo = {norm(it['name']): it['name'] for it in idx}

# 2. Wikipedia DEA -> feature, carrying the constituency payload
wiki_by_feat = {}
for f in glob.glob(str(WIKI / '*_bundle.json')):
    if '_combined' in f:
        continue
    key = os.path.basename(f).replace('_bundle.json', '')
    council = COUNCIL[key]
    d = json.load(open(f))
    for dea, payload in d['constituencies'].items():
        for cand in (norm(dea), norm(council + dea), norm(council.split()[0] + dea)):
            if cand in geo:
                wiki_by_feat[geo[cand]] = (council, dea, payload)
                break
        else:
            raise SystemExit(f"UNMATCHED wiki DEA: {council} / {dea}")
assert len(wiki_by_feat) == 101, len(wiki_by_feat)

# 3. existing files -> feature (norm + manual overrides for names the normalizer misses)
MANUAL = {
    'lough': 'LARNE LOUGH',
    'craigavon-central': 'CENTRAL',
    'omagh-west-tyrone': 'WEST TYRONE',
    'peninsula': 'ARDS PENINSULA',
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
    for cand in (norm(cn), norm(slug), norm(slug.replace('-', ' '))):
        if cand in geo:
            file_by_feat[geo[cand]] = f
            break
    else:
        raise SystemExit(f"UNMATCHED existing file: {slug} ({cn})")

# 4. write
def merge_countinfo(existing, wiki):
    out = dict(existing)
    for k in ('Number_Of_Seats','Quota','Total_Electorate','Total_Poll','Valid_Poll','Spoiled'):
        if not out.get(k) and wiki.get(k):
            out[k] = wiki[k]
    return out

updated = created = 0
for feat, (council, dea, payload) in wiki_by_feat.items():
    wiki_ci = payload['Constituency']['countInfo']
    wiki_cg = payload['Constituency']['countGroup']
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

print(f"features: {len(wiki_by_feat)} | files updated: {updated} | files created: {created}")
missing = [it['name'] for it in idx if it['name'] not in file_by_feat]
print(f"features that had NO existing file (now created): {missing}")
