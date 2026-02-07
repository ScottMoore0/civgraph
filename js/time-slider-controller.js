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
        this.slider.addEventListener('input', () => this.handleSliderChange());
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

        // If no time-series layers, hide the slider
        if (this.activeChains.length === 0) {
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

        // Preserve current position if slider was already active, otherwise start at newest
        if (previousTimestamp !== null && this.preSliderState !== null) {
            this.currentIndex = this.findClosestDateIndex(previousTimestamp);
        } else {
            // Fresh start: position at newest
            this.currentIndex = this.dates.length - 1;
            // Clear pre-slider state (fresh start)
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
    handleSliderChange() {
        const sliderTimestamp = parseInt(this.slider.value);

        // Find the closest date to the slider value
        const newIndex = this.findClosestDateIndex(sliderTimestamp);
        if (newIndex === this.currentIndex) return;

        // Save pre-slider state on first interaction
        if (this.preSliderState === null) {
            this.savePreSliderState();
        }

        this.currentIndex = newIndex;
        // Snap slider to the exact timestamp of the selected date
        this.slider.value = this.dates[this.currentIndex];
        this.updateLabel();
        this.updateButtonStates();
        this.applyDateChange();
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

    /**
     * Step backward in time (older date) - LEFT button
     * Decreases index (moves left on slider)
     */
    stepBackward() {
        if (this.currentIndex <= 0) return;

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

        const timestamp = this.dates[this.currentIndex];
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
        if (this.prevBtn) {
            // Left button disabled when at leftmost (oldest, index 0)
            this.prevBtn.disabled = this.currentIndex <= 0;
        }
        if (this.nextBtn) {
            // Right button disabled when at rightmost (newest, max index)
            this.nextBtn.disabled = this.currentIndex >= this.dates.length - 1;
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
     * Apply the date change - swap layers to match target date
     */
    async applyDateChange() {
        const targetTimestamp = this.dates[this.currentIndex];
        const currentIds = this.getLoadedMapIds();

        console.log('[TimeSlider] applyDateChange - targetTimestamp:', targetTimestamp, 'targetDate:', new Date(targetTimestamp));
        console.log('[TimeSlider] applyDateChange - currentIds:', currentIds);

        // Get equivalent maps for this date
        const equivalentMaps = dataService.getEquivalentMapsForDate(currentIds, targetTimestamp);

        console.log('[TimeSlider] applyDateChange - equivalentMaps:', equivalentMaps);

        const changes = [];

        // Guard: prevent updateForActiveLayers from resetting slider during swaps
        this._applyingDateChange = true;
        try {
            // Apply changes
            for (const [oldId, newId] of Object.entries(equivalentMaps)) {
                console.log('[TimeSlider] Processing:', oldId, '->', newId);
                if (oldId === newId) {
                    console.log('[TimeSlider] Skipping - no change needed');
                    continue;
                }

                // Unload old layer
                console.log('[TimeSlider] Unloading:', oldId);
                this.mapController.unloadLayer(oldId);

                if (newId) {
                    // Load new layer
                    const map = dataService.getMapById(newId);
                    console.log('[TimeSlider] Loading new:', newId, map?.name);
                    if (map) {
                        await this.mapController.loadLayer(map, true);

                        const oldMap = dataService.getMapById(oldId);
                        const oldName = oldMap ? this.getYear(oldMap.date) || oldMap.name : oldId;
                        const newName = this.getYear(map.date) || map.name;
                        changes.push(`${oldName} → ${newName}`);
                    }
                } else {
                    // No equivalent found - layer disappears
                    const oldMap = dataService.getMapById(oldId);
                    changes.push(`${oldMap?.name || oldId} removed`);
                }
            }
        } finally {
            this._applyingDateChange = false;
        }

        // Refresh active layers panel with the new set of layers
        if (changes.length > 0 && this.onLayersChanged) {
            this.onLayersChanged();
        }

        // Highlight changed layers in UI
        this.highlightChangedLayers(changes);

        // Show toast notification
        if (changes.length > 0) {
            this.showToast(`Layers updated: ${changes.join(', ')}`);
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
}

// Export singleton instance
const timeSliderController = new TimeSliderController();
export default timeSliderController;
