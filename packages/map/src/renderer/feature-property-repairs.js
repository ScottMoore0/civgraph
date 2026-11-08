/** @typedef {import('./labels.js').RendererLayer} RendererLayer */
/** @typedef {Record<string, unknown>} FeatureProperties */

/** @type {Array<{ name: string, matches: (props: FeatureProperties) => boolean }>} */
const DEAS_1972_REPAIRS = [
  {
    name: 'ARMAGH AREA D',
    matches: (props) => isBlank(props.NAME) && nearly(props.Area_SqKM, 13.1719213882566)
  },
  {
    name: 'DUNGANNON AREA C',
    matches: (props) => String(props.OBJECTID ?? '').trim() === '1624'
      && normalizeText(props.NAME) === 'DUNGANNON AREA D'
  },
  {
    name: 'LIMAVADY AREA C',
    matches: (props) => isBlank(props.NAME) && nearly(props.Area_SqKM, 8.44105398081151)
  }
];

/**
 * @param {RendererLayer | null | undefined} layer
 * @param {FeatureProperties | null} [properties]
 * @returns {FeatureProperties}
 */
export function repairFeatureProperties(layer, properties = {}) {
  if (!isDeas1972(layer)) return properties || {};
  const repairedName = deas1972RepairedName(properties);
  if (!repairedName) return properties || {};
  return {
    ...(properties || {}),
    NAME: repairedName,
    name: properties?.name || repairedName,
    label_name: properties?.label_name || repairedName
  };
}

/**
 * @template E
 * @param {RendererLayer | null | undefined} layer
 * @param {E} fallbackExpression
 */
export function buildRepairedLabelValueExpression(layer, fallbackExpression) {
  if (!isDeas1972(layer)) return fallbackExpression;
  return [
    'case',
    deas1972AreaMatchExpression(13.1719213882566),
    'ARMAGH AREA D',
    [
      'all',
      ['==', ['to-string', ['get', 'OBJECTID']], '1624'],
      ['==', ['upcase', ['to-string', ['get', 'NAME']]], 'DUNGANNON AREA D']
    ],
    'DUNGANNON AREA C',
    deas1972AreaMatchExpression(8.44105398081151),
    'LIMAVADY AREA C',
    fallbackExpression
  ];
}

/** @param {RendererLayer | null | undefined} layer */
export function buildRepairedLabelFilterExpression(layer) {
  if (!isDeas1972(layer)) return null;
  return [
    'any',
    deas1972AreaMatchExpression(13.1719213882566),
    [
      'all',
      ['==', ['to-string', ['get', 'OBJECTID']], '1624'],
      ['==', ['upcase', ['to-string', ['get', 'NAME']]], 'DUNGANNON AREA D']
    ],
    deas1972AreaMatchExpression(8.44105398081151)
  ];
}

/** @param {RendererLayer | null | undefined} layer */
function isDeas1972(layer) {
  return layer?.sourceMapId === 'deas-1972'
    || layer?.id === 'deas-1972'
    || layer?.id === 'deas-1972-vector'
    || layer?.sourceLayer === 'deas_1972';
}

/** @param {FeatureProperties | null} [properties] */
function deas1972RepairedName(properties = {}) {
  return DEAS_1972_REPAIRS.find((repair) => repair.matches(properties || {}))?.name || '';
}

/** @param {number} area */
function deas1972AreaMatchExpression(area) {
  return [
    'all',
    ['!', ['has', 'NAME']],
    ['<', ['abs', ['-', ['to-number', ['get', 'Area_SqKM'], -999999], area]], 0.0001]
  ];
}

/** @param {unknown} value */
function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * @param {unknown} value
 * @param {number} expected
 */
function nearly(value, expected) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number - expected) < 0.0001;
}

/** @param {unknown} value */
function normalizeText(value) {
  return String(value ?? '').trim().toUpperCase();
}
