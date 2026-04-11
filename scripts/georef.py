"""
General-purpose raster map georeferencing via ICP dense boundary matching.

Aligns a raster map scan to vector boundaries by matching thousands of
boundary pixels. Supports:
- Clean outline image for best precision, or direct scan matching
- District filtering for per-district maps
- Auto-bounds from the warped result
- Auto-threshold via Otsu's method

Usage:
  python scripts/georef.py <scan.jpg> <vector.fgb> <output.png> \
    [--outline <outline.png>] \
    [--filter-field LGDNAME --filter-value BELFAST] \
    [--bounds W,S,E,N | --auto-bounds] \
    [--output-width 4096] \
    [--darkness-threshold 115] \
    [--json]
"""
import argparse, json, os, sys, subprocess, tempfile
import numpy as np
import cv2
from scipy.ndimage import distance_transform_edt
from scipy.interpolate import RBFInterpolator

TARGET_SRS = 'EPSG:29902'


# ═══════════════════════════════════════
#  CLI
# ═══════════════════════════════════════
def parse_args():
    p = argparse.ArgumentParser(description='Georeference a raster map scan against vector boundaries.')
    p.add_argument('scan', help='Raster scan image (JPG/PNG)')
    p.add_argument('vector', help='Vector boundaries (FGB/GeoJSON)')
    p.add_argument('output', help='Output georeferenced PNG')
    p.add_argument('--outline', help='Clean outline image (same pixel dims as scan, boundaries only on white)')
    p.add_argument('--filter-field', help='OGR attribute field for district filtering')
    p.add_argument('--filter-value', help='Attribute value to filter (e.g. BELFAST)')
    p.add_argument('--bounds', help='Output bounds as W,S,E,N (e.g. -8.3,53.95,-5.3,55.45)')
    p.add_argument('--auto-bounds', action='store_true', help='Derive bounds from warped result')
    p.add_argument('--output-width', type=int, default=4096, help='Output image width in pixels')
    p.add_argument('--darkness-threshold', type=int, default=None, help='Scan darkness threshold (0-255). Auto-detected if omitted.')
    p.add_argument('--json', action='store_true', help='Output machine-readable JSON summary to stdout')
    return p.parse_args()


# ═══════════════════════════════════════
#  VECTOR LOADING
# ═══════════════════════════════════════
def load_vector(fgb_path, filter_field=None, filter_value=None):
    """Load vector boundaries, optionally filtered to a single district."""
    tmp = tempfile.mktemp(suffix='.geojson')
    try:
        info = subprocess.run(['ogrinfo', '-al', '-so', fgb_path],
                              capture_output=True, text=True, timeout=30)
        if 'EPSG:' in info.stdout:
            cmd = ['ogr2ogr', '-f', 'GeoJSON', '-t_srs', TARGET_SRS, tmp, fgb_path]
        else:
            cmd = ['ogr2ogr', '-f', 'GeoJSON', '-s_srs', 'EPSG:4326',
                   '-t_srs', TARGET_SRS, tmp, fgb_path]
        if filter_field and filter_value:
            cmd.extend(['-where', f"{filter_field}='{filter_value}'"])
        subprocess.run(cmd, capture_output=True, timeout=60)
        with open(tmp) as f:
            content = f.read().strip()
        if not content:
            print(f"  WARNING: ogr2ogr produced empty output. Check filter field/value.")
            return []
        data = json.loads(content)
        rings = []
        for feat in data.get('features', []):
            geom = feat['geometry']
            polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
            for poly in polys:
                for ring in poly:
                    pts = np.array(ring)[:, :2]
                    if len(pts) > 5:
                        rings.append(pts)
        return rings
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def subsample_rings(rings, max_pts=1200):
    out = []
    for ring in rings:
        if len(ring) > max_pts:
            idx = np.linspace(0, len(ring)-1, max_pts, dtype=int)
            out.append(ring[idx])
        else:
            out.append(ring)
    return out


# ═══════════════════════════════════════
#  IMAGE PROCESSING
# ═══════════════════════════════════════
def load_and_binarise(image_path, threshold=None, is_outline=False):
    """Load image, convert to binary with dark features as white.
    Returns (binary, binary_wide, threshold_used)."""
    bgr = cv2.imread(image_path)
    if bgr is None:
        print(f"ERROR: cannot read {image_path}")
        sys.exit(1)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    if threshold is None:
        if is_outline:
            threshold = 200  # outlines: clean white bg, dark lines
        else:
            # Otsu's method for automatic threshold
            threshold, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
            # Otsu can be too aggressive; clamp to reasonable range
            threshold = max(80, min(int(threshold), 180))

    _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)
    binary_wide = cv2.dilate(binary,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)

    return binary, binary_wide, h, w, threshold


def extract_scan_mask(scan_bin, rings_sub, all_pts, cx, cy, scale, rot, margin=30):
    """Extract boundary-region mask from the scan using approximate vector positions.
    Keeps only scan pixels near expected boundary locations, filtering out roads/text."""
    h, w = scan_bin.shape
    mask = np.zeros((h, w), dtype=np.uint8)
    rot_rad = np.deg2rad(rot)
    cos_r, sin_r = np.cos(rot_rad), np.sin(rot_rad)
    e_ctr = (all_pts[:, 0].min() + all_pts[:, 0].max()) / 2
    n_ctr = (all_pts[:, 1].min() + all_pts[:, 1].max()) / 2

    for ring in rings_sub:
        dx = ring[:, 0] - e_ctr
        dy = ring[:, 1] - n_ctr
        rx = dx * cos_r - dy * sin_r
        ry = dx * sin_r + dy * cos_r
        px = (rx * scale + cx).astype(int)
        py = (-ry * scale + cy).astype(int)
        pts = np.column_stack([px, py]).reshape(-1, 1, 2)
        cv2.polylines(mask, [pts], True, 255, margin * 2)

    # Keep scan pixels that are both dark AND near expected boundaries
    result = cv2.bitwise_and(scan_bin, mask)
    result_wide = cv2.dilate(result,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)
    return result, result_wide


# ═══════════════════════════════════════
#  COARSE ALIGNMENT
# ═══════════════════════════════════════
def coarse_alignment(target_bin, rings_sub, all_pts):
    """Find approximate position, scale, rotation via template matching."""
    e_min, e_max = all_pts[:, 0].min(), all_pts[:, 0].max()
    n_min, n_max = all_pts[:, 1].min(), all_pts[:, 1].max()
    e_ctr, n_ctr = (e_min + e_max) / 2, (n_min + n_max) / 2
    ig_width = e_max - e_min
    ig_height = n_max - n_min

    oh, ow = target_bin.shape
    # Choose working scale: aim for ~800-1200px on the long side
    ws = min(0.15, 1000.0 / max(oh, ow))
    ws = max(ws, 0.03)  # don't go too small
    small = cv2.resize(target_bin, (int(ow * ws), int(oh * ws)))
    sh, sw = small.shape

    best_score, best = -1, None
    for rot_deg in np.linspace(-3, 3, 13):
        rot_rad = np.deg2rad(rot_deg)
        cos_r, sin_r = np.cos(rot_rad), np.sin(rot_rad)
        for sf in np.linspace(0.4, 3.0, 100):
            tmpl_scale = (sw * 0.55) / ig_width * sf
            tw = int(ig_width * tmpl_scale) + 20
            th = int(ig_height * tmpl_scale) + 20
            if tw > sw - 5 or th > sh - 5 or tw < 20 or th < 20:
                continue
            template = np.zeros((th, tw), dtype=np.uint8)
            for ring in rings_sub:
                dx = ring[:, 0] - e_ctr
                dy = ring[:, 1] - n_ctr
                rx = dx * cos_r - dy * sin_r
                ry = dx * sin_r + dy * cos_r
                px = (rx * tmpl_scale + tw / 2).astype(int)
                py = (-ry * tmpl_scale + th / 2).astype(int)
                cv2.polylines(template, [np.column_stack([px, py]).reshape(-1, 1, 2)], True, 255, 2)
            result = cv2.matchTemplate(small, template, cv2.TM_CCOEFF_NORMED)
            _, mv, _, ml = cv2.minMaxLoc(result)
            if mv > best_score:
                best_score = mv
                best = {
                    'scale': tmpl_scale / ws,
                    'cx': (ml[0] + tw / 2) / ws,
                    'cy': (ml[1] + th / 2) / ws,
                    'rotation': rot_deg,
                }

    return best, best_score, e_ctr, n_ctr


# ═══════════════════════════════════════
#  ICP FUNCTIONS
# ═══════════════════════════════════════
def ig_to_pixel(pts, e_ctr, n_ctr, cx, cy, scale, rotation=0):
    rot_rad = np.deg2rad(rotation)
    cos_r, sin_r = np.cos(rot_rad), np.sin(rot_rad)
    dx = pts[:, 0] - e_ctr
    dy = pts[:, 1] - n_ctr
    rx = dx * cos_r - dy * sin_r
    ry = dx * sin_r + dy * cos_r
    px = rx * scale + cx
    py = -ry * scale + cy
    return np.column_stack([px, py])


def render_vector(rings_sub, oh, ow, e_ctr, n_ctr, cx, cy, scale, rotation=0):
    img = np.zeros((oh, ow), dtype=np.uint8)
    for ring in rings_sub:
        pixels = ig_to_pixel(ring, e_ctr, n_ctr, cx, cy, scale, rotation)
        pts = pixels.astype(int).reshape(-1, 1, 2)
        cv2.polylines(img, [pts], True, 255, 1)
    return img


def find_correspondences(vec_img, raster_bin, max_dist=30):
    dist, indices = distance_transform_edt(raster_bin == 0, return_indices=True)
    vec_ys, vec_xs = np.where(vec_img > 0)
    if len(vec_ys) == 0:
        return np.array([]), np.array([]), np.array([])
    h, w = raster_bin.shape
    valid = (vec_ys >= 0) & (vec_ys < h) & (vec_xs >= 0) & (vec_xs < w)
    vec_xs, vec_ys = vec_xs[valid], vec_ys[valid]
    vec_points = np.column_stack([vec_xs, vec_ys]).astype(float)
    nearest_ys = indices[0, vec_ys, vec_xs]
    nearest_xs = indices[1, vec_ys, vec_xs]
    raster_points = np.column_stack([nearest_xs, nearest_ys]).astype(float)
    distances = dist[vec_ys, vec_xs]
    close = distances < max_dist
    return vec_points[close], raster_points[close], distances[close]


def fit_deformation(vec_pts, raster_pts, grid_spacing=100, smoothing=500):
    displacements = raster_pts - vec_pts
    x_min, x_max = vec_pts[:, 0].min(), vec_pts[:, 0].max()
    y_min, y_max = vec_pts[:, 1].min(), vec_pts[:, 1].max()
    grid_xs = np.arange(x_min, x_max, grid_spacing)
    grid_ys = np.arange(y_min, y_max, grid_spacing)

    sampled_pts, sampled_dx, sampled_dy = [], [], []
    for gx in grid_xs:
        for gy in grid_ys:
            dists = np.sqrt((vec_pts[:, 0] - gx)**2 + (vec_pts[:, 1] - gy)**2)
            nearby = dists < grid_spacing * 0.7
            if nearby.sum() < 5:
                continue
            sampled_pts.append([gx, gy])
            sampled_dx.append(np.median(displacements[nearby, 0]))
            sampled_dy.append(np.median(displacements[nearby, 1]))

    if len(sampled_pts) < 4:
        return None

    sampled_pts = np.array(sampled_pts)
    sampled_dx = np.array(sampled_dx)
    sampled_dy = np.array(sampled_dy)
    print(f"    Grid samples: {len(sampled_pts)}, "
          f"median displacement: ({np.median(sampled_dx):.1f}, {np.median(sampled_dy):.1f})px")

    rbf_dx = RBFInterpolator(sampled_pts, sampled_dx, kernel='thin_plate_spline', smoothing=smoothing)
    rbf_dy = RBFInterpolator(sampled_pts, sampled_dy, kernel='thin_plate_spline', smoothing=smoothing)
    return rbf_dx, rbf_dy, sampled_pts


def run_icp(target_bin_wide, rings_sub, all_pts, oh, ow, cx, cy, scale, rot, e_ctr, n_ctr,
            n_iter=6, max_dist_start=50, max_dist_end=15):
    """Run ICP iterations, return updated alignment and final RBF."""
    final_rbf_dx, final_rbf_dy = None, None

    for iteration in range(n_iter):
        max_dist = max_dist_start - (max_dist_start - max_dist_end) * iteration / max(n_iter - 1, 1)
        print(f"\n  --- Iteration {iteration+1}/{n_iter} (max_dist={max_dist:.0f}px) ---")

        vec_img = render_vector(rings_sub, oh, ow, e_ctr, n_ctr, cx, cy, scale, rot)
        n_vec_px = (vec_img > 0).sum()

        vec_pts, raster_pts, dists = find_correspondences(vec_img, target_bin_wide, max_dist=max_dist)
        if len(vec_pts) < 50:
            print(f"    Too few correspondences ({len(vec_pts)}), stopping.")
            break
        print(f"    Correspondences: {len(vec_pts)} / {n_vec_px} ({100*len(vec_pts)/max(n_vec_px,1):.0f}%)")
        print(f"    Distance: mean={dists.mean():.1f}px, median={np.median(dists):.1f}px")

        grid_sp = max(80, 200 - iteration * 30)
        smooth = max(50, 500 - iteration * 80)
        result = fit_deformation(vec_pts, raster_pts, grid_spacing=grid_sp, smoothing=smooth)
        if result is None:
            print("    Could not fit deformation, stopping.")
            break

        rbf_dx, rbf_dy, _ = result
        final_rbf_dx, final_rbf_dy = rbf_dx, rbf_dy

        # Extract global correction from RBF
        centroid_pt = np.array([[cx, cy]])
        dcx = float(rbf_dx(centroid_pt).ravel()[0])
        dcy = float(rbf_dy(centroid_pt).ravel()[0])

        r = min(2000, min(ow, oh) * 0.3)
        cardinal = np.array([[cx+r, cy], [cx-r, cy], [cx, cy+r], [cx, cy-r]])
        cdx = rbf_dx(cardinal).ravel()
        cdy = rbf_dy(cardinal).ravel()

        d_right = np.array([cdx[0] - dcx, cdy[0] - dcy])
        d_left = np.array([cdx[1] - dcx, cdy[1] - dcy])
        d_down = np.array([cdx[2] - dcx, cdy[2] - dcy])
        d_up = np.array([cdx[3] - dcx, cdy[3] - dcy])

        sx = (d_right[0] - d_left[0]) / (2 * r)
        sy = (d_down[1] - d_up[1]) / (2 * r)
        ds = (sx + sy) / 2
        dr = ((d_right[1] - d_left[1]) / (2*r) - (d_down[0] - d_up[0]) / (2*r)) / 2

        cx += dcx
        cy += dcy
        scale *= (1 + ds)
        rot += np.rad2deg(dr)

        print(f"    Correction: dcx={dcx:.1f}, dcy={dcy:.1f}, dscale={ds*100:.3f}%, drot={np.rad2deg(dr)*1000:.1f}mdeg")

    return cx, cy, scale, rot, final_rbf_dx, final_rbf_dy


# ═══════════════════════════════════════
#  GCP BUILDING & WARP
# ═══════════════════════════════════════
def build_gcps(rings_sub, all_pts, target_bin_wide, oh, ow, cx, cy, scale, rot, e_ctr, n_ctr,
               sw_s, sh_s, n_grid=25):
    """Build GCPs from a final correspondence pass with RBF local corrections."""
    vec_img = render_vector(rings_sub, oh, ow, e_ctr, n_ctr, cx, cy, scale, rot)
    n_vec = (vec_img > 0).sum()
    vec_pts, raster_pts, dists = find_correspondences(vec_img, target_bin_wide, max_dist=25)
    print(f"  Final correspondences: {len(vec_pts)} / {n_vec} "
          f"({100*len(vec_pts)/max(n_vec,1):.0f}%)")
    if len(vec_pts) > 0:
        print(f"  Distance: mean={dists.mean():.2f}px, median={np.median(dists):.1f}px")

    result = fit_deformation(vec_pts, raster_pts, grid_spacing=60, smoothing=30)
    if result is None:
        print("  WARNING: could not fit final deformation, using global alignment only")
        final_rbf_dx, final_rbf_dy = None, None
    else:
        final_rbf_dx, final_rbf_dy, _ = result

    e_min, e_max = all_pts[:, 0].min(), all_pts[:, 0].max()
    n_min, n_max = all_pts[:, 1].min(), all_pts[:, 1].max()

    gcps = []
    grid_ig = []
    grid_base_px = []
    for i in range(n_grid):
        for j in range(n_grid):
            ig_e = e_min + (e_max - e_min) * (i + 0.5) / n_grid
            ig_n = n_min + (n_max - n_min) * (j + 0.5) / n_grid
            pt = np.array([[ig_e, ig_n]])
            spx = ig_to_pixel(pt, e_ctr, n_ctr, cx, cy, scale, rot)
            px_x, px_y = spx[0]
            if 0 < px_x < ow and 0 < px_y < oh:
                grid_ig.append((ig_e, ig_n))
                grid_base_px.append((px_x, px_y))

    if final_rbf_dx is not None and len(grid_base_px) > 0:
        base_arr = np.array(grid_base_px)
        local_dx = final_rbf_dx(base_arr).ravel()
        local_dy = final_rbf_dy(base_arr).ravel()
        print(f"  Local RBF corrections: mean=({np.mean(local_dx):.2f},{np.mean(local_dy):.2f})px, "
              f"std=({np.std(local_dx):.2f},{np.std(local_dy):.2f})px")
        for k, (ig_e, ig_n) in enumerate(grid_ig):
            scan_x = grid_base_px[k][0] + local_dx[k]
            scan_y = grid_base_px[k][1] + local_dy[k]
            if 0 < scan_x < sw_s and 0 < scan_y < sh_s:
                gcps.append((scan_x, scan_y, ig_e, ig_n))
    else:
        for k, (ig_e, ig_n) in enumerate(grid_ig):
            px_x, px_y = grid_base_px[k]
            if 0 < px_x < sw_s and 0 < px_y < sh_s:
                gcps.append((px_x, px_y, ig_e, ig_n))

    return gcps


def get_auto_bounds(tif_path):
    """Extract geographic bounds from a GeoTIFF via gdalinfo."""
    r = subprocess.run(f'gdalinfo -json {tif_path}', shell=True,
                       capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        return None
    info = json.loads(r.stdout)
    corners = info.get('cornerCoordinates', {})
    ul = corners.get('upperLeft', [])
    lr = corners.get('lowerRight', [])
    if len(ul) >= 2 and len(lr) >= 2:
        w, n = ul[0], ul[1]
        e, s = lr[0], lr[1]
        # Add 2% margin
        dw = (e - w) * 0.02
        dh = (n - s) * 0.02
        return f"-te {w-dw} {s-dh} {e+dw} {n+dh}"
    return None


def warp_and_output(gcps, scan_path, output_path, sw_s, sh_s, bounds_str, output_width, auto_bounds):
    """Write VRT with GCPs, warp via GDAL, output PNG with alpha."""
    vrt_gcps = '\n'.join(
        f'  <GCP Id="{i}" Pixel="{px:.1f}" Line="{py:.1f}" X="{e:.1f}" Y="{n:.1f}" />'
        for i, (px, py, e, n) in enumerate(gcps)
    )
    vrt_content = f"""<VRTDataset rasterXSize="{sw_s}" rasterYSize="{sh_s}">
  <SRS>{TARGET_SRS}</SRS>
  <GCPList Projection="{TARGET_SRS}">
{vrt_gcps}
  </GCPList>
  <VRTRasterBand dataType="Byte" band="1">
    <SimpleSource>
      <SourceFilename relativeToVRT="0">{os.path.abspath(scan_path)}</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
  <VRTRasterBand dataType="Byte" band="2">
    <SimpleSource>
      <SourceFilename relativeToVRT="0">{os.path.abspath(scan_path)}</SourceFilename>
      <SourceBand>2</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
  <VRTRasterBand dataType="Byte" band="3">
    <SimpleSource>
      <SourceFilename relativeToVRT="0">{os.path.abspath(scan_path)}</SourceFilename>
      <SourceBand>3</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>"""

    with open('_georef_tmp.vrt', 'w') as f:
        f.write(vrt_content)

    warp_mode = '-tps' if len(gcps) >= 10 else '-order 3'

    # Step 1: warp to WGS84
    cmd1 = (f'gdalwarp -s_srs {TARGET_SRS} -t_srs EPSG:4326 -r bilinear {warp_mode} '
            f'-dstalpha -srcnodata "0 0 0" -co COMPRESS=LZW -overwrite '
            f'_georef_tmp.vrt _georef_warped.tif')
    r = subprocess.run(cmd1, shell=True, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        print(f"FAILED warp: {r.stderr[:300]}")
        return None

    # Step 2: determine bounds
    if auto_bounds:
        bounds_str = get_auto_bounds('_georef_warped.tif')
        if bounds_str is None:
            print("WARNING: could not auto-detect bounds, using full extent")
            bounds_str = ""

    # Step 3: crop and resize
    if bounds_str:
        cmd2 = (f'gdalwarp {bounds_str} -ts {output_width} 0 -r bilinear '
                f'-dstalpha -co COMPRESS=LZW -overwrite _georef_warped.tif _georef_cropped.tif')
    else:
        cmd2 = (f'gdalwarp -ts {output_width} 0 -r bilinear '
                f'-dstalpha -co COMPRESS=LZW -overwrite _georef_warped.tif _georef_cropped.tif')
    r = subprocess.run(cmd2, shell=True, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        print(f"FAILED crop: {r.stderr[:300]}")

    # Extract final bounds for maps.json
    final_bounds = get_auto_bounds('_georef_cropped.tif')

    # Step 4: convert to PNG
    cmd3 = f'gdal_translate -of PNG _georef_cropped.tif {output_path}'
    r = subprocess.run(cmd3, shell=True, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        print(f"FAILED png: {r.stderr[:300]}")

    # Cleanup
    for f in ['_georef_tmp.vrt', '_georef_warped.tif', '_georef_cropped.tif']:
        if os.path.exists(f):
            os.remove(f)

    return final_bounds


# ═══════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════
def main():
    args = parse_args()

    print("=" * 60)
    print("GEOREFERENCING PIPELINE")
    print("=" * 60)

    # --- Load scan ---
    print(f"\n[1/5] Loading scan: {args.scan}")
    scan_bgr = cv2.imread(args.scan)
    if scan_bgr is None:
        print(f"ERROR: cannot read {args.scan}"); sys.exit(1)
    sh_s, sw_s = scan_bgr.shape[:2]
    print(f"  Scan: {sw_s}x{sh_s}")

    # --- Load and prepare target image for ICP ---
    if args.outline:
        print(f"  Loading outline: {args.outline}")
        target_bin, target_bin_wide, oh, ow, thresh = load_and_binarise(
            args.outline, threshold=200, is_outline=True)
        print(f"  Outline: {ow}x{oh}, threshold=200, "
              f"{target_bin.sum()//255} boundary pixels ({100*target_bin.sum()/255/target_bin.size:.1f}%)")
    else:
        print(f"  No outline provided — will use masked scan for ICP")
        _, scan_bin_wide_raw, oh, ow, thresh = load_and_binarise(
            args.scan, threshold=args.darkness_threshold)
        print(f"  Scan binarised, threshold={thresh}")
        # target_bin_wide will be set after coarse alignment (need vector positions for masking)
        target_bin_wide = scan_bin_wide_raw  # temporary, will be refined
        target_bin = None  # marker for scan-only mode

    # --- Load vector ---
    print(f"\n[2/5] Loading vector: {args.vector}")
    if args.filter_field and args.filter_value:
        print(f"  Filtering: {args.filter_field}='{args.filter_value}'")
    rings = load_vector(args.vector, args.filter_field, args.filter_value)
    if not rings:
        print("ERROR: no boundary rings loaded!"); sys.exit(1)
    rings_sub = subsample_rings(rings)
    all_pts = np.concatenate(rings_sub)
    print(f"  {len(rings)} rings, {sum(len(r) for r in rings_sub)} vertices")

    # --- Coarse alignment ---
    print(f"\n[3/5] Coarse alignment...")
    coarse, score, e_ctr, n_ctr = coarse_alignment(target_bin_wide, rings_sub, all_pts)
    if coarse is None:
        print("ERROR: coarse alignment failed!"); sys.exit(1)
    cx, cy = coarse['cx'], coarse['cy']
    scale = coarse['scale']
    rot = coarse['rotation']
    print(f"  Score={score:.4f}, centroid=({cx:.0f},{cy:.0f}), scale={scale:.6f}, rot={rot:.2f}")

    # If no outline, create masked scan target using coarse alignment
    if target_bin is None:
        print("  Extracting boundary-region mask from scan...")
        _, target_bin_wide = extract_scan_mask(
            scan_bin_wide_raw, rings_sub, all_pts, cx, cy, scale, rot, margin=25)
        bp = target_bin_wide.sum() // 255
        print(f"  Masked scan: {bp} boundary pixels ({100*bp/target_bin_wide.size:.1f}%)")

    # --- ICP ---
    print(f"\n[4/5] ICP dense matching...")
    cx, cy, scale, rot, final_rbf_dx, final_rbf_dy = run_icp(
        target_bin_wide, rings_sub, all_pts, oh, ow, cx, cy, scale, rot, e_ctr, n_ctr)

    # --- Build GCPs and warp ---
    print(f"\n[5/5] Building GCPs and warping...")
    gcps = build_gcps(rings_sub, all_pts, target_bin_wide, oh, ow,
                      cx, cy, scale, rot, e_ctr, n_ctr, sw_s, sh_s)
    print(f"  {len(gcps)} GCPs")

    if len(gcps) < 4:
        print("ERROR: not enough GCPs!"); sys.exit(1)

    # Determine bounds
    if args.bounds:
        parts = args.bounds.split(',')
        bounds_str = f"-te {parts[0]} {parts[1]} {parts[2]} {parts[3]}"
    elif args.auto_bounds:
        bounds_str = None  # will be detected after warp
    else:
        bounds_str = None  # default to auto

    final_bounds = warp_and_output(
        gcps, args.scan, args.output, sw_s, sh_s,
        bounds_str, args.output_width, auto_bounds=(bounds_str is None))

    print(f"\nDone: {args.output}")
    os.system(f'ls -lh {args.output}')

    # Output JSON summary if requested
    if args.json and final_bounds:
        # Parse bounds string
        parts = final_bounds.replace('-te ', '').split()
        if len(parts) == 4:
            summary = {
                "output": args.output,
                "bounds": [[float(parts[1]), float(parts[0])], [float(parts[3]), float(parts[2])]],
                "gcps": len(gcps),
                "coarse_score": round(score, 4),
            }
            print(json.dumps(summary))


if __name__ == '__main__':
    main()
