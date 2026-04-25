#!/usr/bin/env bash
# Network Contribution: rasterize each catchment's GRIDCODE field at 25m,
# mosaic into one national NI raster, build a tile pyramid coloured by
# score on inferno.
set -euo pipefail
GDAL=/c/Program\ Files/GDAL
EXT=_tmp_extra/network-contribution/extracted
OUT=_tmp_extra/network-contribution/rasters
mkdir -p "$OUT"

# Find every catchment's polygon source — SHPs or GDBs
> "$OUT/sources.txt"
for d in "$EXT"/*; do
    base=$(basename "$d")
    shp=$(find "$d" -maxdepth 2 -name '*Network_Contribution.shp' | head -1)
    if [ -n "$shp" ]; then
        echo "$base|$shp" >> "$OUT/sources.txt"; continue
    fi
    gdb=$(find "$d" -maxdepth 2 -name '*.gdb' -type d | head -1)
    if [ -n "$gdb" ]; then
        layer=$("/c/Program Files/GDAL/ogrinfo.exe" -so "$gdb" 2>&1 | grep -oE '^Layer: \S+' | head -1 | sed 's/Layer: //')
        echo "$base|$gdb|$layer" >> "$OUT/sources.txt"
    fi
done
echo "Found $(wc -l < "$OUT/sources.txt") catchment sources"

# Rasterize each at 25m. Output: 8-bit byte raster scaled 0-255 from GRIDCODE 0-1
# (the network contribution score is always in [0,1])
echo ""
echo "=== rasterizing ==="
i=0
while IFS='|' read -r base src layer; do
    i=$((i+1))
    out="$OUT/$base.tif"
    if [ -f "$out" ]; then
        echo "  [$i] cached $base"
        continue
    fi
    if [ -n "${layer:-}" ]; then
        "/c/Program Files/GDAL/gdal_rasterize.exe" -q -tr 25 25 -ot Float32 -a_nodata -9999 \
            -a GRIDCODE -a_srs EPSG:29902 \
            -co COMPRESS=LZW -co TILED=YES \
            -l "$layer" "$src" "$out" 2>&1 | tail -2 || true
    else
        layer_name=$(basename "$src" .shp)
        "/c/Program Files/GDAL/gdal_rasterize.exe" -q -tr 25 25 -ot Float32 -a_nodata -9999 \
            -a GRIDCODE -a_srs EPSG:29902 \
            -co COMPRESS=LZW -co TILED=YES \
            -l "$layer_name" "$src" "$out" 2>&1 | tail -2 || true
    fi
    sz=$(stat -c%s "$out" 2>/dev/null || echo 0)
    echo "  [$i] $base → $((sz/1024)) KB"
done < "$OUT/sources.txt"

echo ""
echo "=== mosaicking ==="
ls "$OUT"/*.tif | grep -v float > "$OUT/mosaic-list.txt"
"/c/Program Files/GDAL/gdalbuildvrt.exe" -q -srcnodata -9999 -vrtnodata -9999 \
    -input_file_list "$OUT/mosaic-list.txt" "$OUT/network-contribution-mosaic.vrt"
"/c/Program Files/GDAL/gdalinfo.exe" "$OUT/network-contribution-mosaic.vrt" 2>&1 | grep -E "^(Size|Pixel)"

echo ""
echo "=== applying inferno colour ramp (GRIDCODE range ~58-100) ==="
# Inferno colormap stops mapped onto the actual data range
cat > "$OUT/inferno.txt" <<EOF
nv 0 0 0 0
55 0 0 4 255
60 31 12 72 255
65 85 15 109 255
70 136 34 106 255
75 186 54 85 255
80 227 89 51 255
85 251 135 25 255
90 251 184 26 255
95 248 230 89 255
100 252 255 164 255
EOF
"/c/Program Files/GDAL/gdaldem.exe" color-relief -q -alpha \
    "$OUT/network-contribution-mosaic.vrt" "$OUT/inferno.txt" "$OUT/network-contribution-rgba.tif" \
    -co COMPRESS=LZW -co TILED=YES

echo ""
echo "=== generating tile pyramid z6-13 ==="
rm -rf "$OUT/tiles"
"/c/Program Files/GDAL/gdal.exe" raster tile --webviewer=none --convention=xyz \
    --min-zoom=6 --max-zoom=13 -r cubic --skip-blank \
    "$OUT/network-contribution-rgba.tif" "$OUT/tiles" 2>&1 | tail -3

count=$(find "$OUT/tiles" -name '*.png' | wc -l)
size=$(du -sh "$OUT/tiles" | cut -f1)
echo "  done: $count tiles, $size"
