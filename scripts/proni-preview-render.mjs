// Renders the REAL PRONI browse detail functions (extracted from browse/browse.js)
// against real shard data, emitting standalone preview HTML. No browser needed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(path.join(root, 'browse/browse.js'), 'utf8');

// Extract the PRONI block (from its marker comment up to renderDetail).
const start = js.indexOf('// --- PRONI Records:');
const end = js.indexOf('async function renderDetail(type, indexItem)');
const block = js.slice(start, end);

// Sandbox with the few helpers the pure render functions rely on.
const sandbox = {
  DATA_ROOT: '../data/browse',
  ENTITY_CONFIG: { proni: { label: 'PRONI Records', singular: 'PRONI record' } },
  encodeURIComponent,
  escapeHtml: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  escapeAttr: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  formatNumber: (n) => Number(n).toLocaleString('en-GB'),
  loadJson: async () => null,
  els: {}, state: {},
  console,
};
vm.createContext(sandbox);
vm.runInContext(block + '\nglobalThis.__render = renderProniDetailPage;', sandbox);

const shard = (slug) => JSON.parse(fs.readFileSync(path.join(root, 'data/browse/details/proni', slug + '.json'), 'utf8'));

// Build three node objects: root container, mid container, and a leaf.
const rootNode = { kind: 'container', item: shard('BG').item };
const midNode = { kind: 'container', item: shard('BG~1').item };
const parentForLeaf = shard('BG~1').item;
const leafChild = parentForLeaf.children.find((c) => !c.hasChildren) || parentForLeaf.children[0];
const leafNode = { kind: 'leaf', item: leafChild, parent: parentForLeaf };

const page = (title, node) => `<h1 style="font:700 1.4rem var(--font-display,sans-serif);margin:2rem 0 1rem">${title}</h1>` + sandbox.__render(node);

// Inline the PRONI CSS block so the preview is self-contained.
const css = fs.readFileSync(path.join(root, 'browse/browse.css'), 'utf8');
const proniCss = css.slice(css.indexOf('/* --- PRONI Records:'));

const html = `<!doctype html><html><head><meta charset="utf-8">
<title>PRONI browse prototype preview</title>
<style>:root{--color-primary:#1a5fb4;--color-text:#1b1b1b;--color-text-muted:#5a5a5a;--color-border:#d7d7d7;--color-surface:#fff;--color-surface-elevated:#f3f6fb;--radius-md:8px;--radius-sm:5px}
body{max-width:820px;margin:0 auto;padding:2rem;background:#fafafa;color:#1b1b1b;font-family:system-ui,sans-serif}
${proniCss}</style>
</head><body>
${page('Root fond &mdash; BG (was 100% unlabelled before enrichment)', rootNode)}
<hr style="margin:3rem 0;border:none;border-top:2px dashed #ccc">
${page('Container &mdash; BG/1 = Antrim Board of Guardians', midNode)}
<hr style="margin:3rem 0;border:none;border-top:2px dashed #ccc">
${page('Leaf record &mdash; ' + sandbox.escapeHtml(leafChild.ref), leafNode)}
</body></html>`;

const out = path.join(root, 'data/browse/proni-preview.html');
fs.writeFileSync(out, html);
console.log('wrote', out);
console.log('root children:', rootNode.item.childCount, '| mid children:', midNode.item.childCount, '| leaf:', leafChild.ref, '-', (leafChild.title || '').slice(0, 40));
