/**
 * Timeline Play: stepping through the editions or elections of the slider, pausing, stopping and the
 * transition between steps.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import dataService from '../../data-service.js';

// Play: the pause before each step, and how long a step is held -- long enough to see what
// changed, short when there is nothing to see.
const TIMELINE_ANIMATION_DELAYS = Object.freeze({
  start: 500,
  hold: 2200,
  holdQuiet: 600
});

export class TimelineAnimationMethods {
  getTimelineAnimationItems() {
    const sequenceItems = this.timelineAnimation?.sequenceItems;
    return Array.isArray(sequenceItems) && sequenceItems.length ? sequenceItems : this.timelineItems;
  }

  isTimelineRunCurrent(runId) {
    return this.timelineAnimation.runId === runId && this.timelineAnimation.playing;
  }

  getTimelineItemMapIds() {
    return new Set(this.getTimelineAnimationItems().map((item) => item?.mapId).filter(Boolean));
  }

  isTimelineAnimationLayer(mapId) {
    if (!mapId) return false;
    const animation = this.timelineAnimation || {};
    return Boolean(
      animation.playing || animation.paused || animation.originalLayerId
    ) && (animation.originalLayerId === mapId || this.getTimelineItemMapIds().has(mapId));
  }

  getVisibleTimelineLayerIds() {
    const ids = this.getTimelineItemMapIds();
    return this.getLoadedLayerIds()
      .filter((id) => ids.has(id))
      .filter((id) => this.isMapVisible(id));
  }

  canAnimateTimeline() {
    if (this.elections?.activeEntry) return false;
    if (!this.timelineItems.length || this.timelineItems.length < 2 || !this.timelineOnSelect) return false;
    const mapIds = this.getTimelineItemMapIds();
    if (mapIds.size < 2) return false;
    if (this.timelineAnimation.playing || this.timelineAnimation.paused || this.timelineAnimation.originalLayerId) return true;
    return this.getVisibleTimelineLayerIds().length === 1;
  }

  updateTimelineAnimationButtons() {
    const play = document.getElementById('timelinePlay');
    const stop = document.getElementById('timelineStop');
    if (!play || !stop) return;
    // The playback buttons animate boundary layers through time. An election has nothing to
    // animate, so canAnimateTimeline() always refuses while one is open; rather than sit
    // there greyed out, the pair is hidden until the election is closed.
    play.parentElement?.classList.toggle('timeline-playback-group--hidden', Boolean(this.elections?.activeEntry));
    const canAnimate = this.canAnimateTimeline();
    const { playing, paused, atEnd, originalLayerId } = this.timelineAnimation;
    play.disabled = !canAnimate;
    stop.disabled = !(playing || paused || originalLayerId);
    play.classList.toggle('is-playing', playing);
    play.classList.toggle('is-paused', paused);
    play.classList.toggle('is-replay', atEnd && !playing);
    if (playing) {
      play.title = 'Pause territorial animation';
      play.setAttribute('aria-label', 'Pause territorial animation');
      play.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"></path></svg>';
    } else if (atEnd) {
      play.title = 'Replay territorial animation';
      play.setAttribute('aria-label', 'Replay territorial animation');
      play.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h8V3z" fill="currentColor"></path></svg>';
    } else {
      play.title = 'Play territorial animation';
      play.setAttribute('aria-label', 'Play territorial animation');
      play.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" fill="currentColor"></path></svg>';
    }
    stop.title = 'Stop territorial animation';
    stop.setAttribute('aria-label', 'Stop territorial animation');
  }

  clearTimelineAnimationTimer() {
    if (this.timelineAnimation.timer) {
      window.clearTimeout(this.timelineAnimation.timer);
      this.timelineAnimation.timer = 0;
    }
    if (this.timelineAnimation.delayResolve) {
      const resolve = this.timelineAnimation.delayResolve;
      this.timelineAnimation.delayResolve = null;
      resolve();
    }
  }

  scheduleTimelineAnimation(delay, callback) {
    this.clearTimelineAnimationTimer();
    this.timelineAnimation.timer = window.setTimeout(() => {
      this.timelineAnimation.timer = 0;
      callback();
    }, Math.max(0, Number(delay) || 0));
  }

  waitTimelineDelay(delay) {
    this.clearTimelineAnimationTimer();
    return new Promise((resolve) => {
      this.timelineAnimation.delayResolve = resolve;
      this.timelineAnimation.timer = window.setTimeout(() => {
        this.timelineAnimation.timer = 0;
        this.timelineAnimation.delayResolve = null;
        resolve();
      }, Math.max(0, Number(delay) || 0));
    });
  }

  pauseTimelineAnimation(options = {}) {
    const wasActive = this.timelineAnimation.playing || this.timelineAnimation.paused;
    if (wasActive) this.timelineAnimation.runId += 1;
    this.clearTimelineAnimationTimer();
    if (wasActive) {
      this.timelineAnimation.to('paused');
      this.timelineAnimation.currentIndex = this.getTimelineRangeIndex();
    }
    if (wasActive && options.preserveOverlay !== true) this.setTimelineChangeView(null);
    this.updateTimelineAnimationButtons();
  }

  async stopTimelineAnimation(options = {}) {
    const { restoreOriginal = true } = options;
    const originalLayerId = this.timelineAnimation.originalLayerId;
    const wasActive = this.timelineAnimation.playing || this.timelineAnimation.paused || originalLayerId;
    this.timelineAnimation.runId += 1;
    this.clearTimelineAnimationTimer();
    this.timelineAnimation.to('idle');
    if (wasActive) this.setTimelineChangeView(null);
    if (!wasActive) {
      this.updateTimelineAnimationButtons();
      return;
    }
    if (restoreOriginal && originalLayerId && dataService.getMapById(originalLayerId)) {
      const timelineMapIds = this.getTimelineItemMapIds();
      this.beginTimelineApply();
      try {
        for (const loadedId of this.getLoadedLayerIds()) {
          if (loadedId !== originalLayerId && timelineMapIds.has(loadedId)) {
            await this.unloadMap(loadedId, { preserveTimelineAnimation: true });
          }
        }
        if (!this.isMapLoaded(originalLayerId)) await this.loadMap(originalLayerId, { fit: false });
        this.mapController.showLayer?.(originalLayerId);
        const originalTimestamp = dataService.parseMapDate?.(dataService.getMapById(originalLayerId)?.date);
        const timelineItems = this.getTimelineAnimationItems();
        const originalIndex = timelineItems.findIndex((item) => item.mapId === originalLayerId || item.timestamp === originalTimestamp);
        if (originalIndex >= 0) this.setTimelineRangeIndex(originalIndex);
        this.syncCatalogueMapState();
        this.updateActiveLayers();
        this.updateURLState();
      } finally {
        if (this.endTimelineApply()) this.updateTimeline();
      }
    }
    this.timelineAnimation.originalLayerId = null;
    this.timelineAnimation.sequenceItems = [];
    this.timelineAnimation.currentIndex = this.getTimelineRangeIndex();
    this.updateTimelineAnimationButtons();
  }

  async startTimelineAnimation() {
    if (!this.canAnimateTimeline()) {
      this.updateTimelineAnimationButtons();
      return;
    }
    const sequenceItems = this.timelineAnimation.paused && Array.isArray(this.timelineAnimation.sequenceItems) && this.timelineAnimation.sequenceItems.length
      ? this.timelineAnimation.sequenceItems
      : this.timelineItems.slice();
    this.timelineAnimation.sequenceItems = sequenceItems;
    const visibleTimelineLayers = this.getVisibleTimelineLayerIds();
    if (!this.timelineAnimation.originalLayerId || this.timelineAnimation.atEnd) {
      this.timelineAnimation.originalLayerId = visibleTimelineLayers[0] || sequenceItems[this.getTimelineRangeIndex()]?.mapId || null;
    }
    let startIndex = this.timelineAnimation.paused ? this.timelineAnimation.currentIndex : 0;
    if (this.timelineAnimation.atEnd) startIndex = 0;
    startIndex = this.clampTimelineIndex(startIndex, sequenceItems);
    const runId = this.timelineAnimation.runId + 1;
    this.timelineAnimation.runId = runId;
    this.timelineAnimation.to('playing');
    this.timelineAnimation.currentIndex = startIndex;
    this.setTimelineRangeIndex(startIndex);
    this.updateTimelineAnimationButtons();
    const startItem = sequenceItems[startIndex];
    if (this.getShownTimelineIndex(sequenceItems) !== startIndex) this.setTimelineChangeView(null);
    if (startItem?.timestamp !== undefined) await this.applyTimelineTimestamp(startItem.timestamp, { fit: false });
    if (!this.isTimelineRunCurrent(runId)) return;
    if (startIndex >= sequenceItems.length - 1) {
      this.timelineAnimation.to('ended');
      this.updateTimelineAnimationButtons();
      return;
    }
    this.scheduleTimelineAnimation(TIMELINE_ANIMATION_DELAYS.start, () => {
      this.advanceTimelineAnimation(runId).catch((error) => this.showMapError(error));
    });
  }

  async advanceTimelineAnimation(runId = this.timelineAnimation.runId) {
    if (!this.isTimelineRunCurrent(runId)) return;
    const timelineItems = this.getTimelineAnimationItems();
    const fromIndex = this.clampTimelineIndex(this.timelineAnimation.currentIndex, timelineItems);
    const toIndex = fromIndex + 1;
    if (toIndex >= timelineItems.length) {
      this.timelineAnimation.to('ended');
      this.updateTimelineAnimationButtons();
      return;
    }
    await this.applyTimelineAnimationTransition(fromIndex, toIndex, runId, timelineItems);
    if (!this.isTimelineRunCurrent(runId)) return;
    this.timelineAnimation.currentIndex = toIndex;
    if (toIndex >= timelineItems.length - 1) {
      this.timelineAnimation.to('ended');
      this.updateTimelineAnimationButtons();
      return;
    }
    this.scheduleTimelineAnimation(TIMELINE_ANIMATION_DELAYS.start, () => {
      this.advanceTimelineAnimation(runId).catch((error) => this.showMapError(error));
    });
  }

  /**
   * One Play step: swap to the next edition, highlight what changed, and hold it long enough to
   * see. It used to load both editions, lay a precomputed overlay over them for 1.5 s and fade
   * it; the overlay existed for 14 series only, and for Counties covered the whole island.
   */
  async applyTimelineAnimationTransition(fromIndex, toIndex, runId = this.timelineAnimation.runId, items = this.getTimelineAnimationItems()) {
    const timelineItems = Array.isArray(items) && items.length ? items : this.getTimelineAnimationItems();
    const safeTo = this.clampTimelineIndex(toIndex, timelineItems);
    const toItem = timelineItems[safeTo];
    const shownIndex = this.getShownTimelineIndex(timelineItems);
    const from = shownIndex >= 0 ? shownIndex : this.clampTimelineIndex(fromIndex, timelineItems);
    if (toItem?.timestamp !== undefined) await this.applyTimelineTimestamp(toItem.timestamp, { fit: false });
    if (!this.isTimelineRunCurrent(runId)) return;
    this.setTimelineRangeIndex(safeTo);
    this.timelineAnimation.currentIndex = safeTo;
    const view = from !== safeTo ? await this.showTimelineStepChanges(from, safeTo, timelineItems).catch(() => null) : null;
    if (!this.isTimelineRunCurrent(runId)) return;
    const visible = Boolean(view?.changes?.length) && this.getTimelineHighlightEnabled();
    await this.waitTimelineDelay(visible ? TIMELINE_ANIMATION_DELAYS.hold : TIMELINE_ANIMATION_DELAYS.holdQuiet);
  }

  async ensureTimelineLayerLoaded(mapId) {
    if (!this.isTimelineMapPlayable(mapId)) return false;
    if (!this.isMapLoaded(mapId)) await this.loadMap(mapId, { fit: false });
    this.mapController.showLayer?.(mapId);
    return true;
  }
}
