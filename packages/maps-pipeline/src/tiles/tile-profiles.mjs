/**
 * Layers whose low-zoom tiles are attribute-bound rather than geometry-bound.
 *
 * MEASURED, not guessed. The worst tile in dobih-v18-4 is 10.65 MB decompressed for
 * 21,572 points at exactly one vertex each -- roughly 0.2 MB of geometry and 45
 * attribute columns per feature for the rest. Simplification cannot touch that: a point
 * has no level of detail, and the dense polygon layers are already at 4.0 vertices per
 * feature at z0, which is the floor for a closed ring.
 *
 * Below the cutoff these layers carry only their identity and name fields; at cutoff+1
 * and above they carry the full record. See lowZoomColumns() in build-test-pmtiles.mjs
 * for what "name fields" means and why the set is derived from the app rather than
 * listed here.
 *
 * 7 is the cutoff throughout because it is the zoom at which a click stops being a
 * lottery -- above it a feature is large enough to aim at, so the full record has to be
 * there. Add a layer here only after measuring that its low-zoom tiles are large AND
 * that the size is in the attributes.
 *
 * IT IS NOT ONLY A SIZE FIX. Measured on niah-buildings, same source, same profile,
 * only this flag differing:
 *
 *   unpruned   z0 worst tile 42,590 KB   23,184 of 48,327 features
 *   pruned     z0 worst tile  1,668 KB   48,327 of 48,327 features
 *
 * More than half the layer was missing at low zoom. MAX_SIZE was being reached and GDAL
 * was dropping features to stay under it -- a feature budget nobody chose, enforced
 * silently, against a payload the features were not responsible for. Removing the
 * attributes removed the pressure, and the dropped half came back. Nothing reported
 * this: the tiles built cleanly, the layer rendered, and it was simply incomplete.
 */
// hed-sites-and-monuments and hed-listed-buildings were removed here once and put back.
// The first removal was a misdiagnosis: they looked feature-count-bound because the
// derived keep-set came out empty, but the reason was that both carry labelProperty:
// null, and the keep-set is derived from exactly that. Neither has a field called
// "name" -- the human identifier is Address on one and the monument type on the other --
// so nothing matched and pruning was abandoned on layers that were prunable all along.
//
// Fixed by declaring labelProperties (plural) on both. That field is read only by the
// feature detail panel and by this build; unlike labelProperty (singular) it does NOT
// add a symbol layer, so it does not start drawing 40,000 text labels on the map to
// win a build optimisation.
const ATTRIBUTE_BOUND = [
  'hed-sites-and-monuments',
  'hed-listed-buildings',
  'dobih-v18-4',
  'niah-buildings',
  'historic-ringfort-cashel',
  'dcc-street-lighting-dublin-city',
  'translink-bus-stops-2024',
  'ni-listed-buildings',
  'gsni-tellus-',
  'niea-river-segments',
  'ni-authorised-waste-sites',
  'dlr-dlr-public-lighting'
];

function attributeCutoffFor(key) {
  return ATTRIBUTE_BOUND.some((prefix) => key.includes(prefix)) ? 7 : undefined;
}

export function getTileProfile(id = '') {
  const key = String(id || '').toLowerCase();
  const lowZoomAttributeCutoff = attributeCutoffFor(key);
  if (key.includes('roi-townlands')) {
    return {
      maxSize: '6000000',
      maxFeatures: '6000000',
      simplification: '8',
      simplificationMaxZoom: '0',
      lowZoomAttributeCutoff,
      note: 'Retuned for large ROI townlands tiles while preserving low-zoom coverage checks.'
    };
  }
  if (key.includes('roi-small-areas-2011')) {
    return {
      maxSize: '6000000',
      maxFeatures: '6000000',
      simplification: '4',
      simplificationMaxZoom: '0',
      lowZoomAttributeCutoff,
      note: 'Retuned for ROI small-area tile budget warning.'
    };
  }
  if (key.includes('ni-townlands-1844')) {
    return {
      maxSize: '4500000',
      maxFeatures: '4500000',
      simplification: '10',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff,
      note: 'Retuned for NI townlands 1844 low-zoom tile pressure while preserving high-zoom detail.'
    };
  }
  if (key.includes('habitat-wetland-grouped')) {
    return {
      maxSize: '3500000',
      maxFeatures: '3500000',
      simplification: '8',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff,
      note: 'Retuned for grouped wetland habitat network tile pressure using bounded low-zoom simplification.'
    };
  }
  if (key.includes('habitat-deciduous-woodland')) {
    return {
      maxSize: '1000000',
      maxFeatures: '1000000',
      simplification: '4',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff,
      note: 'Retuned for deciduous woodland habitat network conversion using LOD0 at low zooms and LOD1 at detail zooms.'
    };
  }
  if (key.includes('habitat-river') || key.includes('habitat-woodland-grouped')) {
    return {
      maxSize: '2500000',
      maxFeatures: '2500000',
      simplification: '6',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff,
      note: 'Retuned for dense habitat network layers to keep mobile tiles below hard budgets while retaining detail zoom coverage.'
    };
  }
  if (key.includes('roi-national-planning-applications')) {
    return {
      maxSize: '2500000',
      maxFeatures: '2500000',
      simplification: '2',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff,
      note: 'Retuned for very dense national planning records so PMTiles packaging and mobile loading stay bounded.'
    };
  }
  // The DfI road surface defect years: 94,000-216,000 points each, nine attributes per
  // point. MEASURED on dfi-surface-defects-2008 (159,531 points), built from z0 with every
  // attribute: the worst tile is 11 MB decompressed at z0-z7, 8 MB at z8, 2.5 MB at z9 and
  // 1.4 MB at z10. Those low-zoom tiles are why the layers were once held to minzoom 10,
  // which left them blank at every zoom the map opens them at (Phelim's catalogue
  // review, #49). Pruned to the derived set (civ_fid and the label field) z0 was still
  // 6.5 MB: the label is a works reference unique to every point. So below the cutoff
  // the tiles carry the listed categorical fields, which a tile stores once per distinct
  // value; from z10 up, where every full-record tile is 1.3-2.1 MB decompressed (under
  // the 4 MB budget), they carry the whole record the popup shows. Labels start at z10
  // either way. Result across the 13 years: every point in every zoom still; the worst
  // stored (gzip) tile 587-978 KB (2008: 731 KB against 1,904 KB before).
  if (key.includes('dfi-surface-defects')) {
    return {
      maxSize: '3000000',
      maxFeatures: '3000000',
      simplification: '2',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff: 9,
      lowZoomKeep: ['DEFECT_DETAIL', 'DIVISION', 'SECTION_OFFICE', 'DEFECT_STATUS'],
      note: 'Dense DfI defect points: categorical fields only up to z9, the full record from z10.'
    };
  }
  // DAERA's agricultural critical risk areas: 172,265 field parcels, 20 attributes each.
  // MEASURED built from z0 with every attribute: the worst tile is 5.3 MB decompressed
  // (about 3 MB stored, at GDAL's MAX_SIZE) at z9 and 3.9 MB at z8; from z10 it is under
  // 2 MB. Below the cutoff the tiles carry the parcel's land class, its hydrological
  // connectivity and its risk score; from z10 the whole record. They were held to
  // minzoom 10 and drew nothing at the zoom the map opens them at. Result: the low-zoom
  // tiles hold far more parcels, since the full-record build was losing them to MAX_SIZE
  // (z7, summed over its tiles: 152,239 against 33,573; z5: 42,873 against 11,914); the
  // worst tile is 5.1 MB decompressed, 2.1 MB stored (z7), and z10-z12 are unchanged.
  if (key.includes('agricultural-critical-risk')) {
    return {
      maxSize: '3000000',
      maxFeatures: '3000000',
      simplification: '2',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff: 9,
      lowZoomKeep: ['bh', 'hydoconnec', 'riskscore2'],
      note: 'Dense DAERA parcels: land class, connectivity and risk score up to z9, the full record from z10.'
    };
  }
  // DCC's protected cycle infrastructure: 4,826 segments, each with a 1.2 KB KML table of
  // its own attributes in `description`. MEASURED built from z0 with every attribute: the
  // whole county is one tile up to z7, 4.9 MB decompressed, and almost all of it is those
  // tables. Below the cutoff the tiles carry the segment's id and type (Name); from z10
  // the whole record, the table included (keepProseAboveCutoff: it is the only place the
  // segment's two-way and bollard fields are, so it is not dropped as free text).
  // Result: the worst tile below z10 is 0.16 MB decompressed (z7), against 4.9 MB.
  if (key.includes('existing-protected-cycle-infrastructure')) {
    return {
      maxSize: '3000000',
      maxFeatures: '3000000',
      simplification: '2',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff: 9,
      lowZoomKeep: ['id', 'Name'],
      keepProseAboveCutoff: true,
      note: 'Cycle infrastructure segments: id and type up to z9, the full record (with its KML table) from z10.'
    };
  }
  if (key.includes('transport-carriageway-defects')) {
    return {
      maxSize: '3000000',
      maxFeatures: '3000000',
      simplification: '2',
      simplificationMaxZoom: '8',
      lowZoomAttributeCutoff,
      note: 'Retuned for dense transport and risk layers that otherwise produce oversized low-zoom tiles.'
    };
  }
  return {
    maxSize: '10000000',
    maxFeatures: '10000000',
    simplification: '1',
    simplificationMaxZoom: '0',
    lowZoomAttributeCutoff,
    note: 'Default correctness-first /test MVT profile.'
  };
}
