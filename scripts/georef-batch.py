"""
Batch georeferencing runner.

Processes maps defined in georef-batch.json, downloading scans from
Internet Archive, running georef.py on each, and recording results.

Usage:
  python scripts/georef-batch.py [--config data/database/georef-batch.json] \
    [--filter "wards85-*"] [--force] [--dry-run] [--apply]
"""
import argparse, json, os, sys, subprocess, time, fnmatch, shutil
from urllib.request import urlretrieve
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description='Batch georeferencing runner')
    p.add_argument('--config', default='data/database/georef-batch.json', help='Batch config file')
    p.add_argument('--filter', default=None, help='Glob pattern to filter map IDs (e.g. "wards85-*")')
    p.add_argument('--force', action='store_true', help='Re-process even if output exists')
    p.add_argument('--dry-run', action='store_true', help='Print what would be done without doing it')
    p.add_argument('--apply', action='store_true', help='Apply results to maps.json')
    p.add_argument('--results', default='data/maps/raster/_batch_results.json', help='Results file path')
    return p.parse_args()


def download_file(url, dest):
    """Download a file, handling URL-encoded filenames."""
    if os.path.exists(dest):
        return True
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"    Downloading {os.path.basename(dest)}...")
    try:
        r = subprocess.run(
            ['curl', '-sL', '-o', dest, '--retry', '3', url],
            capture_output=True, text=True, timeout=300
        )
        if r.returncode != 0 or not os.path.exists(dest) or os.path.getsize(dest) < 1000:
            print(f"    FAILED: {r.stderr[:200]}")
            if os.path.exists(dest):
                os.remove(dest)
            return False
        return True
    except Exception as e:
        print(f"    FAILED: {e}")
        return False


def ia_download_url(ia_id, ia_file):
    """Build Internet Archive download URL with proper encoding."""
    from urllib.parse import quote
    return f"https://archive.org/download/{quote(ia_id)}/{quote(ia_file)}"


def run_georef(scan_path, vector_url, output_path, filter_field=None, filter_value=None,
               output_width=4096, cache_dir='data/maps/raster/_cache'):
    """Run georef.py and return (success, summary_dict)."""
    # Download vector if remote
    if vector_url.startswith('http'):
        vec_name = vector_url.split('/')[-1]
        vec_path = os.path.join(cache_dir, vec_name)
        if not download_file(vector_url, vec_path):
            return False, {"error": "vector download failed"}
    else:
        vec_path = vector_url

    cmd = [sys.executable, 'scripts/georef.py', scan_path, vec_path, output_path,
           '--auto-bounds', '--output-width', str(output_width), '--json']

    if filter_field and filter_value:
        cmd.extend(['--filter-field', filter_field, '--filter-value', filter_value])

    print(f"    Running georef.py...")
    start = time.time()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        elapsed = time.time() - start

        # Parse JSON summary from last line of stdout
        summary = None
        for line in reversed(r.stdout.strip().split('\n')):
            line = line.strip()
            if line.startswith('{'):
                try:
                    summary = json.loads(line)
                    break
                except json.JSONDecodeError:
                    pass

        if r.returncode != 0:
            # Extract error from stderr or stdout
            err_msg = r.stderr[:300] if r.stderr else r.stdout[-300:] if r.stdout else 'unknown error'
            print(f"    FAILED ({elapsed:.0f}s): {err_msg[:100]}")
            return False, {"error": err_msg, "elapsed": elapsed}

        if not os.path.exists(output_path):
            print(f"    FAILED: output file not created")
            return False, {"error": "no output file", "elapsed": elapsed}

        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"    OK ({elapsed:.0f}s, {size_mb:.1f}MB)")

        result = {
            "elapsed": round(elapsed, 1),
            "size_mb": round(size_mb, 1),
        }
        if summary:
            result.update(summary)
        return True, result

    except subprocess.TimeoutExpired:
        print(f"    TIMEOUT (600s)")
        return False, {"error": "timeout"}
    except Exception as e:
        print(f"    ERROR: {e}")
        return False, {"error": str(e)}


def get_bounds_from_aux(png_path):
    """Try to extract bounds from the GDAL .aux.xml file."""
    aux = png_path + '.aux.xml'
    if not os.path.exists(aux):
        return None
    try:
        r = subprocess.run(f'gdalinfo -json {png_path}', shell=True,
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return None
        info = json.loads(r.stdout)
        corners = info.get('cornerCoordinates', {})
        ul = corners.get('upperLeft', [])
        lr = corners.get('lowerRight', [])
        if len(ul) >= 2 and len(lr) >= 2:
            return [[lr[1], ul[0]], [ul[1], lr[0]]]  # [[S, W], [N, E]]
    except:
        pass
    return None


def apply_to_maps_json(results, config, maps_json_path='data/database/maps.json'):
    """Generate maps.json updates from batch results."""
    with open(maps_json_path) as f:
        maps_data = json.load(f)

    maps_list = maps_data.get('maps', [])
    maps_by_id = {m['id']: m for m in maps_list if isinstance(m, dict) and 'id' in m}
    vectors = config.get('vectors', {})

    added_variants = 0
    added_standalone = 0

    for map_entry in config['maps']:
        if 'id' not in map_entry:
            continue
        mid = map_entry['id']
        result = results.get(mid)
        if not result or not result.get('success'):
            continue

        output_path = result.get('output', f"data/maps/raster/{mid}.png")
        bounds = result.get('bounds')
        if not bounds:
            bounds = get_bounds_from_aux(output_path)
        if not bounds:
            continue

        parent_id = map_entry.get('parent_map')
        label = map_entry.get('label', mid)
        date = map_entry.get('date')
        raster_id = f"{parent_id}-{mid}-raster" if parent_id else f"{mid}-raster"

        # Add variant to parent map
        if parent_id and parent_id in maps_by_id:
            parent = maps_by_id[parent_id]
            if 'variants' not in parent:
                parent['variants'] = []
            # Check if variant already exists
            existing_ids = {v.get('id') for v in parent['variants']}
            if raster_id not in existing_ids:
                parent['variants'].append({
                    "id": raster_id,
                    "label": f"{label} (Historic Map Scan)",
                    "files": {"image": output_path}
                })
                added_variants += 1

        # Only add standalone entry if there's no parent map to attach the variant to
        if not parent_id and raster_id not in maps_by_id:
            standalone = {
                "id": raster_id,
                "name": f"{label} (Raster)",
                "slug": raster_id,
                "category": "local-government",
                "hidden": True,
                "featured": False,
                "files": {"image": output_path},
                "bounds": bounds,
                "opacity": 0.8,
                "style": {"color": "#DA70D6", "weight": 0},
            }
            if date:
                standalone["date"] = date
            maps_list.append(standalone)
            added_standalone += 1

    maps_data['maps'] = maps_list

    # Write updated maps.json
    with open(maps_json_path, 'w') as f:
        json.dump(maps_data, f, indent=2, ensure_ascii=False)

    print(f"\nApplied to maps.json: {added_variants} variants, {added_standalone} standalone entries")


def main():
    args = parse_args()

    with open(args.config) as f:
        config = json.load(f)

    defaults = config.get('defaults', {})
    output_dir = defaults.get('output_dir', 'data/maps/raster')
    cache_dir = defaults.get('cache_dir', 'data/maps/raster/_cache')
    default_width = defaults.get('output_width', 4096)
    vectors = config.get('vectors', {})

    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)

    # Filter maps
    maps = [m for m in config['maps'] if 'id' in m]
    if args.filter:
        maps = [m for m in maps if fnmatch.fnmatch(m['id'], args.filter)]

    # Skip already-done overview
    maps = [m for m in maps if m.get('_status') != 'already georeferenced']

    print(f"Batch georeferencing: {len(maps)} maps to process")
    print(f"Output: {output_dir}/")
    print(f"Cache: {cache_dir}/")
    if args.dry_run:
        print("DRY RUN — no processing will be done")
    print()

    # Load existing results
    results = {}
    if os.path.exists(args.results):
        with open(args.results) as f:
            results = json.load(f)

    processed = 0
    succeeded = 0
    failed = 0
    skipped = 0

    for i, m in enumerate(maps):
        mid = m['id']
        output_path = os.path.join(output_dir, f"{mid}.png")
        print(f"[{i+1}/{len(maps)}] {mid}: {m.get('label', '')}")

        # Skip if already done
        if os.path.exists(output_path) and not args.force:
            if mid in results and results[mid].get('success'):
                print(f"  Skipped (already done)")
                skipped += 1
                continue

        if args.dry_run:
            ia_url = ia_download_url(m['ia_id'], m['ia_file'])
            vec_key = m['vector']
            vec_url = vectors[vec_key]['url']
            ff = vectors[vec_key].get('filter_field', '')
            fv = m.get('filter_value', '')
            print(f"  Would download: {ia_url}")
            print(f"  Vector: {vec_url}" + (f" [{ff}='{fv}']" if fv else ""))
            print(f"  Output: {output_path}")
            continue

        # Download scan from IA
        scan_url = ia_download_url(m['ia_id'], m['ia_file'])
        scan_ext = os.path.splitext(m['ia_file'])[1]
        scan_path = os.path.join(cache_dir, f"{mid}{scan_ext}")
        if not download_file(scan_url, scan_path):
            results[mid] = {"success": False, "error": "scan download failed"}
            failed += 1
            continue

        # Resolve vector
        vec_key = m['vector']
        vec_cfg = vectors[vec_key]
        vec_url = vec_cfg['url']
        filter_field = vec_cfg.get('filter_field')
        filter_value = m.get('filter_value')

        # Run georef
        width = m.get('output_width', default_width)
        success, summary = run_georef(
            scan_path, vec_url, output_path,
            filter_field=filter_field if filter_value else None,
            filter_value=filter_value,
            output_width=width,
            cache_dir=cache_dir
        )

        summary['success'] = success
        summary['output'] = output_path.replace('\\', '/')
        summary['ia_id'] = m['ia_id']

        # Try to get bounds
        if success:
            bounds = get_bounds_from_aux(output_path)
            if bounds:
                summary['bounds'] = bounds

        results[mid] = summary
        processed += 1
        if success:
            succeeded += 1
        else:
            failed += 1

        # Save results incrementally
        with open(args.results, 'w') as f:
            json.dump(results, f, indent=2)

    # Summary
    print(f"\n{'='*60}")
    print(f"BATCH COMPLETE")
    print(f"  Processed: {processed}")
    print(f"  Succeeded: {succeeded}")
    print(f"  Failed: {failed}")
    print(f"  Skipped: {skipped}")
    print(f"  Results: {args.results}")

    if failed > 0:
        print(f"\nFailed maps:")
        for mid, r in results.items():
            if not r.get('success'):
                print(f"  {mid}: {r.get('error', '?')[:80]}")

    # Apply to maps.json if requested
    if args.apply and succeeded > 0:
        apply_to_maps_json(results, config)


if __name__ == '__main__':
    main()
