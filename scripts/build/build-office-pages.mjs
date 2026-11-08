#!/usr/bin/env node
/**
 * Office pages for Browse: data/browse/offices.json (the list) and
 * data/browse/details/offices/<office id>.json (one page per office: who held it, when, how the
 * tenure began and ended, each cited). browse/browse.js renders them at /browse/offices/<id>.
 *
 * Built from the facts model (docs/facts-model.md): data/offices/offices.json and
 * data/offices/tenures/*.json, with the people from data/browse/persons.json and the parties
 * from data/browse/parties.json. Only offices someone is recorded as holding get a page.
 * Run after scripts/build/build-browse-indexes.mjs (npm run records:build does; the output is in the
 * records build's Browse tree, loaded into D1 as office_cards).
 *
 *   node scripts/build/build-office-pages.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { browsePartySlugResolver, formatSpan, indexFactsModel, loadFactsModel } from '../lib/facts-model.mjs';
import { BROWSE_DIR } from '../../packages/loader/src/paths.mjs';

const ROOT = process.cwd();
// The Browse tree the records build writes (tmp/records/browse; CIVGRAPH_BUILD_DIR=legacy for data/browse).
const BROWSE = BROWSE_DIR;
const OUT_DIR = path.join(BROWSE, 'details', 'offices');
const CHECK = process.argv.includes('--check');
const readJson = (rel, fallback) => {
  const full = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : fallback;
};
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null && v !== ''
  && !(Array.isArray(v) && !v.length)));

const KIND_LABELS = {
  'head-of-government': 'Head of government', 'deputy-head-of-government': 'Deputy head of government', 'head-of-state': 'Head of state',
  minister: 'Minister', 'minister-of-state': 'Minister of state', 'junior-minister': 'Junior minister', 'secretary-of-state': 'Secretary of state',
  'chief-whip': 'Chief whip', 'leader-of-house': 'Leader of the house', speaker: 'Speaker', 'deputy-speaker': 'Deputy speaker',
  'presiding-officer': 'Presiding officer', 'law-officer': 'Law officer', chair: 'Chair', 'civil-service-head': 'Head of the civil service',
  commissioner: 'Commissioner', mayor: 'Mayor', 'deputy-mayor': 'Deputy mayor', 'council-chair': 'Council chair', 'high-sheriff': 'High sheriff',
  councillor: 'Council seat', 'party-leader': 'Party leader', 'party-deputy-leader': 'Party deputy leader', 'party-president': 'Party president',
  'party-vice-president': 'Party vice-president', 'party-chair': 'Party chair', 'party-vice-chair': 'Party vice-chair',
  'party-general-secretary': 'Party general secretary', 'party-chief-whip': 'Party chief whip', 'party-secretary': 'Party secretary',
  'party-group-leader': 'Leader of a party group',
};
const JURISDICTIONS = { 'northern-ireland': 'Northern Ireland', ireland: 'Ireland', 'united-kingdom': 'United Kingdom', europe: 'Europe' };
const BEGAN = { elected: 'elected', appointed: 'appointed', 'co-opted': 'co-opted', acting: 'acting', 'by-succession': 'by succession' };
const ENDED = { resigned: 'resigned', dismissed: 'dismissed', died: 'died in office', 'term-ended': 'term ended', defeated: 'defeated', 'office-abolished': 'office abolished' };

function main() {
  const model = loadFactsModel(ROOT);
  const index = indexFactsModel(model);
  const personsManifest = readJson(path.join(BROWSE, 'persons.json'), { shards: [] });
  const persons = new Map();
  for (const shard of personsManifest.shards || []) {
    for (const p of readJson(path.join(BROWSE, 'person-shards', shard.name), { items: [] }).items || []) persons.set(String(p.id), p);
  }
  const parties = readJson(path.join(BROWSE, 'parties.json'), { items: [] }).items || [];
  const partyNames = readJson(path.join(BROWSE, 'party-names.json'), { items: {} }).items || {};
  const registry = readJson('data/elections/parties/party_registry.json', { entities: [] }).entities || [];
  const slugOfParty = browsePartySlugResolver(registry, partyNames, new Set(parties.map((p) => p.slug)));
  const partyTitle = (slug) => parties.find((p) => p.slug === slug)?.title;

  const items = [];
  const details = [];
  let missingPeople = 0;
  for (const office of model.offices) {
    const tenures = index.tenuresByOffice.get(office.id) || [];
    if (!tenures.length) continue;
    const institution = index.institutionById.get(office.institution) || {};
    const partyId = office.partyId || institution.partyId;
    const partySlug = partyId ? slugOfParty(partyId) : null;
    const holders = tenures.map((t) => {
      const p = persons.get(String(t.personId));
      if (!p) missingPeople += 1;
      return compact({
        personSlug: p?.slug, name: p?.title || p?.name || `person ${t.personId}`,
        start: t.start, end: t.end, held: formatSpan(t.start, t.end),
        began: BEGAN[t.began], ended: ENDED[t.ended], contestKey: t.contest, note: t.note,
        citations: (t.citations || []).map((c) => compact({ title: c.title, url: c.url })),
      });
    });
    const years = tenures.flatMap((t) => [t.start, t.end]).filter(Boolean).map((d) => Number(String(d).slice(0, 4)));
    const firstYear = years.length ? Math.min(...years) : null;
    const lastYear = years.length ? Math.max(...years) : null;
    const base = compact({
      id: `office:${office.id}`,
      slug: office.id,
      type: 'office',
      title: office.name,
      subtitle: [institution.name, `${holders.length} holder record${holders.length === 1 ? '' : 's'}`, firstYear ? (firstYear === lastYear ? `${firstYear}` : `${firstYear}–${lastYear}`) : null].filter(Boolean).join(' / '),
      institution: institution.name,
      jurisdiction: JURISDICTIONS[office.jurisdiction] || office.jurisdiction,
      kind: KIND_LABELS[office.kind] || office.kind,
      party: partySlug ? partyTitle(partySlug) : undefined,
      partySlug: partySlug || undefined,
      holderCount: holders.length,
      firstYear, lastYear,
      browseUrl: `/browse/offices/${encodeURIComponent(office.id)}`,
    });
    items.push(base);
    details.push(compact({
      ...base,
      nameHistory: office.nameHistory,
      note: office.note,
      existed: formatSpan(office.start, office.end) || undefined,
      holders,
      sources: [...new Map(tenures.flatMap((t) => t.citations || []).map((c) => [c.title.replace(/, p\. \d+.*$/, ''), { title: c.title.replace(/, p\. \d+.*$/, ''), url: c.url || undefined }])).values()].map(compact),
    }));
  }
  items.sort((a, b) => a.title.localeCompare(b.title));
  if (!CHECK) {
    if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(BROWSE, 'offices.json'), JSON.stringify({ schemaVersion: 1, total: items.length, items }));
    for (const d of details) writeFileSync(path.join(OUT_DIR, `${d.slug}.json`), JSON.stringify({ schemaVersion: 1, item: d }));
  }
  console.log(`${CHECK ? 'would write' : 'wrote'} ${items.length} office pages -> data/browse/offices.json, details/offices/`
    + (missingPeople ? ` (WARNING: ${missingPeople} tenure(s) name a person missing from the persons index)` : ''));
}

main();
