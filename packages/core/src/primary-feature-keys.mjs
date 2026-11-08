/**
 * Is this attribute one a reader is shown first: the feature's name or label?
 * 
 * scripts/build/tiles/pmtiles.mjs prunes attributes out of low-zoom tiles and keeps exactly the
 * ones this predicate calls primary (plus the promoteId and anything a style reads), so a click
 * below the cutoff still shows the feature's name. It was exported for that build by the legacy
 * /render/ app's feature panel (render/src/feature-details.js), which retired on 7 Nov 2026;
 * the predicate moved here unchanged.
 * @param {{ labelProperty?: string | null; labelProperties?: string[] | null }} layer a LayerEntry, or a build's
 *   layer record (which may also list `labelProperties`)
 * @param {string} key
 * @returns {boolean}
 */
export function isPrimaryKey(layer, key) {
  const labelKeys = [
    layer.labelProperty,
    ...(layer.labelProperties || []),
    'name',
    'Name',
    'NAME',
    'label',
    'Label',
    'label_name',
    'name_en',
    'official_name'
  ].filter(Boolean);
  return labelKeys.includes(key) || /^(name|label|title)(_|$)/i.test(key);
}
