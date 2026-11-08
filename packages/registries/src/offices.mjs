/**
 * The offices registry: data/offices/offices.json (institutions and offices) and
 * data/offices/tenures/*.json (who held them), which are data already and keep their schemas in
 * data/schemas (offices, tenures, citation). This module is their registry-side loader and views;
 * scripts/lib/facts-model.mjs keeps the person-level rules (check:facts).
 *
 * The loaded value: { offices: <offices.json>, tenures: { '<file>.json': <tenures doc>, ... } }.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const OFFICES_FILE = 'data/offices/offices.json';
export const TENURES_DIR = 'data/offices/tenures';

/** Read the offices registry under `root`. */
export function assembleOffices(root) {
  const tenures = {};
  for (const name of readdirSync(path.join(root, TENURES_DIR)).filter((n) => n.endsWith('.json')).sort()) {
    tenures[name] = JSON.parse(readFileSync(path.join(root, TENURES_DIR, name), 'utf8'));
  }
  return { offices: JSON.parse(readFileSync(path.join(root, OFFICES_FILE), 'utf8')), tenures };
}

export const institutionsById = (registry) => new Map(registry.offices.institutions.map((i) => [i.id, i]));
export const officesById = (registry) => new Map(registry.offices.offices.map((o) => [o.id, o]));
export const allTenures = (registry) => Object.values(registry.tenures).flatMap((doc) => doc.tenures);

/** The offices of one institution, in file order. */
export function officesOfInstitution(registry, institutionId) {
  return registry.offices.offices.filter((o) => o.institution === institutionId);
}

/** The tenures of one office, in file order. */
export function tenuresOfOffice(registry, officeId) {
  return allTenures(registry).filter((t) => t.officeId === officeId);
}

/**
 * The councils-registry council an offices institution stands for, or null when it stands for
 * none (Dublin, Cork) or for a succession of councils (Belfast: councilsForInstitution).
 */
export function councilForInstitution(councilsRegistry, institutionId) {
  const found = councilsForInstitution(councilsRegistry, institutionId);
  return found.length === 1 ? found[0] : null;
}

/** Every council an offices institution stands for, in registry order. */
export function councilsForInstitution(councilsRegistry, institutionId) {
  return councilsRegistry.councils.filter((c) => c.officesInstitution === institutionId);
}

/**
 * The registry-level rules: ids unique, every office's institution and every tenure's office
 * resolves, an office's jurisdiction is its institution's.
 * @returns {string[]} errors
 */
export function checkOffices(registry) {
  const errors = [];
  const unique = (items, what) => {
    const seen = new Set();
    for (const item of items) { if (seen.has(item.id)) errors.push(`${what}: duplicate id ${item.id}`); seen.add(item.id); }
  };
  unique(registry.offices.institutions, 'institutions');
  unique(registry.offices.offices, 'offices');
  unique(allTenures(registry), 'tenures');
  const institutions = institutionsById(registry);
  for (const o of registry.offices.offices) {
    const inst = institutions.get(o.institution);
    if (!inst) errors.push(`offices: ${o.id} names unknown institution ${o.institution}`);
    else if (inst.jurisdiction !== o.jurisdiction) errors.push(`offices: ${o.id} is ${o.jurisdiction}, its institution ${inst.id} ${inst.jurisdiction}`);
  }
  const offices = officesById(registry);
  for (const [file, doc] of Object.entries(registry.tenures)) {
    for (const t of doc.tenures) if (!offices.has(t.officeId)) errors.push(`tenures/${file}: ${t.id} names unknown office ${t.officeId}`);
  }
  return errors;
}
