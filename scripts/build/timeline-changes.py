#!/usr/bin/env python3
"""
Boundary changes between consecutive editions of every timeline series.

WHY THIS EXISTS

The timeline slider swaps one edition for the next. A reviewer (Phelim, 2026-11-01) loaded
Counties of Ireland 1927 and 1955, dragged the slider and saw nothing change: the colours stay
the same, a change of a few townlands is invisible at island zoom, and nothing is highlighted.
The older "transition overlays" (data/timeline-transition-overlays/) cover 14 of the chains,
only work in Play mode, and for Counties hold every one of 3,787 overlay pieces typed "split",
which would paint the whole island.

This builds, for each pair of consecutive editions the slider can step between:

  * transferred areas -- land whose containing unit changed, new and abolished units, renames;
  * added and removed boundary lines next to those areas;
  * a summary: how many changes, and whether the pair is "changes", "redrawn" (the editions
    come from different sources and differ only by digitising) or "none" (same geometry).

SEPARATING REAL CHANGES FROM REDRAWING

Two editions digitised from different sources differ along every line by tens to hundreds of
metres. Those differences are long and thin; a real transfer (a townland, a DED, a strip of
river bank moved between counties) is compact. So each candidate piece is cleaned by a
morphological opening (shrink by OPEN_RADIUS_M, grow back by the same): anything narrower than
twice the radius disappears, a compact piece survives almost whole. What survives must still
be at least MIN_AREA_HA and have a mean width (2 * area / perimeter) of at least
MIN_MEAN_WIDTH_M. Pieces where the old and new unit have the same (normalised, fuzzy) name are
never changes. Thresholds are calibrated in the notes at the foot of this file.

OUTPUT

  data/timeline-changes/manifest.json            one entry per pair: id, from/to map ids,
                                                 kind, count, text, path, input signature
  data/timeline-changes/<from>__<to>.json        a GeoJSON FeatureCollection: the change
                                                 areas (Polygon/MultiPolygon, role "area"),
                                                 added/removed lines (role "added"/"removed")
                                                 and, in `changes`, the list the UI shows
                                                 (type, from, to, hectares, bbox, label point)

Coordinates are WGS84, rounded to 5 decimals (about a metre) and simplified to 15 m, so a pair
file is KBs to a few hundred KB. The files are small enough for Cloudflare Pages.

Usage:
  python scripts/build/timeline-changes.py                 # rebuild pairs whose inputs changed
  python scripts/build/timeline-changes.py --force         # rebuild every pair
  python scripts/build/timeline-changes.py --only counties # pairs whose id contains the text
                                                           # (several, comma-separated: any of them)
  python scripts/build/timeline-changes.py --list          # print the pairs, compute nothing
  python scripts/build/timeline-changes.py --force --sources-from ../boundaries-website
                                                           # in a worktree: read the (untracked)
                                                           # source files from another checkout
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = ROOT / 'data' / 'database' / 'maps.json'
LAYERS = ROOT / 'render' / 'metadata' / 'maps-test.json'
OUT_DIR = ROOT / 'data' / 'timeline-changes'
# Where the source FlatGeobufs are read from. They are not tracked, so a worktree has none; a run
# there passes --sources-from <main checkout> (read only) and writes its output here.
SOURCE_ROOT = Path(os.environ.get('CIVGRAPH_TIMELINE_SOURCES') or ROOT).resolve()
BUILDER_VERSION = 10

METRIC_CRS = 'EPSG:2157'       # Irish Transverse Mercator: metres, island-wide
OPEN_RADIUS_M = 60.0           # opening removes anything narrower than 120 m
MIN_AREA_HA = 4.0              # smallest change kept (a small townland)
MIN_MEAN_WIDTH_M = 120.0       # 2 * area / perimeter of what survives the opening
LINE_TOLERANCE_M = 80.0        # a line within this of the other edition's lines is "the same line"
MIN_LINE_M = 150.0             # shortest added/removed line piece kept
RENAME_MIN_SHARE = 0.6         # a rename needs the old and new unit to share 60% of each
ID_RENAME_MIN_SHARE = 0.25     # ... or the same stable id and 25% of the smaller of the two
STABLE_ID_AGREEMENT = 0.9      # an id column is stable when 90% of the units that carry on keep it
REDRAWN_MAX_SHIFT_M = 15.0     # mean boundary shift above which two editions are "redrawn"
SIMPLIFY_M = 15.0
MAX_CHANGES_LISTED = 400
REORGANISATION_SHARE = 0.5     # changes covering half the compared area: draw lines, not areas

DISTINGUISHING_WORDS = {
    'north', 'south', 'east', 'west', 'central', 'mid', 'upper', 'lower', 'urban', 'rural', 'inner',
    'outer', 'great', 'little', 'new', 'old', 'i', 'ii', 'iii', 'iv', 'v', 'a', 'b', 'c', 'd',
    # A city and the county around it are different bodies, however alike their names ("Cork
    # County Council" / "Cork City Council" are 86% alike: the 2019 Cork City extension went
    # unreported. Phelim Birch, 26 Nov 2026).
    'city', 'county', 'borough', 'town'
}
NAME_FIELD_HINTS = (
    'name', 'english', 'county', 'ded_name', 'ed_english', 'ward', 'ward_name', 'lgd', 'lgd_name',
    'pc_name', 'constituency', 'cons_name', 'union_printed', 'union', 'plu', 'label', 'nm'
)


# ----------------------------------------------------------------------------------------------
# Which editions the slider steps between
# ----------------------------------------------------------------------------------------------

def parse_map_date(value):
    """The same reading as dataService.parseMapDate: a year is 1 January of it."""
    if value is None or value == '':
        return None
    text = str(value).strip()
    if re.fullmatch(r'\d{4}', text):
        return f'{text}-01-01'
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        return text
    return None


def is_placeholder(entry):
    keywords = [str(k).strip().lower() for k in (entry.get('keywords') or [])]
    status = str(entry.get('status') or '').lower()
    thumb = entry.get('thumbnail') if isinstance(entry.get('thumbnail'), dict) else {}
    return bool(entry.get('placeholder') or thumb.get('kind') == 'placeholder'
                or 'placeholder' in keywords or 'to-be-added' in keywords or 'to be added' in keywords
                or 'to be added' in status)


def local_mirror(url):
    """data.civgraph.net/data/maps/... is mirrored at data/maps/... in the working tree."""
    if not url or not isinstance(url, str):
        return None
    match = re.match(r'^https?://data\.civgraph\.net/(data/.+)$', url)
    return match.group(1) if match else (url if not url.startswith('http') else None)


def child_ids(entry):
    variants = entry.get('variants')
    if isinstance(variants, list) and variants:
        ids = [v if isinstance(v, str) else (v or {}).get('id') for v in variants]
        return [i for i in ids if i]
    for key in ('members', 'compositeSources'):
        if isinstance(entry.get(key), list) and entry[key]:
            return [i for i in entry[key] if i]
    return []


class Catalogue:
    def __init__(self):
        cat = json.loads(CATALOGUE.read_text(encoding='utf-8'))
        meta = json.loads(LAYERS.read_text(encoding='utf-8'))
        self.maps = {m['id']: m for m in cat.get('maps', []) if m.get('id')}
        self.classes = {c['id']: c for c in cat.get('classes', []) if c.get('id')}
        self.chains = cat.get('timeSeriesChains', [])
        self.layers = [l for l in meta.get('layers', []) if l.get('sourceType') != 'unconverted']
        # A group map's variants are records of their own (id, files, cloneOf) inside it.
        self.variants = {}
        for m in self.maps.values():
            for v in m.get('variants') or []:
                if isinstance(v, dict) and v.get('id') and v['id'] not in self.maps:
                    self.variants[v['id']] = v
        self.layer_lookup = {}
        for layer in self.layers:
            for key in (layer.get('id'), layer.get('sourceMapId')):
                if key and key not in self.layer_lookup:
                    self.layer_lookup[key] = layer

    def resolve_layer(self, map_id):
        """resolveLayer() in maplibre-main-adapter.js."""
        direct = self.layer_lookup.get(map_id)
        if direct:
            return direct
        for key in ('sourceMapId', 'parentId'):
            for layer in self.layers:
                if layer.get(key) == map_id:
                    return layer
        return None

    def sources_for_map(self, map_id, depth=0):
        """The local FlatGeobuf files that draw a map, as the app loads it: its own layer, else
        every child layer of a group map. Empty when none is held locally."""
        if depth > 3:
            return []
        entry = self.maps.get(map_id) or self.variants.get(map_id) or {}
        layer = self.resolve_layer(map_id)
        label = (layer or {}).get('labelProperty') or entry.get('labelProperty')
        if layer and layer.get('geometryType') not in ('polygon', 'multipolygon', None):
            return []
        candidates = []
        if layer:
            candidates += [layer.get('sourceFile'), (layer.get('generatedFrom') or {}).get('sourceFile')]
        for record in (entry, self.maps.get(entry.get('cloneOf') or '') or self.variants.get(entry.get('cloneOf') or '') or {}):
            files = record.get('files') if isinstance(record.get('files'), dict) else {}
            candidates.append(local_mirror(files.get('fgb')))
        for rel in candidates:
            if not rel:
                continue
            path = SOURCE_ROOT / rel
            if path.suffix.lower() in ('.fgb', '.geojson', '.gpkg') and path.exists():
                return [(rel.replace('\\', '/'), label)]
        out = []
        for cid in child_ids(entry):
            out.extend(self.sources_for_map(cid, depth + 1))
        return out

    def playable(self, map_id):
        entry = self.maps.get(map_id)
        if not entry or is_placeholder(entry):
            return False
        if self.resolve_layer(map_id):
            return True
        return any(self.resolve_layer(cid) for cid in child_ids(entry))

    def chain_class_ids(self, chain):
        ids = []
        for seg in chain.get('segments') or []:
            ids.extend(seg.get('classIds') or [])
        ids.extend(chain.get('classIds') or [])
        for col in chain.get('columns') or []:
            ids.extend(col.get('classIds') or [])
        ids.extend((chain.get('predecessor') or {}).get('classIds') or [])
        return ids

    def sequences(self):
        """Each chain's slider order, column by column for a parallel chain, as the app builds
        it: one map per date (the first in class order wins a tie), placeholders and maps
        without a loadable layer left out."""
        out = []
        for chain in self.chains:
            if chain.get('parallel') and chain.get('segments'):
                pred = (chain.get('predecessor') or {}).get('classIds') or []
                columns = [(seg.get('column') or ','.join(seg.get('classIds') or []), (seg.get('classIds') or []) + pred)
                           for seg in chain['segments']]
            else:
                columns = [('', self.chain_class_ids(chain))]
            for column, class_ids in columns:
                by_date = {}
                order = 0
                for cid in class_ids:
                    for mid in (self.classes.get(cid) or {}).get('maps') or []:
                        entry = self.maps.get(mid)
                        date = parse_map_date(entry.get('date')) if entry else None
                        if not date:
                            continue
                        order += 1
                        if date not in by_date:
                            by_date[date] = (order, mid, cid)
                maps = [(d, mid, cid) for d, (_, mid, cid) in sorted(by_date.items())]
                maps = [m for m in maps if self.playable(m[1])]
                out.append({'chainId': chain['id'], 'column': column, 'maps': maps})
        return out

    def pairs(self):
        seen = {}
        for seq in self.sequences():
            items = seq['maps']
            for (d1, a, ca), (d2, b, cb) in zip(items, items[1:]):
                pid = f'{a}__{b}'
                if pid in seen:
                    continue
                seen[pid] = {
                    'id': pid, 'chainId': seq['chainId'], 'column': seq['column'] or None,
                    'fromMapId': a, 'toMapId': b, 'fromDate': d1, 'toDate': d2,
                    'fromClassId': ca, 'toClassId': cb,
                    'fromName': (self.maps.get(a) or {}).get('name'),
                    'toName': (self.maps.get(b) or {}).get('name'),
                    'fromSources': self.sources_for_map(a), 'toSources': self.sources_for_map(b),
                    'changeNote': (self.maps.get(b) or {}).get('changeNote') or None,
                }
        return list(seen.values())


# ----------------------------------------------------------------------------------------------
# Geometry
# ----------------------------------------------------------------------------------------------

def norm_name(value):
    text = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode().lower()
    text = text.replace('&', ' and ')
    text = re.sub(r"\b(the|of|ward|ded|ed|electoral division|no)\b\.?", ' ', text)
    text = re.sub(r'[^a-z0-9]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def same_name(a, b):
    """Two spellings of one unit's name. Different sources spell names differently
    ("LAOIGHIS" / "Laoighis", "Derry" / "Londonderry", "Kilmore No. 1" / "Kilmore 1")."""
    # A bilingual "Doire Ianna/Cloon" matches either of its names.
    alts_a = [x for x in re.split(r'\s*/\s*', str(a or '')) if x.strip()]
    alts_b = [x for x in re.split(r'\s*/\s*', str(b or '')) if x.strip()]
    if len(alts_a) > 1 or len(alts_b) > 1:
        return any(_same_name(x, y) for x in alts_a for y in alts_b)
    return _same_name(a, b)


def _same_name(a, b):
    a, b = norm_name(a), norm_name(b)
    if not a or not b:
        return False
    if a == b or a.replace(' ', '') == b.replace(' ', ''):
        return True
    # "Portstewart" -> "Portstewart Urban" + "Portstewart Rural", "Kilmore 1" / "Kilmore 2",
    # "Ballymena North" / "Ballymena South" are different units, however alike the spelling.
    words_a, words_b = set(a.split()), set(b.split())
    if (words_a ^ words_b) & DISTINGUISHING_WORDS:
        return False
    if re.findall(r'\d+', a) != re.findall(r'\d+', b):
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.86


def clean_label(value):
    """A label as shown: whitespace collapsed and trimmed (dail-2013 had "Cavan-Monaghan (4)\n")."""
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def is_code(value):
    """A label that is a code, not a name: 95PP030006, N00002929, 95NN22W1."""
    text = clean_label(value)
    return bool(text) and ' ' not in text and sum(ch.isdigit() for ch in text) >= 3 and not re.search(r'[a-z]{3}', text)


SEATS_RE = re.compile(r'\s*\(\s*\d+\s*\)\s*$')
PAREN_RE = re.compile(r'\(([^)]*)\)')
# A word for the kind of unit, which one source writes and another leaves out ("Co. Antrim" /
# "Antrim", "Omagh Rural District" / "OMAGH"). Only when one side has none: "Bangor Urban
# District" -> "Bangor Municipal Borough" is a real change of status.
TYPE_PHRASES = ('county borough', 'municipal borough', 'urban district', 'rural district', 'borough', 'district', 'county', 'co')
COMPASS = {'n': 'north', 's': 'south', 'e': 'east', 'w': 'west',
           'ne': 'north east', 'nw': 'north west', 'se': 'south east', 'sw': 'south west'}
QUALIFIERS = ('urban', 'rural')


def _strip_type(name):
    for phrase in TYPE_PHRASES:
        if name.startswith(phrase + ' '):
            return name[len(phrase) + 1:], True
        if name.endswith(' ' + phrase):
            return name[:-len(phrase) - 1], True
    return name, False


def _expand_compass(name):
    words, used = [], False
    for word in name.split():
        if word in COMPASS:
            words.extend(COMPASS[word].split())
            used = True
        else:
            words.append(word)
    return sorted(words), used


def _abbreviates(names):
    """Whether an edition writes its names with compass abbreviations ("Mayo N", "Cork SE")."""
    return any(name.rsplit(' ', 1)[-1] in COMPASS for name in names if ' ' in name)


def _without(name, word):
    return ' '.join(w for w in name.split() if w != word)


def _qualifier_split(q_name, q, u_name, q_names, u_names):
    """'X' in one edition and 'X Urban' (or Rural) in the other. A real change when the unit was
    divided: the qualified edition also has 'X Rural' (Urban) and the other edition has no
    qualified X at all (Buncrana -> Buncrana Rural + Buncrana Urban, 1912 to 1914). Otherwise the
    sources only label it differently (SLIGO WEST URBAN / SLIGO WEST)."""
    base = _without(q_name, q)
    other = 'rural' if q == 'urban' else 'urban'
    sibling = any(other in n.split() and _without(n, other) == base for n in q_names)
    qualified_there = any(set(n.split()) & set(QUALIFIERS) and _without(_without(n, 'urban'), 'rural') == u_name
                          for n in u_names)
    return sibling and not qualified_there


def rename_verdict(na, nb, alts_a=(), alts_b=(), names_a=frozenset(), names_b=frozenset(), same_field=False):
    """Is old name `na` -> new name `nb` a rename? 'same' (one name), 'renamed', or the reason it
    is only the two editions labelling one unit differently:

      code              a label is a code (output areas recoded as small areas; small areas
                        labelled by code in 2011 and by name in 2022): a code is not a name
      seats             a seat count in brackets: "Mayo" / "Mayo (4)", "Kildare South (3)" / "(4)"
      parenthetical     a note in brackets: "ATHLONE EAST URBAN (ST. MARY'S)", "St. MARY'S (PART)",
                        "NORTH EAST" / "CORK No. 3 URBAN (NORTH EAST WARD)"
      type word         a unit-type word on one side only: "Co. Antrim" / "Antrim"
      abbreviation      "North Mayo" / "Mayo N", and "Mid Cork" / "Cork Mid" in an edition that
                        abbreviates (word order alone is otherwise a rename: South Kerry ->
                        Kerry South was the 1980 Act's own renaming)
      qualifier         "SLIGO WEST URBAN" / "SLIGO WEST" (see _qualifier_split)
      numbered part     "AGHAGALLON" / "Aghagallon_2" beside "Aghagallon_1", "GLASNEVIN" /
                        "GLASNEVIN A" beside "GLASNEVIN B": a unit divided into numbered or
                        lettered parts (the other part is listed as formed from it); and
                        "CENTRAL" / "Central_Ards": a name qualified after underscores
      other name field  the editions label from different fields, and the new unit carries the
                        old name in another name field, or the old the new (an Irish name in one
                        edition, the English in the next). Not when both label from one field:
                        Edgeworthstown -> Meathas Truim (ENGLISH in both, 1950 to 1953) is a
                        rename, though the 1950 unit's GAEILGE field already reads Meathas Troim.

    `alts_*` are the units' other name fields, `names_*` every normalised name in each edition,
    `same_field` whether both editions take the label from one field.
    Case, spacing, accents and punctuation never count (norm_name)."""
    if same_name(na, nb):
        return 'same'
    if not norm_name(na) or not norm_name(nb):
        return 'same'
    if is_code(na) or is_code(nb):
        return 'code'
    ca, cb = clean_label(na), clean_label(nb)
    sa, sb = SEATS_RE.sub('', ca), SEATS_RE.sub('', cb)
    if (sa != ca or sb != cb) and same_name(sa, sb):
        return 'seats'
    inner_a = [i for i in PAREN_RE.findall(sa) if i.strip()]
    inner_b = [i for i in PAREN_RE.findall(sb) if i.strip()]
    outer_a, outer_b = PAREN_RE.sub(' ', sa), PAREN_RE.sub(' ', sb)
    if (inner_a or inner_b) and (same_name(outer_a, outer_b) or any(same_name(i, outer_b) for i in inner_a)
                                 or any(same_name(outer_a, i) for i in inner_b)):
        return 'parenthetical'
    a, b = norm_name(outer_a), norm_name(outer_b)
    ta, typed_a = _strip_type(a)
    tb, typed_b = _strip_type(b)
    if typed_a != typed_b and ta and tb and same_name(ta, tb):
        return 'type word'
    wa, abbr_a = _expand_compass(a)
    wb, abbr_b = _expand_compass(b)
    # The same words in another order are a rename (South Kerry -> Kerry South, 1980), unless one
    # side abbreviates, or its edition writes every name the abbreviated way ("Cork Mid" beside
    # "Mayo N" in the 1918 constituencies).
    if wa == wb and (abbr_a != abbr_b or _abbreviates(names_a) or _abbreviates(names_b)):
        return 'abbreviation'
    qa = [w for w in a.split() if w in QUALIFIERS]
    qb = [w for w in b.split() if w in QUALIFIERS]
    if bool(qa) != bool(qb):
        q_name, u_name, q_names, u_names, q = (a, b, names_a, names_b, qa[0]) if qa else (b, a, names_b, names_a, qb[0])
        if same_name(_without(q_name, q), u_name) and not _qualifier_split(q_name, q, u_name, q_names, u_names):
            return 'qualifier'
    for long_name, short_name, long_names in ((a, b, names_a), (b, a, names_b)):
        m = re.fullmatch(r'(.+) (\d+|[a-d])', long_name)
        if m and m.group(1) == short_name and not re.search(r'\d', short_name):
            if any(n != long_name and re.fullmatch(re.escape(m.group(1)) + r' (\d+|[a-d])', n) for n in long_names):
                return 'numbered part'
    # "Central_Ards", "Bloomfield_1_NorthDown": a name with a qualifier joined by underscores,
    # which keeps apart the wards of one name in different districts (the 2011 SOAs).
    for joined, other in ((ca, cb), (cb, ca)):
        if '_' in joined and '_' not in other and same_name(joined.split('_')[0], other):
            return 'numbered part'
    if not same_field and (any(same_name(na, v) for v in alts_b) or any(same_name(nb, v) for v in alts_a)):
        return 'other name field'
    return 'renamed'


# Other fields that hold the unit's own name (an Irish name beside the English). Not a parent
# unit's (county, province, LGD) and not a former name.
ALT_NAME_HINTS = ('name', 'english', 'gaeilge', 'irish', 'ainm', 'label', '_ga')
NOT_ALT_NAME = ('county', 'contae', 'province', 'cuige', 'nuts', 'lgd', 'parent', 'old', 'former', 'prev', 'hist')
# Fields that are measures, positions or row numbers, never a unit's id.
NOT_ID = re.compile(r'area|elev|centroid|coord|^x_|^y_|_x$|_y$|perim|shape|popul|elector|member|count|acre|hect|len'
                    r'|sqkm|sq_km|edition|date|year|^fid$|^ogc_fid$|^civ_fid$|^objectid|^esri_oid$|^id$|^gid$|^uid$', re.I)


def is_alt_name_column(column):
    c = column.lower()
    return any(h in c for h in ALT_NAME_HINTS) and not any(x in c for x in NOT_ALT_NAME)


def code_value(value):
    """A field value as an id: whole numbers without leading zeros ('067141' and 67141 agree),
    text trimmed and in capitals; None for an empty, missing or fractional value."""
    if value is None or isinstance(value, bool):
        return None
    if hasattr(value, 'item') and not isinstance(value, (str, bytes)):   # a numpy scalar
        value = value.item()
    if isinstance(value, float):
        if value != value or not value.is_integer():
            return None
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    text = str(value).strip()
    if not text:
        return None
    return str(int(text)) if text.isdigit() else text.upper()


def pick_name_field(columns, label):
    cols = [c for c in columns if c != 'geometry']
    if label and label in cols:
        return label
    lower = {c.lower(): c for c in cols}
    for hint in NAME_FIELD_HINTS:
        if hint in lower:
            return lower[hint]
    for c in cols:
        if 'name' in c.lower():
            return c
    return cols[0] if cols else None


def flat_parts(geoms, return_index=False):
    """Every single Polygon/LineString/Point in `geoms`, however deeply nested. shapely's
    get_parts goes down one level only, and make_valid can return a GeometryCollection holding
    a MultiPolygon (Eglinton DED in the 1916 Ulster layer did): one level down that is still a
    MultiPolygon, and a filter for polygons dropped the whole unit."""
    import numpy as np
    import shapely
    if isinstance(geoms, shapely.Geometry):
        geoms = [geoms]
    geoms = np.array(list(geoms), dtype=object)
    index = np.arange(len(geoms))
    while True:
        multi = np.isin(shapely.get_type_id(geoms), (4, 5, 6, 7))
        if not multi.any():
            break
        parts, sub = shapely.get_parts(geoms, return_index=True)
        geoms, index = parts, index[sub]
    return (geoms, index) if return_index else geoms


def load_edition(sources):
    import geopandas as gpd
    import pandas as pd
    import shapely
    frames = []
    for rel, label in sources:
        gdf = gpd.read_file(SOURCE_ROOT / rel, engine='pyogrio')
        if gdf.crs is None:
            gdf = gdf.set_crs('EPSG:4326')
        gdf = gdf[gdf.geometry.notna()]
        # A group map can carry the same units twice (eds-2006 has the four provinces AND an
        # all-island census variant). A source whose features already lie inside what is
        # loaded adds nothing but duplicates, so it is skipped.
        if frames and len(gdf):
            loaded = pd.concat(frames, ignore_index=True)
            pts = gdf.to_crs(METRIC_CRS).geometry.representative_point().values
            tree = shapely.STRtree(shapely.make_valid(loaded.geometry.values))
            hits = tree.query(pts, predicate='within')
            if len(set(hits[0].tolist())) >= 0.8 * len(pts):
                continue
        field = pick_name_field(gdf.columns, label)
        names = gdf[field].astype(str).where(gdf[field].notna(), '') if field else pd.Series([''] * len(gdf))
        # The unit's other names (to tell a rename from a change of label field) and the fields
        # that may be a stable id (stable_id_columns decides which, if any, is).
        others = [c for c in gdf.columns if c not in ('geometry', field)]
        alt_cols = [c for c in others if is_alt_name_column(c)]
        id_cols = [c for c in others if c not in alt_cols and not NOT_ID.search(c)]
        alts = [tuple(clean_label(v) for v in row if isinstance(v, str) and v.strip())
                for row in zip(*[gdf[c].values for c in alt_cols])] if alt_cols else [()] * len(gdf)
        codes = [{c: v for c, v in ((c, code_value(v)) for c, v in zip(id_cols, row)) if v}
                 for row in zip(*[gdf[c].values for c in id_cols])] if id_cols else [{}] * len(gdf)
        part = gpd.GeoDataFrame({'name': [clean_label(n) for n in names.values], 'src': rel,
                                 'field': field or '', 'alts': alts, 'codes': codes}, geometry=gdf.geometry.values, crs=gdf.crs)
        frames.append(part.to_crs(METRIC_CRS))
    gdf = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=METRIC_CRS)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].reset_index(drop=True)
    geoms = shapely.make_valid(gdf.geometry.values)
    geoms = shapely.simplify(geoms, 2.0, preserve_topology=True)
    parts, index = flat_parts(geoms, return_index=True)
    keep = shapely.get_type_id(parts) == 3          # polygons only
    grouped = {}
    for g, i in zip(parts[keep], index[keep]):
        grouped.setdefault(int(i), []).append(g)
    rows = sorted(grouped)
    out = gpd.GeoDataFrame({
        'name': gdf['name'].values[rows],
        'src': gdf['src'].values[rows],
        'field': gdf['field'].values[rows],
        'alts': gdf['alts'].values[rows],
        'codes': gdf['codes'].values[rows],
    }, geometry=[shapely.multipolygons(grouped[i]) if len(grouped[i]) > 1 else grouped[i][0] for i in rows], crs=METRIC_CRS)
    out = out[out.geometry.area > 1.0].reset_index(drop=True)
    out['uid'] = range(len(out))
    return out


def fingerprint(pair):
    h = hashlib.sha1(f'v{BUILDER_VERSION}|{pair["fromMapId"]}|{pair["toMapId"]}'.encode())
    for rel, label in sorted(pair['fromSources']) + [('|', '')] + sorted(pair['toSources']):
        h.update(f'{rel}|{label}'.encode())
        p = SOURCE_ROOT / rel
        if p.exists():
            st = p.stat()
            h.update(f'{st.st_size}|{int(st.st_mtime)}'.encode())
    return h.hexdigest()[:16]


def sources_missing_here(pair, old, exists=lambda rel: (SOURCE_ROOT / rel).exists()):
    """True when a pair cannot be recomputed in this checkout because the files it was built
    from are not held here, so its previous entry and file must be kept as they are.

    The source FlatGeobufs are not tracked: a git worktree or a clean checkout has none of
    them, every pair then resolves to no sources (or to part of a group map's files), and
    recomputing would record it as "unavailable" and delete its tracked change file. A pair is
    kept when some file its previous entry was built from is missing here and the pair now
    resolves to no file the previous entry did not already list (a map moved to a new file
    that IS held here is recomputed as before)."""
    if not old:
        return False
    for side in ('fromSources', 'toSources'):
        before = set(old.get(side) or [])
        now = {s for s, _ in pair[side]}
        if now - before:
            return False
    recorded = list(old.get('fromSources') or []) + list(old.get('toSources') or [])
    return any(not exists(rel) for rel in recorded)


def round_coords(geom, ndigits=5):
    import shapely
    return shapely.set_precision(geom, 10 ** -ndigits) if not geom.is_empty else geom


def to_wgs84(geoms):
    import geopandas as gpd
    return gpd.GeoSeries(list(geoms), crs=METRIC_CRS).to_crs('EPSG:4326')


def fmt_ha(ha):
    if ha >= 100:
        return f'{ha:,.0f} ha'
    if ha >= 10:
        return f'{ha:.0f} ha'
    return f'{ha:.1f} ha'


def opened(geom, radius=OPEN_RADIUS_M):
    """Morphological opening: removes every part narrower than 2 * radius."""
    if geom.is_empty:
        return geom
    shrunk = geom.buffer(-radius, quad_segs=4)
    if shrunk.is_empty:
        return shrunk
    return shrunk.buffer(radius, quad_segs=4).intersection(geom)


def compare(pair):
    """The change list for one pair. Returns (summary, featurecollection or None)."""
    import geopandas as gpd
    import numpy as np
    import shapely

    from_files = {s for s, _ in pair['fromSources']}
    to_files = {s for s, _ in pair['toSources']}
    if not from_files or not to_files:
        return {'kind': 'unavailable', 'count': 0, 'text': 'No geometry held for one of the editions.'}, None
    if from_files == to_files:
        return {'kind': 'none', 'count': 0, 'text': 'Drawn from the same data as the previous edition: no boundary changes.'}, None

    # Files both editions share draw the same lines; only the rest is compared.
    shared = from_files & to_files
    a_sources = [s for s in pair['fromSources'] if s[0] not in shared]
    b_sources = [s for s in pair['toSources'] if s[0] not in shared]
    if not a_sources or not b_sources:
        # One edition's files are a subset of the other's: the same lines over more or less
        # of the country (eds-1983 has Leinster and Munster, eds-roi-1985 Munster only).
        return {'kind': 'none', 'count': 0,
                'text': 'Drawn from the same data as the previous edition, over a different extent: no boundary changes.'}, None
    a = load_edition(a_sources)
    b = load_edition(b_sources)
    if a.empty or b.empty:
        return {'kind': 'unavailable', 'count': 0, 'text': 'No geometry to compare.'}, None

    pieces = gpd.overlay(a[['uid', 'name', 'geometry']], b[['uid', 'name', 'geometry']],
                         how='intersection', keep_geom_type=True)
    pieces = pieces.rename(columns={'uid_1': 'ia', 'uid_2': 'ib', 'name_1': 'na', 'name_2': 'nb'})
    pieces['area'] = pieces.geometry.area
    pieces = pieces[pieces['area'] > 1.0].reset_index(drop=True)

    area_a = a.geometry.area.values
    area_b = b.geometry.area.values
    # Units mostly outside the other edition's coverage (partition, a province drawn in one
    # edition only) are not compared at all.
    cov_a = np.bincount(pieces['ia'], weights=pieces['area'], minlength=len(a)) / np.maximum(area_a, 1)
    cov_b = np.bincount(pieces['ib'], weights=pieces['area'], minlength=len(b)) / np.maximum(area_b, 1)
    in_a = cov_a >= 0.5
    in_b = cov_b >= 0.5
    pieces = pieces[in_a[pieces['ia'].values] & in_b[pieces['ib'].values]].reset_index(drop=True)
    if pieces.empty:
        return {'kind': 'unavailable', 'count': 0, 'text': 'The two editions cover different areas.'}, None

    order = pieces.sort_values('area', ascending=False)
    best_b = order.drop_duplicates('ia').set_index('ia')['ib'].to_dict()   # a -> its main successor
    best_a = order.drop_duplicates('ib').set_index('ib')['ia'].to_dict()   # b -> its main predecessor
    names_a = a['name'].tolist()
    names_b = b['name'].tolist()

    mutual = np.array([best_b.get(ia) == ib and best_a.get(ib) == ia
                       for ia, ib in zip(pieces['ia'], pieces['ib'])], dtype=bool)
    samename = np.array([same_name(na, nb) for na, nb in zip(pieces['na'], pieces['nb'])], dtype=bool)
    # A unit and its successor by a stable id the editions share carry on, whatever their names.
    id_of_a, id_of_b = id_partners(a, b, best_a, best_b, in_a, in_b)
    by_id = np.array([id_of_a.get(ia) == ib for ia, ib in zip(pieces['ia'], pieces['ib'])], dtype=bool)
    pieces['keep'] = mutual | samename | by_id

    # Does a unit carry on into the other edition (its main partner, or a same-named unit)?
    cont_a = np.zeros(len(a), dtype=bool)
    cont_b = np.zeros(len(b), dtype=bool)
    for ia, ib, kp, ar in zip(pieces['ia'], pieces['ib'], pieces['keep'], pieces['area']):
        if kp and (ar >= 0.2 * area_a[ia] or ar >= 0.2 * area_b[ib]):
            cont_a[ia] = True
            cont_b[ib] = True

    # How far apart the two editions' lines sit: the area of every disagreeing piece over the
    # length of line it runs along. A few metres = the same lines; tens = redrawn.
    # The real changes found below are taken out of it first.
    disagreeing = float(pieces.loc[~pieces['keep'], 'area'].sum())
    line_len = float(shapely.length(shapely.boundary(b.geometry.values[in_b])).sum()) / 2 or 1.0

    changes = []
    min_area = MIN_AREA_HA * 10000
    # Land two units of one edition both claim (an overlap in the source layer: Dungannon and
    # Clogher RDs share 96 ha in most NI admin-area editions) has no single owner to have
    # changed from or to, so it is left out of every change.
    ambiguous = self_overlaps(a, in_a).union(self_overlaps(b, in_b))
    for (ia, ib), group in pieces[~pieces['keep']].groupby(['ia', 'ib']):
        if group['area'].sum() < min_area:
            continue
        geoms = group.geometry.values
        if not ambiguous.is_empty:
            geoms = shapely.difference(geoms, ambiguous)
        # Cheap pre-filter before the (slow) opening: a sliver along a line has a mean width
        # (2A/P) of a few metres, so only parts big and broad enough to hold a core go on.
        parts = flat_parts(geoms)
        parts = parts[shapely.get_type_id(parts) == 3]
        areas = shapely.area(parts)
        widths = 2 * areas / np.maximum(shapely.length(parts), 1)
        keep = (areas >= min_area) & (widths >= 8.0)
        # A part already twice as broad as the threshold is a whole piece of land, not a
        # sliver with a core: kept as it is, without the opening (which is what costs).
        compact = keep & (widths >= MIN_MEAN_WIDTH_M * 2)
        rough = parts[keep & ~compact]
        shapes = list(parts[compact])
        if len(rough):
            geom = shapely.union_all(rough)
            core = opened(shapely.simplify(geom, 10.0, preserve_topology=True))
            core_parts = [p for p in flat_parts(core) if shapely.get_type_id(p) == 3 and p.area >= min_area] if not core.is_empty else []
            if core_parts:
                core = shapely.union_all(core_parts)
                if 2 * core.area / max(core.length, 1) >= MIN_MEAN_WIDTH_M:
                    # The change is the piece itself, not its eroded core: give back what the
                    # opening trimmed, but only near the core, so a long sliver stays out.
                    shapes.append(geom.intersection(core.buffer(OPEN_RADIUS_M * 1.5, quad_segs=4)))
        if not shapes:
            continue
        shape = shapely.union_all(shapes) if len(shapes) > 1 else shapes[0]
        kind = 'transfer'
        if not cont_b[ib] and not cont_a[ia]:
            kind = 'reorganised'
        elif not cont_b[ib]:
            kind = 'created'
        elif not cont_a[ia]:
            kind = 'abolished'
        changes.append({'type': kind, 'from': names_a[ia], 'to': names_b[ib], 'ia': int(ia), 'ib': int(ib), 'geom': shape})

    pair_area = pieces.groupby(['ia', 'ib'])['area'].sum().to_dict()
    renames, label_variants, review = find_renames(a, b, best_a, best_b, pair_area, id_of_a, id_of_b)
    write_review(pair['id'], review)

    # The redrawing estimate below takes out the land the changes cover piece by piece, as the
    # disagreeing area counts it: a merger's union is smaller where a source layer repeats a unit
    # (Coleraine and Moyle twice in the 1993 LGDs), which would read as redrawing.
    piece_area = sum(c['geom'].area for c in changes)
    changes, renames = merge_and_divide(changes, renames, pair_area, area_a, area_b, names_a, names_b)
    changes = merge_unit_changes(changes)
    # A unit drawn in one edition only, inside what both cover (Larne Municipal Borough is in
    # the 1956 NI admin areas and missing from the 1950 layer the 1955 edition reuses).
    compared_m2 = float(area_b[in_b].sum())
    orphans_b = orphan_units(b, in_b, compared_m2)
    orphans_a = orphan_units(a, in_a, compared_m2)
    for i in orphans_b:
        changes.append({'type': 'appeared', 'from': None, 'to': names_b[i], 'geom': b.geometry.values[i]})
    for i in orphans_a:
        changes.append({'type': 'disappeared', 'from': names_a[i], 'to': None, 'geom': a.geometry.values[i]})
    # The rest drawn in one edition only are said to be, not passed over in silence.
    uncompared = ([names_b[i] for i in np.where(~in_b)[0] if i not in orphans_b]
                  + [names_a[i] for i in np.where(~in_a)[0] if i not in orphans_a])
    orphan_area = sum(c['geom'].area for c in changes if c['type'] in ('appeared', 'disappeared'))
    mean_shift_m = max(0.0, disagreeing - piece_area - orphan_area) / line_len
    lines = changed_lines(a, b, [c['geom'] for c in changes], in_a, in_b)
    return build_output(pair, changes, renames, lines, mean_shift_m,
                        compared=(int(in_a.sum()), int(in_b.sum())), compared_m2=compared_m2,
                        uncompared=uncompared, label_variants=label_variants)


def stable_id_columns(a, b, matched):
    """The id field each edition shares with the other, if any: a field of a's and one of b's
    (their names may differ: OSIED in the 2006 EDs is ED_ID in 2019) that agree on at least
    STABLE_ID_AGREEMENT of the units that carry on under one name (`matched`, pairs of row
    indexes), and are unique in each edition. None when no field is that stable: a row number
    or a code reissued at a review fails the test."""
    if len(matched) < 5:
        return None
    codes_a, codes_b = a['codes'].values, b['codes'].values
    agree = {}
    for ia, ib in matched:
        ca, cb = codes_a[ia], codes_b[ib]
        for ka, va in ca.items():
            for kb, vb in cb.items():
                if va == vb:
                    agree[(ka, kb)] = agree.get((ka, kb), 0) + 1
    for (ka, kb), n in sorted(agree.items(), key=lambda kv: -kv[1]):
        if n < STABLE_ID_AGREEMENT * len(matched):
            return None
        va = [c.get(ka) for c in codes_a if c.get(ka)]
        vb = [c.get(kb) for c in codes_b if c.get(kb)]
        if len(set(va)) == len(va) and len(set(vb)) == len(vb):
            return ka, kb
    return None


def id_partners(a, b, best_a, best_b, in_a, in_b):
    """Each compared unit's successor by the stable id the editions share (stable_id_columns),
    both ways: ({row in a: row in b}, {row in b: row in a}); empty when they share none."""
    names_a, names_b = a['name'].tolist(), b['name'].tolist()
    matched = [(ia, ib) for ia, ib in best_b.items() if best_a.get(ib) == ia and same_name(names_a[ia], names_b[ib])]
    ids = stable_id_columns(a, b, matched)
    id_of_a, id_of_b = {}, {}
    if not ids:
        return id_of_a, id_of_b
    ka, kb = ids
    by_code_b = {}
    for ib, codes in enumerate(b['codes'].values):
        if codes.get(kb) and in_b[ib]:
            by_code_b.setdefault(codes[kb], []).append(ib)
    for ia, codes in enumerate(a['codes'].values):
        hits = by_code_b.get(codes.get(ka)) if in_a[ia] else None
        if hits and len(hits) == 1:
            id_of_a[ia] = hits[0]
            id_of_b[hits[0]] = ia
    return id_of_a, id_of_b


def find_renames(a, b, best_a, best_b, pair_area, id_of_a, id_of_b):
    """Units present in both editions under a different name. A unit is matched by its stable
    id where the editions share one (id_partners), else by geometry: the main successor and main
    predecessor of each other, sharing RENAME_MIN_SHARE of each. A different label that is only
    the two sources writing one name differently (rename_verdict) is not a rename; those are
    counted by reason. Returns (renames, {reason: count}, review): `review` lists, for
    write_review, every label difference set aside and the main-successor pairs whose names
    differ but which share too little land to be called a rename."""
    names_a, names_b = a['name'].tolist(), b['name'].tolist()
    alts_a, alts_b = a['alts'].tolist(), b['alts'].tolist()
    field_a, field_b = [f.lower() for f in a['field'].tolist()], [f.lower() for f in b['field'].tolist()]
    area_a, area_b = a.geometry.area.values, b.geometry.area.values
    norm_a = frozenset(norm_name(n) for n in names_a)
    norm_b = frozenset(norm_name(n) for n in names_b)
    mutual = [(ia, ib) for ia, ib in best_b.items() if best_a.get(ib) == ia]

    candidates = []
    for ia, ib in mutual:
        # Ids, where there are any, say which unit carries on: geometry does not overrule them.
        if id_of_a.get(ia, ib) != ib or id_of_b.get(ib, ia) != ia:
            continue
        shared = pair_area.get((ia, ib), 0.0)
        if shared >= RENAME_MIN_SHARE * area_a[ia] and shared >= RENAME_MIN_SHARE * area_b[ib]:
            candidates.append((ia, ib))
    seen = set(candidates)
    for ia, ib in id_of_a.items():
        if (ia, ib) not in seen and pair_area.get((ia, ib), 0.0) >= ID_RENAME_MIN_SHARE * min(area_a[ia], area_b[ib]):
            candidates.append((ia, ib))

    renames, variants = [], {}
    review = {'variants': [], 'belowShare': []}
    for ia, ib in candidates:
        verdict = rename_verdict(names_a[ia], names_b[ib], alts_a[ia], alts_b[ib], norm_a, norm_b, field_a[ia] == field_b[ib])
        if verdict == 'renamed':
            renames.append({'type': 'renamed', 'from': names_a[ia], 'to': names_b[ib],
                            'ia': int(ia), 'ib': int(ib), 'geom': b.geometry.values[ib],
                            'by': 'id' if id_of_a.get(ia) == ib else 'geometry'})
        elif verdict != 'same':
            variants[verdict] = variants.get(verdict, 0) + 1
            review['variants'].append([verdict, names_a[ia], names_b[ib]])
    if REVIEW_DIR:
        taken = set(candidates)
        for ia, ib in mutual:
            if (ia, ib) in taken:
                continue
            shared = pair_area.get((ia, ib), 0.0)
            if rename_verdict(names_a[ia], names_b[ib], alts_a[ia], alts_b[ib], norm_a, norm_b, field_a[ia] == field_b[ib]) == 'renamed':
                review['belowShare'].append([names_a[ia], names_b[ib], round(shared / max(area_a[ia], 1), 2),
                                             round(shared / max(area_b[ib], 1), 2)])
    return renames, variants, review


# Set CIVGRAPH_TIMELINE_REVIEW=<folder> to write, per pair, the label differences set aside as not
# renames and the near-renames (find_renames), for checking the rules by eye. Not build output.
REVIEW_DIR = os.environ.get('CIVGRAPH_TIMELINE_REVIEW') or ''


def write_review(pair_id, review):
    if not REVIEW_DIR or not (review['variants'] or review['belowShare']):
        return
    Path(REVIEW_DIR).mkdir(parents=True, exist_ok=True)
    (Path(REVIEW_DIR) / f'{pair_id}.json').write_text(json.dumps(review, ensure_ascii=False), encoding='utf-8')


def orphan_units(gdf, mask, compared_m2, max_units=10, max_share=0.02, min_shared_edge=0.25):
    """Units of one edition left out of the comparison (no counterpart in the other) that
    sit inside the compared area: a handful, small, and sharing a good part of their edge with
    compared neighbours. A whole province or the six counties after partition is a change of
    coverage, not of boundaries, and fails every one of those tests."""
    import numpy as np
    import shapely
    geoms = gdf.geometry.values
    idx = np.where(~mask)[0]
    if not len(idx) or len(idx) > max_units or shapely.area(geoms[idx]).sum() > max_share * compared_m2:
        return []
    tree = shapely.STRtree(geoms)
    out = []
    for i in idx:
        g = geoms[i]
        if g.area < MIN_AREA_HA * 10000:
            continue
        near = [j for j in tree.query(g.buffer(5), predicate='intersects') if j != i and mask[j]]
        if not near:
            continue
        shared = g.boundary.intersection(shapely.union_all(geoms[near]).buffer(5)).length
        if shared >= min_shared_edge * g.boundary.length:
            out.append(int(i))
    return out


def self_overlaps(gdf, mask):
    """Where two units of one edition overlap by more than MIN_AREA_HA / 4."""
    import numpy as np
    import shapely
    geoms = gdf.geometry.values
    left, right = shapely.STRtree(geoms).query(geoms, predicate='overlaps')
    keep = (left < right) & mask[left] & mask[right]
    if not keep.any():
        return shapely.GeometryCollection()
    inter = shapely.intersection(geoms[left[keep]], geoms[right[keep]])
    polys = flat_parts(inter)
    polys = polys[(shapely.get_type_id(polys) == 3) & (shapely.area(polys) >= MIN_AREA_HA * 10000 / 4)]
    return shapely.union_all(polys) if len(polys) else shapely.GeometryCollection()


MERGE_MIN_SHARE = 0.5           # a unit merged into another gave it at least half its land


def merge_and_divide(changes, renames, pair_area, area_a, area_b, names_a, names_b):
    """Mergers and divisions as one change each (Phelim Birch, 26 Nov 2026: "it doesn't appear to
    understand merges"). Two or more units that each gave most of their land to one new unit,
    whose name is none of theirs, merged to form it: 'North Tipperary and South Tipperary County
    Councils' -> 'Tipperary County Council' is one merger, not 'North Tipperary abolished' with
    South Tipperary passed over as carrying on. Likewise one unit most of whose land went to
    two or more units with new names was divided among them. A unit absorbed by one that keeps
    its own name stays 'abolished, joined to'. Only a group with at least one abolished (or
    created) piece the area tests kept becomes a merger (or division), so nothing too small to
    list on its own is added. Returns (changes, renames) with the group's parts replaced."""
    import shapely
    used, used_renames, out = set(), set(), []

    def group_of(key_of, partner_area):
        groups = {}
        for (ia, ib), shared in pair_area.items():
            k, other = key_of(ia, ib)
            if shared >= MERGE_MIN_SHARE * partner_area(ia, ib):
                groups.setdefault(k, set()).add(other)
        return groups

    # Mergers: per new unit, the old units that gave it most of their land.
    for ib, olds in group_of(lambda ia, ib: (ib, ia), lambda ia, ib: area_a[ia]).items():
        # Parts of one unit drawn apart are not a merger: two names at least.
        if len({names_a[ia] for ia in olds}) < 2 or any(same_name(names_a[ia], names_b[ib]) for ia in olds):
            continue
        parts = [k for k, c in enumerate(changes) if k not in used and c['type'] == 'abolished'
                 and c['ib'] == ib and c['ia'] in olds]
        if not parts:
            continue
        olds = sorted(olds, key=lambda ia: -area_a[ia])
        used.update(parts)
        used_renames.update(k for k, r in enumerate(renames) if r['ib'] == ib and r['ia'] in olds)
        # A unit drawn in several parts is named once.
        from_names = list(dict.fromkeys(names_a[ia] for ia in olds))
        out.append({'type': 'merged', 'from': ', '.join(from_names), 'to': names_b[ib],
                    'fromNames': from_names, 'toNames': [names_b[ib]],
                    'geom': shapely.union_all([changes[k]['geom'] for k in parts])})
    # Divisions: per old unit, the new units most of whose land came from it.
    for ia, news in group_of(lambda ia, ib: (ia, ib), lambda ia, ib: area_b[ib]).items():
        if len({names_b[ib] for ib in news}) < 2 or any(same_name(names_a[ia], names_b[ib]) for ib in news):
            continue
        parts = [k for k, c in enumerate(changes) if k not in used and c['type'] == 'created'
                 and c['ia'] == ia and c['ib'] in news]
        if not parts:
            continue
        news = sorted(news, key=lambda ib: -area_b[ib])
        used.update(parts)
        used_renames.update(k for k, r in enumerate(renames) if r['ia'] == ia and r['ib'] in news)
        to_names = list(dict.fromkeys(names_b[ib] for ib in news))
        out.append({'type': 'divided', 'from': names_a[ia], 'to': ', '.join(to_names),
                    'fromNames': [names_a[ia]], 'toNames': to_names,
                    'geom': shapely.union_all([changes[k]['geom'] for k in parts])})
    rest = [c for k, c in enumerate(changes) if k not in used]
    return rest + out, [r for k, r in enumerate(renames) if k not in used_renames]


def merge_unit_changes(changes):
    """A unit created from three old ones is one change ('X created from A, B, C'), likewise an
    abolished one divided among its neighbours."""
    import shapely
    out, created, abolished = [], {}, {}
    for c in changes:
        if c['type'] == 'created':
            created.setdefault(c['ib'], []).append(c)
        elif c['type'] == 'abolished':
            abolished.setdefault(c['ia'], []).append(c)
        else:
            out.append(c)
    for group in created.values():
        group.sort(key=lambda c: -c['geom'].area)
        out.append({'type': 'created', 'from': ', '.join(dict.fromkeys(c['from'] for c in group)),
                    'to': group[0]['to'], 'geom': shapely.union_all([c['geom'] for c in group])})
    for group in abolished.values():
        group.sort(key=lambda c: -c['geom'].area)
        out.append({'type': 'abolished', 'from': group[0]['from'],
                    'to': ', '.join(dict.fromkeys(c['to'] for c in group)),
                    'geom': shapely.union_all([c['geom'] for c in group])})
    return out


def changed_lines(a, b, areas, in_a, in_b):
    """Lines present in one edition and not within LINE_TOLERANCE_M of the other, looked for
    only around the kept change areas, so redrawing elsewhere never shows as a line change."""
    import numpy as np
    import shapely
    if not areas:
        return {'added': [], 'removed': []}
    zone = shapely.union_all(shapely.buffer(np.array(areas, dtype=object), LINE_TOLERANCE_M * 2, quad_segs=4))

    def near(gdf, mask):
        idx = shapely.STRtree(gdf.geometry.values).query(zone, predicate='intersects')
        idx = np.array([i for i in idx if mask[i]], dtype=int)
        return shapely.simplify(gdf.geometry.values[idx], 5.0, preserve_topology=True)

    near_a, near_b = near(a, in_a), near(b, in_b)

    def through_interior(src, other):
        """src's lines that run through the inside of other's units, further than
        LINE_TOLERANCE_M from any of other's lines. Eroding other's units and clipping src's
        boundaries to them is the same test as 'not within the tolerance of other's lines',
        without buffering the whole of other's linework."""
        if not len(src) or not len(other):
            return shapely.GeometryCollection()
        eroded = shapely.buffer(other, -LINE_TOLERANCE_M, quad_segs=2)
        eroded = eroded[~shapely.is_empty(eroded)]
        if not len(eroded):
            return shapely.GeometryCollection()
        lines = shapely.boundary(src)
        li, ei = shapely.STRtree(eroded).query(lines, predicate='intersects')
        if not len(li):
            return shapely.GeometryCollection()
        return shapely.union_all(shapely.intersection(lines[li], eroded[ei])).intersection(zone)

    added = through_interior(near_b, near_a)
    removed = through_interior(near_a, near_b)

    def pieces_of(geom):
        if geom.is_empty:
            return []
        lines = [p for p in flat_parts(geom) if p.geom_type == 'LineString']
        if not lines:
            return []
        merged = shapely.line_merge(shapely.union_all(lines))
        return [p for p in flat_parts(merged) if p.geom_type == 'LineString' and p.length >= MIN_LINE_M]

    return {'added': pieces_of(added), 'removed': pieces_of(removed)}


TYPE_ORDER = {'merged': 0, 'divided': 0, 'created': 0, 'appeared': 0, 'abolished': 1, 'disappeared': 1, 'reorganised': 2, 'transfer': 3, 'renamed': 4}


def name_list(names):
    """'A', 'A and B', 'A, B and C'; with a comma before the last 'and' when a name has its own
    ('Newry and Mourne, and Down')."""
    names = list(dict.fromkeys(n for n in names if n))
    if len(names) < 2:
        return names[0] if names else ''
    last = ', and ' if any(re.search(r'\band\b', n, re.I) for n in names) else ' and '
    return ', '.join(names[:-1]) + last + names[-1]


def describe(c, ha):
    t = c['type']
    if t == 'merged':
        return f"{name_list(c['fromNames'])} merged to form {c['to']}"
    if t == 'divided':
        return f"{c['from']} divided into {name_list(c['toNames'])}"
    if t == 'created':
        return f"{c['to']} formed from {c['from']}"
    if t == 'abolished':
        return f"{c['from']} abolished, joined to {c['to']}"
    if t == 'renamed':
        return f"{c['from']} renamed {c['to']}"
    if t == 'appeared':
        return f"{c['to']} first drawn in this edition"
    if t == 'disappeared':
        return f"{c['from']} no longer drawn"
    if t == 'reorganised':
        return f"{fmt_ha(ha)} of {c['from']} to {c['to']}"
    return f"{fmt_ha(ha)} from {c['from']} to {c['to']}"


def feature(geom, props):
    import shapely
    return {'type': 'Feature', 'properties': props, 'geometry': json.loads(shapely.to_geojson(geom))}


def summary_line(count, renamed, moved_ha):
    """'3 changes, 16 ha in all.', '2 changes (1 rename), 16 ha in all.', '1 rename.'"""
    if renamed and renamed == count:
        return f"{count:,} rename{'s' if count != 1 else ''}."
    text = f"{count:,} change{'s' if count != 1 else ''}"
    if renamed:
        text += f" ({renamed:,} rename{'s' if renamed != 1 else ''})"
    return text + (f", {fmt_ha(moved_ha)} in all" if moved_ha else '') + '.'


def build_output(pair, changes, renames, lines, mean_shift_m, compared, compared_m2=0.0, uncompared=(), label_variants=None):
    import shapely
    redrawn = mean_shift_m >= REDRAWN_MAX_SHIFT_M
    all_changes = changes + renames
    for c in all_changes:
        c['ha'] = c['geom'].area / 10000
    # A wholesale redrawing of the units (DEDs replaced by wards in 1972/73, a ward review)
    # changes most of the land: filling it all would paint the map over. The new and gone
    # lines show it better, so the areas are listed but not drawn.
    changed_m2 = sum(c['geom'].area for c in changes)
    reorganisation = compared_m2 > 0 and changed_m2 >= REORGANISATION_SHARE * compared_m2
    all_changes.sort(key=lambda c: (TYPE_ORDER.get(c['type'], 9), -c['ha']))
    truncated = max(0, len(all_changes) - MAX_CHANGES_LISTED)
    all_changes = all_changes[:MAX_CHANGES_LISTED]

    geoms = [shapely.simplify(c['geom'], SIMPLIFY_M, preserve_topology=True) for c in all_changes]
    points = [c['geom'].representative_point() for c in all_changes]
    n, na = len(all_changes), len(lines['added'])
    wgs = list(to_wgs84(geoms + points + lines['added'] + lines['removed']).values) if (n or na or lines['removed']) else []
    w_geoms, w_points = wgs[:n], wgs[n:2 * n]
    w_added, w_removed = wgs[2 * n:2 * n + na], wgs[2 * n + na:]

    items, features = [], []
    for k, (c, g, p) in enumerate(zip(all_changes, w_geoms, w_points)):
        cid = f'c{k + 1}'
        items.append({
            'id': cid, 'type': c['type'], 'from': c['from'] or None, 'to': c['to'] or None,
            'ha': round(c['ha'], 1), 'bbox': [round(v, 5) for v in g.bounds],
            'point': [round(p.x, 5), round(p.y, 5)], 'text': describe(c, c['ha']),
            **({'fromNames': c['fromNames'], 'toNames': c['toNames']} if c.get('fromNames') else {})
        })
        if c['type'] == 'renamed':
            # The renamed unit itself, outlined lightly: its land did not change hands.
            # Its boundary as lines: an outline is all that is drawn, and rounding a simplified
            # polygon can fail on an invalid one (eds-roi-1970__eds-1971).
            features.append(feature(round_coords(shapely.boundary(g)), {'role': 'renamed', 'changeId': cid, 'type': 'renamed'}))
        elif not reorganisation:
            features.append(feature(round_coords(g), {'role': 'area', 'changeId': cid, 'type': c['type']}))
    for role, group in (('added', w_added), ('removed', w_removed)):
        # One multi-line per role: thousands of short line features cost more than their lines.
        parts = [p for g in group for p in flat_parts(shapely.simplify(g, 0.00012, preserve_topology=False))
                 if not p.is_empty and p.geom_type == 'LineString']
        if parts:
            features.append(feature(round_coords(shapely.multilinestrings(parts)), {'role': role}))

    count = len(items) + truncated
    if count:
        kind = 'changes'
        moved = sum(i['ha'] for i in items if i['type'] != 'renamed')
        text = summary_line(count, len(renames), moved)
        if reorganisation:
            text += (f' A reorganisation: {changed_m2 / compared_m2:.0%} of the area changed hands, so the new '
                     'and former lines are drawn rather than every area.')
        if redrawn:
            text += (' The editions are drawn from different sources, so differences narrower than '
                     f'{int(OPEN_RADIUS_M * 2)} m are treated as redrawing and not shown.')
    elif redrawn:
        kind = 'redrawn'
        text = ('Redrawn from a different source (the lines differ by about '
                f'{mean_shift_m:.0f} m on average); no boundary changes found.')
    else:
        kind = 'none'
        text = 'No boundary changes.'
    uncompared = [n for n in dict.fromkeys(uncompared) if n]
    if uncompared and len(uncompared) <= 5:
        text += ' Drawn in one edition only, so not compared: ' + ', '.join(uncompared) + '.'
    elif uncompared:
        text += f' {len(uncompared):,} units are drawn in one edition only (a change of coverage) and are not compared.'
    summary = {'kind': kind, 'count': count, 'text': text, 'meanShiftM': round(mean_shift_m, 1),
               'redrawn': bool(redrawn), 'reorganisation': bool(reorganisation),
               'compared': {'from': compared[0], 'to': compared[1]}}
    if renames:
        summary['renamed'] = len(renames)
    if label_variants:
        # Different labels found not to be renames, by reason (rename_verdict).
        summary['labelVariants'] = dict(sorted(label_variants.items()))
    if truncated:
        summary['listed'] = len(items)
    fc = {'type': 'FeatureCollection', 'id': pair['id'], 'fromMapId': pair['fromMapId'], 'toMapId': pair['toMapId'],
          'summary': summary, 'changes': items, 'features': features}
    return summary, fc


# ----------------------------------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------------------------------

def run_pair(pair):
    started = time.time()
    try:
        summary, fc = compare(pair)
        error = None
    except Exception as exc:  # one bad source must not stop the rest
        summary, fc, error = {'kind': 'unavailable', 'count': 0, 'text': 'Changes could not be computed.'}, None, repr(exc)[:300]
    path = None
    if fc is not None:
        path = f'data/timeline-changes/{pair["id"]}.json'
        (ROOT / path).write_text(json.dumps(fc, separators=(',', ':'), ensure_ascii=False), encoding='utf-8', newline='\n')
    return pair['id'], summary, path, error, round(time.time() - started, 1)


PAIR_TIMEOUT_S = 1500


def run_in_subprocess(pair_id):
    started = time.time()
    failed = {'kind': 'unavailable', 'count': 0, 'text': 'Changes could not be computed.'}
    try:
        proc = subprocess.run([sys.executable, '-W', 'ignore', str(Path(__file__).resolve()), '--one', pair_id],
                              capture_output=True, text=True, timeout=PAIR_TIMEOUT_S, cwd=str(ROOT))
    except subprocess.TimeoutExpired:
        return failed, None, f'timed out after {PAIR_TIMEOUT_S} s', round(time.time() - started, 1)
    line = next((l for l in reversed(proc.stdout.splitlines()) if l.startswith('RESULT ')), None)
    if not line:
        tail = (proc.stderr or proc.stdout or '').strip().splitlines()[-1:] or ['no output']
        return failed, None, f'worker exited {proc.returncode}: {tail[0][:200]}', round(time.time() - started, 1)
    result = json.loads(line[len('RESULT '):])
    return result['summary'], result['path'], result['error'], result['secs']


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--only', default='', help='only pairs whose id contains this text (or any of several, comma-separated)')
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--one', default='', help=argparse.SUPPRESS)
    parser.add_argument('--sources-from', default='', help='read the source files from this checkout (read only)')
    args = parser.parse_args()
    if args.sources_from:
        global SOURCE_ROOT
        SOURCE_ROOT = Path(args.sources_from).resolve()
        # The per-pair workers are processes of their own: they read it from the environment.
        os.environ['CIVGRAPH_TIMELINE_SOURCES'] = str(SOURCE_ROOT)

    only = [text for text in args.only.split(',') if text]
    catalogue = Catalogue()
    pairs = catalogue.pairs()
    if args.one:
        # A worker: one pair in its own process (see run_in_subprocess), result on stdout.
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        pair = next(p for p in pairs if p['id'] == args.one)
        pid, summary, path, error, secs = run_pair(pair)
        print('RESULT ' + json.dumps({'summary': summary, 'path': path, 'error': error, 'secs': secs}))
        return
    if args.list:
        for p in pairs:
            print(p['chainId'], p['id'], len(p['fromSources']), len(p['toSources']))
        print(f'{len(pairs)} pairs')
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT_DIR / 'manifest.json'
    previous = {}
    if manifest_path.exists():
        try:
            previous = {e['id']: e for e in json.loads(manifest_path.read_text(encoding='utf-8')).get('pairs', [])}
        except (ValueError, KeyError):
            previous = {}

    entries, todo, kept = {}, [], []
    for p in pairs:
        sig = fingerprint(p)
        old = previous.get(p['id'])
        if sources_missing_here(p, old):
            entries[p['id']] = old
            kept.append(p['id'])
            continue
        reusable = (old and old.get('signature') == sig and not args.force
                    and (not old.get('path') or (ROOT / old['path']).exists()))
        picked = any(text in p['id'] for text in only)
        if only and picked:
            reusable = False if args.force else reusable
        if reusable or (only and not picked and old):
            entries[p['id']] = old
        else:
            todo.append(p)
        p['signature'] = sig

    print(f'{len(pairs)} pairs; {len(todo)} to compute, {len(pairs) - len(todo) - len(kept)} unchanged', flush=True)
    if kept:
        print(f'{len(kept)} pair(s) kept as they were: their source files are not held in this checkout'
              f' (e.g. {kept[0]}); run in the main checkout to recompute them', flush=True)
    by_id = {p['id']: p for p in pairs}
    live = {p['id'] for p in pairs}

    def write_manifest():
        ordered = [entries[p['id']] for p in pairs if p['id'] in entries]
        kinds = {}
        for e in ordered:
            kinds[e['kind']] = kinds.get(e['kind'], 0) + 1
        manifest = {
            'version': 1,
            'builder': 'scripts/build/timeline-changes.py',
            'builderVersion': BUILDER_VERSION,
            'thresholds': {
                'openRadiusM': OPEN_RADIUS_M, 'minAreaHa': MIN_AREA_HA, 'minMeanWidthM': MIN_MEAN_WIDTH_M,
                'lineToleranceM': LINE_TOLERANCE_M, 'minLineM': MIN_LINE_M, 'redrawnShiftM': REDRAWN_MAX_SHIFT_M,
            },
            'pairCount': len(ordered),
            'kinds': kinds,
            'pairs': ordered,
        }
        # The runtime reads this slim index (manifest.json also carries sources and
        # signatures for the build): one line per pair the slider can step across.
        index = {
            'version': 1,
            'pairs': {e['id']: {k: e[k] for k in ('kind', 'count', 'text', 'path', 'redrawn') if e.get(k) is not None}
                      for e in ordered},
        }
        index_path = OUT_DIR / 'index.json'
        index_tmp = index_path.with_suffix('.tmp')
        index_tmp.write_text(json.dumps(index, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
        os.replace(index_tmp, index_path)
        tmp = manifest_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
        os.replace(tmp, manifest_path)
        return ordered, kinds

    def record(pid, summary, path, error):
        p = by_id[pid]
        if path is None and (OUT_DIR / f'{pid}.json').exists():
            (OUT_DIR / f'{pid}.json').unlink()
        entry = {
            'id': pid, 'chainId': p['chainId'], 'column': p['column'],
            'fromMapId': p['fromMapId'], 'toMapId': p['toMapId'],
            'fromDate': p['fromDate'], 'toDate': p['toDate'],
            'kind': summary['kind'], 'count': summary['count'], 'text': summary['text'],
            'redrawn': summary.get('redrawn', False), 'meanShiftM': summary.get('meanShiftM'),
            'path': path, 'bytes': (ROOT / path).stat().st_size if path else 0,
            'signature': None if error else p['signature'],
            'fromSources': sorted({s for s, _ in p['fromSources']}),
            'toSources': sorted({s for s, _ in p['toSources']}),
        }
        for key in ('renamed', 'labelVariants'):
            if summary.get(key):
                entry[key] = summary[key]
        if p.get('changeNote'):
            entry['changeNote'] = p['changeNote'][:400]
        if error:
            entry['error'] = error
        entries[pid] = entry

    # Pairs no longer in any series are dropped, with their files.
    for pid, old in previous.items():
        if pid not in live and old.get('path') and (ROOT / old['path']).exists():
            (ROOT / old['path']).unlink()

    if todo:
        # Each pair runs in a process of its own: the big ones (all-island DEDs, ward reviews)
        # take 1-2 GB, which GEOS only hands back when the process ends, and a pair that hangs
        # is stopped at PAIR_TIMEOUT_S without holding up the rest. (A process pool with
        # max_tasks_per_child lost its workers on Python 3.14 and stalled.)
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = {pool.submit(run_in_subprocess, p['id']): p['id'] for p in todo}
            for done, fut in enumerate(as_completed(futures), 1):
                pid = futures[fut]
                summary, path, error, secs = fut.result()
                record(pid, summary, path, error)
                tag = 'ERROR ' + error[:120] if error else f"{summary['kind']:<11} {summary['count']:>4}"
                print(f'  [{done}/{len(todo)}] {secs:>6}s  {pid}: {tag}', flush=True)
                if done % 10 == 0:
                    write_manifest()

    ordered, kinds = write_manifest()
    biggest = max((e.get('bytes') or 0 for e in ordered), default=0)
    print(f'manifest: {len(ordered)} pairs {kinds}; largest file {biggest / 1e6:.2f} MB')
    errors = [e for e in ordered if e.get('error')]
    if errors:
        print(f'{len(errors)} pair(s) failed (re-run to retry them):')
        for e in errors[:10]:
            print('  ', e['id'], e['error'][:160])
        sys.exit(1)


if __name__ == '__main__':
    main()
