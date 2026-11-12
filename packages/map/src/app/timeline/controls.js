/**
 * The timeline slider: its items and ticks, the label, the generals-only filter, applying a step, and the
 * date parsing and formatting of its labels.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import dataService from '../../data-service.js';
import { compositeChildIds } from '../../map-relations.mjs';
import { formatDisplayDate } from '../../../../core/src/date-format.mjs';
import { parseTimelineDate, yearOnlyMapDate } from './dates.mjs';
import { timelineTicksHtml } from './timeline-view.mjs';
import { setHidden } from '../../state-helpers.mjs';

export class TimelineControlMethods {
  isPlaceholderTimelineMap(mapConfig) {
    if (!mapConfig) return true;
    const keywords = [
      ...(Array.isArray(mapConfig.keywords) ? mapConfig.keywords : []),
      ...(Array.isArray(mapConfig.rawMetadata?.keywords) ? mapConfig.rawMetadata.keywords : [])
    ].map((keyword) => String(keyword).trim().toLowerCase());
    const status = String(mapConfig.status || mapConfig.rawMetadata?.status || '').toLowerCase();
    return Boolean(
      mapConfig.placeholder
      || mapConfig.rawMetadata?.placeholder
      || mapConfig.thumbnail?.kind === 'placeholder'
      || keywords.includes('placeholder')
      || keywords.includes('to-be-added')
      || keywords.includes('to be added')
      || status.includes('to be added')
    );
  }

  isTimelineMapPlayable(mapId) {
    if (!mapId) return false;
    const mapConfig = dataService.getMapById(mapId);
    if (!mapConfig || this.isPlaceholderTimelineMap(mapConfig)) return false;
    const directLayer = this.mapController.resolveLayer(mapConfig.id || mapId);
    if (directLayer?.loadable) return true;
    if (mapConfig.isGroup && compositeChildIds(mapConfig).length) {
      return compositeChildIds(mapConfig).some((memberId) => this.isTimelineMapPlayable(memberId));
    }
    if (mapConfig.isGroup && Array.isArray(mapConfig.variants) && mapConfig.variants.length) {
      return mapConfig.variants.some((variant) => this.mapController.resolveLayer(variant?.id)?.loadable);
    }
    return this.getConvertedCompositeChildIds(mapConfig).length > 0;
  }

  setupTimelineControls() {
    this.ensureTimelineChrome();
    const range = document.getElementById('timelineRange');
    const prev = document.getElementById('timelinePrev');
    const next = document.getElementById('timelineNext');
    const reset = document.getElementById('timelineReset');
    const play = document.getElementById('timelinePlay');
    const stop = document.getElementById('timelineStop');
    // Tech-debt item 17: the timeline rebuild race.
    //
    // Three previous attempts are recorded in the Playwright spec covering the
    // timeline and share URLs. They all tried to make the
    // REBUILD smarter -- to work out whether an item-list change meant "moved to
    // a different chain" or "transient mid-swap view of the same chain". That
    // distinction turned out not to be reliably available at rebuild time.
    //
    // This attempt does what that test's own note suggested instead: carry the
    // request identity, so a stale completion is dropped before it can touch
    // anything. Two things go wrong without it, and this handles both:
    //
    //   1. an earlier, slower request resolves LAST and writes its index over the
    //      newest one -- the map shows one year while the slider reads another;
    //   2. a rebuild running during the await moves currentIndex mid-flight, so
    //      even the winning request's own state is no longer what it set.
    //
    // (1) is the token check. (2) is why the index is re-asserted after the
    // await rather than only before it.
    let timelineRequestToken = 0;
    let timelineChain = Promise.resolve();
    const applyIndex = async (index, options = {}) => {
      const timelineItems = this.getTimelineAnimationItems();
      if (!timelineItems.length || !this.timelineOnSelect) return;
      if (options.manual !== false) this.pauseTimelineAnimation({ preserveOverlay: true });
      const safeIndex = this.clampTimelineIndex(index, timelineItems);
      const token = ++timelineRequestToken;
      // ATTEMPT 5, and the first one arrived at by measurement rather than reasoning.
      //
      // Instrumenting every write to the slider (see setTimelineRangeIndex) showed six
      // of nine writes in the failing race coming from one place:
      //
      //   setTimelineRangeIndex <- setTimelineItems <- updateTimeline
      //     <- updateActiveLayers <- onChange
      //
      // updateTimeline re-derives the active index from getCurrentTimelineTimestamp(),
      // which is the MAX DATE OF THE CURRENTLY LOADED LAYERS. Mid-swap that is the old
      // layer, or none, so the index resolves to 0 and the slider is reset -- once per
      // layer change, and each racing request causes one. No amount of guarding
      // applyIndex could have stopped that, which is why three attempts at it failed.
      //
      // updateTimeline ALREADY refuses to run when this.timelineApplying is set. That
      // guard was simply never armed: applyIndex tracked its own token and left the
      // flag alone. Arming it is the whole fix.
      //
      // The flag is cleared only by the NEWEST request, so overlapping requests do not
      // clear it out from under each other -- the same reason the token exists.
      // Optimistic: the slider follows the finger immediately, before any loading.
      this.setTimelineRangeIndex(safeIndex);
      this.timelineAnimation.currentIndex = safeIndex;

      // SERIALISED. timelineOnSelect unloads one layer and loads another; running three
      // of those concurrently interleaves their unload/load pairs, and the set left
      // loaded at the end is whichever pair happened to finish last -- not the one the
      // user asked for. The trace showed exactly that: internal index 5, map on layer 0.
      //
      // Queuing also makes "latest wins" exact rather than probabilistic. A request that
      // is superseded while still waiting its turn does no work at all: it never loads a
      // layer, so it cannot leave one behind. Dragging a slider across ten steps now
      // performs one swap instead of ten.
      const run = timelineChain.then(async () => {
        if (token !== timelineRequestToken) return;   // superseded while queued
        // The edition on the map before this step: the changes are drawn from it to the new one.
        const shownIndex = this.getShownTimelineIndex(timelineItems);
        this.beginTimelineApply();
        try {
          await this.timelineOnSelect(timelineItems[safeIndex], safeIndex);
        } finally {
          this.endTimelineApply();
        }
        // Superseded while we were loading: say nothing, touch nothing.
        if (token !== timelineRequestToken) return;
        this.setTimelineRangeIndex(safeIndex);
        this.timelineAnimation.currentIndex = safeIndex;
        this.updateTimelineAnimationButtons();
        if (shownIndex >= 0 && shownIndex !== safeIndex) {
          await this.showTimelineStepChanges(shownIndex, safeIndex, timelineItems).catch(() => null);
        }
      });
      // The chain must not break on a rejection, or every later request is dropped.
      timelineChain = run.catch(() => {});
      return run;
    };

    // Test surface for the time slider. applyIndex is the real code path the
    // change handler uses, and it returns the promise that settles once the
    // layer swap has completed — which is exactly what a race test needs and
    // what dispatching a synthetic 'change' event cannot give you, because the
    // listener's promise is unobservable from outside.
    if (window.__civgraphTest2) {
      window.__civgraphTest2.timeline = {
        element: range,
        getItems: () => this.getTimelineAnimationItems(),
        getIndex: () => this.getTimelineRangeIndex(),
        setIndex: (index) => applyIndex(index),
        isApplying: () => this.timelineApplying,
        currentIndex: () => this.timelineAnimation.currentIndex,
        // What the change highlight shows: the list (view) and what is drawn on the map.
        getChanges: () => {
          const view = this.timelineChangeView;
          return {
            view: view ? { kind: view.kind, count: view.count, reversed: view.reversed, drawn: view.drawn, fromMapId: view.fromMapId, toMapId: view.toMapId, changes: view.changes.map((c) => ({ key: c.key, type: c.type, text: c.text })) } : null,
            map: this.mapController?.getTimelineChangesState?.() || null,
            highlight: this.getTimelineHighlightEnabled()
          };
        },
      };
    }

    range?.addEventListener('change', (event) => applyIndex(event.target.value).catch((error) => this.showMapError(error)));
    range?.addEventListener('input', (event) => {
      this.pauseTimelineAnimation({ preserveOverlay: true });
      const timelineItems = this.getTimelineAnimationItems();
      const safeIndex = this.clampTimelineIndex(event.target.value, timelineItems);
      this.timelineAnimation.currentIndex = safeIndex;
      this.updateTimelineLabel(safeIndex);
      this.updateTimelineAnimationButtons();
    });
    prev?.addEventListener('click', () => applyIndex(this.getTimelineRangeIndex() - 1).catch((error) => this.showMapError(error)));
    next?.addEventListener('click', () => applyIndex(this.getTimelineRangeIndex() + 1).catch((error) => this.showMapError(error)));
    reset?.addEventListener('click', () => {
      const latest = Math.max(0, this.getTimelineAnimationItems().length - 1);
      applyIndex(latest).catch((error) => this.showMapError(error));
    });
    play?.addEventListener('click', () => {
      if (this.timelineAnimation.playing) {
        this.pauseTimelineAnimation({ preserveOverlay: true });
        return;
      }
      this.startTimelineAnimation().catch((error) => this.showMapError(error));
    });
    stop?.addEventListener('click', () => {
      this.stopTimelineAnimation({ restoreOriginal: true }).catch((error) => this.showMapError(error));
    });
  }

  /**
   * `timelineApplying` suppresses updateTimeline() while a layer swap is mid-flight,
   * because updateTimeline re-derives the slider index from the max date of the
   * CURRENTLY LOADED layers -- which, mid-swap, is the old layer or none.
   *
   * IT HAD TO BECOME A COUNTER. As a plain boolean it was shared by four overlapping
   * call sites, and whichever finished FIRST cleared it for all of them and then called
   * updateTimeline() itself. During a rapid slider drag that is guaranteed: the earliest
   * request is the one most likely to finish first, and it reopened the gate for a
   * rebuild that reset the slider to 0 while later requests were still loading.
   *
   * Found by instrumenting every write to the slider rather than reasoning about it --
   * four earlier attempts guessed and all four missed this, because the flag LOOKED
   * armed at each site in isolation.
   *
   * endTimelineApply() returns true only for the last one out, so the rebuild it guards
   * runs once, at the end, from settled state.
   */
  beginTimelineApply() {
    this.timelineApply.hold();
    this.timelineApplying = true;
  }

  endTimelineApply() {
    this.timelineApplying = !this.timelineApply.release();
    return !this.timelineApplying;
  }

  /**
   * The slider's added parts, built around the page's own markup so every page that carries
   * #timelineSlider gets them: the range goes into a track with a mark per stop under it, the
   * date label gains a second line naming the stop, and a "general elections only" filter
   * appears for election timelines. The native range input itself is unchanged.
   */
  ensureTimelineChrome() {
    const slider = document.getElementById('timelineSlider');
    const range = document.getElementById('timelineRange');
    const label = document.getElementById('timelineLabel');
    if (!slider || !range || !label || slider.dataset.chrome === 'ready') return;
    slider.dataset.chrome = 'ready';

    const track = document.createElement('div');
    track.className = 'timeline-track';
    range.replaceWith(track);
    track.appendChild(range);
    const ticks = document.createElement('div');
    ticks.className = 'timeline-ticks';
    ticks.id = 'timelineTicks';
    ticks.setAttribute('aria-hidden', 'true');
    track.appendChild(ticks);

    const info = document.createElement('div');
    info.className = 'timeline-info';
    label.replaceWith(info);
    info.appendChild(label);
    const sublabel = document.createElement('span');
    sublabel.className = 'timeline-sublabel';
    sublabel.id = 'timelineSublabel';
    info.appendChild(sublabel);

    const generals = document.createElement('button');
    generals.type = 'button';
    generals.id = 'timelineGenerals';
    generals.className = 'timeline-chip';
    setHidden(generals, true);
    generals.innerHTML = 'Generals<span class="timeline-chip__more"> only</span>';
    generals.title = 'Step through general elections only, skipping by-elections';
    generals.setAttribute('aria-pressed', 'false');
    generals.addEventListener('click', () => {
      this.setTimelineGeneralsOnly(generals.getAttribute('aria-pressed') !== 'true');
      this.elections?.updateElectionTimeline?.();
    });
    const reset = document.getElementById('timelineReset');
    if (reset?.parentElement === slider) slider.insertBefore(generals, reset);
    else slider.appendChild(generals);

    // Beside the date: "Highlight changes" on/off, and the list of what changed at this step.
    const changes = document.createElement('div');
    changes.className = 'timeline-changes';
    changes.id = 'timelineChangesGroup';
    setHidden(changes, true);
    changes.innerHTML = `
      <button type="button" id="timelineHighlight" class="timeline-switch" role="switch" aria-checked="${this.getTimelineHighlightEnabled() ? 'true' : 'false'}" aria-label="Highlight changes" title="Highlight boundary changes when the date changes">
        <span class="timeline-switch__track" aria-hidden="true"><span class="timeline-switch__thumb"></span></span>
        <span class="timeline-switch__label" aria-hidden="true">Highlight</span>
      </button>
      <button type="button" id="timelineChanges" class="timeline-chip timeline-changes__button" aria-expanded="false" aria-controls="timelineChangesPanel" hidden></button>`;
    info.insertAdjacentElement('afterend', changes);
    changes.querySelector('#timelineHighlight').addEventListener('click', () => {
      this.setTimelineHighlightEnabled(!this.getTimelineHighlightEnabled());
    });
    changes.querySelector('#timelineChanges').addEventListener('click', () => this.toggleTimelineChangesPanel());

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.fitTimelineYearLabels()).observe(track);
    }
  }

  /** The reader's choice, else `fallback` (the slider's own default) when they have made none. */
  getTimelineGeneralsOnly(fallback = false) {
    try {
      const stored = localStorage.getItem('civgraph:timelineGeneralsOnly');
      return stored === null ? Boolean(fallback) : stored === '1';
    } catch { return Boolean(fallback); }
  }

  setTimelineGeneralsOnly(value) {
    try { localStorage.setItem('civgraph:timelineGeneralsOnly', value ? '1' : '0'); } catch { /* private mode */ }
  }

  /** A mark per stop, tall for a major one (a general election, a boundary edition) and short
   * for a by-election. Positions follow the range's own index steps, not time, so a mark is
   * exactly where the thumb stops.
   *
   * Each label names the year of the stop it stands at. It used to name the decade ("1950") at
   * the decade's first stop, so on an index-spaced axis "1950" marked the 1955 edition and
   * "1970" the 1977 one (UX review 2026-10-30). Candidates are the first stop of each decade
   * (a general election or edition in preference to a by-election) and the two ends;
   * fitTimelineYearLabels keeps as many as fit, the most important first. */
  renderTimelineTicks() {
    const ticks = document.getElementById('timelineTicks');
    if (!ticks) return;
    const items = this.getTimelineAnimationItems();
    if (items.length < 2) {
      ticks.innerHTML = '';
      return;
    }
    ticks.innerHTML = timelineTicksHtml(items, (item) => this.timelineItemYear(item));
    this.fitTimelineYearLabels();
    requestAnimationFrame(() => this.fitTimelineYearLabels());
  }

  timelineItemYear(item) {
    const date = this.parseTimelineDate(item?.date ?? item?.timestamp ?? item?.label);
    return date ? date.getUTCFullYear() : NaN;
  }

  /** Year labels that would collide are hidden: the ends first, then general elections and
   * editions, then the rest, each kept only where it has room. On the Westminster axis, whose
   * by-elections crowd the later decades, that thins the right end instead of packing it. */
  fitTimelineYearLabels() {
    const ticks = document.getElementById('timelineTicks');
    if (!ticks) return;
    const labels = [...ticks.querySelectorAll('.timeline-year')];
    const width = ticks.clientWidth;
    const placed = [];
    const ordered = labels
      .map((label) => {
        label.dataset.hidden = 'false';
        const left = label.offsetLeft - label.offsetWidth / 2;
        return { label, left, right: left + label.offsetWidth, priority: Number(label.dataset.priority || 1) };
      })
      .sort((a, b) => b.priority - a.priority || a.left - b.left);
    const gap = 10;
    for (const item of ordered) {
      const clash = placed.some((other) => item.left < other.right + gap && item.right > other.left - gap);
      if (clash || item.left < -12 || item.right > width + 12) {
        item.label.dataset.hidden = 'true';
        continue;
      }
      placed.push(item);
    }
  }

  setTimelineItems(items, activeIndex, onSelect, options = {}) {
    const slider = document.getElementById('timelineSlider');
    const range = document.getElementById('timelineRange');
    const playableItems = Array.isArray(items)
      ? items.filter((item) => !item?.mapId || this.isTimelineMapPlayable(item.mapId))
      : [];
    // The slider must span the full playable time series. Do NOT restrict it to the
    // longest contiguous run of precomputed transition overlays — that truncated the
    // range (e.g. the LGD chain stopped at 1 Apr 1969, where the admin-areas overlays
    // end, even with the 2012 map loaded). Play-mode morphing still works:
    // applyTimelineAnimationTransition looks up an overlay per adjacent pair and falls
    // back to a plain switch when none exists.
    this.timelineItems = playableItems;
    this.timelineOnSelect = typeof onSelect === 'function' ? onSelect : null;
    if (!slider || !range || this.timelineItems.length < 2 || !this.timelineOnSelect) {
      this.hideTimeline();
      return;
    }
    const requestedItem = Array.isArray(items) ? items[Number(activeIndex)] : null;

    /**
     * Identity must not be satisfied by two undefined values.
     *
     * The previous predicate was `item.mapId === requested.mapId || item.timestamp ===
     * requested.timestamp`. Election timeline items carry `{ label, body, date }` and have
     * NEITHER field, so both comparisons read `undefined === undefined`, matched the FIRST
     * item, and the slider silently snapped to index 0.
     *
     * Measured 2026-08-23: loading the 2024-07-04 UK general election gave
     * activeEntry.date "2024-07-04", a 60-item timeline starting 1922-11-15, and a slider
     * reading "15 Nov 1922" at index 0. updateElectionTimeline computed the right index
     * and handed it over; it was discarded here.
     *
     * Each clause now requires the field to be present on the requested item before it
     * can match, and elections match on body+date, which is their actual identity.
     */
    const sameTimelineItem = (item, requested) => {
      if (!item || !requested) return false;
      if (requested.mapId != null) return item.mapId === requested.mapId;
      if (requested.timestamp != null) return item.timestamp === requested.timestamp;
      if (requested.date != null) return item.date === requested.date && item.body === requested.body;
      return false;
    };
    const requestedIndex = this.timelineItems.findIndex((item) => sameTimelineItem(item, requestedItem));
    const safeIndex = this.clampTimelineIndex(requestedIndex >= 0 ? requestedIndex : activeIndex);
    range.min = '0';
    range.max = String(this.timelineItems.length - 1);
    this.setTimelineRangeIndex(safeIndex);
    slider.classList.remove('hidden');
    this.updateTimelineLabel(safeIndex);
    this.updateTimelineAnimationButtons();
    this.renderTimelineTicks();
    const generals = document.getElementById('timelineGenerals');
    if (generals) {
      const filter = options?.generalsFilter;
      setHidden(generals, !filter?.available);
      generals.setAttribute('aria-pressed', filter?.active ? 'true' : 'false');
    }
    // An election's timeline has no boundary changes to show; a boundary series has.
    this.renderTimelineChangesControl();
    this.notifyTimelineLayoutChanged();
  }

  clampTimelineIndex(index, items = this.timelineItems) {
    const sequence = Array.isArray(items) ? items : [];
    if (!sequence.length) return 0;
    return Math.max(0, Math.min(sequence.length - 1, Number(index) || 0));
  }

  getTimelineRangeIndex() {
    return this.clampTimelineIndex(document.getElementById('timelineRange')?.value || 0);
  }

  setTimelineRangeIndex(index) {
    const safeIndex = this.clampTimelineIndex(index);
    const range = document.getElementById('timelineRange');
    if (range) range.value = String(safeIndex);
    this.updateTimelineLabel(safeIndex);
    // T17 attempt 5: every write to the slider records where it came from. Four
    // attempts guessed at the cause; this makes the reset name itself. Test-surface
    // only, so it costs nothing in production.
    if (window.__civgraphTest2) {
      const trace = window.__civgraphTest2.timelineWrites || (window.__civgraphTest2.timelineWrites = []);
      if (trace.length > 200) trace.shift();   // a long play run must not grow without bound
      trace.push({
        index: safeIndex,
        from: String(new Error().stack || '').split(String.fromCharCode(10)).slice(1, 6).join(' | ')
      });
    }
    return safeIndex;
  }

  updateTimelineLabel(index) {
    const timelineItems = this.getTimelineAnimationItems();
    const item = timelineItems[this.clampTimelineIndex(index, timelineItems)];
    const label = document.getElementById('timelineLabel');
    const text = this.formatTimelineItemLabel(item);
    if (label) label.textContent = text;
    const sublabel = document.getElementById('timelineSublabel');
    if (sublabel) sublabel.textContent = item?.sublabel || '';
    document.getElementById('timelineRange')?.setAttribute('aria-valuetext', [text, item?.sublabel].filter(Boolean).join(', '));
  }

  hideTimeline() {
    this.clearTimelineAnimationTimer();
    this.timelineItems = [];
    this.timelineOnSelect = null;
    this.timelineAnimation.runId += 1;
    this.timelineAnimation.to('idle');
    this.timelineAnimation.singleLayerReferenceId = null;
    this.timelineAnimation.sequenceItems = [];
    this.setTimelineChangeView(null);
    this.closeTimelineChangesPanel();
    document.getElementById('timelineSlider')?.classList.add('hidden');
    this.updateTimelineAnimationButtons();
    this.notifyTimelineLayoutChanged();
  }

  notifyTimelineLayoutChanged() {
    requestAnimationFrame(() => this.mapController?.invalidateSize?.());
  }

  updateTimeline() {
    if (this.timelineApplying) return;
    if (this.timelineAnimation?.playing) return;
    if (this.elections?.activeEntry) {
      this.elections.updateElectionTimeline();
      return;
    }
    const activeIds = this.getLoadedLayerIds()
      .filter((id) => dataService.getMapById(id))
      .filter((id) => this.isMapVisible(id));
    const chains = [];
    const chainIds = new Set();
    for (const id of activeIds) {
      const chain = dataService.getChainForMap?.(id);
      if (!chain || chainIds.has(chain.id)) continue;
      chainIds.add(chain.id);
      chains.push(chain);
    }
    if (!chains.length) {
      this.hideTimeline();
      return;
    }
    const timestamps = (dataService.getApplicableDates?.(chains, activeIds) || [])
      .filter((timestamp) => Number.isFinite(Number(timestamp)))
      .sort((a, b) => a - b);
    if (timestamps.length < 2) {
      this.hideTimeline();
      return;
    }
    const referenceMapId = activeIds.length === 1 ? activeIds[0] : this.timelineAnimation.singleLayerReferenceId;
    this.timelineAnimation.singleLayerReferenceId = activeIds.length === 1 ? activeIds[0] : this.timelineAnimation.singleLayerReferenceId;
    const currentTimestamp = this.getCurrentTimelineTimestamp(activeIds);
    const items = timestamps.map((timestamp) => {
      const mapId = referenceMapId ? this.getTimelineMapIdForTimestamp(referenceMapId, timestamp) : null;
      const yearOnly = mapId ? this.yearOnlyMapDate(dataService.getMapById(mapId)) : null;
      return {
        timestamp,
        label: yearOnly || this.formatTimelineTimestamp(timestamp),
        // A map dated only by its year reads "2023", not "01 Jan 2023" (UX review L4).
        displayLabel: yearOnly || '',
        mapId,
        // An edition named only by its year ("2017") would repeat the date above it.
        sublabel: [mapId && dataService.getMapById(mapId)?.name].filter((name) => name && !/^\d{4}$/.test(String(name).trim()))[0] || ''
      };
    }).filter((item) => this.isTimelineMapPlayable(item.mapId));
    const activeIndex = items.findIndex((item) => item.timestamp === currentTimestamp);
    this.setTimelineItems(items, activeIndex >= 0 ? activeIndex : items.length - 1, async (item, index) => {
      this.timelineAnimation.currentIndex = this.clampTimelineIndex(index);
      // Stepping through time keeps the reader's zoom and position; only opening a map fits it.
      await this.applyTimelineTimestamp(item.timestamp, { fit: false });
    });
    this.syncTimelineChangesToShownEdition();
  }

  getTimelineMapIdForTimestamp(referenceMapId, timestamp) {
    if (!referenceMapId || !Number.isFinite(Number(timestamp))) return null;
    const equivalents = dataService.getEquivalentMapsForDate?.([referenceMapId], timestamp) || {};
    const direct = equivalents[referenceMapId];
    if (direct && this.isTimelineMapPlayable(direct)) return direct;
    const referenceMap = dataService.getMapById(referenceMapId);
    const referenceTimestamp = dataService.parseMapDate?.(referenceMap?.date);
    if (referenceTimestamp === timestamp && this.isTimelineMapPlayable(referenceMapId)) return referenceMapId;
    return null;
  }

  getCurrentTimelineTimestamp(activeIds) {
    const activeTimestamps = activeIds
      .map((id) => dataService.parseMapDate?.(dataService.getMapById(id)?.date))
      .filter((timestamp) => Number.isFinite(Number(timestamp)));
    return activeTimestamps.length ? Math.max(...activeTimestamps) : null;
  }

  formatTimelineTimestamp(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return '';
    return this.formatTimelineDate(date);
  }

  /**
   * A map's year when its date is known only to the year: a bare year (2023), or 1 January of
   * it with nothing saying the day is meant (the 1977 DEDs are "1977-01-01"). A map named
   * "1 Jan 1919", or in force from that day, keeps its day. Null otherwise.
   */
  yearOnlyMapDate(map) {
    return yearOnlyMapDate(map);
  }

  formatTimelineItemLabel(item) {
    if (!item) return '';
    if (item.displayLabel) return item.displayLabel;
    const candidates = [item.timestamp, item.date, item.label];
    for (const candidate of candidates) {
      const date = this.parseTimelineDate(candidate);
      if (date) return this.formatTimelineDate(date);
    }
    return item.label || '';
  }

  parseTimelineDate(value) {
    return parseTimelineDate(value);
  }

  formatTimelineDate(date) {
    return formatDisplayDate(date);
  }

  async applyTimelineTimestamp(timestamp, options = {}) {
    const activeIds = this.getLoadedLayerIds()
      .filter((id) => dataService.getMapById(id))
      .filter((id) => this.isMapVisible(id));
    const equivalents = dataService.getEquivalentMapsForDate?.(activeIds, timestamp) || {};
    this.beginTimelineApply();
    try {
      for (const [oldId, newId] of Object.entries(equivalents)) {
        if (!newId || newId === oldId || !this.isTimelineMapPlayable(newId)) continue;
        await this.unloadMap(oldId, { preserveTimelineAnimation: true });
        await this.loadMap(newId, { fit: options.fit !== false });
      }
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    } finally {
      // Only the last operation out rebuilds, and only then is the state it reads
      // settled. Clearing unconditionally here is what reset the slider mid-race.
      if (this.endTimelineApply()) this.updateTimeline();
    }
  }
}
