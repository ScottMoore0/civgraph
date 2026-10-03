#!/usr/bin/env bash
# Build a 1 m hillshade tile pyramid from one OSNI River Basin LiDAR block.
#
#   scripts/lidar/build_river_basin_hillshade.sh <unzipped block dir> <out dir> [minzoom] [maxzoom]
#
# The blocks are OpenDataNI's "OSNI Open Data: River Basin LIDAR <year> - DTMs and DSMs"
# (Open Government Licence), one zip per basin, each holding 1 km ESRI ASCII grids in the
# Irish Grid (EPSG:29903) under DTM_1m/. The DTM (bare earth) is mosaicked, hillshaded from
# several directions, reprojected to Web Mercator and tiled by rasterio_xyz_tiler.py into
# {z}/{x}/{y}.png, which upload-tile-pyramid-s3.mjs puts on R2 under
# data/maps/physical/<layer id>/. Tiles wholly outside the surveyed area are not written.
#
# Stonyford 2014 (osni-lidar-stonyford-2014): stonyford_16_06_2014.zip, zooms 8-16.
set -euo pipefail
src="$1"; out="$2"; minz="${3:-8}"; maxz="${4:-16}"
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ls "$src"/DTM_1m/*.asc > "$work/list.txt"
gdalbuildvrt -q -a_srs EPSG:29903 -srcnodata -9999 -vrtnodata -9999 -input_file_list "$work/list.txt" "$work/dtm.vrt"
gdaldem hillshade -q -multidirectional -z 1.5 -compute_edges "$work/dtm.vrt" "$work/hs.tif"
gdalwarp -q -overwrite -t_srs EPSG:3857 -r bilinear -dstalpha -srcnodata 0 "$work/hs.tif" "$work/hs3857.tif"
gdal_translate -q -b 1 -b 1 -b 1 -b 2 -co PHOTOMETRIC=RGB -co ALPHA=YES "$work/hs3857.tif" "$work/hs_rgba.tif"
python "$here/rasterio_xyz_tiler.py" "$work/hs_rgba.tif" "$out" --minzoom "$minz" --maxzoom "$maxz"
