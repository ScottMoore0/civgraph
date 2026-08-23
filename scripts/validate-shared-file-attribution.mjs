#!/usr/bin/env node
/**
 * Two catalogue records pointing at the SAME file must not credit disjoint providers.
 *
 * WHY
 *
 * lgd-1966 ("Rural and Urban Districts 4 July 1966") and admin-areas-1966-07-04
 * ("Administrative Areas 4 July 1966") both serve
 * data/maps/local-government/LGDs_04-07-1966.fgb -- same file, same date, same
 * labelProperty -- and credited DIFFERENT providers: XrysD and OSNI. One file cannot have
 * two disjoint origins, so one of those credits was simply wrong, and nothing reported
 * it. (Settled 2026-08-23: XrysD is correct; admin-areas-1966-07-04 was corrected.)
 *
 * This is the second attribution defect found in a week. The first was
 * counties-ireland-1955 losing its OSI credit while its sibling provinces-1955 kept it,
 * caught only because a browser test happened to assert on it. Attribution errors are
 * invisible in the UI -- a wrong credit renders exactly as confidently as a right one --
 * so they need a checker rather than a reader.
 *
 * DISJOINT, NOT MERELY DIFFERENT. A record may legitimately credit a SUPERSET of a
 * sibling's providers: eds-ulster-2019 reuses the 1921 digitisation file and credits
 * ["Tailte Eireann", "Phelim Birch"] where eds-ulster-1921 credits ["Phelim Birch"],
 * because the 2019 statutory designation comes from Tailte while the geometry is the
 * older digitisation. That is added provenance, not a contradiction. Only sets that
 * OVERLAP IN NOTHING are reported.
 *
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/validate-shared-file-attribution.mjs
 */
import { readFileSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));

const providersOf = (map) => {
  const raw = Array.isArray(map.provider) ? map.provider : [map.provider];
  return new Set(raw.filter(Boolean).map((value) => String(value).trim().toLowerCase()));
};

const byFile = new Map();
for (const map of catalogue.maps || []) {
  for (const url of Object.values(map.files || {})) {
    if (!url || typeof url !== 'string') continue;
    if (!byFile.has(url)) byFile.set(url, []);
    byFile.get(url).push(map);
  }
}

const conflicts = [];
let shared = 0;
for (const [url, maps] of byFile) {
  if (maps.length < 2) continue;
  shared += 1;
  for (let i = 0; i < maps.length; i += 1) {
    for (let j = i + 1; j < maps.length; j += 1) {
      const a = providersOf(maps[i]);
      const b = providersOf(maps[j]);
      if (!a.size || !b.size) continue;            // an unattributed record is a different problem
      const overlap = [...a].some((value) => b.has(value));
      if (overlap) continue;
      conflicts.push({ url, a: maps[i], b: maps[j] });
    }
  }
}

if (conflicts.length) {
  console.error(`FAIL: ${conflicts.length} pair(s) of records share a file but credit disjoint providers.`);
  for (const { url, a, b } of conflicts) {
    console.error(`  ${url.split('/').pop()}`);
    console.error(`    ${a.id} -> ${JSON.stringify(a.provider)}`);
    console.error(`    ${b.id} -> ${JSON.stringify(b.provider)}`);
  }
  console.error('');
  console.error('  One file cannot have two disjoint origins, so one credit is wrong. Check the');
  console.error('  source notes and correct it -- do NOT merge the two lists to satisfy this');
  console.error('  check, which would assert a joint provenance nobody verified.');
  process.exit(1);
}

console.log(`PASS: ${shared} shared file(s); no record credits a provider disjoint from a record sharing its file.`);
