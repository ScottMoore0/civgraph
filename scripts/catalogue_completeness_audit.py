"""
Audit which maps in maps.json are not reachable from any flat-card or class
definition in js/ui-controller.js.

Outputs a table of:
  - All map IDs in maps.json
  - Whether each is reachable via flat-card mapIds[] or via classIds[] expansion
  - Whether the map is hidden (intentionally invisible)
  - Final verdict: "in catalogue" vs "missing from catalogue"
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS_JSON = ROOT / 'data' / 'database' / 'maps.json'
UI_JS = ROOT / 'js' / 'ui-controller.js'

with MAPS_JSON.open(encoding='utf-8') as f:
    db = json.load(f)

# Build map-id index (top-level + variants)
maps_by_id = {}
variant_parent = {}
for m in db.get('maps', []):
    maps_by_id[m['id']] = m
    for v in (m.get('variants') or []):
        # Variants take their own id; record relation to parent
        if v.get('id'):
            maps_by_id[v['id']] = {**v, 'variantOf': m['id']}
            variant_parent[v['id']] = m['id']

# Build class membership index
classes_by_id = {c['id']: c for c in db.get('classes', [])}
class_member_of = {}  # mapId -> [classIds]
for cid, c in classes_by_id.items():
    for mid in (c.get('maps') or []):
        class_member_of.setdefault(mid, []).append(cid)

# Parse js/ui-controller.js for the c1Cards array. We extract every
# 'classIds: [...]' and 'mapIds: [...]' literal.
ui_text = UI_JS.read_text(encoding='utf-8')

# Find the c1Cards block
m = re.search(r'const c1Cards = \[(.*?)\n\s*\];', ui_text, re.S)
if not m:
    raise SystemExit('Failed to locate c1Cards array in ui-controller.js')
block = m.group(1)

# Match every classIds: [ ... ] and mapIds: [ ... ]
flat_class_ids = set()
for arr in re.findall(r"classIds:\s*\[([^\]]*)\]", block):
    for tok in re.findall(r"'([^']+)'", arr):
        flat_class_ids.add(tok)

flat_map_ids = set()
for arr in re.findall(r"mapIds:\s*\[([^\]]*)\]", block):
    for tok in re.findall(r"'([^']+)'", arr):
        flat_map_ids.add(tok)

# Also pick up `members:` arrays inside tocGroups (TOC-only references; not
# strictly cards but they're how the c1Cards get grouped). Not needed for
# this audit since they reference card stripped names, not map ids.

# Resolve which map ids are reachable via classIds
reached_via_class = set()
for cid in flat_class_ids:
    cls = classes_by_id.get(cid)
    if not cls:
        continue
    for mid in (cls.get('maps') or []):
        reached_via_class.add(mid)

reached = flat_map_ids | reached_via_class

# Some flat-cards refer to a parent group whose variants are exposed in the
# variant menu — count parents as covering their variants.
for parent_id in list(reached):
    parent = maps_by_id.get(parent_id)
    if parent and isinstance(parent.get('variants'), list):
        for v in parent['variants']:
            if v.get('id'):
                reached.add(v['id'])
    if parent and isinstance(parent.get('members'), list):
        for sub in parent['members']:
            reached.add(sub)

# A map referenced as `cloneOf` of a reached map should also be reachable
# (clones share content; the parent flat-card covers them).
def expand_clones(seed):
    out = set(seed)
    changed = True
    while changed:
        changed = False
        for m in db['maps']:
            if m.get('cloneOf') in out and m['id'] not in out:
                out.add(m['id']); changed = True
    return out

reached = expand_clones(reached)

# Now classify
all_map_ids = set(maps_by_id.keys())
missing = sorted(all_map_ids - reached)

# Bucket missing by hidden vs visible
visible_missing = []
hidden_missing = []
variant_missing = []
data_entries_referenced_via_class = set()

for mid in missing:
    mp = maps_by_id[mid]
    is_hidden = bool(mp.get('hidden'))
    is_variant = mid in variant_parent
    if is_variant:
        variant_missing.append((mid, variant_parent[mid], is_hidden))
    elif is_hidden:
        hidden_missing.append(mid)
    else:
        visible_missing.append(mid)

# Data entries (joined-CSV catalogue items) live in a separate top-level
# `dataEntries` array; check those too.
data_entry_missing = []
for de in db.get('dataEntries', []):
    if de['id'] not in reached:
        # Some data entries are referenced by `data-...` flat-cards via
        # mapIds. Those are caught by reached.
        data_entry_missing.append(de['id'])

# Print report
print(f'TOTAL maps in maps.json:        {len(all_map_ids)}')
print(f'  visible (not hidden):         {sum(1 for m in maps_by_id.values() if not m.get("hidden"))}')
print(f'  hidden:                       {sum(1 for m in maps_by_id.values() if m.get("hidden"))}')
print(f'TOTAL referenced by catalogue:  {len(reached)}')
print(f'TOTAL missing from catalogue:   {len(missing)}')
print()
print(f'  visible-and-missing:          {len(visible_missing)}')
print(f'  hidden-and-missing:           {len(hidden_missing)}')
print(f'  variants-missing:             {len(variant_missing)}')
print()
print(f'TOTAL dataEntries:              {len(db.get("dataEntries", []))}')
print(f'  dataEntries missing:          {len(data_entry_missing)}')
print()
print('=' * 70)
print('VISIBLE MAPS NOT IN CATALOGUE (these are the actionable gaps):')
print('=' * 70)
if not visible_missing:
    print('  (none — every visible map is reachable from a flat-card)')
else:
    for mid in visible_missing:
        mp = maps_by_id[mid]
        print(f'  {mid:55s} | category={mp.get("category","-"):15s} | name={mp.get("name","")}')

print()
print('=' * 70)
print(f'VARIANTS NOT IN CATALOGUE ({len(variant_missing)}):')
print('=' * 70)
print('Variants are normally reachable through their parent\'s variant menu.')
print('Listed here are variants whose parent isn\'t referenced by any card:')
print()
unreferenced_parents = set()
for mid, parent, hidden in variant_missing:
    if parent not in reached:
        unreferenced_parents.add(parent)
        print(f'  {mid:55s} (parent {parent!r} not in any flat-card)')
if not unreferenced_parents:
    print('  (none — variants are missing only because their parent doesn\'t expose them, but the parent IS in the catalogue)')

print()
print('=' * 70)
print(f'HIDDEN MAPS NOT IN CATALOGUE ({len(hidden_missing)}):')
print('=' * 70)
print('These are intentionally invisible (used as data sources for derived')
print('layers, or kept for URL backwards-compat). First 20:')
for mid in hidden_missing[:20]:
    print(f'  {mid}')
if len(hidden_missing) > 20:
    print(f'  ... and {len(hidden_missing) - 20} more')

print()
print('=' * 70)
print('DATA ENTRIES NOT IN CATALOGUE:')
print('=' * 70)
if data_entry_missing:
    for de_id in data_entry_missing:
        print(f'  {de_id}')
else:
    print('  (none)')
