/**
 * The timeline's markup, pure, so its parts render in isolation from sample data (a test, a gallery
 * specimen: packages/map/src/views/specimens.mjs): the ticks and year labels under the slider
 * (controls.js renderTimelineTicks) and the list of boundary changes between two editions
 * (changes.js renderTimelineChangesPanel). The methods write what these return into the page.
 */
import { escapeHtml } from '../../../core/src/html.js';
import { ZOOM_ICON_PATHS, strokeIconSvg } from './icons.mjs';

/** A stop on the timeline: an edition or an election; `minor` ones (by-elections) are drawn thinner. */
/** @typedef {{ minor?: boolean, date?: unknown, timestamp?: unknown, label?: unknown }} TimelineTickItem */

/**
 * One change in the list: its kind ('merged', 'divided', 'created', 'abolished', 'renamed', 'transfer', 'reorganised',
 * 'appeared', 'disappeared'), its sentence, the step it belongs to when several were taken at once,
 * and the key the zoom button names.
 * @typedef {{ type?: string, text: string, step?: string, key: string }} TimelineChangeItem
 */
/**
 * The changes between two shown editions (changes.js buildTimelineChangeView).
 * @typedef {object} TimelineChangeView
 * @property {{ label: string, text: string }[]} parts one summary per step taken
 * @property {TimelineChangeItem[]} changes
 * @property {boolean} reversed going back in time (the changes still read as they happened)
 * @property {number} skipped steps too many to list
 * @property {string} fromLabel the edition shown before (the button's tooltip says "since" it)
 * @property {string} toLabel the edition shown now
 * @property {string[]} [dateLabels] when the listed changes took effect, earliest first: the later
 *   edition's date (or year) of each step. The heading names only these (Phelim, 20 Nov 2026):
 *   most changes happened at that date, and the map descriptions explain the exceptions.
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
 * changes took effect; "Changes, 01 Apr 1955 to 01 Nov 1957" for several steps at once. Without
 * dates (an older caller) the later of the two editions shown.
 * @param {Pick<TimelineChangeView, 'dateLabels' | 'fromLabel' | 'toLabel' | 'reversed'>} view
 * @returns {string}
 */
export function timelineChangesTitle(view) {
  const dates = (view.dateLabels || []).filter(Boolean);
  if (dates.length > 1 && dates[0] !== dates[dates.length - 1]) return `Changes, ${dates[0]} to ${dates[dates.length - 1]}`;
  return `Changes, ${dates[0] || (view.reversed ? view.fromLabel : view.toLabel)}`;
}

/**
 * The changes panel's content: the heading and close button, a summary per step, the steps
 * skipped, the swatch key, the list of changes with a zoom button each, and the catalogue's note.
 * @param {TimelineChangeView} view
 * @returns {string}
 */
export function timelineChangesPanelHtml(view) {
  const esc = (/** @type {unknown} */ value) => escapeHtml(String(value ?? ''));
  const summaries = view.parts.map((part) => `<p class="timeline-changes-panel__summary">${view.parts.length > 1 ? `<strong>${esc(part.label)}:</strong> ` : ''}${esc(part.text)}</p>`).join('');
  const list = view.changes.length
    ? `<ol class="timeline-changes-panel__list">${view.changes.map((change) => {
      // A change is named for what happened at its date, whichever way the slider moved.
      const type = change.type;
      return `<li class="timeline-changes-panel__item">
          <span class="timeline-changes-panel__type timeline-changes-panel__type--${esc(type)}">${esc(TYPE_LABEL[type || ''] || 'Change')}</span>
          <span class="timeline-changes-panel__text">${esc(change.text)}${change.step ? ` <span class="timeline-changes-panel__step">(${esc(change.step)})</span>` : ''}</span>
          <button type="button" class="timeline-changes-panel__zoom" data-change-key="${esc(change.key)}" aria-label="Zoom to: ${esc(change.text)}" title="Zoom to this change">
            ${strokeIconSvg(ZOOM_ICON_PATHS, 'timeline-changes-panel__zoom-icon')}
          </button>
        </li>`;
    }).join('')}</ol>`
    : '';
  const more = view.skipped > 0 ? `<p class="timeline-changes-panel__summary">and ${view.skipped} more step${view.skipped === 1 ? '' : 's'}: step one edition at a time to see them.</p>` : '';
  // A rename is outlined, not filled: its land did not change hands. Its swatch shows when one is listed.
  const renamed = view.changes.some((change) => change.type === 'renamed')
    ? ` <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--renamed"></span>renamed`
    : '';
  const key = view.changes.length
    ? `<p class="timeline-changes-panel__key" aria-hidden="true"><span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--area"></span>changed area <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--new"></span>new line <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--gone"></span>line gone${renamed}</p>`
    : '';
  const note = view.note ? `<p class="timeline-changes-panel__note"><strong>Catalogue note:</strong> ${esc(view.note)}</p>` : '';
  return `
      <header class="timeline-changes-panel__header">
        <h2 class="timeline-changes-panel__title">${esc(timelineChangesTitle(view))}</h2>
        <button type="button" class="timeline-changes-panel__close" aria-label="Close the list of changes">&times;</button>
      </header>
      ${summaries}${more}${key}${list}${note}`;
}
