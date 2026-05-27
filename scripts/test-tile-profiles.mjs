export function getTileProfile(id = '') {
  const key = String(id || '').toLowerCase();
  if (key.includes('roi-townlands')) {
    return {
      maxSize: '6000000',
      maxFeatures: '6000000',
      simplification: '8',
      simplificationMaxZoom: '0',
      note: 'Retuned for large ROI townlands tiles while preserving low-zoom coverage checks.'
    };
  }
  if (key.includes('roi-small-areas-2011')) {
    return {
      maxSize: '6000000',
      maxFeatures: '6000000',
      simplification: '4',
      simplificationMaxZoom: '0',
      note: 'Retuned for ROI small-area tile budget warning.'
    };
  }
  return {
    maxSize: '10000000',
    maxFeatures: '10000000',
    simplification: '1',
    simplificationMaxZoom: '0',
    note: 'Default correctness-first /test MVT profile.'
  };
}
