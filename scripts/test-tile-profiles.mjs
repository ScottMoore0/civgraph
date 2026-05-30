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
  if (key.includes('ni-townlands-1844')) {
    return {
      maxSize: '4500000',
      maxFeatures: '4500000',
      simplification: '10',
      simplificationMaxZoom: '8',
      note: 'Retuned for NI townlands 1844 low-zoom tile pressure while preserving high-zoom detail.'
    };
  }
  if (key.includes('habitat-wetland-grouped')) {
    return {
      maxSize: '3500000',
      maxFeatures: '3500000',
      simplification: '8',
      simplificationMaxZoom: '8',
      note: 'Retuned for grouped wetland habitat network tile pressure using bounded low-zoom simplification.'
    };
  }
  if (key.includes('habitat-deciduous-woodland')) {
    return {
      maxSize: '1000000',
      maxFeatures: '1000000',
      simplification: '4',
      simplificationMaxZoom: '8',
      note: 'Retuned for deciduous woodland habitat network conversion using the bounded LOD0 source.'
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
