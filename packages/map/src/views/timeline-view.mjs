/**
 * The timeline's markup, pure, so its parts render in isolation from sample data (a test, a gallery
 * specimen: packages/map/src/views/specimens.mjs): the ticks and year labels under the slider
 * (controls.js renderTimelineTicks) and the list of boundary changes between two editions
 * (changes.js renderTimelineChangesPanel). The methods write what these return into the page.
 */
import { escapeHtml } from '../../../core/src/html.js';
import { siteNumber } from '../../../core/src/format.js';
import { ZOOM_ICON_PATHS, strokeIconSvg } from './icons.mjs';

/** A stop on the timeline: an edition or an election; `minor` ones (by-elections) are drawn thinner. */
/** @typedef {{ minor?: boolean, date?: unknown, timestamp?: unknown, label?: unknown }} TimelineTickItem */

/**
 * One change in the list: its kind ('merged', 'divided', 'created', 'abolished', 'renamed', 'transfer', 'reorganised',
 * 'appeared', 'disappeared'), its sentence, the step it belongs to (`group`, an index into the
 * view's parts, when several steps are listed) and the key the zoom button names.
 * @typedef {{ type?: string, text: string, step?: string, group?: number, key: string }} TimelineChangeItem
 */
/** An entry of the "Changes since" menu: an earlier edition of the series. @typedef {{ mapId: string, label: string, preceding: boolean }} TimelineSinceOption */
/**
 * The changes of the edition selected on the timeline since an earlier edition (changes.js
 * buildTimelineChangeView): by default the one directly before it; the "Changes since" menu picks
 * another (Phelim Birch, 27 Nov 2026).
 * @typedef {object} TimelineChangeView
 * @property {string} [kind] 'first' for a series' first edition, which has nothing to compare with
 * @property {{ label: string, text: string }[]} parts one summary per step, oldest first
 * @property {TimelineChangeItem[]} changes
 * @property {number} skipped earlier steps too many to list
 * @property {string} fromLabel the edition compared with (the button's tooltip says "since" it)
 * @property {string} toLabel the edition selected
 * @property {string[]} [dateLabels] when the listed changes took effect, earliest first: the later
 *   edition's date (or year) of each step. The heading names only these (Phelim, 20 Nov 2026):
 *   most changes happened at that date, and the map descriptions explain the exceptions.
 * @property {string} [summary] the line over several steps ("Changes since 01 Apr 1985: 3 steps, ...")
 * @property {{ options: TimelineSinceOption[], selected: string }} [since] the "Changes since" menu
 * @property {string} [note] the catalogue's note on the pair
 */

/**
 * The ticks and year labels under the slider: a tick per stop (by-elections too, up to 600 stops),
 * the first and last years, and one year a decade (its first major stop's, else its first stop's),
 * each with a priority for fitTimelineYearLabels. Empty for fewer than two stops.
 * @param {TimelineTickItem[]} items
 * @param {(item: TimelineTickItem) => number} yearOf a stop's year, NaN when it has none
 * @returns {string}
 */
export function timelineTicksHtml(items, yearOf) {
  const count = items.length;
  if (count < 2) return '';
  const drawMinor = count <= 600;
  /** @type {string[]} */
  const parts = [];
  // decade -> the stop to label: its first major stop, else its first stop.
  /** @type {Map<number, { index: number, year: number, minor: boolean }>} */
  const byDecade = new Map();
  items.forEach((item, index) => {
    const p = (index / (count - 1)).toFixed(5);
    const minor = Boolean(item?.minor);
    if (!minor || drawMinor) {
      parts.push(`<span class="timeline-tick${minor ? '' : ' timeline-tick--major'}" style="--p:${p}"></span>`);
    }
    const year = yearOf(item);
    if (!Number.isFinite(year)) return;
    const decade = Math.floor(year / 10);
    const held = byDecade.get(decade);
    if (!held || (held.minor && !minor)) byDecade.set(decade, { index, year, minor });
  });
  const label = (/** @type {number} */ index, /** @type {number} */ year, /** @type {number} */ priority) => `<span class="timeline-year" data-priority="${priority}" style="--p:${(index / (count - 1)).toFixed(5)}">${year}</span>`;
  // There are two stops or more (above).
  const firstYear = yearOf(/** @type {TimelineTickItem} */ (items[0]));
  const lastYear = yearOf(/** @type {TimelineTickItem} */ (items[count - 1]));
  const labelled = new Set();
  if (Number.isFinite(firstYear)) { parts.push(label(0, firstYear, 3)); labelled.add(0); }
  if (Number.isFinite(lastYear)) { parts.push(label(count - 1, lastYear, 3)); labelled.add(count - 1); }
  for (const { index, year, minor } of byDecade.values()) {
    if (labelled.has(index)) continue;
    parts.push(label(index, year, minor ? 1 : 2));
  }
  return parts.join('');
}

/** @type {Record<string, string>} */
const TYPE_LABEL = { merged: 'Merged', divided: 'Divided', created: 'New', abolished: 'Abolished', renamed: 'Renamed', transfer: 'Transfer', reorganised: 'Transfer', appeared: 'Added', disappeared: 'Gone' };

/**
 * The changes panel's heading: "Changes, 01 Apr 1955", the date of the later edition, where the
 * changes took effect; "Changes, 01 Apr 1955 to 01 Nov 1957" for several steps at once; "First
 * edition" for a series' first. Without dates (an older caller) the edition selected.
 * @param {Pick<TimelineChangeView, 'dateLabels' | 'toLabel' | 'kind'>} view
 * @returns {string}
 */
export function timelineChangesTitle(view) {
  if (view.kind === 'first') return 'First edition';
  const dates = (view.dateLabels || []).filter(Boolean);
  if (dates.length > 1 && dates[0] !== dates[dates.length - 1]) return `Changes, ${dates[0]} to ${dates[dates.length - 1]}`;
  return `Changes, ${dates[0] || view.toLabel}`;
}

/** The text of the first edition's panel. */
export const TIMELINE_FIRST_EDITION_TEXT = 'The first edition of this series: there is nothing earlier to compare it with.';

/**
 * The "Changes since" menu: the series' earlier editions, newest first, the preceding one marked.
 * A native select, so it is labelled, reached by Tab and worked by the keyboard everywhere.
 * @param {TimelineChangeView['since']} since
 * @returns {string}
 */
export function timelineSinceMenuHtml(since) {
  if (!since?.options.length) return '';
  const esc = (/** @type {unknown} */ value) => escapeHtml(String(value ?? ''));
  const options = since.options.map((option) => `<option value="${esc(option.mapId)}"${option.mapId === since.selected ? ' selected' : ''}>${esc(option.preceding ? `${option.label} (previous edition)` : option.label)}</option>`).join('');
  return `<label class="timeline-changes-panel__since">
          <span class="timeline-changes-panel__since-label">Changes since</span>
          <select id="timelineChangesSince" class="timeline-changes-panel__since-select" title="List every change since an earlier edition">${options}</select>
        </label>`;
}

/**
 * The changes panel's content: the heading with the "Changes since" menu and the close button; then
 * for one step its summary, the swatch key and the list of changes with a zoom button each; for
 * several, the line over them, the steps left out, the key and each step under its date, oldest
 * first; and the catalogue's note.
 * @param {TimelineChangeView} view
 * @returns {string}
 */
export function timelineChangesPanelHtml(view) {
  const esc = (/** @type {unknown} */ value) => escapeHtml(String(value ?? ''));
  const menu = timelineSinceMenuHtml(view.since);
  const header = `
      <header class="timeline-changes-panel__header${menu ? ' timeline-changes-panel__header--menu' : ''}">
        <h2 class="timeline-changes-panel__title">${esc(timelineChangesTitle(view))}</h2>
        <div class="timeline-changes-panel__controls">
          ${menu}
          <button type="button" class="timeline-changes-panel__close" aria-label="Close the list of changes">&times;</button>
        </div>
      </header>`;
  if (view.kind === 'first') return `${header}<p class="timeline-changes-panel__summary">${esc(TIMELINE_FIRST_EDITION_TEXT)}</p>`;
  const multi = view.parts.length > 1;
  /** @param {TimelineChangeItem[]} changes */
  const listHtml = (changes) => (changes.length
    ? `<ol class="timeline-changes-panel__list">${changes.map((change) => {
      // A change is named for what happened at its date.
      const type = change.type;
      return `<li class="timeline-changes-panel__item">
          <span class="timeline-changes-panel__type timeline-changes-panel__type--${esc(type)}">${esc(TYPE_LABEL[type || ''] || 'Change')}</span>
          <span class="timeline-changes-panel__text">${esc(change.text)}${!multi && change.step ? ` <span class="timeline-changes-panel__step">(${esc(change.step)})</span>` : ''}</span>
          <button type="button" class="timeline-changes-panel__zoom" data-change-key="${esc(change.key)}" aria-label="Zoom to: ${esc(change.text)}" title="Zoom to this change">
            ${strokeIconSvg(ZOOM_ICON_PATHS, 'timeline-changes-panel__zoom-icon')}
          </button>
        </li>`;
    }).join('')}</ol>`
    : '');
  const more = view.skipped > 0
    ? `<p class="timeline-changes-panel__summary timeline-changes-panel__skipped">${esc(view.skipped === 1 ? '1 earlier step is not listed: choose a later edition to see it.' : `${siteNumber(view.skipped)} earlier steps are not listed: choose a later edition to see them.`)}</p>`
    : '';
  // A rename is outlined, not filled: its land did not change hands. Its swatch shows when one is listed.
  const renamed = view.changes.some((change) => change.type === 'renamed')
    ? ` <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--renamed"></span>renamed`
    : '';
  const key = view.changes.length
    ? `<p class="timeline-changes-panel__key" aria-hidden="true"><span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--area"></span>changed area <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--new"></span>new line <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--gone"></span>line gone${renamed}</p>`
    : '';
  const note = view.note ? `<p class="timeline-changes-panel__note"><strong>Catalogue note:</strong> ${esc(view.note)}</p>` : '';
  if (!multi) {
    const summaries = view.parts.map((part) => `<p class="timeline-changes-panel__summary">${esc(part.text)}</p>`).join('');
    return `${header}${summaries}${more}${key}${listHtml(view.changes)}${note}`;
  }
  // Several steps: each under the date it took effect, oldest first, with its own summary.
  const groups = view.parts.map((part, g) => `<section class="timeline-changes-panel__group" aria-label="${esc(part.label)}">
        <h3 class="timeline-changes-panel__group-title">${esc(part.label)}</h3>
        <p class="timeline-changes-panel__summary">${esc(part.text)}</p>
        ${listHtml(view.changes.filter((change) => change.group === g))}
      </section>`).join('');
  const summary = view.summary ? `<p class="timeline-changes-panel__overall">${esc(view.summary)}</p>` : '';
  return `${header}${summary}${more}${key}${groups}${note}`;
}
