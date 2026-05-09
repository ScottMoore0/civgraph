"""LOD generation for the 24 maps still on useLOD:false after Tier B
(GSNI Tellus geochem, GSNI bedrock lines/minerals, OSNI coverage grids,
environmental noise R3, historic admin layers, transport defects 2021).
"""
from __future__ import annotations
import sys
sys.path.insert(0, 'scripts')
from build_lod_ladders import process_one

URLS = [
    'https://data.civgraph.net/data/maps/physical/East and West of the Bann.fgb',
    'https://data.civgraph.net/data/maps/physical/West of the Bann and Sperrins.fgb',
    'https://data.civgraph.net/data/maps/parliamentary/PC_1918_Ireland.fgb',
    'https://data.civgraph.net/data/maps/parliamentary/PC_1885_Ireland.fgb',
    'https://data.civgraph.net/data/maps/electoral-divisions/NI_DEDs_1930.fgb',
    'https://data.civgraph.net/data/maps/baronies-parishes/Baronies_AllIreland.fgb',
    'https://data.civgraph.net/data/maps/geology/bedrock-geology-lines.fgb',
    'https://data.civgraph.net/data/maps/geology/gsni-mineral-resources.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-stream-sediments-xrf-set1.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-stream-waters-icp.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-rural-soil-a-xrf.fgb',
    'https://data.civgraph.net/data/maps/osni-reference/coverage-grid-10k.fgb',
    'https://data.civgraph.net/data/maps/osni-reference/coverage-grid-50k.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-stream-sediments-xrf-set2.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-stream-sediments-au-pge.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-stream-sediments-boron.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-rural-soil-a-aqua-regia.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-rural-soil-s-aqua-regia.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-rural-soil-s-near-total.fgb',
    'https://data.civgraph.net/data/maps/geology/tellus-rural-soil-s-fire-assay.fgb',
    'https://data.civgraph.net/data/maps/transport/carriageway-footway-defects-2021.fgb',
    'https://data.civgraph.net/data/maps/environment/noise-agglomeration-lden-r3.fgb',
    'https://data.civgraph.net/data/maps/environment/noise-major-roads-lden-r3.fgb',
    'https://data.civgraph.net/data/maps/environment/noise-major-rail-lden-r3.fgb',
]

for i, url in enumerate(URLS, 1):
    print(f'[{i}/{len(URLS)}] {url}', flush=True)
    try:
        process_one(url)
    except Exception as e:
        print(f'  ! {e}', flush=True)
print('DONE remaining24 batch')
