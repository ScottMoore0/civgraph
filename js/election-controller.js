/**
 * Election Controller
 * Integrates the election-viewer-package with the boundaries website.
 * Handles catalogue integration, FGB geography loading, map colouring,
 * split pane results, and seat circle / vote bar overlays.
 */

import mapController from './map-controller.js';
import timeSliderController from './time-slider-controller.js';

class ElectionController {
    constructor() {
        this.active = false;          // Is an election currently loaded?
        this.body = null;             // e.g. 'Northern Ireland Assembly'
        this.date = null;             // e.g. '2022-05-05'
        this.constituencies = null;   // From the index
        this.geojsonLayer = null;     // Leaflet GeoJSON layer for elected map
        this.overlayLayer = null;     // Seat circles / vote bars layer group
        this.overlayMode = 'circles'; // 'circles' or 'bars'
        this.selectedConstituency = null;
        this.resultsByConstituency = {};
        this.previousResultsByConstituency = {};
        this.previousDate = null;
        this._countDetailedView = false;
        this.partyColours = {};       // party name -> colour
        this.splitPaneEl = null;
        this.electionDataPath = 'election-viewer-package/data';
        this.onStateChange = null;    // callback for URL state updates
        this._registeredLayerId = null; // synthetic layer ID in mapController
        this.electionMapConfig = null;  // synthetic map config for active layers
    }

    /**
     * Geography Mapping Table
     * Maps body + date range to FGB file and name attribute.
     * Order matters Ã¢â‚¬â€ first match wins.
     */
    static GEOGRAPHY = [
        // Westminster 2024+ (2023 boundary review)
        { body: 'House of Commons of the United Kingdom', dateFrom: '2024-01-01', fgb: 'data/maps/parliamentary/PC2023.fgb', nameAttr: 'PC_NAME' },
        // Westminster 2005-2019 + by-elections (2008 boundary)
        { body: 'House of Commons of the United Kingdom', dateFrom: '2005-01-01', dateUntil: '2023-12-31', fgb: 'data/maps/parliamentary/PC2008.fgb', nameAttr: 'PC_NAME' },
        // Westminster 1997-2001 + by-elections (1995 boundary)
        { body: 'House of Commons of the United Kingdom', dateFrom: '1995-01-01', dateUntil: '2004-12-31', fgb: 'data/maps/parliamentary/PC1995.fgb', nameAttr: 'Name' },
        // Westminster 1983-1992 + by-elections (1982 boundary review)
        { body: 'House of Commons of the United Kingdom', dateFrom: '1983-01-01', dateUntil: '1994-12-31', fgb: 'data/maps/parliamentary/PC1982.fgb', nameAttr: 'Name' },
        // Westminster pre-1983 (1970 boundaries, 12 seats)
        { body: 'House of Commons of the United Kingdom', dateFrom: '1900-01-01', dateUntil: '1982-12-31', fgb: 'data/maps/parliamentary/PC1970.fgb', nameAttr: 'Name' },

        // NI Assembly 2022+ (uses 2008 PC boundaries, same as Westminster 2005-2019)
        { body: 'Northern Ireland Assembly', dateFrom: '2007-01-01', fgb: 'data/maps/parliamentary/PC2008.fgb', nameAttr: 'PC_NAME' },
        // NI Assembly 1998-2003 (1995 PC boundaries)
        { body: 'Northern Ireland Assembly', dateFrom: '1998-01-01', dateUntil: '2006-12-31', fgb: 'data/maps/parliamentary/PC1995.fgb', nameAttr: 'Name' },
        // NI Assembly 1982 + by-elections (old 12-constituency boundaries, PC1970)
        { body: 'Northern Ireland Assembly', dateFrom: '1973-01-01', dateUntil: '1997-12-31', fgb: 'data/maps/parliamentary/PC1970.fgb', nameAttr: 'Name' },

        // Constitutional Convention 1975 (12 seats, PC1970)
        { body: 'Northern Ireland Constitutional Convention', dateFrom: '1900-01-01', fgb: 'data/maps/parliamentary/PC1970.fgb', nameAttr: 'Name' },

        // Forum 1996 (18 seats + NI-wide, use PC1995)
        { body: 'Northern Ireland Forum for Political Dialogue', dateFrom: '1900-01-01', fgb: 'data/maps/parliamentary/PC1995.fgb', nameAttr: 'Name' },

        // European Parliament (single NI constituency Ã¢â‚¬â€ no useful map, but use PC2008 boundary for fill)
        { body: 'European Parliament', dateFrom: '1979-01-01', fgb: 'data/maps/parliamentary/PC2008.fgb', nameAttr: 'PC_NAME', singleConstituency: true },
    ];

    /**
     * Find the FGB geography config for a given body + date.
     */
    static getGeography(body, date) {
        for (const g of ElectionController.GEOGRAPHY) {
            if (g.body !== body) continue;
            if (g.dateFrom && date < g.dateFrom) continue;
            if (g.dateUntil && date > g.dateUntil) continue;
            return g;
        }
        return null;
    }

    /**
     * Load an election: fetch geography, load results, colour map, show split pane.
     */
    async loadElection(body, date) {
        // Clear any previous
        this.clear();

        const geo = ElectionController.getGeography(body, date);
        if (!geo) {
            console.error('[Election] No geography found for', body, date);
            return;
        }

        this.body = body;
        this.date = date;
        this.active = true;

        // Get the election index to find constituencies
        const indexData = await this._loadIndex();
        const bodyData = indexData.bodies.find(b => b.name === body);
        if (!bodyData) return;
        const dateData = bodyData.dates.find(d => d.date === date);
        if (!dateData) return;
        this.constituencies = dateData.constituencies;

        const bodyDatesDesc = [...bodyData.dates].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const currentIdx = bodyDatesDesc.findIndex(d => d.date === date);
        const previousDateData = currentIdx >= 0 ? bodyDatesDesc[currentIdx + 1] : null;
        this.previousDate = previousDateData?.date || null;

        // Load FGB geometry
        await this._loadGeography(geo);

        // Load election results for all constituencies
        this.resultsByConstituency = await this._loadAllResults(body, date, this.constituencies, {}, true);
        this.previousResultsByConstituency = this.previousDate
            ? await this._loadAllResults(body, this.previousDate, previousDateData.constituencies || [], {}, false)
            : {};

        // Colour the map by winning party
        this._colourMap(geo);

        // Suppress labels on layers below the election
        this._suppressLabelsBelow();

        // Add seat circle overlays
        this._addOverlays(geo);

        // Show split pane
        this._showSplitPane();

        // NI-wide results in the pane
        this._showNIWideResults();

        // Sync timeline slider to this body's election dates
        const allDates = bodyData.dates.map(d => d.date);
        timeSliderController.setElectionDates(allDates, date, (newDate) => {
            this.loadElection(this.body, newDate);
        });

        // Notify state change for URL
        if (this.onStateChange) this.onStateChange();
    }

    /**
     * Clear current election state
     */
    clear() {
        // Unregister from Active Layers
        this._unregisterActiveLayer();

        if (this.geojsonLayer) {
            mapController.map?.removeLayer(this.geojsonLayer);
            this.geojsonLayer = null;
        }
        if (this.overlayLayer) {
            mapController.map?.removeLayer(this.overlayLayer);
            this.overlayLayer = null;
        }
        if (this._onZoomEnd) {
            mapController.map?.off('zoomend', this._onZoomEnd);
            this._onZoomEnd = null;
        }
        this._overlayGroups = null;
        this.active = false;
        this.body = null;
        this.date = null;
        this.constituencies = null;
        this.selectedConstituency = null;
        this.resultsByConstituency = {};
        this.previousResultsByConstituency = {};
        this.previousDate = null;
        this._countDetailedView = false;
        this.partyColours = {};
        this._restoreLabels();
        this._hideSplitPane();
        timeSliderController.clearElectionDates();
        if (this.onStateChange) this.onStateChange();
    }

    /**
     * Suppress labels on all layers currently below the election layer.
     * Layers added after this call (i.e. on top of the election) keep labels.
     */
    _suppressLabelsBelow() {
        this._suppressedLabelLayers = [];
        mapController.layerStates.forEach((state, mapId) => {
            if (state.loaded && state.visible && !state.labelsHidden) {
                this._suppressedLabelLayers.push(mapId);
                mapController.setLayerLabelsHidden(mapId, true);
            }
        });
    }

    /**
     * Restore labels that were suppressed when the election was loaded.
     */
    _restoreLabels() {
        if (this._suppressedLabelLayers) {
            this._suppressedLabelLayers.forEach(mapId => {
                mapController.setLayerLabelsHidden(mapId, false);
            });
            this._suppressedLabelLayers = null;
        }
    }

    /**
     * Toggle visibility of all election visuals (geojson, overlays, results pane)
     * without clearing state Ã¢â‚¬â€ used when hiding/showing via active layers list.
     */
    setVisible(visible) {
        if (!this.active) return;

        if (visible) {
            // Re-add layers to map
            if (this.geojsonLayer && !mapController.map?.hasLayer(this.geojsonLayer)) {
                this.geojsonLayer.addTo(mapController.map);
            }
            if (this.overlayLayer && !mapController.map?.hasLayer(this.overlayLayer)) {
                this.overlayLayer.addTo(mapController.map);
            }
            this._showSplitPane();
            this._showNIWideResults();
            this._suppressLabelsBelow();
        } else {
            // Remove layers from map without destroying state
            if (this.geojsonLayer && mapController.map?.hasLayer(this.geojsonLayer)) {
                mapController.map.removeLayer(this.geojsonLayer);
            }
            if (this.overlayLayer && mapController.map?.hasLayer(this.overlayLayer)) {
                mapController.map.removeLayer(this.overlayLayer);
            }
            this._hideSplitPane();
            this._restoreLabels();
        }
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Data Loading Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    _indexData = null;
    _indexPromise = null;

    async _loadIndex() {
        if (this._indexData) return this._indexData;
        if (this._indexPromise) return this._indexPromise;
        this._indexPromise = fetch(this.electionDataPath + '/elections_index.json')
            .then(r => r.json())
            .then(d => { this._indexData = d; return d; });
        return this._indexPromise;
    }

    async _loadAllResults(body, date, constituencies, target = {}, extractPartyColours = true) {
        const slugify = (text) => String(text).toLowerCase().trim()
            .replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');

        const bodySlug = slugify(body);
        const promises = constituencies.map(c => {
            if (c === 'Northern Ireland') return Promise.resolve(null); // NI-wide seat, skip
            const url = `${this.electionDataPath}/elections/${bodySlug}/${date}/${slugify(c)}.json`;
            return fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
        });

        const results = await Promise.all(promises);
        constituencies.forEach((c, i) => {
            if (results[i]) {
                target[c] = results[i];
                // Extract party colours
                const cg = results[i]?.Constituency?.countGroup;
                if (cg && extractPartyColours) {
                    cg.forEach(row => {
                        const party = row.Party_Name || 'Independent';
                        if (row.Party_Colour && !this.partyColours[party]) {
                            this.partyColours[party] = row.Party_Colour;
                        }
                    });
                }
            }
        });
        return target;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Geography Loading Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    async _loadGeography(geo) {
        try {
            // Fetch then stream Ã¢â‚¬â€ direct URL needs range request support
            const response = await fetch(geo.fgb);
            const features = [];
            for await (const feature of flatgeobuf.deserialize(response.body)) {
                features.push(feature);
            }

            const geojson = { type: 'FeatureCollection', features };

            // Create Leaflet layer
            this.geojsonLayer = L.geoJSON(geojson, {
                style: (feature) => ({
                    fillColor: '#aab',
                    fillOpacity: 0.3,
                    color: '#555',
                    weight: 1.5,
                    opacity: 0.8
                }),
                onEachFeature: (feature, layer) => {
                    const name = feature.properties[geo.nameAttr];
                    if (name) {
                        layer.on('click', () => this._onConstituencyClick(name));
                        layer.bindTooltip(this._titleCase(name), {
                            sticky: true,
                            className: 'election-tooltip'
                        });
                        // Hover highlight: compound outline (black-white-black sandwich)
                        layer.on('mouseover', () => {
                            // Store current style before changing
                            layer._preHoverStyle = {
                                color: layer.options?.color || '#555',
                                weight: layer.options?.weight || 1.5
                            };
                            // Create a shadow layer for the outer black border
                            if (layer._hoverShadow) {
                                mapController.map.removeLayer(layer._hoverShadow);
                            }
                            layer._hoverShadow = L.geoJSON(layer.feature, {
                                style: { weight: 5, color: '#000', fill: false, opacity: 1 },
                                interactive: false
                            });
                            layer._hoverShadow.addTo(mapController.map);
                            // Set white inner stroke and bring feature above the shadow
                            layer.setStyle({ color: '#fff', weight: 3 });
                            layer.bringToFront();
                        });
                        layer.on('mouseout', () => {
                            // Remove shadow layer
                            if (layer._hoverShadow) {
                                mapController.map.removeLayer(layer._hoverShadow);
                                layer._hoverShadow = null;
                            }
                            // Restore original style (no bringToBack Ã¢â‚¬â€ avoids z-order corruption)
                            const prev = layer._preHoverStyle || { color: '#555', weight: 1.5 };
                            layer.setStyle({ color: prev.color, weight: prev.weight });
                        });
                    }
                }
            });

            this.geojsonLayer.addTo(mapController.map);
            mapController.map.fitBounds(this.geojsonLayer.getBounds(), { padding: [20, 20] });

            // Register as a synthetic layer so it appears in Active Layers
            this._registerActiveLayer();
        } catch (err) {
            console.error('[Election] Failed to load geography:', err);
        }
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Map Colouring Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    _colourMap(geo) {
        if (!this.geojsonLayer) return;

        this.geojsonLayer.eachLayer(layer => {
            const featureName = layer.feature?.properties?.[geo.nameAttr];
            if (!featureName) return;

            // Find matching constituency (case-insensitive)
            const constName = this._matchConstituency(featureName);
            if (!constName) return;

            const result = this.resultsByConstituency[constName];
            if (!result) return;

            const winner = this._getWinner(result);
            if (winner) {
                layer.setStyle({
                    fillColor: winner.colour,
                    fillOpacity: 0.6,
                    color: '#333',
                    weight: 1.5,
                    opacity: 0.8
                });
            }
        });
    }

    _getWinner(payload) {
        const cg = payload?.Constituency?.countGroup;
        if (!cg) return null;

        // Colour by party with highest first-preference vote total
        const partyVotes = {};
        cg.forEach(row => {
            if (String(row.Count_Number) === '1') {
                const party = row.Party_Name || 'Independent';
                const votes = parseFloat(row.Total_Votes) || 0;
                if (!partyVotes[party]) {
                    partyVotes[party] = { votes: 0, colour: row.Party_Colour || '#b0bec5' };
                }
                partyVotes[party].votes += votes;
            }
        });

        const sorted = Object.entries(partyVotes).sort((a, b) => b[1].votes - a[1].votes);
        if (sorted.length === 0) return null;
        return { party: sorted[0][0], colour: sorted[0][1].colour };
    }

    _matchConstituency(fgbName) {
        const upper = fgbName.toUpperCase();
        return this.constituencies?.find(c => c.toUpperCase() === upper) || null;
    }

    _titleCase(str) {
        return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Overlays (Seat Circles) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    /**
     * Extract all elected members from countGroup, including "deemed elected"
     * (those remaining at the final count who were never excluded).
     * Returns array sorted by election order, capped at numSeats.
     */
    _extractElected(result) {
        const cg = result.Constituency?.countGroup;
        if (!cg) return [];

        const numSeats = parseInt(result.Constituency?.countInfo?.Number_Of_Seats) || 5;
        const elected = [];
        const excluded = new Set();
        const seen = new Set();
        const lastCount = Math.max(...cg.map(r => +r.Count_Number || 0));

        // Pass 1: collect explicitly elected candidates and track excluded
        cg.forEach(row => {
            if (this._statusKind(row.Status) === 'excluded') excluded.add(row.Candidate_Id);
            if (this._statusKind(row.Status) === 'elected' && !seen.has(row.Candidate_Id)) {
                seen.add(row.Candidate_Id);
                elected.push({
                    name: row.candidateName || (row.Firstname + ' ' + row.Surname),
                    party: row.Party_Name || 'Independent',
                    colour: row.Party_Colour || '#b0bec5',
                    count: +row.Count_Number
                });
            }
        });

        // Pass 2: add "deemed elected" Ã¢â‚¬â€ candidates remaining at final count
        // who were never excluded (they fill remaining seats)
        if (elected.length < numSeats) {
            const finalRound = cg.filter(r => +r.Count_Number === lastCount);
            // Sort by vote total descending so highest-voted fill remaining seats first
            finalRound.sort((a, b) => (parseFloat(b.Total_Votes) || 0) - (parseFloat(a.Total_Votes) || 0));
            finalRound.forEach(row => {
                if (!seen.has(row.Candidate_Id) &&
                    !excluded.has(row.Candidate_Id) &&
                    row.Candidate_Id !== 'nontransferable') {
                    seen.add(row.Candidate_Id);
                    elected.push({
                        name: row.candidateName || (row.Firstname + ' ' + row.Surname),
                        party: row.Party_Name || 'Independent',
                        colour: row.Party_Colour || '#b0bec5',
                        count: lastCount
                    });
                }
            });
        }

        // Sort by election order (count number) and cap at seat count
        elected.sort((a, b) => a.count - b.count);
        return elected.slice(0, numSeats);
    }

    _addOverlays(geo) {
        if (!this.geojsonLayer) return;
        this.overlayLayer = L.layerGroup().addTo(mapController.map);

        // Fixed circle size for all constituencies
        const circleSize = 12;
        const spacing = circleSize + 1;

        // Collect all constituency data with their Leaflet layers (needed for bounds)
        const groups = [];
        this.geojsonLayer.eachLayer(layer => {
            const featureName = layer.feature?.properties?.[geo.nameAttr];
            if (!featureName) return;

            const constName = this._matchConstituency(featureName);
            if (!constName) return;

            const result = this.resultsByConstituency[constName];
            if (!result) return;

            const bounds = layer.getBounds();
            const centroid = bounds.getCenter();
            const elected = this._extractElected(result);
            if (elected.length === 0) return;

            const positions = this._seatPositions(elected.length, spacing);
            const groupWidth = Math.max(...positions.map(p => p.x)) - Math.min(...positions.map(p => p.x)) + circleSize;
            const groupHeight = Math.max(...positions.map(p => p.y)) - Math.min(...positions.map(p => p.y)) + circleSize;

            groups.push({
                constName,
                bounds,         // lat/lng bounding box
                centroid,       // lat/lng centre
                elected,
                positions,
                groupWidth,
                groupHeight
            });
        });

        if (groups.length === 0) return;

        // Store for re-render on zoom
        this._overlayGroups = groups;
        this._overlayCircleSize = circleSize;

        // Initial render
        this._renderOverlays();

        // Re-render on zoom change (pixel sizes change)
        this._onZoomEnd = () => this._renderOverlays();
        mapController.map.on('zoomend', this._onZoomEnd);
    }

    /**
     * Render seat circle groups, showing only those that pass visibility rules.
     * Called on initial load and on every zoom change.
     */
    _renderOverlays() {
        if (!this._overlayGroups || !this.overlayLayer) return;

        const map = mapController.map;
        const circleSize = this._overlayCircleSize;
        const groups = this._overlayGroups;

        // Clear previous markers
        this.overlayLayer.clearLayers();

        // Rule 3: Absolute minimum Ã¢â‚¬â€ if all constituencies together are tiny, hide all.
        // Compute the total NI extent in pixels using the union of all constituency bounds.
        const allBounds = groups.reduce(
            (acc, g) => acc.extend(g.bounds),
            L.latLngBounds(groups[0].bounds)
        );
        const niNE = map.latLngToContainerPoint(allBounds.getNorthEast());
        const niSW = map.latLngToContainerPoint(allBounds.getSouthWest());
        const niPixelWidth = Math.abs(niNE.x - niSW.x);
        const niPixelHeight = Math.abs(niSW.y - niNE.y);

        if (niPixelWidth < 120 || niPixelHeight < 120) {
            return; // Too zoomed out Ã¢â‚¬â€ hide everything
        }

        // Pre-compute pixel centroids and constituency pixel areas
        const pixelCentroids = groups.map(g => map.latLngToContainerPoint(g.centroid));
        const pixelAreas = groups.map(g => {
            const ne = map.latLngToContainerPoint(g.bounds.getNorthEast());
            const sw = map.latLngToContainerPoint(g.bounds.getSouthWest());
            return Math.abs(ne.x - sw.x) * Math.abs(sw.y - ne.y);
        });

        const margin = 4; // px gap between groups

        // Sort groups by pixel area (largest first) for greedy placement
        const order = groups.map((_, i) => i);
        order.sort((a, b) => pixelAreas[b] - pixelAreas[a]);

        // Greedy placement: larger constituencies get priority
        const placed = []; // indices of groups already placed

        order.forEach(idx => {
            const group = groups[idx];
            const myCentroid = pixelCentroids[idx];
            const myHalfW = group.groupWidth / 2 + margin;
            const myHalfH = group.groupHeight / 2 + margin;

            // Check overlap only against already-placed groups
            let overlaps = false;
            for (const pIdx of placed) {
                const pg = groups[pIdx];
                const otherHalfW = pg.groupWidth / 2 + margin;
                const otherHalfH = pg.groupHeight / 2 + margin;

                if (Math.abs(myCentroid.x - pixelCentroids[pIdx].x) < (myHalfW + otherHalfW) &&
                    Math.abs(myCentroid.y - pixelCentroids[pIdx].y) < (myHalfH + otherHalfH)) {
                    overlaps = true;
                    break;
                }
            }

            if (overlaps) return; // Would overlap a larger, already-placed group
            placed.push(idx);

            // Render the seat circle group
            let dotsHtml = '';
            group.positions.forEach((pos, i) => {
                if (i >= group.elected.length) return;
                const member = group.elected[i];
                const left = pos.x - group.positions[0].x;
                const top = pos.y - group.positions[0].y;
                dotsHtml += `<div class="seat-dot" style="position:absolute;left:${left}px;top:${top}px;background:${member.colour};width:${circleSize}px;height:${circleSize}px" title="${this._esc(member.name)} (${this._esc(member.party)})"></div>`;
            });

            const containerHtml = `<div class="seat-group" style="position:relative;width:${group.groupWidth}px;height:${group.groupHeight}px">${dotsHtml}</div>`;

            const icon = L.divIcon({
                className: 'election-seat-circle',
                html: containerHtml,
                iconSize: [group.groupWidth, group.groupHeight],
                iconAnchor: [group.groupWidth / 2, group.groupHeight / 2]
            });

            const marker = L.marker(group.centroid, { icon, interactive: true });
            marker.addTo(this.overlayLayer);
        });
    }

    /**
     * Compute pixel positions for N seats in a 3-2 pyramid layout.
     * Row 1: ceil(N/2) or 3 circles, Row 2: remaining circles offset by half-spacing.
     * For exactly 5: top row of 3, bottom row of 2.
     */
    _seatPositions(n, spacing) {
        if (n <= 0) return [];
        if (n === 1) return [{ x: 0, y: 0 }];
        if (n === 2) return [{ x: 0, y: 0 }, { x: spacing, y: 0 }];
        if (n === 3) return [{ x: 0, y: 0 }, { x: spacing, y: 0 }, { x: spacing * 2, y: 0 }];

        const topCount = Math.ceil(n / 2);
        const botCount = n - topCount;
        const rowGap = spacing;
        const positions = [];

        const topWidth = (topCount - 1) * spacing;
        const topStartX = -topWidth / 2;
        for (let i = 0; i < topCount; i++) {
            positions.push({ x: topStartX + i * spacing, y: 0 });
        }

        const botWidth = (botCount - 1) * spacing;
        const botStartX = -botWidth / 2;
        for (let i = 0; i < botCount; i++) {
            positions.push({ x: botStartX + i * spacing, y: rowGap });
        }

        const minX = Math.min(...positions.map(p => p.x));
        const minY = Math.min(...positions.map(p => p.y));
        positions.forEach(p => { p.x -= minX; p.y -= minY; });

        return positions;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Split Pane Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    _showSplitPane() {
        this.splitPaneEl = document.getElementById('electionResultsPane');
        // Detach animation scaffold before resetting innerHTML
        if (this._animScaffold && this._animScaffold.parentNode) {
            this._animScaffold.parentNode.removeChild(this._animScaffold);
        }

        if (!this.splitPaneEl) {
            this.splitPaneEl = document.createElement('div');
            this.splitPaneEl.id = 'electionResultsPane';
            this.splitPaneEl.className = 'election-results-pane';
            // Insert after <main class="app-main"> so it spans full width
            const appMain = document.querySelector('.app-main');
            if (appMain && appMain.nextSibling) {
                appMain.parentElement.insertBefore(this.splitPaneEl, appMain.nextSibling);
            } else if (appMain) {
                appMain.parentElement.appendChild(this.splitPaneEl);
            } else {
                document.body.appendChild(this.splitPaneEl);
            }
        }

        this.splitPaneEl.classList.add('election-results-pane--open');
        this.splitPaneEl.innerHTML = `
            <div class="election-pane__header" id="electionPaneHeader">
                <h3 class="election-pane__title" id="electionPaneTitle">${this._esc(this._shortBodyName(this.body))} \u2014 ${this._formatDate(this.date)}</h3>
                <div class="election-pane__header-right" id="electionPaneHeaderRight">
                    <button type="button" id="electionCloseBtn" class="election-pane__close" title="Close election">\u2715</button>
                </div>
            </div>
            <div class="election-pane__content" id="electionPaneContent">
                <div class="election-loading">Loading NI-wide results...</div>
            </div>
        `;

        // Create animation scaffold once (persistent reference)
        if (!this._animScaffold) {
            this._animScaffold = document.createElement('div');
            this._animScaffold.id = 'electionAnimationContainer';
            this._animScaffold.className = 'election-animation-container';
            this._animScaffold.style.display = 'none';
            this._animScaffold.innerHTML = `
                <div class="ev-animation-top-row">
                    <div class="ev-animation-controls">
                        <i id="pause-replay" class="fa fa-pause" title="Pause / Replay"></i>
                    </div>
                    <div id="stageNumbers"></div>
                </div>
                <div id="quota"></div>
                <div id="animation" class="ev-animation-stage"></div>
                <div id="count_matrix"></div>
                <div id="transfers"></div>
            `;
        }

        // Attach animation scaffold into pane content (hidden)
        this._animScaffold.style.display = 'none';
        this.splitPaneEl.querySelector('#electionPaneContent')?.appendChild(this._animScaffold);

        // Close button
        this.splitPaneEl.querySelector('#electionCloseBtn')?.addEventListener('click', () => {
            this.clear();
        });

        // Insert drag handle before results pane and set up vertical split
        const appMain = document.querySelector('.app-main');
        if (appMain) {
            // Set app-main to 60% height initially
            appMain.style.height = '60vh';

            // Create drag handle if not present
            let dragHandle = document.getElementById('electionSplitDrag');
            if (!dragHandle) {
                dragHandle = document.createElement('div');
                dragHandle.id = 'electionSplitDrag';
                dragHandle.className = 'election-split-drag';
                dragHandle.title = 'Drag to resize';
                this.splitPaneEl.parentElement.insertBefore(dragHandle, this.splitPaneEl);
            }

            // Drag logic
            this._setupSplitDrag(dragHandle, appMain);

            mapController.invalidateSize();
        }
    }

    /**
     * Setup drag-to-resize between app-main and results pane
     */
    _setupSplitDrag(dragHandle, appMain) {
        let isDragging = false;

        const onMove = (clientY) => {
            if (!isDragging) return;
            const headerH = document.querySelector('.app-header')?.offsetHeight || 0;
            const viewportH = window.innerHeight;
            const availH = viewportH - headerH;
            const relY = clientY - headerH;
            const pct = Math.max(20, Math.min(85, (relY / availH) * 100));
            appMain.style.height = pct + 'vh';
            if (this.splitPaneEl) {
                this.splitPaneEl.style.height = 'calc(' + (100 - pct) + 'vh - ' + headerH + 'px - 6px)';
            }
            mapController.invalidateSize();
        };

        const onEnd = () => {
            isDragging = false;
            document.body.classList.remove('election-split-dragging');
        };

        dragHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            document.body.classList.add('election-split-dragging');
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => onMove(e.clientY));
        document.addEventListener('mouseup', onEnd);

        dragHandle.addEventListener('touchstart', (e) => {
            isDragging = true;
            document.body.classList.add('election-split-dragging');
            e.preventDefault();
        }, { passive: false });
        document.addEventListener('touchmove', (e) => {
            if (isDragging) onMove(e.touches[0].clientY);
        });
        document.addEventListener('touchend', onEnd);
    }

    _hideSplitPane() {
        if (this.splitPaneEl) {
            this.splitPaneEl.classList.remove('election-results-pane--open');
            this.splitPaneEl.innerHTML = '';
        }
        // Remove drag handle
        const dragHandle = document.getElementById('electionSplitDrag');
        if (dragHandle) dragHandle.remove();
        // Restore app-main height
        const appMain = document.querySelector('.app-main');
        if (appMain) {
            appMain.style.height = '';
        }
        mapController.invalidateSize();
    }

    /**
     * Register election as a synthetic layer in mapController.layerStates
     * so it appears in the Active Layers panel.
     */
    _registerActiveLayer() {
        if (!this.geojsonLayer || !this.body || !this.date) return;

        const slug = String(this.body).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');
        const id = `election-${slug}-${this.date}`;
        this._registeredLayerId = id;

        // Create a synthetic map config for the UI
        this.electionMapConfig = {
            id,
            name: `${this._shortBodyName(this.body)} ${this._formatDate(this.date)}`,
            style: { color: '#1a365d' },
            provider: ['Election Viewer'],
            date: this.date
        };

        // Create a synthetic layer state
        const state = {
            id,
            config: this.electionMapConfig,
            group: L.layerGroup([this.geojsonLayer]),
            geoJsonLayers: [],
            labelEntries: [],
            loaded: true,
            loading: false,
            visible: true,
            progress: 100,
            useLOD: false,
            isElection: true   // Flag to identify election layers
        };
        mapController.layerStates.set(id, state);

        // Dispatch event so app.updateActiveLayers() picks it up
        window.dispatchEvent(new CustomEvent('layers-changed'));
    }

    /**
     * Unregister election from mapController.layerStates
     */
    _unregisterActiveLayer() {
        if (this._registeredLayerId) {
            mapController.layerStates.delete(this._registeredLayerId);
            this._registeredLayerId = null;
            this.electionMapConfig = null;
            window.dispatchEvent(new CustomEvent('layers-changed'));
        }
    }

    _showNIWideResults() {
        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        if (!content) return;
        this._restoreHeaderTabs();
        this._renderNIWideView('party', content);
    }

    _setupNIWideTabs(defaultTab = 'party') {
        const headerRight = document.getElementById('electionPaneHeaderRight');
        const titleEl = document.getElementById('electionPaneTitle');
        if (!headerRight || !titleEl) return;
        titleEl.textContent = `${this._shortBodyName(this.body)} - ${this._formatDate(this.date)}`;
        const closeBtn = headerRight.querySelector('#electionCloseBtn');
        headerRight.innerHTML = '';
        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        const tabs = [
            { id: 'party', label: 'By Party' },
            { id: 'candidate', label: 'By Candidate' },
            { id: 'local-party', label: 'By Local Party' }
        ];
        tabs.forEach((def) => {
            const btn = document.createElement('button');
            btn.className = 'election-view-tab' + (def.id === defaultTab ? ' election-view-tab--active' : '');
            btn.dataset.tab = def.id;
            btn.textContent = def.label;
            btn.addEventListener('click', () => {
                headerRight.querySelectorAll('.election-view-tab').forEach(b => b.classList.remove('election-view-tab--active'));
                btn.classList.add('election-view-tab--active');
                if (content) this._renderNIWideView(def.id, content);
            });
            headerRight.appendChild(btn);
        });
        if (closeBtn) headerRight.appendChild(closeBtn);
    }

    _renderNIWideView(tabId, container) {
        this._hideAnimation();
        container.style.overflowY = 'auto';
        container.style.overflowX = 'hidden';
        container.style.padding = '';
        if (tabId === 'candidate') {
            container.innerHTML = this._buildNIWideCandidateTable();
        } else if (tabId === 'local-party') {
            container.innerHTML = this._buildNIWideLocalPartyTable();
        } else {
            container.innerHTML = this._buildNIWidePartyTable();
        }
        this._setupResultsTableControls(container);
    }

    _buildNIWidePartyTable() {
        const partyTotals = {};
        let totalValid = 0;
        let totalPoll = 0;
        let totalElectorate = 0;
        let totalSpoiled = 0;
        let totalSeats = 0;
        const electedSet = new Set();
        const prevPartyTotals = new Map();
        let prevTotalValid = 0;
        let prevTotalPoll = 0;
        let prevTotalElectorate = 0;
        let prevTotalSpoiled = 0;

        for (const [, payload] of Object.entries(this.resultsByConstituency)) {
            if (!payload?.Constituency) continue;
            const cg = payload.Constituency.countGroup;
            const info = payload.Constituency.countInfo;
            if (!info || !cg) continue;
            totalSeats += parseInt(info.Number_Of_Seats) || 0;
            totalValid += parseFloat(info.Valid_Poll) || 0;
            totalPoll += parseFloat(info.Total_Poll) || 0;
            totalElectorate += parseFloat(info.Total_Electorate) || 0;
            totalSpoiled += parseFloat(info.Spoiled) || 0;

            cg.forEach(row => {
                if (row.Count_Number === '1') {
                    const party = row.Party_Name || 'Independent';
                    const votes = parseFloat(row.Total_Votes) || 0;
                    if (!partyTotals[party]) partyTotals[party] = { votes: 0, seats: 0, colour: row.Party_Colour || '#b0bec5', stood: 0 };
                    partyTotals[party].votes += votes;
                    partyTotals[party].stood += 1;
                }
            });

            // Match constituency-level seat logic: include explicit and deemed elected.
            const constituencyElected = this._extractElected(payload);
            constituencyElected.forEach((member) => {
                const key = `${info.Constituency_Name || ''}::${member.name}`;
                if (electedSet.has(key)) return;
                electedSet.add(key);
                const party = member.party || 'Independent';
                if (!partyTotals[party]) partyTotals[party] = { votes: 0, seats: 0, colour: member.colour || '#b0bec5', stood: 0 };
                partyTotals[party].seats++;
            });
        }

        for (const [, payload] of Object.entries(this.previousResultsByConstituency || {})) {
            if (!payload?.Constituency) continue;
            const cg = payload.Constituency.countGroup;
            const info = payload.Constituency.countInfo;
            if (!info || !cg) continue;
            prevTotalValid += parseFloat(info.Valid_Poll) || 0;
            prevTotalPoll += parseFloat(info.Total_Poll) || 0;
            prevTotalElectorate += parseFloat(info.Total_Electorate) || 0;
            prevTotalSpoiled += parseFloat(info.Spoiled) || 0;
            const seen = new Set();
            cg.forEach(row => {
                const countNum = parseInt(row.Count_Number, 10) || 1;
                const cid = String(row.Candidate_Id || '');
                const party = row.Party_Name || 'Independent';
                if (countNum === 1 && !seen.has(cid)) {
                    seen.add(cid);
                    if (!prevPartyTotals.has(party)) {
                        prevPartyTotals.set(party, { votes: 0, stood: 0, seats: 0 });
                    }
                    const prev = prevPartyTotals.get(party);
                    prev.votes += parseFloat(row.Total_Votes) || 0;
                    prev.stood += 1;
                }
            });

            const prevConstituencyElected = this._extractElected(payload);
            prevConstituencyElected.forEach((member) => {
                const party = member.party || 'Independent';
                if (!prevPartyTotals.has(party)) {
                    prevPartyTotals.set(party, { votes: 0, stood: 0, seats: 0 });
                }
                prevPartyTotals.get(party).seats += 1;
            });
        }

        const parties = Object.entries(partyTotals).sort((a, b) => {
            if (b[1].seats !== a[1].seats) return b[1].seats - a[1].seats;
            return b[1].votes - a[1].votes;
        });

        if (parties.length === 0) {
            return '<div class="election-no-data">No results data available.</div>';
        }

        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        const pctValue = (n, denom) => denom > 0 ? (n / denom * 100) : 0;
        const pct = (n) => totalValid > 0 ? (pctValue(n, totalValid).toFixed(2) + '%') : '';
        const turnoutPct = totalElectorate > 0 ? (totalPoll / totalElectorate * 100) : 0;
        const validPct = totalElectorate > 0 ? (totalValid / totalElectorate * 100) : 0;
        const spoiledPct = totalElectorate > 0 ? (totalSpoiled / totalElectorate * 100) : 0;
        const didNotVote = Math.max(0, totalElectorate - totalPoll);
        const dnvPct = totalElectorate > 0 ? (didNotVote / totalElectorate * 100) : 0;
        const prevDidNotVote = Math.max(0, prevTotalElectorate - prevTotalPoll);
        const prevTurnoutPct = prevTotalElectorate > 0 ? (prevTotalPoll / prevTotalElectorate * 100) : 0;
        const prevValidPct = prevTotalElectorate > 0 ? (prevTotalValid / prevTotalElectorate * 100) : 0;
        const prevSpoiledPct = prevTotalElectorate > 0 ? (prevTotalSpoiled / prevTotalElectorate * 100) : 0;
        const prevDnvPct = prevTotalElectorate > 0 ? (prevDidNotVote / prevTotalElectorate * 100) : 0;
        const rankLabel = (idx) => {
            const n = idx + 1;
            if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
            if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
            if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
            return `${n}th`;
        };

        let html = `
            <div class="election-summary election-summary--niwide">
                <div class="election-party-wrapper">
                <table class="election-party-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th class="election-colour-col"></th>
                            <th>Party</th>
                            <th class="election-num">Stood</th>
                            <th class="election-num">+/-</th>
                            <th class="election-num">Elected</th>
                            <th class="election-num">+/-</th>
                            <th class="election-num">${this._thTwoLine('1st prefs', '')}</th>
                            <th class="election-num">+/-</th>
                            <th class="election-num">${this._thTwoLine('% of', 'NI')}</th>
                            <th class="election-num">${this._thTwoLine('% of NI', '+/-')}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        parties.forEach(([name, data], idx) => {
            const prev = prevPartyTotals.get(name);
            const prevVotes = prev?.votes;
            const stoodDelta = prev ? (data.stood - prev.stood) : null;
            const electedDelta = prev ? (data.seats - prev.seats) : null;
            const votesDelta = typeof prevVotes === 'number' ? (data.votes - prevVotes) : null;
            const prevPct = typeof prevVotes === 'number' ? pctValue(prevVotes, prevTotalValid) : null;
            const pctDelta = typeof prevPct === 'number' ? (pctValue(data.votes, totalValid) - prevPct) : null;
            html += `
                <tr>
                    <td class="election-rank-col">${rankLabel(idx)}</td>
                    <td class="election-colour-col"><span class="election-party-dot" style="background:${this._esc(data.colour)}"></span></td>
                    <td>${this._esc(name)}</td>
                    <td class="election-num">${data.stood}</td>
                    <td class="election-num">${this._fmtMaybeDelta(stoodDelta)}</td>
                    <td class="election-num">${data.seats}</td>
                    <td class="election-num">${this._fmtMaybeDelta(electedDelta)}</td>
                    <td class="election-num">${fmt(data.votes)}</td>
                    <td class="election-num">${this._fmtMaybeDelta(votesDelta)}</td>
                    <td class="election-num">${pct(data.votes)}</td>
                    <td class="election-num">${this._fmtMaybePctDelta(pctDelta)}</td>
                </tr>
            `;
        });

        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Valid votes</strong></td><td class="election-num">${this.constituencies?.filter(c => c !== 'Northern Ireland').length || 0}</td><td class="election-num">-</td><td class="election-num">${totalSeats}</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(totalValid)}</td><td class="election-num">${this._fmtMaybeDelta(totalValid - prevTotalValid)}</td><td class="election-num election-cell-strong">${validPct.toFixed(2)}%</td><td class="election-num">${this._fmtMaybePctDelta(validPct - prevValidPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Turnout</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(totalPoll)}</td><td class="election-num">${this._fmtMaybeDelta(totalPoll - prevTotalPoll)}</td><td class="election-num election-cell-strong">${turnoutPct.toFixed(2)}%</td><td class="election-num">${this._fmtMaybePctDelta(turnoutPct - prevTurnoutPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Spoiled</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(totalSpoiled)}</td><td class="election-num">${this._fmtMaybeDelta(totalSpoiled - prevTotalSpoiled)}</td><td class="election-num election-cell-strong">${spoiledPct.toFixed(2)}%</td><td class="election-num">${this._fmtMaybePctDelta(spoiledPct - prevSpoiledPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Did not vote</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(didNotVote)}</td><td class="election-num">${this._fmtMaybeDelta(didNotVote - prevDidNotVote)}</td><td class="election-num election-cell-strong">${dnvPct.toFixed(2)}%</td><td class="election-num">${this._fmtMaybePctDelta(dnvPct - prevDnvPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Electorate</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(totalElectorate)}</td><td class="election-num">${this._fmtMaybeDelta(totalElectorate - prevTotalElectorate)}</td><td class="election-num election-cell-strong">100.00%</td><td class="election-num">${this._fmtMaybePctDelta(0)}</td></tr>`;
        html += `</tbody></table></div></div>`;
        return html;
    }

    _buildNIWideCandidateTable() {
        const rows = [];
        let totalValid = 0;
        const prevByCandidate = new Map();
        let prevTotalValid = 0;
        Object.entries(this.resultsByConstituency).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = parseFloat(info.Valid_Poll) || 0;
            const seatCount = parseInt(info.Number_Of_Seats, 10) || 0;
            totalValid += constValid;
            const byCandidate = new Map();
            const countNums = [...new Set(cg.map(r => parseInt(r.Count_Number, 10) || 1))].sort((a, b) => a - b);
            const lastCount = countNums[countNums.length - 1] || 1;
            cg.forEach(row => {
                const cid = String(row.Candidate_Id || '');
                if (!cid) return;
                const countNum = parseInt(row.Count_Number, 10) || 1;
                if (!byCandidate.has(cid)) {
                    byCandidate.set(cid, {
                        constituency: constName,
                        name: row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`.trim(),
                        party: row.Party_Name || 'Independent',
                        colour: row.Party_Colour || '#b0bec5',
                        votes: 0,
                        constPct: 0,
                        elected: false,
                        excluded: false
                    });
                }
                const cand = byCandidate.get(cid);
                if (countNum === 1) {
                    cand.votes = parseFloat(row.Total_Votes) || 0;
                    cand.constPct = constValid > 0 ? (cand.votes / constValid * 100) : 0;
                }
                if (this._statusKind(row.Status) === 'elected') cand.elected = true;
                if (this._statusKind(row.Status) === 'excluded') cand.excluded = true;
            });
            const explicitElected = [...byCandidate.values()].filter(c => c.elected).length;
            if (seatCount > 0 && explicitElected < seatCount) {
                const needed = seatCount - explicitElected;
                const deemable = [...byCandidate.entries()]
                    .filter(([, c]) => !c.elected && !c.excluded)
                    .map(([cid, c]) => {
                        let lastVotes = -1;
                        cg.forEach((row) => {
                            if (String(row.Candidate_Id || '') !== String(cid)) return;
                            const cn = parseInt(row.Count_Number, 10) || 1;
                            if (cn === lastCount) lastVotes = parseFloat(row.Total_Votes) || 0;
                        });
                        return { c, lastVotes };
                    })
                    .filter(x => x.lastVotes >= 0)
                    .sort((a, b) => b.lastVotes - a.lastVotes)
                    .slice(0, needed);
                deemable.forEach(({ c }) => { c.elected = true; });
            }
            byCandidate.forEach(cand => {
                cand.status = cand.elected ? 'Elected' : (cand.excluded ? 'Excluded' : 'Not Elected');
                rows.push(cand);
            });
        });
        Object.entries(this.previousResultsByConstituency || {}).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = parseFloat(info.Valid_Poll) || 0;
            prevTotalValid += constValid;
            const seen = new Set();
            cg.forEach(row => {
                const countNum = parseInt(row.Count_Number, 10) || 1;
                const cid = String(row.Candidate_Id || '');
                if (countNum !== 1 || seen.has(cid)) return;
                seen.add(cid);
                const name = row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`.trim();
                const party = row.Party_Name || 'Independent';
                const key = this._candidateKey(name, party);
                const prevVotes = parseFloat(row.Total_Votes) || 0;
                prevByCandidate.set(key, {
                    votes: prevVotes,
                    constPct: constValid > 0 ? (prevVotes / constValid * 100) : null
                });
            });
        });
        rows.sort((a, b) => b.votes - a.votes);
        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        let html = `<div class="election-count-wrapper"><table class="election-count-table"><thead><tr>
            <th>Rank</th>
            <th class="election-colour-col"></th>
            <th>Name</th>
            <th>Party</th>
            <th>Constituency</th>
            <th>Status</th>
            <th class="election-num">${this._thTwoLine('1st prefs', '+/-')}</th>
            <th class="election-num">${this._thTwoLine('1st prefs', '')}</th>
            <th class="election-num">${this._thTwoLine('1st prefs', '%')}</th>
            <th class="election-num">${this._thTwoLine('1st prefs %', '+/-')}</th>
            <th class="election-num">${this._thTwoLine('% of', 'NI')}</th>
            <th class="election-num">${this._thTwoLine('% of NI', '+/-')}</th>
        </tr></thead><tbody>`;
        const rankLabel = (idx) => {
            const n = idx + 1;
            if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
            if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
            if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
            return `${n}th`;
        };
        rows.forEach((row, idx) => {
            const niPct = totalValid > 0 ? (row.votes / totalValid * 100) : 0;
            const key = this._candidateKey(row.name, row.party);
            const prev = prevByCandidate.get(key);
            const prevVotes = prev?.votes;
            const votesDelta = typeof prevVotes === 'number' ? (row.votes - prevVotes) : null;
            const prevNiPct = (typeof prevVotes === 'number' && prevTotalValid > 0) ? (prevVotes / prevTotalValid * 100) : null;
            const niPctDelta = typeof prevNiPct === 'number' ? (niPct - prevNiPct) : null;
            const constPctDelta = typeof prev?.constPct === 'number' ? (row.constPct - prev.constPct) : null;
            html += `<tr>
                <td class="election-rank-col">${rankLabel(idx)}</td>
                <td class="election-colour-col"><span class="election-party-dot" style="background:${this._esc(row.colour)}"></span></td>
                <td><span class="election-cell-wrap">${this._esc(row.name)}</span></td>
                <td><span class="election-cell-wrap">${this._esc(row.party)}</span></td>
                <td><span class="election-cell-wrap">${this._esc(row.constituency)}</span></td>
                <td><span class="election-cell-wrap">${row.status === 'Elected' ? '<strong>Elected</strong>' : this._esc(row.status)}</span></td>
                <td class="election-num">${this._fmtMaybeDelta(votesDelta)}</td>
                <td class="election-num election-cell-strong">${fmt(row.votes)}</td>
                <td class="election-num">${row.constPct.toFixed(2)}%</td>
                <td class="election-num">${this._fmtMaybePctDeltaOrNA(constPctDelta)}</td>
                <td class="election-num">${niPct.toFixed(2)}%</td>
                <td class="election-num">${this._fmtMaybePctDelta(niPctDelta)}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    _buildNIWideLocalPartyTable() {
        const rows = [];
        let totalValid = 0;
        const prevByLocalParty = new Map();
        let prevTotalValid = 0;

        Object.entries(this.resultsByConstituency).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = parseFloat(info.Valid_Poll) || 0;
            totalValid += constValid;

            const byCandidate = new Map();
            cg.forEach(row => {
                const cid = String(row.Candidate_Id || '');
                if (!cid) return;
                const countNum = parseInt(row.Count_Number, 10) || 1;
                if (!byCandidate.has(cid)) {
                    byCandidate.set(cid, {
                        party: row.Party_Name || 'Independent',
                        colour: row.Party_Colour || '#b0bec5',
                        votes: 0,
                        elected: false,
                        excluded: false
                    });
                }
                const cand = byCandidate.get(cid);
                if (countNum === 1) {
                    cand.votes = parseFloat(row.Total_Votes) || 0;
                }
                if (this._statusKind(row.Status) === 'elected') cand.elected = true;
                if (this._statusKind(row.Status) === 'excluded') cand.excluded = true;
            });

            const seatCount = parseInt(info.Number_Of_Seats, 10) || 0;
            const explicitElected = [...byCandidate.values()].filter(c => c.elected).length;
            if (seatCount > 0 && explicitElected < seatCount) {
                const countNums = [...new Set(cg.map(r => parseInt(r.Count_Number, 10) || 1))].sort((a, b) => a - b);
                const lastCount = countNums[countNums.length - 1] || 1;
                const needed = seatCount - explicitElected;
                const deemable = [...byCandidate.entries()]
                    .filter(([, c]) => !c.elected && !c.excluded)
                    .map(([cid, c]) => {
                        let lastVotes = -1;
                        cg.forEach((row) => {
                            if (String(row.Candidate_Id || '') !== String(cid)) return;
                            const cn = parseInt(row.Count_Number, 10) || 1;
                            if (cn === lastCount) lastVotes = parseFloat(row.Total_Votes) || 0;
                        });
                        return { c, lastVotes };
                    })
                    .filter(x => x.lastVotes >= 0)
                    .sort((a, b) => b.lastVotes - a.lastVotes)
                    .slice(0, needed);
                deemable.forEach(({ c }) => { c.elected = true; });
            }

            const byLocalParty = new Map();
            byCandidate.forEach((cand) => {
                const party = cand.party || 'Independent';
                if (!byLocalParty.has(party)) {
                    byLocalParty.set(party, {
                        constituency: constName,
                        party,
                        colour: cand.colour || '#b0bec5',
                        votes: 0,
                        stood: 0,
                        elected: 0,
                        constPct: 0
                    });
                }
                const lp = byLocalParty.get(party);
                lp.votes += cand.votes || 0;
                lp.stood += 1;
                if (cand.elected) lp.elected += 1;
            });

            byLocalParty.forEach((lp) => {
                lp.constPct = constValid > 0 ? (lp.votes / constValid * 100) : 0;
                rows.push(lp);
            });
        });

        Object.entries(this.previousResultsByConstituency || {}).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = parseFloat(info.Valid_Poll) || 0;
            prevTotalValid += constValid;

            const constituencyElected = this._extractElected(payload);
            const electedByParty = new Map();
            constituencyElected.forEach((member) => {
                const party = member.party || 'Independent';
                electedByParty.set(party, (electedByParty.get(party) || 0) + 1);
            });

            const snapshot = new Map();
            const seenCandidates = new Set();
            cg.forEach(row => {
                const countNum = parseInt(row.Count_Number, 10) || 1;
                const cid = String(row.Candidate_Id || '');
                if (countNum !== 1 || !cid || seenCandidates.has(cid)) return;
                seenCandidates.add(cid);
                const party = row.Party_Name || 'Independent';
                if (!snapshot.has(party)) snapshot.set(party, { votes: 0, stood: 0 });
                const entry = snapshot.get(party);
                entry.votes += parseFloat(row.Total_Votes) || 0;
                entry.stood += 1;
            });
            snapshot.forEach((entry, party) => {
                const key = this._localPartyKey(constName, party);
                prevByLocalParty.set(key, {
                    votes: entry.votes,
                    stood: entry.stood,
                    elected: electedByParty.get(party) || 0,
                    constPct: constValid > 0 ? (entry.votes / constValid * 100) : null
                });
            });
        });

        rows.sort((a, b) => b.votes - a.votes);
        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        let html = `<div class="election-count-wrapper"><table class="election-count-table"><thead><tr>
            <th>Rank</th>
            <th class="election-colour-col"></th>
            <th>Party</th>
            <th>Constituency</th>
            <th>Stood</th>
            <th>Elected</th>
            <th class="election-num">${this._thTwoLine('1st prefs', '+/-')}</th>
            <th class="election-num">${this._thTwoLine('1st prefs', '')}</th>
            <th class="election-num">${this._thTwoLine('1st prefs', '%')}</th>
            <th class="election-num">${this._thTwoLine('1st prefs %', '+/-')}</th>
            <th class="election-num">${this._thTwoLine('% of', 'NI')}</th>
            <th class="election-num">${this._thTwoLine('% of NI', '+/-')}</th>
        </tr></thead><tbody>`;
        const rankLabel = (idx) => {
            const n = idx + 1;
            if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
            if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
            if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
            return `${n}th`;
        };
        rows.forEach((row, idx) => {
            const niPct = totalValid > 0 ? (row.votes / totalValid * 100) : 0;
            const key = this._localPartyKey(row.constituency, row.party);
            const prev = prevByLocalParty.get(key);
            const prevVotes = prev?.votes;
            const votesDelta = typeof prevVotes === 'number' ? (row.votes - prevVotes) : null;
            const prevNiPct = (typeof prevVotes === 'number' && prevTotalValid > 0) ? (prevVotes / prevTotalValid * 100) : null;
            const niPctDelta = typeof prevNiPct === 'number' ? (niPct - prevNiPct) : null;
            const constPctDelta = typeof prev?.constPct === 'number' ? (row.constPct - prev.constPct) : null;
            html += `<tr>
                <td class="election-rank-col">${rankLabel(idx)}</td>
                <td class="election-colour-col"><span class="election-party-dot" style="background:${this._esc(row.colour)}"></span></td>
                <td><span class="election-cell-wrap">${this._esc(row.party)}</span></td>
                <td><span class="election-cell-wrap">${this._esc(row.constituency)}</span></td>
                <td class="election-num"><span class="election-cell-wrap">${row.stood}</span></td>
                <td class="election-num"><span class="election-cell-wrap"><strong>${row.elected}</strong></span></td>
                <td class="election-num">${this._fmtMaybeDelta(votesDelta)}</td>
                <td class="election-num election-cell-strong">${fmt(row.votes)}</td>
                <td class="election-num">${row.constPct.toFixed(2)}%</td>
                <td class="election-num">${this._fmtMaybePctDeltaOrNA(constPctDelta)}</td>
                <td class="election-num">${niPct.toFixed(2)}%</td>
                <td class="election-num">${this._fmtMaybePctDelta(niPctDelta)}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    _localPartyKey(constituency, party) {
        return `${String(constituency || '').trim().toLowerCase()}::${String(party || '').trim().toLowerCase()}`;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Constituency Click Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    _onConstituencyClick(fgbName) {
        const constName = this._matchConstituency(fgbName);
        if (!constName) return;

        this.selectedConstituency = constName;
        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        if (!content) return;

        const payload = this.resultsByConstituency[constName];
        if (!payload) {
            content.innerHTML = `<div class="election-no-data">No results available for ${this._esc(constName)}</div>`;
            return;
        }

        // Hide animation if it was showing
        this._hideAnimation();

        // Detach animation scaffold before resetting innerHTML (persistent ref)
        if (this._animScaffold && this._animScaffold.parentNode) {
            this._animScaffold.parentNode.removeChild(this._animScaffold);
        }

        // Check if animation is available
        const hasMultipleRounds = payload?.Constituency?.countGroup?.some(r => parseInt(r.Count_Number) > 1);
        const hasAnimation = hasMultipleRounds && typeof animateStages === 'function';

        // Build layout: view content only (tabs go in header)
        content.innerHTML = '';
        content.style.display = 'flex';
        content.style.flexDirection = 'column';

        // --- Inject back button + tabs into the header bar ---
        const headerRight = document.getElementById('electionPaneHeaderRight');
        const titleEl = document.getElementById('electionPaneTitle');
        let initialTab = 'party';
        if (headerRight && titleEl) {
            const prevActiveTab = this._constituencyActiveTab
                || headerRight.querySelector('.election-view-tab--active')?.dataset.tab
                || 'party';
            // Update title to show constituency name
            titleEl.textContent = constName;

            // Clear existing tabs, keep close button
            const closeBtn = headerRight.querySelector('#electionCloseBtn');
            headerRight.innerHTML = '';

            // Back button (icon only)
            const backBtn = document.createElement('button');
            backBtn.className = 'election-pane__back';
            backBtn.innerHTML = "<";
            backBtn.title = 'Back to summary';
            backBtn.addEventListener('click', () => {
                this.selectedConstituency = null;
                this._hideAnimation();
                content.style.display = '';
                content.style.flexDirection = '';
                // Restore header
                titleEl.textContent = `${this._shortBodyName(this.body)} - ${this._formatDate(this.date)}`;
                this._restoreHeaderTabs();
                this._showNIWideResults();
                if (this.onStateChange) this.onStateChange();
            });
            headerRight.appendChild(backBtn);

            // Tab buttons
            const tabDefs = [
                { id: 'party', label: 'By Party' },
                { id: 'counts', label: 'By Count' },
            ];
            if (hasAnimation) {
                tabDefs.push({ id: 'animation', label: 'Transfers' });
            }

            // Preserve currently selected constituency tab when moving between constituencies.
            initialTab = tabDefs.some(t => t.id === prevActiveTab) ? prevActiveTab : 'party';

            tabDefs.forEach((def) => {
                const btn = document.createElement('button');
                btn.className = 'election-view-tab' + (def.id === initialTab ? ' election-view-tab--active' : '');
                btn.dataset.tab = def.id;
                btn.textContent = def.label;
                btn.addEventListener('click', () => {
                    headerRight.querySelectorAll('.election-view-tab').forEach(b => b.classList.remove('election-view-tab--active'));
                    btn.classList.add('election-view-tab--active');
                    this._constituencyActiveTab = def.id;
                    this._renderConstituencyView(def.id, constName, payload, content);
                });
                headerRight.appendChild(btn);
                if (def.id === 'counts') {
                    const detailBtn = document.createElement('button');
                    detailBtn.type = 'button';
                    detailBtn.className = 'election-detail-toggle-btn election-detail-toggle-btn--header';
                    detailBtn.dataset.role = 'detail-toggle';
                    detailBtn.textContent = this._countDetailedView ? 'Detailed View: On' : 'Detailed View: Off';
                    detailBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        this._countDetailedView = !this._countDetailedView;
                        detailBtn.textContent = this._countDetailedView ? 'Detailed View: On' : 'Detailed View: Off';
                        if (this._constituencyActiveTab === 'counts') {
                            this._renderConstituencyView('counts', constName, payload, content);
                        }
                    });
                    headerRight.appendChild(detailBtn);
                }
            });

            // Re-add close button at the end
            if (closeBtn) headerRight.appendChild(closeBtn);
        }

        // Re-attach animation container (hidden)
        if (this._animScaffold) {
            this._animScaffold.style.display = 'none';
            content.appendChild(this._animScaffold);
        }

        // Render selected tab (or default to party).
        this._constituencyActiveTab = initialTab;
        this._renderConstituencyView(initialTab, constName, payload, content);

        if (this.onStateChange) this.onStateChange();
    }

    _renderConstituencyView(tabId, constName, payload, container) {
        // Always hide animation first when switching away
        if (tabId !== 'animation') {
            this._hideAnimation();
        }

        // Allow scrolling on content pane for non-animation tabs; lock for animation
        container.style.overflowY = tabId === 'animation' ? 'hidden' : 'auto';
        // Keep a small gutter so the animation panel border remains fully visible.
        container.style.padding = tabId === 'animation' ? '4px' : '';

        // Detach animation scaffold before clearing innerHTML (persistent ref)
        if (this._animScaffold && this._animScaffold.parentNode) {
            this._animScaffold.parentNode.removeChild(this._animScaffold);
        }

        switch (tabId) {
            case 'party':
                container.innerHTML = this._buildPartyResults(constName, payload);
                this._setupResultsTableControls(container);
                break;
            case 'counts':
                container.innerHTML = this._buildCountTable(constName, payload);
                this._setupResultsTableControls(container);
                break;
            case 'animation':
                container.innerHTML = '';
                // Re-attach animation scaffold from persistent ref
                if (this._animScaffold) {
                    container.appendChild(this._animScaffold);
                }
                this._showAnimation(constName, payload);
                break;
        }
    }

    _buildPartyResults(constName, payload) {
        const cg = payload.Constituency.countGroup;
        const info = payload.Constituency.countInfo;
        const validPoll = parseFloat(info.Valid_Poll) || 0;
        const totalPoll = parseFloat(info.Total_Poll) || 0;
        const electorate = parseFloat(info.Total_Electorate) || 0;
        const spoiled = parseFloat(info.Spoiled) || 0;
        const didNotVote = Math.max(0, electorate - totalPoll);
        const prevPayload = this._getPreviousConstituencyPayload(constName);
        const prevInfo = prevPayload?.Constituency?.countInfo || {};
        const hasPrevSummary = !!prevPayload?.Constituency?.countInfo;
        const prevValidPoll = hasPrevSummary ? (parseFloat(prevInfo.Valid_Poll) || 0) : NaN;
        const prevTotalPoll = hasPrevSummary ? (parseFloat(prevInfo.Total_Poll) || 0) : NaN;
        const prevElectorate = hasPrevSummary ? (parseFloat(prevInfo.Total_Electorate) || 0) : NaN;
        const prevSpoiled = hasPrevSummary ? (parseFloat(prevInfo.Spoiled) || 0) : NaN;
        const prevDidNotVote = hasPrevSummary ? Math.max(0, prevElectorate - prevTotalPoll) : NaN;

        const partyMap = {};
        const seenCandidates = new Set();
        const candidateFinalById = {};
        const candidateMetaById = {};
        const electedSet = new Set();

        cg.forEach(row => {
            const party = row.Party_Name || 'Independent';
            const cid = row.Candidate_Id;
            const total = parseFloat(row.Total_Votes) || 0;
            const countNum = parseInt(row.Count_Number, 10) || 1;

            if (!partyMap[party]) {
                partyMap[party] = {
                    firstPrefs: 0,
                    stood: 0,
                    seats: 0,
                    finalVotes: 0,
                    colour: row.Party_Colour || '#b0bec5'
                };
            }

            if (!candidateMetaById[cid]) {
                candidateMetaById[cid] = { party, excluded: false };
            }

            if (countNum === 1 && !seenCandidates.has(cid)) {
                seenCandidates.add(cid);
                partyMap[party].firstPrefs += total;
                partyMap[party].stood += 1;
            }

            if (!candidateFinalById[cid] || total > candidateFinalById[cid].votes) {
                candidateFinalById[cid] = { party, votes: total };
            }

            if (this._statusKind(row.Status) === 'excluded') {
                candidateMetaById[cid].excluded = true;
            }

            if (this._statusKind(row.Status) === 'elected' && !electedSet.has(cid)) {
                electedSet.add(cid);
                partyMap[party].seats += 1;
            }
        });

        const seatCount = parseInt(info.Number_Of_Seats, 10) || 0;
        if (seatCount > 0 && electedSet.size < seatCount) {
            const needed = seatCount - electedSet.size;
            const deemable = Object.entries(candidateFinalById)
                .filter(([cid]) => !electedSet.has(cid) && !candidateMetaById[cid]?.excluded)
                .sort((a, b) => (b[1].votes || 0) - (a[1].votes || 0))
                .slice(0, needed);

            deemable.forEach(([cid, data]) => {
                electedSet.add(cid);
                if (partyMap[data.party]) partyMap[data.party].seats += 1;
            });
        }

        Object.values(candidateFinalById).forEach(({ party, votes }) => {
            if (partyMap[party]) partyMap[party].finalVotes += votes;
        });

        const prevPartyFirstPrefs = this._getPreviousFirstPrefsByParty(constName);
        const prevPartyStats = this._getPreviousPartyStats(constName);
        const parties = Object.entries(partyMap).map(([name, data]) => {
            const prevFirstPrefs = prevPartyFirstPrefs.get(name) || 0;
            const prevStats = prevPartyStats.get(name) || { stood: 0, seats: 0, firstPrefs: 0 };
            const voteDelta = data.firstPrefs - prevFirstPrefs;
            const pct = validPoll > 0 ? (data.firstPrefs / validPoll * 100) : 0;
            const prevPct = prevValidPoll > 0 ? (prevFirstPrefs / prevValidPoll * 100) : 0;
            const pctDelta = pct - prevPct;
            const stoodDelta = data.stood - prevStats.stood;
            const electedDelta = data.seats - prevStats.seats;
            return { name, ...data, voteDelta, pct, pctDelta, stoodDelta, electedDelta };
        }).sort((a, b) => {
            if (b.seats !== a.seats) return b.seats - a.seats;
            if (b.firstPrefs !== a.firstPrefs) return b.firstPrefs - a.firstPrefs;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });

        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        const fmtDelta = (n) => {
            const r = Math.round(n);
            const s = r > 0 ? `+${r.toLocaleString('en-GB')}` : r.toLocaleString('en-GB');
            const cls = r > 0 ? 'election-delta election-delta--pos' : r < 0 ? 'election-delta election-delta--neg' : 'election-delta';
            return `<span class="${cls}">${s}</span>`;
        };
        const fmtPctDelta = (n) => {
            const s = n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
            const cls = n > 0 ? 'election-delta election-delta--pos' : n < 0 ? 'election-delta election-delta--neg' : 'election-delta';
            return `<span class="${cls}">${s}</span>`;
        };
        const rankLabel = (idx) => {
            const n = idx + 1;
            if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
            if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
            if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
            return `${n}th`;
        };

        const turnoutPct = electorate > 0 ? (totalPoll / electorate * 100) : 0;
        const validPct = electorate > 0 ? (validPoll / electorate * 100) : 0;
        const spoiledPct = electorate > 0 ? (spoiled / electorate * 100) : 0;
        const didNotVotePct = electorate > 0 ? (didNotVote / electorate * 100) : 0;
        const totalStood = parties.reduce((acc, p) => acc + p.stood, 0);
        const totalElected = parties.reduce((acc, p) => acc + p.seats, 0);
        const maxSeats = Math.max(0, ...parties.map(p => p.seats || 0));
        const maxFirstPrefs = Math.max(0, ...parties.map(p => p.firstPrefs || 0));

        let html = `<div class="election-constituency-results">`;
        html += `<div class="election-party-wrapper">`;
        html += `<table class="election-party-table"><thead><tr>
            <th data-sort-key="rank">Rank</th>
            <th class="election-colour-col"></th>
            <th data-sort-key="party">Party</th>
            <th class="election-num" data-sort-key="stood">Stood</th>
            <th class="election-num" data-sort-key="stoodDelta">+/-</th>
            <th class="election-num" data-sort-key="elected">Elected</th>
            <th class="election-num" data-sort-key="electedDelta">+/-</th>
            <th class="election-num" data-sort-key="firstPrefs">1st prefs</th>
            <th class="election-num" data-sort-key="firstPrefsDelta">+/-</th>
            <th class="election-num" data-sort-key="firstPrefsPct">1st prefs %</th>
            <th class="election-num" data-sort-key="firstPrefsPctDelta">+/-</th>
        </tr></thead><tbody>`;

        parties.forEach((p, idx) => {
            const isSeatWinner = p.seats === maxSeats && maxSeats > 0;
            const isFirstPrefWinner = p.firstPrefs === maxFirstPrefs && maxFirstPrefs > 0;
            html += `<tr class="election-party-row"
                    data-rank="${idx + 1}"
                    data-party="${this._esc(p.name)}"
                    data-stood="${p.stood}"
                    data-stooddelta="${p.stoodDelta}"
                    data-elected="${p.seats}"
                    data-electeddelta="${p.electedDelta}"
                    data-firstprefs="${p.firstPrefs}"
                    data-firstprefsdelta="${p.voteDelta}"
                    data-firstprefspct="${p.pct}"
                    data-firstprefspctdelta="${p.pctDelta}">
                <td class="election-rank-col${isSeatWinner ? ' election-party-emphasis' : ''}">${rankLabel(idx)}</td>
                <td class="election-colour-col"><span class="election-party-dot" style="background:${this._esc(p.colour)}"></span></td>
                <td class="election-cell-wrap${isSeatWinner ? ' election-party-emphasis' : ''}">${this._esc(p.name)}</td>
                <td class="election-num">${p.stood}</td>
                <td class="election-num">${fmtDelta(p.stoodDelta)}</td>
                <td class="election-num${isSeatWinner ? ' election-party-emphasis' : ''}">${p.seats}</td>
                <td class="election-num">${fmtDelta(p.electedDelta)}</td>
                <td class="election-num${isFirstPrefWinner ? ' election-party-emphasis' : ''}">${fmt(p.firstPrefs)}</td>
                <td class="election-num">${fmtDelta(p.voteDelta)}</td>
                <td class="election-num${isFirstPrefWinner ? ' election-party-emphasis' : ''}">${p.pct.toFixed(2)}%</td>
                <td class="election-num">${fmtPctDelta(p.pctDelta)}</td>
            </tr>`;
        });

        const validDelta = validPoll - prevValidPoll;
        const turnoutDelta = totalPoll - prevTotalPoll;
        const spoiledDelta = spoiled - prevSpoiled;
        const didNotVoteDelta = didNotVote - prevDidNotVote;
        const electorateDelta = electorate - prevElectorate;
        const prevTurnoutPct = prevElectorate > 0 ? (prevTotalPoll / prevElectorate * 100) : 0;
        const prevValidPct = prevElectorate > 0 ? (prevValidPoll / prevElectorate * 100) : 0;
        const prevSpoiledPct = prevElectorate > 0 ? (prevSpoiled / prevElectorate * 100) : 0;
        const prevDidNotVotePct = prevElectorate > 0 ? (prevDidNotVote / prevElectorate * 100) : 0;

        html += `<tr class="election-table-note-row"><td class="election-rank-col">-</td><td></td><td colspan="9"><strong>No change in party control</strong></td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Valid votes</strong></td><td class="election-num">${totalStood}</td><td class="election-num">${fmtDelta(0)}</td><td class="election-num">${totalElected}</td><td class="election-num">${fmtDelta(0)}</td><td class="election-num election-cell-strong">${fmt(validPoll)}</td><td class="election-num">${fmtDelta(validDelta)}</td><td class="election-num election-cell-strong">${validPct.toFixed(2)}%</td><td class="election-num">${fmtPctDelta(validPct - prevValidPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Turnout</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(totalPoll)}</td><td class="election-num">${fmtDelta(turnoutDelta)}</td><td class="election-num election-cell-strong">${turnoutPct.toFixed(2)}%</td><td class="election-num">${fmtPctDelta(turnoutPct - prevTurnoutPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Spoiled</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(spoiled)}</td><td class="election-num">${fmtDelta(spoiledDelta)}</td><td class="election-num election-cell-strong">${spoiledPct.toFixed(2)}%</td><td class="election-num">${fmtPctDelta(spoiledPct - prevSpoiledPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Did not vote</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(didNotVote)}</td><td class="election-num">${fmtDelta(didNotVoteDelta)}</td><td class="election-num election-cell-strong">${didNotVotePct.toFixed(2)}%</td><td class="election-num">${fmtPctDelta(didNotVotePct - prevDidNotVotePct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>Electorate</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(electorate)}</td><td class="election-num">${fmtDelta(electorateDelta)}</td><td class="election-num election-cell-strong">100.00%</td><td class="election-num">${fmtPctDelta(0)}</td></tr>`;
        html += `</tbody></table></div></div>`;
        return html;
    }

    _setupPartyTableSorting(container) {
        this._setupResultsTableControls(container);
    }

    _setupResultsTableControls(container) {
        const tables = [...(container?.querySelectorAll?.('.election-party-table, .election-count-table') || [])];
        tables.forEach((table) => this._setupSingleResultsTableControls(table));
    }

    _setupSingleResultsTableControls(table) {
        if (!table || table.dataset.tableControlsReady === '1') return;
        const tbody = table.querySelector('tbody');
        const headers = [...table.querySelectorAll('thead th')];
        if (!tbody || headers.length === 0) return;

        table.dataset.tableControlsReady = '1';

        const sortState = { col: null, dir: 'default' };
        const filterState = new Map(); // col index -> Set of allowed raw values
        const originalRows = [...tbody.querySelectorAll('tr')].map((row, idx) => ({ row, idx }));
        const sortableRows = originalRows.filter(({ row }) => {
            return !row.classList.contains('election-table-summary-row') && !row.classList.contains('election-table-note-row');
        });
        const fixedRows = originalRows.filter(({ row }) => !sortableRows.some((x) => x.row === row));
        let activeMenu = null;
        let activeMenuBtn = null;

        const parseMaybeNumber = (text) => {
            const cleaned = String(text || '')
                .replace(/,/g, '')
                .replace(/%/g, '')
                .replace(/[+\u2212]/g, (m) => (m === '\u2212' ? '-' : '+'))
                .trim();
            if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned.toLowerCase() === 'n/a') return null;
            const n = Number(cleaned);
            return Number.isFinite(n) ? n : null;
        };
        const parseMaybeOrdinal = (text) => {
            const cleaned = String(text || '').trim().toLowerCase();
            if (!cleaned) return null;
            const rank = cleaned.match(/^(\d+)(st|nd|rd|th)?$/);
            if (rank) return Number(rank[1]);
            const count = cleaned.match(/count\s+(\d+)/);
            if (count) return Number(count[1]);
            return null;
        };
        const getCellText = (row, colIdx) => {
            const cell = row.children[colIdx];
            return cell ? cell.textContent.trim() : '';
        };
        const inferColumnKind = (colIdx, th) => {
            const sample = sortableRows.slice(0, 40).map(({ row }) => getCellText(row, colIdx)).filter(Boolean);
            const numHits = sample.filter((v) => parseMaybeNumber(v) !== null).length;
            const ordHits = sample.filter((v) => parseMaybeOrdinal(v) !== null).length;
            const headerText = (th?.textContent || '').trim().toLowerCase();
            if (headerText.includes('rank')) return 'ordinal';
            if (sample.length > 0 && numHits / sample.length >= 0.8) return 'numeric';
            if (sample.length > 0 && ordHits / sample.length >= 0.8) return 'ordinal';
            return 'text';
        };
        const compareRows = (a, b, colIdx, dir, kind) => {
            if (dir === 'default') return a.idx - b.idx;
            const av = getCellText(a.row, colIdx);
            const bv = getCellText(b.row, colIdx);
            let cmp = 0;
            if (kind === 'numeric') {
                const an = parseMaybeNumber(av);
                const bn = parseMaybeNumber(bv);
                if (an !== null && bn !== null) cmp = an - bn;
                else if (an !== null) cmp = 1;
                else if (bn !== null) cmp = -1;
                else cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
            } else if (kind === 'ordinal') {
                const ao = parseMaybeOrdinal(av);
                const bo = parseMaybeOrdinal(bv);
                if (ao !== null && bo !== null) cmp = ao - bo;
                else cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
            } else {
                cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
            }
            return dir === 'asc' ? cmp : -cmp;
        };
        const closeMenu = () => {
            if (activeMenu) activeMenu.remove();
            if (activeMenuBtn) activeMenuBtn.classList.remove('election-th-btn--open');
            activeMenu = null;
            activeMenuBtn = null;
        };
        const getUniqueValues = (colIdx) => {
            const values = new Map();
            sortableRows.forEach(({ row }) => {
                const raw = getCellText(row, colIdx);
                if (!values.has(raw)) values.set(raw, raw);
            });
            return [...values.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        };
        const applyState = () => {
            let visible = sortableRows.filter(({ row }) => {
                for (const [colIdx, selected] of filterState.entries()) {
                    if (!(selected instanceof Set) || selected.size === 0) continue;
                    const v = getCellText(row, colIdx);
                    if (!selected.has(v)) return false;
                }
                return true;
            });
            const colIdx = sortState.col ?? 0;
            const kind = inferColumnKind(colIdx, headers[colIdx]);
            visible = [...visible].sort((a, b) => compareRows(a, b, colIdx, sortState.dir, kind));
            tbody.innerHTML = '';
            visible.forEach(({ row }) => tbody.appendChild(row));
            fixedRows.forEach(({ row }) => tbody.appendChild(row));

            headers.forEach((th, idx) => {
                const btn = th.querySelector('[data-table-filter-sort-btn]');
                if (!btn) return;
                const filtered = filterState.has(idx) && (filterState.get(idx)?.size ?? 0) > 0;
                const sorted = sortState.col === idx && sortState.dir !== 'default';
                btn.classList.toggle('election-th-btn--active', filtered || sorted);
                if (sorted && sortState.dir === 'asc') btn.innerHTML = '&#8593;';
                else if (sorted && sortState.dir === 'desc') btn.innerHTML = '&#8595;';
                else btn.innerHTML = '&#8645;';
            });
        };

        const openMenuForColumn = (idx, anchorBtn) => {
            closeMenu();
            const th = headers[idx];
            const kind = inferColumnKind(idx, th);
            const options = getUniqueValues(idx);
            const current = filterState.get(idx);
            const selected = new Set(current instanceof Set ? current : options);

            const sortAscLabel = kind === 'numeric'
                ? 'Sort Smallest to Largest'
                : (kind === 'ordinal' ? 'Sort Lowest to Highest' : 'Sort A to Z');
            const sortDescLabel = kind === 'numeric'
                ? 'Sort Largest to Smallest'
                : (kind === 'ordinal' ? 'Sort Highest to Lowest' : 'Sort Z to A');

            const menu = document.createElement('div');
            menu.className = 'election-filter-menu';
            menu.innerHTML = `
                <button type="button" class="election-filter-menu__action" data-action="sort-asc">${sortAscLabel}</button>
                <button type="button" class="election-filter-menu__action" data-action="sort-desc">${sortDescLabel}</button>
                <button type="button" class="election-filter-menu__action" data-action="reset-sort">Reset Sort</button>
                <div class="election-filter-menu__divider"></div>
                <input type="search" class="election-filter-menu__search" placeholder="Search values..." aria-label="Search values">
                <div class="election-filter-menu__row">
                    <button type="button" class="election-filter-menu__mini" data-action="select-all">Select All</button>
                    <button type="button" class="election-filter-menu__mini" data-action="deselect-all">Deselect All</button>
                </div>
                <div class="election-filter-menu__values" data-role="values"></div>
                <div class="election-filter-menu__row election-filter-menu__row--footer">
                    <button type="button" class="election-filter-menu__mini" data-action="clear-filter">Clear Filter</button>
                    <button type="button" class="election-filter-menu__mini election-filter-menu__mini--primary" data-action="apply">Apply</button>
                </div>
            `;
            document.body.appendChild(menu);
            activeMenu = menu;
            activeMenuBtn = anchorBtn;
            anchorBtn.classList.add('election-th-btn--open');

            const rect = anchorBtn.getBoundingClientRect();
            menu.style.left = `${Math.max(8, rect.right - 248)}px`;
            menu.style.top = `${rect.bottom + 4}px`;

            const valuesHost = menu.querySelector('[data-role="values"]');
            const renderValues = (needle = '') => {
                const q = needle.trim().toLowerCase();
                valuesHost.innerHTML = '';
                options
                    .filter((v) => !q || v.toLowerCase().includes(q))
                    .forEach((raw) => {
                        const item = document.createElement('label');
                        item.className = 'election-filter-menu__value';
                        item.innerHTML = `<input type="checkbox" value="${this._esc(raw)}" ${selected.has(raw) ? 'checked' : ''}><span>${this._esc(raw || '(Blank)')}</span>`;
                        const cb = item.querySelector('input');
                        cb.addEventListener('change', () => {
                            if (cb.checked) selected.add(raw);
                            else selected.delete(raw);
                        });
                        valuesHost.appendChild(item);
                    });
            };
            renderValues();

            const search = menu.querySelector('.election-filter-menu__search');
            search?.addEventListener('input', () => renderValues(search.value || ''));

            menu.addEventListener('click', (event) => {
                const btn = event.target.closest('button[data-action]');
                if (!btn) return;
                const action = btn.dataset.action;
                if (action === 'sort-asc') {
                    sortState.col = idx;
                    sortState.dir = 'asc';
                    applyState();
                    closeMenu();
                } else if (action === 'sort-desc') {
                    sortState.col = idx;
                    sortState.dir = 'desc';
                    applyState();
                    closeMenu();
                } else if (action === 'reset-sort') {
                    sortState.col = null;
                    sortState.dir = 'default';
                    applyState();
                    closeMenu();
                } else if (action === 'select-all') {
                    options.forEach((v) => selected.add(v));
                    renderValues(search?.value || '');
                } else if (action === 'deselect-all') {
                    selected.clear();
                    renderValues(search?.value || '');
                } else if (action === 'clear-filter') {
                    filterState.delete(idx);
                    applyState();
                    closeMenu();
                } else if (action === 'apply') {
                    if (selected.size === 0 || selected.size === options.length) filterState.delete(idx);
                    else filterState.set(idx, new Set(selected));
                    applyState();
                    closeMenu();
                }
            });
        };

        const handleDocumentClick = (event) => {
            if (!activeMenu) return;
            if (activeMenu.contains(event.target)) return;
            if (activeMenuBtn && activeMenuBtn.contains(event.target)) return;
            closeMenu();
        };
        document.addEventListener('click', handleDocumentClick);

        headers.forEach((th, idx) => {
            const label = th.innerHTML;
            th.innerHTML = '';
            const wrap = document.createElement('div');
            wrap.className = 'election-th-controls';
            const labelSpan = document.createElement('span');
            labelSpan.className = 'election-th-label';
            labelSpan.innerHTML = label;
            wrap.appendChild(labelSpan);

            if (!th.classList.contains('election-colour-col')) {
                const actions = document.createElement('span');
                actions.className = 'election-th-actions';
                const menuBtn = document.createElement('button');
                menuBtn.type = 'button';
                menuBtn.className = 'election-th-btn';
                menuBtn.setAttribute('data-table-filter-sort-btn', '1');
                menuBtn.setAttribute('aria-label', 'Sort and Filter');
                menuBtn.setAttribute('title', 'Sort and Filter');
                menuBtn.innerHTML = '&#8645;';
                menuBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (activeMenu && activeMenuBtn === menuBtn) closeMenu();
                    else openMenuForColumn(idx, menuBtn);
                });
                actions.appendChild(menuBtn);
                wrap.appendChild(actions);
            }

            th.appendChild(wrap);
        });

        applyState();
    }

    _buildCountTable(constName, payload) {
        const cg = payload.Constituency.countGroup;
        const info = payload.Constituency.countInfo;
        const countNums = [...new Set(cg.map(r => parseInt(r.Count_Number, 10)))].sort((a, b) => a - b);
        const visibleCounts = countNums.filter(n => n > 1);
        const totalCountCount = countNums.length;
        const numSeats = parseInt(info.Number_Of_Seats, 10) || 0;
        const lastCount = countNums[countNums.length - 1] || 1;

        const candidates = {};
        cg.forEach(row => {
            const id = row.Candidate_Id;
            if (!candidates[id]) {
                candidates[id] = {
                    personId: row.id || id,
                    name: row.candidateName || (row.Firstname + ' ' + row.Surname),
                    party: row.Party_Name || 'Independent',
                    colour: row.Party_Colour || '#b0bec5',
                    counts: {},
                    finalVotes: 0,
                    firstPref: 0,
                    electedAt: null,
                    excludedAt: null
                };
            }
            const countNum = parseInt(row.Count_Number, 10) || 1;
            const total = parseFloat(row.Total_Votes) || 0;
            candidates[id].counts[countNum] = {
                total,
                transfers: parseFloat(row.Transfers) || 0,
                status: row.Status || ''
            };
            if (countNum === 1) {
                candidates[id].firstPref = parseFloat(row.Candidate_First_Pref_Votes || row.Total_Votes) || 0;
            }
            if (this._statusKind(row.Status) === 'elected' && !candidates[id].electedAt) candidates[id].electedAt = countNum;
            if (this._statusKind(row.Status) === 'excluded' && !candidates[id].excludedAt) candidates[id].excludedAt = countNum;
            if (total > candidates[id].finalVotes) candidates[id].finalVotes = total;
        });

        // Some datasets do not explicitly mark all final-seat candidates as "Elected".
        // If explicit elected count is below seat count, deem the remaining final active
        // candidates elected at the last count by final-round vote order.
        const explicitElected = Object.entries(candidates).filter(([, c]) => !!c.electedAt).length;
        if (numSeats > 0 && explicitElected < numSeats) {
            const needed = numSeats - explicitElected;
            const deemable = Object.entries(candidates)
                .filter(([, c]) => !c.electedAt && !c.excludedAt)
                .map(([id, c]) => ({
                    id,
                    c,
                    lastVotes: c.counts[lastCount]?.total ?? -1
                }))
                .filter(x => x.lastVotes >= 0)
                .sort((a, b) => b.lastVotes - a.lastVotes)
                .slice(0, needed);
            deemable.forEach(({ c }) => {
                c.electedAt = lastCount;
            });
        }

        const sortedCandidates = Object.entries(candidates).sort((a, b) => {
            if (a[1].electedAt && !b[1].electedAt) return -1;
            if (!a[1].electedAt && b[1].electedAt) return 1;
            if (a[1].electedAt && b[1].electedAt) return a[1].electedAt - b[1].electedAt;
            return b[1].finalVotes - a[1].finalVotes;
        });

        const validPoll = parseFloat(info.Valid_Poll) || 0;
        const totalPoll = parseFloat(info.Total_Poll) || 0;
        const electorate = parseFloat(info.Total_Electorate) || 0;
        const spoiled = parseFloat(info.Spoiled) || 0;
        const didNotVote = Math.max(0, electorate - totalPoll);

        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        const fmtDelta = (n) => {
            const r = Math.round(n);
            const s = r > 0 ? `+${r.toLocaleString('en-GB')}` : r.toLocaleString('en-GB');
            const cls = r > 0 ? 'election-delta election-delta--pos' : r < 0 ? 'election-delta election-delta--neg' : 'election-delta';
            return `<span class="${cls}">${s}</span>`;
        };
        const rankLabel = (idx) => {
            const n = idx + 1;
            if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
            if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
            if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
            return `${n}th`;
        };
        const rowStatus = (c) => {
            if (c.electedAt) return `Elected<br>Count ${c.electedAt}/${totalCountCount}`;
            if (c.excludedAt) return `Excluded<br>Count ${c.excludedAt}/${totalCountCount}`;
            return `Not Elected<br>Count ${lastCount}/${totalCountCount}`;
        };
        const prevFirstPrefs = this._getPreviousFirstPrefsByCandidate(constName);
        const prevPayload = this._getPreviousConstituencyPayload(constName);
        const prevInfo = prevPayload?.Constituency?.countInfo || {};
        const prevValidPoll = parseFloat(prevInfo.Valid_Poll) || 0;
        const prevTotalPoll = parseFloat(prevInfo.Total_Poll) || 0;
        const prevElectorate = parseFloat(prevInfo.Total_Electorate) || 0;
        const prevSpoiled = parseFloat(prevInfo.Spoiled) || 0;
        const prevDidNotVote = Math.max(0, prevElectorate - prevTotalPoll);
        const pct = (v) => validPoll > 0 ? (v / validPoll * 100) : 0;
        const pctOfTurnout = (v) => totalPoll > 0 ? (v / totalPoll * 100) : 0;
        const pctOfElectorate = (v) => electorate > 0 ? (v / electorate * 100) : 0;
        const prevPctOfTurnout = (v) => Number.isFinite(prevTotalPoll) && prevTotalPoll > 0 ? (v / prevTotalPoll * 100) : NaN;
        const prevPctOfElectorate = (v) => Number.isFinite(prevElectorate) && prevElectorate > 0 ? (v / prevElectorate * 100) : NaN;

        let html = `<div class="election-constituency-results">`;
        html += `<div class="election-count-wrapper">`;
        html += `<table class="election-count-table"><thead><tr>`;
        html += `<th>Rank</th>`;
        html += `<th class="election-colour-col"></th>`;
        html += `<th class="election-col-name">Name</th>`;
        html += `<th class="election-col-party">Party</th>`;
        html += `<th class="election-col-status">Status</th>`;
        html += `<th class="election-num">${this._thTwoLine('1st', 'pref ±')}</th>`;
        html += `<th class="election-num">${this._thTwoLine('1st', 'pref %')}</th>`;
        if (this._countDetailedView) {
            html += `<th class="election-num">${this._thTwoLine('1st', 'pref ± %')}</th>`;
        }
        html += `<th class="election-num">${this._thTwoLine('1st', 'pref')}</th>`;
        visibleCounts.forEach(n => {
            html += `<th class="election-num">${this._thTwoLine('Count', String(n))}</th>`;
            if (this._countDetailedView) {
                html += `<th class="election-num">${this._thTwoLine(`Count ${n}`, '%')}</th>`;
                html += `<th class="election-num">${this._thTwoLine(`Count ${n}`, '± %')}</th>`;
                html += `<th class="election-num">${this._thTwoLine(`Count ${n}`, '±')}</th>`;
            }
        });
        html += `</tr></thead><tbody>`;

        sortedCandidates.forEach(([id, c], idx) => {
            const key = this._candidateKey(c.name, c.party);
            const hasPrev = prevFirstPrefs.has(key);
            const prevFirst = hasPrev ? (prevFirstPrefs.get(key) || 0) : 0;
            const firstPrefDelta = hasPrev ? (c.firstPref - prevFirst) : null;
            const prevFirstPct = hasPrev && prevValidPoll > 0 ? (prevFirst / prevValidPoll * 100) : null;
            const firstPrefPctDelta = hasPrev && typeof prevFirstPct === 'number' ? (pct(c.firstPref) - prevFirstPct) : null;
            html += `<tr class="election-count-row${c.electedAt ? ' election-count-row--elected' : ''}">`;
            html += `<td class="election-rank-col">${rankLabel(idx)}</td>`;
            html += `<td class="election-colour-col"><span class="election-party-dot" style="background:${this._esc(c.colour)}"></span></td>`;
            html += `<td class="election-col-name"><span class="election-cell-wrap election-cell-wrap--count-name">${this._esc(c.name)}</span></td>`;
            html += `<td class="election-col-party"><span class="election-cell-wrap election-cell-wrap--count-party">${this._esc(c.party)}</span></td>`;
            html += `<td class="election-col-status"><span class="election-cell-wrap election-cell-wrap--count-status">${rowStatus(c)}</span></td>`;
            html += `<td class="election-num">${this._fmtMaybeDeltaOrNA(firstPrefDelta)}</td>`;
            html += `<td class="election-num">${pct(c.firstPref).toFixed(2)}%</td>`;
            if (this._countDetailedView) {
                html += `<td class="election-num">${this._fmtMaybePctDeltaOrNA(firstPrefPctDelta)}</td>`;
            }
            html += `<td class="election-num">${fmt(c.firstPref)}</td>`;

            visibleCounts.forEach(n => {
                if (c.electedAt && n > c.electedAt) {
                    html += `<td class="election-num election-count-col">&nbsp;</td>`;
                    if (this._countDetailedView) {
                        html += `<td class="election-num election-count-col">&mdash;</td>`;
                        html += `<td class="election-num election-count-col">&mdash;</td>`;
                        html += `<td class="election-num election-count-col">&mdash;</td>`;
                    }
                    return;
                }
                const cnt = c.counts[n];
                if (!cnt) {
                    html += `<td class="election-num election-count-col">0</td>`;
                    if (this._countDetailedView) {
                        html += `<td class="election-num election-count-col">?</td>`;
                        html += `<td class="election-num election-count-col">?</td>`;
                        html += `<td class="election-num election-count-col">?</td>`;
                    }
                } else {
                    let cls = '';
                    if (this._statusKind(cnt.status) === 'elected') cls = ' count-elected';
                    if (this._statusKind(cnt.status) === 'excluded') cls = ' count-excluded';
                    const cell = fmt(cnt.total);
                    const prevTotal = c.counts[n - 1]?.total || 0;
                    const transferPct = prevTotal > 0 ? ((cnt.transfers / prevTotal) * 100) : 0;
                    const votePct = validPoll > 0 ? (cnt.total / validPoll * 100) : 0;
                    html += `<td class="election-num election-count-col ${cls}">${cell}</td>`;
                    if (this._countDetailedView) {
                        html += `<td class="election-num election-count-col">${votePct.toFixed(2)}%</td>`;
                        html += `<td class="election-num election-count-col">${this._fmtPctDeltaSigned(transferPct)}</td>`;
                        const deltaText = cnt.transfers !== 0 ? this._fmtDeltaSigned(cnt.transfers) : '\u2014';
                        html += `<td class="election-num election-count-col">${deltaText}</td>`;
                    }
                }
            });
            html += `</tr>`;
        });

        const appendSummaryRow = (name, value, prevValue, pctValue, prevPctValue) => {
            const delta = Number.isFinite(prevValue) ? (value - prevValue) : NaN;
            const deltaPct = Number.isFinite(prevPctValue) ? (pctValue - prevPctValue) : NaN;
            html += `<tr class="election-table-summary-row">
                <td class="election-rank-col">-</td>
                <td></td>
                <td><strong>${name}</strong></td>
                <td>-</td>
                <td>-</td>
                <td class="election-num">${this._fmtMaybeDeltaOrNA(delta)}</td>
                <td class="election-num">${pctValue.toFixed(2)}%</td>
                ${this._countDetailedView ? `<td class="election-num">${this._fmtMaybePctDeltaOrNA(deltaPct)}</td>` : ''}
                <td class="election-num election-cell-strong">${fmt(value)}</td>
                ${visibleCounts.map(() => this._countDetailedView ? '<td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td>' : '<td class="election-num">-</td>').join('')}
            </tr>`;
        };

        appendSummaryRow('Valid votes', validPoll, prevValidPoll, pctOfTurnout(validPoll), prevPctOfTurnout(prevValidPoll));
        appendSummaryRow('Spoiled', spoiled, prevSpoiled, pctOfTurnout(spoiled), prevPctOfTurnout(prevSpoiled));
        appendSummaryRow('Turnout', totalPoll, prevTotalPoll, pctOfElectorate(totalPoll), prevPctOfElectorate(prevTotalPoll));
        appendSummaryRow('Did not vote', didNotVote, prevDidNotVote, pctOfElectorate(didNotVote), prevPctOfElectorate(prevDidNotVote));
        appendSummaryRow('Electorate', electorate, prevElectorate, 100, 100);

        html += `</tbody></table></div></div>`;
        return html;
    }
    /**
     * Trigger the STV count animation for a constituency.
     * Injects pre-loaded JSON via the jquery-shim and calls animateStages().
     * After rendering, scales the entire container to fit within the pane.
     */
    _showAnimation(constName, payload) {
        const animContainer = this._animScaffold;
        if (!animContainer) return;

        // Show the animation container
        animContainer.style.display = 'block';

        // Keep map settings/accessibility button visible in the map pane.
        const mapSettingsBtn = document.getElementById('mapControlsToggle');
        if (mapSettingsBtn) mapSettingsBtn.style.display = '';

        // Pre-load the election data so $.ajax returns it directly
        if (typeof window.$ !== 'undefined' && window.$.preloadElectionData) {
            window.$.preloadElectionData(payload);
        }

        // Measure the actual available drawing width from the pane content area
        const paneContent = this.splitPaneEl?.querySelector('#electionPaneContent')
            || document.getElementById('electionPaneContent');
        const maxWidth = paneContent ? paneContent.clientWidth - 16 : 0; // 16 = container padding (8Ãƒâ€”2)

        // Call the animation engine with the available width
        try {
            animateStages({
                date: this.date,
                electedBody: this.body,
                constituency: constName,
                maxWidth: maxWidth > 0 ? maxWidth : undefined
            });
        } catch (err) {
            console.error('[Election] Animation failed:', err);
            animContainer.innerHTML = `<div class="election-no-data">Animation failed: ${this._esc(err.message)}</div>`;
        } finally {
            // Clear pre-loaded data
            if (typeof window.$ !== 'undefined' && window.$.clearPreloadedData) {
                window.$.clearPreloadedData();
            }
        }

        // Ã¢â€â‚¬Ã¢â€â‚¬ Apply fit-to-pane scaling Ã¢â€â‚¬Ã¢â€â‚¬
        // Delay to let the browser complete layout of the animation content
        setTimeout(() => this._applyAnimationScale(), 200);

        // Ã¢â€â‚¬Ã¢â€â‚¬ Re-scale on window resize / split pane drag Ã¢â€â‚¬Ã¢â€â‚¬
        if (this._animResizeHandler) {
            window.removeEventListener('resize', this._animResizeHandler);
        }
        let resizeTimer = null;
        this._animResizeHandler = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this._applyAnimationScale(), 200);
        };
        window.addEventListener('resize', this._animResizeHandler);

        // Also observe pane size changes (e.g. drag handle) via ResizeObserver
        if (this._animResizeObserver) {
            this._animResizeObserver.disconnect();
        }
        const paneObs = this.splitPaneEl?.querySelector('#electionPaneContent')
            || document.getElementById('electionPaneContent');
        if (paneObs && typeof ResizeObserver !== 'undefined') {
            this._animResizeObserver = new ResizeObserver(() => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => this._applyAnimationScale(), 200);
            });
            this._animResizeObserver.observe(paneObs);
        }

        // Re-scale when animation content mutates (counts advancing can add/update
        // bottom rows like "Did not vote" and "Electorate" after initial render).
        if (this._animContentObserver) {
            this._animContentObserver.disconnect();
            this._animContentObserver = null;
        }
        if (typeof MutationObserver !== 'undefined') {
            const scheduleRescale = () => {
                if (this._animScaleDebounce) clearTimeout(this._animScaleDebounce);
                this._animScaleDebounce = setTimeout(() => this._applyAnimationScale(), 120);
            };
            this._animContentObserver = new MutationObserver(() => {
                scheduleRescale();
            });
            this._animContentObserver.observe(animContainer, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true
            });
        }
    }

    /**
     * Scale the animation container to fit within the pane using CSS zoom.
     *
     * Approach:
     *  1. Reset any prior zoom.
     *  2. Set #animation's height from the bounding box stored by stages2.js
     *     (its children are absolutely positioned, so it has no natural height).
     *  3. Temporarily set overflow:auto on the pane to measure scrollHeight
     *     (the true total content height, including the now-explicit #animation).
     *  4. scale = clientHeight / scrollHeight.
     *  5. Apply as CSS zoom on the animation container.
     *  6. Lock overflow to hidden.
     */
    _applyAnimationScale() {
        try {
            const animContainer = this._animScaffold;
            if (!animContainer || animContainer.style.display === 'none') return;

            const paneContent =
                this.splitPaneEl?.querySelector('#electionPaneContent')
                || document.getElementById('electionPaneContent')
                || animContainer.parentElement;
            if (!paneContent) return;

            // Set #animation div height from bounding box (its children are abs-positioned)
            const animDiv = document.getElementById('animation');
            let bbW = 0;
            let bbH = 0;
            if (animDiv && window.$) {
                const bb = window.$(animDiv).data('boundingBox');
                if (bb && bb.width > 0) bbW = bb.width;
                if (bb && bb.height > 0) bbH = bb.height;
            }
            if (bbH <= 0) return;
            animDiv.style.height = bbH + 'px';
            if (bbW > 0) {
                animDiv.style.width = bbW + 'px';
            }
            // Ensure #animation is tall enough for all absolutely positioned rows.
            // Some footer rows (e.g. Did not vote / Electorate) can extend beyond
            // the stored boundingBox height on certain datasets.
            animDiv.style.overflow = 'visible';
            let animMaxBottom = 0;
            const animChildren = animDiv.querySelectorAll('*');
            animChildren.forEach((el) => {
                const bottom = el.offsetTop + el.offsetHeight;
                if (bottom > animMaxBottom) animMaxBottom = bottom;
            });
            if (animMaxBottom > 0) {
                const expandedH = Math.max(bbH, animMaxBottom + 12);
                animDiv.style.height = expandedH + 'px';
            }

            // 1. Reset zoom and allow overflow so we can measure natural content height
            animContainer.style.zoom = '1';
            animContainer.style.width = '';
            paneContent.style.overflowY = 'auto';
            paneContent.style.overflowX = 'auto';

            // Force layout reflow so measurements are up-to-date
            void paneContent.offsetHeight;

            // 2. Measure natural animation size and the actual slot available to it.
            // The animation may sit below other pane content (e.g. title/tab row), so
            // available height is not the full pane height.
            const paneRect = paneContent.getBoundingClientRect();
            const animRect = animContainer.getBoundingClientRect();
            let totalNeededH = Math.max(
                bbH,
                animContainer.scrollHeight,
                animDiv ? animDiv.scrollHeight : 0
            );
            let totalNeededW = Math.max(
                bbW,
                animContainer.scrollWidth,
                animDiv ? animDiv.scrollWidth : 0
            );

            // Absolute-positioned descendants can sit outside normal scroll metrics.
            // Measure rendered geometry directly to capture the true extents.
            let geomNeededW = 0;
            let geomNeededH = 0;
            const baseRect = animContainer.getBoundingClientRect();
            const descendants = animContainer.querySelectorAll('*');
            descendants.forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.width <= 0 && r.height <= 0) return;
                geomNeededW = Math.max(geomNeededW, r.right - baseRect.left);
                geomNeededH = Math.max(geomNeededH, r.bottom - baseRect.top);
            });
            totalNeededW = Math.max(totalNeededW, Math.ceil(geomNeededW));
            totalNeededH = Math.max(totalNeededH, Math.ceil(geomNeededH));

            // Reserve a small visual gutter to prevent subpixel clipping at pane edge.
            const availH = Math.max(1, (paneRect.bottom - animRect.top) - 8);
            const availW = Math.max(1, (paneRect.right - animRect.left) - 4);

            if (totalNeededH <= 0 || totalNeededW <= 0 || availH <= 0 || availW <= 0) return;
            animContainer.style.width = `${Math.ceil(totalNeededW) + 8}px`;

            // 3. If content already fits both dimensions, no zoom needed
            if (totalNeededH <= availH && totalNeededW <= availW) {
                animContainer.style.zoom = '1';
                paneContent.style.overflowY = 'hidden';
                paneContent.style.overflowX = 'hidden';
                return;
            }

            // 4. Compute zoom to shrink content to fit within both dimensions
            const scaleH = availH / totalNeededH;
            const scaleW = availW / totalNeededW;
            let scale = Math.min(scaleH, scaleW);
            // 2% safety margin for rounding/subpixel differences
            scale *= 0.98;
            scale = Math.min(scale, 1);
            scale = Math.max(scale, 0.1);

            // 5. Deterministic fit loop against actual rendered descendant bounds.
            // One pass can still miss in this UI because content mutates and many
            // rows are absolutely positioned/overflow-visible.
            let appliedScale = scale;
            for (let pass = 0; pass < 4; pass++) {
                animContainer.style.zoom = String(appliedScale);
                void animContainer.offsetHeight;

                const paneRectNow = paneContent.getBoundingClientRect();
                const baseNow = animContainer.getBoundingClientRect();
                let renderedNeededW = baseNow.width;
                let renderedNeededH = baseNow.height;
                const renderedDescendants = animContainer.querySelectorAll('*');
                renderedDescendants.forEach((el) => {
                    const r = el.getBoundingClientRect();
                    if (r.width <= 0 && r.height <= 0) return;
                    renderedNeededW = Math.max(renderedNeededW, r.right - baseNow.left);
                    renderedNeededH = Math.max(renderedNeededH, r.bottom - baseNow.top);
                });

                const slotW = Math.max(1, (paneRectNow.right - baseNow.left) - 12);
                const slotH = Math.max(1, (paneRectNow.bottom - baseNow.top) - 12);
                const overH = renderedNeededH - slotH;
                const overW = renderedNeededW - slotW;
                if (overH <= 0 && overW <= 0) {
                    break;
                }

                const fitH = renderedNeededH > 0 ? (slotH / renderedNeededH) : 1;
                const fitW = renderedNeededW > 0 ? (slotW / renderedNeededW) : 1;
                let nextScale = appliedScale * Math.min(fitH, fitW) * 0.97;
                nextScale = Math.min(nextScale, 1);
                nextScale = Math.max(nextScale, 0.05);

                if (Math.abs(nextScale - appliedScale) < 0.002) {
                    appliedScale = nextScale;
                    animContainer.style.zoom = String(appliedScale);
                    break;
                }
                appliedScale = nextScale;
            }

            paneContent.style.overflowY = 'hidden';
            paneContent.style.overflowX = 'hidden';
        } catch (err) {
            console.error('[AnimScale] ERROR:', err);
        }
    }

    /**
     * Hide the animation container and clean up.
     */
    _hideAnimation() {
        // Clean up resize handler
        if (this._animResizeHandler) {
            window.removeEventListener('resize', this._animResizeHandler);
            this._animResizeHandler = null;
        }
        // Clean up ResizeObserver
        if (this._animResizeObserver) {
            this._animResizeObserver.disconnect();
            this._animResizeObserver = null;
        }
        if (this._animContentObserver) {
            this._animContentObserver.disconnect();
            this._animContentObserver = null;
        }
        if (this._animScaleDebounce) {
            clearTimeout(this._animScaleDebounce);
            this._animScaleDebounce = null;
        }
        const animContainer = this._animScaffold;
        if (animContainer) {
            animContainer.style.display = 'none';
            animContainer.style.height = '';
            animContainer.style.width = '';
            animContainer.style.transform = '';
            animContainer.style.zoom = '';
            // Restore pane scrolling
            if (this.splitPaneEl) {
                this.splitPaneEl.style.overflow = '';
                const pc = this.splitPaneEl.querySelector('#electionPaneContent');
                if (pc) pc.style.overflow = '';
            }
            // Clear animation content
            const animation = animContainer.querySelector('#animation');
            if (animation) {
                animation.innerHTML = '';
                animation.style.transform = '';
                animation.style.height = '';
            }
            const quota = animContainer.querySelector('#quota');
            if (quota) quota.textContent = '';
            const stageNumbers = animContainer.querySelector('#stageNumbers');
            if (stageNumbers) stageNumbers.innerHTML = '';
            const countMatrix = animContainer.querySelector('#count_matrix');
            if (countMatrix) countMatrix.innerHTML = '';
            const transfers = animContainer.querySelector('#transfers');
            if (transfers) transfers.innerHTML = '';
        }
        // Keep map settings/accessibility button visible in the map pane.
        const mapSettingsBtn = document.getElementById('mapControlsToggle');
        if (mapSettingsBtn) mapSettingsBtn.style.display = '';
    }

    _buildConstituencyResults(constName, payload) {
        const cg = payload.Constituency.countGroup;
        const info = payload.Constituency.countInfo;
        const validPoll = parseFloat(info.Valid_Poll) || 0;

        // Get first-pref data
        const candidates = [];
        const seen = new Set();
        cg.forEach(row => {
            if (row.Count_Number === '1' && !seen.has(row.Candidate_Id)) {
                seen.add(row.Candidate_Id);
                // Find status
                let status = '';
                cg.forEach(r2 => {
                    if (r2.Candidate_Id === row.Candidate_Id && r2.Status) status = r2.Status;
                });
                candidates.push({
                    name: row.candidateName || (row.Firstname + ' ' + row.Surname),
                    party: row.Party_Name || 'Independent',
                    colour: row.Party_Colour || '#b0bec5',
                    votes: parseFloat(row.Total_Votes) || 0,
                    status
                });
            }
        });
        candidates.sort((a, b) => b.votes - a.votes);

        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        const pct = (v) => validPoll > 0 ? (v / validPoll * 100).toFixed(1) + '%' : '';

        let html = `<div class="election-constituency-results">`;
        html += `<h3>${this._esc(constName)}</h3>`;
        html += `<div class="election-summary__stats">`;
        if (info.Number_Of_Seats) html += `<span>Seats: <strong>${info.Number_Of_Seats}</strong></span>`;
        if (info.Quota) html += `<span>Quota: <strong>${fmt(parseInt(info.Quota))}</strong></span>`;
        if (info.Total_Electorate) html += `<span>Electorate: <strong>${fmt(parseInt(info.Total_Electorate))}</strong></span>`;
        if (info.Valid_Poll) html += `<span>Valid: <strong>${fmt(parseInt(info.Valid_Poll))}</strong></span>`;
        html += `</div>`;

        html += `<table class="election-summary__table"><thead><tr>
            <th>Candidate</th><th class="election-num">1st Pref</th>
            <th class="election-num">%</th><th>Status</th>
        </tr></thead><tbody>`;

        candidates.forEach(c => {
            const statCls = c.status === 'Elected' ? ' election-status-elected' : c.status === 'Excluded' ? ' election-status-excluded' : '';
            html += `<tr>
                <td><span class="election-party-dot" style="background:${this._esc(c.colour)}"></span>${this._esc(c.name)} <small class="election-party-label">(${this._esc(c.party)})</small></td>
                <td class="election-num">${fmt(c.votes)}</td>
                <td class="election-num">${pct(c.votes)}</td>
                <td class="${statCls}">${this._esc(c.status || '—')}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
    }

    _candidateKey(name, party) {
        const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
        return `${norm(name)}|${norm(party)}`;
    }

    _getPreviousConstituencyPayload(constName) {
        if (!constName) return null;
        return this.previousResultsByConstituency?.[constName] || null;
    }

    _getPreviousFirstPrefsByCandidate(constName) {
        const payload = this._getPreviousConstituencyPayload(constName);
        const map = new Map();
        const cg = payload?.Constituency?.countGroup || [];
        const seen = new Set();
        cg.forEach(row => {
            const countNum = parseInt(row.Count_Number, 10) || 1;
            const cid = String(row.Candidate_Id || '');
            if (countNum !== 1 || seen.has(cid)) return;
            seen.add(cid);
            const name = row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`.trim();
            const party = row.Party_Name || 'Independent';
            const key = this._candidateKey(name, party);
            map.set(key, parseFloat(row.Total_Votes) || 0);
        });
        return map;
    }

    _getPreviousFirstPrefsByParty(constName) {
        const payload = this._getPreviousConstituencyPayload(constName);
        const partyMap = new Map();
        const cg = payload?.Constituency?.countGroup || [];
        const seen = new Set();
        cg.forEach(row => {
            const countNum = parseInt(row.Count_Number, 10) || 1;
            const cid = String(row.Candidate_Id || '');
            if (countNum !== 1 || seen.has(cid)) return;
            seen.add(cid);
            const party = row.Party_Name || 'Independent';
            const prev = partyMap.get(party) || 0;
            partyMap.set(party, prev + (parseFloat(row.Total_Votes) || 0));
        });
        return partyMap;
    }

    _getPreviousPartyStats(constName) {
        const payload = this._getPreviousConstituencyPayload(constName);
        const stats = new Map();
        const cg = payload?.Constituency?.countGroup || [];
        const seen = new Set();
        const electedSeen = new Set();
        cg.forEach((row) => {
            const party = row.Party_Name || 'Independent';
            const countNum = parseInt(row.Count_Number, 10) || 1;
            const cid = String(row.Candidate_Id || '');
            if (!stats.has(party)) {
                stats.set(party, { stood: 0, seats: 0, firstPrefs: 0 });
            }
            const partyStats = stats.get(party);
            if (countNum === 1 && !seen.has(cid)) {
                seen.add(cid);
                partyStats.stood += 1;
                partyStats.firstPrefs += parseFloat(row.Total_Votes) || 0;
            }
            if (this._statusKind(row.Status) === 'elected' && !electedSeen.has(cid)) {
                electedSeen.add(cid);
                partyStats.seats += 1;
            }
        });
        return stats;
    }

    _fmtMaybeDelta(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return '<em>new</em>';
        const r = Math.round(value);
        const s = r > 0 ? `+${r.toLocaleString('en-GB')}` : r.toLocaleString('en-GB');
        const cls = r > 0 ? 'election-delta election-delta--pos' : r < 0 ? 'election-delta election-delta--neg' : 'election-delta';
        return `<span class="${cls}">${s}</span>`;
    }

    _fmtMaybePctDelta(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return '<em>new</em>';
        return this._fmtPctDeltaSigned(value);
    }

    _fmtMaybeDeltaOrNA(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return '<span class="election-na"><em>N/A</em></span>';
        return this._fmtDeltaSigned(value);
    }

    _fmtMaybePctDeltaOrNA(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return '<span class="election-na"><em>N/A</em></span>';
        return this._fmtPctDeltaSigned(value);
    }

    _fmtPctDeltaSigned(value) {
        const v = Number(value) || 0;
        const sign = v > 0 ? '+' : '';
        const cls = v > 0 ? 'election-delta election-delta--pos' : v < 0 ? 'election-delta election-delta--neg' : 'election-delta';
        return `<span class="${cls}">${sign}${v.toFixed(2)}%</span>`;
    }

    _fmtDeltaPlain(value) {
        const r = Math.round(Number(value) || 0);
        if (r === 0) return '0';
        return r > 0 ? `+${r.toLocaleString('en-GB')}` : r.toLocaleString('en-GB');
    }

    _fmtDeltaSigned(value) {
        const r = Math.round(Number(value) || 0);
        const s = r > 0 ? `+${r.toLocaleString('en-GB')}` : r.toLocaleString('en-GB');
        const cls = r > 0 ? 'election-delta election-delta--pos' : r < 0 ? 'election-delta election-delta--neg' : 'election-delta';
        return `<span class="${cls}">${s}</span>`;
    }

    _thTwoLine(top, bottom) {
        const topEsc = this._esc(top || '');
        const bottomEsc = this._esc(bottom || '');
        return `<span class="election-th-two-line">${topEsc}<br>${bottomEsc || '&nbsp;'}</span>`;
    }

    _statusKind(status) {
        const s = String(status || '').toLowerCase();
        if (!s) return 'unknown';
        if (s.includes('not elected')) return 'not_elected';
        if (s.includes('excluded')) return 'excluded';
        if (s.includes('elected')) return 'elected';
        return 'unknown';
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Catalogue Cards Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    /**
     * Build election catalogue cards for the sidebar.
     * Returns an array of { body, date, constituencies, isByElection, html }.
     */
    async buildCatalogueCards() {
        const index = await this._loadIndex();
        const cards = [];

        index.bodies.forEach(bodyData => {
            bodyData.dates.forEach(dateData => {
                const isByElection = dateData.constituencies.length <= 2 &&
                    !['Northern Ireland'].includes(dateData.constituencies[0]);
                const isGeneral = !isByElection;

                const bodyShort = this._shortBodyName(bodyData.name);
                const dateFormatted = this._formatDate(dateData.date);
                const constCount = dateData.constituencies.filter(c => c !== 'Northern Ireland').length;

                let subtitle = '';
                if (isByElection) {
                    subtitle = dateData.constituencies.join(', ');
                } else {
                    subtitle = (bodyData.name === 'European Parliament' && constCount === 0)
                        ? 'Northern Ireland'
                        : `${constCount} constituencies`;
                }

                const cardHtml = `
                    <div class="election-card ${isByElection ? 'election-card--by-election' : ''}"
                         data-body="${this._esc(bodyData.name)}"
                         data-date="${this._esc(dateData.date)}">
                        <div class="election-card__body-badge">${this._esc(bodyShort)}</div>
                        <div class="election-card__info">
                            <span class="election-card__date">${dateFormatted}</span>
                            <span class="election-card__subtitle">${subtitle}</span>
                        </div>
                    </div>
                `;

                cards.push({
                    body: bodyData.name,
                    date: dateData.date,
                    constituencies: dateData.constituencies,
                    isByElection,
                    html: cardHtml
                });
            });
        });

        // Sort by date descending
        cards.sort((a, b) => b.date.localeCompare(a.date));
        return cards;
    }

    _shortBodyName(name) {
        const map = {
            'European Parliament': 'EU',
            'House of Commons of the United Kingdom': 'Westminster',
            'Northern Ireland Assembly': 'Assembly',
            'Northern Ireland Constitutional Convention': 'Convention',
            'Northern Ireland Forum for Political Dialogue': 'Forum'
        };
        return map[name] || name;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ URL State Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    serialize() {
        if (!this.active || !this.body || !this.date) return '';
        const slugify = (t) => String(t).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');
        let s = `${slugify(this.body)}:${this.date}`;
        if (this.selectedConstituency) {
            s += `:${slugify(this.selectedConstituency)}`;
        }
        return s;
    }

    async restoreFromURL(param) {
        if (!param) return;
        const parts = param.split(':');
        if (parts.length < 2) return;

        const bodySlug = parts[0];
        const date = parts[1];
        const constSlug = parts.length > 2 ? parts[2] : null;

        // Load index to find body name
        const index = await this._loadIndex();
        const bodyData = index.bodies.find(b => {
            const slug = String(b.name).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');
            return slug === bodySlug;
        });
        if (!bodyData) return;

        await this.loadElection(bodyData.name, date);

        // Select constituency if specified
        if (constSlug) {
            const dateData = bodyData.dates.find(d => d.date === date);
            if (dateData) {
                const match = dateData.constituencies.find(c => {
                    const slug = String(c).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');
                    return slug === constSlug;
                });
                if (match) {
                    this._onConstituencyClick(match.toUpperCase());
                }
            }
        }
    }

    /**
     * Restore header right-side to just the close button (no tabs, no back).
     * Called when navigating back from a constituency view to NI-wide summary.
     */
    _restoreHeaderTabs() {
        const headerRight = document.getElementById('electionPaneHeaderRight');
        if (!headerRight) return;
        const closeBtn = headerRight.querySelector('#electionCloseBtn');
        if (!closeBtn) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'electionCloseBtn';
            btn.className = 'election-pane__close';
            btn.title = 'Close election';
            btn.textContent = '\u2715';
            btn.addEventListener('click', () => this.clear());
            headerRight.appendChild(btn);
        }
        this._setupNIWideTabs('party');
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    _formatDate(dateStr) {
        try {
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch {
            return dateStr;
        }
    }

    _esc(str) {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    }
}

// Export singleton
const electionController = new ElectionController();
export default electionController;
