#!/usr/bin/env python3
"""
Pre-compress FlatGeobuf files to .fgb.gz for client-side decompression with Pako.
Neocities may not gzip binary .fgb files automatically, so we compress at build time.

Usage:
    python scripts/gzip_fgb_files.py [--dry-run]
"""

import gzip
import os
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / 'data' / 'maps'
COMPRESSION_LEVEL = 9  # Max compression


def main():
    dry_run = '--dry-run' in sys.argv
    total_original = 0
    total_compressed = 0
    count = 0

    for fgb_path in sorted(DATA_DIR.rglob('*.fgb')):
        gz_path = fgb_path.with_suffix('.fgb.gz')
        original_size = fgb_path.stat().st_size

        # Skip if .gz already exists and is newer than the source
        if gz_path.exists() and gz_path.stat().st_mtime >= fgb_path.stat().st_mtime:
            compressed_size = gz_path.stat().st_size
            total_original += original_size
            total_compressed += compressed_size
            count += 1
            continue

        if dry_run:
            print(f'[DRY RUN] Would compress: {fgb_path.relative_to(DATA_DIR.parent.parent)}')
            total_original += original_size
            count += 1
            continue

        with open(fgb_path, 'rb') as f_in:
            data = f_in.read()

        with gzip.open(gz_path, 'wb', compresslevel=COMPRESSION_LEVEL) as f_out:
            f_out.write(data)

        compressed_size = gz_path.stat().st_size
        ratio = compressed_size / original_size * 100 if original_size > 0 else 0
        total_original += original_size
        total_compressed += compressed_size
        count += 1

        print(f'{fgb_path.relative_to(DATA_DIR.parent.parent)}: '
              f'{original_size:,} -> {compressed_size:,} ({ratio:.1f}%)')

    print(f'\n--- Summary ---')
    print(f'Files: {count}')
    if not dry_run and total_original > 0:
        print(f'Total original:   {total_original:,.0f} bytes ({total_original / 1024 / 1024:.1f} MB)')
        print(f'Total compressed: {total_compressed:,.0f} bytes ({total_compressed / 1024 / 1024:.1f} MB)')
        print(f'Ratio: {total_compressed / total_original * 100:.1f}%')


if __name__ == '__main__':
    main()
