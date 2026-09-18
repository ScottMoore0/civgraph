// Build a self-contained review page for the whole proposed structure: shelf, subject, entry.
import fs from 'fs';
const shelves = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const entries = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const OUT = process.argv[4];

const bySubject = new Map();
for (const e of entries) {
  if (!bySubject.has(e.subject)) bySubject.set(e.subject, []);
  bySubject.get(e.subject).push(e);
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const variantLabel = (e, m) => m.name.replace(e.name, '').replace(/^[\s—–,-]+/, '').replace(/[\s—–,-]+$/, '').trim() || 'base';

const subjectBlock = (s) => {
  const items = (bySubject.get(s.name) || []).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return `
      <details class="subject" data-kind="${s.kind}" data-q="${esc((s.name + ' ' + items.map(i => i.name).join(' ')).toLowerCase())}">
        <summary>
          <span class="sname">${esc(s.name)}</span>
          <span class="kind kind--${s.kind.toLowerCase()}">${s.kind}</span>
          <span class="n">${s.entries}</span>
        </summary>
        <ul class="entries">
          ${items.map(e => `<li>
            <span class="ename">${esc(e.name)}</span>
            ${e.n > 1 ? `<span class="pill pill--${e.axis}">${e.n} ${e.axis === 'edition' ? 'editions' : 'variants'}</span>` : ''}
          </li>`).join('')}
        </ul>
      </details>`;
};

const sections = shelves.map((sh, i) => `
  <section class="shelf">
    <header>
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <div>
        <h2>${esc(sh.name)}</h2>
        <p class="blurb">${esc(sh.blurb)}</p>
      </div>
      <span class="tally">${sh.subjects.length} subjects &middot; ${sh.entries} entries &middot; ${sh.maps} maps</span>
    </header>
    ${sh.subjects.map(subjectBlock).join('')}
  </section>`).join('\n');

const tE = shelves.reduce((a, s) => a + s.entries, 0);
const tM = shelves.reduce((a, s) => a + s.maps, 0);
const tS = shelves.reduce((a, s) => a + s.subjects.length, 0);

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proposed Catalogue Structure</title>
<style>
  :root {
    --ink: #1b1d21; --dim: #5d6470; --faint: #8b9099;
    --ground: #f7f6f3; --card: #ffffff; --line: #e3e1db; --rule: #d8d5cd;
    --boundary: #7a5c2e; --boundary-bg: #f3ead9;
    --dataset: #2f5d63; --dataset-bg: #e2eeef;
    --edition: #6b4a86; --edition-bg: #ede5f4;
    --variant: #2f6045; --variant-bg: #e3efe7;
    --accent: #8c4a2f;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ink: #e9e7e2; --dim: #a3a8b2; --faint: #7d838e;
      --ground: #16181b; --card: #1e2125; --line: #2e3238; --rule: #383d44;
      --boundary: #d7b878; --boundary-bg: #37301f;
      --dataset: #8fc4cb; --dataset-bg: #1c2f32;
      --edition: #c2a5da; --edition-bg: #2c2336;
      --variant: #91c7a8; --variant-bg: #1d2f25;
      --accent: #e0916c;
    }
  }
  :root[data-theme="dark"] {
    --ink: #e9e7e2; --dim: #a3a8b2; --faint: #7d838e;
    --ground: #16181b; --card: #1e2125; --line: #2e3238; --rule: #383d44;
    --boundary: #d7b878; --boundary-bg: #37301f;
    --dataset: #8fc4cb; --dataset-bg: #1c2f32;
    --edition: #c2a5da; --edition-bg: #2c2336;
    --variant: #91c7a8; --variant-bg: #1d2f25;
    --accent: #e0916c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 15px/1.55 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    padding-block: 34px; padding-left: 16px; padding-right: 16px;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 27px; margin: 0 0 7px; letter-spacing: -0.012em; text-wrap: balance; }
  .lede { color: var(--dim); margin: 0 0 20px; max-width: 62ch; }
  .stats { display: flex; flex-wrap: wrap; gap: 24px; font-family: ui-sans-serif, system-ui, sans-serif;
           padding-bottom: 20px; border-bottom: 2px solid var(--rule); }
  .stat b { display: block; font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 26px; font-family: ui-sans-serif, system-ui, sans-serif; }
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

  .shelf { margin-bottom: 30px; }
  .shelf > header { display: flex; gap: 13px; align-items: baseline; flex-wrap: wrap;
                    padding-bottom: 9px; border-bottom: 1px solid var(--rule); margin-bottom: 4px; }
  .shelf > header > div { flex: 1 1 260px; min-width: 0; }
  .num { font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; color: var(--faint);
         font-variant-numeric: tabular-nums; flex: 0 0 auto; }
  .shelf h2 { font-size: 20px; margin: 0; letter-spacing: -0.01em; font-weight: 600; }
  .blurb { margin: 2px 0 0; color: var(--dim); font-size: 14px; max-width: 58ch; }
  .tally { flex: 0 0 auto; color: var(--faint); font: 400 12px ui-sans-serif, system-ui, sans-serif;
           font-variant-numeric: tabular-nums; }

  .subject { border-bottom: 1px solid color-mix(in srgb, var(--line) 65%, transparent); }
  .subject > summary { display: flex; align-items: baseline; gap: 9px; padding: 7px 0; cursor: pointer; list-style: none; }
  .subject > summary::-webkit-details-marker { display: none; }
  .subject > summary::before { content: "\\25B8"; color: var(--faint); font-size: 11px; width: 10px; flex: 0 0 auto; }
  .subject[open] > summary::before { content: "\\25BE"; }
  .sname { flex: 1 1 auto; min-width: 0; font-weight: 600; }
  .kind, .pill {
    font: 600 9px/1 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase;
    letter-spacing: .07em; padding: 3px 6px; border-radius: 3px; flex: 0 0 auto;
  }
  .kind--boundary { color: var(--boundary); background: var(--boundary-bg); }
  .kind--dataset { color: var(--dataset); background: var(--dataset-bg); }
  .pill--edition { color: var(--edition); background: var(--edition-bg); }
  .pill--variant { color: var(--variant); background: var(--variant-bg); }
  .n { flex: 0 0 auto; color: var(--faint); font-variant-numeric: tabular-nums;
       font: 400 12px ui-sans-serif, system-ui, sans-serif; min-width: 2.5ch; text-align: right; }
  .entries { list-style: none; margin: 0 0 10px; padding: 0 0 0 19px;
             display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 1px 20px; }
  .entries li { display: flex; align-items: baseline; gap: 8px; padding: 2px 0; font-size: 14px; }
  .ename { flex: 1 1 auto; min-width: 0; }
  .subject[hidden] { display: none; }
  .shelf[hidden] { display: none; }
  footer { color: var(--faint); font-size: 13px; margin-top: 10px; max-width: 62ch;
           border-top: 1px solid var(--rule); padding-top: 16px; }
</style>
<div class="wrap">
  <h1>Proposed Catalogue Structure</h1>
  <p class="lede">Three levels, each derived from the one below it rather than guessed:
    ${tM} maps gathered into ${tE} entries, the entries filed under ${tS} subjects, the subjects
    grouped onto ${shelves.length} shelves. Open a subject to see its entries.</p>
  <div class="stats">
    <div class="stat"><b>${shelves.length}</b><span>shelves</span></div>
    <div class="stat"><b>${tS}</b><span>subjects</span></div>
    <div class="stat"><b>${tE}</b><span>entries</span></div>
    <div class="stat"><b>${tM}</b><span>maps</span></div>
  </div>
  <div class="controls">
    <input type="search" id="q" placeholder="Filter by subject or entry&hellip;" autocomplete="off">
    <button id="all" aria-pressed="true">All</button>
    <button id="bnd" aria-pressed="false">Boundary</button>
    <button id="dst" aria-pressed="false">Dataset</button>
    <button id="exp" aria-pressed="false">Expand all</button>
  </div>
  ${sections}
  <footer>Today the same material is presented as 15 sections over 128 hand-listed cards, with 171
    maps in per-category catch-alls and 110 more filed under the name of the council that published
    them. Every level above is checked: no subject sits on two shelves or none, and the entry and
    map totals are asserted at each step.</footer>
</div>
<script>
  const shelvesEl = [...document.querySelectorAll('.shelf')];
  const btns = { all: document.getElementById('all'), bnd: document.getElementById('bnd'), dst: document.getElementById('dst') };
  const exp = document.getElementById('exp');
  let kind = 'all';
  const apply = () => {
    const q = document.getElementById('q').value.trim().toLowerCase();
    for (const sh of shelvesEl) {
      let shown = 0;
      for (const su of sh.querySelectorAll('.subject')) {
        const hit = (kind === 'all' || su.dataset.kind === kind) && (!q || su.dataset.q.includes(q));
        su.hidden = !hit;
        if (hit) shown++;
        if (q && hit) su.open = true;
      }
      sh.hidden = shown === 0;
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
  exp.addEventListener('click', () => {
    const open = exp.getAttribute('aria-pressed') !== 'true';
    exp.setAttribute('aria-pressed', String(open));
    exp.textContent = open ? 'Collapse all' : 'Expand all';
    document.querySelectorAll('.subject').forEach(s => { s.open = open; });
  });
</script>
`;
fs.writeFileSync(OUT, html);
console.log('wrote', OUT, '-', shelves.length, 'shelves,', tS, 'subjects,', tE, 'entries,', tM, 'maps');
