#!/usr/bin/env bash
# Pack each harvested operation into one tar.gz, and prove the pack is complete
# before anything is deleted.
#
# WHY THIS EXISTS
#
# D: is exFAT with a 256 KB allocation unit -- measured, not assumed: 200
# one-byte files consumed exactly 52,428,800 bytes. Every 2 KB JSON response
# therefore costs 256 KB of disk. Across the two NI Assembly trees:
#
#   niassembly-opendata  355,208 files   1.57 GB of data   87.68 GB on disk
#   niassembly-xml-only   85,795 files   0.18 GB of data   20.95 GB on disk
#
# That is 106.88 GB of pure allocation slack -- 1.75 GB of content occupying
# 108.63 GB. One file per record is a fine design on 4 KB NTFS and a disaster
# here. Packing each operation into a single archive removes the per-file floor.
#
# The Oireachtas trees are deliberately NOT packed: their files are large
# (oireachtas-fulltext averages ~600 KB), so slack is only 5.08 GB of 28.75 GB
# and packing would trade real random access for little gain.
#
# FORMAT: tar.gz per operation. These are raw API responses and the whole point
# of storing them unparsed is that the bytes are what the service returned, so
# the archive must round-trip exactly. JSONL would require re-serialising the
# JSON (losing original formatting) and cannot cleanly hold XML, which contains
# newlines. gzip's CRC32 also covers content integrity end to end.
#
# SAFETY: this script only WRITES. It never deletes a source file. Verification
# is a separate, explicit step and deletion is a separate decision.
#
# Usage:
#   bash scripts/pack-harvest-trees.sh <out-dir> [tree ...]

set -uo pipefail

OUT="${1:-}"
[ -n "$OUT" ] || { echo "Usage: bash scripts/pack-harvest-trees.sh <out-dir> [tree ...]"; exit 2; }
shift || true
TREES=("$@")
[ ${#TREES[@]} -gt 0 ] || TREES=(/d/niassembly-opendata /d/niassembly-xml-only)

mkdir -p "$OUT"
LOG="$OUT/_pack-log.tsv"
printf 'tree\tservice\toperation\tsrc_files\tsrc_bytes\tarchive_bytes\tmembers\tverdict\n' > "$LOG"

total_src=0; total_arc=0; ok=0; bad=0

for tree in "${TREES[@]}"; do
  tname=$(basename "$tree")
  [ -d "$tree" ] || { echo "  MISSING TREE: $tree"; continue; }
  echo ""
  echo "=== $tname ==="

  # <tree>/<service>/<operation>
  while IFS= read -r opdir; do
    svc=$(basename "$(dirname "$opdir")")
    op=$(basename "$opdir")
    dest="$OUT/$tname/$svc"
    mkdir -p "$dest"
    arc="$dest/$op.tar.gz"

    # Source truth: name and size of every regular file, sorted.
    srcman=$(cd "$opdir" && find . -type f -printf '%P\t%s\n' 2>/dev/null | LC_ALL=C sort)
    src_files=$(printf '%s' "$srcman" | grep -c . || true)
    src_bytes=$(printf '%s\n' "$srcman" | awk -F'\t' '{s+=$2} END{print s+0}')

    if [ "${src_files:-0}" -eq 0 ]; then
      printf '%s\t%s\t%s\t0\t0\t0\t0\tEMPTY-SKIPPED\n' "$tname" "$svc" "$op" >> "$LOG"
      echo "  skip (empty)  $svc/$op"
      continue
    fi

    # -C the service dir so members are stored as <operation>/<file>.
    if ! tar -czf "$arc" -C "$tree/$svc" "$op" 2>/dev/null; then
      printf '%s\t%s\t%s\t%s\t%s\t0\t0\tTAR-FAILED\n' "$tname" "$svc" "$op" "$src_files" "$src_bytes" >> "$LOG"
      echo "  FAIL tar      $svc/$op"; bad=$((bad+1)); continue
    fi

    # (1) gzip CRC over the whole stream -- catches truncation and corruption.
    if ! gzip -t "$arc" 2>/dev/null; then
      printf '%s\t%s\t%s\t%s\t%s\t0\t0\tGZIP-CRC-FAILED\n' "$tname" "$svc" "$op" "$src_files" "$src_bytes" >> "$LOG"
      echo "  FAIL gzip -t  $svc/$op"; bad=$((bad+1)); continue
    fi

    # (2) name+size multiset of members must equal the source exactly. Strips the
    # stored "<operation>/" prefix so the two lists are directly comparable.
    arcman=$(tar -tzvf "$arc" 2>/dev/null | awk -v p="$op/" '
      $0 !~ /^d/ {
        size=$3; name=$0
        sub(/^([^ ]+ +){5}/, "", name)
        sub("^" p, "", name)
        if (name != "") printf "%s\t%s\n", name, size
      }' | LC_ALL=C sort)
    members=$(printf '%s' "$arcman" | grep -c . || true)
    arc_bytes=$(stat -c %s "$arc" 2>/dev/null || echo 0)

    if [ "$arcman" = "$srcman" ]; then
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\tOK\n' "$tname" "$svc" "$op" "$src_files" "$src_bytes" "$arc_bytes" "$members" >> "$LOG"
      printf '  ok  %7d files  %9s -> %9s  %s/%s\n' "$src_files" \
        "$(numfmt --to=iec "$src_bytes" 2>/dev/null || echo "$src_bytes")" \
        "$(numfmt --to=iec "$arc_bytes" 2>/dev/null || echo "$arc_bytes")" "$svc" "$op"
      ok=$((ok+1)); total_src=$((total_src+src_bytes)); total_arc=$((total_arc+arc_bytes))
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\tMANIFEST-MISMATCH\n' "$tname" "$svc" "$op" "$src_files" "$src_bytes" "$arc_bytes" "$members" >> "$LOG"
      echo "  FAIL manifest $svc/$op  (src $src_files members $members)"
      bad=$((bad+1))
    fi
  done < <(find "$tree" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | LC_ALL=C sort)
done

echo ""
echo "  archives OK: $ok   FAILED: $bad"
echo "  content packed: $(numfmt --to=iec "$total_src" 2>/dev/null || echo "$total_src")"
echo "  archive total : $(numfmt --to=iec "$total_arc" 2>/dev/null || echo "$total_arc")"
echo "  log: $LOG"
[ "$bad" -eq 0 ] || { echo "  NOT SAFE TO DELETE SOURCES -- $bad archive(s) failed verification."; exit 1; }
echo "  every archive verified against its source manifest."
