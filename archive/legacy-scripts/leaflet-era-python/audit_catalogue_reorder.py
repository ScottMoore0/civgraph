"""Audit the catalogue reorder. Simulate the rendering logic against
js/ui-controller.js to verify:

  1. Every card in c1Cards is reachable from a tocGroups subheading
     (either via stripped-name match in members[] or via tocMerges).
  2. No member name in tocGroups matches zero cards (orphan members).
  3. Subheading trigger order in c1Cards is monotonic (the first card
     of subheading N appears in c1Cards before the first card of
     subheading N+1, otherwise the visual order won't match members).

Reports issues; exits non-zero if any.
"""
from __future__ import annotations
import re, sys
from pathlib import Path

text = Path('js/ui-controller.js').read_text(encoding='utf-8')


def strip_bracket_parts(s: str) -> str:
    return re.sub(r'\s*\([^)]*\)', '', s).strip()


# Extract c1Cards: list of (id, name) in order
m_c1 = re.search(r'\n        const c1Cards = \[\n(.*?)\n        \];\n', text, re.DOTALL)
c1_body = m_c1.group(1)
cards = []
for m in re.finditer(r"id:\s*'([^']+)',\s*name:\s*'([^']+)'", c1_body):
    cards.append((m.group(1), m.group(2)))
print(f'c1Cards: {len(cards)} cards extracted')

# Extract tocMerges
m_merges = re.search(r'        const tocMerges = \[\n(.*?)\n        \];', text, re.DOTALL)
merges = []
for block in re.finditer(
    r"\{\s*canonicalName:\s*'([^']+)'.*?mergedIds:\s*\[([^\]]+)\].*?(?:inHeading:\s*'([^']+)')?\s*\}",
    m_merges.group(1), re.DOTALL,
):
    canonical = block.group(1)
    ids = re.findall(r"'([^']+)'", block.group(2))
    inheading = block.group(3)
    merges.append({'canonical': canonical, 'mergedIds': ids, 'inHeading': inheading})
print(f'tocMerges: {len(merges)} merges')

# Extract tocGroups
m_groups = re.search(r'        const tocGroups = \[\n(.*?)\n        \];', text, re.DOTALL)
groups = []
for block in re.finditer(
    r"heading:\s*'([^']+)',?\s*members:\s*\[([^\]]+)\]",
    m_groups.group(1), re.DOTALL,
):
    heading = block.group(1)
    members = re.findall(r"'([^']*(?:'(?!\s*[,\]]).*?)?)'", block.group(2))
    # Above regex is fragile; safer parse:
    raw = block.group(2)
    members = []
    in_str = False
    cur = ''
    quote = None
    i = 0
    while i < len(raw):
        ch = raw[i]
        if not in_str and ch in "'\"":
            in_str = True; quote = ch; cur = ''
        elif in_str and ch == quote and (i + 1 >= len(raw) or raw[i + 1] != quote):
            in_str = False; members.append(cur)
        elif in_str:
            cur += ch
        i += 1
    groups.append({'heading': heading, 'members': members})
print(f'tocGroups: {len(groups)} subheadings')
total_members = sum(len(g['members']) for g in groups)
print(f'  total member slots: {total_members}')

# Build lookup tables
group_by_member = {}  # member_name -> heading
for g in groups:
    for mname in g['members']:
        group_by_member.setdefault(mname, g['heading'])
heading_set = {g['heading'] for g in groups}

# For each card determine its routing
issues = []
heading_first_card = {}  # heading -> index in c1Cards of first card that triggers it
for idx, (cid, name) in enumerate(cards):
    stripped = strip_bracket_parts(name)
    # Heading-scoped merge first
    merge = next((m for m in merges if m['inHeading'] and cid in m['mergedIds']), None)
    if merge:
        heading = merge['inHeading']
        if heading not in heading_set:
            issues.append(f'card {cid} via merge points to unknown heading {heading!r}')
            continue
    else:
        heading = group_by_member.get(stripped)
        if heading is None:
            issues.append(
                f'STANDALONE: card {cid} (name {name!r}, stripped {stripped!r}) '
                f'matches no member in any subheading'
            )
            continue
    if heading not in heading_first_card:
        heading_first_card[heading] = idx

# Check all groups have at least one trigger
for g in groups:
    if g['heading'] not in heading_first_card:
        issues.append(
            f'EMPTY HEADING: {g["heading"]!r} has no trigger card in c1Cards '
            f'(members: {g["members"][:3]}...)'
        )

# Check ordering of headings matches groups[] order
heading_order = [h for h in [g['heading'] for g in groups] if h in heading_first_card]
trigger_indices = [heading_first_card[h] for h in heading_order]
if trigger_indices != sorted(trigger_indices):
    issues.append(
        f'OUT-OF-ORDER triggers: '
        f'{list(zip(heading_order, trigger_indices))}'
    )

# Check each member name resolves to at least one card
cards_by_stripped = {}
for cid, name in cards:
    cards_by_stripped.setdefault(strip_bracket_parts(name), []).append(cid)
merge_canonicals_by_heading = {f"{m['inHeading']}::{m['canonical']}": m for m in merges if m['inHeading']}
for g in groups:
    for mname in g['members']:
        # Is it a heading-scoped merge canonical?
        if f"{g['heading']}::{mname}" in merge_canonicals_by_heading:
            continue
        if mname not in cards_by_stripped:
            issues.append(
                f'ORPHAN MEMBER: heading {g["heading"]!r} member {mname!r} '
                f'has no card with that stripped name'
            )

print()
if issues:
    print(f'FAIL: {len(issues)} issue(s):')
    for x in issues: print(f'  - {x}')
    sys.exit(1)
print('OK: all checks pass')
print(f'  - all {len(cards)} cards routed to a subheading')
print(f'  - subheading trigger order matches tocGroups order')
print(f'  - every member name resolves to a card or heading-scoped merge')
