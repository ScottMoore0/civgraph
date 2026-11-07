// The 475 maps that already sit in a hand-authored card. The card name carries the subject,
// so dump card by card -- assigning ~120 cards is the tractable version of assigning 475 maps.
import fs from 'fs';
const Q = String.fromCharCode(39), BS = String.fromCharCode(92);
const src = fs.readFileSync('src/ui-controller.js', 'utf8').split('\n');
const j = JSON.parse(fs.readFileSync('data/database/maps.json', 'utf8'));

const body = src.slice(3645, 4321).filter(l => !/^\s*\/\//.test(l)).join('\n');
const objs = [];
{
  let d = 0, s = -1, q = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) { if (c === BS) i++; else if (c === Q) q = false; continue; }
    if (c === Q) { q = true; continue; }
    if (c === '{') { if (d === 0) s = i; d++; }
    else if (c === '}') { d--; if (d === 0) objs.push(body.slice(s, i + 1)); }
  }
}
const strs = t => { const o = []; let i = 0; while ((i = t.indexOf(Q, i)) !== -1) { let k = i + 1, b = ''; while (k < t.length && t[k] !== Q) { if (t[k] === BS) { b += t[k + 1]; k += 2; } else { b += t[k]; k++; } } o.push(b); i = k + 1; } return o; };
const listAfter = (o, key) => { const a = o.indexOf(key + ':'); if (a === -1) return []; const p = o.indexOf('[', a), c = o.indexOf(']', p); return p === -1 || c === -1 ? [] : strs(o.slice(p, c)); };
const nameOf = o => (o.match(new RegExp('name:\\s*' + Q + '([^' + Q + ']*)' + Q)) || [])[1] || '';

const classMaps = new Map(j.classes.map(c => [c.id, c.maps || []]));
const pub = j.maps.filter(m => !m.hidden && (Object.keys(m.files || {}).length || (m.variants || []).length || (m.members || []).length || m.chunked));
const pubIds = new Set(pub.map(m => m.id));
const nameById = new Map(j.maps.map(m => [m.id, m.name || m.id]));

const PUBLISHER = / - Open Data$/;
const cards = [];
const seen = new Set();
for (const o of objs) {
  const nm = nameOf(o);
  if (!nm || PUBLISHER.test(nm)) continue;
  const ids = new Set(listAfter(o, 'mapIds'));
  listAfter(o, 'classIds').forEach(c => (classMaps.get(c) || []).forEach(id => ids.add(id)));
  const mine = [...ids].filter(id => pubIds.has(id) && !seen.has(id));
  mine.forEach(id => seen.add(id));
  if (mine.length) cards.push({ card: nm, n: mine.length, maps: mine.map(id => ({ id, name: nameById.get(id) })) });
}
fs.writeFileSync(process.argv[2], JSON.stringify(cards, null, 1));
console.log('cards:', cards.length, ' maps:', cards.reduce((a, c) => a + c.n, 0));
cards.sort((a, b) => b.n - a.n).forEach(c => {
  const sample = c.n > 6 ? c.maps.slice(0, 4).map(m=>m.name).join(' / ') + ` … +${c.n - 4}` : c.maps.map(m=>m.name).join(' / ');
  console.log(String(c.n).padStart(3) + '  ' + c.card + '\n       ' + sample);
});
