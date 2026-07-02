// Civgraph PRONI Search — live search over the D1-backed PRONI catalogue.
const API = '/_api/proni/search';
const NODE_API = '/_api/proni/node';
const LIMIT = 25;

const $ = (id) => document.getElementById(id);
const els = {
  q: $('q'), clear: $('clearBtn'), adv: $('advToggle'), advanced: $('advanced'),
  fTitle: $('fTitle'), fDescription: $('fDescription'), fRef: $('fRef'), fDates: $('fDates'),
  from: $('dateFrom'), to: $('dateTo'), sort: $('sort'), dir: $('dirBtn'),
  az: $('azBar'), status: $('status'), results: $('results'), sentinel: $('sentinel'),
  modal: $('modal'), modalBody: $('modalBody'),
};

const state = { offset: 0, done: false, loading: false, seen: new Set(), letter: '', reqId: 0 };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yearOf = (v) => (v && /^\d{4}/.test(v) ? v.slice(0, 4) : '');

function params(offset) {
  const p = new URLSearchParams();
  const q = els.q.value.trim();
  if (q) p.set('q', q);
  if (els.fTitle.value.trim()) p.set('title', els.fTitle.value.trim());
  if (els.fDescription.value.trim()) p.set('description', els.fDescription.value.trim());
  if (els.fRef.value.trim()) p.set('ref', els.fRef.value.trim());
  if (els.fDates.value.trim()) p.set('dates', els.fDates.value.trim());
  const from = yearOf(els.from.value), to = yearOf(els.to.value);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (state.letter) p.set('letter', state.letter);
  p.set('sort', els.sort.value);
  p.set('dir', els.dir.dataset.dir);
  p.set('limit', String(LIMIT));
  p.set('offset', String(offset));
  return p;
}

function hasAnyInput() {
  return els.q.value.trim() || els.fTitle.value.trim() || els.fDescription.value.trim() ||
    els.fRef.value.trim() || els.fDates.value.trim() || yearOf(els.from.value) || yearOf(els.to.value) || state.letter;
}

async function search(reset) {
  if (state.loading) return;
  if (reset) { state.offset = 0; state.done = false; state.seen = new Set(); }
  if (state.done) return;
  if (!hasAnyInput()) {
    els.results.innerHTML = '';
    els.status.textContent = 'Type to search 1,538,177 PRONI catalogue records — or pick a starting letter.';
    state.done = true;
    return;
  }
  state.loading = true;
  const rid = ++state.reqId;
  if (reset) els.status.textContent = 'Searching…';
  try {
    const resp = await fetch(`${API}?${params(state.offset)}`);
    const data = await resp.json();
    if (rid !== state.reqId) return; // stale
    if (data.error) { els.status.textContent = 'Search error.'; state.done = true; return; }
    const batch = data.results || [];
    if (reset) els.results.innerHTML = '';
    const fresh = batch.filter((r) => !state.seen.has(r.ref));
    fresh.forEach((r) => { state.seen.add(r.ref); els.results.insertAdjacentHTML('beforeend', card(r)); });
    state.offset += LIMIT;
    if (batch.length < LIMIT) state.done = true;
    const n = state.seen.size;
    els.status.textContent = n ? `${n.toLocaleString()}${state.done ? '' : '+'} result${n === 1 ? '' : 's'}` : 'No matching records.';
    if (!n) els.results.innerHTML = '<li class="ps-empty">No records match your search. Try fewer or broader terms.</li>';
  } catch {
    if (rid === state.reqId) els.status.textContent = 'Search is temporarily unavailable.';
  } finally {
    state.loading = false;
  }
}

function card(r) {
  const meta = [];
  if (r.level) meta.push(`<span><b>Level:</b> ${esc(r.level)}</span>`);
  if (r.dates) meta.push(`<span><b>Dates:</b> ${esc(r.dates)}</span>`);
  if (r.access) meta.push(`<span><b>Access:</b> ${esc(r.access)}</span>`);
  if (r.fond) meta.push(`<span class="ps-badge">${esc(r.fond)}</span>`);
  if (r.digitalRecord) meta.push('<span class="ps-badge ps-badge--digi">Digitised</span>');
  const desc = r.description
    ? `<p class="ps-card__desc">${esc(r.description)}${r.descTruncated ? '…' : ''}</p>` +
      (r.descTruncated ? `<button type="button" class="ps-card__more" data-ref="${esc(r.ref)}">Show more</button>` : '')
    : '';
  return `<li class="ps-card">
    <div class="ps-card__top">
      <h2 class="ps-card__title">${esc(r.title || r.ref)}</h2>
      <span class="ps-card__ref">${esc(r.ref)}</span>
    </div>
    <div class="ps-card__meta">${meta.join('')}</div>
    ${desc}
  </li>`;
}

// --- detail modal (full record incl. full description) ---
async function openModal(ref) {
  els.modal.hidden = false;
  els.modalBody.innerHTML = '<p class="ps-loading">Loading record…</p>';
  document.body.style.overflow = 'hidden';
  try {
    const data = await (await fetch(`${NODE_API}?ref=${encodeURIComponent(ref)}`)).json();
    const it = data.item;
    if (!it) { els.modalBody.innerHTML = '<p class="ps-empty">Record not found.</p>'; return; }
    const rows = [
      ['PRONI reference', it.ref], ['Title', it.title], ['Level', it.level], ['Dates', it.dates],
      ['Access', it.access], ['Digital record', it.digitalRecord ? 'Digitised — held by PRONI' : ''],
      ['Repository', 'Public Record Office of Northern Ireland'],
    ].filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    els.modalBody.innerHTML = `
      <h2 id="modalTitle">${esc(it.title || it.ref)}</h2>
      <div class="ps-modal__ref">${esc(it.ref)}</div>
      <dl class="ps-dl">${rows}</dl>
      ${it.description ? `<div class="ps-modal__descheading">Description</div><div class="ps-modal__desc">${esc(it.description)}</div>` : ''}
      <a class="ps-modal__link" href="/browse/#/proni/${encodeURIComponent(it.slug)}" target="_blank" rel="noopener">Open in Civgraph Browse ↗</a>`;
  } catch {
    els.modalBody.innerHTML = '<p class="ps-empty">Could not load this record.</p>';
  }
}
function closeModal() { els.modal.hidden = true; document.body.style.overflow = ''; }

// --- A-Z bar ---
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((L) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ps-az__btn'; b.textContent = L; b.dataset.letter = L;
  els.az.appendChild(b);
});
const azClear = document.createElement('button');
azClear.type = 'button'; azClear.className = 'ps-az__clear'; azClear.textContent = 'All';
els.az.appendChild(azClear);

// --- events ---
let timer;
const debounced = () => { clearTimeout(timer); timer = setTimeout(() => search(true), 220); els.clear.hidden = !els.q.value; };
[els.q, els.fTitle, els.fDescription, els.fRef, els.fDates].forEach((el) => el.addEventListener('input', debounced));
[els.from, els.to, els.sort].forEach((el) => el.addEventListener('change', () => search(true)));

els.dir.addEventListener('click', () => {
  const asc = els.dir.dataset.dir === 'asc';
  els.dir.dataset.dir = asc ? 'desc' : 'asc';
  els.dir.textContent = asc ? '↓' : '↑';
  search(true);
});
els.adv.addEventListener('click', () => {
  const open = els.advanced.hidden;
  els.advanced.hidden = !open;
  els.adv.setAttribute('aria-expanded', String(open));
  els.adv.textContent = open ? 'Advanced search ▴' : 'Advanced search ▾';
});
els.clear.addEventListener('click', () => { els.q.value = ''; els.clear.hidden = true; search(true); els.q.focus(); });
els.az.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-letter]');
  if (btn) {
    state.letter = state.letter === btn.dataset.letter ? '' : btn.dataset.letter;
  } else if (e.target === azClear) {
    state.letter = '';
  } else return;
  els.az.querySelectorAll('.ps-az__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.letter === state.letter));
  search(true);
});
els.results.addEventListener('click', (e) => {
  const more = e.target.closest('[data-ref]');
  if (more) openModal(more.dataset.ref);
});
els.modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.modal.hidden) closeModal(); });

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && !state.loading && !state.done && hasAnyInput()) search(false);
}, { rootMargin: '600px' }).observe(els.sentinel);

search(true);
