/**
 * NI Boundaries - Main Application
 * Entry point that wires together all modules
 */

import dataService from './data-service.js';
import mapController from './map-controller.js';
import uiController from './ui-controller.js';
import featureLoader from './feature-loader.js';
import timeSliderController from './time-slider-controller.js';

class App {
    constructor() {
        this.currentCategory = 'all';
        this.currentAuthor = 'all';
        this.currentProviderCategory = 'all-providers';
        this.currentProviderList = [];
        this.searchQuery = '';
        this.initialized = false;
        this.textScale = 100;
        this.textScaleSteps = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
        this.splitPosition = 50; // Percentage for info pane width
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('[App] Starting NI Boundaries...');

        try {
            // Initialize data service
            await dataService.init();

            // Load books data for catalogue rendering
            try {
                const booksResp = await fetch('data/database/books.json');
                const booksData = await booksResp.json();
                uiController.booksData = booksData;
            } catch (e) {
                console.warn('[App] Could not load books.json:', e);
            }

            // Initialize UI controller
            uiController.init();

            // Show all maps directly (no 'Show X more maps' buttons)
            uiController.showAllMaps = true;

            // Setup UI callbacks
            uiController.onSplitChange = (stateId) => {
                mapController.invalidateSize();
                this.updateURLState();
            };

            // Load a map layer (or group of layers)
            uiController.onMapLoad = async (mapId) => {
                const mapConfig = dataService.getMapById(mapId);
                if (mapConfig?.isGroup && mapConfig.members) {
                    // Load all member maps for a group
                    for (const memberId of mapConfig.members) {
                        await this.loadMap(memberId);
                    }
                } else {
                    await this.loadMap(mapId);
                }
                this.updateMapList();
                this.updateActiveLayers();
            };

            // Unload a map layer (or group of layers)
            uiController.onMapUnload = (mapId) => {
                const mapConfig = dataService.getMapById(mapId);
                if (mapConfig?.isGroup && mapConfig.members) {
                    // Unload all member maps for a group
                    for (const memberId of mapConfig.members) {
                        mapController.unloadLayer(memberId);
                    }
                } else {
                    mapController.unloadLayer(mapId);
                }
                this.updateMapList();
                this.updateActiveLayers();
                this.updateURLState();
            };

            // Toggle visibility of a loaded map
            uiController.onMapToggle = (mapId) => {
                mapController.toggleLayer(mapId);
                this.updateMapList();
                this.updateActiveLayers();
                this.updateURLState();
            };

            // Hide a map layer (set visibility to false without unloading)
            uiController.onHideMap = (mapId) => {
                mapController.hideLayer(mapId);
                // Don't update UI here - will be done after the selected map is loaded
            };

            uiController.onCategoryChange = (categoryId) => {
                this.currentCategory = categoryId;
                this.updateMapList();
            };

            // Provider category filter
            uiController.onProviderCategoryChange = (providerId, providers) => {
                this.currentProviderCategory = providerId;
                this.currentProviderList = providers;
                this.updateMapList();
            };

            // Download FGB file for a map
            uiController.onDownloadFgb = (mapId) => {
                const mapConfig = dataService.getMapById(mapId);
                if (!mapConfig?.files?.fgb) {
                    console.warn('[App] No FGB file for map:', mapId);
                    return;
                }
                // Trigger download by creating a link and clicking it
                const link = document.createElement('a');
                link.href = mapConfig.files.fgb;
                link.download = mapConfig.files.fgb.split('/').pop();
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            };

            // Expand a partial layer to full map
            uiController.onExpandToFullMap = async (mapId) => {
                const mapConfig = dataService.getMapById(mapId);
                if (mapConfig) {
                    await mapController.expandToFullMap(mapConfig);
                    this.updateMapList();
                    this.updateActiveLayers();
                    this.updateURLState();
                }
            };

            // Address search - zoom to location and add marker
            uiController.onAddressSelect = (lat, lon, name) => {
                if (this.addressMarker) {
                    this.addressMarker.remove();
                }
                if (mapController.map) {
                    this.addressMarker = L.marker([lat, lon], { title: name })
                        .addTo(mapController.map)
                        .bindPopup(`<strong>${name}</strong>`)
                        .openPopup();
                    mapController.map.setView([lat, lon], 14);
                }
            };

            // Check what features contain a point
            uiController.onCheckIntersection = async (lat, lon) => {
                return this.findFeaturesAtPoint(lat, lon);
            };

            // Remove address marker
            uiController.onRemoveAddressMarker = () => {
                if (this.addressMarker) {
                    this.addressMarker.remove();
                    this.addressMarker = null;
                }
            };

            // Author filter
            uiController.onAuthorFilter = (authors) => {
                if (authors === null || authors.length === 0) {
                    this.currentAuthor = 'all';
                } else {
                    this.currentAuthor = authors;
                }
                this.updateMapList();
            };

            // Get loaded features for Tables tab
            uiController.onGetLoadedFeatures = () => {
                const features = [];
                mapController.layerStates.forEach((state, mapId) => {
                    if (!state.loaded) return;
                    const mapConfig = state.config;
                    state.geoJsonLayers.forEach(geoJsonLayer => {
                        geoJsonLayer.eachLayer(layer => {
                            if (!layer.feature) return;
                            features.push({
                                ...layer.feature.properties,
                                mapId,
                                mapName: mapConfig?.name || mapId
                            });
                        });
                    });
                });
                return features;
            };

            // Zoom to bounding box
            uiController.onZoomToBbox = (bounds) => {
                if (mapController.map && bounds && bounds.length === 2) {
                    mapController.map.fitBounds(bounds, { maxZoom: 14, padding: [20, 20] });
                }
            };

            // Highlight a specific feature
            uiController.onHighlightFeature = (mapId, featureId) => {
                const state = mapController.layerStates.get(mapId);
                if (!state) return;

                state.geoJsonLayers.forEach(geoJsonLayer => {
                    geoJsonLayer.eachLayer(layer => {
                        if (!layer.feature) return;
                        // Flash the feature by temporarily changing style
                        const originalStyle = { ...layer.options };
                        layer.setStyle({ weight: 4, color: '#ff0000', fillOpacity: 0.5 });
                        setTimeout(() => {
                            layer.setStyle(originalStyle);
                        }, 2000);
                    });
                });
            };

            // Render initial UI
            this.renderCategoryPills();
            this.updateMapList();

            // Setup search
            this.setupSearch();

            // Initialize map
            mapController.init('map');

            // Setup feature click handler
            mapController.onFeatureClick = (features) => {
                uiController.showFeatureInfo(features, dataService.getAllMaps());
            };

            // Setup loading progress handler
            mapController.onLoadProgress = (mapId, progress) => {
                uiController.showLoadProgress(mapId, progress);
            };

            // Setup map controls
            this.setupMapControls();

            // Initialize time slider for time-series navigation
            timeSliderController.init(mapController, uiController);
            timeSliderController.onLayersChanged = () => {
                this.updateActiveLayers();
                this.updateURLState();
            };

            // Setup URL state handling
            this.setupURLState();

            // Setup theme toggle
            this.setupThemeToggle();

            // Setup offline indicator
            this.setupOfflineIndicator();

            // Setup address search
            this.setupAddressSearch();

            // Load from URL or default layers
            const loadedFromURL = await this.loadURLState();
            if (!loadedFromURL) {
                await this.loadDefaultLayers();
            }

            this.initialized = true;
            console.log('[App] Initialization complete');

            // Setup column layout responsiveness
            this.updateColumnLayout();
            window.addEventListener('resize', () => this.updateColumnLayout());

            // Register service worker for PWA support
            this.registerServiceWorker();

            // Setup keyboard shortcuts
            this.setupKeyboardShortcuts();

        } catch (err) {
            console.error('[App] Initialization failed:', err);
            this.showError('Failed to load application. Please refresh the page.');
        }
    }

    /**
     * Setup theme toggle (dark mode)
     */
    setupThemeToggle() {
        const toggle = document.getElementById('themeToggle');
        if (!toggle) return;

        // Load saved preference or detect system preference
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.dataset.theme = savedTheme;
        }

        toggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.dataset.theme;
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = newTheme;
            localStorage.setItem('theme', newTheme);
        });
    }

    /**
     * Setup offline indicator
     */
    setupOfflineIndicator() {
        // Create indicator if it doesn't exist
        let indicator = document.querySelector('.offline-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'offline-indicator';
            indicator.textContent = 'You are offline. Some features may not work.';
            document.body.appendChild(indicator);
        }

        const updateOnlineStatus = () => {
            if (!navigator.onLine) {
                indicator.classList.add('visible');
            } else {
                indicator.classList.remove('visible');
            }
        };

        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        updateOnlineStatus();
    }

    /**
     * Setup search functionality with address autocomplete
     */
    setupSearch() {
        const searchInput = document.getElementById('searchInput');
        const autocomplete = document.getElementById('searchAutocomplete');
        const addressResults = document.getElementById('addressResults');
        if (!searchInput || !autocomplete) return;

        let debounceTimer;

        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const query = searchInput.value.trim();
                this.searchQuery = query;
                this.updateMapList();

                // Show autocomplete with address option if query is non-empty
                if (query.length > 0) {
                    this.showSearchAutocomplete(query, autocomplete);
                } else {
                    autocomplete.classList.add('hidden');
                    if (addressResults) addressResults.classList.add('hidden');
                }
            }, 200);
        });

        // Hide autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !autocomplete.contains(e.target)) {
                autocomplete.classList.add('hidden');
            }
            // Close any open overflow menus when clicking outside
            if (!e.target.closest('.overflow-menu')) {
                document.querySelectorAll('.overflow-menu--open').forEach(m => {
                    m.classList.remove('overflow-menu--open');
                });
            }
        });

        // Handle overflow menu trigger clicks globally using CAPTURE phase
        // This ensures it runs BEFORE any other handlers that might stop propagation
        document.addEventListener('click', (e) => {
            const trigger = e.target.closest('.overflow-menu__trigger');
            if (!trigger) return;

            e.preventDefault();
            e.stopPropagation();

            const menu = trigger.closest('.overflow-menu');
            const dropdown = menu?.querySelector('.overflow-menu__dropdown');
            if (!menu) return;

            // Close all other open menus and remove any portal dropdowns
            document.querySelectorAll('.overflow-menu--open').forEach(m => {
                if (m !== menu) m.classList.remove('overflow-menu--open');
            });
            document.querySelectorAll('.overflow-menu__dropdown--portal').forEach(p => p.remove());

            // Toggle this menu
            const wasOpen = menu.classList.contains('overflow-menu--open');
            menu.classList.toggle('overflow-menu--open');

            // If opening, create a portal dropdown in body for immediate rendering
            if (!wasOpen && dropdown) {
                const rect = trigger.getBoundingClientRect();

                // Clone dropdown and append to body as portal
                const portal = dropdown.cloneNode(true);
                portal.classList.add('overflow-menu__dropdown--portal');
                portal.style.cssText = `
                    position: fixed !important;
                    top: ${rect.bottom + 2}px !important;
                    right: ${window.innerWidth - rect.right}px !important;
                    display: block !important;
                    z-index: 99999 !important;
                    opacity: 1 !important;
                `;
                document.body.appendChild(portal);

                // Hide original dropdown since we're using portal
                dropdown.style.display = 'none';

                // Add click handlers to portal buttons
                portal.querySelectorAll('button').forEach(btn => {
                    btn.addEventListener('click', (evt) => {
                        evt.stopPropagation();
                        const mapId = btn.dataset.mapId;
                        if (btn.classList.contains('visibility-btn') && uiController.onMapToggle) {
                            uiController.onMapToggle(mapId);
                        } else if (btn.classList.contains('copy-url-btn')) {
                            uiController.copyMapUrl(mapId, btn);
                        } else if (btn.classList.contains('download-fgb-btn') && uiController.onDownloadFgb) {
                            uiController.onDownloadFgb(mapId);
                        }
                        // Close the menu
                        menu.classList.remove('overflow-menu--open');
                        portal.remove();
                        dropdown.style.display = '';
                    });
                });
            }
        }, true); // true = capture phase

        // Close menus when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.overflow-menu') && !e.target.closest('.overflow-menu__dropdown--portal')) {
                document.querySelectorAll('.overflow-menu--open').forEach(m => m.classList.remove('overflow-menu--open'));
                document.querySelectorAll('.overflow-menu__dropdown--portal').forEach(p => {
                    // Restore original dropdown visibility
                    const menu = document.querySelector('.overflow-menu--open');
                    if (menu) {
                        menu.querySelector('.overflow-menu__dropdown').style.display = '';
                    }
                    p.remove();
                });
            }
        });

        // Close menus when scrolling
        document.addEventListener('scroll', () => {
            document.querySelectorAll('.overflow-menu--open').forEach(m => {
                m.classList.remove('overflow-menu--open');
                const dropdown = m.querySelector('.overflow-menu__dropdown');
                if (dropdown) dropdown.style.display = '';
            });
            document.querySelectorAll('.overflow-menu__dropdown--portal').forEach(p => p.remove());
        }, true); // capture phase to catch all scroll events

        // Handle keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                autocomplete.classList.add('hidden');
            }
        });
    }

    /**
     * Show search autocomplete dropdown with feature and address search options
     */
    showSearchAutocomplete(query, autocomplete) {
        let html = '';

        // Search for matching features from spatial index
        const featureResults = featureLoader.searchFeaturesByName(query, 10);
        if (featureResults.length > 0) {
            html += `<div class="search-autocomplete__section-header">Features</div>`;
            for (const feature of featureResults) {
                // Get map name for disambiguation
                const mapConfig = dataService.getMapById(feature.mapId);
                const mapName = mapConfig?.name || feature.mapId;
                // Extract feature index from id (format: "mapId:index")
                const featureIndex = featureLoader.parseFeatureId(feature.id);
                html += `
                    <div class="search-autocomplete__item search-autocomplete__item--feature" 
                         data-action="feature" 
                         data-map-id="${feature.mapId}"
                         data-feature-id="${featureIndex}"
                         data-feature-name="${this.escapeHtml(feature.name)}"
                         data-bbox="${feature.bbox.join(',')}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
                        </svg>
                        <span>${this.escapeHtml(feature.name)} <span class="search-autocomplete__map-name">(${this.escapeHtml(mapName)})</span></span>
                    </div>
                `;
            }
        }

        // Address search option
        html += `
            <div class="search-autocomplete__item search-autocomplete__item--address" data-action="address" data-query="${this.escapeHtml(query)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                </svg>
                <span>Search address: <span class="search-autocomplete__query">"${this.escapeHtml(query)}"</span></span>
            </div>
        `;

        autocomplete.innerHTML = html;

        // Add click handlers for features - load only the selected feature
        autocomplete.querySelectorAll('[data-action="feature"]').forEach(el => {
            el.addEventListener('click', async () => {
                const mapId = el.dataset.mapId;
                const featureIndex = parseInt(el.dataset.featureId, 10);
                const featureName = el.dataset.featureName;
                const bbox = el.dataset.bbox.split(',').map(Number);

                // Get map config
                const mapConfig = dataService.getMapById(mapId);
                if (!mapConfig) return;

                // Load only this single feature (not the entire map)
                await mapController.loadSingleFeature(mapConfig, featureIndex, featureName);
                this.updateMapList();
                this.updateActiveLayers();

                // Zoom to feature bbox [minLng, minLat, maxLng, maxLat]
                if (mapController.map && bbox.length === 4) {
                    const bounds = L.latLngBounds(
                        [bbox[1], bbox[0]],  // SW: [minLat, minLng]
                        [bbox[3], bbox[2]]   // NE: [maxLat, maxLng]
                    );
                    mapController.map.fitBounds(bounds, { maxZoom: 14, padding: [20, 20] });
                }

                autocomplete.classList.add('hidden');
            });
        });

        // Add click handler for address search
        autocomplete.querySelector('[data-action="address"]')?.addEventListener('click', () => {
            const addressQuery = autocomplete.querySelector('[data-action="address"]').dataset.query;
            this.performAddressSearch(addressQuery);
            autocomplete.classList.add('hidden');
        });

        autocomplete.classList.remove('hidden');
    }

    /**
     * Perform address search (geocoding + point-in-polygon)
     */
    async performAddressSearch(query) {
        const resultsContainer = document.getElementById('addressResults');
        if (!resultsContainer) return;

        resultsContainer.classList.remove('hidden');
        resultsContainer.innerHTML = '<div class="address-results__loading">Searching...</div>';

        try {
            // Call Nominatim API (OpenStreetMap geocoder) with full address details
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=gb,ie&limit=1&addressdetails=1`;
            const response = await fetch(url, {
                headers: { 'User-Agent': 'BoundariesWebsite/1.0' }
            });

            if (!response.ok) throw new Error('Geocoding failed');

            const data = await response.json();

            if (!data || data.length === 0) {
                resultsContainer.innerHTML = `
                    <div class="address-results__header">
                        <span>Address not found</span>
                        <button class="address-results__close" title="Close">×</button>
                    </div>
                `;
                this.setupAddressResultsClose(resultsContainer);
                return;
            }

            const location = data[0];
            const lat = parseFloat(location.lat);
            const lng = parseFloat(location.lon);

            // Build full address from addressdetails if available
            let displayAddress = location.display_name;
            if (location.address) {
                const addr = location.address;
                const parts = [];
                // Add house_number + road together
                if (addr.house_number && addr.road) {
                    parts.push(`${addr.house_number} ${addr.road}`);
                } else if (addr.road) {
                    parts.push(addr.road);
                } else if (addr.name) {
                    parts.push(addr.name);
                }
                // Add locality/suburb
                if (addr.suburb) parts.push(addr.suburb);
                else if (addr.neighbourhood) parts.push(addr.neighbourhood);
                // Add city/town
                if (addr.city) parts.push(addr.city);
                else if (addr.town) parts.push(addr.town);
                else if (addr.village) parts.push(addr.village);
                // Add county
                if (addr.county) parts.push(addr.county);

                if (parts.length > 0) {
                    displayAddress = parts.join(', ');
                }
            }

            // Remove previous address marker if exists
            if (this.addressMarker) {
                this.addressMarker.remove();
            }

            // Add marker at address location
            if (mapController.map) {
                this.addressMarker = L.marker([lat, lng], {
                    title: displayAddress.split(',')[0]
                }).addTo(mapController.map);

                // Add popup with address
                this.addressMarker.bindPopup(`<strong>${this.escapeHtml(displayAddress)}</strong>`).openPopup();
            }

            // Find features containing this point
            const matches = this.findFeaturesAtPoint(lat, lng);

            let html = `
                <div class="address-results__header">
                    <span>📍 ${this.escapeHtml(displayAddress)}</span>
                    <button class="address-results__close" title="Close">×</button>
                </div>
            `;

            if (matches.length > 0) {
                html += '<div><em>Features at this location:</em></div>';
                matches.forEach(match => {
                    html += `
                        <div class="address-results__match" data-lat="${lat}" data-lng="${lng}">
                            <span class="address-results__color" style="background:${match.color}"></span>
                            <span><strong>${this.escapeHtml(match.layerName)}:</strong> ${this.escapeHtml(match.featureName)}</span>
                        </div>
                    `;
                });
            } else {
                html += '<div><em>No loaded layers contain this location.</em></div>';
            }

            resultsContainer.innerHTML = html;

            // Zoom to location
            if (mapController.map) {
                mapController.map.setView([lat, lng], 14);
            }

            // Setup close button and match clicks
            this.setupAddressResultsClose(resultsContainer);
            resultsContainer.querySelectorAll('.address-results__match').forEach(el => {
                el.addEventListener('click', () => {
                    mapController.map?.setView([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)], 15);
                });
            });

        } catch (err) {
            console.error('[App] Address search failed:', err);
            resultsContainer.innerHTML = `
                <div class="address-results__header">
                    <span>Search failed</span>
                    <button class="address-results__close" title="Close">×</button>
                </div>
            `;
            this.setupAddressResultsClose(resultsContainer);
        }
    }

    /**
     * Setup close button for address results
     */
    setupAddressResultsClose(container) {
        container.querySelector('.address-results__close')?.addEventListener('click', () => {
            container.classList.add('hidden');
        });
    }

    /**
     * Escape HTML for safe display
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Setup address search - now integrated into main search
     */
    setupAddressSearch() {
        // Address search is now integrated into setupSearch()
        // This method kept for compatibility
    }


    /**
     * Find all loaded features containing a lat/lng point
     */
    findFeaturesAtPoint(lat, lng) {
        const matches = [];
        const point = turf.point([lng, lat]);

        mapController.layerStates.forEach((state, mapId) => {
            if (!state.loaded || !state.visible) return;

            const mapConfig = state.config;
            const layerName = mapConfig?.name || mapId;
            const color = mapConfig?.style?.color || '#3388ff';

            state.geoJsonLayers.forEach(geoJsonLayer => {
                geoJsonLayer.eachLayer(layer => {
                    if (!layer.feature) return;

                    const geomType = layer.feature.geometry?.type;
                    if (geomType?.includes('Polygon')) {
                        try {
                            if (turf.booleanPointInPolygon(point, layer.feature)) {
                                const featureName = layer.feature.properties?.[mapConfig?.labelProperty] ||
                                    layer.feature.properties?.name ||
                                    layer.feature.properties?.NAME ||
                                    'Unnamed feature';
                                matches.push({ mapId, layerName, featureName, color });
                            }
                        } catch (e) {
                            // Ignore invalid geometries
                        }
                    }
                });
            });
        });

        return matches;
    }

    /**
     * Setup map controls (base map, overlays, transparency, labels, text size)
     */
    setupMapControls() {
        // Collapsible map settings panel
        const mapControlsToggle = document.getElementById('mapControlsToggle');
        const mapControlPanel = document.getElementById('mapControlPanel');
        const mapControlsClose = document.getElementById('mapControlsClose');
        if (mapControlsToggle && mapControlPanel) {
            mapControlsToggle.addEventListener('click', () => {
                const isExpanded = mapControlsToggle.getAttribute('aria-expanded') === 'true';
                mapControlsToggle.setAttribute('aria-expanded', !isExpanded);
                mapControlPanel.classList.toggle('map-control-panel--collapsed', isExpanded);
                mapControlPanel.classList.toggle('map-control-panel--expanded', !isExpanded);
            });

            // Close button in panel header
            if (mapControlsClose) {
                mapControlsClose.addEventListener('click', () => {
                    mapControlPanel.classList.add('map-control-panel--collapsed');
                    mapControlPanel.classList.remove('map-control-panel--expanded');
                    mapControlsToggle.setAttribute('aria-expanded', 'false');
                });
            }
        }

        // Collapsible overlay layers list
        const overlayToggle = document.getElementById('overlayToggle');
        const overlayList = document.getElementById('overlayList');
        if (overlayToggle && overlayList) {
            overlayToggle.addEventListener('click', () => {
                const isExpanded = overlayToggle.getAttribute('aria-expanded') === 'true';
                overlayToggle.setAttribute('aria-expanded', !isExpanded);
                overlayList.classList.toggle('overlay-list--collapsed', isExpanded);
                overlayList.classList.toggle('overlay-list--expanded', !isExpanded);
            });
        }

        // Base map selector
        const baseMapSelect = document.getElementById('baseMapSelect');
        if (baseMapSelect) {
            baseMapSelect.addEventListener('change', () => {
                mapController.setBaseMap(baseMapSelect.value);
                this.updateURLState();
            });
        }

        // Overlay layers (Global Watersheds)
        this.setupOverlayToggle('overlayVoyagerLabels', 'voyager-labels');
        this.setupOverlayToggle('overlayMeritCatchments', 'merit-catchments');
        this.setupOverlayToggle('overlayMeritRivers', 'merit-rivers');
        this.setupOverlayToggle('overlayNhdFlowlines', 'nhd-flowlines');

        // Transparency slider (outline)
        const transparencySlider = document.getElementById('transparencySlider');
        const transparencyValue = document.getElementById('transparencyValue');
        if (transparencySlider) {
            transparencySlider.addEventListener('input', () => {
                const value = Number(transparencySlider.value);
                mapController.setTransparency(value);
                if (transparencyValue) {
                    transparencyValue.textContent = `${value}%`;
                }
            });
        }

        // Fill transparency slider
        const fillTransparencySlider = document.getElementById('fillTransparencySlider');
        const fillTransparencyValue = document.getElementById('fillTransparencyValue');
        if (fillTransparencySlider) {
            fillTransparencySlider.addEventListener('input', () => {
                const value = Number(fillTransparencySlider.value);
                mapController.setFillTransparency(value);
                if (fillTransparencyValue) {
                    fillTransparencyValue.textContent = `${value}%`;
                }
            });
        }

        // Labels toggle
        const labelsToggle = document.getElementById('labelsToggle');
        if (labelsToggle) {
            labelsToggle.addEventListener('change', () => {
                mapController.setLabelsEnabled(labelsToggle.checked);
            });
        }

        // Text size controls
        this.setupTextSizeControls();

        // Category toggle for collapsible pills
        this.setupCategoryToggle();

        // Feature info close button
        const closeBtn = document.getElementById('featureInfoClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                uiController.hideFeatureInfo();
            });
        }

        // Active Layers toggle button
        const activeLayersToggle = document.getElementById('activeLayersToggle');
        const activeLayers = document.getElementById('activeLayers');
        if (activeLayersToggle && activeLayers) {
            activeLayersToggle.addEventListener('click', () => {
                const isExpanded = activeLayersToggle.getAttribute('aria-expanded') === 'true';
                activeLayersToggle.setAttribute('aria-expanded', !isExpanded);
                activeLayers.classList.toggle('hidden', isExpanded);
            });
        }

        // Active Layers close button
        const activeLayersClose = document.getElementById('activeLayersClose');
        if (activeLayersClose && activeLayers && activeLayersToggle) {
            activeLayersClose.addEventListener('click', () => {
                activeLayers.classList.add('hidden');
                activeLayersToggle.setAttribute('aria-expanded', 'false');
            });
        }

        // Map move/zoom events for URL state
        if (mapController.map) {
            mapController.map.on('moveend', () => {
                this.updateURLState();
            });
        }
    }

    /**
     * Setup category pills toggle
     */
    setupCategoryToggle() {
        // Note: Category toggle is now handled by uiController.renderCategoryPills()

        // Authors toggle
        const authorsToggle = document.getElementById('authorsToggle');
        const authorsList = document.getElementById('authorsList');
        if (authorsToggle && authorsList) {
            authorsToggle.addEventListener('click', () => {
                const isExpanded = authorsToggle.getAttribute('aria-expanded') === 'true';
                authorsToggle.setAttribute('aria-expanded', !isExpanded);
                authorsList.classList.toggle('filter-section__list--collapsed', isExpanded);
                authorsList.classList.toggle('filter-section__list--expanded', !isExpanded);
            });
            // Populate authors
            this.populateAuthors();
        }

        // Split toggle (2 buttons - quarter shift)
        this.setupSplitToggle();
    }

    /**
     * Setup draggable split bar for resizing pane widths
     */
    setupSplitToggle() {
        const splitDrag = document.getElementById('splitDrag');
        const appShell = document.querySelector('.app-shell');

        if (!splitDrag || !appShell) return;

        let isDragging = false;
        let startX = 0;
        let startSplit = this.splitPosition;

        // Mouse down starts dragging
        splitDrag.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startSplit = this.splitPosition;
            document.body.classList.add('split-dragging');
            e.preventDefault();
        });

        // Mouse move during drag
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const windowWidth = window.innerWidth;
            const minBuffer = 5; // 5px buffer from edges
            const minPercent = (minBuffer / windowWidth) * 100;
            const maxPercent = 100 - minPercent;

            // Calculate new split position based on mouse position
            const newPosition = (e.clientX / windowWidth) * 100;
            this.splitPosition = Math.max(minPercent, Math.min(maxPercent, newPosition));
            this.applySplitPosition(appShell);
        });

        // Mouse up ends dragging
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.classList.remove('split-dragging');
            }
        });

        // Touch support for mobile
        splitDrag.addEventListener('touchstart', (e) => {
            isDragging = true;
            startX = e.touches[0].clientX;
            startSplit = this.splitPosition;
            document.body.classList.add('split-dragging');
            e.preventDefault();
        });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;

            const windowWidth = window.innerWidth;
            const minBuffer = 5;
            const minPercent = (minBuffer / windowWidth) * 100;
            const maxPercent = 100 - minPercent;

            const newPosition = (e.touches[0].clientX / windowWidth) * 100;
            this.splitPosition = Math.max(minPercent, Math.min(maxPercent, newPosition));
            this.applySplitPosition(appShell);
        });

        document.addEventListener('touchend', () => {
            if (isDragging) {
                isDragging = false;
                document.body.classList.remove('split-dragging');
            }
        });
    }

    /**
     * Apply split position as CSS custom property
     */
    applySplitPosition(appShell) {
        appShell.style.setProperty('--split-position', `${this.splitPosition}%`);
        mapController.invalidateSize();
        this.updateURLState();
        this.updateColumnLayout();
    }

    /**
     * Update map list column layout based on sidebar width
     * When sidebar is wide enough (>600px), use 2-column grid layout
     */
    updateColumnLayout() {
        const mapList = document.getElementById('mapList');
        const infoPane = document.querySelector('.pane--info');
        if (!mapList || !infoPane) return;

        const sidebarWidth = infoPane.offsetWidth;
        const columnThreshold = 600; // px - minimum width for 2-column mode

        if (sidebarWidth >= columnThreshold) {
            mapList.classList.add('map-list--columns');
        } else {
            mapList.classList.remove('map-list--columns');
        }
    }

    /**
     * Populate authors filter list
     */
    populateAuthors() {
        const authorsList = document.getElementById('authorsList');
        if (!authorsList) return;

        const maps = dataService.getAllMaps();
        const authors = new Set();
        maps.forEach(m => {
            if (m.provider) {
                m.provider.forEach(p => authors.add(p));
            }
        });

        authorsList.innerHTML = '';
        const sortedAuthors = Array.from(authors).sort();
        sortedAuthors.forEach(author => {
            const pill = document.createElement('button');
            pill.className = 'category-pill';
            pill.textContent = author;
            pill.addEventListener('click', () => {
                this.currentAuthor = author;
                this.updateMapList();
                // Update active state
                authorsList.querySelectorAll('.category-pill').forEach(p =>
                    p.classList.toggle('category-pill--active', p.textContent === author)
                );
            });
            authorsList.appendChild(pill);
        });
    }

    /**
     * Setup overlay toggle
     */
    setupOverlayToggle(elementId, overlayId) {
        const checkbox = document.getElementById(elementId);
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                mapController.toggleOverlay(overlayId, checkbox.checked);
            });
        }
    }

    /**
     * Setup text size controls
     */
    setupTextSizeControls() {
        const decreaseBtn = document.getElementById('textSizeDecrease');
        const increaseBtn = document.getElementById('textSizeIncrease');
        const valueDisplay = document.getElementById('textSizeValue');
        const shell = document.querySelector('.app-shell');

        if (decreaseBtn && increaseBtn && valueDisplay && shell) {
            // Load saved text scale
            try {
                const saved = localStorage.getItem('ni-boundaries.textScale');
                if (saved) {
                    this.textScale = parseInt(saved);
                    this.applyTextScale();
                }
            } catch (e) { }

            decreaseBtn.addEventListener('click', () => {
                const currentIndex = this.textScaleSteps.indexOf(this.textScale);
                if (currentIndex > 0) {
                    this.textScale = this.textScaleSteps[currentIndex - 1];
                    this.applyTextScale();
                }
            });

            increaseBtn.addEventListener('click', () => {
                const currentIndex = this.textScaleSteps.indexOf(this.textScale);
                if (currentIndex < this.textScaleSteps.length - 1) {
                    this.textScale = this.textScaleSteps[currentIndex + 1];
                    this.applyTextScale();
                }
            });
        }
    }

    /**
     * Apply text scale to UI and map labels
     */
    applyTextScale() {
        const shell = document.querySelector('.app-shell');
        const valueDisplay = document.getElementById('textSizeValue');

        if (shell) {
            shell.dataset.textScale = this.textScale;
        }

        if (valueDisplay) {
            valueDisplay.textContent = `${this.textScale}%`;
        }

        // Update map labels
        mapController.setTextScale(this.textScale);

        // Save preference
        try {
            localStorage.setItem('ni-boundaries.textScale', this.textScale.toString());
        } catch (e) { }
    }

    /**
     * Setup URL state handling
     */
    setupURLState() {
        // Listen for hash changes
        window.addEventListener('hashchange', () => {
            this.loadURLState();
        });
    }

    /**
     * Update URL hash with current state
     */
    updateURLState() {
        if (!this.initialized || !mapController.map) return;

        const state = mapController.getMapState();
        const params = new URLSearchParams();

        if (state.layers.length > 0) {
            params.set('layers', state.layers.join(','));
        }
        if (state.zoom) {
            params.set('zoom', state.zoom.toString());
        }
        if (state.lat && state.lng) {
            params.set('lat', state.lat);
            params.set('lng', state.lng);
        }
        if (state.baseMap && state.baseMap !== 'cartodb-dark') {
            params.set('base', state.baseMap);
        }

        const hash = params.toString();
        if (hash) {
            history.replaceState(null, '', `#${hash}`);
        }
    }

    /**
     * Load state from URL hash or path
     */
    async loadURLState() {
        // Check for path-based deep links first (e.g., /map/lgd-2012)
        const pathname = window.location.pathname;

        // Handle /map/{mapId} path
        const mapMatch = pathname.match(/^\/map\/([^/]+)\/?$/);
        if (mapMatch) {
            const mapId = mapMatch[1];
            const mapConfig = dataService.getMapById(mapId);
            if (mapConfig) {
                await mapController.loadLayer(mapConfig, true);
                uiController.updateMapCardState(mapId, true);

                // Zoom to map bounds if available
                if (mapConfig.bounds) {
                    mapController.map?.fitBounds(mapConfig.bounds);
                }

                this.updateMapList();
                this.updateActiveLayers();
                return true;
            }
        }

        // Handle /feature/{mapId}/{featureId} path
        const featureMatch = pathname.match(/^\/feature\/([^/]+)\/([^/]+)\/?$/);
        if (featureMatch) {
            const [, mapId, featureId] = featureMatch;
            const mapConfig = dataService.getMapById(mapId);
            if (mapConfig) {
                await mapController.loadLayer(mapConfig, true);
                uiController.updateMapCardState(mapId, true);

                // Highlight specific feature
                setTimeout(() => {
                    if (uiController.onHighlightFeature) {
                        uiController.onHighlightFeature(mapId, featureId);
                    }
                }, 500);

                this.updateMapList();
                this.updateActiveLayers();
                return true;
            }
        }

        // Fall back to hash-based state
        const hash = window.location.hash.slice(1);
        if (!hash) return false;

        try {
            const params = new URLSearchParams(hash);

            // Apply base map
            const baseMap = params.get('base');
            if (baseMap) {
                mapController.setBaseMap(baseMap);
                const select = document.getElementById('baseMapSelect');
                if (select) select.value = baseMap;
            }

            // Apply map position
            const lat = params.get('lat');
            const lng = params.get('lng');
            const zoom = params.get('zoom');
            if (lat && lng && zoom) {
                mapController.applyMapState({ lat, lng, zoom });
            }

            // Load layers
            const layersParam = params.get('layers');
            if (layersParam) {
                const layerIds = layersParam.split(',');
                for (const mapId of layerIds) {
                    const mapConfig = dataService.getMapById(mapId);
                    if (mapConfig) {
                        await mapController.loadLayer(mapConfig, true);
                        uiController.updateMapCardState(mapId, true);
                    }
                }
                // Update active layers panel with loaded layers
                this.updateMapList();
                this.updateActiveLayers();
                return true;
            }
        } catch (e) {
            console.warn('[App] Failed to parse URL state:', e);
        }

        return false;
    }

    /**
     * Render category pills
     */
    renderCategoryPills() {
        const categories = dataService.getMapCategories();
        uiController.renderCategoryPills(categories, this.currentCategory);
        uiController.renderProviderPills(this.currentProviderCategory);
    }

    /**
     * Update the map list based on current filters
     */
    updateMapList() {
        const allMaps = dataService.getAllMaps();
        let maps = dataService.getMapsByCategory(this.currentCategory);

        // Filter by author if selected
        if (this.currentAuthor !== 'all') {
            maps = maps.filter(m => m.provider?.includes(this.currentAuthor));
        }

        // Filter by provider category if selected
        if (this.currentProviderCategory !== 'all-providers' && this.currentProviderList.length > 0) {
            maps = maps.filter(m => {
                const mapProviders = m.provider || [];
                return mapProviders.some(p => this.currentProviderList.includes(p));
            });
        }

        if (this.searchQuery) {
            maps = dataService.searchMaps(this.searchQuery);
            if (this.currentCategory !== 'all') {
                maps = maps.filter(m => m.category === this.currentCategory);
            }
            if (this.currentAuthor !== 'all') {
                maps = maps.filter(m => m.provider?.includes(this.currentAuthor));
            }
        }

        const visibleIds = mapController.getVisibleLayers();
        const loadedIds = this.getLoadedLayerIds();

        // Build feature counts map from spatial index (for all maps)
        const featureCounts = new Map();
        maps.forEach(map => {
            const count = featureLoader.getFeatureCount(map.id);
            if (count > 0) {
                featureCounts.set(map.id, count);
            }
        });

        uiController.renderMapList(maps, {
            visibleIds,
            loadedIds,
            featureCounts,
            totalMaps: allMaps.length
        });
    }

    /**
     * Get list of loaded layer IDs (including groups where all members are loaded)
     */
    getLoadedLayerIds() {
        const ids = [];
        mapController.layerStates.forEach((state, id) => {
            if (state.loaded) ids.push(id);
        });

        // Also check for group maps where all members are loaded
        const allMaps = dataService.getAllMaps();
        allMaps.forEach(map => {
            if (map.isGroup && map.members && !ids.includes(map.id)) {
                const allMembersLoaded = map.members.every(memberId => ids.includes(memberId));
                if (allMembersLoaded) {
                    ids.push(map.id);
                }
            }
        });

        return ids;
    }

    /**
     * Update the active layers panel
     */
    updateActiveLayers() {
        const loadedIds = this.getLoadedLayerIds();
        const loadedMaps = loadedIds.map(id => dataService.getMapById(id)).filter(Boolean);
        const visibilityMap = new Map();
        const partialLayerInfo = new Map();

        loadedIds.forEach(id => {
            visibilityMap.set(id, mapController.isLayerVisible(id));

            // Check if this is a partial layer (individual features only)
            const isPartial = mapController.isPartialLayer(id);
            if (isPartial) {
                const featureNames = mapController.getPartialFeatureNames(id);
                partialLayerInfo.set(id, { isPartial: true, featureNames });
            }
        });

        uiController.updateActiveLayers(loadedMaps, visibilityMap, partialLayerInfo);

        // Update time slider for time-series navigation
        timeSliderController.updateForActiveLayers(loadedIds);
    }

    /**
     * Load a map layer
     */
    async loadMap(mapId) {
        const mapConfig = dataService.getMapById(mapId);
        if (mapConfig) {
            await mapController.loadLayer(mapConfig, true);
            mapController.fitToLayer(mapId);
            this.updateURLState();
        }
    }

    /**
     * Toggle a map layer (legacy compatibility)
     */
    async toggleMap(mapId) {
        const state = mapController.getLayerState(mapId);

        if (state?.loaded) {
            mapController.toggleLayer(mapId);
        } else {
            await this.loadMap(mapId);
        }

        this.updateMapList();
        this.updateActiveLayers();
        this.updateURLState();
    }

    /**
     * Load default layers
     */
    async loadDefaultLayers() {
        const defaultMaps = dataService.getDefaultMaps();

        for (const map of defaultMaps) {
            await mapController.loadLayer(map, true);
            uiController.updateMapCardState(map.id, true);
        }

        // Update UI to reflect loaded layers
        this.updateMapList();
        this.updateActiveLayers();
    }

    /**
     * Show error message
     */
    showError(message) {
        const container = document.getElementById('errorContainer');
        if (container) {
            container.textContent = message;
            container.classList.remove('hidden');
        }
    }

    /**
     * Register service worker for PWA support
     */
    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('[App] Service worker registered:', registration.scope);

                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    console.log('[App] New content available, refresh to update');
                                }
                            });
                        }
                    });
                })
                .catch(err => {
                    console.warn('[App] Service worker registration failed:', err);
                });
        }
    }

    /**
     * Setup keyboard shortcuts for power users
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't interfere with typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                if (e.key === 'Escape') {
                    e.target.blur();
                }
                return;
            }

            // Ctrl+K or / - Focus search
            if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !e.ctrlKey && !e.metaKey)) {
                e.preventDefault();
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
                return;
            }

            // Escape - Close modals/panels
            if (e.key === 'Escape') {
                // Close shortcuts modal
                const modal = document.getElementById('shortcutsModal');
                if (modal && !modal.classList.contains('hidden')) {
                    modal.classList.add('hidden');
                    return;
                }
                // Close feature info
                uiController.hideFeatureInfo?.();
                // Close autocomplete
                const autocomplete = document.getElementById('searchAutocomplete');
                if (autocomplete) autocomplete.classList.add('hidden');
                return;
            }

            // ? - Show shortcuts modal
            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                this.showShortcutsModal();
                return;
            }

            // F - Toggle fullscreen map
            if (e.key === 'f' || e.key === 'F') {
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    uiController.cycleSplitState?.();
                }
                return;
            }

            // 1-9 - Jump to category by index
            if (e.key >= '1' && e.key <= '9') {
                const categories = document.querySelectorAll('.category-pill');
                const index = parseInt(e.key) - 1;
                if (categories[index]) {
                    categories[index].click();
                }
                return;
            }

            // Arrow keys - Navigate active timeline slider
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const activeSlider = document.querySelector('.timeline-slider:focus');
                if (activeSlider) {
                    const step = e.key === 'ArrowRight' ? 1 : -1;
                    activeSlider.value = Math.max(0, Math.min(
                        parseInt(activeSlider.max),
                        parseInt(activeSlider.value) + step
                    ));
                    activeSlider.dispatchEvent(new Event('input'));
                }
            }
        });
    }

    /**
     * Show keyboard shortcuts modal
     */
    showShortcutsModal() {
        let modal = document.getElementById('shortcutsModal');

        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'shortcutsModal';
            modal.className = 'shortcuts-modal';
            modal.innerHTML = `
                <div class="shortcuts-modal__content">
                    <div class="shortcuts-modal__header">
                        <h2>Keyboard Shortcuts</h2>
                        <button class="shortcuts-modal__close" title="Close">×</button>
                    </div>
                    <div class="shortcuts-modal__body">
                        <div class="shortcuts-group">
                            <h3>Navigation</h3>
                            <div class="shortcut"><kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd><span>Open search</span></div>
                            <div class="shortcut"><kbd>1</kbd> - <kbd>9</kbd><span>Jump to category</span></div>
                            <div class="shortcut"><kbd>F</kbd><span>Toggle split view</span></div>
                            <div class="shortcut"><kbd>Esc</kbd><span>Close panels</span></div>
                        </div>
                        <div class="shortcuts-group">
                            <h3>Timeline</h3>
                            <div class="shortcut"><kbd>←</kbd> / <kbd>→</kbd><span>Navigate slider (when focused)</span></div>
                        </div>
                        <div class="shortcuts-group">
                            <h3>Help</h3>
                            <div class="shortcut"><kbd>?</kbd><span>Show this modal</span></div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.querySelector('.shortcuts-modal__close').addEventListener('click', () => {
                modal.classList.add('hidden');
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        }

        modal.classList.remove('hidden');
    }

    /**
     * Prefetch nearby maps for faster loading (2.1)
     */
    prefetchNearbyMaps(visibleMapIds) {
        if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;

        const data = dataService.getData();
        if (!data?.maps) return;

        // Get FGB URLs for nearby maps not yet loaded
        const loadedIds = new Set(mapController.layerStates.keys());
        const urlsToPrefetch = [];

        visibleMapIds.slice(0, 5).forEach(mapId => {
            if (loadedIds.has(mapId)) return;
            const mapConfig = data.maps.find(m => m.id === mapId);
            if (mapConfig?.file) {
                urlsToPrefetch.push(`/data/${mapConfig.file}`);
            }
        });

        if (urlsToPrefetch.length > 0) {
            navigator.serviceWorker.controller.postMessage({
                type: 'PREFETCH_FGB',
                urls: urlsToPrefetch
            });
        }
    }
}

// Initialize app when DOM is ready
const app = new App();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}

export default app;
