/**
 * Which boundary changes the timeline's changes panel lists (Phelim Birch, 27 Nov 2026). Pure: no
 * DOM, no app state; changes.js (TimelineChangeMethods) calls these with the slider's stops.
 *
 * The panel always describes the edition selected on the timeline against an edition before it in
 * the same series: by default the one directly before it, whichever way the slider moved and however
 * the map was opened; the "Changes since" menu picks an earlier one. Only consecutive pairs are
 * precomputed (data/timeline-changes/, scripts/build/timeline-changes.py), so changes since an
 * earlier edition are the consecutive steps in between, listed oldest first.
 *
 * Before, the panel compared the edition shown before a step with the one shown after it: going
 * back listed the step just undone (often "No changes" while the selected edition had changes of
 * its own), and comparing two editions meant clicking one and then the other.
 */
import { siteNumber } from '../../../../core/src/format.js';
import { formatHectares } from './dates.mjs';

/** A stop on the timeline, as far as these functions read it. @typedef {{ mapId?: string | null | undefined }} SinceItem */

/** One consecutive pair between two stops. @typedef {{ id: string, fromIndex: number, toIndex: number, fromMapId: string, toMapId: string }} SinceStep */

/** An entry of the "Changes since" menu: an earlier edition, `preceding` for the one directly before. @typedef {{ mapId: string, index: number, label: string, preceding: boolean }} SinceOption */

/**
 * What the change files say, all steps together (derived, not state): 'first' when there is no
 * earlier edition to compare with; 'unavailable' when a step was not compared (no geometry held, or
 * no entry in the index) and the rest have no changes.
 * @typedef {'changes' | 'none' | 'redrawn' | 'unavailable' | 'first'} TimelineChangeKind
 */

/** @param {SinceItem | null | undefined} item */
const mapIdOf = (item) => (item && typeof item.mapId === 'string' && item.mapId ? item.mapId : '');

/**
 * The stop of the edition directly before the selected one: the nearest earlier stop with a map
 * other than the selected stop's. -1 for the series' first edition (or no map at the stop).
 * @param {ReadonlyArray<SinceItem>} items
 * @param {number} selectedIndex
 * @returns {number}
 */
export function precedingEditionIndex(items, selectedIndex) {
  const selected = mapIdOf(items[selectedIndex]);
  if (!selected || !Number.isInteger(selectedIndex)) return -1;
  for (let i = selectedIndex - 1; i >= 0; i -= 1) {
    const mapId = mapIdOf(items[i]);
    if (mapId && mapId !== selected) return i;
  }
  return -1;
}

/**
 * The "Changes since" menu for the selected stop: every earlier edition of the series, newest first,
 * each map once (its latest stop), labelled by `labelOf`. The first entry is the preceding edition.
 * Empty for the first edition.
 * @param {ReadonlyArray<SinceItem>} items
 * @param {number} selectedIndex
 * @param {(item: SinceItem, index: number) => string} labelOf
 * @returns {SinceOption[]}
 */
export function timelineSinceOptions(items, selectedIndex, labelOf) {
  const selected = mapIdOf(items[selectedIndex]);
  /** @type {SinceOption[]} */
  const options = [];
  if (!selected || !Number.isInteger(selectedIndex)) return options;
  const seen = new Set([selected]);
  for (let i = selectedIndex - 1; i >= 0; i -= 1) {
    const item = items[i];
    const mapId = mapIdOf(item);
    if (!item || !mapId || seen.has(mapId)) continue;
    seen.add(mapId);
    options.push({ mapId, index: i, label: labelOf(item, i), preceding: options.length === 0 });
  }
  return options;
}

/**
 * The stop to compare the selected one with: `sinceMapId`'s, when it is an earlier edition of the
 * series, else the preceding edition's. -1 for the first edition.
 * @param {ReadonlyArray<SinceItem>} items
 * @param {number} selectedIndex
 * @param {string | null | undefined} [sinceMapId]
 * @returns {number}
 */
export function resolveTimelineSinceIndex(items, selectedIndex, sinceMapId) {
  const preceding = precedingEditionIndex(items, selectedIndex);
  if (!sinceMapId || preceding < 0) return preceding;
  for (let i = preceding; i >= 0; i -= 1) {
    if (mapIdOf(items[i]) === sinceMapId) return i;
  }
  return preceding;
}

/**
 * The consecutive pairs from stop `fromIndex` to stop `toIndex`, oldest first; a stop without a
 * map, or with the same map as the stop before it, is passed over (its neighbours pair instead).
 * @param {ReadonlyArray<SinceItem>} items
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {SinceStep[]}
 */
export function timelineSinceSteps(items, fromIndex, toIndex) {
  /** @type {SinceStep[]} */
  const steps = [];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || fromIndex >= toIndex) return steps;
  let previous = fromIndex;
  for (let i = fromIndex + 1; i <= toIndex; i += 1) {
    const fromMapId = mapIdOf(items[previous]);
    const toMapId = mapIdOf(items[i]);
    if (!toMapId || toMapId === fromMapId) continue;
    if (fromMapId) steps.push({ id: `${fromMapId}__${toMapId}`, fromIndex: previous, toIndex: i, fromMapId, toMapId });
    previous = i;
  }
  return steps;
}

/**
 * The steps to list when there are many: the newest, nearest the selected edition, up to `maxFiles`
 * steps that need a change file fetched (a step with no changes costs nothing and is always kept
 * while a later one is). `skipped` counts the earlier steps left out.
 * @template {object} T
 * @param {T[]} steps oldest first
 * @param {number} maxFiles
 * @param {(step: T) => boolean} needsFile
 * @returns {{ listed: T[], skipped: number }}
 */
export function limitTimelineSinceSteps(steps, maxFiles, needsFile) {
  let files = 0;
  let start = steps.length;
  while (start > 0) {
    const step = /** @type {T} */ (steps[start - 1]);
    if (needsFile(step)) {
      if (files >= maxFiles) break;
      files += 1;
    }
    start -= 1;
  }
  return { listed: steps.slice(start), skipped: start };
}

/**
 * The kind of the whole comparison from its steps' kinds (index entries' `kind`, 'unknown' for a
 * step with no entry).
 * @param {ReadonlyArray<string>} kinds
 * @returns {TimelineChangeKind}
 */
export function timelineChangeKind(kinds) {
  if (!kinds.length) return 'first';
  if (kinds.includes('changes')) return 'changes';
  if (kinds.includes('redrawn')) return 'redrawn';
  if (kinds.every((kind) => kind === 'none')) return 'none';
  return 'unavailable';
}

/**
 * The hectares that changed hands in a list of changes: every change but a rename (its land did
 * not change hands), as the builder's "N ha in all" counts them (timeline-changes.py build_output).
 * @param {ReadonlyArray<{ type?: unknown, ha?: unknown }>} changes
 */
export function movedHectares(changes) {
  return changes.reduce((sum, change) => sum + (change.type === 'renamed' ? 0 : Number(change.ha) || 0), 0);
}

/**
 * The line over a list of several steps: "Changes since 01 Apr 1985: 3 steps, 12 changes, 289 ha in
 * all." Each wording is keyed in data/i18n/strings/patterns.txt.
 * @param {{ sinceLabel: string, steps: number, count: number, hectares: number }} summary
 * @returns {string}
 */
export function timelineSinceSummary({ sinceLabel, steps, count, hectares }) {
  const lead = `Changes since ${sinceLabel}: ${siteNumber(steps)} step${steps === 1 ? '' : 's'}`;
  if (!count) return `${lead}, no boundary changes.`;
  const changes = count === 1 ? '1 change' : `${siteNumber(count)} changes`;
  return hectares > 0 ? `${lead}, ${changes}, ${formatHectares(hectares)} in all.` : `${lead}, ${changes}.`;
}

