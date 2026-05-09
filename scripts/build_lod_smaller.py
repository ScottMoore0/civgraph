"""Build LOD ladders for the SMALLER habitat + dfi maps (skip the 4
grouped habitat layers which are too slow for an interactive build).
A separate build_lod_grouped.py handles the grouped layers in the
background.
"""
from __future__ import annotations
import sys
sys.path.insert(0, 'scripts')
from build_lod_ladders import process_one

URLS = [
    # 20 individual habitat layers (smaller than the 4 grouped ones)
    'https://data.civgraph.net/data/maps/biodiversity/habitat-bog.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-deciduous-woodland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-ancient-semi-natural-woodland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-fen.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-heath.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-lake.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-pond.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-river.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-reedbed.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-acid-grassland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-calcareous-grassland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-lowland-meadow.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-purple-moor-grass.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-traditional-orchard.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-wood-pasture-parkland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-coastal-sand-dune.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-coastal-saltmarsh.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-coastal-vegetated-shingle.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-maritime-cliff-slope.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-limestone-pavement.fgb',
    # 8 dfi-pothole-enquiries years
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2014.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2015.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2016.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2017.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2018.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2019.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2020.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2021.fgb',
    # 13 dfi-surface-defects years
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2008.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2010.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2011.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2012.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2013.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2014.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2015.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2016.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2017.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2018.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2019.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2020.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2021.fgb',
]

for i, url in enumerate(URLS, 1):
    print(f'[{i}/{len(URLS)}] {url}', flush=True)
    try:
        process_one(url)
    except Exception as e:
        print(f'  ! {e}', flush=True)
print('DONE smaller batch')
