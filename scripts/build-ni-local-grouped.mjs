#!/usr/bin/env node
/**
 * The grouped pre-1973 Northern Ireland local elections: one file a year for the map app, and a
 * coverage file.
 *
 *   node scripts/build-ni-local-grouped.mjs [--check]
 *
 * Reads only committed inputs:
 *   render/metadata/elections-test2.json and each council round's bundle (the published results);
 *   data/elections/ni-local/round-status.json (the intake's calendar and round status, imported by
 *     scripts/ni-local/import-intake-status.py);
 *   data/elections/ni-local/layer-features.json (each boundary layer's features, written by
 *     scripts/ni-local/build-layer-features.py);
 *   data/database/maps.json and render/metadata/maps-test-index.json (which editions exist).
 * Writes:
 *   render/metadata/ni-local/<year>.json   the year's rounds, contests and, per level, the
 *     boundary edition and each feature's seats and votes by party and whether it is hatched;
 *   render/metadata/ni-local-coverage.json the year's figures: rounds published, partial, held
 *     back and missing, and each level's edition and how many areas it draws and hatches.
 *
 * A feature is hatched (results not available or incomplete) when the round that should fill it
 * is missing although the calendar says it was held, was held back in review, is partial or held,
 * or when the contest for that area was held back. An area whose council did not poll that year,
 * or whose seat was not due (councils elected by thirds), is left plain.
 *
 * --check: build in memory and fail if the committed files differ (for CI).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  NI_LOCAL_LEVEL_IDS,
  NI_LOCAL_TIERS,
  buildNiLocalGroupEntry,
  councilTier,
  groupNiLocalRounds,
  isAldermanicBody,
  isAldermanicContest,
  niLocalGroupTitle,
  niLocalNameKey
} from '../src/ni-local-groups.mjs';
import { printedLabelText } from '../src/printed-labels.mjs';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'render', 'metadata', 'ni-local');
const OUT_COVERAGE = path.join(ROOT, 'render', 'metadata', 'ni-local-coverage.json');
const CHECK = process.argv.includes('--check');
const NO_LABEL = 'No label';

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// The editions each level may draw on, oldest first. Only editions whose geometry is complete are
// used: the 1921-69 administrative-areas editions other than 1930 and 1966 leave out districts.
export const LEVEL_EDITIONS = Object.freeze({
  ded: { before1921: ['eds-ulster-1911', 'eds-ulster-1912', 'eds-ulster-1913', 'eds-ulster-1914', 'eds-ulster-1915', 'eds-ulster-1916'], after1921: ['ded-1921-05-03', 'ded-1930-04-01'] },
  // The 1898-99 divisions until 1920 (whose PR areas have no layer), then the scheme of December
  // 1923, first used in June 1924 and unchanged to 1967 (its edition is dated 20 June 1924).
  ced: { before1921: ['county-ed-1911'], after1921: ['county-ed-1924-06-20'] },
  towns: { all: ['tia-towns-ni-1921-05-03', 'tia-towns-ni-1925-04-01', 'tia-towns-ni-1927-04-01', 'tia-towns-ni-1934-08-01', 'tia-towns-ni-1937-04-01', 'tia-towns-ni-1959-05-29'] },
  districts: { before1921: ['rural-urban-districts-1901', 'rural-urban-districts-1911'], after1921: ['admin-areas-1930-04-01', 'admin-areas-1966-07-04'] },
  counties: { all: ['counties-county-boroughs-1915'] }
});

// Counties of the councils the intake's authority list leaves out (the County Armagh pilot).
const COUNTY_FALLBACK = {
  'armagh-county-council': 'Armagh', 'armagh-rural-district-council': 'Armagh', 'armagh-urban-district-council': 'Armagh',
  'keady-urban-district-council': 'Armagh', 'lurgan-borough-council': 'Armagh', 'lurgan-rural-district-council': 'Armagh',
  'portadown-borough-council': 'Armagh', 'tandragee-rural-district-council': 'Armagh', 'tandragee-urban-district-council': 'Armagh',
  'newry-no-2-rural-district-council': 'Armagh', 'castleblayney-no-2-rural-district-council': 'Armagh',
  'moira-rural-district-council': 'Down', 'aghalee-rural-district-council': 'Antrim',
  'belfast-county-borough-council': 'Antrim', 'londonderry-county-borough-council': 'Londonderry'
};

// Spellings that differ between the results and the boundary files.
const STEM_ALIASES = new Map([
  ['tanderagee', 'tandragee'],
  ['lisnakea', 'lisnaskea'],
  ['derry', 'londonderry']
]);

function stemKey(value) {
  const key = niLocalNameKey(value);
  return STEM_ALIASES.get(key) || key;
}

/** "Newry No. 2 Rural District Council (aldermen)" -> "newry no 2". */
export function authorityStem(bodySlug) {
  const slug = String(bodySlug || '').replace(/-aldermen$/, '')
    .replace(/-(county-borough-council|county-council|rural-district-council|urban-district-council|borough-council|town-commissioners)$/, '');
  return stemKey(slug.replace(/-/g, ' '));
}

/** A district feature's label -> { stem, rural, countyBorough }. */
export function districtFeatureStem(label) {
  let key = niLocalNameKey(label);
  const countyBorough = /\bcounty borough\b/.test(key);
  const rural = /\brural\b/.test(key);
  key = key
    .replace(/^county borough of /, '')
    .replace(/ (rural|urban) distr(ict)?$/, '')
    .replace(/ (municipal|county) borough$/, '')
    .replace(/ (rural|urban)$/, '')
    .trim();
  return { stem: STEM_ALIASES.get(key) || key, rural, countyBorough };
}

// Rural districts renamed in their lifetime (the intake files each under its last name).
const AUTHORITY_STEM_ALIASES = new Map([
  ['east down', ['downpatrick']],
  ['south down', ['kilkeel']],
  ['north down', ['newtownards']],
  ['trillick', ['irvinestown no 2']],
  ['belleek', ['ballyshannon no 2']]
]);

/** Every name a council's district went by. */
export function authorityStems(bodySlug) {
  const stem = authorityStem(bodySlug);
  return [stem, ...(AUTHORITY_STEM_ALIASES.get(stem) || [])];
}

function districtMatchesAuthority(districtLabel, bodySlug) {
  if (!districtLabel) return false;
  const tier = councilTier(bodySlug);
  const { stem, rural } = districtFeatureStem(districtLabel);
  if (!authorityStems(bodySlug).includes(stem)) return false;
  return tier === 'rural-district' ? rural : !rural;
}

// Words spelt differently in the papers and the boundary files.
const WORD_ALIASES = new Map([['tanderagee', 'tandragee'], ['lisnakea', 'lisnaskea']]);
const SEAT_WORDS = /\b(alderm[ae]n(ship)?|councillors?|commissioners?)\b/g;

function aliasWords(key) {
  return key.split(' ').map((word) => WORD_ALIASES.get(word) || word).join(' ');
}

export function nameKeys(value) {
  // "Castle Ward (Alderman)", "Glen Ward Aldermanship", "Portadown (councillors)": the seat, not the place.
  const key = aliasWords(niLocalNameKey(String(value || '').replace(/\((alderm[ae]n|councillors?)\)/gi, ' ')).replace(SEAT_WORDS, ' ').replace(/\s+/g, ' ').trim());
  const keys = new Set([key, key.replace(/ /g, '')]);
  const bare = key.replace(/\b(ward|division|d e d|ded|electoral division)\b/g, '').replace(/\s+/g, ' ').trim();
  if (bare) keys.add(bare).add(bare.replace(/ /g, ''));
  // Word order: "Lower Creggan" is the boundary file's "CREGGAN LOWER".
  if (bare.includes(' ')) keys.add(`sorted:${bare.split(' ').sort().join(' ')}`);
  return [...keys].filter(Boolean);
}

/** Restricted Damerau-Levenshtein distance (a transposition counts once). */
export function editDistance(a, b) {
  const s = String(a);
  const t = String(b);
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/** Keys a DED or CED label answers to; for a town's urban DED, also its ward names. */
function featureKeys(label, stem = '') {
  const keys = new Set(nameKeys(label));
  const key = niLocalNameKey(label);
  const paren = String(label).match(/\(([^)]+)\)/);
  if (paren) for (const k of nameKeys(paren[1])) keys.add(k);
  const noParen = niLocalNameKey(String(label).replace(/\([^)]*\)/g, ' '));
  for (const variant of [noParen, key]) {
    const trimmed = variant.replace(/ (rural|urban)$/, '').trim();
    for (const k of nameKeys(trimmed)) keys.add(k);
    if (stem && trimmed.startsWith(`${stem} `)) {
      const ward = trimmed.slice(stem.length + 1).replace(/^no \d+\s*/, '').trim();
      if (ward) for (const k of nameKeys(ward)) keys.add(k);
    }
  }
  return keys;
}

function chooseEdition(level, date, mapsById, layerFeatures) {
  const spec = LEVEL_EDITIONS[level];
  const pool = spec.all || (date < '1921-05-03' ? spec.before1921 : spec.after1921);
  const editions = pool
    .filter((id) => layerFeatures[id])
    .map((id) => ({ id, date: String(mapsById.get(id)?.date || id.match(/\d{4}(-\d{2}-\d{2})?/)?.[0] || '') }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!editions.length) return null;
  const before = editions.filter((edition) => edition.date <= date);
  return before.length ? before[before.length - 1] : editions[0];
}

function partyOf(candidate) {
  const party = String(candidate?.party || '').trim();
  return party || NO_LABEL;
}

function numberOrNull(value) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n;
}

/** One contest, compact: what the map and the pane need, nothing more. */
function compactContest(result, bodySlug) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const seats = Number(result.seatsTotal) || candidates.filter((c) => c.elected).length || 1;
  const contested = result.contestStatus === 'contested'
    && candidates.some((c) => numberOrNull(c.firstPrefs ?? c.finalVotes) !== null);
  const seatType = String(result.countInfo?.Seat_Type || '').trim();
  return {
    area: String(result.constituency || '').trim(),
    seats,
    contested,
    aldermen: isAldermanicContest(bodySlug, seatType) ? 1 : 0,
    cands: candidates.map((c) => [
      String(c.name || '').trim(),
      partyOf(c),
      printedLabelText(c),
      numberOrNull(c.firstPrefs ?? c.finalVotes),
      c.elected ? 1 : 0
    ])
  };
}

function addTo(map, key, n) {
  map[key] = (map[key] || 0) + n;
}

function main() {
  const manifest = readJson('render/metadata/elections-test2.json');
  const status = readJson('data/elections/ni-local/round-status.json');
  const layerFeatures = readJson('data/elections/ni-local/layer-features.json').layers;
  const mapsRaw = readJson('data/database/maps.json');
  const mapsList = Array.isArray(mapsRaw) ? mapsRaw : (mapsRaw.maps || Object.values(mapsRaw));
  const mapsById = new Map(mapsList.map((map) => [map.id, map]));
  const renderIndex = readJson('render/metadata/maps-test-index.json');
  const renderBySource = new Map((renderIndex.layers || []).map((layer) => [layer.sourceMapId, layer]));

  const authorities = status.authorities || {};
  const countyOf = (slug) => {
    const base = String(slug).replace(/-aldermen$/, '');
    return authorities[slug]?.county || authorities[base]?.county || COUNTY_FALLBACK[base] || null;
  };
  const statusByYear = new Map();
  for (const row of status.rounds || []) {
    const year = Number(String(row.workRound || row.round).slice(0, 4));
    if (!statusByYear.has(year)) statusByYear.set(year, []);
    statusByYear.get(year).push(row);
  }

  const groups = groupNiLocalRounds(manifest.elections || []);
  const outputs = new Map();
  const coverageYears = [];
  const totals = { years: 0, rounds: 0, contests: 0, partialRounds: 0, missingRounds: 0, heldBackRounds: 0 };

  for (const [year, entries] of groups) {
    const statusRows = statusByYear.get(year) || [];
    const statusFor = (entry) => {
      const folder = String(entry.date);
      return statusRows.find((row) => row.slug === entry.bodySlug && (row.round === folder || row.workRound === folder))
        || statusRows.find((row) => row.slug === entry.bodySlug)
        || null;
    };
    const rounds = entries.map((entry) => {
      const bundle = readJson(path.relative(ROOT, path.join(ROOT, String(entry.resultUrl).replace(/^\//, ''))));
      const row = statusFor(entry);
      const tier = councilTier(entry.bodySlug);
      let roundStatus = 'complete';
      const work = row?.work;
      if (work === 'partial' || work === 'held') roundStatus = work;
      if (row?.excluded && roundStatus === 'complete') roundStatus = 'partial';
      const contests = (bundle.results || []).map((result) => compactContest(result, entry.bodySlug));
      return {
        key: entry.key,
        body: entry.body,
        bodySlug: entry.bodySlug,
        date: entry.date,
        tier,
        county: countyOf(entry.bodySlug),
        aldermen: isAldermanicBody(entry.bodySlug) ? 1 : 0,
        status: roundStatus,
        heldAreas: row?.heldAreas || [],
        contests
      };
    });

    // Rounds the calendar says were held that are not published (not transcribed, or held back).
    const published = new Set(rounds.map((round) => round.bodySlug));
    const missing = [];
    for (const row of statusRows) {
      if (published.has(row.slug)) continue;
      if (row.calendar !== 'held' || row.work === 'no-election') continue;
      if (!councilTier(row.slug)) continue;
      if (missing.some((item) => item.bodySlug === row.slug)) continue;
      missing.push({
        bodySlug: row.slug,
        date: row.pollDate || row.round,
        tier: councilTier(row.slug),
        county: countyOf(row.slug),
        aldermen: isAldermanicBody(row.slug) ? 1 : 0,
        reason: row.excluded ? 'held back in review' : 'not yet transcribed'
      });
    }

    const firstDate = rounds.map((round) => round.date).sort()[0];
    const levels = {};
    for (const level of NI_LOCAL_LEVEL_IDS) {
      levels[level] = buildLevel(level, { year, firstDate, rounds, missing, mapsById, renderBySource, layerFeatures });
    }

    const group = buildNiLocalGroupEntry(year, entries);
    const file = {
      schemaVersion: 1,
      key: group.key,
      year,
      title: niLocalGroupTitle(year),
      dates: group.dates,
      hasAldermen: rounds.some((round) => round.aldermen || round.contests.some((c) => c.aldermen)),
      rounds,
      missing,
      levels
    };
    outputs.set(year, file);

    const contests = rounds.reduce((n, round) => n + round.contests.length, 0);
    const partial = rounds.filter((round) => round.status !== 'complete').length;
    const heldBack = missing.filter((item) => item.reason === 'held back in review').length;
    totals.years += 1;
    totals.rounds += rounds.length;
    totals.contests += contests;
    totals.partialRounds += partial;
    totals.missingRounds += missing.length - heldBack;
    totals.heldBackRounds += heldBack;
    coverageYears.push({
      year,
      key: group.key,
      rounds: rounds.length,
      contests,
      partialRounds: partial,
      missingRounds: missing.length - heldBack,
      heldBackRounds: heldBack,
      hasAldermen: file.hasAldermen,
      levels: Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, {
        available: level.available,
        edition: level.sourceMapId || null,
        editionDate: level.editionDate || null,
        areas: level.features.councillors.filter((f) => f.n).length,
        hatched: level.features.councillors.filter((f) => f.hatch).length,
        unplacedContests: level.unplaced.length
      }]))
    });
  }

  const coverage = {
    schemaVersion: 1,
    about: 'Coverage of the grouped pre-1973 Northern Ireland local elections, by year and level. Written by scripts/build-ni-local-grouped.mjs from the published rounds and data/elections/ni-local/round-status.json.',
    statusImportedAt: status.importedAt || null,
    totals,
    years: coverageYears
  };

  const writes = new Map();
  for (const [year, file] of outputs) writes.set(path.join(OUT_DIR, `${year}.json`), `${JSON.stringify(file)}\n`);
  writes.set(OUT_COVERAGE, `${JSON.stringify(coverage, null, 1)}\n`);

  if (CHECK) {
    // Line endings aside (a Windows checkout may hold CRLF).
    const stale = [...writes].filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text);
    const expected = new Set([...writes.keys()].map((file) => path.basename(file)));
    const extra = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((name) => !expected.has(name)) : [];
    if (stale.length || extra.length) {
      console.error(`ni-local grouped files are stale: ${stale.map(([f]) => path.relative(ROOT, f)).concat(extra).join(', ')}. Run node scripts/build-ni-local-grouped.mjs`);
      process.exit(1);
    }
    console.log(`ni-local grouped files up to date (${outputs.size} years)`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (!writes.has(path.join(OUT_DIR, name))) fs.rmSync(path.join(OUT_DIR, name));
  }
  for (const [file, text] of writes) fs.writeFileSync(file, text);
  console.log(`ni-local: ${totals.years} years, ${totals.rounds} rounds, ${totals.contests} contests; ${totals.partialRounds} partial, ${totals.missingRounds} missing, ${totals.heldBackRounds} held back`);
}

/**
 * One level of one year: the edition it is drawn on, and each feature's results, in two views
 * (councillors, aldermen). A feature item: { k: match key, l: label, n: contests placed,
 * seats: {party: n}, votes: {party: n} (contested polls only), c: 1 if any poll was contested,
 * hatch: 1 if results are missing or incomplete, why: the reason, r: [[round, contest], ...] }.
 */
function buildLevel(level, { firstDate, rounds, missing, mapsById, renderBySource, layerFeatures }) {
  const tiersAtLevel = Object.entries(NI_LOCAL_TIERS).filter(([, tier]) => tier.levels.includes(level)).map(([id]) => id);
  const relevant = rounds.map((round, index) => ({ round, index })).filter(({ round }) => tiersAtLevel.includes(round.tier));
  const relevantMissing = missing.filter((item) => tiersAtLevel.includes(item.tier));
  // The edition in force when this level's councils polled (a county council's June poll, not the
  // January borough polls of the same year).
  const levelDate = [...relevant.map(({ round }) => round.date), ...relevantMissing.map((item) => item.date)].sort()[0] || firstDate;
  let edition = chooseEdition(level, levelDate, mapsById, layerFeatures);
  if (level === 'districts' && edition) {
    // Districts came and went (Newtownabbey 1958, Kilkeel 1935): of the complete editions, the
    // one that draws the most of this year's councils, the one in force when they tie.
    const spec = LEVEL_EDITIONS.districts;
    const pool = levelDate < '1921-05-03' ? spec.before1921 : spec.after1921;
    const drawn = (id) => {
      const labels = (layerFeatures[id]?.features || []).map((f) => f.label);
      return new Set(relevant.map(({ round }) => round.bodySlug)
        .filter((slug) => labels.some((label) => districtMatchesAuthority(label, slug)))).size;
    };
    const best = pool.filter((id) => layerFeatures[id])
      .map((id) => ({ id, n: drawn(id) }))
      .sort((a, b) => b.n - a.n)[0];
    if (best && best.n > drawn(edition.id)) {
      edition = { id: best.id, date: String(mapsById.get(best.id)?.date || '') };
    }
  }
  const empty = { councillors: [], aldermen: [] };
  if (!relevant.length && !relevantMissing.length) {
    return { available: false, reason: 'No elections at this level this year', features: empty, unplaced: [] };
  }
  if (!edition) {
    return { available: false, reason: 'No boundary layer for this level', features: empty, unplaced: [] };
  }
  const layer = layerFeatures[edition.id];
  const render = renderBySource.get(edition.id);
  const features = layer.features.map((feature) => ({ ...feature, matchKey: feature.key || feature.label }));

  // contest placements: feature index -> [[roundIndex, contestIndex]]
  const placements = new Map();
  const place = (fi, ri, ci) => {
    if (!placements.has(fi)) placements.set(fi, []);
    placements.get(fi).push([ri, ci]);
  };
  const unplaced = [];
  const featuresOfAuthority = (bodySlug) => features
    .map((feature, fi) => ({ feature, fi }))
    .filter(({ feature }) => districtMatchesAuthority(feature.district, bodySlug));
  const featuresOfCounty = (county) => features
    .map((feature, fi) => ({ feature, fi }))
    .filter(({ feature }) => county && feature.county === county);

  const matchIn = (pool, area, stem) => {
    const keys = nameKeys(area);
    for (const { feature, fi } of pool) {
      const fk = featureKeys(feature.label, stem);
      if (keys.some((k) => fk.has(k))) return fi;
    }
    // Spelling: Killeavy and KILLEVY, Ballyshiel and BALLYSHEIL, within the council's own areas
    // only, and only where one name is clearly closest.
    const target = keys[0] || '';
    if (target.length < 5) return null;
    const scored = pool.map(({ feature, fi }) => {
      const best = Math.min(...[...featureKeys(feature.label, stem)].filter((k) => !k.startsWith('sorted:')).map((k) => editDistance(target, k)));
      return { fi, best };
    }).sort((a, b) => a.best - b.best);
    const limit = target.length >= 8 ? 2 : 1;
    if (scored.length && scored[0].best <= limit && (scored.length === 1 || scored[1].best > scored[0].best)) return scored[0].fi;
    return null;
  };

  // Which features an authority covers at this level (for hatching a missing or partial round).
  const authorityFeatures = (bodySlug, county) => {
    const tier = councilTier(bodySlug);
    const stem = authorityStem(bodySlug);
    if (level === 'ded') return featuresOfAuthority(bodySlug).map(({ fi }) => fi);
    if (level === 'ced') return tier === 'county-council' ? featuresOfCounty(county).map(({ fi }) => fi) : [];
    if (level === 'towns') return features.map((f, fi) => ({ f, fi })).filter(({ f }) => stemKey(f.label) === stem).map(({ fi }) => fi);
    if (level === 'districts') {
      return features.map((f, fi) => ({ f, fi })).filter(({ f }) => districtMatchesAuthority(f.label, bodySlug)).map(({ fi }) => fi);
    }
    if (level === 'counties') {
      return features.map((f, fi) => ({ f, fi })).filter(({ f }) => {
        const label = niLocalNameKey(f.label);
        if (tier === 'county-borough') return label === `county borough of ${stem}`;
        return !label.startsWith('county borough') && f.county === county;
      }).map(({ fi }) => fi);
    }
    return [];
  };

  for (const { round, index: ri } of relevant) {
    const stem = authorityStem(round.bodySlug);
    const tier = round.tier;
    if (level === 'ded') {
      const own = featuresOfAuthority(round.bodySlug);
      const county = featuresOfCounty(round.county);
      const urban = tier !== 'rural-district';
      round.contests.forEach((contest, ci) => {
        let fi = matchIn(own, contest.area, urban ? stem : '');
        if (fi === null && !urban) fi = matchIn(county.filter(({ feature }) => !/\burban\b/i.test(feature.label)), contest.area, '');
        if (fi === null && urban) {
          // A whole-town poll: the town's name, or the council's only contest. It fills every DED
          // of the town.
          const areaKey = nameKeys(contest.area)[0] || '';
          const whole = areaKey === stem || areaKey === '' || stemKey(areaKey) === stem || round.contests.length === 1;
          if (whole && own.length) {
            for (const { fi: each } of own) place(each, ri, ci);
            return;
          }
          // The town's urban DEDs by name, where the overlay put them in another district.
          const townDeds = county.filter(({ feature }) => {
            const key = niLocalNameKey(feature.label);
            return /\burban\b/.test(key) && (key === stem || key.startsWith(`${stem} `));
          });
          fi = matchIn(townDeds, contest.area, stem);
        }
        if (fi === null) unplaced.push([ri, ci]);
        else place(fi, ri, ci);
      });
    } else if (level === 'ced') {
      const pool = featuresOfCounty(round.county);
      round.contests.forEach((contest, ci) => {
        const fi = matchIn(pool, contest.area, '');
        if (fi === null) unplaced.push([ri, ci]);
        else place(fi, ri, ci);
      });
    } else {
      const targets = authorityFeatures(round.bodySlug, round.county);
      round.contests.forEach((contest, ci) => {
        if (!targets.length) unplaced.push([ri, ci]);
        else for (const fi of targets) place(fi, ri, ci);
      });
    }
  }

  // Hatching: a partial round's areas with no contest, held-back areas, and missing rounds.
  const hatchReason = new Map();
  const hatch = (fi, why, view) => {
    const key = `${view}:${fi}`;
    if (!hatchReason.has(key)) hatchReason.set(key, why);
  };
  const aggregate = level === 'districts' || level === 'counties' || level === 'towns';
  for (const { round, index: ri } of relevant) {
    const view = round.aldermen ? 'aldermen' : 'councillors';
    const targets = authorityFeatures(round.bodySlug, round.county);
    if (round.status !== 'complete') {
      const why = round.status === 'held' ? 'Results held back: not yet confirmed from a source' : 'Results incomplete: some contests are not yet confirmed';
      for (const fi of targets) {
        const placed = (placements.get(fi) || []).some(([r]) => r === ri);
        if (aggregate || !placed) hatch(fi, why, view);
      }
    }
    for (const area of round.heldAreas || []) {
      const pool = level === 'ced' ? featuresOfCounty(round.county) : (level === 'ded' ? featuresOfAuthority(round.bodySlug) : null);
      if (pool) {
        const fi = matchIn(pool, area, level === 'ded' && round.tier !== 'rural-district' ? authorityStem(round.bodySlug) : '');
        if (fi !== null) hatch(fi, `Result for ${area} held back: no source yet names the member`, view);
      } else {
        for (const fi of targets) hatch(fi, `Incomplete: the result for ${area} is held back`, view);
      }
    }
  }
  for (const item of relevantMissing) {
    const view = item.aldermen ? 'aldermen' : 'councillors';
    const why = item.reason === 'held back in review'
      ? 'Results held back in review'
      : 'No results yet, though an election was held';
    for (const fi of authorityFeatures(item.bodySlug, item.county)) {
      if (!(placements.get(fi) || []).some(([r]) => Boolean(rounds[r].aldermen) === Boolean(item.aldermen))) hatch(fi, why, view);
      else if (aggregate) hatch(fi, why, view);
    }
  }

  const buildView = (view) => {
    const wantAldermen = view === 'aldermen';
    return features.map((feature, fi) => {
      const refs = (placements.get(fi) || []).filter(([ri, ci]) => Boolean(rounds[ri].contests[ci].aldermen || rounds[ri].aldermen) === wantAldermen);
      const seats = {};
      const votes = {};
      let contested = 0;
      for (const [ri, ci] of refs) {
        const contest = rounds[ri].contests[ci];
        for (const [, party, , vote, elected] of contest.cands) {
          if (elected) addTo(seats, party, 1);
          if (contest.contested && vote !== null) addTo(votes, party, vote);
        }
        if (contest.contested) contested = 1;
      }
      const item = { k: feature.matchKey, l: feature.label, n: refs.length };
      if (refs.length) {
        item.seats = seats;
        if (contested) item.votes = votes;
        item.c = contested;
        item.r = refs;
      }
      const why = hatchReason.get(`${view}:${fi}`);
      if (why) {
        item.hatch = 1;
        item.why = why;
      }
      return item;
    }).filter((item) => item.n || item.hatch);
  };

  const councillors = buildView('councillors');
  const aldermen = buildView('aldermen');
  const available = councillors.some((f) => f.n) || aldermen.some((f) => f.n) || councillors.some((f) => f.hatch);
  const mapEntry = mapsById.get(edition.id) || {};
  return {
    available,
    reason: available ? null : 'No boundary layer matches these results',
    sourceMapId: edition.id,
    layerId: render?.id || null,
    labelProperty: layer.labelProperty,
    keyProps: layer.keyProps || null,
    editionDate: edition.date,
    editionName: mapEntry.name || render?.name || edition.id,
    features: { councillors, aldermen },
    unplaced
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
