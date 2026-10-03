/* Catalogue editor: makes the catalogue pane editable in place and lets a right-click pin a
 * note to any point of the page. Loaded only by tools/catalogue-editor/server.mjs; nothing
 * here changes the site. Every edit is recorded against the catalogue's own ids and saved to
 * tools/catalogue-editor/state/edits.json, every note to notes.json, for review.
 *
 * What can be edited (in Edit mode):
 *   - any label or field: contents headings, subheadings and items (name, years, scope),
 *     decade buttons, card titles and subtitles, card section headers, entry names, dates,
 *     providers and details, election and variant names -- click and type, Enter to keep,
 *     Esc to undo;
 *   - the contents structure: drag a row by its handle, indent or outdent it under a
 *     subheading, add a subheading, or mark a row for removal;
 *   - the order of entries within a card, by dragging;
 *   - an entry's attributes (shown by default, FGB download, badges, a comment) from its gear.
 */
(() => {
  'use strict';
  if (window.__catalogueEditor) return;
  window.__catalogueEditor = true;

  const API = '/__editor/state';
  const PAGE = location.pathname;
  const S = { edits: null, notes: [], editMode: true, showPins: true, applying: false };
  const blank = () => ({ schemaVersion: 1, text: {}, attrs: {}, order: {}, toc: { added: [], removed: [], indent: {} }, log: [] });
  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const now = () => new Date().toISOString();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssq = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));

  // ------------------------------------------------------------------ persistence
  let saveTimer = null;
  const pending = new Set();
  function save(which) {
    pending.add(which);
    status('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const files = [...pending];
      pending.clear();
      try {
        for (const f of files) {
          const body = f === 'edits' ? S.edits : S.notes;
          const r = await fetch(`${API}/${f}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!r.ok) throw new Error(r.status);
        }
        status('Saved');
      } catch (e) {
        status('Not saved: is the editor server running?', true);
      }
      refreshCounts();
    }, 350);
  }
  function log(action, detail) {
    S.edits.log.push({ at: now(), page: PAGE, action, ...detail });
  }

  // ------------------------------------------------------------------ fields
  const tocTarget = (el) => el.closest('tr')?.querySelector('a.catalogue-flat__toc-link')?.dataset.catalogueTarget || '';
  const cardId = (el) => el.closest('.c1-card')?.dataset.c1Id || '';
  const memberKey = (el) => {
    const m = el.closest('.class-member');
    return m ? `${cardId(m)}|${m.dataset.mapId || ''}` : '';
  };
  const orig = (el) => (el.dataset.ceOrig !== undefined ? el.dataset.ceOrig : (el.dataset.ceOrig = text(el)));
  const FIELDS = [
    { kind: 'contents heading', sel: '.catalogue-flat__toc-heading', key: (el) => `toc-heading|${orig(el)}` },
    { kind: 'contents subheading', sel: '.catalogue-flat__toc-subheading', key: (el) => `toc-sub|${el.dataset.catalogueTarget || el.dataset.ceNew}` },
    { kind: 'contents item: name', sel: 'a.catalogue-flat__toc-link .catalogue-flat__toc-name', key: (el) => `toc-item|${tocTarget(el)}|name` },
    { kind: 'contents item: years', sel: '.ce-when', key: (el) => `toc-item|${tocTarget(el)}|years` },
    { kind: 'contents item: scope', sel: '.catalogue-flat__toc-scope', key: (el) => `toc-item|${tocTarget(el)}|scope` },
    { kind: 'contents item: extent', sel: '.ce-extent', key: (el) => `toc-item|${tocTarget(el)}|extent` },
    { kind: 'decade button', sel: '.catalogue-flat__toc-decade-btn', key: (el) => `toc-decade|${el.dataset.catalogueTarget}` },
    { kind: 'card title', sel: '.c1-card__title', key: (el) => `card|${cardId(el)}|title` },
    { kind: 'card subtitle', sel: '.c1-card__subtitle', key: (el) => `card|${cardId(el)}|subtitle` },
    { kind: 'card section header', sel: '.c1-card__section-header', key: (el) => `card-section|${cardId(el)}|${orig(el)}` },
    { kind: 'entry name', sel: '.class-member[data-map-id] .class-member__name', key: (el) => `entry|${memberKey(el)}|name` },
    { kind: 'entry date', sel: '.class-member[data-map-id] .class-member__date', key: (el) => `entry|${memberKey(el)}|date` },
    { kind: 'entry provider', sel: '.class-member[data-map-id] .class-member__provider', key: (el) => `entry|${memberKey(el)}|provider` },
    { kind: 'entry details', sel: '.class-member[data-map-id] .class-member__change-note', key: (el) => `entry|${memberKey(el)}|details` },
    { kind: 'entry description', sel: '.class-member[data-map-id] .class-member__desc', key: (el) => `entry|${memberKey(el)}|description` },
    { kind: 'election name', sel: '.flat-election-entry .flat-election-body', key: (el) => {
      const r = el.closest('.flat-election-entry'); return `election|${r.dataset.electionBody}|${r.dataset.electionDate}|name`; } },
    { kind: 'election details', sel: '.flat-election-entry .class-member__desc', key: (el) => {
      const r = el.closest('.flat-election-entry'); return `election|${r.dataset.electionBody}|${r.dataset.electionDate}|details`; } },
    { kind: 'variant name', sel: '.variant-item .variant-item__name', key: (el) => `variant|${el.closest('.variant-item').dataset.mapId}|name` },
    { kind: 'variant description', sel: '.variant-item .variant-item__description', key: (el) => `variant|${el.closest('.variant-item').dataset.mapId}|description` },
  ];

  function wrapTocCells(root) {
    root.querySelectorAll('.catalogue-flat__toc-table tr').forEach((tr) => {
      if (!tr.querySelector('a.catalogue-flat__toc-link')) return;
      const tds = tr.children;
      const when = tr.querySelector('td.catalogue-flat__toc-when') || tds[1];
      if (when && !when.querySelector('.ce-when')) {
        const span = document.createElement('span');
        span.className = 'ce-when';
        [...when.childNodes].filter((n) => n.nodeType === 3).forEach((n) => span.appendChild(n));
        when.insertBefore(span, when.firstChild);
      }
      const extent = tds[2];
      if (extent && !extent.querySelector('.ce-extent')) {
        const span = document.createElement('span');
        span.className = 'ce-extent';
        while (extent.firstChild) span.appendChild(extent.firstChild);
        extent.appendChild(span);
      }
    });
  }

  function bindFields(root) {
    for (const f of FIELDS) {
      root.querySelectorAll(f.sel).forEach((el) => {
        if (el.dataset.ceKey) return;
        orig(el);
        let key;
        try { key = f.key(el); } catch { return; }
        if (!key || /\|\|/.test(key) || key.endsWith('|')) return;
        el.dataset.ceKey = key;
        el.dataset.ceKind = f.kind;
        el.classList.add('ce-field');
        setEditable(el);
        const e = S.edits.text[key];
        if (e) { el.textContent = e.value; el.classList.add('ce-changed'); }
      });
    }
  }
  function setEditable(el) {
    if (S.editMode) {
      el.setAttribute('contenteditable', 'plaintext-only');
      if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'true');
    } else {
      el.removeAttribute('contenteditable');
    }
  }

  // ------------------------------------------------------------------ contents rows
  const tocTable = () => document.querySelector('.catalogue-flat__toc-table');
  function rowKey(tr) {
    if (tr.classList.contains('catalogue-flat__toc-heading-row')) {
      const h = tr.querySelector('.catalogue-flat__toc-heading');
      return h ? `h|${orig(h)}` : null;
    }
    if (tr.classList.contains('catalogue-flat__toc-subheading-row')) {
      const a = tr.querySelector('.catalogue-flat__toc-subheading');
      return a ? `s|${a.dataset.catalogueTarget || a.dataset.ceNew}` : null;
    }
    const link = tr.querySelector('a.catalogue-flat__toc-link');
    return link ? `i|${link.dataset.catalogueTarget}` : null;
  }
  const INDENT = 'catalogue-flat__toc-row--indented';

  function decorateToc() {
    const table = tocTable();
    if (!table) return;
    const body = table.tBodies[0] || table;
    // Subheadings added here.
    for (const a of S.edits.toc.added) {
      if (body.querySelector(`[data-ce-new="${cssq(a.id)}"]`)) continue;
      const tr = document.createElement('tr');
      tr.className = 'catalogue-flat__toc-subheading-row ce-added-row';
      tr.innerHTML = `<td colspan="3"><span class="catalogue-flat__toc-subheading" data-ce-new="${esc(a.id)}">${esc(a.text)}</span></td>`;
      body.appendChild(tr);
    }
    [...body.rows].forEach((tr) => {
      const key = rowKey(tr);
      if (!key) return;
      tr.dataset.ceRow = key;
      if (tr.dataset.ceOrigIndent === undefined) tr.dataset.ceOrigIndent = tr.classList.contains(INDENT) ? '1' : '0';
      const first = tr.cells[0];
      if (first && !first.querySelector('.ce-handle') && !key.startsWith('h|')) {
        const tools = document.createElement('span');
        tools.className = 'ce-ui ce-rowtools';
        tools.innerHTML = '<span class="ce-handle" draggable="true" title="Drag to move this row">⠿</span>'
          + (key.startsWith('i|') ? '<button type="button" class="ce-btn ce-indent" title="Indent or outdent under the subheading above">⇥</button>' : '')
          + '<button type="button" class="ce-btn ce-remove" title="Mark this row for removal (click again to keep it)">✕</button>';
        first.insertBefore(tools, first.firstChild);
      }
      if (key.startsWith('h|') && first && !first.querySelector('.ce-addsub')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ce-ui ce-btn ce-addsub';
        b.textContent = '+ subheading';
        b.title = 'Add a subheading at the top of this section';
        first.appendChild(b);
      }
      const ind = S.edits.toc.indent[key];
      if (ind !== undefined) tr.classList.toggle(INDENT, ind);
      tr.classList.toggle('ce-removed', S.edits.toc.removed.includes(key));
    });
    applyTocOrder(body);
  }

  function applyTocOrder(body) {
    const want = S.edits.order.toc;
    if (!want || !want.length) return;
    const rows = [...body.rows];
    const byKey = new Map(rows.filter((r) => r.dataset.ceRow).map((r) => [r.dataset.ceRow, r]));
    const result = want.map((k) => byKey.get(k)).filter(Boolean);
    const inResult = new Set(result);
    rows.forEach((r, i) => {
      if (inResult.has(r)) return;
      let j = i - 1;
      while (j >= 0 && !inResult.has(rows[j])) j -= 1;
      const at = j >= 0 ? result.indexOf(rows[j]) + 1 : 0;
      result.splice(at, 0, r);
      inResult.add(r);
    });
    if (result.every((r, i) => rows[i] === r)) return;
    S.applying = true;
    result.forEach((r) => body.appendChild(r));
    setTimeout(() => { S.applying = false; }, 0);
  }

  function snapshotToc() {
    const table = tocTable();
    if (!table) return;
    const body = table.tBodies[0] || table;
    S.edits.order.toc = [...body.rows].map((r) => r.dataset.ceRow).filter(Boolean);
    [...body.rows].forEach((tr) => {
      const key = tr.dataset.ceRow;
      if (!key || !key.startsWith('i|')) return;
      const now = tr.classList.contains(INDENT);
      if ((tr.dataset.ceOrigIndent === '1') === now) delete S.edits.toc.indent[key];
      else S.edits.toc.indent[key] = now;
    });
  }

  // ------------------------------------------------------------------ entries
  function decorateEntries(root) {
    root.querySelectorAll('.class-member[data-map-id], .variant-item[data-map-id]').forEach((m) => {
      if (m.querySelector(':scope > .ce-entrytools')) return;
      const isMember = m.classList.contains('class-member');
      const tools = document.createElement('span');
      tools.className = 'ce-ui ce-entrytools';
      tools.innerHTML = (isMember ? '<span class="ce-handle" draggable="true" title="Drag to reorder within this card">⠿</span>' : '')
        + '<button type="button" class="ce-btn ce-gear" title="Attributes">⚙</button>';
      m.insertBefore(tools, m.firstChild);
      const k = attrKey(m);
      m.classList.toggle('ce-attr-changed', Boolean(S.edits.attrs[k]));
      const a = S.edits.attrs[k]?.fields;
      m.dataset.ceProposed = a ? describeAttrs(a) : '';
    });
    // Orders within each list of entries.
    for (const [k, ids] of Object.entries(S.edits.order)) {
      if (!k.startsWith('entries|')) continue;
      const list = findEntryList(k);
      if (list) reorderEntries(list, ids);
    }
  }
  const attrKey = (m) => (m.classList.contains('variant-item') ? `variant|${m.dataset.mapId}` : `entry|${cardId(m)}|${m.dataset.mapId}`);
  function listKey(list) {
    const sec = list.closest('.c1-card__section');
    const header = sec ? orig(sec.querySelector('.c1-card__section-header') || sec) : 'main';
    return `entries|${cardId(list)}|${header}`;
  }
  function findEntryList(k) {
    const [, card] = k.split('|');
    const cardEl = document.querySelector(`.c1-card[data-c1-id="${cssq(card)}"]`);
    if (!cardEl) return null;
    const lists = new Set([...cardEl.querySelectorAll('.class-member[data-map-id]')].map((m) => m.parentElement));
    return [...lists].find((l) => listKey(l) === k) || null;
  }
  function entryUnits(list) {
    return [...list.children].filter((c) => c.classList.contains('class-member') && c.dataset.mapId).map((m) => {
      const next = m.nextElementSibling;
      return { id: m.dataset.mapId, nodes: next && next.classList.contains('variants-container') ? [m, next] : [m] };
    });
  }
  function reorderEntries(list, ids) {
    const units = entryUnits(list);
    const cur = units.map((u) => u.id);
    const pos = new Map(ids.map((id, i) => [id, i]));
    const sorted = [...units].sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e6 + cur.indexOf(a.id)) - (pos.has(b.id) ? pos.get(b.id) : 1e6 + cur.indexOf(b.id)));
    if (sorted.every((u, i) => u.id === cur[i])) return;
    S.applying = true;
    const anchor = units[0].nodes[0].previousSibling;
    const frag = document.createDocumentFragment();
    sorted.forEach((u) => u.nodes.forEach((n) => frag.appendChild(n)));
    list.insertBefore(frag, anchor ? anchor.nextSibling : list.firstChild);
    setTimeout(() => { S.applying = false; }, 0);
  }

  // ------------------------------------------------------------------ attributes popover
  function describeAttrs(a) {
    const out = [];
    if (a.shown === false) out.push('hidden by default');
    if (a.shown === true) out.push('shown by default');
    if (a.download === false) out.push('no FGB download');
    if (a.download === true) out.push('FGB download offered');
    if (a.badges) out.push(`badges: ${a.badges}`);
    if (a.comment) out.push(`comment: ${a.comment}`);
    return out.join('; ');
  }
  function openAttrs(m, at) {
    closePopovers();
    const k = attrKey(m);
    const isVar = m.classList.contains('variant-item');
    const nameEl = m.querySelector(isVar ? '.variant-item__name' : '.class-member__name');
    const field = (sel) => m.querySelector(sel);
    const cur = {
      shown: !m.closest('[hidden]') && getComputedStyle(m).display !== 'none',
      download: [...m.querySelectorAll('button')].some((b) => /Download FGB/i.test(b.title || '')),
      badges: [...m.querySelectorAll('.class-member__placeholder-badge, .class-member__incomplete-badge')].map(text).join(', '),
    };
    const saved = S.edits.attrs[k]?.fields || {};
    const val = (name) => (saved[name] !== undefined ? saved[name] : cur[name]);
    const texts = isVar
      ? [['name', '.variant-item__name', 'Display name'], ['description', '.variant-item__description', 'Description']]
      : [['name', '.class-member__name', 'Display name'], ['date', '.class-member__date', 'Date shown'],
        ['provider', '.class-member__provider', 'Provider / feature count'], ['details', '.class-member__change-note, .class-member__desc', 'Details']];
    const pop = document.createElement('div');
    pop.className = 'ce-ui ce-pop';
    pop.innerHTML = `<div class="ce-pop__title">${esc(text(nameEl) || m.dataset.mapId)}<span class="ce-pop__id">${esc(m.dataset.mapId)}</span></div>
      ${texts.map(([n, sel, label]) => { const el = field(sel); return el ? `<label>${label}<input data-f="${n}" data-sel="${esc(sel)}" value="${esc(text(el))}"></label>` : ''; }).join('')}
      <label>Badges <input data-f="badges" value="${esc(val('badges'))}" placeholder="e.g. To Be Added"></label>
      <label class="ce-check"><input type="checkbox" data-f="shown" ${val('shown') ? 'checked' : ''}> Shown by default</label>
      <label class="ce-check"><input type="checkbox" data-f="download" ${val('download') ? 'checked' : ''}> FGB download offered</label>
      <label>Comment for review<textarea data-f="comment" rows="3">${esc(saved.comment || '')}</textarea></label>
      <div class="ce-pop__btns"><button type="button" class="ce-save">Save</button><button type="button" class="ce-close">Close</button></div>`;
    placePop(pop, at);
    pop.querySelector('.ce-close').onclick = closePopovers;
    pop.querySelector('.ce-save').onclick = () => {
      // Text fields are the same edits as typing in place.
      pop.querySelectorAll('input[data-sel]').forEach((inp) => {
        const el = field(inp.dataset.sel);
        if (el && inp.value.trim() !== text(el)) { el.textContent = inp.value.trim(); commitText(el); }
      });
      const fields = {};
      const b = pop.querySelector('[data-f="badges"]').value.trim();
      const shown = pop.querySelector('[data-f="shown"]').checked;
      const dl = pop.querySelector('[data-f="download"]').checked;
      const comment = pop.querySelector('[data-f="comment"]').value.trim();
      if (b !== cur.badges) fields.badges = b;
      if (shown !== cur.shown) fields.shown = shown;
      if (dl !== cur.download) fields.download = dl;
      if (comment) fields.comment = comment;
      if (Object.keys(fields).length) {
        S.edits.attrs[k] = { key: k, kind: isVar ? 'variant' : 'entry', id: m.dataset.mapId, card: cardId(m), label: text(nameEl), fields, original: cur, updatedAt: now() };
      } else delete S.edits.attrs[k];
      log('attributes', { key: k, fields });
      m.classList.toggle('ce-attr-changed', Boolean(S.edits.attrs[k]));
      m.dataset.ceProposed = S.edits.attrs[k] ? describeAttrs(fields) : '';
      save('edits');
      closePopovers();
    };
  }

  // ------------------------------------------------------------------ text commits
  function commitText(el) {
    const key = el.dataset.ceKey;
    const value = text(el);
    const original = el.dataset.ceOrig;
    if (value === original) {
      if (S.edits.text[key]) log('revert', { key });
      delete S.edits.text[key];
      el.classList.remove('ce-changed');
    } else {
      S.edits.text[key] = { key, kind: el.dataset.ceKind, original, value, page: PAGE, updatedAt: now() };
      el.classList.add('ce-changed');
      log('edit', { key, original, value });
    }
    save('edits');
  }

  // ------------------------------------------------------------------ events
  let editingBefore = null;
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('.ce-field');
    if (el && S.editMode) editingBefore = text(el);
  }, true);
  document.addEventListener('focusout', (e) => {
    const el = e.target.closest && e.target.closest('.ce-field');
    if (el && S.editMode && editingBefore !== null) {
      if (text(el) !== editingBefore) commitText(el);
      editingBefore = null;
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest && e.target.closest('.ce-field');
    if (!el || !S.editMode) return;
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); el.textContent = editingBefore ?? el.textContent; editingBefore = null; el.blur(); }
    e.stopPropagation();
  }, true);
  document.addEventListener('paste', (e) => {
    const el = e.target.closest && e.target.closest('.ce-field');
    if (!el || !S.editMode) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s+/g, ' '));
  }, true);

  // The editor's own buttons act and go no further, so a gear inside an entry does not also
  // toggle the entry's layer. In Edit mode a click on a field edits it rather than following
  // its link. Everything else -- pins, popover buttons, inputs -- is left to its own handlers.
  const UI_BUTTONS = '.ce-indent, .ce-remove, .ce-addsub, .ce-gear, #ce-toggle-edit, #ce-toggle-pins, #ce-review';
  ['click', 'mousedown', 'pointerdown', 'mouseup', 'pointerup'].forEach((type) => document.addEventListener(type, (e) => {
    if (!e.target.closest) return;
    const btn = e.target.closest(UI_BUTTONS);
    if (btn) {
      e.stopPropagation();
      if (type === 'click') { e.preventDefault(); handleUiClick({ target: btn }); }
      return;
    }
    if (e.target.closest('.ce-handle')) { if (type !== 'click') e.stopPropagation(); return; }
    if (e.target.closest('.ce-ui') || !S.editMode) return;
    const field = e.target.closest('.ce-field');
    if (field) {
      e.stopPropagation();
      if (type === 'click') { e.preventDefault(); if (document.activeElement !== field) field.focus(); }
    }
  }, true));

  function handleUiClick(e) {
    const t = e.target;
    const tr = t.closest('tr');
    if (t.classList.contains('ce-indent') && tr) {
      tr.classList.toggle(INDENT);
      snapshotToc();
      log('indent', { row: tr.dataset.ceRow, indented: tr.classList.contains(INDENT) });
      save('edits');
    } else if (t.classList.contains('ce-remove') && tr) {
      const key = tr.dataset.ceRow;
      const added = S.edits.toc.added.find((a) => `s|${a.id}` === key);
      if (added) {
        S.edits.toc.added = S.edits.toc.added.filter((a) => a !== added);
        delete S.edits.text[`toc-sub|${added.id}`];
        tr.remove();
        snapshotToc();
        log('delete added subheading', { row: key });
      } else {
        const i = S.edits.toc.removed.indexOf(key);
        if (i >= 0) S.edits.toc.removed.splice(i, 1); else S.edits.toc.removed.push(key);
        tr.classList.toggle('ce-removed', i < 0);
        log(i < 0 ? 'mark for removal' : 'keep', { row: key });
      }
      save('edits');
    } else if (t.classList.contains('ce-addsub') && tr) {
      const id = `new-${Date.now().toString(36)}`;
      S.edits.toc.added.push({ id, text: 'New subheading' });
      const nr = document.createElement('tr');
      nr.className = 'catalogue-flat__toc-subheading-row ce-added-row';
      nr.innerHTML = `<td colspan="3"><span class="catalogue-flat__toc-subheading" data-ce-new="${id}">New subheading</span></td>`;
      tr.after(nr);
      decorateToc();
      bindFields(nr);
      snapshotToc();
      log('add subheading', { id });
      S.edits.text[`toc-sub|${id}`] = { key: `toc-sub|${id}`, kind: 'contents subheading (added)', original: '', value: 'New subheading', page: PAGE, updatedAt: now() };
      save('edits');
      const f = nr.querySelector('.ce-field');
      if (f) { f.focus(); document.getSelection().selectAllChildren(f); }
    } else if (t.classList.contains('ce-gear')) {
      const m = t.closest('.class-member, .variant-item');
      if (m) openAttrs(m, t.getBoundingClientRect());
    } else if (t.id === 'ce-toggle-edit') {
      S.editMode = !S.editMode;
      document.documentElement.classList.toggle('ce-on', S.editMode);
      document.querySelectorAll('.ce-field').forEach(setEditable);
      refreshCounts();
    } else if (t.id === 'ce-toggle-pins') {
      S.showPins = !S.showPins;
      refreshCounts();
      updatePins();
    } else if (t.id === 'ce-review') {
      openReview();
    }
  }

  // Drag and drop: contents rows within the contents table; entries within their list.
  let drag = null;
  document.addEventListener('dragstart', (e) => {
    const h = e.target.closest && e.target.closest('.ce-handle');
    if (!h) return;
    const tr = h.closest('.catalogue-flat__toc-table tr');
    const m = h.closest('.class-member');
    drag = tr ? { type: 'row', el: tr } : m ? { type: 'entry', el: m, list: m.parentElement } : null;
    if (!drag) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'ce');
    drag.el.classList.add('ce-dragging');
  }, true);
  document.addEventListener('dragover', (e) => {
    if (!drag) return;
    const over = drag.type === 'row' ? e.target.closest('.catalogue-flat__toc-table tr') : e.target.closest('.class-member');
    clearDropMarks();
    if (!over || over === drag.el) return;
    if (drag.type === 'entry' && over.parentElement !== drag.list) return;
    e.preventDefault();
    const r = over.getBoundingClientRect();
    over.classList.add(e.clientY < r.top + r.height / 2 ? 'ce-drop-before' : 'ce-drop-after');
  }, true);
  document.addEventListener('drop', (e) => {
    if (!drag) return;
    const over = document.querySelector('.ce-drop-before, .ce-drop-after');
    if (over) {
      e.preventDefault();
      const before = over.classList.contains('ce-drop-before');
      if (drag.type === 'row') {
        before ? over.before(drag.el) : over.after(drag.el);
        snapshotToc();
        log('move row', { row: drag.el.dataset.ceRow, to: before ? `before ${over.dataset.ceRow}` : `after ${over.dataset.ceRow}` });
      } else {
        const units = entryUnits(drag.list);
        const unit = units.find((u) => u.nodes[0] === drag.el);
        const target = units.find((u) => u.nodes[0] === over);
        if (unit && target) {
          const ref = before ? target.nodes[0] : (target.nodes[target.nodes.length - 1].nextSibling);
          unit.nodes.forEach((n) => drag.list.insertBefore(n, ref));
          S.edits.order[listKey(drag.list)] = entryUnits(drag.list).map((u) => u.id);
          log('move entry', { list: listKey(drag.list), entry: unit.id });
        }
      }
      save('edits');
    }
    clearDropMarks();
  }, true);
  document.addEventListener('dragend', () => {
    if (drag) drag.el.classList.remove('ce-dragging');
    drag = null;
    clearDropMarks();
  }, true);
  const clearDropMarks = () => document.querySelectorAll('.ce-drop-before, .ce-drop-after').forEach((n) => n.classList.remove('ce-drop-before', 'ce-drop-after'));

  // ------------------------------------------------------------------ notes
  const pinsLayer = document.createElement('div');
  pinsLayer.id = 'ce-pins';
  pinsLayer.className = 'ce-ui';

  function anchorFor(target, x, y) {
    for (let el = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const cands = [];
      if (el.dataset?.c1Id) cands.push(`[data-c1-id="${cssq(el.dataset.c1Id)}"]`);
      if (el.dataset?.mapId) cands.push(`${el.classList.contains('variant-item') ? '.variant-item' : el.classList.contains('class-member') ? '.class-member' : ''}[data-map-id="${cssq(el.dataset.mapId)}"]`);
      if (el.dataset?.catalogueTarget) cands.push(`${el.tagName.toLowerCase()}[data-catalogue-target="${cssq(el.dataset.catalogueTarget)}"]`);
      if (el.dataset?.ceKey) cands.push(`[data-ce-key="${cssq(el.dataset.ceKey)}"]`);
      if (el.id && !/^ce-/.test(el.id)) cands.push(`#${cssq(el.id)}`);
      for (const sel of cands) {
        try {
          if (document.querySelectorAll(sel).length === 1) {
            const r = el.getBoundingClientRect();
            return { selector: sel, dx: Math.round(x - r.left), dy: Math.round(y - r.top), label: text(el).slice(0, 80) };
          }
        } catch { /* a selector the browser rejects */ }
      }
    }
    return { selector: null, dx: 0, dy: 0, label: '' };
  }
  function notePosition(n) {
    if (n.anchor?.selector) {
      const el = document.querySelector(n.anchor.selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      const x = r.left + n.anchor.dx;
      const y = r.top + n.anchor.dy;
      // Hidden when its point is scrolled out of view inside a scrolling pane.
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(st.overflowY + st.overflowX)) {
          const pr = p.getBoundingClientRect();
          if (x < pr.left - 2 || x > pr.right + 2 || y < pr.top - 2 || y > pr.bottom + 2) return null;
        }
      }
      return { x, y };
    }
    return { x: n.abs.x - scrollX, y: n.abs.y - scrollY };
  }
  function updatePins() {
    const mine = S.notes.filter((n) => n.page === PAGE);
    const seen = new Set();
    mine.forEach((n, i) => {
      let pin = pinsLayer.querySelector(`[data-note="${cssq(n.id)}"]`);
      if (!pin) {
        pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'ce-pin';
        pin.dataset.note = n.id;
        pin.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openNote(n.id); });
        pinsLayer.appendChild(pin);
      }
      pin.textContent = String(i + 1);
      pin.title = n.text;
      seen.add(n.id);
      const pos = S.showPins ? notePosition(n) : null;
      if (!pos) { pin.style.display = 'none'; return; }
      pin.style.display = '';
      pin.style.left = `${pos.x}px`;
      pin.style.top = `${pos.y}px`;
    });
    pinsLayer.querySelectorAll('.ce-pin').forEach((p) => { if (!seen.has(p.dataset.note)) p.remove(); });
  }

  document.addEventListener('contextmenu', (e) => {
    if (e.shiftKey || (e.target.closest && e.target.closest('.ce-pop, .ce-bar, .ce-review'))) return;
    e.preventDefault();
    e.stopPropagation();
    const note = { id: `n${Date.now().toString(36)}`, page: PAGE, anchor: anchorFor(e.target, e.clientX, e.clientY),
      abs: { x: e.clientX + scrollX, y: e.clientY + scrollY }, text: '', createdAt: now(), updatedAt: now(), draft: true };
    S.notes.push(note);
    updatePins();
    openNote(note.id);
  }, true);

  function openNote(id) {
    closePopovers();
    const n = S.notes.find((x) => x.id === id);
    if (!n) return;
    const pos = notePosition(n) || { x: innerWidth / 2, y: innerHeight / 3 };
    const pop = document.createElement('div');
    pop.className = 'ce-ui ce-pop ce-note';
    pop.innerHTML = `<div class="ce-pop__title">Note ${S.notes.filter((x) => x.page === PAGE).indexOf(n) + 1}
        <span class="ce-pop__id">${esc(n.anchor?.label || n.anchor?.selector || 'page')}</span></div>
      <textarea rows="5" placeholder="Type your note">${esc(n.text)}</textarea>
      <div class="ce-pop__meta">${n.draft ? 'New note' : `Created ${new Date(n.createdAt).toLocaleString()}${n.updatedAt !== n.createdAt ? ` · edited ${new Date(n.updatedAt).toLocaleString()}` : ''}`}</div>
      <div class="ce-pop__btns"><button type="button" class="ce-save">Save</button><button type="button" class="ce-delete">Delete</button><button type="button" class="ce-close">Close</button></div>`;
    placePop(pop, { left: pos.x + 14, top: pos.y + 14, bottom: pos.y + 14 });
    const ta = pop.querySelector('textarea');
    ta.focus();
    const keep = () => {
      const t = ta.value.trim();
      if (!t) { discard(); return; }
      if (t !== n.text || n.draft) { n.text = t; n.updatedAt = now(); delete n.draft; save('notes'); }
      closePopovers();
      updatePins();
    };
    const discard = () => {
      if (!n.draft && !confirm('Delete this note?')) return;
      S.notes = S.notes.filter((x) => x !== n);
      save('notes');
      closePopovers();
      updatePins();
    };
    pop.querySelector('.ce-save').onclick = keep;
    pop.querySelector('.ce-delete').onclick = discard;
    pop.querySelector('.ce-close').onclick = () => {
      if (n.draft && !ta.value.trim()) { S.notes = S.notes.filter((x) => x !== n); updatePins(); }
      else if (n.draft || ta.value.trim() !== n.text) { keep(); return; }
      closePopovers();
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) keep(); if (e.key === 'Escape') pop.querySelector('.ce-close').click(); e.stopPropagation(); });
  }

  // ------------------------------------------------------------------ popovers, bar, review
  function placePop(pop, at) {
    document.body.appendChild(pop);
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = Math.min(Math.max(8, at.left), innerWidth - w - 8);
    let top = (at.bottom ?? at.top) + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, (at.top ?? top) - h - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
  function closePopovers() { document.querySelectorAll('.ce-pop, .ce-review').forEach((p) => p.remove()); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.ce-review')) closePopovers(); });

  const bar = document.createElement('div');
  bar.className = 'ce-ui ce-bar';
  bar.innerHTML = `<strong>Catalogue editor</strong>
    <button type="button" id="ce-toggle-edit" class="ce-btn"></button>
    <button type="button" id="ce-toggle-pins" class="ce-btn"></button>
    <button type="button" id="ce-review" class="ce-btn"></button>
    <span class="ce-status"></span>
    <span class="ce-help">Click any catalogue label to edit · drag ⠿ to move · ⚙ attributes · right-click to add a note (Shift+right-click: browser menu)</span>`;
  function status(msg, bad) {
    const s = bar.querySelector('.ce-status');
    s.textContent = msg;
    s.classList.toggle('ce-bad', Boolean(bad));
  }
  function changeCount() {
    const e = S.edits;
    return Object.keys(e.text).length + Object.keys(e.attrs).length + Object.keys(e.toc.indent).length
      + e.toc.removed.length + e.toc.added.length + (e.order.toc ? 1 : 0) + Object.keys(e.order).filter((k) => k.startsWith('entries|')).length;
  }
  function refreshCounts() {
    if (!S.edits) return;
    bar.querySelector('#ce-toggle-edit').textContent = S.editMode ? 'Editing: on' : 'Editing: off';
    bar.querySelector('#ce-toggle-pins').textContent = `${S.showPins ? 'Notes shown' : 'Notes hidden'} (${S.notes.filter((n) => !n.draft).length})`;
    bar.querySelector('#ce-review').textContent = `Review changes (${changeCount()})`;
  }

  function openReview() {
    closePopovers();
    const e = S.edits;
    const rows = [];
    for (const t of Object.values(e.text)) rows.push(`<tr><td>${esc(t.kind)}</td><td>${esc(t.original)}</td><td>${esc(t.value)}</td><td><button type="button" class="ce-btn" data-revert-text="${esc(t.key)}">Revert</button></td></tr>`);
    for (const a of Object.values(e.attrs)) rows.push(`<tr><td>${esc(a.kind)} attributes: ${esc(a.label)}</td><td></td><td>${esc(describeAttrs(a.fields))}</td><td><button type="button" class="ce-btn" data-revert-attr="${esc(a.key)}">Revert</button></td></tr>`);
    const rowLabel = (k) => {
      const tr = document.querySelector(`[data-ce-row="${cssq(k)}"]`);
      return text(tr?.querySelector('.catalogue-flat__toc-name, .catalogue-flat__toc-subheading')) || k.replace(/^[his]\|(flat-card-)?/, '');
    };
    for (const [k, v] of Object.entries(e.toc.indent)) rows.push(`<tr><td>contents row</td><td>${esc(rowLabel(k))}</td><td>${v ? 'indented under the subheading' : 'not indented'}</td><td></td></tr>`);
    for (const k of e.toc.removed) rows.push(`<tr><td>contents row</td><td>${esc(rowLabel(k))}</td><td>marked for removal</td><td></td></tr>`);
    for (const a of e.toc.added) rows.push(`<tr><td>contents subheading added</td><td></td><td>${esc((e.text[`toc-sub|${a.id}`] || {}).value || a.text)}</td><td></td></tr>`);
    if (e.order.toc) rows.push(`<tr><td>contents order</td><td colspan="2">rearranged (${e.order.toc.length} rows recorded)</td><td><button type="button" class="ce-btn" data-revert-order="toc">Revert</button></td></tr>`);
    for (const k of Object.keys(e.order).filter((x) => x.startsWith('entries|'))) rows.push(`<tr><td>entry order</td><td colspan="2">${esc(k.replace(/^entries\|/, ''))}</td><td><button type="button" class="ce-btn" data-revert-order="${esc(k)}">Revert</button></td></tr>`);
    const notes = S.notes.filter((n) => !n.draft);
    const pop = document.createElement('div');
    pop.className = 'ce-ui ce-review';
    pop.innerHTML = `<div class="ce-review__head"><strong>Proposed changes</strong><span>Saved to tools/catalogue-editor/state/ for Claude to review. Nothing changes on the site until you confirm.</span><button type="button" class="ce-btn ce-close">Close</button></div>
      <table><thead><tr><th>What</th><th>Was</th><th>Now</th><th></th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4">No changes yet.</td></tr>'}</tbody></table>
      <h4>Notes (${notes.length})</h4>
      <ol>${notes.map((n) => `<li><a href="${esc(n.page)}">${esc(n.page)}</a> · ${esc(n.anchor?.label || n.anchor?.selector || 'page')}: ${esc(n.text)}</li>`).join('')}</ol>`;
    document.body.appendChild(pop);
    pop.querySelector('.ce-close').onclick = closePopovers;
    pop.addEventListener('click', (ev) => {
      const b = ev.target;
      if (b.dataset.revertText) {
        const t = e.text[b.dataset.revertText];
        delete e.text[b.dataset.revertText];
        document.querySelectorAll(`[data-ce-key="${cssq(b.dataset.revertText)}"]`).forEach((el) => { el.textContent = t.original; el.classList.remove('ce-changed'); });
        log('revert', { key: b.dataset.revertText });
      } else if (b.dataset.revertAttr) {
        delete e.attrs[b.dataset.revertAttr];
        log('revert attributes', { key: b.dataset.revertAttr });
      } else if (b.dataset.revertOrder) {
        delete e.order[b.dataset.revertOrder];
        log('revert order', { key: b.dataset.revertOrder });
        status('Order reverted: reload the page to see the original order');
      } else return;
      save('edits');
      openReview();
    });
  }

  // ------------------------------------------------------------------ start
  let scheduled = null;
  function enhance() {
    scheduled = null;
    if (!S.edits) return;
    const cat = document.querySelector('#catalogueFlatView') || document.body;
    wrapTocCells(cat);
    decorateToc();
    bindFields(cat);
    decorateEntries(cat);
  }
  const observer = new MutationObserver((muts) => {
    if (S.applying) return;
    if (muts.every((m) => [...m.addedNodes].every((n) => n.nodeType !== 1 || (n.classList && (n.classList.contains('ce-ui') || n.closest?.('.ce-ui')))))) return;
    if (!scheduled) scheduled = setTimeout(enhance, 200);
  });

  async function start() {
    try {
      const r = await fetch(API, { cache: 'no-store' });
      const d = await r.json();
      S.edits = d.edits || blank();
      S.notes = Array.isArray(d.notes) ? d.notes : [];
    } catch {
      S.edits = blank();
      status('Editor server not reachable: changes will not be saved', true);
    }
    for (const k of Object.keys(blank())) if (S.edits[k] === undefined) S.edits[k] = blank()[k];
    document.documentElement.classList.toggle('ce-on', S.editMode);
    document.body.appendChild(bar);
    document.body.appendChild(pinsLayer);
    refreshCounts();
    if (!bar.querySelector('.ce-status').textContent) status('Ready');
    enhance();
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(updatePins, 150);
    addEventListener('scroll', updatePins, true);
    addEventListener('resize', updatePins);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
