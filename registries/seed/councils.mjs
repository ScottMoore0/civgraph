#!/usr/bin/env node
/**
 * Writes data/registries/councils.json from the lists and files it replaces (run once, 7 Nov
 * 2026; kept so the derivation can be read and re-run until every caller reads the registry).
 *
 *   node registries/seed/councils.mjs           write data/registries/councils.json
 *   node registries/seed/councils.mjs --check   exit 1 if the file differs from a fresh seed
 *
 * Nothing is invented: every field comes from a named source (the `sources` list of the output).
 * A council no source names has `name: null`; a date no source gives is absent. Relations come
 * from the boundary-change files (data/timeline-changes, change types abolished, renamed and
 * created) and the overlap table of data/elections/persons/ni-council-geography.json, each
 * relation citing its source. The new ids are the body slug where a council is its own elections
 * body, and ni-1973-<name>, ni-2014-<name> or ie-2014-<name> for councils filed under one shared
 * body (local-government, the Republic's city and county councils).
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { councilSources, REPO_ROOT } from '../legacy-sources.mjs';
import { normalizeCouncilName as norm } from '../councils.mjs';

const OUT = 'data/registries/councils.json';
const slugify = (s) => norm(s).replace(/ /g, '-');
const set = (x) => new Set([...x]);

export function seedCouncils(root = REPO_ROOT) {
  const src = councilSources(root);
  const m = src.manifest;
  const pre1973 = set(m.PRE1973_COUNCIL_BODY_SLUGS);
  const inst1923 = [...m.NI_COUNCILS_1923_67_BODY_SLUGS];
  const resultsOnly = set(m.NI_COUNCILS_1923_67_RESULTS_ONLY_BODY_SLUGS);
  const pr1920 = set(m.PR1920_ONLY_COUNCIL_BODY_SLUGS);
  const armagh = set(m.ARMAGH_PILOT_RESULTS_ONLY_BODY_SLUGS);
  const lgBodies = set(m.LOCAL_GOVERNMENT_BODIES);
  const niGroup = set(src.niCouncilSlugs);
  const bodyAliases = src.search.BODY_ALIASES;
  const index = src.electionsIndex.bodies;

  // ---- pre-1973 councils: every slug any list names, each its own elections body ----
  const preSlugs = new Set([...pre1973, ...niGroup, ...inst1923, ...resultsOnly, ...armagh, ...pr1920,
    ...Object.keys(src.counties.pre1973Councils)]);
  for (const b of index) if (preSlugs.has(b.slug.replace(/-aldermen$/, ''))) preSlugs.add(b.slug);
  const indexBySlug = new Map(index.filter((b) => b.slug !== 'local-government').map((b) => [b.slug, b]));

  const era = new Map([...src.electionNames.NI_COUNCIL_ERA_TITLES]);
  // Year-dated titles that are branches of canonicalElectionTitle (scripts/lib/election-names.mjs).
  const yearTitles = {
    'lurgan-borough-council': [
      { name: 'Lurgan Urban District Council', basis: 'year' },
      { name: 'Lurgan Borough Council', from: '1949', basis: 'year', note: 'Incorporated as a municipal borough 7 Jul 1949 (Lurgan Mail 3 Sep 1949).' }
    ],
    'portadown-borough-council': [
      { name: 'Portadown Urban District Council', basis: 'year' },
      { name: 'Portadown Borough Council', from: '1947', basis: 'year', note: 'Incorporated as a municipal borough 2 Oct 1947 (Belfast Gazette 18 Jul 1947).' }
    ],
    'strabane-urban-district-council': [
      { name: 'Strabane Town Commissioners', from: '1899', until: '1899', basis: 'year', note: "Strabane's town commissioners became an urban district council under the 1898 Act." },
      { name: 'Strabane Urban District Council', basis: 'year' }
    ]
  };
  const tiers = src.niLocalTiers;
  const tierOf = (slug) => {
    const s = slug.replace(/-aldermen$/, '');
    if (/-county-borough-council$/.test(s)) return 'county-borough';
    if (/-county-council$/.test(s)) return 'county-council';
    if (/-rural-district-council$/.test(s)) return 'rural-district';
    if (/-urban-district-council$/.test(s)) return 'urban-district';
    if (/-borough-council$/.test(s)) return 'borough';
    if (/-town-commissioners$/.test(s)) return 'town-commissioners';
    throw new Error(`no tier for ${slug}`);
  };

  const councils = [];
  for (const slug of [...preSlugs].sort()) {
    const b = indexBySlug.get(slug);
    const c = {
      id: slug,
      name: b ? b.name : null,
      bodySlug: slug,
      ...(b ? { indexName: b.name } : {}),
      type: tierOf(slug),
      generation: 'pre-1973',
      jurisdiction: 'northern-ireland'
    };
    if (slug.endsWith('-aldermen')) c.aldermenOf = slug.replace(/-aldermen$/, '');
    const counties = src.counties.pre1973Councils[slug];
    if (counties) c.counties = counties;
    const eraKey = norm(b?.name || '');
    if (era.has(eraKey)) {
      const eras = [...era.get(eraKey)].reverse();
      c.names = eras.map(([from, name]) => (from ? { name, from, basis: 'date' } : { name, basis: 'date' }));
    } else if (yearTitles[slug]) c.names = yearTitles[slug];
    const stem = slug.replace(/-(county-borough-council|county-council|rural-district-council|urban-district-council|borough-council|town-commissioners)$/, '').replace(/-/g, ' ');
    const formerStems = src.authorityStemAliases.get(stem);
    if (formerStems && !slug.endsWith('-aldermen')) c.formerStems = [...formerStems];
    if (bodyAliases[slug]) c.searchAliases = bodyAliases[slug];
    const flags = {};
    if (niGroup.has(slug)) flags.niLocalGroup = true;
    if (pre1973.has(slug)) flags.pre1973Council = true;
    if (inst1923.includes(slug)) flags.niCouncils1923_67 = true;
    if (resultsOnly.has(slug)) flags.resultsOnly1923_67 = true;
    if (armagh.has(slug)) flags.armaghPilot = true;
    if (pr1920.has(slug)) flags.pr1920Only = true;
    if (Object.keys(flags).length) c.flags = flags;
    councils.push(c);
  }

  // ---- 1973 and 2014 district councils: the local-government body, one entry per council ----
  const searchName = (names, name) => names.find((n) => norm(n) === norm(name))
    || names.find((n) => norm(n).replace(/\bcity\b/g, '').replace(/ +/g, ' ').trim() === norm(name));
  const officesInst = new Map(src.offices.institutions.filter((i) => i.kind === 'council').map((i) => [i.id, i]));
  const officialStem = new Map(Object.entries(src.officesCouncils));
  const websites = new Map(src.councilWebsites.map(([key, sites]) => [key, sites]));
  const wiki1973 = new Map(src.wikipedia1973.map((w) => [w.key, w]));
  const wiki2014 = new Map(src.wikipedia2014.map((w) => [w.key, w]));
  const byName = (a, b) => a.name.localeCompare(b.name) || a.dates[0].date.localeCompare(b.dates[0].date);
  for (const b of index.filter((x) => x.slug === 'local-government').sort(byName)) {
    const first = b.dates.map((d) => d.date).sort()[0];
    const generation = first < '2014' ? '1973' : '2014';
    const c = {
      id: `ni-${generation}-${slugify(b.name)}`,
      name: b.name,
      bodySlug: 'local-government',
      indexName: b.name,
      type: 'district',
      generation,
      jurisdiction: 'northern-ireland'
    };
    if (generation === '1973' && src.counties.districts1973[b.name]) c.counties = src.counties.districts1973[b.name];
    const sn = searchName(generation === '1973' ? src.search.NI_COUNCILS_1973 : src.search.NI_COUNCILS_2014, b.name);
    if (sn) c.searchName = sn;
    if (generation === '1973') {
      const key = slugify(b.name);
      const stemKey = [...officialStem.keys()].find((k) => k === key);
      if (stemKey) {
        const [officialName, aliases] = officialStem.get(stemKey);
        c.officialName = officialName;
        c.officialNameAliases = aliases;
        if (officesInst.has(`council-${stemKey}`) && b.name !== 'Belfast') c.officesInstitution = `council-${stemKey}`;
      }
      const siteKey = [...websites.keys()].find((k) => k === key || (k === 'newry-mourne' && key === 'newry-and-mourne'));
      if (siteKey) c.websites = { key: siteKey, hosts: websites.get(siteKey) };
      const wk = [...wiki1973.keys()].find((k) => k === key.replace(/-/g, '_') || (k === 'dungannon_and_south_tyrone' && key === 'dungannon'));
      if (wk) c.wikipedia = { key: wk, titleVariants: wiki1973.get(wk).variants };
    } else {
      const wk = Object.entries(src.wikipedia2014Display).find(([, display]) => display === b.name)?.[0];
      if (wk) c.wikipedia = { key: wk, titleVariants: wiki2014.get(wk).variants };
    }
    if (lgBodies.has(b.name)) c.flags = { localGovernmentGroup: true };
    councils.push(c);
  }

  // Offices institutions of pre-1973 councils: those no 1973 council took, matched by full name
  // ("Ballymena Borough Council" names both the pre-1973 borough and the 1973 district, and
  // ef_offices.py files its holders under the district). Belfast City Council (one institution
  // for the county borough and both district councils), Dublin and Cork stay unlinked.
  const taken = new Set(councils.map((c) => c.officesInstitution).filter(Boolean));
  const stemsOf1973 = new Set(councils.filter((c) => c.generation === '1973' && c.officialName).map((c) => slugify(c.name)));
  for (const inst of officesInst.values()) {
    if (taken.has(inst.id) || ['council-belfast', 'council-dublin', 'council-cork'].includes(inst.id)) continue;
    const stem = inst.id.replace(/^council-/, '');
    if (stemsOf1973.has(stem)) continue;
    const c = councils.find((x) => x.generation === 'pre-1973' && !x.aldermenOf && x.name === inst.name);
    if (!c) continue;
    c.officesInstitution = inst.id;
    if (officialStem.has(stem)) {
      const [officialName, aliases] = officialStem.get(stem);
      c.officialName = officialName;
      c.officialNameAliases = aliases;
    }
  }

  // ---- the Republic's city and county councils (src/catalogue/search.js) ----
  for (const name of src.search.IRISH_COUNCILS) {
    councils.push({
      id: `ie-2014-${slugify(name)}`,
      name,
      bodySlug: 'ireland-local',
      type: 'city-county',
      generation: '2014',
      jurisdiction: 'ireland',
      searchName: name
    });
  }

  // ---- relations and events ----
  const relations = [];
  const events = new Map();
  const addEvent = (id, e) => { if (!events.has(id)) events.set(id, []); events.get(id).push(e); };
  const preCouncils = councils.filter((c) => c.generation === 'pre-1973');
  const mapStyle = (name) => norm(name)
    .replace(/ county borough council$/, ' county borough')
    .replace(/ borough council$/, ' municipal borough')
    .replace(/ (rural|urban) district council$/, ' $1 district')
    .replace(/ town commissioners$/, ' town');
  const preIndex = new Map();
  for (const c of preCouncils) {
    if (c.aldermenOf) continue;
    for (const n of [c.name, ...(c.names || []).map((x) => x.name)].filter(Boolean)) preIndex.set(mapStyle(n), c.id);
    if (!c.name) {
      // A council no elections body names (NI_COUNCIL_SLUGS only): its map style from the slug.
      preIndex.set(mapStyle(c.id.replace(/-/g, ' ')), c.id);
    }
  }
  const n1973 = new Map();
  const n2014 = new Map();
  for (const c of councils.filter((x) => x.generation === '1973')) {
    n1973.set(norm(c.name), c.id);
    for (const a of c.officialNameAliases || []) n1973.set(norm(a), c.id);
  }
  for (const c of councils.filter((x) => x.generation === '2014' && x.jurisdiction === 'northern-ireland')) n2014.set(norm(c.name), c.id);
  const resolverFor = (mapId) => {
    if (mapId.startsWith('admin-areas-')) return (n) => preIndex.get(norm(n).replace(/\bno (\d)/, 'no $1'));
    if (/^lgd-(1972|1984|1993)$/.test(mapId)) return (n) => n1973.get(norm(n));
    if (mapId === 'lgd-2012') return (n) => n2014.get(norm(n)) || n2014.get(norm(n).replace(/\bcity\b/g, '').replace(/ +/g, ' ').trim());
    return null;
  };
  const splitTargets = (text, resolve) => {
    const parts = text.split(', ');
    const out = [];
    for (let i = 0; i < parts.length;) {
      let hit = null;
      for (let j = parts.length; j > i; j -= 1) {
        const id = resolve(parts.slice(i, j).join(', '));
        if (id) { hit = [id, j]; break; }
      }
      if (!hit) throw new Error(`unresolved map name in "${text}" at "${parts[i]}"`);
      out.push(hit[0]);
      i = hit[1];
    }
    return out;
  };
  const unresolved = [];
  const dir = path.join(root, 'data/timeline-changes');
  for (const file of readdirSync(dir).filter((f) => /^(admin-areas|lgd)-/.test(f)).sort()) {
    const doc = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    const fromResolve = resolverFor(doc.fromMapId);
    const toResolve = resolverFor(doc.toMapId);
    if (!fromResolve || !toResolve) continue;
    for (const ch of doc.changes || []) {
      if (!['abolished', 'renamed', 'created'].includes(ch.type)) continue;
      const source = `data/timeline-changes/${file}#${ch.id}`;
      const fromId = fromResolve(ch.from);
      let toIds;
      try { toIds = splitTargets(ch.to, toResolve); } catch (e) { unresolved.push(`${source}: ${e.message}`); continue; }
      if (!fromId) { unresolved.push(`${source}: unresolved "${ch.from}"`); continue; }
      const event = { type: ch.type, between: [doc.fromMapId, doc.toMapId], text: ch.text, source };
      for (const id of new Set([fromId, ...toIds])) addEvent(id, event);
      for (const toId of toIds) {
        if (toId === fromId) continue;
        // "X formed from Y": Y precedes X. "X abolished, joined to Y" and "X renamed Y": X precedes Y.
        relations.push({ from: fromId, to: toId, basis: { type: ch.type, source } });
      }
    }
  }
  for (const [name, olds] of Object.entries(src.geography.overlap)) {
    const newId = n2014.get(norm(name));
    if (!newId || name === 'Belfast') continue; // "Belfast" names both generations
    for (const old of olds) {
      const oldId = n1973.get(norm(old));
      if (!oldId) throw new Error(`ni-council-geography overlap: unknown 1973 council ${old}`);
      relations.push({ from: oldId, to: newId, basis: { type: 'overlap', source: 'data/elections/persons/ni-council-geography.json#overlap' } });
    }
  }
  const byId = new Map(councils.map((c) => [c.id, c]));
  const addRel = (c, side, id, basis) => {
    c[side] ||= [];
    let r = c[side].find((x) => x.id === id);
    if (!r) { r = { id, basis: [] }; c[side].push(r); }
    if (!r.basis.some((b) => b.source === basis.source)) r.basis.push(basis);
  };
  for (const r of relations) {
    // "created" lists the new unit as `to` and its origin as `from`: same direction.
    addRel(byId.get(r.from), 'successors', r.to, r.basis);
    addRel(byId.get(r.to), 'predecessors', r.from, r.basis);
  }
  for (const [id, evs] of events) byId.get(id).events = evs;
  for (const c of councils) {
    for (const side of ['predecessors', 'successors']) c[side]?.sort((a, b) => a.id.localeCompare(b.id));
  }
  if (unresolved.length) throw new Error(`unresolved boundary-change names:\n${unresolved.join('\n')}`);

  const types = Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, { label: v.label, levels: [...v.levels], source: 'src/ni-local-groups.mjs NI_LOCAL_TIERS' }]));
  types.district = { source: 'the local-government body of data/elections-source/data/elections_index.json: the 26 councils of 1973 and the 11 of 2014' };
  types['city-county'] = { source: "src/catalogue/search.js IRISH_COUNCILS: the Republic's city and county councils (since 2014)" };

  return {
    schemaVersion: 1,
    description: 'Councils: every council the site files elections, offices or boundaries under. Pre-1973 Northern Ireland councils are each their own elections body (id = body slug); the 26 district councils of 1973 and the 11 of 2014 share the local-government body; the Republic\'s city and county councils share ireland-local. Nothing here is invented: each field comes from a source listed below, and a date or name no source gives is absent. Schema: registries/schemas/councils.schema.json; views: registries/councils.mjs.',
    sources: [
      'scripts/build/build-test2-election-manifest.mjs (council sets)',
      'scripts/lib/election-names.mjs (era titles, plain titles, pre-1973 bodies, year-dated titles)',
      'src/ni-local-groups.mjs (NI_COUNCIL_SLUGS, NI_LOCAL_TIERS)',
      'src/catalogue/search.js (BODY_ALIASES, NI_COUNCILS_2014, NI_COUNCILS_1973, IRISH_COUNCILS)',
      'scripts/build/build-ni-local-grouped.mjs (AUTHORITY_STEM_ALIASES)',
      'data/elections-source/data/elections_index.json (body slugs and names)',
      'data/elections/persons/ni-council-counties.json (counties)',
      'data/elections/persons/ni-council-geography.json (overlap: 1973 -> 2014)',
      'data/timeline-changes/admin-areas-*, lgd-* (abolished, renamed, created)',
      'data/offices/offices.json and scripts/ingest/facts/ef_offices.py (official names, offices institutions)',
      'scripts/ingest/council-websites/scrape_26_councils.py (websites)',
      'scripts/ingest/wikipedia/scrape_old_lgov_wikipedia.py, modern_lgov_wikipedia_common.py (Wikipedia title variants)'
    ],
    types,
    councils
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const out = `${JSON.stringify(seedCouncils(), null, 1)}\n`;
  const file = path.join(REPO_ROOT, OUT);
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (current !== out) { console.error(`${OUT} differs from a fresh seed`); process.exit(1); }
    console.log(`${OUT} matches a fresh seed`);
  } else {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, out);
    console.log(`wrote ${OUT}`);
  }
}
