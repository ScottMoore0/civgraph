// Isolate the maps that currently carry no subject:
//   (a) those in the per-category catch-all cards, and
//   (b) those in cards named after a publisher rather than a subject.
import fs from 'fs';
const Q = String.fromCharCode(39), BS = String.fromCharCode(92);
const src = fs.readFileSync('src/ui-controller.js', 'utf8').split('\n');
const j = JSON.parse(fs.readFileSync('data/database/maps.json', 'utf8'));

const body = src.slice(3645, 4321).filter(l => !/^\s*\/\//.test(l)).join('\n');
const objs = [];
{
  let depth = 0, start = -1, inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { if (ch === BS) i++; else if (ch === Q) inStr = false; continue; }
    if (ch === Q) { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0) objs.push(body.slice(start, i + 1)); }
  }
}
const strs = s => { const o = []; let i = 0; while ((i = s.indexOf(Q, i)) !== -1) { let k = i + 1, b = ''; while (k < s.length && s[k] !== Q) { if (s[k] === BS) { b += s[k + 1]; k += 2; } else { b += s[k]; k++; } } o.push(b); i = k + 1; } return o; };
const listAfter = (o, key) => { const a = o.indexOf(key + ':'); if (a === -1) return []; const p = o.indexOf('[', a), c = o.indexOf(']', p); return p === -1 || c === -1 ? [] : strs(o.slice(p, c)); };
const nameOf = o => (o.match(new RegExp('name:\\s*' + Q + '([^' + Q + ']*)' + Q)) || [])[1] || '';

const classMaps = new Map(j.classes.map(c => [c.id, c.maps || []]));
const renderable = m => !m.hidden && (Object.keys(m.files || {}).length || (m.variants || []).length || (m.members || []).length || m.chunked);
const pub = j.maps.filter(renderable);
const byId = new Map(j.maps.map(m => [m.id, m]));
const catName = new Map(j.categories.map(c => [c.id, c.name]));

const cardOf = new Map();          // mapId -> card name
for (const o of objs) {
  const nm = nameOf(o);
  const ids = new Set(listAfter(o, 'mapIds'));
  listAfter(o, 'classIds').forEach(c => (classMaps.get(c) || []).forEach(id => ids.add(id)));
  ids.forEach(id => { if (!cardOf.has(id)) cardOf.set(id, nm); });
}

const PUBLISHER_CARDS = /- Open Data$/;   // cards named after the body that supplied them
const rows = [];
for (const m of pub) {
  const card = cardOf.get(m.id);
  let why;
  if (!card) why = 'catch-all:' + (catName.get(m.category || 'other') || m.category || 'other');
  else if (PUBLISHER_CARDS.test(card)) why = 'publisher:' + card;
  else continue;
  rows.push({
    id: m.id,
    name: m.name || '',
    category: m.category || '',
    provider: m.provider || '',
    keywords: (m.keywords || []).join(' '),
    why
  });
}
rows.sort((a, b) => a.why.localeCompare(b.why) || a.name.localeCompare(b.name));
fs.writeFileSync(process.argv[2], JSON.stringify(rows, null, 1));
const tally = {};
rows.forEach(r => { const k = r.why.split(':')[0]; tally[k] = (tally[k] || 0) + 1; });
console.log('maps with no subject:', rows.length, JSON.stringify(tally));
const buckets = {};
rows.forEach(r => buckets[r.why] = (buckets[r.why] || 0) + 1);
Object.entries(buckets).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + String(v).padStart(3) + '  ' + k));
