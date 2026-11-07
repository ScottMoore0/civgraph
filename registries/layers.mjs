/**
 * The layer-types registry (data/registries/layer-types.json): what each sourceType a map layer
 * record can have means, which fields it must carry, and how the map app treats it. Pure.
 */

/** The type entry of a layer record, or null when its sourceType is not registered. */
export function layerType(registry, layer) {
  return registry.types[layer?.sourceType] || null;
}

/** Whether a sourceType has a behaviour flag (threeD, rasterSource, noFeatureState, noLabels). */
export function hasBehaviour(registry, sourceType, flag) {
  return Boolean(registry.types[sourceType]?.behaviour?.includes(flag));
}

/** sourceTypes carrying a behaviour flag, sorted: the set a map-app branch tests. */
export function typesWithBehaviour(registry, flag) {
  return Object.keys(registry.types).filter((t) => hasBehaviour(registry, t, flag)).sort();
}

/**
 * Errors of one published layer record against its type: an unregistered or runtime-only
 * sourceType, a missing required field, a geometry type or renderer the type does not have, an
 * alias edition without its alias fields.
 */
export function layerRecordErrors(registry, layer) {
  const type = layerType(registry, layer);
  const at = layer?.id || '(no id)';
  if (!type) return [`${at}: sourceType ${JSON.stringify(layer?.sourceType)} is not registered`];
  if (type.runtimeOnly) return [`${at}: sourceType ${layer.sourceType} is never published`];
  const errors = [];
  for (const f of type.requiredFields) if (!(f in layer)) errors.push(`${at}: ${layer.sourceType} layer without ${f}`);
  if (!type.geometryTypes.includes(layer.geometryType)) errors.push(`${at}: geometryType ${layer.geometryType} is not one of ${type.geometryTypes.join(', ')}`);
  if (!type.renderers.includes(layer.renderer)) errors.push(`${at}: renderer ${layer.renderer} is not one of ${type.renderers.join(', ')}`);
  const alias = registry.variants.alias;
  if (layer[alias.marker] != null) {
    if (!alias.of.includes(layer.sourceType)) errors.push(`${at}: an alias edition must be ${alias.of.join(' or ')}`);
    for (const f of alias.requiredFields) if (!(f in layer)) errors.push(`${at}: alias edition without ${f}`);
  }
  return errors;
}

/** Checks a schema cannot state: behaviour flags declared, runtime-only types carry no fields. */
export function checkLayerTypes(registry) {
  const errors = [];
  for (const [name, type] of Object.entries(registry.types)) {
    for (const flag of type.behaviour || []) if (!registry.behaviourFlags[flag]) errors.push(`${name}: behaviour ${flag} is not declared`);
    if (type.runtimeOnly && (type.requiredFields || type.geometryTypes)) errors.push(`${name}: a runtime-only type has no published fields`);
    if (!type.runtimeOnly && !(type.requiredFields && type.geometryTypes && type.renderers)) errors.push(`${name}: a published type needs requiredFields, geometryTypes and renderers`);
    if (type.requiredFields && !['id', 'sourceType', 'geometryType', 'renderer'].every((f) => type.requiredFields.includes(f))) {
      errors.push(`${name}: requiredFields must include id, sourceType, geometryType and renderer`);
    }
  }
  for (const t of registry.variants.alias.of) if (!registry.types[t] || registry.types[t].runtimeOnly) errors.push(`alias: ${t} is not a published type`);
  return errors;
}
