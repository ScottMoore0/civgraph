/**
 * NI Boundaries - Time Slider Controller
 * Handles unified timeline navigation across time-series layers
 */

import dataService from './data-service.js';

class TimeSliderController {
    constructor() {
        // DOM elements
        this.container = null;
        this.slider = null;
        this.label = null;
        this.prevBtn = null;
        this.nextBtn = null;
        this.resetBtn = null;

        // State
        this.dates = [];              // Array of timestamps (sorted oldest first)
        this.currentIndex = 0;        // Current position in dates array
        this.preSliderState = null;   // Saved layer state before slider interaction
        this.activeChains = [];       // Currently active time-series chains
        this.mapController = null;    // Reference to map controller
        this.uiController = null;     // Reference to UI controller
        this._applyingDateChange = false; // Guard against re-entrant updates
        this._previewIndex = null;    // Temporary preview index while dragging in election mode
        this._preservedTimelineChains = null; // Preserve chain context when selected date has no loadable map
        this._preservedTimelineTimestamp = null; // Selected timestamp for placeholder-only timeline state
        this._dateChangeRequestToken = 0; // Latest-request-wins guard for non-election swaps
        this._lastDateChangeMetrics = null;
        this._lastStaleDateChangeMetrics = null;
        this._dateChangeHistory = [];
        this._queuedDateChangeRequest = null;
        this._dateChangeRunnerPromise = null;

        // Callbacks
        this.onLayersChanged = null;  // Callback when layers change
    }

    /**
     * Initialize the time slider
     */
    init(mapController, uiController) {
        this.mapController = mapController;
        this.uiController = uiController;

        // Get DOM elements
        this.container = document.getElementById('timelineSlider');
        this.slider = document.getElementById('timelineRange');
        this.label = document.getElementById('timelineLabel');
        this.prevBtn = document.getElementById('timelinePrev');
        this.nextBtn = document.getElementById('timelineNext');
        this.resetBtn = document.getElementById('timelineReset');

        if (!this.container) {
            console.warn('[TimeSlider] Timeline slider elements not found');
            return;
        }

        // Bind event listeners
        this.slider.addEventListener('input', () => this.handleSliderInput());
        this.slider.addEventListener('change', () => this.handleSliderCommit());
        this.prevBtn.addEventListener('click', () => this.stepBackward());
        this.nextBtn.addEventListener('click', () => this.stepForward());
        this.resetBtn.addEventListener('click', () => this.reset());

        console.log('[TimeSlider] Initialized');
    }

    /**
     * Update the slider based on currently active layers
     * Called when layers are loaded/unloaded
     */
    updateForActiveLayers(activeMapIds) {
        // Skip updates while we are in the middle of swapping layers
        if (this._applyingDateChange) return;
        // Skip updates when in election mode (election controller manages the slider)
        if (this._electionMode) return;

        // Remember current timestamp before rebuilding dates
        const previousTimestamp = this.dates.length > 0
            ? this.dates[this.currentIndex]
            : null;

        // Find which time-series chains are represented
        this.activeChains = [];
        const seenChainIds = new Set();

        for (const mapId of activeMapIds) {
            const chain = dataService.getChainForMap(mapId);
            if (chain && !seenChainIds.has(chain.id)) {
                seenChainIds.add(chain.id);
                this.activeChains.push(chain);
            }
        }

        if (this.activeChains.length === 0 && this._preservedTimelineChains?.length) {
            this.activeChains = [...this._preservedTimelineChains];
        }

        // If no time-series layers, hide the slider
        if (this.activeChains.length === 0) {
            this._preservedTimelineChains = null;
            this._preservedTimelineTimestamp = null;
            this.hide();
            return;
        }

        // Get applicable dates across all active chains (sorted newest first from dataService)
        const datesNewestFirst = dataService.getApplicableDates(this.activeChains);

        if (datesNewestFirst.length === 0) {
            this.hide();
            return;
        }

        // Reverse to get oldest first (index 0 = oldest = left, max = newest = right)
        this.dates = datesNewestFirst.reverse();

        // Show the slider
        this.show();

        // Use timestamps for proportional positioning
        // Slider min = oldest timestamp, max = newest timestamp
        const oldestTimestamp = this.dates[0];
        const newestTimestamp = this.dates[this.dates.length - 1];

        this.slider.min = oldestTimestamp;
        this.slider.max = newestTimestamp;

        // Preserve current position if slider was already active, otherwise
        // anchor to the date of the map(s) currently on screen so the slider
        // reflects what's loaded rather than always snapping to "newest".
        const preferredTimestamp = this._preservedTimelineTimestamp ?? previousTimestamp;
        if (preferredTimestamp !== null && (this.preSliderState !== null || this._preservedTimelineChains?.length)) {
            this.currentIndex = this.findClosestDateIndex(preferredTimestamp);
        } else {
            const loadedTimestamp = this._getLoadedTimestampInChains(activeMapIds);
            if (loadedTimestamp !== null) {
                this.currentIndex = this.findClosestDateIndex(loadedTimestamp);
            } else {
                this.currentIndex = this.dates.length - 1;
            }
            this.preSliderState = null;
        }
        this.slider.value = this.dates[this.currentIndex];

        // Update label
        this.updateLabel();
        this.updateButtonStates();
    }

    /**
     * Show the slider
     */
    show() {
        if (this.container) {
            this.container.classList.remove('hidden');
        }
    }

    /**
     * Hide the slider
     */
    hide() {
        if (this.container) {
            this.container.classList.add('hidden');
        }
        this.activeChains = [];
        this.dates = [];
    }

    /**
     * Handle slider value change - find closest date and snap to it
     */
    handleSliderInput() {
        // Election mode: preview only while dragging
        if (this._electionMode) {
            const newIndex = this._clampElectionIndex(parseInt(this.slider.value, 10));
            this._previewIndex = newIndex;
            this.updateLabel();
            this.updateButtonStates();
            return;
        }

        const sliderTimestamp = parseInt(this.slider.value);

        // Find the closest date to the slider value
        const newIndex = this.findClosestDateIndex(sliderTimestamp);
        if (newIndex === this.currentIndex && !Number.isInteger(this._previewIndex)) return;

        this._previewIndex = newIndex;
        this.updateLabel();
        this.updateButtonStates();
    }

    handleSliderCommit() {
        if (!this._electionMode) {
            const sliderTimestamp = parseInt(this.slider.value);
            const targetIndex = Number.isInteger(this._previewIndex)
                ? this._previewIndex
                : this.findClosestDateIndex(sliderTimestamp);
            this._previewIndex = null;

            if (targetIndex === this.currentIndex) {
                this.slider.value = this.dates[this.currentIndex];
                this.updateLabel();
                this.updateButtonStates();
                return;
            }

            if (this.preSliderState === null) {
                this.savePreSliderState();
            }

            this.currentIndex = targetIndex;
            this.slider.value = this.dates[this.currentIndex];
            this.updateLabel();
            this.updateButtonStates();
            this.applyDateChange();
            return;
        }

        const targetIndex = Number.isInteger(this._previewIndex)
            ? this._previewIndex
            : this._clampElectionIndex(parseInt(this.slider.value, 10));
        this._previewIndex = null;

        if (targetIndex === this.currentIndex) {
            this.slider.value = String(this.currentIndex);
            this.updateLabel();
            this.updateButtonStates();
            return;
        }

        this.currentIndex = targetIndex;
        this.slider.value = String(this.currentIndex);
        this.updateLabel();
        this.updateButtonStates();
        if (this._electionCallback) {
            this._electionCallback(this._electionDatesSorted[this.currentIndex]);
        }
    }

    /**
     * Find the index of the closest date to a given timestamp
     */
    findClosestDateIndex(timestamp) {
        let closestIndex = 0;
        let closestDiff = Math.abs(this.dates[0] - timestamp);

        for (let i = 1; i < this.dates.length; i++) {
            const diff = Math.abs(this.dates[i] - timestamp);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestIndex = i;
            }
        }

        return closestIndex;
    }

    _clampElectionIndex(index) {
        if (!Number.isFinite(index)) return this.currentIndex;
        return Math.max(0, Math.min(this.dates.length - 1, index));
    }

    /**
     * Step backward in time (older date) - LEFT button
     * Decreases index (moves left on slider)
     */
    stepBackward() {
        if (this.currentIndex <= 0) return;

        // Election mode: step and callback
        if (this._electionMode) {
            this._previewIndex = null;
            this.currentIndex--;
            this.slider.value = String(this.currentIndex);
            this.updateLabel();
            this.updateButtonStates();
            if (this._electionCallback) {
                this._electionCallback(this._electionDatesSorted[this.currentIndex]);
            }
            return;
        }

        // Save pre-slider state on first interaction
        if (this.preSliderState === null) {
            this.savePreSliderState();
        }

        this.currentIndex--;
        this.slider.value = this.dates[this.currentIndex];
        this.updateLabel();
        this.updateButtonStates();
        this.applyDateChange();
    }

    /**
     * Step forward in time (newer date) - RIGHT button
     * Increases index (moves right on slider)
     */
    stepForward() {
        if (this.currentIndex >= this.dates.length - 1) return;

        // Election mode: step and callback
        if (this._electionMode) {
            this._previewIndex = null;
            this.currentIndex++;
            this.slider.value = String(this.currentIndex);
            this.updateLabel();
            this.updateButtonStates();
            if (this._electionCallback) {
                this._electionCallback(this._electionDatesSorted[this.currentIndex]);
            }
            return;
        }

        // Save pre-slider state on first interaction
        if (this.preSliderState === null) {
            this.savePreSliderState();
        }

        this.currentIndex++;
        this.slider.value = this.dates[this.currentIndex];
        this.updateLabel();
        this.updateButtonStates();
        this.applyDateChange();
    }

    /**
     * Reset to original layers
     */
    reset() {
        if (!this.preSliderState) return;
        this._previewIndex = null;

        // Restore original layers
        this.restorePreSliderState();

        // Reset slider to most recent (rightmost)
        this.currentIndex = this.dates.length - 1;
        this.slider.value = this.dates[this.currentIndex];
        this.updateLabel();
        this.updateButtonStates();

        // Clear pre-slider state
        this.preSliderState = null;

        // Show toast
        this.showToast('Timeline reset to original layers');
    }

    /**
     * Update the date label
     */
    updateLabel() {
        if (!this.label || this.dates.length === 0) return;

        // Election mode: show the election date string
        if (this._electionMode && this._electionDatesSorted) {
            const labelIndex = Number.isInteger(this._previewIndex) ? this._previewIndex : this.currentIndex;
            const dateStr = this._electionDatesSorted[labelIndex];
            if (dateStr) {
                const d = new Date(dateStr);
                this.label.textContent = d.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                });
                return;
            }
        }

        const labelIndex = Number.isInteger(this._previewIndex) ? this._previewIndex : this.currentIndex;
        const timestamp = this.dates[labelIndex];
        const date = new Date(timestamp);

        // Format as year, or full date if available
        const year = date.getFullYear();
        const month = date.getMonth();
        const day = date.getDate();

        // If it's Jan 1, just show the year
        if (month === 0 && day === 1) {
            this.label.textContent = year.toString();
        } else {
            // Show short date format
            this.label.textContent = date.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }
    }

    /**
     * Update prev/next button disabled states
     * Left button (prev/older) disabled when at oldest (index 0)
     * Right button (next/newer) disabled when at newest (max index)
     */
    updateButtonStates() {
        const effectiveIndex = Number.isInteger(this._previewIndex) ? this._previewIndex : this.currentIndex;
        if (this.prevBtn) {
            // Left button disabled when at leftmost (oldest, index 0)
            this.prevBtn.disabled = effectiveIndex <= 0;
        }
        if (this.nextBtn) {
            // Right button disabled when at rightmost (newest, max index)
            this.nextBtn.disabled = effectiveIndex >= this.dates.length - 1;
        }
        if (this.resetBtn) {
            this.resetBtn.disabled = this.preSliderState === null;
        }
    }

    /**
     * Save current layer state before slider interaction
     */
    savePreSliderState() {
        const loadedIds = this.getLoadedMapIds();
        this.preSliderState = [...loadedIds];
        console.log('[TimeSlider] Saved pre-slider state:', this.preSliderState);
    }

    /**
     * Restore layers to pre-slider state
     */
    async restorePreSliderState() {
        if (!this.preSliderState) return;

        const currentIds = this.getLoadedMapIds();

        // Unload all current layers
        for (const mapId of currentIds) {
            this.mapController.unloadLayer(mapId);
        }

        // Reload original layers
        for (const mapId of this.preSliderState) {
            const map = dataService.getMapById(mapId);
            if (map) {
                await this.mapController.loadLayer(map, true);
            }
        }

        // Refresh UI
        // UI will be updated by app.updateActiveLayers
    }


    /**
     * Derive the representative timestamp from the time-series maps that are
     * currently loaded. Used to initialise the slider position so it reflects
     * what's on screen. Returns the newest loaded timestamp if multiple, or
     * the single loaded map's timestamp if only one time-series layer is open.
     */
    _getLoadedTimestampInChains(activeMapIds) {
        if (!Array.isArray(activeMapIds) || activeMapIds.length === 0) return null;
        let newest = null;
        for (const mapId of activeMapIds) {
            if (!dataService.getChainForMap(mapId)) continue;
            const map = dataService.getMapById(mapId);
            const ts = map ? dataService.parseMapDate(map.date) : null;
            if (ts != null && (newest === null || ts > newest)) {
                newest = ts;
            }
        }
        return newest;
    }

    _getTimelineChainsForDateChange(currentIds) {
        const chains = [];
        const seen = new Set();
        const addChain = (chain) => {
            if (!chain?.id || seen.has(chain.id)) return;
            seen.add(chain.id);
            chains.push(chain);
        };

        for (const mapId of currentIds || []) {
            const chain = dataService.getChainForMap(mapId);
            addChain(chain);
        }

        if (this.activeChains?.length) {
            for (const chain of this.activeChains) {
                addChain(chain);
            }
        }

        if (this._preservedTimelineChains?.length) {
            for (const chain of this._preservedTimelineChains) {
                addChain(chain);
            }
        }

        return chains;
    }

    _findBestMatchInChain(chain, targetTimestamp) {
        const mapsInChain = dataService.getMapsInChain(chain);
        let bestMatch = null;

        for (const { map, timestamp } of mapsInChain) {
            if (timestamp && timestamp <= targetTimestamp) {
                if (!bestMatch || timestamp > bestMatch.timestamp) {
                    bestMatch = { map, timestamp };
                }
            }
        }

        return bestMatch ? bestMatch.map : null;
    }

    _buildTimelineSelections(currentIds, timelineChains, targetTimestamp) {
        const selections = [];
        const handledChains = new Set();

        for (const mapId of currentIds || []) {
            const chain = dataService.getChainForMap(mapId);
            if (!chain) {
                selections.push({ oldId: mapId, newMapId: mapId, isPlaceholder: false, chain: null });
                continue;
            }
            if (handledChains.has(chain.id)) continue;
            handledChains.add(chain.id);

            const match = this._findBestMatchInChain(chain, targetTimestamp);
            selections.push({
                oldId: mapId,
                newMapId: match?.id || null,
                isPlaceholder: !!match?.placeholder,
                chain
            });
        }

        for (const chain of timelineChains || []) {
            if (!chain?.id || handledChains.has(chain.id)) continue;
            handledChains.add(chain.id);

            const match = this._findBestMatchInChain(chain, targetTimestamp);
            selections.push({
                oldId: null,
                newMapId: match?.id || null,
                isPlaceholder: !!match?.placeholder,
                chain
            });
        }

        return selections;
    }

    _buildDateChangePlan(currentIds, timelineChains, targetTimestamp) {
        const selections = this._buildTimelineSelections(currentIds, timelineChains, targetTimestamp);
        const unloadIds = [];
        const loadIds = [];
        const loadMaps = [];
        const resultingLoadedIds = [];
        const changes = [];
        const seenUnload = new Set();
        const seenLoad = new Set();
        const seenResult = new Set();

        for (const { oldId, newMapId, isPlaceholder } of selections) {
            if (oldId && oldId === newMapId) {
                if (!seenResult.has(oldId)) {
                    seenResult.add(oldId);
                    resultingLoadedIds.push(oldId);
                }
                continue;
            }

            if (oldId && !seenUnload.has(oldId)) {
                seenUnload.add(oldId);
                unloadIds.push(oldId);
            }

            if (newMapId && !isPlaceholder) {
                if (!seenLoad.has(newMapId)) {
                    const map = dataService.getMapById(newMapId);
                    if (map) {
                        seenLoad.add(newMapId);
                        loadIds.push(newMapId);
                        loadMaps.push(map);
                    }
                }
                if (!seenResult.has(newMapId)) {
                    seenResult.add(newMapId);
                    resultingLoadedIds.push(newMapId);
                }
            }

            if (newMapId && isPlaceholder) {
                const newMap = dataService.getMapById(newMapId);
                const oldMap = oldId ? dataService.getMapById(oldId) : null;
                const oldName = oldMap ? this.getYear(oldMap.date) || oldMap.name : (oldId || 'None');
                const newName = newMap ? (this.getYear(newMap.date) || newMap.name) : 'Placeholder';
                changes.push(`${oldName} -> ${newName} (To Be Added)`);
            } else if (oldId && newMapId && oldId !== newMapId) {
                const oldMap = dataService.getMapById(oldId);
                const newMap = dataService.getMapById(newMapId);
                const oldName = oldMap ? this.getYear(oldMap.date) || oldMap.name : (oldId || 'None');
                const newName = newMap ? (this.getYear(newMap.date) || newMap.name) : newMapId;
                changes.push(`${oldName} -> ${newName}`);
            } else if (oldId && !newMapId) {
                const oldMap = dataService.getMapById(oldId);
                changes.push(`${oldMap?.name || oldId} removed`);
            }
        }

        return {
            selections,
            unloadIds,
            loadIds,
            loadMaps,
            resultingLoadedIds,
            changes
        };
    }

    _recordDateChangeMetrics(metrics) {
        if (!metrics) return;
        this._dateChangeHistory.push(metrics);
        if (this._dateChangeHistory.length > 20) {
            this._dateChangeHistory = this._dateChangeHistory.slice(-20);
        }
        if (metrics.stale) {
            this._lastStaleDateChangeMetrics = metrics;
            return;
        }
        this._lastDateChangeMetrics = metrics;
    }
    // Legacy pre-Phase-6 implementation retained temporarily for diffing only.
    // Do not call this path.
    async _legacyApplyDateChange() {
        const targetTimestamp = this.dates[this.currentIndex];
        const currentIds = this.getLoadedMapIds();
        const timelineChains = this._getTimelineChainsForDateChange(currentIds);

        console.log('[TimeSlider] applyDateChange - targetTimestamp:', targetTimestamp, 'targetDate:', new Date(targetTimestamp));
        console.log('[TimeSlider] applyDateChange - currentIds:', currentIds);
        console.log('[TimeSlider] applyDateChange - timelineChains:', timelineChains.map((chain) => chain.id));

        const selections = this._buildTimelineSelections(currentIds, timelineChains, targetTimestamp);
        console.log('[TimeSlider] applyDateChange - selections:', selections);

        const changes = [];
        const resultingLoadedIds = [];

        this._applyingDateChange = true;
        try {
            for (const { oldId, newMapId, isPlaceholder } of selections) {
                console.log('[TimeSlider] Processing:', oldId, '->', newMapId, 'placeholder:', isPlaceholder);
                if (oldId && oldId === newMapId) {
                    console.log('[TimeSlider] Skipping - no change needed');
                    resultingLoadedIds.push(oldId);
                    continue;
                }

                if (oldId) {
                    console.log('[TimeSlider] Unloading:', oldId);
                    this.mapController.unloadLayer(oldId);
                }

                if (newMapId && !isPlaceholder) {
                    const map = dataService.getMapById(newMapId);
                    console.log('[TimeSlider] Loading new:', newMapId, map?.name);
                    if (map) {
                        await this.mapController.loadLayer(map, true);
                        resultingLoadedIds.push(newMapId);

                        const oldMap = oldId ? dataService.getMapById(oldId) : null;
                        const oldName = oldMap ? this.getYear(oldMap.date) || oldMap.name : (oldId || 'None');
                        const newName = this.getYear(map.date) || map.name;
                        changes.push(`${oldName} → ${newName}`);
                    }
                } else if (newMapId && isPlaceholder) {
                    const newMap = dataService.getMapById(newMapId);
                    const oldMap = oldId ? dataService.getMapById(oldId) : null;
                    const oldName = oldMap ? this.getYear(oldMap.date) || oldMap.name : (oldId || 'None');
                    const newName = newMap ? (this.getYear(newMap.date) || newMap.name) : 'Placeholder';
                    changes.push(`${oldName} → ${newName} (To Be Added)`);
                    console.log('[TimeSlider] Placeholder date selected - no layer loaded');
                } else if (oldId) {
                    const oldMap = dataService.getMapById(oldId);
                    changes.push(`${oldMap?.name || oldId} removed`);
                }
            }
        } finally {
            this._applyingDateChange = false;
        }

        if (timelineChains.length > 0 && resultingLoadedIds.length === 0) {
            this._preservedTimelineChains = [...timelineChains];
            this._preservedTimelineTimestamp = targetTimestamp;
        } else {
            this._preservedTimelineChains = null;
            this._preservedTimelineTimestamp = null;
        }

        if (changes.length > 0 && this.onLayersChanged) {
            this.onLayersChanged();
        }

        this.highlightChangedLayers(changes);

        if (changes.length > 0) {
            this.showToast(`Layers updated: ${changes.join(', ')}`);
        } else {
            console.log('[TimeSlider] No changes to apply');
        }
    }

    async applyDateChange() {
        const requestToken = ++this._dateChangeRequestToken;
        const targetTimestamp = this.dates[this.currentIndex];
        this._queuedDateChangeRequest = { requestToken, targetTimestamp };

        if (this._dateChangeRunnerPromise) {
            return this._dateChangeRunnerPromise;
        }

        const runnerPromise = this._runQueuedDateChanges();
        this._dateChangeRunnerPromise = runnerPromise;
        try {
            await runnerPromise;
        } finally {
            if (this._dateChangeRunnerPromise === runnerPromise) {
                this._dateChangeRunnerPromise = null;
            }
        }
    }

    async _runQueuedDateChanges() {
        while (this._queuedDateChangeRequest) {
            const request = this._queuedDateChangeRequest;
            this._queuedDateChangeRequest = null;
            await this._applyDateChangeRequest(request);
        }
    }

    async _applyDateChangeRequest({ requestToken, targetTimestamp }) {
        const currentIds = this.getLoadedMapIds();
        const timelineChains = this._getTimelineChainsForDateChange(currentIds);
        const applyStartedAt = performance.now();
        const preOrder = typeof this.mapController.getVisibleLayerOrder === 'function'
            ? this.mapController.getVisibleLayerOrder()
            : null;

        console.log('[TimeSlider] applyDateChange - targetTimestamp:', targetTimestamp, 'targetDate:', new Date(targetTimestamp));
        console.log('[TimeSlider] applyDateChange - currentIds:', currentIds);
        console.log('[TimeSlider] applyDateChange - timelineChains:', timelineChains.map((chain) => chain.id));

        if (timelineChains.length > 0) {
            this._preservedTimelineChains = [...timelineChains];
            this._preservedTimelineTimestamp = targetTimestamp;
        }

        const plan = this._buildDateChangePlan(currentIds, timelineChains, targetTimestamp);
        console.log('[TimeSlider] applyDateChange - plan:', plan);

        if (plan.unloadIds.length === 0 && plan.loadMaps.length === 0) {
            if (timelineChains.length > 0 && plan.resultingLoadedIds.length === 0) {
                this._preservedTimelineChains = [...timelineChains];
                this._preservedTimelineTimestamp = targetTimestamp;
            } else {
                this._preservedTimelineChains = null;
                this._preservedTimelineTimestamp = null;
            }
            this._recordDateChangeMetrics({
                requestToken,
                targetTimestamp,
                applied: true,
                stale: false,
                changed: false,
                durationMs: performance.now() - applyStartedAt,
                unloadIds: [],
                loadIds: [],
                resultingLoadedIds: [...plan.resultingLoadedIds]
            });
            console.log('[TimeSlider] No changes to apply');
            return;
        }

        this._applyingDateChange = true;
        const loadedByThisApply = [];
        try {
            for (const unloadId of plan.unloadIds) {
                console.log('[TimeSlider] Unloading:', unloadId);
                this.mapController.unloadLayer(unloadId);
            }

            if (plan.loadMaps.length > 0) {
                await Promise.all(plan.loadMaps.map(async (map) => {
                    console.log('[TimeSlider] Loading new:', map.id, map?.name);
                    await this.mapController.loadLayer(map, true);
                    if (requestToken !== this._dateChangeRequestToken) {
                        this.mapController.unloadLayer(map.id);
                        return;
                    }
                    loadedByThisApply.push(map.id);
                }));
            }

            if (requestToken !== this._dateChangeRequestToken) {
                for (const loadedId of loadedByThisApply) {
                    this.mapController.unloadLayer(loadedId);
                }
                this._recordDateChangeMetrics({
                    requestToken,
                    targetTimestamp,
                    applied: false,
                    stale: true,
                    changed: true,
                    durationMs: performance.now() - applyStartedAt,
                    unloadIds: [...plan.unloadIds],
                    loadIds: [...plan.loadIds],
                    resultingLoadedIds: []
                });
                return;
            }
        } finally {
            this._applyingDateChange = false;
        }

        if (timelineChains.length > 0 && plan.resultingLoadedIds.length === 0) {
            this._preservedTimelineChains = [...timelineChains];
            this._preservedTimelineTimestamp = targetTimestamp;
        } else {
            this._preservedTimelineChains = null;
            this._preservedTimelineTimestamp = null;
        }

        // Restore pre-change z-order. Replacements keep their old slot; any
        // brand-new layers stack on top in load-completion order.
        if (preOrder && typeof this.mapController.applyLayerOrder === 'function') {
            const mapping = new Map();
            for (const sel of plan.selections) {
                if (sel.oldId && sel.newMapId && sel.oldId !== sel.newMapId) {
                    mapping.set(sel.oldId, sel.newMapId);
                }
            }
            const postVisible = new Set(this.mapController.getVisibleLayerOrder());
            const newOrder = [];
            const seen = new Set();
            for (const id of preOrder) {
                const mapped = mapping.get(id) || id;
                if (postVisible.has(mapped) && !seen.has(mapped)) {
                    newOrder.push(mapped);
                    seen.add(mapped);
                }
            }
            for (const id of postVisible) {
                if (!seen.has(id)) newOrder.push(id);
            }
            this.mapController.applyLayerOrder(newOrder);
        }

        if (plan.changes.length > 0 && this.onLayersChanged) {
            this.onLayersChanged();
        }

        this.highlightChangedLayers(plan.changes);

        this._recordDateChangeMetrics({
            requestToken,
            targetTimestamp,
            applied: true,
            stale: false,
            changed: plan.changes.length > 0,
            durationMs: performance.now() - applyStartedAt,
            unloadIds: [...plan.unloadIds],
            loadIds: [...plan.loadIds],
            resultingLoadedIds: [...plan.resultingLoadedIds]
        });

        if (plan.changes.length > 0) {
            this.showToast(`Layers updated: ${plan.changes.join(', ')}`);
        } else {
            console.log('[TimeSlider] No changes to apply');
        }
    }

    /**
     * Get list of currently loaded map IDs
     */
    getLoadedMapIds() {
        const ids = [];
        for (const [mapId, state] of this.mapController.layerStates) {
            if (state.loaded) {
                ids.push(mapId);
            }
        }
        return ids;
    }

    /**
     * Extract year from date value (string or number)
     */
    getYear(dateVal) {
        if (dateVal == null) return null;
        // Handle numeric dates like 2012
        if (typeof dateVal === 'number') {
            return dateVal.toString();
        }
        // Handle string dates like "2012" or "2012-01-01"
        const match = String(dateVal).match(/\d{4}/);
        return match ? match[0] : null;
    }

    /**
     * Show toast notification
     */
    showToast(message) {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'timeline-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.add('timeline-toast--visible');
        });

        // Remove after delay
        setTimeout(() => {
            toast.classList.remove('timeline-toast--visible');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Highlight changed layers in the active layers panel
     */
    highlightChangedLayers(changes) {
        const panel = document.getElementById('activeLayersList');
        if (!panel) return;

        // Add highlight animation to all layer items briefly
        const items = panel.querySelectorAll('.active-layer-item');
        items.forEach(item => {
            item.classList.add('layer-changed');
            setTimeout(() => item.classList.remove('layer-changed'), 1000);
        });
    }

    // ─── Election mode ───

    /**
     * Switch the slider to election mode.
     * @param {string[]} dates - All election dates for this body (e.g. ['2022-05-05','2017-03-02',...])
     * @param {string} currentDate - The currently displayed date
     * @param {function} onDateChange - Callback receiving the new date string when user navigates
     */
    setElectionDates(dates, currentDate, onDateChange) {
        this._electionMode = true;
        this._electionCallback = onDateChange;
        this._previewIndex = null;

        // Sort chronologically oldest-first (left = oldest, right = newest)
        const sorted = [...dates].sort();
        this._electionDatesSorted = sorted;

        this.dates = sorted.map((_, idx) => idx);
        this.currentIndex = sorted.findIndex(d => d === currentDate);
        if (this.currentIndex < 0) this.currentIndex = sorted.length - 1;

        // Configure slider
        if (this.slider) {
            this.slider.min = '0';
            this.slider.max = String(Math.max(0, this.dates.length - 1));
            this.slider.step = '1';
            this.slider.value = String(this.currentIndex);
        }

        // Hide reset button in election mode (not applicable)
        if (this.resetBtn) this.resetBtn.style.display = 'none';

        this.show();
        this.updateLabel();
        this.updateButtonStates();
    }

    /**
     * Exit election mode and restore normal slider behaviour.
     */
    clearElectionDates() {
        this._electionMode = false;
        this._electionCallback = null;
        this._electionDatesSorted = null;
        this._previewIndex = null;
        if (this.slider) {
            this.slider.step = '';
        }
        // Restore reset button visibility
        if (this.resetBtn) this.resetBtn.style.display = '';
        this.hide();
    }
}

// Export singleton instance
const timeSliderController = new TimeSliderController();
export default timeSliderController;

