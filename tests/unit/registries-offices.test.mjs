/**
 * The offices registry (data/offices) validates against its own schemas in data/schemas through
 * the registry checker exactly where scripts/lib/facts-model.mjs (ajv) does, and links to the
 * councils and parties registries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry, registryErrors } from '../../registries/index.mjs';
import {
  allTenures, councilForInstitution, institutionsById, officesOfInstitution, tenuresOfOffice
} from '../../registries/offices.mjs';
import { partiesById } from '../../registries/parties.mjs';
import { loadFactsModel, schemaErrors } from '../../scripts/lib/facts-model.mjs';
import { REPO_ROOT } from '../../registries/index.mjs';

const registry = loadRegistry('offices');
const clone = () => structuredClone(registry);

test('offices: valid, and the same files facts-model loads', () => {
  assert.deepEqual(registryErrors('offices', registry), []);
  const model = loadFactsModel(REPO_ROOT);
  assert.deepEqual(registry.offices, model.officesDoc);
  assert.deepEqual(registry.tenures, model.tenureDocs);
  assert.equal(allTenures(registry).length, model.tenures.length);
});

test('offices: the registry checker and ajv agree on broken documents', async () => {
  const cases = [
    (r) => { r.offices.offices[0].kind = 'emperor'; },
    (r) => { r.offices.offices[0].start = '1999-13-01'; },
    (r) => { delete r.offices.institutions[0].jurisdiction; },
    (r) => { const doc = Object.values(r.tenures)[0]; doc.tenures[0].citations = [{}]; },
    (r) => { const doc = Object.values(r.tenures)[0]; doc.tenures[0].personId = 'x'; }
  ];
  for (const [i, mutate] of cases.entries()) {
    const broken = clone();
    mutate(broken);
    const ours = registryErrors('offices', broken);
    const theirs = await schemaErrors({ ...loadFactsModel(REPO_ROOT), officesDoc: broken.offices, tenureDocs: broken.tenures }, REPO_ROOT);
    assert.equal(ours.length > 0, theirs.length > 0, `case ${i}: ours ${ours.slice(0, 2)} / ajv ${theirs.slice(0, 2)}`);
    assert.ok(ours.length > 0, `case ${i} should fail`);
  }
});

test('offices: checks beyond the schema', () => {
  const badInst = clone();
  badInst.offices.offices[0].institution = 'nowhere';
  assert.ok(registryErrors('offices', badInst).some((e) => /unknown institution/.test(e)));
  const badOffice = clone();
  Object.values(badOffice.tenures)[0].tenures[0].officeId = 'nowhere';
  assert.ok(registryErrors('offices', badOffice).some((e) => /unknown office/.test(e)));
});

test('offices: links to the councils and parties registries', () => {
  const councils = loadRegistry('councils');
  const parties = partiesById(loadRegistry('parties'));
  const unlinked = [];
  for (const inst of registry.offices.institutions.filter((i) => i.kind === 'council')) {
    if (!councilForInstitution(councils, inst.id)) unlinked.push(inst.id);
  }
  // One institution stands for several councils (Belfast) or for councils outside the registry's
  // dated councils (Dublin, Cork): left for the owner (LANDING.md).
  assert.deepEqual(unlinked.sort(), ['council-belfast', 'council-cork', 'council-dublin']);
  for (const id of [...registry.offices.institutions, ...registry.offices.offices].map((x) => x.partyId).filter(Boolean)) {
    assert.ok(parties.has(id), `partyId ${id} is a parties-registry entity`);
  }
  const derry = institutionsById(registry).get('council-derry');
  assert.equal(councilForInstitution(councils, derry.id).id, 'ni-1973-derry');
  const office = officesOfInstitution(registry, 'council-derry')[0];
  assert.ok(office);
  assert.ok(Array.isArray(tenuresOfOffice(registry, office.id)));
});
