#!/usr/bin/env python3
"""Apply the drive's ED/ward spec cards to data/database/maps.json.

The spec cards shipped with the boundary drive are a complete registration spec --
which four provincial files compose each year, the layer name, provider, date, notes,
sources, category and label attribute. This turns them into map records rather than
hand-editing 22 layers.

STRUCTURE. Each year is a GROUP record (isGroup) with four variants, one per province.
Each variant `cloneOf`s a hidden per-province BASE record that owns the actual .fgb URL.
So a new year needs its group, and any provincial file not already exposed as a base
record needs one of those too.

WHAT IT WRITES. data/database/maps.json only -- the source of truth. Everything under
data/browse/ and data/graph/ is regenerated from it by scripts/build-browse-indexes.mjs,
which must be run afterwards.

DELIBERATELY NOT DONE. eds-roi-1971-04-15 is left as a placeholder. A live eds-1971
already serves that exact card, so activating both would put two identical 1971 layers
on the site; they need merging, which is a judgement call rather than a mechanical one.
"""
import os, re, sys, json, glob, argparse, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
DB = os.path.join(REPO, 'data', 'database', 'maps.json')
ST = 'C:/Users/scomo/civgraph-drive-staging'
BASE_URL = 'https://data.civgraph.net/data/maps/electoral-divisions/'
STYLE = {'color': '#1B5E20', 'weight': 2}
PROVIDER = ['Phelim Birch', 'Paddy Matthews']
PROVS = ['Connacht', 'Leinster', 'Munster', 'Ulster']


def fgb_url(name):
    """Real R2 URL for a provincial file. Some objects live in a subfolder
    ('Electoral Divisions 1986-2019/'), so the key cannot be assumed from the name --
    it is taken from the upload plan, falling back to the flat path."""
    return _URLS.get(name, BASE_URL + name + '.fgb')


def _load_urls():
    out = {}
    plan = os.path.join(os.environ.get('CLAUDE_JOB_DIR', ''), 'tmp', 'r2_plan.json')
    if os.path.exists(plan):
        for r in json.load(open(plan, encoding='utf-8')):
            k = r['key']
            if k.endswith('.fgb'):
                out[os.path.basename(k)[:-4]] = 'https://data.civgraph.net/' + k
    return out


_URLS = {}


def read_cards():
    cards = {}
    for p in sorted(glob.glob(ST + '/**/*.txt', recursive=True)):
        t = open(p, encoding='utf-8', errors='replace').read()
        g = lambda k: (re.search(rf'^{k}\s*-\s*(.+)$', t, re.M | re.I) or [None, None])[1]
        files = g('Files to use')
        if not files:
            continue
        yr = re.search(r'(\d{4})', os.path.basename(p)).group(1)
        d = g('Date') or ''
        m = re.match(r'(\d{2})/(\d{2})/(\d{4})', d.strip())
        cards[yr] = {
            'year': int(yr),
            'files': [x.strip() for x in files.split(',')],
            'name': (g('Name') or '').strip(),
            'provider': [x.strip() for x in (g('Provider') or '').split(',') if x.strip()],
            'date': f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else yr,
            'notes': (g('Notes') or '').strip(),
            'label': (g('Attribute to use for feature labels') or 'ENGLISH').strip(),
            'card': os.path.basename(p),
            'sources': read_sources(t),
        }
    return cards


def read_sources(t):
    """Cards cite sources either as a single 'Source - X' line or a 'Sources:' block
    of dash-prefixed lines. Both forms appear, sometimes in the same file."""
    out = []
    m = re.search(r'^Source\s*-\s*(.+)$', t, re.M)
    if m:
        out.append(m.group(1).strip())
    blk = re.search(r'^Sources\s*:?\s*$(.*?)(?=^\s*Category card|\Z)', t, re.M | re.S)
    if blk:
        for line in blk.group(1).split('\n'):
            s = line.strip().lstrip('-').strip()
            if len(s) > 6 and not s.lower().startswith(('category card', 'attribute to use')):
                out.append(s)
    return [s.rstrip('.') for s in out][:7]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    global _URLS
    _URLS = _load_urls()
    db = json.load(open(DB, encoding='utf-8'))
    maps = db['maps']
    by_id = {m['id']: m for m in maps}
    # reverse index: existing .fgb URL -> base record id
    by_fgb = {}
    for m in maps:
        u = ((m.get('files') or {}).get('fgb') or '')
        if u.endswith('.fgb'):
            by_fgb[os.path.basename(u)[:-4]] = m['id']

    cards = read_cards()
    # which group record serves each card year
    group_for = {}
    for yr in cards:
        for cand in (f'eds-roi-{yr}', f'eds-{yr}'):
            if cand in by_id:
                group_for[yr] = cand
                break
        else:
            group_for[yr] = f'eds-roi-{yr}'

    created_base, created_group, updated_group = [], [], []
    for yr, c in sorted(cards.items()):
        # ensure a base record exists for each provincial file
        variants = []
        for f in c['files']:
            prov = next((p for p in PROVS if p.lower() in f.lower()), None)
            fyr = re.search(r'(\d{4})', f.split('_')[-1])
            fyr = fyr.group(1) if fyr else yr
            # Resolve by FILE, never by year. Provinces mostly do not change from one
            # card to the next -- the 1941 card reuses Connacht 1919, Munster 1921 and
            # Ulster 1921 -- so a base is created only when the FILE itself is new, and
            # an unchanged province simply reuses its existing base record.
            bid = by_fgb.get(f)
            if not bid:
                bid = f'eds-{prov.lower()}-{fyr}'
                if bid not in by_id:
                    rec = {'id': bid, 'name': f'{prov} District Electoral Divisions/Wards {fyr}',
                           'slug': bid, 'category': 'electoral-divisions', 'hidden': True,
                           'featured': False, 'provider': list(PROVIDER),
                           'files': {'fgb': fgb_url(f)}, 'style': dict(STYLE),
                           'keywords': [prov.lower(), 'ED', 'DED', 'ward', fyr],
                           'labelProperty': c['label'], 'date': int(fyr),
                           'description': f'{prov} component used by the {yr} Republic of '
                                          f'Ireland District Electoral Divisions/Wards entry.'}
                    maps.append(rec); by_id[bid] = rec; by_fgb[f] = bid
                    created_base.append(bid)
                else:
                    by_fgb[f] = bid
            same = (fyr == yr)
            variants.append({
                'id': f'{group_for[yr]}-{prov.lower()}',
                'label': f'{prov} {fyr}' if same else f'{prov} (= {fyr} boundaries)',
                'cloneOf': bid,
                'files': {'fgb': fgb_url(f)},
                'style': dict(STYLE), 'labelProperty': c['label'], 'useLOD': False})

        gid = group_for[yr]
        if gid == 'eds-roi-1971-04-15':
            continue                      # duplicate of live eds-1971; left alone
        g = by_id.get(gid)
        new = g is None
        if new:
            g = {'id': gid, 'slug': gid, 'category': 'wards', 'isGroup': True,
                 'featured': True}
            maps.append(g); by_id[gid] = g
        g.update({
            'name': c['name'] or f'District Electoral Divisions/Wards {yr}',
            'date': c['date'], 'provider': c['provider'] or list(PROVIDER),
            'style': dict(STYLE), 'labelProperty': c['label'],
            'isGroup': True, 'variants': variants,
        })
        g.pop('hidden', None)
        if c['notes']:
            g['description'] = (f"Republic of Ireland District Electoral Divisions/Wards "
                                f"as at {c['date']}, assembled from "
                                + ', '.join(v['label'] for v in variants) + '. ' + c['notes'])
        g.setdefault('keywords', ['electoral division', 'district electoral division',
                                  'DED', 'ward', str(yr), 'republic of ireland', 'historic',
                                  'small electoral units'])
        g['sourceNotes'] = BASE_URL + c['card']
        # `downloads` is an explicit field on the record -- the browse builder does NOT
        # derive it from `variants`, so a group without it renders with no files at all.
        dls = []
        for f in c['files']:
            prov = next((pp for pp in PROVS if pp.lower() in f.lower()), '')
            fy = re.search(r'(\d{4})', f.split('_')[-1])
            dls.append({'label': f"{prov} DEDs/Wards {fy.group(1) if fy else yr}",
                        'url': fgb_url(f), 'type': 'FlatGeobuf'})
        dls.append({'label': f"Source notes {yr}", 'url': BASE_URL + c['card'],
                    'type': 'Source notes'})
        g['downloads'] = dls
        # References: the card's own notes, plus each cited statute/source line.
        refs = [{'label': f"{g['name']} source notes", 'url': BASE_URL + c['card'],
                 'note': 'Sidecar notes supplied in the Irish Digitised Boundaries archive.'}]
        for line in c['sources']:
            refs.append({'label': line})
        seen, out = set(), []
        for r in refs:
            if r['label'] not in seen:
                seen.add(r['label']); out.append(r)
        g['references'] = out[:8]
        g.pop('status', None)
        (created_group if new else updated_group).append(gid)

    # --- the six new RoI local authority records ---
    LA = ['1915', '1920-06-19', '1920-06-25', '1920-10-04', '1921', '1927']
    created_la = []
    for d in LA:
        lid = f'roi-local-authorities-{d}'
        if lid in by_id:
            continue
        yr = d[:4]
        pretty = d if len(d) == 4 else f'{d[8:10]}/{d[5:7]}/{d[:4]}'
        rec = {'id': lid, 'name': f'Republic of Ireland Local Authorities {pretty}',
               'slug': lid, 'category': 'local-government', 'featured': False,
               'provider': list(PROVIDER),
               'files': {'fgb': 'https://data.civgraph.net/data/maps/local-government/'
                                f'ROI_Local_Authorities_{d}.fgb'},
               'style': {'color': '#4A148C', 'weight': 2},
               'keywords': ['local authority', 'county council', 'urban district',
                            'rural district', yr, 'republic of ireland', 'historic'],
               'date': d if len(d) > 4 else int(yr),
               'description': f'Local authority areas of the Irish Free State / Republic of '
                              f'Ireland as at {pretty}.'}
        maps.append(rec); by_id[lid] = rec
        created_la.append(lid)

    print(f"cards read            : {len(cards)}")
    print(f"province base records : {len(created_base)} created  {created_base}")
    print(f"ED group records      : {len(created_group)} created, {len(updated_group)} updated")
    print(f"   created: {created_group}")
    print(f"RoI local authorities : {len(created_la)} created  {created_la}")
    print(f"maps.json total       : {len(maps)}")
    if args.check:
        print("\n--check: nothing written"); return
    json.dump(db, open(DB, 'w', encoding='utf-8', newline='\n'),
              ensure_ascii=False, indent=1)
    print(f"\nwrote {DB}")
    print("NEXT: node scripts/build-browse-indexes.mjs")


if __name__ == '__main__':
    main()
