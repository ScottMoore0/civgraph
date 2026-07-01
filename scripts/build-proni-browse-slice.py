#!/usr/bin/env python3
"""Build a hierarchical PRONI Record browse slice for the Civgraph Browse SPA.

Streams the full detail JSONL, keeps one fond (default BG), and emits:
  data/browse/proni.json                         -- index (entry-point fonds)
  data/browse/details/proni/<slug>.json          -- one shard per CONTAINER node

Leaf Items carry their full detail inside their parent container's `children`
array, so only container nodes get their own file. Slug = reference with '/'->'~'.
"""
import sys, os, json, argparse

FOND_TITLES = {'BG': 'Boards of Guardians (Poor Law Union records)',
               'DIO': 'Diocesan and church records'}

def slugify(ref):
    return ref.replace('/', '~')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='records-details.jsonl')
    ap.add_argument('--out', required=True, help='repo data/browse dir')
    ap.add_argument('--fond', default='BG', help='top-level fond prefix to extract')
    args = ap.parse_args()

    fond = args.fond
    want_prefix = fond + '/'
    records = {}   # ref -> record
    kept = 0
    with open(args.src, encoding='utf-8') as f:
        for line in f:
            if fond not in line:      # cheap prefilter before JSON parse
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            ref = d.get('proniReference') or d.get('extractedRef') or ''
            path = d.get('path') or []
            top = path[0] if path else ref.split('/')[0]
            if top != fond:
                continue
            records[ref] = {
                'ref': ref,
                'slug': slugify(ref),
                'level': d.get('level', ''),
                'title': d.get('title', '') or ref,
                'dates': d.get('dates', ''),
                'description': d.get('description', ''),
                'access': d.get('access', ''),
                'digitalRecord': d.get('digitalRecord', ''),
                'repository': d.get('repository', ''),
                'path': list(path),
            }
            kept += 1
    print(f'kept {kept:,} records for fond {fond}')

    # Build the tree from each record's authoritative `path` chain: path[0] is a
    # root; path[i] is a child of path[i-1]; the record itself is a child of
    # path[-1]. This links container->container as well as record->container, so
    # intermediate nodes are parented rather than each appearing as a root.
    children = {}   # parent ref -> set of child refs
    roots = set()
    for ref, r in records.items():
        p = r['path']
        if p:
            roots.add(p[0])
            for i in range(1, len(p)):
                children.setdefault(p[i - 1], set()).add(p[i])
            children.setdefault(p[-1], set()).add(ref)
        else:
            roots.add(ref)
    children = {k: sorted(v) for k, v in children.items()}
    roots = sorted(roots)
    synthetic = sum(1 for k in children if k not in records)
    print(f'containers: {len(children):,} (synthetic/unscraped: {synthetic:,}); roots: {roots}')
    # Some ancestors referenced in paths may not be their own records; treat any
    # ref that appears as a parent key as a container.
    def has_children(ref):
        return ref in children and len(children[ref]) > 0

    def ancestry(r):
        """List of {ref,slug,title} for each ancestor in path order."""
        out = []
        for anc in r['path']:
            arec = records.get(anc)
            out.append({'ref': anc, 'slug': slugify(anc),
                        'title': (arec['title'] if arec else anc)})
        return out

    def child_entry(cref):
        c = records.get(cref)
        if c is None:
            return {'ref': cref, 'slug': slugify(cref), 'title': cref,
                    'level': '', 'dates': '', 'hasChildren': has_children(cref),
                    'description': '', 'access': '', 'digitalRecord': ''}
        return {
            'ref': c['ref'], 'slug': c['slug'], 'title': c['title'],
            'level': c['level'], 'dates': c['dates'],
            'hasChildren': has_children(cref),
            'description': c['description'], 'access': c['access'],
            'digitalRecord': c['digitalRecord'],
        }

    details_dir = os.path.join(args.out, 'details', 'proni')
    os.makedirs(details_dir, exist_ok=True)

    # sort children naturally by numeric tail where possible
    def sort_key(ref):
        tail = ref.split('/')[-1]
        return (0, int(tail)) if tail.isdigit() else (1, tail)

    container_count = 0
    for ref, kids in children.items():
        r = records.get(ref)
        if r is None:
            # synthetic container (ancestor without its own scraped record)
            r = {'ref': ref, 'slug': slugify(ref),
                 'level': ('Fond' if '/' not in ref else ''),
                 'title': FOND_TITLES.get(ref, ref),
                 'dates': '', 'description': '', 'access': '',
                 'digitalRecord': '', 'repository': '', 'path': ref.split('/')[:-1]}
        p = r['path']
        parent = p[-1] if p else None
        prec = records.get(parent) if parent else None
        kids_sorted = sorted(kids, key=sort_key)
        shard = {'item': {
            'ref': r['ref'], 'slug': r['slug'], 'level': r['level'],
            'title': r['title'], 'dates': r['dates'],
            'description': r['description'], 'access': r['access'],
            'digitalRecord': r['digitalRecord'], 'repository': r['repository'],
            'path': ancestry(r),
            'parent': ({'ref': parent, 'slug': slugify(parent),
                        'title': (prec['title'] if prec else parent)} if parent else None),
            'hasChildren': True, 'childCount': len(kids_sorted),
            'children': [child_entry(c) for c in kids_sorted],
        }}
        with open(os.path.join(details_dir, r['slug'] + '.json'), 'w', encoding='utf-8') as fo:
            json.dump(shard, fo, ensure_ascii=False, separators=(',', ':'))
        container_count += 1
    print(f'wrote {container_count:,} container shards -> {details_dir}')

    # Index = entry-point fonds (roots). For a single-fond slice, that is the fond.
    index_items = []
    for ref in sorted(roots, key=sort_key):
        r = records.get(ref)
        title = (r['title'] if r and r['title'] != ref else None) or FOND_TITLES.get(ref, ref)
        level = (r['level'] if r else '') or 'Fond'
        index_items.append({
            'id': ref, 'slug': slugify(ref), 'type': 'proni',
            'title': title, 'level': level, 'dates': (r['dates'] if r else ''),
            'subtitle': level, 'description': (r['description'] if r else ''),
            'childCount': len(children.get(ref, [])),
        })
    index = {'schemaVersion': 1, 'source': 'PRONI eCatalogue (snapshot 2026-06-30)',
             'licence': 'Open Government Licence', 'fond': fond,
             'total': len(index_items), 'recordCount': kept, 'items': index_items}
    with open(os.path.join(args.out, 'proni.json'), 'w', encoding='utf-8') as fo:
        json.dump(index, fo, ensure_ascii=False, indent=2)
    print(f'wrote index proni.json with {len(index_items)} entry fond(s), recordCount={kept:,}')

if __name__ == '__main__':
    main()
