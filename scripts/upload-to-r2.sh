#!/bin/bash
# Upload FGB map data to Cloudflare R2.
# Prerequisites: wrangler authenticated (run: npx wrangler login)
#
# Usage: bash scripts/upload-to-r2.sh

set -euo pipefail

BUCKET="boundaries-maps"
MAP_DIR="data/maps"

echo "Uploading FGB files to R2 bucket: $BUCKET"
echo ""

COUNT=0
TOTAL=$(find "$MAP_DIR" -name "*.fgb" -o -name "*.fgb.gz" | wc -l)

find "$MAP_DIR" -name "*.fgb" -o -name "*.fgb.gz" | while read -r f; do
    COUNT=$((COUNT + 1))
    KEY="${f#data/maps/}"

    if [ $((COUNT % 20)) -eq 0 ] || [ $COUNT -eq 1 ]; then
        echo "  [$COUNT/$TOTAL] $KEY"
    fi

    npx wrangler r2 object put "$BUCKET/$KEY" --file "$f" --content-type "application/octet-stream" 2>/dev/null
done

echo ""
echo "Done. Uploaded $TOTAL files to $BUCKET."
