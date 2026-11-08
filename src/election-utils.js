/**
 * Pure utility functions shared between election-controller and ui-controller.
 * Extracted to break the static import dependency from ui-controller → election-controller,
 * enabling future code-splitting of the election controller.
 */

/**
 * @template {string | null | undefined} D
 * @param {D} dateStr
 * @returns {D | string}
 */
export function formatElectionDate(dateStr) {
    try {
        // Some bodies (e.g. ROI Referendum) use composite dates of the form
        // "2024-03-08-care" so multiple referendums on the same day get distinct
        // entries in the master index. Strip anything after the leading ISO prefix.
        const iso = String(dateStr || '').match(/^(\d{4}-\d{2}-\d{2})/);
        if (!iso) return dateStr;
        const d = new Date(iso[1] + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

/** @param {string} name */
export function shortBodyName(name) {
    /** @type {Record<string, string>} */
    const map = {
        'European Parliament': 'European',
        'European Parliament (Ireland)': 'European (Republic of Ireland)',
        'House of Commons of the United Kingdom': 'Westminster',
        'Northern Ireland Assembly': 'Assembly',
        'Northern Ireland Constitutional Convention': 'Convention',
        'Northern Ireland Forum for Political Dialogue': 'Forum',
        'Dáil Éireann': 'Dáil',
        'President of Ireland': 'President',
        'Referendum (Ireland)': 'Referendum'
    };
    return map[name] || name;
}

/** @param {unknown} str */
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

/**
 * @param {unknown} body
 * @param {unknown} date
 * @param {unknown} constituency
 * @param {unknown} label
 * @param {string} [extraClass]
 * @param {string} [level]
 */
export function renderElectionConstituencyFeatureLink(body, date, constituency, label, extraClass = '', level = 'dea') {
    const safeLabel = escapeHtml(label || '');
    const safeName = String(constituency || '').trim();
    // '-' is the renderers' empty placeholder; an em dash can still arrive from data.
    if (!safeName || safeName === '-' || safeName === '—') {
        return `<span class="election-cell-wrap ${extraClass}">${safeLabel || '-'}</span>`;
    }
    const classAttr = ['election-entity-link', extraClass].filter(Boolean).join(' ');
    return `<button type="button"
        class="${classAttr}"
        data-election-constituency-feature="1"
        data-election-constituency-level="${escapeHtml(level || 'dea')}"
        data-election-constituency-body="${escapeHtml(body || '')}"
        data-election-constituency-date="${escapeHtml(date || '')}"
        data-election-constituency-name="${escapeHtml(safeName)}">${safeLabel}</button>`;
}
