/**
 * The layer-types registry (data/registries/layer-types.json): what each sourceType a map layer
 * record can have means, which fields it must carry, and how the map app treats it. Pure.
 */

/** @typedef {import('../../types/index.js').LayerTypesRegistry} LayerTypesRegistry */
/** @typedef {LayerTypesRegistry['types'][string]} LayerType */
/**
 * A published layer record (a LayerEntry, or a record before it is published): the fields the
 * type checks read.
 * @typedef {object & { id?: string, sourceType?: string, geometryType?: string, renderer?: string }} LayerRecord
 */

/**
 * The type entry of a layer record, or null when its sourceType is not registered.
 * @param {LayerTypesRegistry} registry
 * @param {LayerRecord | null | undefined} layer
 * @returns {LayerType | null}
 */
export function layerType(registry, layer) {
  return registry.types[String(layer?.sourceType)] || null;
}

/**
 * Whether a sourceType has a behaviour flag (threeD, rasterSource, noFeatureState, noLabels).
 * @param {LayerTypesRegistry} registry
 * @param {string} sourceType
 * @param {string} flag
 * @returns {boolean}
 */
export function hasBehaviour(registry, sourceType, flag) {
  return Boolean(registry.types[sourceType]?.behaviour?.includes(flag));
}

/**
 * sourceTypes carrying a behaviour flag, sorted: the set a map-app branch tests.
 * @param {LayerTypesRegistry} registry
 * @param {string} flag
 * @returns {string[]}
 */
export function typesWithBehaviour(registry, flag) {
  return Object.keys(registry.types).filter((t) => hasBehaviour(registry, t, flag)).sort();
}

/**
 * The layer types the map app can draw: those with a renderer module (drawnBy), sorted. The
 * map-tile checks accept a layer of these types and no other.
 * @param {LayerTypesRegistry} registry
 * @returns {string[]}
 */
export function drawnLayerTypes(registry) {
  return Object.keys(registry.types).filter((t) => registry.types[t].drawnBy).sort();
}

/**
 * Errors of one published layer record against its type: an unregistered or runtime-only
 * sourceType, a missing required field, a geometry type or renderer the type does not have, an
 * alias edition without its alias fields.
 * @param {LayerTypesRegistry} registry
 * @param {LayerRecord} layer
 * @returns {string[]}
 */
export function layerRecordErrors(registry, layer) {
  const type = layerType(registry, layer);
  const at = layer?.id || '(no id)';
  if (!type) return [`${at}: sourceType ${JSON.stringify(layer?.sourceType)} is not registered`];
  if (type.runtimeOnly) return [`${at}: sourceType ${layer.sourceType} is never published`];
  /** @type {string[]} */
  const errors = [];
  // A published type has requiredFields, geometryTypes and renderers (checkLayerTypes).
  const requiredFields = /** @type {string[]} */ (type.requiredFields);
  const geometryTypes = /** @type {string[]} */ (type.geometryTypes);
  const renderers = /** @type {string[]} */ (type.renderers);
  for (const f of requiredFields) if (!(f in layer)) errors.push(`${at}: ${layer.sourceType} layer without ${f}`);
  if (!geometryTypes.includes(/** @type {string} */ (layer.geometryType))) errors.push(`${at}: geometryType ${layer.geometryType} is not one of ${geometryTypes.join(', ')}`);
  if (!renderers.includes(/** @type {string} */ (layer.renderer))) errors.push(`${at}: renderer ${layer.renderer} is not one of ${renderers.join(', ')}`);
  const alias = registry.variants.alias;
  if (/** @type {{ [field: string]: unknown }} */ (layer)[alias.marker] != null) {
    if (!alias.of.includes(/** @type {string} */ (layer.sourceType))) errors.push(`${at}: an alias edition must be ${alias.of.join(' or ')}`);
    for (const f of alias.requiredFields) if (!(f in layer)) errors.push(`${at}: alias edition without ${f}`);
  }
  return errors;
}

/**
 * Checks a schema cannot state: behaviour flags declared, runtime-only types carry no fields.
 * @param {LayerTypesRegistry} registry
 * @returns {string[]}
 */
export function checkLayerTypes(registry) {
  /** @type {string[]} */
  const errors = [];
  for (const [name, type] of Object.entries(registry.types)) {
    for (const flag of type.behaviour || []) if (!registry.behaviourFlags[flag]) errors.push(`${name}: behaviour ${flag} is not declared`);
    if (type.runtimeOnly && (type.requiredFields || type.geometryTypes)) errors.push(`${name}: a runtime-only type has no published fields`);
    if (!type.runtimeOnly && !(type.requiredFields && type.geometryTypes && type.renderers)) errors.push(`${name}: a published type needs requiredFields, geometryTypes and renderers`);
    if (!type.runtimeOnly && !type.drawnBy) errors.push(`${name}: a published type needs drawnBy, the module that draws it`);
    const requiredFields = type.requiredFields;
    if (requiredFields && !['id', 'sourceType', 'geometryType', 'renderer'].every((f) => requiredFields.includes(f))) {
      errors.push(`${name}: requiredFields must include id, sourceType, geometryType and renderer`);
    }
  }
  for (const t of registry.variants.alias.of) if (!registry.types[t] || registry.types[t].runtimeOnly) errors.push(`alias: ${t} is not a published type`);
  return errors;
}
