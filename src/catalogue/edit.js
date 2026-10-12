/**
 * Suggesting an edit to a map from the catalogue (contributors only).
 *
 * It reuses what Browse's "propose edit" form already relies on: Cloudflare Access sign-in
 * (/_api/contributions/login), who is signed in (/_api/auth/status, then
 * /_api/contributions/whoami, which sits inside the Access application and so can see the
 * identity), and the review queue (/_api/contributions/submit). A suggestion changes nothing on
 * the site: an administrator approves it (/_api/contributions/decide), scripts/apply-contributions.mjs
 * writes it into data/database/maps.json on a branch, and it goes out with the next build and
 * catalogue deploy, through every check the data already passes.
 *
 * Fields offered are the map fields the submit schema accepts (functions/_api/contributions/
 * _schema.js) that suit free editing; provider is left out because the schema takes it as one
 * string while map records hold a list.
 */
import { esc } from './util.js';
import { icon } from './icons.js';

/** Who is signed in: the public status first (works signed out), then whoami (inside Access). */
export async function loadAuth() {
  let auth = { authenticated: false, allowed: false, loginUrl: null };
  try {
    const res = await fetch('/_api/auth/status', { credentials: 'same-origin' });
    if (res.ok) auth = { ...auth, ...((await res.json())?.auth || {}) };
  } catch { /* offline or no Functions: stay signed out */ }
  try {
    const res = await fetch('/_api/contributions/whoami', { credentials: 'same-origin', redirect: 'manual' });
    if (res.ok) auth = { ...auth, ...((await res.json())?.auth || {}) };
  } catch { /* not signed in */ }
  return auth;
}

/** Where to sign in, coming back to this page. */
export function loginHref() {
  return `/_api/contributions/login?return=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`;
}

const asText = (v) => (v === undefined || v === null ? '' : String(v));

/** Open the edit dialog for map `id` (its current record is `record`). */
export function openEditDialog(record, { onDone, host = document.body } = {}) {
  document.querySelector('.cn-edit')?.remove();
  const refs = Array.isArray(record.references) ? record.references.map((r) => (typeof r === 'string' ? { label: r, url: /^https?:/.test(r) ? r : '' } : { label: r.label || r.title || r.url || '', url: r.url || r.href || '', note: r.note || '' })) : [];
  const baseline = {
    name: asText(record.name),
    description: asText(record.description),
    date: asText(record.date),
    licence: asText(record.licence || record.license),
    keywords: (record.keywords || []).join(', '),
    references: JSON.stringify(refs),
  };
  const refRow = (r = {}) => `<div class="cn-edit__ref">
      <input type="text" data-ref="label" placeholder="Label" value="${esc(r.label || '')}" aria-label="Reference label">
      <input type="url" data-ref="url" placeholder="https://" value="${esc(r.url || '')}" aria-label="Reference address">
      <input type="text" data-ref="note" placeholder="Note (optional)" value="${esc(r.note || '')}" aria-label="Reference note">
      <button type="button" class="cn-iconbtn" data-ref-remove aria-label="Remove this reference">${icon('x')}</button>
    </div>`;
  const dialog = document.createElement('dialog');
  dialog.className = 'cn-edit';
  dialog.setAttribute('aria-labelledby', 'cn-edit-title');
  dialog.innerHTML = `<form method="dialog" class="cn-edit__form">
    <h2 id="cn-edit-title">Suggest an edit: ${esc(record.name || record.id)}</h2>
    <p class="cn-muted">Your suggestion goes to the review queue. Nothing on the site changes until an administrator approves it.</p>
    <label>Name <input type="text" name="name" value="${esc(baseline.name)}" maxlength="4000"></label>
    <label>Description <textarea name="description" rows="5" maxlength="4000">${esc(baseline.description)}</textarea></label>
    <div class="cn-edit__pair">
      <label>Date <input type="text" name="date" value="${esc(baseline.date)}" placeholder="YYYY or YYYY-MM-DD"></label>
      <label>Licence <input type="text" name="licence" value="${esc(baseline.licence)}"></label>
    </div>
    <label>Keywords <input type="text" name="keywords" value="${esc(baseline.keywords)}" placeholder="comma, separated"></label>
    <fieldset class="cn-edit__refs"><legend>References</legend>
      <div data-refs>${refs.map(refRow).join('')}</div>
      <button type="button" class="cn-btn" data-ref-add>${icon('plus')}<span>Add a reference</span></button>
    </fieldset>
    <label>What you changed and why <textarea name="summary" rows="2" required maxlength="1000"></textarea></label>
    <label>Sources for the change (one address per line) <textarea name="sourceUrls" rows="2"></textarea></label>
    <p class="cn-edit__status" role="status" aria-live="polite"></p>
    <div class="cn-edit__buttons">
      <button type="button" class="cn-btn" value="cancel" data-edit-cancel>Cancel</button>
      <button type="submit" class="cn-btn cn-btn--primary" data-edit-submit>Send for review</button>
    </div>
  </form>`;
  // Inside the catalogue, so its colour tokens (set on .cn) apply; a modal dialog still sits on top.
  host.appendChild(dialog);
  const form = dialog.querySelector('form');
  const status = dialog.querySelector('.cn-edit__status');
  const refsEl = dialog.querySelector('[data-refs]');
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-ref-add]')) { refsEl.insertAdjacentHTML('beforeend', refRow()); refsEl.lastElementChild.querySelector('input')?.focus(); }
    const rm = e.target.closest('[data-ref-remove]');
    if (rm) rm.closest('.cn-edit__ref')?.remove();
    if (e.target.closest('[data-edit-cancel]')) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());

  const collect = () => {
    const fd = new FormData(form);
    const patch = {};
    for (const f of ['name', 'description', 'date', 'licence']) {
      const v = String(fd.get(f) || '').trim();
      if (v !== baseline[f]) patch[f] = v === '' ? null : v;
    }
    const kw = String(fd.get('keywords') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (kw.join(', ') !== baseline.keywords) patch.keywords = kw.length ? kw : null;
    const nextRefs = [...refsEl.querySelectorAll('.cn-edit__ref')].map((row) => {
      const get = (k) => row.querySelector(`[data-ref="${k}"]`).value.trim();
      const r = { label: get('label') };
      if (get('url')) r.url = get('url');
      if (get('note')) r.note = get('note');
      return r;
    }).filter((r) => r.label || r.url);
    if (JSON.stringify(nextRefs.map((r) => ({ label: r.label, url: r.url || '', note: r.note || '' }))) !== baseline.references) {
      patch.references = nextRefs.length ? nextRefs.map((r) => ({ ...r, label: r.label || r.url })) : null;
    }
    return { patch, summary: String(fd.get('summary') || '').trim(), sourceUrls: String(fd.get('sourceUrls') || '').split(/\s+/).filter(Boolean) };
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { patch, summary, sourceUrls } = collect();
    if (!Object.keys(patch).length) { status.textContent = 'Nothing has changed yet.'; return; }
    if (!summary) { status.textContent = 'Say what you changed and why.'; return; }
    const button = dialog.querySelector('[data-edit-submit]');
    button.disabled = true;
    status.textContent = 'Sending…';
    try {
      const res = await fetch('/_api/contributions/submit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'metadata-edit', entityType: 'map', entityId: record.id, summary, patch, sourceUrls, pageUrl: location.href }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error((data.dryRun?.errors || []).join(' ') || data.hint || data.error || `${res.status} ${res.statusText}`);
      status.textContent = `Sent for review (${data.submission?.id || 'pending'}). Nothing changes on the site until an administrator approves it.`;
      button.hidden = true;
      dialog.querySelector('[data-edit-cancel]').textContent = 'Close';
      onDone?.(data);
    } catch (err) {
      status.textContent = `Not sent: ${err.message}`;
      button.disabled = false;
    }
  });
  dialog.showModal();
  dialog.querySelector('input[name="name"]')?.focus();
  return dialog;
}
