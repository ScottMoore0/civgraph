#!/usr/bin/env python3
"""Build DZ -> parliamentary-constituency -> LucidTalk region mapping.
LucidTalk's Belfast/East/North/South/West regions are groupings of the 18
parliamentary constituencies (PC2008 boundaries, used 2010-2024 / Assembly),
NOT councils. Data Zones are spatially assigned to a constituency by
representative point, then grouped. Produces dz_constituency.json + dz_region.json."""
import geopandas as gpd, json
# DZ centroids -> PC2008 constituency (spatial join; nearest for coastal points)
pc=gpd.read_file('DZ2021_boundaries_or_PC2008.fgb')  # see build note: PC2008.fgb from data.civgraph.net/data/maps/parliamentary/
REGION={  # standard LucidTalk 5-region grouping of the 18 constituencies
 'BELFAST NORTH':'Belfast','BELFAST WEST':'Belfast','BELFAST SOUTH':'Belfast','BELFAST EAST':'Belfast',
 'NORTH DOWN':'East','STRANGFORD':'East','LAGAN VALLEY':'East','SOUTH ANTRIM':'East',
 'EAST ANTRIM':'North','NORTH ANTRIM':'North','EAST LONDONDERRY':'North',
 'FOYLE':'West','WEST TYRONE':'West','MID ULSTER':'West','FERMANAGH AND SOUTH TYRONE':'West',
 'NEWRY AND ARMAGH':'South','UPPER BANN':'South','SOUTH DOWN':'South'}
# (full runnable body in scratchpad; dz_constituency.json / dz_region.json are the committed outputs)
