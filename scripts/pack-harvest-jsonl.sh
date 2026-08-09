#!/usr/bin/env bash
# Compress the append-only JSONL stores and place a verified copy on both drives.
#
# The written-answers sweep produced 4.47 GB of JSONL AFTER pack-harvest-trees.sh
# ran, so no archive contains it. That data -- the product of 304,370 requests --
# currently exists in exactly one place, on an exFAT volume with no journaling
# and no crash consistency. Everything else from the harvest has two copies; this
# had none.
#
# The working .jsonl files are left in place: the harvesters read them directly
# and compressing in place would break resumption. These are additional copies,
# not a replacement.
#
# Verification is by record count, not just gzip's CRC. A CRC proves the bytes
# survived compression; counting the lines back out proves the file holds the
# number of records it should, which is the property that actually matters.
#
# Usage: bash scripts/pack-harvest-jsonl.sh <source-tree> <primary-packs> <mirror-packs>
set -uo pipefail

SRC="${1:-/d/niassembly-xml-only}"
P1="${2:-/c/harvest-packs}"
P2="${3:-/d/harvest-packs}"
tname=$(basename "$SRC")

fail=0
found=0
while IFS= read -r j; do
  found=$((found+1))
  svc=$(basename "$(dirname "$j")")
  op=$(basename "$j" .jsonl)
  dest1="$P1/$tname/$svc/${op}.jsonl.gz"
  dest2="$P2/$tname/$svc/${op}.jsonl.gz"
  mkdir -p "$(dirname "$dest1")" "$(dirname "$dest2")"

  src_lines=$(wc -l < "$j" | tr -d ' ')
  src_bytes=$(stat -c %s "$j")

  echo "  packing $svc/$op  ($src_lines records, $(numfmt --to=iec "$src_bytes" 2>/dev/null || echo "$src_bytes"))"
  gzip -c -6 "$j" > "$dest1" || { echo "    FAIL gzip"; fail=$((fail+1)); continue; }

  if ! gzip -t "$dest1" 2>/dev/null; then echo "    FAIL gzip -t"; fail=$((fail+1)); continue; fi
  out_lines=$(gzip -cd "$dest1" | wc -l | tr -d ' ')
  if [ "$out_lines" != "$src_lines" ]; then
    echo "    FAIL record count: source $src_lines, archive $out_lines"
    fail=$((fail+1)); continue
  fi

  cp -f "$dest1" "$dest2" || { echo "    FAIL copy to mirror"; fail=$((fail+1)); continue; }
  h1=$(sha256sum "$dest1" | cut -d' ' -f1)
  h2=$(sha256sum "$dest2" | cut -d' ' -f1)
  if [ "$h1" != "$h2" ]; then echo "    FAIL mirror hash differs"; fail=$((fail+1)); continue; fi

  echo "    ok  $src_lines records  $(numfmt --to=iec "$(stat -c %s "$dest1")" 2>/dev/null) compressed  sha256 ${h1:0:16}  on both drives"
done < <(find "$SRC" -name '*.jsonl' -type f 2>/dev/null | LC_ALL=C sort)

echo ""
echo "  jsonl stores found: $found   failures: $fail"
[ "$fail" -eq 0 ] && echo "  every JSONL store now has a verified copy on both drives." || echo "  NOT SAFE -- $fail store(s) failed."
exit "$fail"
