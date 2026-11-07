// Build a self-contained review page for the subject assignment.
import fs from 'fs';
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];

const bySubject = new Map();
for (const r of rows) {
  if (!bySubject.has(r.subject)) bySubject.set(r.subject, []);
  bySubject.get(r.subject).push(r);
}
const subjects = [...bySubject.entries()]
  .map(([name, items]) => ({ name, kind: items[0].kind, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
  .sort((a, b) => (a.kind === b.kind ? b.items.length - a.items.length : a.kind === 'Boundary' ? -1 : 1));

// rows carry where they came from as "<prefix>:<label>" -- a publisher-named card, a
// per-category catch-all, or a hand-authored card
const origin = (from) => {
  const at = from.indexOf(':');
  return from.slice(at + 1)
    .replace(/ - Open Data$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || from.slice(at + 1);
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sections = subjects.map(s => `
  <section class="subject" data-kind="${s.kind}">
    <h2>
      <span class="kind kind--${s.kind.toLowerCase()}">${s.kind}</span>
      ${esc(s.name)}
      <span class="count">${s.items.length}</span>
    </h2>
    <ul>
      ${s.items.map(i => `<li data-q="${esc((i.name + ' ' + s.name + ' ' + origin(i.from)).toLowerCase())}">
        <span class="map">${esc(i.name)}</span>
        <span class="origin">${esc(origin(i.from))}</span>
      </li>`).join('\n      ')}
    </ul>
  </section>`).join('\n');

const nB = subjects.filter(s => s.kind === 'Boundary').reduce((a, s) => a + s.items.length, 0);

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catalogue Subjects</title>
<style>
  :root {
    --ink: #1b1d21; --dim: #5d6470; --faint: #878d99;
    --ground: #f7f6f3; --card: #ffffff; --line: #e3e1db;
    --boundary: #7a5c2e; --boundary-bg: #f3ead9;
    --dataset: #2f5d63; --dataset-bg: #e2eeef;
    --accent: #8c4a2f;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ink: #e9e7e2; --dim: #a3a8b2; --faint: #7d838e;
      --ground: #16181b; --card: #1e2125; --line: #2e3238;
      --boundary: #d7b878; --boundary-bg: #37301f;
      --dataset: #8fc4cb; --dataset-bg: #1c2f32;
      --accent: #e0916c;
    }
  }
  :root[data-theme="dark"] {
    --ink: #e9e7e2; --dim: #a3a8b2; --faint: #7d838e;
    --ground: #16181b; --card: #1e2125; --line: #2e3238;
    --boundary: #d7b878; --boundary-bg: #37301f;
    --dataset: #8fc4cb; --dataset-bg: #1c2f32;
    --accent: #e0916c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 15px/1.5 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    padding-block: 32px; padding-left: 16px; padding-right: 16px;
  }
  .wrap { max-width: 940px; margin: 0 auto; }
  header { margin-bottom: 26px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; text-wrap: balance; }
  .lede { color: var(--dim); margin: 0 0 18px; max-width: 62ch; }
  .stats { display: flex; flex-wrap: wrap; gap: 22px; font-family: ui-sans-serif, system-ui, sans-serif; }
  .stat b { display: block; font-size: 25px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 24px; font-family: ui-sans-serif, system-ui, sans-serif; }
  input[type=search] {
    flex: 1 1 220px; min-width: 0; padding: 9px 12px; font: inherit; font-size: 14px;
    border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--ink);
  }
  button {
    padding: 9px 14px; font: inherit; font-size: 13px; cursor: pointer;
    border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--dim);
  }
  button[aria-pressed="true"] { background: var(--ink); color: var(--ground); border-color: var(--ink); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .subject {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px 18px; margin-bottom: 12px;
  }
  .subject h2 {
    font-size: 17px; margin: 0 0 10px; display: flex; align-items: baseline;
    gap: 9px; flex-wrap: wrap; font-weight: 600;
  }
  .kind {
    font: 600 10px/1 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase;
    letter-spacing: .07em; padding: 4px 7px; border-radius: 4px;
  }
  .kind--boundary { color: var(--boundary); background: var(--boundary-bg); }
  .kind--dataset { color: var(--dataset); background: var(--dataset-bg); }
  .count { margin-left: auto; color: var(--faint); font-variant-numeric: tabular-nums;
           font: 400 13px ui-sans-serif, system-ui, sans-serif; }
  .subject ul { list-style: none; margin: 0; padding: 0;
                display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 2px 20px; }
  .subject li { display: flex; gap: 10px; align-items: baseline; padding: 3px 0;
                border-top: 1px solid color-mix(in srgb, var(--line) 55%, transparent); }
  .map { flex: 1 1 auto; min-width: 0; }
  .origin { flex: 0 0 auto; color: var(--faint); font: 400 11px ui-sans-serif, system-ui, sans-serif;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 17ch; }
  .subject[hidden], li[hidden] { display: none; }
  footer { color: var(--faint); font-size: 13px; margin-top: 26px; max-width: 62ch; }
</style>
<div class="wrap">
  <header>
    <h1>Subjects across the catalogue</h1>
    <p class="lede">Every renderable map in the catalogue, each proposed a subject. Boundaries are the reference geography you drape things on; datasets are things observed, recorded or proposed at a place. The grey label on the right is the entry the map sits in today.</p>
    <div class="stats">
      <div class="stat"><b>${rows.length}</b><span>maps</span></div>
      <div class="stat"><b>${subjects.length}</b><span>subjects</span></div>
      <div class="stat"><b>${nB}</b><span>boundary</span></div>
      <div class="stat"><b>${rows.length - nB}</b><span>dataset</span></div>
    </div>
  </header>
  <div class="controls">
    <input type="search" id="q" placeholder="Filter by map, subject or source&hellip;" autocomplete="off">
    <button id="all" aria-pressed="true">All</button>
    <button id="bnd" aria-pressed="false">Boundary</button>
    <button id="dst" aria-pressed="false">Dataset</button>
  </div>
  ${sections}
  <footer>Subjects come from ordered name rules read off the inventory itself, run over the map name with its current entry as context, plus explicit corrections where a rule went wrong or a name said nothing. Four maps were resolved from their data.gov.ie records.</footer>
</div>
<script>
  const secs = [...document.querySelectorAll('.subject')];
  const btns = { all: document.getElementById('all'), bnd: document.getElementById('bnd'), dst: document.getElementById('dst') };
  let kind = 'all';
  const apply = () => {
    const q = document.getElementById('q').value.trim().toLowerCase();
    for (const s of secs) {
      const kindOk = kind === 'all' || s.dataset.kind === kind;
      let shown = 0;
      for (const li of s.querySelectorAll('li')) {
        const hit = !q || li.dataset.q.includes(q);
        li.hidden = !hit;
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
</script>
`;
fs.writeFileSync(OUT, html);
console.log('wrote', OUT, '-', rows.length, 'maps in', subjects.length, 'subjects');
