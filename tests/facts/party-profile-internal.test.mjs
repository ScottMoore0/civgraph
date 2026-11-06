// A party's leadership and nomination ballots are its internal contests, never a body on its
// profile: no seats, no 100% vote share, not counted in "contested N elections for M bodies".
// Reads the built profiles (scripts/build-party-profiles.mjs); skipped where Browse is not built.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { isPartyInternalBody } from '../../scripts/lib/election-names.mjs';

const DIR = 'data/browse/party-profiles';

for (const slug of ['uup', 'fianna-fail']) {
  const file = `${DIR}/${slug}.json`;
  test(`${slug}: internal contests listed apart, never charted as a body`, { skip: !existsSync(file) && 'Browse not built' }, () => {
    const profile = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok((profile.internalContests || []).length > 0, 'the party has internal contests');
    for (const body of profile.bodies || []) {
      assert.equal(isPartyInternalBody({ bodySlug: body.id }), false, `${body.id} is charted as a body`);
      for (const row of body.elections || []) {
        assert.equal(isPartyInternalBody({ bodySlug: String(row.key).split('__')[0] }), false, `${row.key} is counted under ${body.id}`);
      }
    }
  });
}
