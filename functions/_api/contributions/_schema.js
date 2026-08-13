/**
 * What a contribution is allowed to propose, and whether a given proposal is
 * well-formed.
 *
 * WHY THIS EXISTS
 *
 * The first version of submit.js accepted `fields` as free text: every value was
 * coerced to a string, and nested objects were JSON.stringify'd into a 4,000
 * character blob. A proposal was therefore prose that a human had to read and
 * retype. That is the real reason a contributor could not do what the owner can
 * do -- not permissions, EXPRESSIVENESS. They could not say the thing.
 *
 * A typed patch carries everything enactment needs, so scripts/apply-
 * contributions.mjs can apply it mechanically and the reviewer judges the change
 * rather than transcribing it.
 *
 * TWO SEPARATE LIMITS, DELIBERATELY
 *
 *   EDITABLE_FIELDS  what may be proposed at all. Deliberately narrower than the
 *                    record: `id`, `slug`, `files` and `style` are excluded
 *                    because changing them silently repoints or unpublishes a
 *                    layer, and that is not a metadata correction.
 *   validateValue    whether the proposed value is the right SHAPE. Catches the
 *                    class of defect this project keeps hitting -- a stray
 *                    newline in a label, a year that disagrees with the name, an
 *                    array where a string belongs.
 *
 * Neither is a substitute for review. They exist so a reviewer never spends
 * attention on something a machine could have rejected.
 */

/** Field allowlists per entity type. Anything absent cannot be proposed. */
export const EDITABLE_FIELDS = {
  map: new Set([
    'name', 'category', 'description', 'provider', 'attribution', 'keywords',
    'date', 'dateAdded', 'labelProperty', 'references', 'license', 'licence',
    'licenseUrl', 'sourceDownloads', 'bounds', 'featured', 'hidden',
    'incomplete', 'placeholder',
  ]),
  source: new Set(['title', 'description', 'provider', 'url', 'references', 'license', 'licence', 'licenseUrl', 'keywords', 'date']),
  election: new Set(['name', 'description', 'date', 'references', 'notes']),
  person: new Set(['name', 'description', 'party', 'references', 'notes']),
  party: new Set(['name', 'description', 'colour', 'references', 'notes']),
  feature: new Set(['name', 'description', 'references', 'notes']),
  book: new Set(['title', 'description', 'provider', 'references', 'date', 'license', 'licence']),
  table: new Set(['title', 'description', 'references', 'notes']),
};

export const VALID_ENTITY_TYPES = new Set(Object.keys(EDITABLE_FIELDS));
export const VALID_KINDS = new Set(['metadata-edit', 'map-submission', 'retire']);

const STRING_FIELDS = new Set([
  'name', 'title', 'category', 'description', 'provider', 'attribution', 'date',
  'dateAdded', 'labelProperty', 'license', 'licence', 'licenseUrl', 'url',
  'notes', 'party', 'colour',
]);
const ARRAY_FIELDS = new Set(['keywords', 'references', 'sourceDownloads', 'bounds']);
const BOOLEAN_FIELDS = new Set(['featured', 'hidden', 'incomplete', 'placeholder']);

const MAX_STRING = 4000;
const MAX_ARRAY_ITEMS = 200;

/**
 * The declared shape of a field, for clients building an editor.
 *
 * Exported so the UI renders its inputs from the same source that validates
 * them. A hand-copied field list in browse.js would drift from this one, and the
 * symptom would be a contributor filling in a field the server then rejects --
 * the drift only showing up as someone else's failed submission.
 */
export function fieldType(field) {
  if (BOOLEAN_FIELDS.has(field)) return 'boolean';
  if (field === 'bounds') return 'bounds';
  if (ARRAY_FIELDS.has(field)) return 'array';
  if (STRING_FIELDS.has(field)) return 'string';
  return 'unknown';
}

/** Editable fields with their shapes, for every entity type. */
export function describeSchema() {
  const out = {};
  for (const [entityType, fields] of Object.entries(EDITABLE_FIELDS)) {
    out[entityType] = [...fields].sort().map((name) => ({ name, type: fieldType(name) }));
  }
  return out;
}

/**
 * Shape-check one proposed value.
 *
 * The newline rule is not fussiness. A stray "\n" inside a label value in the
 * dail-2013 tiles broke the 2016 general-election fill on the live map, and it
 * took a client-side workaround to recover. A label that contains a line break
 * is never intentional, and this is the cheapest place to stop it.
 */
export function validateValue(field, value) {
  if (value === null) return null; // an explicit clear is legitimate

  if (BOOLEAN_FIELDS.has(field)) {
    return typeof value === 'boolean' ? null : `${field} must be true or false`;
  }

  if (ARRAY_FIELDS.has(field)) {
    if (!Array.isArray(value)) return `${field} must be an array`;
    if (value.length > MAX_ARRAY_ITEMS) return `${field} has more than ${MAX_ARRAY_ITEMS} items`;
    if (field === 'bounds') {
      if (value.length !== 4 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        return 'bounds must be four finite numbers [west, south, east, north]';
      }
      const [w, s, e, n] = value;
      if (w < -180 || e > 180 || s < -90 || n > 90) return 'bounds fall outside valid lon/lat ranges';
      if (w >= e || s >= n) return 'bounds are inverted (west must be < east, south < north)';
      return null;
    }
    for (const item of value) {
      if (typeof item === 'string') {
        if (item.length > MAX_STRING) return `${field} contains an item longer than ${MAX_STRING} characters`;
        if (/[\r\n]/.test(item)) return `${field} contains a line break, which is never intentional in a label or keyword`;
      } else if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return `${field} items must be strings or objects`;
      }
    }
    return null;
  }

  if (STRING_FIELDS.has(field)) {
    if (typeof value !== 'string') return `${field} must be a string`;
    if (value.length > MAX_STRING) return `${field} is longer than ${MAX_STRING} characters`;
    if (/[\r\n]/.test(value)) return `${field} contains a line break, which is never intentional here`;
    if ((field === 'licenseUrl' || field === 'url') && value && !/^https?:\/\//i.test(value)) {
      return `${field} must be an http(s) URL`;
    }
    return null;
  }

  // Reachable only if EDITABLE_FIELDS gains a field with no declared shape.
  // Fail closed rather than wave it through untyped.
  return `${field} has no declared shape and cannot be validated; add it to _schema.js first`;
}

/**
 * Dry-run a patch against the record as it stands.
 *
 * `current` may be null when the reviewer's copy of the record cannot be reached
 * from the edge -- the result then reports what could not be checked instead of
 * quietly reporting success. A dry run that cannot distinguish "passed" from
 * "did not run" is the failure mode this project has hit repeatedly.
 */
export function dryRunPatch(entityType, patch, current) {
  const allowed = EDITABLE_FIELDS[entityType];
  const errors = [];
  const warnings = [];
  const effective = [];

  if (!allowed) return { ok: false, errors: [`Unknown entity type: ${entityType}`], warnings, effective };

  const entries = Object.entries(patch || {});
  if (!entries.length) return { ok: false, errors: ['Patch proposes no changes'], warnings, effective };

  for (const [field, value] of entries) {
    if (!allowed.has(field)) {
      errors.push(`${field} is not an editable field for ${entityType}`);
      continue;
    }
    const problem = validateValue(field, value);
    if (problem) { errors.push(problem); continue; }

    if (current && Object.prototype.hasOwnProperty.call(current, field)) {
      const before = current[field];
      if (JSON.stringify(before) === JSON.stringify(value)) {
        warnings.push(`${field} already has this value; the patch would change nothing`);
        continue;
      }
    }
    effective.push(field);
  }

  // A year in the name that the date contradicts is the single most common real
  // defect in this catalogue -- six layers carried a wrong one until they were
  // corrected by hand. Cheap to spot, so spot it.
  const proposedName = typeof patch?.name === 'string' ? patch.name : current?.name;
  const proposedDate = typeof patch?.date === 'string' ? patch.date : current?.date;
  if (proposedName && proposedDate) {
    const nameYear = String(proposedName).match(/\b(1[6-9]\d{2}|20\d{2})\b/);
    const dateYear = String(proposedDate).match(/\b(1[6-9]\d{2}|20\d{2})\b/);
    if (nameYear && dateYear && nameYear[1] !== dateYear[1]) {
      warnings.push(`name mentions ${nameYear[1]} but date says ${dateYear[1]}; confirm which is right`);
    }
  }

  if (!errors.length && !effective.length) {
    errors.push('Patch is valid but changes nothing');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    effective,
    checkedAgainstCurrentRecord: Boolean(current),
  };
}
