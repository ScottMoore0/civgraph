/**
 * The component gallery's token table (/design-system/, functions/design-system/index.js).
 *
 * Reads assets/ui/tokens.css itself and lists every token of its light block under the group
 * comment it sits under, with its light and dark values and a preview drawn with the token in
 * the current theme. A token added to tokens.css appears here with no other edit.
 * Also opens the specimen dialog, and keeps the specimen search form from navigating.
 */
/**
 * The declarations of the block that starts at `opener`, grouped by the comment above them.
 * @param {string} text
 * @param {string} opener
 */
export function parseTokens(text, opener) {
  const start = text.indexOf(opener);
  if (start < 0) return [];
  let depth = 0;
  let end = text.length;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') { depth -= 1; if (!depth) { end = i; break; } }
  }
  const body = text.slice(text.indexOf('{', start) + 1, end);
  const out = [];
  let group = 'tokens';
  for (const line of body.split('\n')) {
    const comment = line.match(/^\s*\/\*\s*([^:*(]+?)\s*(?:[:(].*)?\*\/\s*$/);
    if (comment) { group = comment[1]; continue; }
    const decl = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/);
    if (decl) out.push({ group, name: decl[1], value: decl[2] });
  }
  return out;
}

/**
 * @param {string} name   the token, `--name`
 * @param {string} live   its computed value now
 */
function preview(name, live) {
  const el = document.createElement('span');
  if (/^--(font)/.test(name)) {
    el.textContent = 'Aa Civgraph 1923';
    el.style.fontFamily = `var(${name})`;
  } else if (/^--text-(xs|sm|base|lg|\d?xl)$/.test(name)) {
    el.textContent = 'Aa';
    el.style.fontSize = `var(${name})`;
  } else if (/^--weight-/.test(name)) {
    el.textContent = 'Aa';
    el.style.fontWeight = `var(${name})`;
  } else if (/^--space-/.test(name)) {
    el.className = 'cg-gallery__bar';
    el.style.width = `var(${name})`;
  } else if (/^--radius-/.test(name)) {
    el.className = 'cg-gallery__swatch';
    el.style.borderRadius = `var(${name})`;
    el.style.background = 'var(--surface-sunken)';
  } else if (/^--shadow-/.test(name)) {
    el.className = 'cg-gallery__swatch';
    el.style.boxShadow = `var(${name})`;
    el.style.background = 'var(--surface)';
  } else if (live && window.CSS && CSS.supports('color', live)) {
    el.className = 'cg-gallery__swatch';
    el.style.background = `var(${name})`;
  }
  return el;
}

/**
 * @param {string} tag
 * @param {Node | string} content
 */
function cell(tag, content) {
  const el = document.createElement(tag);
  if (content instanceof Node) el.append(content);
  else if (content) {
    const c = document.createElement('code');
    c.textContent = content;
    el.append(c);
  }
  return el;
}

async function drawTokens() {
  const container = document.getElementById('cg-gallery-tokens');
  if (!container) return;
  const src = container.dataset.tokensSrc;
  let text;
  try {
    const res = await fetch(String(src), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (error) {
    container.textContent = `Could not read ${src}: ${/** @type {Error} */ (error).message}`;
    return;
  }
  const light = parseTokens(text, ':root {');
  const dark = new Map(parseTokens(text, ':root[data-theme="dark"]').map((t) => [t.name, t.value]));
  const live = getComputedStyle(document.documentElement);
  const groups = new Map();
  for (const t of light) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  container.textContent = '';
  const summary = document.createElement('p');
  summary.textContent = `${light.length} tokens; ${dark.size} have a dark value.`;
  container.append(summary);
  for (const [group, tokens] of groups) {
    const h = document.createElement('h3');
    h.textContent = group;
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const label of ['Token', 'Light', 'Dark', 'Now']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      head.append(th);
    }
    const body = table.createTBody();
    for (const t of tokens) {
      const row = body.insertRow();
      row.append(cell('th', t.name), cell('td', t.value), cell('td', dark.get(t.name) || ''), cell('td', preview(t.name, live.getPropertyValue(t.name).trim())));
      row.cells[0].scope = 'row';
    }
    container.append(h, table);
  }
}

function wireSpecimens() {
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-gallery-open]'))) {
    button.addEventListener('click', () => /** @type {HTMLDialogElement | null} */ (document.getElementById(String(button.dataset.galleryOpen)))?.showModal?.());
  }
  for (const form of document.querySelectorAll('.cg-gallery__example form[role="search"]')) {
    form.addEventListener('submit', (event) => event.preventDefault());
  }
}

if (typeof document !== 'undefined') {
  wireSpecimens();
  drawTokens();
}
