// Build a self-contained review page for the derived entries.
import fs from 'fs';
const entries = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];

const bySubject = new Map();
for (const e of entries) {
  if (!bySubject.has(e.subject)) bySubject.set(e.subject, []);
  bySubject.get(e.subject).push(e);
}
const subjects = [...bySubject.entries()]
  .map(([name, items]) => ({
    name, kind: items[0].kind,
    items: items.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    maps: items.reduce((a, e) => a + e.n, 0),
  }))
  .sort((a, b) => (a.kind === b.kind ? b.items.length - a.items.length : a.kind === 'Boundary' ? -1 : 1));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// what varies between the maps of an entry, with the shared stem taken out
const variantLabel = (e, m) => {
  const v = m.name.replace(e.name, '').replace(/^[\s—–,-]+/, '').replace(/[\s—–,-]+$/, '').trim();
  return v || 'base';
};

const sections = subjects.map(s => `
  <section class="subject" data-kind="${s.kind}">
    <h2>
      <span class="kind kind--${s.kind.toLowerCase()}">${s.kind}</span>
      ${esc(s.name)}
      <span class="count">${s.items.length} ${s.items.length === 1 ? 'entry' : 'entries'} &middot; ${s.maps} maps</span>
    </h2>
    ${s.items.map(e => e.n === 1 ? `
    <div class="entry entry--one" data-q="${esc((e.name + ' ' + s.name).toLowerCase())}">
      <span class="ename">${esc(e.name)}</span>
    </div>` : `
    <details class="entry" data-q="${esc((e.name + ' ' + s.name + ' ' + e.maps.map(m => m.name).join(' ')).toLowerCase())}">
      <summary>
        <span class="ename">${esc(e.name)}</span>
        <span class="axis axis--${e.axis}">${e.axis === 'edition' ? 'editions' : 'variants'}</span>
        <span class="n">${e.n}</span>
      </summary>
      <ul>${e.maps.map(m => `<li>${esc(variantLabel(e, m))}</li>`).join('')}</ul>
    </details>`).join('')}
  </section>`).join('\n');

const nEntries = entries.length;
const nMaps = entries.reduce((a, e) => a + e.n, 0);
const nMulti = entries.filter(e => e.n > 1).length;

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catalogue Entries</title>
<style>
  :root {
    --ink: #1b1d21; --dim: #5d6470; --faint: #878d99;
    --ground: #f7f6f3; --card: #ffffff; --line: #e3e1db;
    --boundary: #7a5c2e; --boundary-bg: #f3ead9;
    --dataset: #2f5d63; --dataset-bg: #e2eeef;
    --edition: #6b4a86; --edition-bg: #ede5f4;
    --variant: #2f6045; --variant-bg: #e3efe7;
    --accent: #8c4a2f;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ink: #e9e7e2; --dim: #a3a8b2; --faint: #7d838e;
      --ground: #16181b; --card: #1e2125; --line: #2e3238;
      --boundary: #d7b878; --boundary-bg: #37301f;
      --dataset: #8fc4cb; --dataset-bg: #1c2f32;
      --edition: #c2a5da; --edition-bg: #2c2336;
      --variant: #91c7a8; --variant-bg: #1d2f25;
      --accent: #e0916c;
    }
  }
  :root[data-theme="dark"] {
    --ink: #e9e7e2; --dim: #a3a8b2; --faint: #7d838e;
    --ground: #16181b; --card: #1e2125; --line: #2e3238;
    --boundary: #d7b878; --boundary-bg: #37301f;
    --dataset: #8fc4cb; --dataset-bg: #1c2f32;
    --edition: #c2a5da; --edition-bg: #2c2336;
    --variant: #91c7a8; --variant-bg: #1d2f25;
    --accent: #e0916c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 15px/1.5 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    padding-block: 32px; padding-left: 16px; padding-right: 16px;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; text-wrap: balance; }
  .lede { color: var(--dim); margin: 0 0 18px; max-width: 62ch; }
  .stats { display: flex; flex-wrap: wrap; gap: 22px; font-family: ui-sans-serif, system-ui, sans-serif; }
  .stat b { display: block; font-size: 25px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 24px; font-family: ui-sans-serif, system-ui, sans-serif; }
  input[type=search] {
    flex: 1 1 220px; min-width: 0; padding: 9px 12px; font: inherit; font-size: 14px;
    border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--ink);
  }
  button {
    padding: 9px 14px; font: inherit; font-size: 13px; cursor: pointer;
    border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--dim);
  }
  button[aria-pressed="true"] { background: var(--ink); color: var(--ground); border-color: var(--ink); }
  button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .subject {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 15px 18px; margin-bottom: 12px;
  }
  .subject h2 { font-size: 17px; margin: 0 0 8px; display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; font-weight: 600; }
  .kind {
    font: 600 10px/1 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase;
    letter-spacing: .07em; padding: 4px 7px; border-radius: 4px;
  }
  .kind--boundary { color: var(--boundary); background: var(--boundary-bg); }
  .kind--dataset { color: var(--dataset); background: var(--dataset-bg); }
  .count { margin-left: auto; color: var(--faint); font: 400 12px ui-sans-serif, system-ui, sans-serif;
           font-variant-numeric: tabular-nums; }
  .entry { border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .entry--one, summary { display: flex; align-items: baseline; gap: 9px; padding: 5px 0; }
  summary { cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: "\\25B8"; color: var(--faint); font-size: 11px; width: 10px; flex: 0 0 auto; }
  details[open] > summary::before { content: "\\25BE"; }
  .entry--one { padding-left: 19px; }
  .ename { flex: 1 1 auto; min-width: 0; }
  .axis {
    font: 600 9px/1 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase;
    letter-spacing: .07em; padding: 3px 6px; border-radius: 3px; flex: 0 0 auto;
  }
  .axis--edition { color: var(--edition); background: var(--edition-bg); }
  .axis--variant { color: var(--variant); background: var(--variant-bg); }
  .n { flex: 0 0 auto; color: var(--faint); font-variant-numeric: tabular-nums;
       font: 400 12px ui-sans-serif, system-ui, sans-serif; min-width: 2.5ch; text-align: right; }
  details ul {
    list-style: none; margin: 2px 0 8px; padding: 0 0 0 19px;
    display: flex; flex-wrap: wrap; gap: 5px;
  }
  details li {
    font: 400 12px ui-sans-serif, system-ui, sans-serif; color: var(--dim);
    background: var(--ground); border: 1px solid var(--line); border-radius: 4px; padding: 2px 7px;
  }
  .subject[hidden], .entry[hidden] { display: none; }
  footer { color: var(--faint); font-size: 13px; margin-top: 26px; max-width: 62ch; }
</style>
<div class="wrap">
  <h1>Catalogue Entries</h1>
  <p class="lede">The ${nMaps} maps gathered into the things a reader would actually look for.
    An entry marked <b>editions</b> is one subject published repeatedly over time; <b>variants</b>
    is one subject split by parameter, area or publisher. Open an entry to see what varies.</p>
  <div class="stats">
    <div class="stat"><b>${nEntries}</b><span>entries</span></div>
    <div class="stat"><b>${nMaps}</b><span>maps</span></div>
    <div class="stat"><b>${nMulti}</b><span>hold several</span></div>
    <div class="stat"><b>${subjects.length}</b><span>subjects</span></div>
  </div>
  <div class="controls">
    <input type="search" id="q" placeholder="Filter by entry, subject or variant&hellip;" autocomplete="off">
    <button id="all" aria-pressed="true">All</button>
    <button id="bnd" aria-pressed="false">Boundary</button>
    <button id="dst" aria-pressed="false">Dataset</button>
    <button id="mul" aria-pressed="false">Multi-map only</button>
  </div>
  ${sections}
  <footer>Entries are derived, not hand-listed: maps whose names match once years, dates and
    bracketed publishers are stripped become one entry, and lone maps sharing a multi-word prefix
    join only when several agree. Nothing is lost &mdash; the ${nEntries} entries hold exactly
    ${nMaps} maps.</footer>
</div>
<script>
  const secs = [...document.querySelectorAll('.subject')];
  const btns = { all: document.getElementById('all'), bnd: document.getElementById('bnd'), dst: document.getElementById('dst') };
  const mul = document.getElementById('mul');
  let kind = 'all';
  const apply = () => {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const multiOnly = mul.getAttribute('aria-pressed') === 'true';
    for (const s of secs) {
      const kindOk = kind === 'all' || s.dataset.kind === kind;
      let shown = 0;
      for (const en of s.querySelectorAll('.entry')) {
        const hit = (!q || en.dataset.q.includes(q)) && (!multiOnly || en.tagName === 'DETAILS');
        en.hidden = !hit;
        if (hit) shown++;
      }
      s.hidden = !kindOk || shown === 0;
    }
  };
  document.getElementById('q').addEventListener('input', apply);
  for (const [k, b] of Object.entries(btns)) {
    b.addEventListener('click', () => {
      kind = k === 'all' ? 'all' : k === 'bnd' ? 'Boundary' : 'Dataset';
      for (const [k2, b2] of Object.entries(btns)) b2.setAttribute('aria-pressed', String(k2 === k));
      apply();
    });
  }
  mul.addEventListener('click', () => {
    mul.setAttribute('aria-pressed', String(mul.getAttribute('aria-pressed') !== 'true'));
    apply();
  });
</script>
`;
fs.writeFileSync(OUT, html);
console.log('wrote', OUT, '-', nEntries, 'entries over', nMaps, 'maps');
