/**
 * Run the pane's own invariants against maps-v2.json, outside the browser.
 *
 * The catalogue pane cannot be exercised in a headless pane here -- MapLibre does not render
 * and the list stays empty on production too -- so the projection the pane performs is
 * reproduced exactly and checked. If this passes, what the pane builds is sound; what it
 * LOOKS like still has to be seen in a real browser.
 *
 *   node scripts/build/catalogue-taxonomy/check-catalogue-v2.mjs
 */
import fs from 'fs';

/** @typedef {{ id: string, name: string, c1Ids?: string[] }} Subject */
/** @typedef {{ id: string, name: string, subjects: string[] }} Shelf */
/** @typedef {{ id: string, name: string, subject: string, mapIds: string[] }} Entry */
/** @typedef {{ id: string, subject?: string, hidden?: boolean, files?: object, variants?: unknown[], members?: unknown[], chunked?: unknown }} V2Map */
/** @typedef {{ subjects: Subject[], shelves: Shelf[], entries: Entry[], maps: V2Map[], c1s?: { id: string }[] }} CatalogueV2 */

/** @type {CatalogueV2} */
const doc = JSON.parse(fs.readFileSync('data/database/maps-v2.json', 'utf8'));
/** @type {string[]} */
const fail = [];
const check = (/** @type {unknown} */ cond, /** @type {string} */ msg) => { if (!cond) fail.push(msg); };

const subjectById = new Map(doc.subjects.map((s) => [s.id, s]));
const mapById = new Map(doc.maps.map((m) => [m.id, m]));

// --- the projection the pane performs -----------------------------------------------------
/** @type {Map<string, Entry[]>} */
const entriesBySubject = new Map();
for (const e of doc.entries) {
  if (!entriesBySubject.has(e.subject)) entriesBySubject.set(e.subject, []);
  // the key was set on the line before
  /** @type {Entry[]} */ (entriesBySubject.get(e.subject)).push(e);
}
/** @type {{ id: string, name: string, subjectId: string }[]} */
const projected = [];
/** @type {{ heading: string, shelf: string, memberIds: string[] }[]} */
const groups = [];
for (const shelf of doc.shelves) {
  for (const sid of shelf.subjects) {
    const subject = subjectById.get(sid);
    if (!subject) { fail.push(`shelf ${shelf.id} names unknown subject ${sid}`); continue; }
    const list = entriesBySubject.get(sid) || [];
    for (const e of list) projected.push({ id: e.id, name: e.name, subjectId: sid });
    if (list.length) groups.push({ heading: subject.name, shelf: shelf.name, memberIds: list.map((e) => e.id) });
  }
}

// --- what the pane asserts at boot ---------------------------------------------------------
const cardIds = new Set(projected.map((c) => c.id));
const placed = new Set(groups.flatMap((g) => g.memberIds));
const homeless = projected.filter((c) => !placed.has(c.id));
const dangling = [...placed].filter((id) => !cardIds.has(id));
check(!homeless.length, `${homeless.length} entries on no shelf`);
check(!dangling.length, `${dangling.length} shelf members naming no entry`);

// --- nothing lost, nothing duplicated ------------------------------------------------------
check(projected.length === doc.entries.length,
  `projection has ${projected.length} cards for ${doc.entries.length} entries`);
const entryMapIds = doc.entries.flatMap((e) => e.mapIds);
check(new Set(entryMapIds).size === entryMapIds.length, 'a map appears in two entries');
for (const id of entryMapIds) check(mapById.has(id), `entry names a map that does not exist: ${id}`);

// Every renderable map reachable through some entry.
const renderable = doc.maps.filter((m) => !m.hidden && (Object.keys(m.files || {}).length
  || (m.variants || []).length || (m.members || []).length || m.chunked));
const reachable = new Set(entryMapIds);
const unreachable = renderable.filter((m) => !reachable.has(m.id));
check(!unreachable.length, `${unreachable.length} renderable maps reachable from no entry`);

// Every map carries a subject that exists, and every subject sits on exactly one shelf.
const noSubject = doc.maps.filter((m) => !m.subject);
check(!noSubject.length, `${noSubject.length} maps carry no subject`);
const badSubject = doc.maps.filter((m) => m.subject && !subjectById.has(m.subject));
check(!badSubject.length, `${badSubject.length} maps name a subject that does not exist`);
/** @type {Map<string, number>} */
const shelfCount = new Map();
for (const sh of doc.shelves) for (const sid of sh.subjects) shelfCount.set(sid, (shelfCount.get(sid) || 0) + 1);
for (const s of doc.subjects) check(shelfCount.get(s.id) === 1, `subject ${s.id} sits on ${shelfCount.get(s.id) || 0} shelves`);

// The hand-built layouts survive.
const layoutIds = new Set(doc.subjects.flatMap((s) => s.c1Ids || []));
for (const c1 of doc.c1s || []) check(layoutIds.has(c1.id), `layout ${c1.id} is attached to no subject`);

// --- report ---------------------------------------------------------------------------------
console.log(`shelves ${doc.shelves.length}  subjects ${doc.subjects.length}  entries ${doc.entries.length}  maps ${doc.maps.length}`);
console.log(`sections the pane would render: ${groups.length}`);
console.log(`cards the pane would render:    ${projected.length}`);
console.log(`hand-built layouts preserved:   ${layoutIds.size} of ${(doc.c1s || []).length}`);
console.log('\nfirst three shelves as the reader meets them:');
let shown = 0;
for (const sh of doc.shelves) {
  if (shown++ >= 3) break;
  console.log(`  ${sh.name}`);
  for (const sid of sh.subjects) {
    const list = entriesBySubject.get(sid) || [];
    if (!list.length) continue;
    // a subject with entries is one the maps name; an unknown one was reported above and would throw here, as before
    console.log(`     ${/** @type {Subject} */ (subjectById.get(sid)).name} (${list.length}) — ${list.slice(0, 3).map((e) => e.name).join(', ')}${list.length > 3 ? ' …' : ''}`);
  }
}

if (fail.length) {
  console.error(`\nFAIL: ${fail.length} problem(s):`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nPASS: every invariant the pane asserts holds against the built document.');
