/**
 * NI Boundaries - UI Controller
 * Handles split-pane layout, search, filtering, map catalogue, and UI interactions
 */

import dataService from './data-service.js';

class UIController {
    constructor() {
        this.splitStates = [
            { id: 'info-full', label: 'Info only', mobileLabel: 'Info' },
            { id: 'info-75', label: 'Info focus' },
            { id: 'balanced', label: 'Split 50/50' },
            { id: 'map-75', label: 'Map focus' },
            { id: 'map-full', label: 'Map only', mobileLabel: 'Map' }
        ];
        this.currentStateId = 'balanced';
        this.storageKey = 'ni-boundaries.split-preference.v2';
        this.isMobile = false;
        this.focusedCardIndex = -1;
        this._savedSliderValues = new Map();

        // When true, all maps show directly without 'Show X more maps' button
        this.showAllMaps = false;

        // Callbacks (set by App.js)
        this.onSplitChange = null;
        this.onMapLoad = null;
        this.onMapUnload = null;
        this.onMapToggle = null;
        this.onHideMap = null;
        this.onVisibilityToggle = null;
        this.onCategoryChange = null;
        this.onProviderCategoryChange = null;
        this.onExpandToFullMap = null;
        this.onSearch = null;
        this.onMapDetailClick = null;

        // Catalogue navigation state
        this.catalogueHistory = [];
        this.catalogueHistoryIndex = -1;
        this.catalogueView = 'list'; // 'list' or 'detail'
    }

    init() {
        this.mediaQuery = window.matchMedia('(max-width: 768px)');
        this.isMobile = this.mediaQuery.matches;
        this.mediaQuery.addEventListener('change', (e) => {
            this.isMobile = e.matches;
            this.updateSplitState();
        });
        this.loadPreference();
        this.setupSplitToggle();
        this.setupTabSwitching();
        this.setupCatalogueNav();
        this.setupMobileMenu();
        console.log('[UIController] Initialized');
        return this;
    }

    // ============================================
    // Mobile Navbar Dropdown
    // ============================================

    setupMobileMenu() {
        const btn = document.getElementById('mobileMenuBtn');
        const menu = document.getElementById('mobileMenu');
        if (!btn || !menu) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !menu.classList.contains('hidden');
            if (isOpen) {
                menu.classList.add('hidden');
                btn.setAttribute('aria-expanded', 'false');
            } else {
                menu.classList.remove('hidden');
                btn.setAttribute('aria-expanded', 'true');
            }
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
                menu.classList.add('hidden');
                btn.setAttribute('aria-expanded', 'false');
            }
        });

        // Wire mobile Support Us button to the existing support button
        const mobileSupportBtn = document.getElementById('mobileSupportBtn');
        const supportBtn = document.getElementById('supportBtn');
        if (mobileSupportBtn && supportBtn) {
            mobileSupportBtn.addEventListener('click', (e) => {
                e.preventDefault();
                supportBtn.click();
            });
        }
    }

    // ============================================
    // Catalogue Navigation & Detail View
    // ============================================

    setupCatalogueNav() {
        const backBtn = document.getElementById('catalogueBack');
        const forwardBtn = document.getElementById('catalogueForward');
        const historyBtn = document.getElementById('catalogueHistory');
        const homeBtn = document.getElementById('catalogueHome');

        if (backBtn) backBtn.addEventListener('click', () => this.catalogueGoBack());
        if (forwardBtn) forwardBtn.addEventListener('click', () => this.catalogueGoForward());
        if (historyBtn) historyBtn.addEventListener('click', () => this.showCatalogueHistory());
        if (homeBtn) homeBtn.addEventListener('click', () => this.showCatalogueListView());

        // Event delegation for map name links in the catalogue
        const listView = document.getElementById('catalogueListView');
        if (listView) {
            listView.addEventListener('click', (e) => {
                // Handle class member name links
                const classMemberLink = e.target.closest('.class-member__name-link');
                if (classMemberLink) {
                    e.preventDefault();
                    const mapId = classMemberLink.dataset.detailMapId;
                    if (mapId) this.showCatalogueDetailView(mapId);
                    return;
                }
                // Handle standalone map card name links
                const mapCardLink = e.target.closest('.map-card__name-link');
                if (mapCardLink) {
                    e.preventDefault();
                    const mapId = mapCardLink.dataset.detailMapId;
                    if (mapId) this.showCatalogueDetailView(mapId);
                    return;
                }
            });
        }
    }

    showCatalogueDetailView(mapId, addToHistory = true) {
        const map = dataService.getMapById(mapId);
        if (!map) {
            console.warn('[UIController] Map not found:', mapId);
            return;
        }

        // Add to history
        if (addToHistory) {
            // Truncate forward history
            this.catalogueHistory = this.catalogueHistory.slice(0, this.catalogueHistoryIndex + 1);
            this.catalogueHistory.push({ type: 'detail', mapId });
            this.catalogueHistoryIndex = this.catalogueHistory.length - 1;
        }

        this.catalogueView = 'detail';

        // Get DOM elements
        const nav = document.getElementById('catalogueNav');
        const listView = document.getElementById('catalogueListView');
        const detailView = document.getElementById('catalogueDetailView');

        if (!nav || !listView || !detailView) return;

        // Show nav, hide list, show detail
        nav.classList.remove('hidden');
        listView.classList.add('hidden');
        detailView.classList.remove('hidden');

        // Update nav button states
        this.updateCatalogueNavButtons();

        // Render detail content
        const isLoaded = this.onMapLoad ? false : false; // Will be updated by callback
        const color = map.style?.color || '#888';
        const formattedDate = this.formatMapDate(map.date) || '';

        // Get category name
        const categories = dataService.getMapCategories() || [];
        const category = categories.find(c => c.id === map.category);
        const categoryName = category?.name || map.category || 'Unknown';

        // Build badges HTML
        let badgesHtml = '';
        const badges = [];
        if (map.featured) badges.push('<span class="catalogue-detail__badge catalogue-detail__badge--featured">⭐ Featured</span>');
        if (map.isGroup) badges.push('<span class="catalogue-detail__badge catalogue-detail__badge--group">📦 Group</span>');
        if (map.hidden) badges.push('<span class="catalogue-detail__badge catalogue-detail__badge--hidden">👁️ Hidden</span>');
        if (badges.length > 0) {
            badgesHtml = `<div class="catalogue-detail__badges">${badges.join('')}</div>`;
        }

        // Build description HTML
        const descriptionHtml = map.description
            ? `<div class="catalogue-detail__description">${this.escapeHtml(map.description)}</div>`
            : '';

        // Build keywords HTML
        const keywordsHtml = (map.keywords || []).map(k =>
            `<span class="catalogue-detail__keyword">${this.escapeHtml(k)}</span>`
        ).join('');

        // Build file path HTML
        const filePath = map.files?.fgb || map.files?.geojson || null;

        // Build style info
        const styleInfo = [];
        if (map.style?.color) styleInfo.push(`Color: ${map.style.color}`);
        if (map.style?.weight) styleInfo.push(`Weight: ${map.style.weight}`);
        if (map.style?.fillOpacity !== undefined) styleInfo.push(`Fill: ${map.style.fillOpacity}`);
        const styleStr = styleInfo.join(', ');

        // Build variants HTML
        let variantsHtml = '';
        if (map.isGroup && map.variants && map.variants.length > 0) {
            variantsHtml = `
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Variants (${map.variants.length})</div>
                    <div class="catalogue-detail__variants">
                        ${map.variants.map(v => {
                const variant = dataService.getMapById(v.id);
                return variant ? `
                                <div class="catalogue-detail__variant" data-map-id="${variant.id}">
                                    ${this.escapeHtml(variant.name)}
                                    ${variant.provider ? `<span style="color: var(--color-text-muted); font-size: var(--text-xs);"> · ${variant.provider.join(', ')}</span>` : ''}
                                </div>
                            ` : '';
            }).join('')}
                    </div>
                </div>`;
        }

        // Build members HTML (for groups without explicit variants)
        let membersHtml = '';
        if (map.isGroup && map.members && map.members.length > 0 && (!map.variants || map.variants.length === 0)) {
            membersHtml = `
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Members (${map.members.length})</div>
                    <div class="catalogue-detail__variants">
                        ${map.members.map(memberId => {
                const member = dataService.getMapById(memberId);
                return member ? `
                                <div class="catalogue-detail__variant" data-map-id="${member.id}">
                                    ${this.escapeHtml(member.name)}
                                    ${member.provider ? `<span style="color: var(--color-text-muted); font-size: var(--text-xs);"> · ${member.provider.join(', ')}</span>` : ''}
                                </div>
                            ` : `<div class="catalogue-detail__variant">${this.escapeHtml(memberId)}</div>`;
            }).join('')}
                    </div>
                </div>`;
        }

        detailView.innerHTML = `
            <button class="catalogue-detail__back" id="catalogueBackLink">
                ← Back to Catalogue
            </button>

            <div class="catalogue-detail__card">
                <div class="catalogue-detail__color" style="background-color: ${color}"></div>
                <div class="catalogue-detail__name">${this.escapeHtml(map.name)}</div>
                ${formattedDate ? `<div class="catalogue-detail__date">${formattedDate}</div>` : ''}
            </div>

            ${badgesHtml}

            ${descriptionHtml}

            <button class="catalogue-detail__load-btn" data-map-id="${map.id}">
                ▷ Load Map
            </button>

            <div class="catalogue-detail__meta">
                <div class="catalogue-detail__meta-row">
                    <span class="catalogue-detail__meta-label">Provider</span>
                    <span class="catalogue-detail__meta-value">${map.provider ? this.escapeHtml(map.provider.join(', ')) : 'Unknown'}</span>
                </div>
                <div class="catalogue-detail__meta-row">
                    <span class="catalogue-detail__meta-label">Category</span>
                    <span class="catalogue-detail__meta-value">${this.escapeHtml(categoryName)}</span>
                </div>
                ${map.slug ? `
                <div class="catalogue-detail__meta-row">
                    <span class="catalogue-detail__meta-label">Slug</span>
                    <span class="catalogue-detail__meta-value catalogue-detail__meta-value--mono">${this.escapeHtml(map.slug)}</span>
                </div>` : ''}
                ${map.labelProperty ? `
                <div class="catalogue-detail__meta-row">
                    <span class="catalogue-detail__meta-label">Label Property</span>
                    <span class="catalogue-detail__meta-value catalogue-detail__meta-value--mono">${this.escapeHtml(map.labelProperty)}</span>
                </div>` : ''}
                ${map.priorityProperty ? `
                <div class="catalogue-detail__meta-row">
                    <span class="catalogue-detail__meta-label">Priority Property</span>
                    <span class="catalogue-detail__meta-value catalogue-detail__meta-value--mono">${this.escapeHtml(map.priorityProperty)}</span>
                </div>` : ''}
                ${styleStr ? `
                <div class="catalogue-detail__meta-row">
                    <span class="catalogue-detail__meta-label">Style</span>
                    <span class="catalogue-detail__meta-value">${this.escapeHtml(styleStr)}</span>
                </div>` : ''}
                ${filePath ? `
                <div class="catalogue-detail__meta-row">
                    <span class="catalogue-detail__meta-label">Data File</span>
                    <span class="catalogue-detail__meta-value catalogue-detail__file-path">${this.escapeHtml(filePath)}</span>
                </div>` : ''}
            </div>

            ${keywordsHtml ? `
            <div class="catalogue-detail__section">
                <div class="catalogue-detail__section-title">Keywords</div>
                <div class="catalogue-detail__keywords">${keywordsHtml}</div>
            </div>` : ''}

            ${variantsHtml}
            ${membersHtml}

            <div class="catalogue-detail__attr-table" id="catalogueAttrTable">
                <div class="catalogue-detail__attr-table-header" id="catalogueAttrTableHeader">
                    <span class="catalogue-detail__attr-table-title">📋 Feature Attributes</span>
                    <span class="catalogue-detail__attr-table-toggle">▼</span>
                </div>
                <div class="catalogue-detail__attr-table-body" id="catalogueAttrTableBody">
                    <div class="catalogue-detail__attr-loading">Loading attributes...</div>
                </div>
            </div>
        `;

        // Add event listeners
        const backLink = document.getElementById('catalogueBackLink');
        if (backLink) {
            backLink.addEventListener('click', () => this.showCatalogueListView());
        }

        const loadBtn = detailView.querySelector('.catalogue-detail__load-btn');
        if (loadBtn) {
            loadBtn.addEventListener('click', () => {
                if (this.onMapLoad) this.onMapLoad(map.id);
            });
        }

        // Variant click handlers
        detailView.querySelectorAll('.catalogue-detail__variant').forEach(el => {
            el.addEventListener('click', () => {
                const variantId = el.dataset.mapId;
                if (variantId) this.showCatalogueDetailView(variantId);
            });
        });

        // Attribute table toggle
        const attrTableHeader = document.getElementById('catalogueAttrTableHeader');
        const attrTableBody = document.getElementById('catalogueAttrTableBody');
        if (attrTableHeader && attrTableBody) {
            attrTableHeader.addEventListener('click', () => {
                attrTableBody.classList.toggle('catalogue-detail__attr-table-body--collapsed');
                const toggle = attrTableHeader.querySelector('.catalogue-detail__attr-table-toggle');
                if (toggle) {
                    toggle.textContent = attrTableBody.classList.contains('catalogue-detail__attr-table-body--collapsed') ? '▶' : '▼';
                }
            });
        }

        // Load attribute schema asynchronously
        this.loadAttributeSchema(map, filePath);
    }

    /**
     * Load attribute schema from features with lazy loading
     */
    async loadAttributeSchema(map, filePath) {
        const attrTableBody = document.getElementById('catalogueAttrTableBody');
        if (!attrTableBody) return;

        // If no file path, try to get from first variant or member
        let effectiveFilePath = filePath;
        if (!effectiveFilePath && map.isGroup) {
            if (map.variants && map.variants.length > 0) {
                const firstVariant = dataService.getMapById(map.variants[0].id);
                effectiveFilePath = firstVariant?.files?.fgb || firstVariant?.files?.geojson;
            } else if (map.members && map.members.length > 0) {
                const firstMember = dataService.getMapById(map.members[0]);
                effectiveFilePath = firstMember?.files?.fgb || firstMember?.files?.geojson;
            }
        }

        if (!effectiveFilePath) {
            attrTableBody.innerHTML = '<div class="catalogue-detail__attr-error">No data file available</div>';
            return;
        }

        try {
            const ext = effectiveFilePath.split('.').pop()?.toLowerCase();
            const batchSize = 50;
            let allFeatures = [];
            let attrKeys = null;
            let featureIterator = null;
            let totalLoaded = 0;
            let hasMore = true;
            let isLoading = false;

            // Function to load a batch of features
            const loadBatch = async () => {
                if (isLoading || !hasMore) return;
                isLoading = true;

                const startCount = allFeatures.length;

                if (ext === 'fgb') {
                    // For FGB, we need to iterate through the stream
                    if (!featureIterator) {
                        try {
                            const response = await fetch(effectiveFilePath);
                            featureIterator = flatgeobuf.deserialize(response.body)[Symbol.asyncIterator]();
                        } catch (err) {
                            featureIterator = flatgeobuf.deserialize(effectiveFilePath)[Symbol.asyncIterator]();
                        }
                    }

                    let count = 0;
                    while (count < batchSize) {
                        const result = await featureIterator.next();
                        if (result.done) {
                            hasMore = false;
                            break;
                        }
                        allFeatures.push(result.value);
                        count++;
                    }
                } else {
                    // GeoJSON - load all at once (already in memory)
                    if (allFeatures.length === 0) {
                        const response = await fetch(effectiveFilePath);
                        const data = await response.json();
                        allFeatures = data.features || [data];
                        hasMore = false;
                    }
                }

                // Get attribute keys from first feature
                if (!attrKeys && allFeatures.length > 0 && allFeatures[0].properties) {
                    attrKeys = Object.keys(allFeatures[0].properties);
                }

                totalLoaded = allFeatures.length;
                isLoading = false;
                return allFeatures.length > startCount;
            };

            // Function to render a feature row
            const renderRow = (feature) => {
                const cells = attrKeys.map(key => {
                    const value = feature.properties[key];
                    const displayValue = value === null ? '<em>null</em>' :
                        typeof value === 'object' ? JSON.stringify(value).substring(0, 30) + '...' :
                            String(value).substring(0, 50) + (String(value).length > 50 ? '...' : '');
                    return `<td class="catalogue-detail__attr-td" title="${this.escapeHtml(String(value))}">${displayValue}</td>`;
                }).join('');
                return `<tr class="catalogue-detail__attr-tr">${cells}</tr>`;
            };

            // Load initial batch
            await loadBatch();

            if (allFeatures.length === 0 || !attrKeys) {
                attrTableBody.innerHTML = '<div class="catalogue-detail__attr-error">No attributes found</div>';
                return;
            }

            // Build header row
            const headerCells = attrKeys.map(key =>
                `<th class="catalogue-detail__attr-th">${this.escapeHtml(key)}</th>`
            ).join('');

            // Build initial rows
            const initialRows = allFeatures.map(f => renderRow(f)).join('');

            attrTableBody.innerHTML = `
                <div class="catalogue-detail__attr-table-scroll" id="attrTableScroll">
                    <table class="catalogue-detail__attr-table-inner">
                        <thead>
                            <tr class="catalogue-detail__attr-tr catalogue-detail__attr-tr--header">${headerCells}</tr>
                        </thead>
                        <tbody id="attrTableTbody">${initialRows}</tbody>
                    </table>
                </div>
                <div class="catalogue-detail__attr-footer" id="attrTableFooter">
                    ${hasMore ? `Loaded ${totalLoaded} features (scroll for more)` : `Showing all ${totalLoaded} features`}
                </div>
            `;

            // Add scroll listener for lazy loading
            const scrollContainer = document.getElementById('attrTableScroll');
            const tbody = document.getElementById('attrTableTbody');
            const footer = document.getElementById('attrTableFooter');

            if (scrollContainer && hasMore) {
                scrollContainer.addEventListener('scroll', async () => {
                    // Check if scrolled near bottom
                    const scrollBottom = scrollContainer.scrollTop + scrollContainer.clientHeight;
                    const threshold = scrollContainer.scrollHeight - 50;

                    if (scrollBottom >= threshold && hasMore && !isLoading) {
                        const prevCount = allFeatures.length;
                        await loadBatch();

                        // Append new rows
                        if (allFeatures.length > prevCount) {
                            const newRows = allFeatures.slice(prevCount).map(f => renderRow(f)).join('');
                            tbody.insertAdjacentHTML('beforeend', newRows);
                        }

                        // Update footer
                        if (footer) {
                            footer.textContent = hasMore
                                ? `Loaded ${totalLoaded} features (scroll for more)`
                                : `Showing all ${totalLoaded} features`;
                        }
                    }
                });
            }

        } catch (err) {
            console.warn('[UIController] Failed to load attribute schema:', err);
            attrTableBody.innerHTML = `<div class="catalogue-detail__attr-error">Failed to load attributes</div>`;
        }
    }

    showCatalogueListView() {
        this.catalogueView = 'list';

        const nav = document.getElementById('catalogueNav');
        const listView = document.getElementById('catalogueListView');
        const detailView = document.getElementById('catalogueDetailView');

        if (!nav || !listView || !detailView) return;

        // Hide nav, show list, hide detail
        nav.classList.add('hidden');
        listView.classList.remove('hidden');
        detailView.classList.add('hidden');

        // Reset history when going home
        this.catalogueHistory = [];
        this.catalogueHistoryIndex = -1;
    }

    catalogueGoBack() {
        if (this.catalogueHistoryIndex > 0) {
            this.catalogueHistoryIndex--;
            const entry = this.catalogueHistory[this.catalogueHistoryIndex];
            if (entry.type === 'detail') {
                this.showCatalogueDetailView(entry.mapId, false);
            }
        } else {
            this.showCatalogueListView();
        }
        this.updateCatalogueNavButtons();
    }

    catalogueGoForward() {
        if (this.catalogueHistoryIndex < this.catalogueHistory.length - 1) {
            this.catalogueHistoryIndex++;
            const entry = this.catalogueHistory[this.catalogueHistoryIndex];
            if (entry.type === 'detail') {
                this.showCatalogueDetailView(entry.mapId, false);
            }
        }
        this.updateCatalogueNavButtons();
    }

    showCatalogueHistory() {
        // For now, just log history - could show a dropdown in future
        console.log('[Catalogue History]', this.catalogueHistory);
    }

    updateCatalogueNavButtons() {
        const backBtn = document.getElementById('catalogueBack');
        const forwardBtn = document.getElementById('catalogueForward');

        if (backBtn) {
            backBtn.disabled = this.catalogueHistoryIndex <= 0;
        }
        if (forwardBtn) {
            forwardBtn.disabled = this.catalogueHistoryIndex >= this.catalogueHistory.length - 1;
        }
    }

    setupTabSwitching() {
        const tabs = document.querySelectorAll('.pane-tab');
        const mapList = document.getElementById('mapList');
        const exploreContent = document.getElementById('exploreContent');
        const tablesContent = document.getElementById('tablesContent');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;
                this.showTab(tabId);
            });
        });
    }

    showTab(tabId) {
        const tabs = document.querySelectorAll('.pane-tab');
        const tabContents = document.querySelectorAll('.pane-tab-content');

        // Update active tab
        tabs.forEach(t => {
            const isActive = t.dataset.tab === tabId;
            t.classList.toggle('pane-tab--active', isActive);
            t.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        // Show/hide content areas using the correct CSS class
        tabContents.forEach(content => {
            const contentTab = content.dataset.tabContent;
            const isActive = contentTab === tabId;
            content.classList.toggle('pane-tab-content--hidden', !isActive);
        });

        // Initialize Explore tab on first view
        if (tabId === 'explore') {
            this.initializeExplore();
        }

        // Initialize Tables tab on first view
        if (tabId === 'tables') {
            this.initializeTables();
        }
    }

    setupSplitToggle() {
        const buttons = document.querySelectorAll('.split-toggle__btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action) this.setSplitState(action);
            });
        });
        this.updateSplitState();

        // Setup split-pane dragging
        this.setupSplitDrag();

        // Setup mobile toggle button
        this.setupMobileToggle();
    }

    setupMobileToggle() {
        const toggleBtn = document.getElementById('mobileToggle');
        if (!toggleBtn) return;

        toggleBtn.addEventListener('click', () => {
            // Toggle between map-full and info-full
            if (this.currentStateId === 'info-full') {
                this.setSplitState('map-full');
            } else {
                this.setSplitState('info-full');
            }
            // Invalidate Leaflet map size after transition
            setTimeout(() => {
                if (window.mapController?.map) {
                    window.mapController.map.invalidateSize();
                }
            }, 350);
        });
    }

    setupSplitDrag() {
        const splitDrag = document.getElementById('splitDrag');
        const appMain = document.querySelector('.app-main');

        if (!splitDrag || !appMain) return;

        let isDragging = false;
        let startX = 0;
        let startPosition = 50;

        const getPosition = (e) => {
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const rect = appMain.getBoundingClientRect();
            let percent = ((clientX - rect.left) / rect.width) * 100;

            // 5px protection buffer on edges
            const minPercent = (5 / rect.width) * 100;
            const maxPercent = 100 - minPercent;

            return Math.max(minPercent, Math.min(maxPercent, percent));
        };

        const startDrag = (e) => {
            isDragging = true;
            startX = e.touches ? e.touches[0].clientX : e.clientX;

            // Get current position from CSS variable
            const currentPos = getComputedStyle(appMain).getPropertyValue('--split-position');
            startPosition = parseFloat(currentPos) || 50;

            document.body.classList.add('split-dragging');
            e.preventDefault();
        };

        const doDrag = (e) => {
            if (!isDragging) return;

            const position = getPosition(e);
            appMain.style.setProperty('--split-position', `${position}%`);

            // Update state based on position
            if (position < 10) {
                this.currentStateId = 'map-full';
            } else if (position < 30) {
                this.currentStateId = 'map-75';
            } else if (position < 60) {
                this.currentStateId = 'balanced';
            } else if (position < 85) {
                this.currentStateId = 'info-75';
            } else {
                this.currentStateId = 'info-full';
            }
        };

        const endDrag = () => {
            if (!isDragging) return;

            isDragging = false;
            document.body.classList.remove('split-dragging');

            // Save preference
            this.savePreference();

            // Invalidate map size
            if (this.onSplitChange) {
                this.onSplitChange(this.currentStateId);
            }

            // Notify Leaflet to resize
            setTimeout(() => {
                if (window.mapController?.map) {
                    window.mapController.map.invalidateSize();
                }
            }, 50);
        };

        // Mouse events
        splitDrag.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', endDrag);

        // Touch events for mobile
        splitDrag.addEventListener('touchstart', startDrag, { passive: false });
        document.addEventListener('touchmove', doDrag, { passive: true });
        document.addEventListener('touchend', endDrag);

        // Double-click to reset to balanced
        splitDrag.addEventListener('dblclick', () => {
            this.setSplitState('balanced');
            appMain.style.setProperty('--split-position', '50%');
        });
    }

    setSplitState(stateId) {
        const allowedStates = this.getAllowedStates();
        if (!allowedStates.find(s => s.id === stateId)) {
            stateId = allowedStates[0]?.id || 'balanced';
        }
        this.currentStateId = stateId;
        this.updateSplitState();
        this.savePreference();
        if (this.onSplitChange) this.onSplitChange(stateId);

        // Ensure Leaflet map resizes when it becomes visible
        if (stateId !== 'info-full') {
            setTimeout(() => {
                if (window.mapController?.map) {
                    window.mapController.map.invalidateSize();
                }
            }, 350);
        }
    }

    cycleSplitState(direction = 1) {
        const allowedStates = this.getAllowedStates();
        const currentIndex = allowedStates.findIndex(s => s.id === this.currentStateId);
        const nextIndex = (currentIndex + direction + allowedStates.length) % allowedStates.length;
        this.setSplitState(allowedStates[nextIndex].id);
    }

    getAllowedStates() {
        if (this.isMobile) {
            // map-full first so it's the default on mobile (Leaflet needs a visible container)
            return [
                this.splitStates.find(s => s.id === 'map-full'),
                this.splitStates.find(s => s.id === 'info-full')
            ];
        }
        return this.splitStates;
    }

    updateSplitState() {
        const shell = document.querySelector('.app-shell');
        if (!shell) return;
        const allowedStates = this.getAllowedStates();
        if (!allowedStates.find(s => s.id === this.currentStateId)) {
            this.currentStateId = allowedStates[0]?.id || 'balanced';
        }
        shell.dataset.splitState = this.currentStateId;
        const buttons = document.querySelectorAll('.split-toggle__btn');
        buttons.forEach(btn => {
            const isActive = btn.dataset.action === this.currentStateId;
            btn.classList.toggle('split-toggle__btn--active', isActive);
            const stateId = btn.dataset.action;
            const isAllowed = allowedStates.some(s => s.id === stateId);
            btn.style.display = isAllowed ? '' : 'none';
        });

        const state = this.splitStates.find(s => s.id === this.currentStateId);
        if (state) this.announce(`View changed to ${state.label}`);
    }

    savePreference() {
        try {
            const pref = {
                desktop: this.isMobile ? null : this.currentStateId,
                mobile: this.isMobile ? this.currentStateId : null,
                last: this.currentStateId
            };
            const existing = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
            Object.assign(existing, pref);
            localStorage.setItem(this.storageKey, JSON.stringify(existing));
        } catch (err) { /* ignore */ }
    }

    loadPreference() {
        try {
            const pref = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
            const key = this.isMobile ? 'mobile' : 'desktop';
            const saved = pref[key] || pref.last;
            if (saved && this.getAllowedStates().some(s => s.id === saved)) {
                this.currentStateId = saved;
            }
        } catch (err) { /* use default */ }
    }

    announce(message) {
        const announcer = document.getElementById('announcer');
        if (announcer) {
            announcer.textContent = '';
            requestAnimationFrame(() => { announcer.textContent = message; });
        }
    }

    // ============================================
    // PHASE 2: Enhanced renderMapList
    // ============================================

    renderMapList(maps, options = {}) {
        const container = document.getElementById('mapList');
        if (!container) return;

        // Preserve slider positions before clearing
        const savedSliderValues = new Map();
        container.querySelectorAll('.map-card--class').forEach(card => {
            const classId = card.dataset.classId;
            const slider = card.querySelector('.timeline-slider');
            if (classId && slider) savedSliderValues.set(classId, slider.value);
        });
        container.querySelectorAll('.c1-card').forEach(card => {
            const c1Id = card.dataset.c1Id;
            const slider = card.querySelector('.timeline-slider');
            if (c1Id && slider) savedSliderValues.set(`c1:${c1Id}`, slider.value);
        });
        container.querySelectorAll('.conjoined-class-group').forEach(card => {
            const groupId = card.dataset.groupId;
            const slider = card.querySelector('.timeline-slider');
            if (groupId && slider) savedSliderValues.set(`group:${groupId}`, slider.value);
        });

        // Preserve expanded category toggle states
        const savedExpandedCategories = new Set();
        container.querySelectorAll('.category-more-maps--expanded').forEach(el => {
            if (el.dataset.categoryId) savedExpandedCategories.add(el.dataset.categoryId);
        });

        container.innerHTML = '';
        this.focusedCardIndex = -1;
        this._savedSliderValues = savedSliderValues;

        if (maps.length === 0) {
            container.innerHTML = '<p class="text-muted text-sm">No maps found</p>';
            this.updateFilterStats(0, options.totalMaps || 0);
            return;
        }

        // Use all classes (including hidden) for internal lookups
        const allClasses = dataService.getAllClasses() || [];
        // Use visible classes only for rendering standalone class cards
        const visibleClasses = dataService.getClasses() || [];
        const c1s = dataService.getC1s() || [];
        const mapIdToClass = new Map();
        const classesByCategory = new Map();

        // Build mapIdToClass from ALL classes (needed for C1 rendering)
        allClasses.forEach(cls => {
            (cls.maps || []).forEach(mapId => mapIdToClass.set(mapId, cls));
        });

        // Build classesByCategory from VISIBLE classes only (for standalone class cards)
        visibleClasses.forEach(cls => {
            const cat = cls.category || 'other';
            if (!classesByCategory.has(cat)) classesByCategory.set(cat, []);
            classesByCategory.get(cat).push(cls);
        });

        // Group maps by category
        const categories = dataService.getMapCategories() || [];
        const mapsByCategory = new Map();
        maps.forEach(map => {
            const cat = map.category || 'other';
            if (!mapsByCategory.has(cat)) mapsByCategory.set(cat, []);
            mapsByCategory.get(cat).push(map);
        });

        const renderedClasses = new Set();

        // Group categories by their `group` property
        const groupOrder = ['Communities', 'History', 'Elections and Government', 'Public Services', 'Physical Geography', 'Built Environment'];
        const categoriesByGroup = new Map();
        groupOrder.forEach(g => categoriesByGroup.set(g, []));

        categories.forEach(category => {
            const groupName = category.group || 'Built Environment';
            if (!categoriesByGroup.has(groupName)) categoriesByGroup.set(groupName, []);
            categoriesByGroup.get(groupName).push(category);
        });

        // Render each group
        groupOrder.forEach(groupName => {
            const groupCategories = categoriesByGroup.get(groupName) || [];
            if (groupCategories.length === 0) return;

            // Check if this group has any content from the FILTERED maps
            // Only check mapsByCategory, not c1s, because c1s are not filtered
            const hasContent = groupCategories.some(category => {
                const categoryMaps = mapsByCategory.get(category.id);
                return categoryMaps && categoryMaps.length > 0;
            });
            if (!hasContent) return;

            // Group heading
            const groupHeading = document.createElement('div');
            groupHeading.className = 'map-list__group-heading';
            groupHeading.innerHTML = `<span>${this.escapeHtml(groupName)}</span>`;
            container.appendChild(groupHeading);

            // Render each category within this group
            groupCategories.forEach(category => {
                const categoryMaps = mapsByCategory.get(category.id);

                // Skip category if no filtered maps in this category
                if (!categoryMaps || categoryMaps.length === 0) return;

                // Category section wrapper for grid layout (no subheading)
                const categorySection = document.createElement('div');
                categorySection.className = 'category-section';
                categorySection.dataset.categoryId = category.id;
                container.appendChild(categorySection);

                // Get C1s for this category (rendered if category has filtered maps)
                const categoryC1s = c1s.filter(c1 => c1.category === category.id);
                const categoryClasses = classesByCategory.get(category.id) || [];

                // Build set of C2 IDs in C1s
                const c2sInC1s = new Set();
                categoryC1s.forEach(c1 => {
                    this.getC1ClassIds(c1).forEach(id => c2sInC1s.add(id));
                });

                // Render C1s first
                categoryC1s.forEach(c1 => {
                    const c1Card = this.createC1Card(c1, options);
                    categorySection.appendChild(c1Card);
                    // Restore slider
                    const savedKey = `c1:${c1.id}`;
                    if (this._savedSliderValues.has(savedKey)) {
                        const slider = c1Card.querySelector('.timeline-slider');
                        const labels = c1Card.querySelectorAll('.timeline-labels span');
                        if (slider) {
                            slider.value = this._savedSliderValues.get(savedKey);
                            labels.forEach((l, i) => l.classList.toggle('active', i === parseInt(slider.value)));
                        }
                    }
                    this.getC1ClassIds(c1).forEach(id => renderedClasses.add(id));
                });

                // Build conjoined targets map
                const conjoinedTargets = new Map();
                categoryClasses.forEach(cls => {
                    if (c2sInC1s.has(cls.id)) return;
                    if (cls.conjoinedTo) {
                        if (!conjoinedTargets.has(cls.conjoinedTo)) conjoinedTargets.set(cls.conjoinedTo, []);
                        conjoinedTargets.get(cls.conjoinedTo).push(cls);
                    }
                });

                // Render class cards
                categoryClasses.forEach(cls => {
                    if (renderedClasses.has(cls.id)) return;
                    if (c2sInC1s.has(cls.id)) return;
                    if (cls.conjoinedTo) return;

                    const conjoinedSources = conjoinedTargets.get(cls.id) || [];
                    if (conjoinedSources.length > 0) {
                        const groupCard = this.createConjoinedClassGroup(conjoinedSources, cls, options);
                        categorySection.appendChild(groupCard);
                        const groupId = groupCard.dataset.groupId;
                        const savedKey = `group:${groupId}`;
                        if (this._savedSliderValues.has(savedKey)) {
                            const slider = groupCard.querySelector('.timeline-slider');
                            const labels = groupCard.querySelectorAll('.timeline-labels span');
                            if (slider) {
                                slider.value = this._savedSliderValues.get(savedKey);
                                labels.forEach((l, i) => l.classList.toggle('active', i === parseInt(slider.value)));
                            }
                        }
                        renderedClasses.add(cls.id);
                        conjoinedSources.forEach(src => renderedClasses.add(src.id));
                    } else {
                        const classCard = this.createClassCard(cls, options);
                        categorySection.appendChild(classCard);
                        if (this._savedSliderValues.has(cls.id)) {
                            const slider = classCard.querySelector('.timeline-slider');
                            const labels = classCard.querySelectorAll('.timeline-labels span');
                            if (slider) {
                                slider.value = this._savedSliderValues.get(cls.id);
                                labels.forEach((l, i) => l.classList.toggle('active', i === parseInt(slider.value)));
                            }
                        }
                        renderedClasses.add(cls.id);
                    }
                });

                // Render featured maps not in classes
                if (categoryMaps) {
                    categoryMaps.filter(m => m.featured && !m.hidden && !mapIdToClass.has(m.id)).forEach(map => {
                        const card = this.createMapCard(map, options);
                        categorySection.appendChild(card);
                    });
                }

                // For Regional Divides, show all maps directly (no hide/show toggle)
                if (category.id === 'regional-divides') {
                    if (categoryMaps) {
                        categoryMaps.filter(m => !m.featured && !m.hidden && !mapIdToClass.has(m.id)).forEach(map => {
                            const card = this.createMapCard(map, options);
                            categorySection.appendChild(card);
                        });
                    }
                    return; // Skip the "Show More" toggle for Regional Divides
                }

                // Render non-featured maps with "Show More" toggle (unless showAllMaps is true)
                if (categoryMaps) {
                    const nonFeaturedMaps = categoryMaps.filter(m => !m.featured && !m.hidden && !mapIdToClass.has(m.id));
                    if (nonFeaturedMaps.length > 0) {
                        // If showAllMaps toggle is true, render all maps directly without hiding
                        if (this.showAllMaps) {
                            nonFeaturedMaps.forEach(map => {
                                const card = this.createMapCard(map, options);
                                categorySection.appendChild(card);
                            });
                        } else {
                            // Original behavior: hide behind "Show X more maps" button
                            const moreContainer = document.createElement('div');
                            moreContainer.className = 'category-more-maps category-more-maps--collapsed';
                            moreContainer.dataset.categoryId = category.id;

                            nonFeaturedMaps.forEach(map => {
                                const card = this.createMapCard(map, options);
                                moreContainer.appendChild(card);
                            });

                            // Restore expanded state if previously expanded
                            const wasExpanded = savedExpandedCategories.has(category.id);
                            if (wasExpanded) {
                                moreContainer.classList.remove('category-more-maps--collapsed');
                                moreContainer.classList.add('category-more-maps--expanded');
                            }

                            categorySection.appendChild(moreContainer);

                            // Add toggle button
                            const toggleBtn = document.createElement('button');
                            toggleBtn.className = 'category-more-toggle' + (wasExpanded ? ' category-more-toggle--expanded' : '');
                            toggleBtn.innerHTML = `
                                <span class="category-more-toggle__text">${wasExpanded ? 'Show fewer maps' : `Show ${nonFeaturedMaps.length} more maps`}</span>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M6 9l6 6 6-6"/>
                                </svg>
                            `;
                            toggleBtn.addEventListener('click', () => {
                                const isExpanded = moreContainer.classList.toggle('category-more-maps--expanded');
                                moreContainer.classList.toggle('category-more-maps--collapsed', !isExpanded);
                                toggleBtn.classList.toggle('category-more-toggle--expanded', isExpanded);
                                toggleBtn.querySelector('.category-more-toggle__text').textContent =
                                    isExpanded ? 'Show fewer maps' : `Show ${nonFeaturedMaps.length} more maps`;
                            });
                            categorySection.appendChild(toggleBtn);
                        }
                    }
                }
            });
        });

        // ============================================
        // Render Books Section (from books.json)
        // ============================================
        if (this.booksData && this.booksData.books && this.booksData.books.length > 0) {
            const shouldShowBooks = !this.searchQuery || this.booksData.books.some(book =>
                book.title.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
                (book.authors || []).join(' ').toLowerCase().includes(this.searchQuery.toLowerCase()) ||
                (book.keywords || []).join(' ').toLowerCase().includes(this.searchQuery.toLowerCase())
            );

            if (shouldShowBooks && (this.currentCategory === undefined || this.currentCategory === 'all' || !this.currentCategory)) {
                // Create books group header
                const booksGroupHeader = document.createElement('div');
                booksGroupHeader.className = 'category-group-header';
                booksGroupHeader.innerHTML = `<h3 class="category-group-title">Books & Documents</h3>`;
                container.appendChild(booksGroupHeader);

                // Group books by category
                const bookCategories = this.booksData.categories || [];
                const booksByCategory = new Map();
                this.booksData.books.forEach(book => {
                    const cat = book.category || 'other';
                    if (!booksByCategory.has(cat)) booksByCategory.set(cat, []);
                    booksByCategory.get(cat).push(book);
                });

                bookCategories.forEach(cat => {
                    const catBooks = booksByCategory.get(cat.id);
                    if (!catBooks || catBooks.length === 0) return;

                    // Filter by search if active
                    let filteredBooks = catBooks;
                    if (this.searchQuery) {
                        const q = this.searchQuery.toLowerCase();
                        filteredBooks = catBooks.filter(book =>
                            book.title.toLowerCase().includes(q) ||
                            (book.authors || []).join(' ').toLowerCase().includes(q) ||
                            (book.keywords || []).join(' ').toLowerCase().includes(q)
                        );
                        if (filteredBooks.length === 0) return;
                    }

                    // Create category section
                    const catSection = document.createElement('div');
                    catSection.className = 'category-section';
                    catSection.innerHTML = `
                        <div class="category-section__header">
                            <span class="category-section__icon">${cat.icon || '📚'}</span>
                            <h3 class="category-section__title">${this.escapeHtml(cat.name)}</h3>
                        </div>
                    `;

                    // Render book cards
                    filteredBooks.forEach(book => {
                        const card = document.createElement('div');
                        card.className = 'map-card book-card';
                        card.innerHTML = `
                            <div class="thumb-zone"><img class="book-card__thumbnail" src="assets/thumbnails/book-${book.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                            <div class="book-card__content">
                                <h4 class="book-card__title">${this.escapeHtml(book.title)}</h4>
                                <p class="book-card__author">${this.escapeHtml((book.authors || []).join(', '))}</p>
                                <p class="book-card__date">${this.escapeHtml(book.dateDisplay || book.date || '')}</p>
                                <div class="book-card__actions">
                                    ${book.file ? `<a href="${book.file}" target="_blank" rel="noopener" class="btn btn--sm btn--primary book-card__btn">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                        </svg>
                                        View
                                    </a>` : ''}
                                    ${book.file ? `<a href="${book.file}" download class="btn btn--sm btn--outline book-card__btn">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                                        </svg>
                                        Download
                                    </a>` : ''}
                                    ${book.archiveUrl ? `<a href="${book.archiveUrl}" target="_blank" rel="noopener" class="btn btn--sm btn--outline book-card__btn">Archive.org</a>` : ''}
                                </div>
                            </div>
                        `;
                        catSection.appendChild(card);
                    });

                    container.appendChild(catSection);
                });
            }
        }

        this.updateFilterStats(maps.length, options.totalMaps || maps.length);
    }

    updateFilterStats(shown, total) {
        const statsEl = document.getElementById('filterStats');
        if (statsEl) {
            statsEl.textContent = shown === total ? `${total} maps` : `${shown} of ${total} maps`;
        }
    }

    // ============================================
    // PHASE 3: createClassCard
    // ============================================

    createClassCard(cls, options = {}) {
        const card = document.createElement('div');
        card.className = 'map-card map-card--class';
        card.dataset.classId = cls.id;

        const memberMaps = (cls.maps || []).map(id => dataService.getMapById(id)).filter(Boolean);
        memberMaps.sort((a, b) => (this.parseDateToTimestamp(b.date) || 0) - (this.parseDateToTimestamp(a.date) || 0));

        const nonPlaceholderMaps = memberMaps.filter(m => !m.placeholder);
        const yearBasedClasses = ['ni-wards', 'ni-deas', 'ni-lgds', 'ni-pcs', 'ni-assembly', 'ni-settlements', 'ni-deds', 'ni-county-eds', 'eu-parliament'];
        const useYearDisplay = yearBasedClasses.includes(cls.id);

        // Timeline slider removed - now using the main timeline slider in map pane
        let timelineHtml = '';

        // Build members HTML
        const membersHtml = memberMaps.map(map => {
            const isLoaded = options.loadedIds?.includes(map.id);
            const isPlaceholder = map.placeholder;
            const displayName = useYearDisplay ? (this.getYear(map.date) || map.name) : map.name;
            const color = map.style?.color || '#3388ff';

            return `
                <div class="class-member ${isLoaded ? 'class-member--loaded' : ''} ${isPlaceholder ? 'class-member--placeholder' : ''}" data-map-id="${map.id}" style="--map-color: ${color}">
                    <div class="thumb-zone"><img class="class-member__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                    <div class="class-member__info">
                        ${!isPlaceholder ? `<a href="#" class="class-member__name class-member__name-link" data-detail-map-id="${map.id}">${this.escapeHtml(displayName)}</a>` : `<span class="class-member__name">${this.escapeHtml(displayName)}</span>`}
                        ${!isPlaceholder && map.provider ? `<span class="class-member__provider">${this.escapeHtml(map.provider.join(', '))}</span>` : ''}
                        ${isPlaceholder ? '<span class="class-member__placeholder-badge">To Be Added</span>' : ''}
                    </div>
                    ${!isPlaceholder ? `<div class="class-member__actions">
                        <button class="btn btn--icon btn--xs load-btn" data-map-id="${map.id}" title="${isLoaded ? 'Remove' : 'Load'}">${isLoaded ? '✕' : '+'}</button>
                        <div class="overflow-menu">
                            <button class="overflow-menu__trigger" title="More actions">⋮</button>
                            <div class="overflow-menu__dropdown">
                                <button class="overflow-menu__item visibility-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    Toggle visibility
                                </button>
                                <button class="overflow-menu__item copy-url-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                    Copy URL
                                </button>
                                <button class="overflow-menu__item download-fgb-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    Download FGB
                                </button>
                            </div>
                        </div>
                    </div>` : ''}
                </div>`;
        }).join('');

        card.innerHTML = `
            <div class="class-card__header">
                <div class="class-card__title">${this.escapeHtml(cls.name)}</div>
                ${cls.scope ? `<div class="class-card__scope">${this.escapeHtml(cls.scope)}</div>` : ''}
            </div>
            ${timelineHtml}
            <div class="class-card__members">${membersHtml}</div>`;

        this.addClassCardEventListeners(card, nonPlaceholderMaps);
        return card;
    }

    addClassCardEventListeners(card, nonPlaceholderMaps) {
        // Button clicks
        card.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            // Handle overflow menu trigger
            if (btn.classList.contains('overflow-menu__trigger')) {
                e.stopPropagation();
                const menu = btn.closest('.overflow-menu');
                const dropdown = menu.querySelector('.overflow-menu__dropdown');
                // Close all other open menus first
                document.querySelectorAll('.overflow-menu--open').forEach(m => {
                    if (m !== menu) m.classList.remove('overflow-menu--open');
                });
                // Toggle this menu
                const wasOpen = menu.classList.contains('overflow-menu--open');
                menu.classList.toggle('overflow-menu--open');

                // If opening, position the dropdown using fixed coordinates
                if (!wasOpen && dropdown) {
                    const rect = btn.getBoundingClientRect();
                    dropdown.style.top = `${rect.bottom + 2}px`;
                    dropdown.style.right = `${window.innerWidth - rect.right}px`;
                    // Force repaint to ensure dropdown appears immediately
                    dropdown.offsetHeight;
                }
                return;
            }

            const mapId = btn.dataset.mapId;
            if (!mapId) return;
            if (btn.classList.contains('load-btn')) {
                e.stopPropagation();
                const memberEl = btn.closest('.class-member');
                const isLoaded = memberEl?.classList.contains('class-member--loaded');
                if (isLoaded && this.onMapUnload) this.onMapUnload(mapId);
                else if (!isLoaded && this.onMapLoad) this.onMapLoad(mapId);
            } else if (btn.classList.contains('visibility-btn')) {
                e.stopPropagation();
                // Close the menu after action
                btn.closest('.overflow-menu')?.classList.remove('overflow-menu--open');
                if (this.onMapToggle) this.onMapToggle(mapId);
            } else if (btn.classList.contains('copy-url-btn')) {
                e.stopPropagation();
                // Close the menu after action
                btn.closest('.overflow-menu')?.classList.remove('overflow-menu--open');
                this.copyMapUrl(mapId, btn);
            } else if (btn.classList.contains('download-fgb-btn')) {
                e.stopPropagation();
                btn.closest('.overflow-menu')?.classList.remove('overflow-menu--open');
                if (this.onDownloadFgb) this.onDownloadFgb(mapId);
            }
        });

        // Row clicks
        card.querySelectorAll('.class-member').forEach(memberEl => {
            memberEl.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const mapId = memberEl.dataset.mapId;
                if (!mapId || memberEl.classList.contains('class-member--placeholder')) return;
                const isLoaded = memberEl.classList.contains('class-member--loaded');
                if (isLoaded && this.onMapToggle) this.onMapToggle(mapId);
                else if (!isLoaded && this.onMapLoad) this.onMapLoad(mapId);
            });
        });

        // Timeline slider
        const slider = card.querySelector('.timeline-slider');
        const timelineContainer = card.querySelector('.class-card__timeline');
        if (slider && timelineContainer) {
            const labels = card.querySelectorAll('.timeline-labels span');
            const sortedMaps = [...nonPlaceholderMaps].sort((a, b) =>
                (this.parseDateToTimestamp(a.date) || 0) - (this.parseDateToTimestamp(b.date) || 0));
            let lastLoadedDate = null;

            // Get percentage positions from data attribute
            const percentages = JSON.parse(timelineContainer.dataset.percentages || '[]');

            // Find nearest percentage position
            const findNearestIndex = (value) => {
                let nearestIdx = 0;
                let minDiff = Infinity;
                percentages.forEach((pct, i) => {
                    const diff = Math.abs(pct - value);
                    if (diff < minDiff) {
                        minDiff = diff;
                        nearestIdx = i;
                    }
                });
                return nearestIdx;
            };

            // During drag: highlight nearest label
            slider.addEventListener('input', () => {
                const nearestIdx = findNearestIndex(parseFloat(slider.value));
                labels.forEach((l, i) => l.classList.toggle('active', i === nearestIdx));
            });

            // On release: snap to exact percentage position and load maps
            slider.addEventListener('change', () => {
                const nearestIdx = findNearestIndex(parseFloat(slider.value));
                // Snap slider to exact label position
                slider.value = percentages[nearestIdx];
                labels.forEach((l, i) => l.classList.toggle('active', i === nearestIdx));

                const selectedMap = sortedMaps[nearestIdx];
                if (!selectedMap) return;

                const selectedDate = selectedMap.date;
                if (selectedDate === lastLoadedDate) return;

                const mapsToLoad = sortedMaps.filter(m => m.date === selectedDate);
                const mapsToHide = sortedMaps.filter(m => m.date !== selectedDate);
                mapsToHide.forEach(m => { if (this.onHideMap) this.onHideMap(m.id); });
                mapsToLoad.forEach(m => { if (this.onMapLoad) this.onMapLoad(m.id); });
                lastLoadedDate = selectedDate;
            });

            labels.forEach(label => {
                label.addEventListener('click', () => {
                    const pct = parseFloat(label.dataset.pct);
                    slider.value = pct;
                    slider.dispatchEvent(new Event('change'));
                });
            });
        }
    }

    // ============================================
    // PHASE 4: createConjoinedClassGroup
    // ============================================

    createConjoinedClassGroup(sourceClasses, targetClass, options = {}) {
        const group = document.createElement('div');
        group.className = 'conjoined-class-group map-card map-card--class';
        group.dataset.groupId = `${sourceClasses.map(s => s.id).join('-')}-${targetClass.id}`;

        const allMaps = [];
        sourceClasses.forEach(cls => {
            (cls.maps || []).forEach(mapId => {
                const map = dataService.getMapById(mapId);
                if (map) allMaps.push({ map, classId: cls.id, className: cls.name });
            });
        });
        (targetClass.maps || []).forEach(mapId => {
            const map = dataService.getMapById(mapId);
            if (map) allMaps.push({ map, classId: targetClass.id, className: targetClass.name });
        });

        allMaps.sort((a, b) => (this.parseDateToTimestamp(a.map.date) || 0) - (this.parseDateToTimestamp(b.map.date) || 0));
        const nonPlaceholderMaps = allMaps.filter(m => !m.map.placeholder);

        // Timeline slider removed - now using the main timeline slider in map pane
        let timelineHtml = '';


        let membersHtml = '';
        [targetClass, ...sourceClasses].forEach((cls, idx) => {
            const classMaps = allMaps.filter(m => m.classId === cls.id);
            membersHtml += `<div class="conjoined-section"><div class="conjoined-section__header">${this.escapeHtml(cls.name)}</div>`;
            classMaps.forEach(({ map }) => {
                const isLoaded = options.loadedIds?.includes(map.id);
                const isPlaceholder = map.placeholder;
                const displayName = this.getYear(map.date) || map.name;
                membersHtml += `
                    <div class="class-member ${isLoaded ? 'class-member--loaded' : ''} ${isPlaceholder ? 'class-member--placeholder' : ''}" data-map-id="${map.id}" style="--map-color: ${map.style?.color || '#888'}">
                        <div class="thumb-zone"><img class="class-member__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                        <div class="class-member__info"><span class="class-member__name">${this.escapeHtml(displayName)}</span>
                            ${!isPlaceholder && map.provider ? `<span class="class-member__provider">${this.escapeHtml(map.provider.join(', '))}</span>` : ''}
                            ${isPlaceholder ? '<span class="class-member__placeholder-badge">To Be Added</span>' : ''}
                        </div>
                        ${!isPlaceholder ? `<div class="class-member__actions">
                            <button class="btn btn--icon btn--xs load-btn" data-map-id="${map.id}">${isLoaded ? '✕' : '+'}</button>
                            <div class="overflow-menu">
                                <button class="overflow-menu__trigger" title="More actions">⋮</button>
                                <div class="overflow-menu__dropdown">
                                    <button class="overflow-menu__item visibility-btn" data-map-id="${map.id}">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                        Toggle visibility
                                    </button>
                                    <button class="overflow-menu__item copy-url-btn" data-map-id="${map.id}">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                        Copy URL
                                    </button>
                                    <button class="overflow-menu__item download-fgb-btn" data-map-id="${map.id}">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        Download FGB
                                    </button>
                                </div>
                            </div>
                        </div>` : ''}
                    </div>`;
            });
            membersHtml += `</div>`;
            if (idx === 0 && sourceClasses.length > 0) {
                membersHtml += `<div class="conjoined-note"><em>Previously:</em></div>`;
            }
        });

        group.innerHTML = `
            <div class="class-card__header">
                <div class="class-card__title">${this.escapeHtml(targetClass.name)}</div>
                ${targetClass.scope ? `<div class="class-card__scope">${this.escapeHtml(targetClass.scope)}</div>` : ''}
            </div>
            ${timelineHtml}
            <div class="class-card__members">${membersHtml}</div>`;

        this.addConjoinedEventListeners(group, nonPlaceholderMaps);
        return group;
    }

    addConjoinedEventListeners(group, nonPlaceholderMaps) {
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const mapId = btn.dataset.mapId;
            if (!mapId) return;
            if (btn.classList.contains('load-btn')) {
                e.stopPropagation();
                const memberEl = btn.closest('.class-member');
                const isLoaded = memberEl?.classList.contains('class-member--loaded');
                if (isLoaded && this.onMapUnload) this.onMapUnload(mapId);
                else if (!isLoaded && this.onMapLoad) this.onMapLoad(mapId);
            }
        });

        const slider = group.querySelector('.timeline-slider');
        const timelineContainer = group.querySelector('.class-card__timeline');
        if (slider && timelineContainer) {
            const labels = group.querySelectorAll('.timeline-labels span');
            let lastLoadedDate = null;

            // Get percentage positions from data attribute
            const percentages = JSON.parse(timelineContainer.dataset.percentages || '[]');

            // Find nearest percentage position
            const findNearestIndex = (value) => {
                let nearestIdx = 0;
                let minDiff = Infinity;
                percentages.forEach((pct, i) => {
                    const diff = Math.abs(pct - value);
                    if (diff < minDiff) {
                        minDiff = diff;
                        nearestIdx = i;
                    }
                });
                return nearestIdx;
            };

            // During drag: highlight nearest label
            slider.addEventListener('input', () => {
                const nearestIdx = findNearestIndex(parseFloat(slider.value));
                labels.forEach((l, i) => l.classList.toggle('active', i === nearestIdx));
            });

            // On release: snap to exact percentage position and load maps
            slider.addEventListener('change', () => {
                const nearestIdx = findNearestIndex(parseFloat(slider.value));
                // Snap slider to exact label position  
                slider.value = percentages[nearestIdx];
                labels.forEach((l, i) => l.classList.toggle('active', i === nearestIdx));

                const selectedMap = nonPlaceholderMaps[nearestIdx];
                if (!selectedMap) return;

                const selectedDate = selectedMap.map.date;
                if (selectedDate === lastLoadedDate) return;

                const mapsToLoad = nonPlaceholderMaps.filter(m => m.map.date === selectedDate);
                const mapsToHide = nonPlaceholderMaps.filter(m => m.map.date !== selectedDate);
                mapsToHide.forEach(m => { if (this.onHideMap) this.onHideMap(m.map.id); });
                mapsToLoad.forEach(m => { if (this.onMapLoad) this.onMapLoad(m.map.id); });
                lastLoadedDate = selectedDate;
            });

            labels.forEach(label => {
                label.addEventListener('click', () => {
                    const pct = parseFloat(label.dataset.pct);
                    slider.value = pct;
                    slider.dispatchEvent(new Event('change'));
                });
            });
        }
    }

    // ============================================
    // PHASE 5: createC1Card
    // ============================================

    createC1Card(c1, options = {}) {
        const card = document.createElement('div');
        card.className = 'c1-card map-card';
        card.dataset.c1Id = c1.id;

        const c2Ids = this.getC1ClassIds(c1);
        const classes = dataService.getAllClasses() || [];
        const c2Classes = c2Ids.map(id => classes.find(c => c.id === id)).filter(Boolean);

        const allMaps = [];
        c2Classes.forEach(cls => {
            (cls.maps || []).forEach(mapId => {
                const map = dataService.getMapById(mapId);
                if (map) allMaps.push({ map, classId: cls.id, className: cls.name });
            });
        });

        allMaps.sort((a, b) => (this.parseDateToTimestamp(a.map.date) || 0) - (this.parseDateToTimestamp(b.map.date) || 0));
        const nonPlaceholderMaps = allMaps.filter(m => !m.map.placeholder);

        // Timeline slider removed - now using the main timeline slider in map pane
        let timelineHtml = '';


        let contentHtml = '';
        if (c1.layout === 'single-column') {
            contentHtml = c2Classes.map(cls => this.renderC2Section(cls, allMaps, { ...options, fullWidth: true })).join('');
        } else if (c1.layout === 'two-column' && c1.rows) {
            contentHtml = '<div class="c1-card__grid">';
            c1.rows.forEach(row => {
                const leftCls = classes.find(c => c.id === row.left);
                const rightCls = classes.find(c => c.id === row.right);
                contentHtml += `<div class="c1-card__row">`;
                if (leftCls) contentHtml += `<div class="c1-card__column">${this.renderC2Section(leftCls, allMaps, options)}</div>`;
                if (rightCls) contentHtml += `<div class="c1-card__column">${this.renderC2Section(rightCls, allMaps, options)}</div>`;
                contentHtml += `</div>`;
            });
            contentHtml += '</div>';
        } else if (c1.layout === 'mixed' && c1.sections) {
            c1.sections.forEach(section => {
                if (section.width === 'full' && section.classId) {
                    const cls = classes.find(c => c.id === section.classId);
                    if (cls) contentHtml += this.renderC2Section(cls, allMaps, { ...options, fullWidth: true });
                } else if (section.type === 'three-column') {
                    const leftCls = classes.find(c => c.id === section.left);
                    const centerCls = classes.find(c => c.id === section.center);
                    const rightCls = classes.find(c => c.id === section.right);
                    contentHtml += `<div class="c1-card__row c1-card__row--three-column">`;
                    if (leftCls) contentHtml += `<div class="c1-card__column">${this.renderC2Section(leftCls, allMaps, options)}</div>`;
                    if (centerCls) contentHtml += `<div class="c1-card__column">${this.renderC2Section(centerCls, allMaps, options)}</div>`;
                    if (rightCls) contentHtml += `<div class="c1-card__column">${this.renderC2Section(rightCls, allMaps, options)}</div>`;
                    contentHtml += `</div>`;
                } else if (section.type === 'two-column') {
                    const leftCls = classes.find(c => c.id === section.left);
                    const rightCls = section.right ? classes.find(c => c.id === section.right) : null;
                    contentHtml += `<div class="c1-card__row">`;
                    if (leftCls) contentHtml += `<div class="c1-card__column">${this.renderC2Section(leftCls, allMaps, options)}</div>`;
                    if (rightCls) contentHtml += `<div class="c1-card__column">${this.renderC2Section(rightCls, allMaps, options)}</div>`;
                    contentHtml += `</div>`;
                } else if (section.type === 'stacked-columns') {
                    // Use CSS Grid renderer for chronological alignment
                    contentHtml += this.renderChronologicalGrid(section, classes, allMaps, options);
                } else if (section.type === 'explicit-grid') {
                    // Use explicit grid layout with defined row positions
                    contentHtml += this.renderExplicitGrid(section, options);
                }
            });
        }
        card.innerHTML = `
            <div class="c1-card__header"><h3 class="c1-card__title">${this.escapeHtml(c1.name)}</h3></div>
            ${timelineHtml}
            <div class="c1-card__content">${contentHtml}</div>`;

        this.addC1CardEventListeners(card, nonPlaceholderMaps);

        // Apply chronological alignment to stacked columns after a microtask
        // to ensure DOM is ready
        setTimeout(() => this.alignChronologicalColumns(card), 0);

        return card;
    }

    renderC2Section(cls, allMaps, options) {
        const classMaps = allMaps.filter(m => m.classId === cls.id);
        const sorted = [...classMaps].sort((a, b) => (this.parseDateToTimestamp(b.map.date) || 0) - (this.parseDateToTimestamp(a.map.date) || 0));

        // Classes that use full date as derived name (DEDs and County EDs)
        const fullDateClasses = ['ni-deds', 'ni-county-eds', 'ni-admin-areas', 'ni-admin-counties'];
        // Classes that use year as name but show date as subtitle (Wards and DEAs)
        const yearWithSubtitleClasses = ['ni-wards', 'ni-deas'];
        // Classes that use the actual map name (NI constituencies with suffixes like Assembly, Forum, etc)
        const fullNameClasses = ['ni-assembly'];

        const membersHtml = sorted.map(({ map }) => {
            const isLoaded = options.loadedIds?.includes(map.id);
            const isPlaceholder = map.placeholder;
            const hasVariants = map.isGroup && map.variants && map.variants.length > 0;

            let displayName;
            let dateSubtitle = '';

            if (fullDateClasses.includes(cls.id)) {
                // Show full date as the derived name
                displayName = this.formatMapDate(map.date) || map.name;
            } else if (yearWithSubtitleClasses.includes(cls.id)) {
                // Show year as name with date subtitle
                displayName = this.getYear(map.date) || map.name;
                const fullDate = this.formatMapDate(map.date);
                if (fullDate && fullDate !== displayName) {
                    dateSubtitle = `<span class="class-member__date">${fullDate}</span>`;
                }
            } else if (fullNameClasses.includes(cls.id)) {
                // Use the actual map name (e.g., "2023 Assembly", "1995 Forum")
                displayName = map.name;
            } else {
                // Default: show year
                displayName = this.getYear(map.date) || map.name;
            }

            // Expand button for maps with variants (isGroup)
            const expandBtn = hasVariants ? `<button class="btn btn--icon btn--xs variants-toggle" data-map-id="${map.id}" title="Show variants">▼</button>` : '';

            // Variants dropdown HTML (for isGroup maps)
            const variantsHtml = hasVariants ? this.renderVariantsDropdown(map, isLoaded) : '';

            const heightStyle = map.style?.height ? `height: ${map.style.height};` : '';
            return `
                <div class="class-member ${isLoaded ? 'class-member--loaded' : ''} ${isPlaceholder ? 'class-member--placeholder' : ''} ${hasVariants ? 'class-member--has-variants' : ''}" data-map-id="${map.id}" data-date="${map.date || ''}" style="--map-color: ${map.style?.color || '#888'};${heightStyle}">
                <div class="thumb-zone"><img class="class-member__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                <div class="class-member__info">${!isPlaceholder ? `<a href="#" class="class-member__name class-member__name-link" data-detail-map-id="${map.id}">${displayName}</a>` : `<span class="class-member__name">${displayName}</span>`}${dateSubtitle}
                ${!isPlaceholder && map.provider ? `<span class="class-member__provider">${this.escapeHtml(map.provider.join(', '))}</span>` : ''}
                ${isPlaceholder ? '<span class="class-member__placeholder-badge">To Be Added</span>' : ''}
            </div>
                ${!isPlaceholder ? `<div class="class-member__actions">${expandBtn}<button class="btn btn--icon btn--xs load-btn" data-map-id="${map.id}">${isLoaded ? '✕' : '+'}</button>
                        <div class="overflow-menu">
                            <button class="overflow-menu__trigger" title="More actions">⋮</button>
                            <div class="overflow-menu__dropdown">
                                <button class="overflow-menu__item visibility-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    Toggle visibility
                                </button>
                                <button class="overflow-menu__item copy-url-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                    Copy URL
                                </button>
                                <button class="overflow-menu__item download-fgb-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    Download FGB
                                </button>
                            </div>
                        </div>
                    </div>` : ''}
            </div>${variantsHtml} `;
        }).join('');

        const fullWidthClass = options.fullWidth ? ' c1-card__section--full' : '';
        return `<div class="c1-card__section${fullWidthClass}" data-class-id="${cls.id}">
            <div class="c1-card__section-header">${this.escapeHtml(cls.name)}</div>
            <div class="c1-card__section-members">${membersHtml}</div>
        </div>`;
    }

    /**
     * Render stacked columns as a CSS Grid for proper chronological alignment.
     * 
     * Position-Based Implementation:
     * - Rows are determined by item POSITION (index), not year values
     * - First item in each column → row 2 (row 1 is column headers)
     * - Second item in each column → row 3, etc.
     * - This aligns items across columns by their position in the list
     */
    renderChronologicalGrid(section, classes, allMaps, options) {
        // =================================================================
        // STEP 1: Build column data with separate headers and entries
        // =================================================================
        const columnsData = [];

        section.columns.forEach((col, colIndex) => {
            const classIds = col.stack || (col.classId ? [col.classId] : []);
            const isStacked = classIds.length > 1;
            const items = [];

            classIds.forEach(classId => {
                const cls = classes.find(c => c.id === classId);
                if (!cls) return;

                const classMaps = allMaps.filter(m => m.classId === cls.id);
                const sorted = [...classMaps].sort((a, b) =>
                    (this.parseDateToTimestamp(b.map.date) || 0) - (this.parseDateToTimestamp(a.map.date) || 0)
                );

                sorted.forEach(({ map }, idx) => {
                    const year = parseInt(this.getYear(map.date));
                    if (!year) return;

                    // For stacked columns: add header before first entry of each class
                    if (idx === 0 && isStacked) {
                        items.push({
                            type: 'header',
                            year: year,
                            name: cls.name,
                            classId: cls.id
                        });
                    }

                    items.push({
                        type: 'entry',
                        year: year,
                        map: map,
                        className: cls.name,
                        classId: cls.id,
                        isLoaded: options.loadedIds?.includes(map.id),
                        isPlaceholder: map.placeholder
                    });
                });
            });

            // Column header text
            const firstClassId = classIds[0];
            const firstClass = classes.find(c => c.id === firstClassId);
            const headerText = isStacked ? '' : (firstClass?.name || '');

            columnsData.push({
                items,
                header: headerText,
                isStacked,
                colIndex
            });
        });

        if (columnsData.every(c => c.items.length === 0)) return '';

        // =================================================================
        // STEP 2: Determine total rows needed (max items across all columns)
        // =================================================================
        const maxItems = Math.max(...columnsData.map(c => c.items.length));
        const numRows = maxItems;
        const numCols = columnsData.length;

        // =================================================================
        // STEP 3: Assign grid positions using POSITION-BASED indexing
        // Each item's row = its index in the column + 2 (row 1 is headers)
        // =================================================================
        columnsData.forEach(col => {
            col.items.forEach((item, i) => {
                // Row based on position, not year
                item.gridRowStart = i + 2; // +2 because row 1 is column headers

                if (item.type === 'header') {
                    // Header takes just one row
                    item.gridRowEnd = item.gridRowStart + 1;
                } else {
                    // Entry spans to the next item's row
                    const nextItem = col.items[i + 1];
                    if (nextItem) {
                        item.gridRowEnd = (i + 1) + 2; // Next item's position + 2
                    } else {
                        item.gridRowEnd = numRows + 2;
                    }
                }
            });
        });

        // =================================================================
        // STEP 4: Build the CSS Grid HTML
        // =================================================================
        let html = `<div class="c1-chronological-grid" style="--num-columns: ${numCols}; --num-rows: ${numRows};">`;

        // Column headers (row 1)
        columnsData.forEach((col, colIdx) => {
            html += `<div class="c1-grid-header" style="grid-column: ${colIdx + 1}; grid-row: 1;">${this.escapeHtml(col.header)}</div>`;
        });

        // Render all items (headers and entries)
        columnsData.forEach((col, colIdx) => {
            const gridCol = colIdx + 1;

            col.items.forEach(item => {
                if (item.type === 'header') {
                    // Section header
                    html += `<div class="c1-grid-section-header" style="grid-column: ${gridCol}; grid-row: ${item.gridRowStart};">`;
                    html += this.escapeHtml(item.name);
                    html += '</div>';
                } else {
                    // Entry
                    const loadedClass = item.isLoaded ? ' c1-grid-entry--loaded' : '';
                    const placeholderClass = item.isPlaceholder ? ' c1-grid-entry--placeholder' : '';
                    const displayYear = this.getYear(item.map.date) || item.map.name;
                    const color = item.map.style?.color || '#888';

                    html += `<div class="c1-grid-cell" style="grid-column: ${gridCol}; grid-row: ${item.gridRowStart} / ${item.gridRowEnd}; --map-color: ${color};">`;
                    html += `<div class="c1-grid-entry${loadedClass}${placeholderClass}" data-map-id="${item.map.id}" data-date="${item.map.date || ''}">`;
                    html += `<div class="thumb-zone"><img class="c1-entry__thumbnail" src="assets/thumbnails/${item.map.cloneOf || item.map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>`;
                    html += '<div class="c1-entry-content">';
                    html += `<span class="c1-entry-year">${displayYear}</span>`;
                    if (!item.isPlaceholder && item.map.provider) {
                        html += `<span class="c1-entry-provider">${this.escapeHtml(item.map.provider.join(', '))}</span>`;
                    }
                    html += '</div>';

                    if (item.isPlaceholder) {
                        html += '<span class="c1-placeholder-badge">To Be Added</span>';
                    }

                    if (!item.isPlaceholder) {
                        html += `<button class="c1-load-btn load-btn" data-map-id="${item.map.id}">${item.isLoaded ? '✕' : '+'}</button>`;
                    }

                    html += '</div></div>';
                }
            });
        });

        // Fill empty cells for columns with fewer items
        for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
            const gridRow = rowIdx + 2;

            columnsData.forEach((col, colIdx) => {
                const gridCol = colIdx + 1;

                // Check if any item covers this row
                const covered = col.items.some(item =>
                    item.gridRowStart <= gridRow && gridRow < item.gridRowEnd
                );

                if (!covered) {
                    html += `<div class="c1-grid-cell c1-grid-cell--empty" style="grid-column: ${gridCol}; grid-row: ${gridRow};"></div>`;
                }
            });
        }

        html += '</div>'; // .c1-chronological-grid

        return html;
    }

    /**
     * Render an explicit grid layout with defined row positions.
     * This is used for the Constituencies section where cell spans are
     * explicitly defined in the data rather than calculated.
     */
    renderExplicitGrid(section, options) {
        const totalRows = section.totalRows || 33;
        const numCols = section.columns.length;

        let html = `<div class="c1-explicit-grid" style="--num-columns: ${numCols}; --num-rows: ${totalRows};">`;

        // Render column headers (row 1)
        section.columns.forEach((col, colIdx) => {
            html += `<div class="c1-grid-header" style="grid-column: ${colIdx + 1}; grid-row: 1;">${this.escapeHtml(col.header || '')}</div>`;
        });

        // Render all items
        section.columns.forEach((col, colIdx) => {
            const gridCol = colIdx + 1;

            col.items.forEach(item => {
                const rows = item.rows || [];
                if (rows.length === 0) return;

                const gridRowStart = Math.min(...rows);
                const gridRowEnd = Math.max(...rows) + 1;

                if (item.type === 'header') {
                    // Section header (e.g., "Assembly", "Forum")
                    html += `<div class="c1-grid-section-header" style="grid-column: ${gridCol}; grid-row: ${gridRowStart} / ${gridRowEnd};">`;
                    html += this.escapeHtml(item.label);
                    html += '</div>';
                } else if (item.type === 'annotation') {
                    // Annotation text (e.g., "1986 - Assembly dissolved")
                    html += `<div class="c1-grid-annotation" style="grid-column: ${gridCol}; grid-row: ${gridRowStart} / ${gridRowEnd};">`;
                    html += `<em>${this.escapeHtml(item.label)}</em>`;
                    html += '</div>';
                } else if (item.mapId) {
                    // Map entry
                    const map = dataService.getMapById(item.mapId);
                    if (!map) {
                        // Map not found - render placeholder
                        html += `<div class="c1-grid-cell c1-grid-cell--empty" style="grid-column: ${gridCol}; grid-row: ${gridRowStart} / ${gridRowEnd};"></div>`;
                        return;
                    }

                    const isLoaded = options.loadedIds?.includes(map.id);
                    const isPlaceholder = map.placeholder;
                    const loadedClass = isLoaded ? ' c1-grid-entry--loaded' : '';
                    const placeholderClass = isPlaceholder ? ' c1-grid-entry--placeholder' : '';
                    const displayYear = this.getYear(map.date) || map.name;
                    const color = map.style?.color || '#888';

                    html += `<div class="c1-grid-cell" style="grid-column: ${gridCol}; grid-row: ${gridRowStart} / ${gridRowEnd}; --map-color: ${color};">`;
                    html += `<div class="c1-grid-entry${loadedClass}${placeholderClass}" data-map-id="${map.id}" data-date="${map.date || ''}">`;
                    html += `<div class="thumb-zone"><img class="c1-entry__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>`;
                    html += '<div class="c1-entry-content">';
                    html += `<span class="c1-entry-year">${displayYear}</span>`;
                    if (!isPlaceholder && map.provider) {
                        html += `<span class="c1-entry-provider">${this.escapeHtml(map.provider.join(', '))}</span>`;
                    }
                    html += '</div>';

                    if (isPlaceholder) {
                        html += '<span class="c1-placeholder-badge">To Be Added</span>';
                    }

                    if (!isPlaceholder) {
                        html += `<button class="c1-load-btn load-btn" data-map-id="${map.id}">${isLoaded ? '✕' : '+'}</button>`;
                        html += `<div class="overflow-menu">
                            <button class="overflow-menu__trigger" title="More actions">⋮</button>
                            <div class="overflow-menu__dropdown">
                                <button class="overflow-menu__item visibility-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    Toggle visibility
                                </button>
                                <button class="overflow-menu__item copy-url-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                    Copy URL
                                </button>
                                <button class="overflow-menu__item download-fgb-btn" data-map-id="${map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    Download FGB
                                </button>
                            </div>
                        </div>`;
                    }

                    html += '</div></div>';
                }
            });
        });

        // Fill empty cells
        for (let rowIdx = 2; rowIdx <= totalRows + 1; rowIdx++) {
            section.columns.forEach((col, colIdx) => {
                const gridCol = colIdx + 1;

                // Check if any item covers this row
                const covered = col.items.some(item => {
                    const rows = item.rows || [];
                    const start = Math.min(...rows);
                    const end = Math.max(...rows) + 1;
                    return start <= rowIdx && rowIdx < end;
                });

                if (!covered) {
                    html += `<div class="c1-grid-cell c1-grid-cell--empty" style="grid-column: ${gridCol}; grid-row: ${rowIdx};"></div>`;
                }
            });
        }

        html += '</div>'; // .c1-explicit-grid

        return html;
    }

    /**
     * Align map entries chronologically across stacked columns.
     * This is now a no-op since grid-based rendering handles alignment.
     * Kept for backward compatibility.
     */
    alignChronologicalColumns(card) {
        // No longer needed - grid-based rendering handles alignment
    }

    addC1CardEventListeners(card, nonPlaceholderMaps) {
        card.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            // Handle overflow menu trigger
            if (btn.classList.contains('overflow-menu__trigger')) {
                e.stopPropagation();
                const menu = btn.closest('.overflow-menu');
                const dropdown = menu.querySelector('.overflow-menu__dropdown');
                // Close all other open menus first
                document.querySelectorAll('.overflow-menu--open').forEach(m => {
                    if (m !== menu) m.classList.remove('overflow-menu--open');
                });
                // Toggle this menu
                const wasOpen = menu.classList.contains('overflow-menu--open');
                menu.classList.toggle('overflow-menu--open');

                // If opening, position the dropdown using fixed coordinates
                if (!wasOpen && dropdown) {
                    const rect = btn.getBoundingClientRect();
                    dropdown.style.top = `${rect.bottom + 2} px`;
                    dropdown.style.right = `${window.innerWidth - rect.right} px`;
                    // Force repaint to ensure dropdown appears immediately
                    dropdown.offsetHeight;
                }
                return;
            }

            const mapId = btn.dataset.mapId;
            if (!mapId) return;

            // Handle variants toggle button
            if (btn.classList.contains('variants-toggle')) {
                e.stopPropagation();
                this.toggleVariants(mapId, card);
                return;
            }

            if (btn.classList.contains('load-btn')) {
                e.stopPropagation();
                // Support both old .class-member and new .c1-grid-entry
                const memberEl = btn.closest('.class-member, .c1-grid-entry');
                const isLoaded = memberEl?.classList.contains('class-member--loaded') ||
                    memberEl?.classList.contains('c1-grid-entry--loaded');
                if (isLoaded && this.onMapUnload) this.onMapUnload(mapId);
                else if (!isLoaded && this.onMapLoad) this.onMapLoad(mapId);
            } else if (btn.classList.contains('visibility-btn')) {
                e.stopPropagation();
                btn.closest('.overflow-menu')?.classList.remove('overflow-menu--open');
                if (this.onMapToggle) this.onMapToggle(mapId);
            } else if (btn.classList.contains('copy-url-btn')) {
                e.stopPropagation();
                btn.closest('.overflow-menu')?.classList.remove('overflow-menu--open');
                this.copyMapUrl(mapId, btn);
            } else if (btn.classList.contains('download-fgb-btn')) {
                e.stopPropagation();
                btn.closest('.overflow-menu')?.classList.remove('overflow-menu--open');
                if (this.onDownloadFgb) this.onDownloadFgb(mapId);
            }
        });

        // Grid entry clicks (clicking on the year label)
        card.querySelectorAll('.c1-grid-entry').forEach(entryEl => {
            entryEl.addEventListener('click', (e) => {
                // Ignore if clicking on a button
                if (e.target.closest('button')) return;
                const mapId = entryEl.dataset.mapId;
                if (!mapId || entryEl.classList.contains('c1-grid-entry--placeholder')) return;
                const isLoaded = entryEl.classList.contains('c1-grid-entry--loaded');
                if (isLoaded && this.onMapToggle) this.onMapToggle(mapId);
                else if (!isLoaded && this.onMapLoad) this.onMapLoad(mapId);
            });
        });

        const slider = card.querySelector('.timeline-slider');
        const timelineContainer = card.querySelector('.class-card__timeline');
        if (slider && timelineContainer) {
            const labels = card.querySelectorAll('.timeline-labels span');
            let lastLoadedDate = null;

            // Get percentage positions from data attribute
            const percentages = JSON.parse(timelineContainer.dataset.percentages || '[]');

            // Find nearest percentage position
            const findNearestIndex = (value) => {
                let nearestIdx = 0;
                let minDiff = Infinity;
                percentages.forEach((pct, i) => {
                    const diff = Math.abs(pct - value);
                    if (diff < minDiff) {
                        minDiff = diff;
                        nearestIdx = i;
                    }
                });
                return nearestIdx;
            };

            // During drag: highlight nearest label
            slider.addEventListener('input', () => {
                const nearestIdx = findNearestIndex(parseFloat(slider.value));
                labels.forEach((l, i) => l.classList.toggle('active', i === nearestIdx));
            });

            // On release: snap to exact percentage position and load maps
            slider.addEventListener('change', () => {
                const nearestIdx = findNearestIndex(parseFloat(slider.value));
                // Snap slider to exact label position
                slider.value = percentages[nearestIdx];
                labels.forEach((l, i) => l.classList.toggle('active', i === nearestIdx));

                const selectedMap = nonPlaceholderMaps[nearestIdx];
                if (!selectedMap) return;

                const selectedDate = selectedMap.map.date;
                if (selectedDate === lastLoadedDate) return;

                const mapsToLoad = nonPlaceholderMaps.filter(m => m.map.date === selectedDate);
                const mapsToHide = nonPlaceholderMaps.filter(m => m.map.date !== selectedDate);
                mapsToHide.forEach(m => { if (this.onHideMap) this.onHideMap(m.map.id); });

                // Sort maps: wards before deas (for LGEA C1 card)
                mapsToLoad.sort((a, b) => {
                    const aIsWard = a.classId === 'ni-wards' ? 0 : 1;
                    const bIsWard = b.classId === 'ni-wards' ? 0 : 1;
                    return aIsWard - bIsWard;
                });
                mapsToLoad.forEach(m => { if (this.onMapLoad) this.onMapLoad(m.map.id); });
                lastLoadedDate = selectedDate;
            });

            labels.forEach(label => {
                label.addEventListener('click', () => {
                    const pct = parseFloat(label.dataset.pct);
                    slider.value = pct;
                    slider.dispatchEvent(new Event('change'));
                });
            });
        }

        // Track section header sticky behavior for explicit grids
        this.initSectionHeaderScrollTracking(card);
    }

    /**
     * Initialize scroll tracking for section headers in explicit grids.
     * Section headers stick below column headers but should scroll away
     * when their section's content has scrolled past.
     */
    initSectionHeaderScrollTracking(card) {
        const grids = card.querySelectorAll('.c1-explicit-grid');
        if (grids.length === 0) return;

        grids.forEach(grid => {
            // Find the scrollable container - must be the pane content, not the card
            // Priority: .pane-tab-content > .pane__content > .sidebar__content
            const scrollContainer = grid.closest('.pane-tab-content') ||
                grid.closest('.pane__content') ||
                document.querySelector('.pane-tab-content') ||
                document.querySelector('.pane__content') ||
                grid.closest('.sidebar__content');
            if (!scrollContainer) return;

            const sectionHeaders = grid.querySelectorAll('.c1-grid-section-header');
            if (sectionHeaders.length === 0) return;

            // Build section info: for each header, find the last row of its section
            // Group headers by column first to correctly calculate section boundaries
            const headersByColumn = new Map();
            sectionHeaders.forEach(header => {
                const style = header.getAttribute('style') || '';
                const colMatch = style.match(/grid-column:\s*(\d+)/);
                const col = colMatch ? parseInt(colMatch[1]) : 1;
                if (!headersByColumn.has(col)) {
                    headersByColumn.set(col, []);
                }
                headersByColumn.get(col).push(header);
            });

            // Sort headers within each column by row number
            headersByColumn.forEach((headers, col) => {
                headers.sort((a, b) => {
                    const aStyle = a.getAttribute('style') || '';
                    const bStyle = b.getAttribute('style') || '';
                    const aRow = parseInt(aStyle.match(/grid-row:\s*(\d+)/)?.[1] || '0');
                    const bRow = parseInt(bStyle.match(/grid-row:\s*(\d+)/)?.[1] || '0');
                    return aRow - bRow;
                });
            });

            const sectionInfo = [];
            sectionHeaders.forEach(header => {
                const style = header.getAttribute('style') || '';
                const rowMatch = style.match(/grid-row:\s*(\d+)/);
                const startRow = rowMatch ? parseInt(rowMatch[1]) : 1;
                const colMatch = style.match(/grid-column:\s*(\d+)/);
                const col = colMatch ? parseInt(colMatch[1]) : 1;

                // Find the next section header in THE SAME COLUMN
                const headersInCol = headersByColumn.get(col) || [];
                const headerIdx = headersInCol.indexOf(header);

                let endRow;
                if (headerIdx >= 0 && headerIdx < headersInCol.length - 1) {
                    // Next header in same column determines end
                    const nextHeader = headersInCol[headerIdx + 1];
                    const nextStyle = nextHeader.getAttribute('style') || '';
                    const nextMatch = nextStyle.match(/grid-row:\s*(\d+)/);
                    endRow = nextMatch ? parseInt(nextMatch[1]) : startRow;
                } else {
                    // Last section in column - find max row from all items in this column
                    const cells = grid.querySelectorAll('.c1-grid-cell, .c1-grid-annotation');
                    let maxRow = startRow;
                    cells.forEach(cell => {
                        const cellStyle = cell.getAttribute('style') || '';
                        const cellColMatch = cellStyle.match(/grid-column:\s*(\d+)/);
                        const cellCol = cellColMatch ? parseInt(cellColMatch[1]) : 1;
                        if (cellCol === col) {
                            const cellRowMatch = cellStyle.match(/grid-row:\s*(\d+)(?:\s*\/\s*(\d+))?/);
                            if (cellRowMatch) {
                                const rowEnd = cellRowMatch[2] ? parseInt(cellRowMatch[2]) : parseInt(cellRowMatch[1]) + 1;
                                maxRow = Math.max(maxRow, rowEnd);
                            }
                        }
                    });
                    endRow = maxRow;
                }

                sectionInfo.push({ header, startRow, endRow, col });
            });

            // Dynamic sticky threshold: headers stick at CSS 'top: 96px' relative to their
            // scrolling container's content area, so we need to calculate the VIEWPORT position
            // by adding: container.top + container.paddingTop + 96px
            const getStickyThreshold = () => {
                const containerRect = scrollContainer.getBoundingClientRect();
                const containerStyle = getComputedStyle(scrollContainer);
                const paddingTop = parseFloat(containerStyle.paddingTop) || 0;
                return containerRect.top + paddingTop + 96; // 96px = card header (36px) + column header (60px)
            };

            const updateStickyState = () => {
                // For each section header, find the bottom of the LAST item in that section
                // The header should stick until that last item scrolls above the sticky threshold

                sectionInfo.forEach(({ header, startRow, endRow }) => {
                    // Get the column for this header
                    const style = header.getAttribute('style') || '';
                    const colMatch = style.match(/grid-column:\s*(\d+)/);
                    const col = colMatch ? parseInt(colMatch[1]) : 1;

                    // Find all items in this column within this section's row range
                    // and track the bottommost one (largest grid-row value)
                    let lastItem = null;
                    let lastItemRowEnd = 0;

                    const allItems = grid.querySelectorAll('.c1-grid-cell, .c1-grid-annotation');
                    allItems.forEach(item => {
                        const itemStyle = item.getAttribute('style') || '';
                        const itemColMatch = itemStyle.match(/grid-column:\s*(\d+)/);
                        const itemCol = itemColMatch ? parseInt(itemColMatch[1]) : 0;

                        if (itemCol !== col) return; // Different column

                        const rowMatch = itemStyle.match(/grid-row:\s*(\d+)(?:\s*\/\s*(\d+))?/);
                        if (rowMatch) {
                            const rowStart = parseInt(rowMatch[1]);
                            const rowEnd = rowMatch[2] ? parseInt(rowMatch[2]) : rowStart + 1;

                            // Check if this item is within our section (from startRow to endRow)
                            // Use rowEnd to find the item that extends furthest down
                            if (rowStart >= startRow && rowStart < endRow) {
                                if (rowEnd > lastItemRowEnd) {
                                    lastItemRowEnd = rowEnd;
                                    lastItem = item;
                                }
                            }
                        }
                    });

                    // Calculate if the section has scrolled past
                    let shouldScrollAway = false;

                    if (lastItem) {
                        // Get the last item's bottom position relative to the viewport
                        const itemRect = lastItem.getBoundingClientRect();
                        // Get the header's height to account for it
                        const headerRect = header.getBoundingClientRect();
                        const headerHeight = headerRect.height;

                        // V8.61 Refined Guard: Distinguish between "not yet rendered" and "scrolled away"
                        // Zero dimensions can occur in two cases:
                        // 1. Initial load before layout is complete (should NOT mark as scrolled-past)
                        // 2. Deep scroll where element is far above viewport (SHOULD mark as scrolled-past)
                        if (itemRect.bottom === 0 && itemRect.top === 0) {
                            // If we're at the very top of the container, it's likely initial load
                            if (scrollContainer.scrollTop === 0) {
                                return; // Don't modify class if layout not yet stable
                            }
                            // Otherwise, we've scrolled significantly - zeros mean item is far above
                            // and should be treated as scrolled past
                            shouldScrollAway = true;
                        } else {
                            // Normal case: compare positions
                            // The header should scroll away when the last item's bottom 
                            // is above the point where the header would stick (sticky threshold + header height)
                            // This ensures the header stays until its section content is truly gone
                            const scrollAwayPoint = getStickyThreshold() + headerHeight;
                            shouldScrollAway = itemRect.bottom < scrollAwayPoint;
                        }
                    }

                    header.classList.toggle('c1-grid-section-header--scrolled-past', shouldScrollAway);
                });

                // V8.65: Second pass - hide earlier headers when overlapping at sticky position
                // If multiple headers in the same column are at nearly the same top position,
                // they are overlapping at the sticky spot. Hide all but the last (lowest row) one.
                // IMPORTANT: Only check for collisions when headers are actually stuck at the 
                // sticky threshold (96px), not when they're in their natural grid positions.
                headersByColumn.forEach((headersInCol, col) => {
                    // First, clear collision-hidden from all headers in this column
                    headersInCol.forEach(h => h.classList.remove('c1-grid-section-header--collision-hidden'));

                    // Get positions of all visible (not scrolled-past) headers in this column
                    const visibleHeaders = headersInCol.filter(h =>
                        !h.classList.contains('c1-grid-section-header--scrolled-past')
                    );

                    if (visibleHeaders.length < 2) return; // No overlap possible

                    // Get positions with row info for sorting
                    const headerPositions = visibleHeaders.map(h => {
                        const info = sectionInfo.find(s => s.header === h);
                        return {
                            header: h,
                            top: h.getBoundingClientRect().top,
                            startRow: info?.startRow || 0,
                            text: h.textContent.trim().substring(0, 25)
                        };
                    });

                    // Only check for collisions if at least one header is stuck at the sticky position
                    // A header is "stuck" if its top is within 15px of the sticky threshold (96px)
                    const stickyThreshold = getStickyThreshold();
                    const hasStuckHeader = headerPositions.some(h =>
                        Math.abs(h.top - stickyThreshold) < 15
                    );
                    if (!hasStuckHeader) return; // No header is stuck, no collision possible

                    // Sort by row order (earlier rows first)
                    headerPositions.sort((a, b) => a.startRow - b.startRow);

                    // Find headers that are at nearly the same position as a later header
                    for (let i = 0; i < headerPositions.length - 1; i++) {
                        for (let j = i + 1; j < headerPositions.length; j++) {
                            const diff = Math.abs(headerPositions[i].top - headerPositions[j].top);
                            // If within 10px of each other, they're overlapping
                            if (diff < 10) {
                                // Hide the earlier one (lower row number) using collision-hidden class
                                headerPositions[i].header.classList.add('c1-grid-section-header--collision-hidden');
                                break; // This header is now hidden, check next
                            }
                        }
                    }
                });
            };


            // Debounced scroll handler
            let ticking = false;
            scrollContainer.addEventListener('scroll', () => {
                if (!ticking) {
                    requestAnimationFrame(() => {
                        updateStickyState();
                        ticking = false;
                    });
                    ticking = true;
                }
            });

            // Initial state
            updateStickyState();
        });
    }

    getC1ClassIds(c1) {
        const ids = [];
        if (c1.c2s) ids.push(...c1.c2s);
        if (c1.rows) c1.rows.forEach(r => { if (r.left) ids.push(r.left); if (r.right) ids.push(r.right); });
        if (c1.sections) c1.sections.forEach(s => {
            if (s.classId) ids.push(s.classId);
            if (s.left) ids.push(s.left);
            if (s.center) ids.push(s.center);
            if (s.right) ids.push(s.right);
            // Handle stacked-columns with columns array
            if (s.columns) s.columns.forEach(col => {
                if (col.classId) ids.push(col.classId);
                if (col.stack) ids.push(...col.stack);
            });
        });
        return [...new Set(ids)];
    }

    // ============================================
    // PHASE 6: Helper Methods
    // ============================================

    parseDateToTimestamp(dateStr) {
        if (!dateStr) return null;
        if (typeof dateStr === 'number') return new Date(dateStr, 0, 1).getTime();
        const str = String(dateStr);
        if (/^\d{4}$/.test(str)) return new Date(parseInt(str), 0, 1).getTime();
        if (/^\d{4}-\d{2}$/.test(str)) {
            const [y, m] = str.split('-').map(Number);
            return new Date(y, m - 1, 1).getTime();
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            const [y, m, d] = str.split('-').map(Number);
            return new Date(y, m - 1, d).getTime();
        }
        return null;
    }

    formatMapDate(dateStr) {
        if (!dateStr) return '';
        const str = String(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (/^\d{4}$/.test(str)) return str;
        if (/^\d{4}-\d{2}$/.test(str)) {
            const [y, m] = str.split('-').map(Number);
            return `<span class="date-mono">${months[m - 1]} ${y}</span>`;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            const [y, m, d] = str.split('-').map(Number);
            const dayStr = String(d).padStart(2, '0');
            return `<span class="date-mono">${dayStr} ${months[m - 1]} ${y}</span>`;
        }
        return str;
    }

    getYear(dateStr) {
        if (!dateStr) return null;
        const str = String(dateStr);
        const match = str.match(/^(\d{4})/);
        return match ? match[1] : null;
    }

    // ============================================
    // Map Cards and Feature Info
    // ============================================

    createMapCard(map, options = {}) {
        const card = document.createElement('div');
        const isLoaded = options.loadedIds?.includes(map.id);
        const isVisible = options.visibleIds?.includes(map.id);
        card.className = `map-card${isLoaded ? ' map-card--active' : ''}`;
        card.dataset.mapId = map.id;

        const color = map.style?.color || '#3388ff';
        const providers = (map.provider || []).join(', ');
        const dateStr = this.formatMapDate(map.date);
        const hasVariants = map.variants && map.variants.length > 0;
        const hasDownload = map.files?.fgb || map.files?.geojson;

        // Note field if present
        const noteHtml = map.note ? `<div class="map-card__note">${this.escapeHtml(map.note)}</div>` : '';

        card.innerHTML = `
            <div class="thumb-zone"><img class="map-card__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
            <div class="map-card__color" style="background-color: ${color}"></div>
            <div class="map-card__info">
                <a href="#" class="map-card__name map-card__name-link" data-detail-map-id="${map.id}">${this.escapeHtml(map.name)}</a>
                <div class="map-card__meta">${this.escapeHtml(providers)}${dateStr ? ` · <em>${dateStr}</em>` : ''}</div>
                ${noteHtml}
            </div>
            <div class="map-card__actions">
                <!-- Slot 1: Visibility -->
                <button class="btn btn--icon btn--sm visibility-btn" data-map-id="${map.id}" title="${isVisible ? 'Hide' : 'Show'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${isVisible ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>' : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/>'}
                    </svg>
                </button>
                
                <!-- Slot 2: Load/Unload -->
                <button class="btn btn--icon btn--sm load-btn" data-map-id="${map.id}" title="${isLoaded ? 'Unload' : 'Load'}">
                    ${isLoaded ? '✕' : '+'}
                </button>
                
                <!-- Slot 3: Copy URL -->
                <button class="btn btn--icon btn--sm copy-url-btn" data-map-id="${map.id}" title="Copy shareable URL">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                </button>
                
                <!-- Slot 4: Download -->
                ${hasDownload ? `
                    <div class="download-btn-group">
                        <button class="btn btn--icon btn--sm download-btn" data-map-id="${map.id}" title="Download">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                        <div class="download-dropdown hidden">
                            ${map.files?.fgb ? `<a href="${map.files.fgb}" class="download-dropdown__item" download>FlatGeobuf (.fgb)</a>` : ''}
                            ${map.files?.geojson ? `<a href="${map.files.geojson}" class="download-dropdown__item" download>GeoJSON</a>` : ''}
                        </div>
                    </div>
                ` : '<div class="download-btn-group--placeholder"></div>'}
                
                <!-- Slot 5: Variants -->
                ${hasVariants ? `
                    <button class="btn btn--icon btn--sm variants-btn" data-map-id="${map.id}" title="${map.variants.length} variants">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M6 9l6 6 6-6"/>
                        </svg>
                    </button>
                ` : '<div class="btn--placeholder"></div>'}
            </div>
        `;

        // Event listeners
        card.querySelector('.visibility-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isLoaded && this.onHideMap) {
                this.onHideMap(map.id);
            } else if (this.onMapToggle) {
                this.onMapToggle(map.id);
            }
        });

        card.querySelector('.load-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isLoaded && this.onMapUnload) {
                this.onMapUnload(map.id);
            } else if (this.onMapLoad) {
                this.onMapLoad(map.id);
            }
        });

        card.querySelector('.copy-url-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyMapUrl(map.id, e.target);
        });

        card.querySelector('.download-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = card.querySelector('.download-dropdown');
            if (dropdown) {
                dropdown.classList.toggle('hidden');
            }
        });

        card.querySelector('.variants-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleVariantsPanel(map, card);
        });

        // Row click toggles map
        card.addEventListener('click', () => {
            if (this.onMapToggle) this.onMapToggle(map.id);
        });

        return card;
    }

    copyMapUrl(mapId, buttonEl) {
        const url = new URL(window.location.href);
        const currentLayers = url.hash.match(/layers=([^&]+)/)?.[1] || '';
        const layerIds = currentLayers ? currentLayers.split('%2C').map(decodeURIComponent) : [];

        if (!layerIds.includes(mapId)) {
            layerIds.push(mapId);
        }

        url.hash = url.hash.replace(/layers=[^&]*/, '') || '';
        url.hash = `layers = ${layerIds.map(encodeURIComponent).join('%2C')}${url.hash.replace('#', '&')} `;

        navigator.clipboard.writeText(url.toString()).then(() => {
            // Show feedback
            const originalTitle = buttonEl?.getAttribute('title');
            if (buttonEl) {
                buttonEl.setAttribute('title', 'Copied!');
                setTimeout(() => {
                    buttonEl.setAttribute('title', originalTitle || 'Copy shareable URL');
                }, 1500);
            }
            this.announce('URL copied to clipboard');
        }).catch(err => {
            console.error('[UIController] Failed to copy URL:', err);
        });
    }

    toggleVariantsPanel(map, cardEl) {
        const existingPanel = cardEl.querySelector('.variants-panel');
        if (existingPanel) {
            existingPanel.remove();
            cardEl.querySelector('.variants-btn')?.classList.remove('variants-btn--active');
            return;
        }

        if (!map.variants || map.variants.length === 0) return;

        const panel = document.createElement('div');
        panel.className = 'variants-panel';
        panel.innerHTML = `
            ${map.variants.map(v => `
                <div class="variants-panel__item" data-variant-id="${v.id}">
                    <div class="variant-info">
                        <span class="variant-label">${this.escapeHtml(v.label || v.id)}</span>
                        ${v.description ? `<span class="variant-desc">${this.escapeHtml(v.description)}</span>` : ''}
                    </div>
                    <div class="variant-actions">
                        <button class="btn--variant-load" data-variant-id="${v.id}" title="Load ${v.label || v.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            Load
                        </button>
                    </div>
                </div>
            `).join('')
            }
        `;

        panel.querySelectorAll('.btn--variant-load').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const variantId = btn.dataset.variantId;
                if (this.onMapLoad) this.onMapLoad(variantId);
                btn.textContent = 'Loading...';
                btn.disabled = true;
            });
        });

        cardEl.appendChild(panel);
        cardEl.querySelector('.variants-btn')?.classList.add('variants-btn--active');
    }

    // ============================================
    // Authors Filter (Step 7)
    // ============================================

    setupAuthorsFilter() {
        const toggle = document.getElementById('authorsToggle');
        const list = document.getElementById('authorsList');

        if (!toggle || !list) return;

        // Setup toggle
        toggle.addEventListener('click', () => {
            const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', !isExpanded);
            list.classList.toggle('filter-section__list--collapsed', isExpanded);
        });

        // Populate authors
        this.populateAuthorsFilter();
    }

    populateAuthorsFilter() {
        const list = document.getElementById('authorsList');
        if (!list) return;

        const data = dataService.getData();
        if (!data) return;

        // Extract all unique authors/providers
        const authors = new Map(); // author -> count

        (data.maps || []).forEach(map => {
            (map.provider || []).forEach(provider => {
                const trimmed = provider.trim();
                if (trimmed) {
                    authors.set(trimmed, (authors.get(trimmed) || 0) + 1);
                }
            });
        });

        // Sort by count descending
        const sortedAuthors = Array.from(authors.entries())
            .sort((a, b) => b[1] - a[1]);

        if (sortedAuthors.length === 0) {
            list.innerHTML = '<p class="text-muted text-sm">No authors found</p>';
            return;
        }

        this.selectedAuthors = new Set();

        list.innerHTML = sortedAuthors.map(([author, count]) => `
            < label class="filter-checkbox" >
                <input type="checkbox" value="${this.escapeHtml(author)}" class="author-checkbox">
                    <span class="filter-checkbox__label">${this.escapeHtml(author)}</span>
                    <span class="filter-checkbox__count">(${count})</span>
                </label>
        `).join('');

        // Add change listeners
        list.querySelectorAll('.author-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const author = e.target.value;
                if (e.target.checked) {
                    this.selectedAuthors.add(author);
                } else {
                    this.selectedAuthors.delete(author);
                }
                this.applyAuthorFilter();
            });
        });
    }

    applyAuthorFilter() {
        if (this.selectedAuthors.size === 0) {
            // Clear filter - show all
            if (this.onAuthorFilter) {
                this.onAuthorFilter(null);
            }
            return;
        }

        // Filter maps by selected authors
        if (this.onAuthorFilter) {
            this.onAuthorFilter(Array.from(this.selectedAuthors));
        }
    }

    clearAuthorFilter() {
        this.selectedAuthors = new Set();
        const list = document.getElementById('authorsList');
        if (list) {
            list.querySelectorAll('.author-checkbox').forEach(cb => {
                cb.checked = false;
            });
        }
        this.applyAuthorFilter();
    }

    updateMapCardState(mapId, isVisible) {
        const card = document.querySelector(`.map-card[data-map-id="${mapId}"]`);
        if (!card) return;
        card.classList.toggle('map-card--active', isVisible);
        const btn = card.querySelector('.toggle-layer-btn');
        if (btn) {
            btn.title = isVisible ? 'Hide layer' : 'Show layer';
            const svg = btn.querySelector('svg');
            if (svg) {
                svg.innerHTML = isVisible
                    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/>';
            }
        }
    }

    renderCategoryPills(categories, activeId = 'all') {
        const container = document.getElementById('categoryPills');
        const toggle = document.getElementById('categoryToggle');

        if (!container) return;
        container.innerHTML = '';

        // Count maps per group
        const data = dataService.getData();
        const groupCounts = new Map();
        const categoriesList = data?.categories || [];

        // Build a map of category ID to group name
        const categoryToGroup = new Map();
        categoriesList.forEach(cat => {
            if (cat.group) {
                categoryToGroup.set(cat.id, cat.group);
            }
        });

        // Count maps in each group
        (data?.maps || []).forEach(m => {
            if (!m.hidden && m.category) {
                const group = categoryToGroup.get(m.category);
                if (group) {
                    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
                }
            }
        });

        // Define groups with their IDs and display names
        const groups = [
            { id: 'all', name: 'All', icon: '📋' },
            { id: 'communities', name: 'Communities', icon: '🏘️' },
            { id: 'history', name: 'History', icon: '📜' },
            { id: 'elections-and-government', name: 'Elections and Government', icon: '🗳️' },
            { id: 'public-services', name: 'Public Services', icon: '🏥' },
            { id: 'physical-geography', name: 'Physical Geography', icon: '🗻' },
            { id: 'built-environment', name: 'Built Environment', icon: '🏗️' }
        ];

        // Get total maps for 'All' button
        const totalMaps = (data?.maps || []).filter(m => !m.hidden).length;

        // Create pills for each group
        groups.forEach(group => {
            const count = group.id === 'all' ? totalMaps : groupCounts.get(group.name) || 0;
            const pill = this.createCategoryPill({ ...group, count }, group.id === activeId);
            container.appendChild(pill);
        });

        // Hide toggle button since we're showing all groups
        if (toggle) {
            toggle.classList.add('hidden');
        }
    }

    createCategoryPill(category, isActive = false) {
        const pill = document.createElement('button');
        pill.className = `category-pill${isActive ? ' category-pill--active' : ''}`;
        pill.dataset.categoryId = category.id;

        const countBadge = category.count !== undefined ?
            `<span class="category-pill__count">${category.count}</span>` : '';

        pill.innerHTML = `
            <span class="category-pill__icon">${category.icon || ''}</span>
            <span class="category-pill__name">${this.escapeHtml(category.name)}</span>
            ${countBadge}
        `;

        pill.addEventListener('click', () => {
            if (this.onCategoryChange) this.onCategoryChange(category.id);
            document.querySelectorAll('.category-pill').forEach(p => {
                p.classList.toggle('category-pill--active', p.dataset.categoryId === category.id);
            });
        });
        return pill;
    }

    /**
     * Render provider category pills for filtering by data provider
     */
    renderProviderPills(activeProviderId = 'all-providers') {
        const container = document.getElementById('providerPills');
        if (!container) return;
        container.innerHTML = '';

        // Define provider categories and their associated providers
        const providerCategories = [
            {
                id: 'all-providers',
                name: 'All Providers',
                icon: '🌐',
                providers: [] // Empty means all
            },
            {
                id: 'northern-ireland',
                name: 'Northern Ireland',
                icon: '✋',
                providers: ['ABC Council', 'DAERA', 'Department for Communities', 'NIEA', 'NISRA', 'OSNI', 'OSNI Open Data', 'PRONI']
            },
            {
                id: 'ireland',
                name: 'Ireland',
                icon: '🇮🇪',
                providers: ['CSO', 'EPA', 'OSI', 'OSi', 'TÉ']
            },
            {
                id: 'united-kingdom',
                name: 'United Kingdom',
                icon: '🇬🇧',
                providers: ['Electoral Commission', 'Northern Ireland Office']
            },
            {
                id: 'european-union',
                name: 'European Union',
                icon: '🇪🇺',
                providers: ['European Commission', 'Eurostat']
            },
            {
                id: 'organizations',
                name: 'Organizations',
                icon: '🏢',
                providers: ['IHO', 'OpenTopography.org', 'OSM']
            },
            {
                id: 'individuals',
                name: 'Individuals',
                icon: '👤',
                providers: ['Global Watersheds', 'Paddy Matthews', 'Parlconst.org', 'Scott Moore', 'XrysD']
            }
        ];

        // Count maps per provider category
        const data = dataService.getData();
        const allMaps = (data?.maps || []).filter(m => !m.hidden);

        providerCategories.forEach(category => {
            // Count maps for this provider category
            let count;
            if (category.id === 'all-providers') {
                count = allMaps.length;
            } else {
                count = allMaps.filter(m => {
                    const mapProviders = m.provider || [];
                    return mapProviders.some(p => category.providers.includes(p));
                }).length;
            }

            const pill = this.createProviderPill({ ...category, count }, category.id === activeProviderId);
            container.appendChild(pill);
        });
    }

    createProviderPill(category, isActive = false) {
        const pill = document.createElement('button');
        pill.className = `category-pill${isActive ? ' category-pill--active' : ''}`;
        pill.dataset.providerId = category.id;

        const countBadge = category.count !== undefined ?
            `<span class="category-pill__count">${category.count}</span>` : '';

        pill.innerHTML = `
            <span class="category-pill__icon">${category.icon || ''}</span>
            <span class="category-pill__name">${this.escapeHtml(category.name)}</span>
            ${countBadge}
        `;

        pill.addEventListener('click', () => {
            if (this.onProviderCategoryChange) this.onProviderCategoryChange(category.id, category.providers);
            document.querySelectorAll('#providerPills .category-pill').forEach(p => {
                p.classList.toggle('category-pill--active', p.dataset.providerId === category.id);
            });
        });
        return pill;
    }

    showFeatureInfo(features, mapConfigs) {
        const panel = document.getElementById('featureInfo');
        const content = document.getElementById('featureInfoContent');
        if (!panel || !content) return;

        content.innerHTML = '';

        features.forEach(feature => {
            const mapConfig = mapConfigs.find(m => m.id === feature.mapId);
            const props = feature.properties || {};
            const geometry = feature.geometry;

            const div = document.createElement('div');
            div.className = 'feature-info__section';

            let html = `
            <div class="feature-info__header-row">
                    <span class="feature-info__color" style="background: ${mapConfig?.style?.color || '#888'}"></span>
                    <h4 class="feature-info__layer-name">${this.escapeHtml(mapConfig?.name || 'Unknown Layer')}</h4>
                </div>
            `;

            // Get primary name from common properties
            const primaryName = props.Name || props.name || props.NAME ||
                props.LGDNAME || props.WARDNAME || props.DEA ||
                props.CONSTITUENCY || props.COUNTY || 'Unnamed Feature';

            html += `<div class="feature-info__primary-name">${this.escapeHtml(primaryName)}</div>`;

            // Calculate area and perimeter if available
            let area = props.Area || props.area || props.AREA;
            let perimeter = props.Perimeter || props.perimeter || props.PERIMETER;

            // Calculate geodesic metrics if not provided
            if (geometry && (!area || !perimeter)) {
                const metrics = this.calculateGeodesicMetrics(geometry);
                if (!area && metrics.area) area = metrics.area;
                if (!perimeter && metrics.perimeter) perimeter = metrics.perimeter;
            }

            // Get elevation data
            const minElevM = props.minElev_m;
            const maxElevM = props.maxElev_m;
            const minElevFt = props.minElev_ft;
            const maxElevFt = props.maxElev_ft;

            // Format spatial metrics with dual units and toggle precision
            if (area || perimeter || (minElevM !== undefined && maxElevM !== undefined)) {
                html += '<div class="feature-info__metrics">';
                if (area) {
                    const areaKm2 = typeof area === 'number' ? area : parseFloat(area);
                    if (!isNaN(areaKm2)) {
                        const areaSqMi = areaKm2 * 0.386102;
                        html += `<div class="feature-info__metric feature-info__metric--clickable" data-area-km="${areaKm2}" data-area-mi="${areaSqMi}" data-precision="2">
                            <span class="feature-info__metric-label">Area</span>
                            <span class="feature-info__metric-value feature-info__metric-value--underline">
                                <span class="metric-km">${this.formatNumber(areaKm2, 2)} km²</span><br>
                                <span class="metric-mi">(${this.formatNumber(areaSqMi, 2)} sq mi)</span>
                            </span>
                        </div>`;
                    }
                }
                if (perimeter) {
                    const perimKm = typeof perimeter === 'number' ? perimeter : parseFloat(perimeter);
                    if (!isNaN(perimKm)) {
                        const perimMi = perimKm * 0.621371;
                        html += `<div class="feature-info__metric feature-info__metric--clickable" data-perim-km="${perimKm}" data-perim-mi="${perimMi}" data-precision="2">
                            <span class="feature-info__metric-label">Perimeter</span>
                            <span class="feature-info__metric-value feature-info__metric-value--underline">
                                <span class="metric-km">${this.formatNumber(perimKm, 2)} km</span><br>
                                <span class="metric-mi">(${this.formatNumber(perimMi, 2)} mi)</span>
                            </span>
                        </div>`;
                    }
                }
                // Elevation metrics
                if (minElevM !== undefined && minElevM !== null && !isNaN(minElevM)) {
                    html += `<div class="feature-info__metric">
                        <span class="feature-info__metric-label">Min Elevation</span>
                        <span class="feature-info__metric-value">
                            <span class="metric-km">${this.formatNumber(minElevM, 1)} m</span><br>
                            <span class="metric-mi">(${minElevFt || Math.round(minElevM * 3.28084)} ft)</span>
                        </span>
                    </div>`;
                }
                if (maxElevM !== undefined && maxElevM !== null && !isNaN(maxElevM)) {
                    html += `<div class="feature-info__metric">
                        <span class="feature-info__metric-label">Max Elevation</span>
                        <span class="feature-info__metric-value">
                            <span class="metric-km">${this.formatNumber(maxElevM, 1)} m</span><br>
                            <span class="metric-mi">(${maxElevFt || Math.round(maxElevM * 3.28084)} ft)</span>
                        </span>
                    </div>`;
                }
                html += '</div>';
            }

            // Render all properties in a collapsible table
            const excludeKeys = ['Name', 'name', 'NAME', 'Area', 'area', 'AREA',
                'Perimeter', 'perimeter', 'PERIMETER', 'geometry',
                'minElev_m', 'maxElev_m', 'minElev_ft', 'maxElev_ft'];
            const filteredProps = Object.entries(props)
                .filter(([key, value]) =>
                    !excludeKeys.includes(key) &&
                    value !== null &&
                    value !== undefined &&
                    value !== ''
                );

            if (filteredProps.length > 0) {
                html += `
            <details class="feature-info__details">
                        <summary class="feature-info__summary">All Properties (${filteredProps.length})</summary>
                        <div class="feature-info__properties">
                `;

                filteredProps.forEach(([key, value]) => {
                    const displayValue = typeof value === 'number' ?
                        this.formatNumber(value) :
                        this.escapeHtml(String(value));
                    html += `<div class="feature-info__property">
                        <span class="feature-info__key">${this.escapeHtml(key)}</span>
                        <span class="feature-info__value">${displayValue}</span>
                    </div>`;
                });

                html += '</div></details>';
            }

            div.innerHTML = html;
            content.appendChild(div);
        });

        // Setup close button
        const closeBtn = document.getElementById('featureInfoClose');
        if (closeBtn) {
            closeBtn.onclick = () => this.hideFeatureInfo();
        }

        // Setup metric precision toggle
        content.querySelectorAll('.feature-info__metric--clickable').forEach(metric => {
            metric.addEventListener('click', () => {
                const currentPrecision = parseInt(metric.dataset.precision) || 2;
                const newPrecision = currentPrecision === 2 ? 10 : 2;
                metric.dataset.precision = newPrecision;

                // Update area values if present
                if (metric.dataset.areaKm) {
                    const areaKm = parseFloat(metric.dataset.areaKm);
                    const areaMi = parseFloat(metric.dataset.areaMi);
                    const kmSpan = metric.querySelector('.metric-km');
                    const miSpan = metric.querySelector('.metric-mi');
                    if (kmSpan) kmSpan.textContent = `${this.formatNumber(areaKm, newPrecision)} km²`;
                    if (miSpan) miSpan.textContent = `(${this.formatNumber(areaMi, newPrecision)} sq mi)`;
                }

                // Update perimeter values if present
                if (metric.dataset.perimKm) {
                    const perimKm = parseFloat(metric.dataset.perimKm);
                    const perimMi = parseFloat(metric.dataset.perimMi);
                    const kmSpan = metric.querySelector('.metric-km');
                    const miSpan = metric.querySelector('.metric-mi');
                    if (kmSpan) kmSpan.textContent = `${this.formatNumber(perimKm, newPrecision)} km`;
                    if (miSpan) miSpan.textContent = `(${this.formatNumber(perimMi, newPrecision)} mi)`;
                }
            });
        });

        panel.classList.remove('hidden');
    }

    calculateGeodesicMetrics(geometry) {
        const result = { area: null, perimeter: null };

        if (!geometry || !geometry.coordinates) return result;

        const R = 6371; // Earth radius in km

        try {
            if (geometry.type === 'Polygon') {
                const coords = geometry.coordinates[0];
                result.area = this.calculatePolygonArea(coords, R);
                result.perimeter = this.calculatePolygonPerimeter(coords, R);
            } else if (geometry.type === 'MultiPolygon') {
                let totalArea = 0;
                let totalPerimeter = 0;

                geometry.coordinates.forEach(polygon => {
                    const coords = polygon[0];
                    totalArea += this.calculatePolygonArea(coords, R);
                    totalPerimeter += this.calculatePolygonPerimeter(coords, R);
                });

                result.area = totalArea;
                result.perimeter = totalPerimeter;
            }
        } catch (e) {
            console.warn('[UIController] Error calculating geodesic metrics:', e);
        }

        return result;
    }

    calculatePolygonArea(coords, R) {
        // Spherical excess formula (Shoelace for spherical coordinates)
        let total = 0;

        for (let i = 0; i < coords.length - 1; i++) {
            const lon1 = coords[i][0] * Math.PI / 180;
            const lat1 = coords[i][1] * Math.PI / 180;
            const lon2 = coords[i + 1][0] * Math.PI / 180;
            const lat2 = coords[i + 1][1] * Math.PI / 180;

            total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
        }

        return Math.abs(total * R * R / 2);
    }

    calculatePolygonPerimeter(coords, R) {
        // Haversine formula for each segment
        let total = 0;

        for (let i = 0; i < coords.length - 1; i++) {
            const [lon1, lat1] = coords[i];
            const [lon2, lat2] = coords[i + 1];

            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const lat1Rad = lat1 * Math.PI / 180;
            const lat2Rad = lat2 * Math.PI / 180;

            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            total += R * c;
        }

        return total;
    }

    formatNumber(num, precision = null) {
        if (typeof num !== 'number' || isNaN(num)) return String(num);

        // Handle small numbers
        if (Math.abs(num) < 0.0001 && num !== 0) {
            return '< 0.0001';
        }

        // Use explicit precision if provided
        if (precision !== null) {
            return num.toLocaleString(undefined, {
                minimumFractionDigits: precision,
                maximumFractionDigits: precision
            });
        }

        // Use locale-aware formatting with appropriate precision
        if (Math.abs(num) >= 0.01) {
            return num.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        } else {
            return num.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4
            });
        }
    }

    hideFeatureInfo() {
        const panel = document.getElementById('featureInfo');
        if (panel) panel.classList.add('hidden');
    }

    showLoadProgress(mapId, progress) {
        // Could show loading indicator - simplified for now
    }

    updateActiveLayers(loadedMaps, visibilityMap, partialLayerInfo) {
        const container = document.getElementById('activeLayersList');
        if (!container) return;

        if (!loadedMaps || loadedMaps.length === 0) {
            container.innerHTML = '<p class="text-muted text-sm">No layers loaded</p>';
            return;
        }

        container.innerHTML = loadedMaps.map(map => {
            const isVisible = visibilityMap?.get(map.id) ?? true;
            const partial = partialLayerInfo?.get(map.id);
            const color = map.style?.color || '#3388ff';
            const authors = map.authors?.join(', ') || '';
            const date = map.date ? this.getYear(map.date) : '';

            return `
                <div class="active-layer-item ${isVisible ? '' : 'active-layer-item--hidden'}${partial?.isPartial ? ' active-layer-item--partial' : ''}" data-map-id="${map.id}">
                    <div class="active-layer-item__color" style="background: ${color}"></div>
                    <div class="active-layer-item__info">
                        <span class="active-layer-item__name">${this.escapeHtml(map.name)}</span>
                        <span class="active-layer-item__meta">
                            ${authors}${authors && date ? ' · ' : ''}${date ? `<em>${date}</em>` : ''}
                            ${partial?.isPartial ? `<span class="active-layer-item__partial-badge">${partial.featureNames?.length || 1} feature${(partial.featureNames?.length || 1) > 1 ? 's' : ''}</span>` : ''}
                        </span>
                    </div>
                    <div class="active-layer-item__actions">
                        <button class="active-layer-item__btn visibility-btn" data-map-id="${map.id}" title="${isVisible ? 'Hide' : 'Show'}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        ${partial?.isPartial ? `<button class="active-layer-item__btn expand-btn" data-map-id="${map.id}" title="Load full map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>` : ''}
                        <button class="active-layer-item__btn remove-btn" data-map-id="${map.id}" title="Remove">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>`;
        }).join('');

        // Add event listeners
        container.querySelectorAll('.visibility-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mapId = btn.dataset.mapId;
                if (this.onMapToggle) this.onMapToggle(mapId);
            });
        });

        container.querySelectorAll('.expand-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mapId = btn.dataset.mapId;
                if (this.onExpandToFullMap) this.onExpandToFullMap(mapId);
            });
        });

        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mapId = btn.dataset.mapId;
                if (this.onMapUnload) this.onMapUnload(mapId);
            });
        });
    }

    // ============================================
    // Tables Tab (Step 6)
    // ============================================

    initializeTables() {
        if (this.tablesInitialized) return;
        this.setupTablesTab();
        this.loadTablesData();
        this.tablesInitialized = true;
    }

    setupTablesTab() {
        const dataTypeSelect = document.getElementById('tablesDataType');
        const searchInput = document.getElementById('tablesSearch');
        const container = document.getElementById('tablesContainer');

        if (!dataTypeSelect) return;

        // State for tables
        this.tablesState = {
            dataType: 'maps',
            searchQuery: '',
            sortKey: null,
            sortDir: 'asc',
            currentPage: 1,
            pageSize: 50,
            allData: [],
            filteredData: [],
            columns: [],
            // New: Dynamic column management for All Features
            allColumns: [],              // All discovered columns sorted by coverage
            columnCoverage: new Map(),   // column -> Set of mapIds that have this column
            visibleColumnCount: 3,       // Start with base columns (name, map, category)
            manifestData: null           // Cache the manifest for column recalculation
        };

        dataTypeSelect.addEventListener('change', (e) => {
            this.tablesState.dataType = e.target.value;
            this.tablesState.currentPage = 1;
            this.loadTablesData();
        });

        if (searchInput) {
            let debounce;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                    this.tablesState.searchQuery = e.target.value.trim().toLowerCase();
                    this.tablesState.currentPage = 1;
                    this.filterAndRenderTable();
                }, 200);
            });
        }
    }

    loadTablesData() {
        const container = document.getElementById('tablesContainer');
        if (!container) return;

        const data = dataService.getData();
        if (!data) {
            container.innerHTML = '<p class="text-muted">Loading data...</p>';
            return;
        }

        switch (this.tablesState.dataType) {
            case 'maps':
                this.tablesState.allData = (data.maps || []).map(m => ({
                    id: m.id,
                    name: m.name,
                    category: m.category || '',
                    provider: (m.provider || []).join(', '),
                    date: m.date || '',
                    featured: m.featured ? 'Yes' : 'No'
                }));
                this.tablesState.columns = ['name', 'category', 'provider', 'date', 'featured'];
                break;

            case 'books':
                this.tablesState.allData = (data.books || []).map(b => ({
                    id: b.id,
                    title: b.title || b.name,
                    authors: (b.authors || []).join(', '),
                    year: b.year || '',
                    publisher: b.publisher || ''
                }));
                this.tablesState.columns = ['title', 'authors', 'year', 'publisher'];
                break;

            case 'allFeatures':
                // This would need async loading from multiple FGB files
                container.innerHTML = '<p class="text-muted">Loading all features... This may take a moment.</p>';
                this.loadAllFeatures();
                return;

            case 'features':
                // Only loaded features
                if (this.onGetLoadedFeatures) {
                    this.tablesState.allData = this.onGetLoadedFeatures() || [];
                    this.tablesState.columns = this.calculateDynamicColumns(this.tablesState.allData);
                } else {
                    this.tablesState.allData = [];
                    this.tablesState.columns = [];
                }
                break;
        }

        this.filterAndRenderTable();
    }

    async loadAllFeatures() {
        const container = document.getElementById('tablesContainer');
        if (!container) return;

        // Clear existing data immediately to avoid stale data being shown
        this.tablesState.allData = [];
        this.tablesState.filteredData = [];
        this.tablesState.columns = [];
        this.tablesState.allColumns = [];
        this.tablesState.columnCoverage = new Map();
        this.tablesState.visibleColumnCount = 3; // Reset to base columns
        container.innerHTML = '<p class="text-muted">Loading all features... This may take a moment.</p>';

        try {
            // Load the build manifest which contains all individual features
            console.log('[UIController] Fetching build-manifest.json...');
            const response = await fetch('./data/build-manifest.json');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const manifest = await response.json();
            this.tablesState.manifestData = manifest; // Cache for column recalculation
            console.log('[UIController] Loaded build manifest with', Object.keys(manifest.files || {}).length, 'maps');

            const data = dataService.getData();
            const allFeatures = [];
            const columnCoverage = new Map(); // column -> Set<mapId>
            const totalMapCount = Object.keys(manifest.files || {}).length;

            // Extract all individual features from each map and track property coverage
            for (const [mapId, mapData] of Object.entries(manifest.files || {})) {
                if (!mapData.features) continue;

                // Get map metadata for display name and category
                const mapInfo = (data?.maps || []).find(m => m.id === mapId);
                const mapName = mapInfo?.name || mapId;
                const category = mapInfo?.category || '';

                // Track which properties this map has (for coverage reporting)
                const mapProperties = new Set();

                for (const feature of mapData.features) {
                    // Build feature object with base columns
                    const featureObj = {
                        name: feature.name || `Feature ${feature.index + 1}`,
                        map: mapName,
                        mapId: mapId,
                        category: category,
                        index: feature.index
                    };

                    // Handle properties - can be array (old format) or object (new format with values)
                    const props = feature.properties;
                    if (props && typeof props === 'object' && !Array.isArray(props)) {
                        // New format: object with key-value pairs
                        for (const [propName, propValue] of Object.entries(props)) {
                            mapProperties.add(propName);
                            // Add property value to feature object for display
                            featureObj[propName] = propValue;
                        }
                    } else if (Array.isArray(props)) {
                        // Old format: array of property names (no values available)
                        for (const propName of props) {
                            mapProperties.add(propName);
                        }
                    }

                    allFeatures.push(featureObj);
                }

                // Update columnCoverage for all properties found in this map
                for (const prop of mapProperties) {
                    if (!columnCoverage.has(prop)) {
                        columnCoverage.set(prop, new Set());
                    }
                    columnCoverage.get(prop).add(mapId);
                }
            }

            this.tablesState.allData = allFeatures;
            this.tablesState.columnCoverage = columnCoverage;
            this.tablesState.totalMapCount = totalMapCount;

            // Now calculate sorted columns since we have actual property values
            this.calculateSortedColumns();

            console.log('[UIController] allFeatures loaded:', allFeatures.length, 'individual features');
            console.log('[UIController] Property coverage:', columnCoverage.size, 'unique properties across', totalMapCount, 'maps');
            console.log('[UIController] Columns:', this.tablesState.columns.length, 'visible of', this.tablesState.allColumns.length, 'total');
            this.filterAndRenderTable();
        } catch (e) {
            console.error('[UIController] Failed to load build manifest:', e);
            container.innerHTML = '<p class="text-muted">Failed to load features. The build manifest may not be available.</p>';
        }
    }

    /**
     * Calculate columns sorted by coverage (universal first, then descending by map count)
     * Called on initial load and when filter changes
     */
    calculateSortedColumns(filteredMapIds = null) {
        const baseColumns = ['name', 'map', 'category'];
        const columnCoverage = this.tablesState.columnCoverage;

        // Determine which maps to consider
        let relevantMapIds;
        if (filteredMapIds && filteredMapIds.size > 0) {
            relevantMapIds = filteredMapIds;
        } else {
            // Use all maps
            relevantMapIds = new Set();
            for (const mapSet of columnCoverage.values()) {
                for (const mapId of mapSet) {
                    relevantMapIds.add(mapId);
                }
            }
        }

        const totalMaps = relevantMapIds.size;
        if (totalMaps === 0) {
            this.tablesState.columns = baseColumns;
            this.tablesState.allColumns = baseColumns;
            return;
        }

        // Calculate coverage for each column relative to the relevant maps
        const columnStats = [];
        for (const [col, mapSet] of columnCoverage.entries()) {
            // Count how many of the relevant maps have this column
            let relevantCount = 0;
            for (const mapId of mapSet) {
                if (relevantMapIds.has(mapId)) {
                    relevantCount++;
                }
            }
            if (relevantCount > 0) {
                columnStats.push({
                    column: col,
                    mapCount: relevantCount,
                    isUniversal: relevantCount === totalMaps
                });
            }
        }

        // Sort: universal columns first (alphabetically), then by mapCount descending, then alphabetically
        columnStats.sort((a, b) => {
            if (a.isUniversal !== b.isUniversal) {
                return a.isUniversal ? -1 : 1; // Universal first
            }
            if (a.mapCount !== b.mapCount) {
                return b.mapCount - a.mapCount; // Higher coverage first
            }
            return a.column.localeCompare(b.column); // Alphabetical tiebreaker
        });

        // Build final column list
        const sortedColumns = columnStats.map(s => s.column);
        this.tablesState.allColumns = [...baseColumns, ...sortedColumns];

        // Count universal columns and high-coverage columns (>50% of maps)
        const universalCount = columnStats.filter(s => s.isUniversal).length;
        const highCoverageCount = columnStats.filter(s => s.mapCount >= totalMaps * 0.5).length;

        // Initial visible columns: base + universal + up to 7 more high-coverage columns
        // Show at least 10 total columns by default (or all if fewer exist)
        const minDynamicColumns = 7; // Show at least 7 dynamic columns beyond base
        const targetVisible = baseColumns.length + Math.max(universalCount + highCoverageCount, minDynamicColumns);
        this.tablesState.visibleColumnCount = Math.min(targetVisible, this.tablesState.allColumns.length);

        // Update columns to show
        this.tablesState.columns = this.tablesState.allColumns.slice(0, this.tablesState.visibleColumnCount);

        console.log(`[UIController] Columns: ${universalCount} universal, ${highCoverageCount} high-coverage, ${sortedColumns.length} total dynamic, showing ${this.tablesState.columns.length}`);
    }

    calculateDynamicColumns(features) {
        if (!features || features.length === 0) return ['name', 'mapName'];

        const allKeys = new Set();
        features.slice(0, 100).forEach(f => {
            Object.keys(f).forEach(k => allKeys.add(k));
        });

        // Prioritize common columns
        const priority = ['name', 'Name', 'NAME', 'mapName', 'area', 'perimeter', 'date'];
        const columns = priority.filter(k => allKeys.has(k));

        // Add remaining columns
        allKeys.forEach(k => {
            if (!columns.includes(k) && !['geometry', 'id'].includes(k)) {
                columns.push(k);
            }
        });

        return columns.slice(0, 10); // Limit columns
    }

    filterAndRenderTable() {
        const container = document.getElementById('tablesContainer');
        if (!container) return;

        const query = this.tablesState.searchQuery;

        // Filter
        this.tablesState.filteredData = this.tablesState.allData.filter(row => {
            if (!query) return true;
            return Object.values(row).some(v =>
                String(v).toLowerCase().includes(query)
            );
        });

        // Recalculate columns based on filtered data (for All Features only)
        if (this.tablesState.dataType === 'allFeatures' && this.tablesState.columnCoverage.size > 0) {
            // Get unique mapIds from filtered data
            const filteredMapIds = new Set(this.tablesState.filteredData.map(row => row.mapId));
            this.calculateSortedColumns(filteredMapIds);
        }

        // Sort
        if (this.tablesState.sortKey) {
            const key = this.tablesState.sortKey;
            const dir = this.tablesState.sortDir === 'asc' ? 1 : -1;
            this.tablesState.filteredData.sort((a, b) => {
                const aVal = a[key] ?? '';
                const bVal = b[key] ?? '';
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return (aVal - bVal) * dir;
                }
                return String(aVal).localeCompare(String(bVal)) * dir;
            });
        }

        this.renderTable(container);
    }

    renderTable(container) {
        const { filteredData, columns, currentPage, pageSize, allColumns, visibleColumnCount } = this.tablesState;
        const totalPages = Math.ceil(filteredData.length / pageSize);
        const start = (currentPage - 1) * pageSize;
        const pageData = filteredData.slice(start, start + pageSize);

        // Check if there are more columns to show
        const hasMoreColumns = allColumns && allColumns.length > visibleColumnCount;
        const remainingColumns = hasMoreColumns ? allColumns.length - visibleColumnCount : 0;

        let html = `
            <div class="tables-stats">
                Showing ${start + 1}-${Math.min(start + pageSize, filteredData.length)} of ${filteredData.length} features
                ${allColumns && allColumns.length > 3 ? ` · ${columns.length} of ${allColumns.length} columns` : ''}
            </div>
            <div class="tables-wrapper tables-wrapper--scrollable">
                <table class="data-table data-table--scrollable">
                    <thead>
                        <tr>
                            ${columns.map(col => `
                                <th class="data-table__header sortable" data-sort-key="${col}">
                                    <span class="data-table__text">${this.escapeHtml(col)}${this.tablesState.sortKey === col ?
                (this.tablesState.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${pageData.map(row => `
                            <tr>
                                ${columns.map(col => `
                                    <td class="data-table__cell"><span class="data-table__text">${this.escapeHtml(String(row[col] ?? ''))}</span></td>
                                `).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // Load More Columns button
        if (hasMoreColumns) {
            html += `
                <div class="tables-column-controls">
                    <button class="btn btn--sm btn--secondary tables-load-more-columns">
                        Load ${Math.min(20, remainingColumns)} More Columns (${remainingColumns} remaining)
                    </button>
                </div>
            `;
        }

        // Pagination
        if (totalPages > 1) {
            html += `
                <div class="tables-pagination">
                    <button class="btn btn--sm tables-pagination__btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>
                    <span class="tables-pagination__info">Page ${currentPage} of ${totalPages}</span>
                    <button class="btn btn--sm tables-pagination__btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>Next →</button>
                </div>
            `;
        }

        container.innerHTML = html;

        // Add sort listeners
        container.querySelectorAll('.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sortKey;
                if (this.tablesState.sortKey === key) {
                    this.tablesState.sortDir = this.tablesState.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.tablesState.sortKey = key;
                    this.tablesState.sortDir = 'asc';
                }
                this.filterAndRenderTable();
            });
        });

        // Load More Columns listener
        const loadMoreBtn = container.querySelector('.tables-load-more-columns');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                // Add 20 more columns
                this.tablesState.visibleColumnCount = Math.min(
                    this.tablesState.visibleColumnCount + 20,
                    this.tablesState.allColumns.length
                );
                this.tablesState.columns = this.tablesState.allColumns.slice(0, this.tablesState.visibleColumnCount);
                this.renderTable(container);
            });
        }

        // Pagination listeners
        container.querySelectorAll('.tables-pagination__btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.page;
                if (action === 'prev' && this.tablesState.currentPage > 1) {
                    this.tablesState.currentPage--;
                } else if (action === 'next' && this.tablesState.currentPage < totalPages) {
                    this.tablesState.currentPage++;
                }
                this.renderTable(container);
            });
        });
    }

    // ============================================
    // Search & Discovery (Step 1)
    // ============================================

    setupSearch() {
        const searchInput = document.getElementById('searchInput');
        const searchClear = document.getElementById('searchClear');
        const autocomplete = document.getElementById('searchAutocomplete');

        if (!searchInput) return;

        // Initialize Fuse.js with weighted search
        this.initializeFuse();

        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(debounceTimer);

            // Show/hide clear button
            if (searchClear) {
                searchClear.classList.toggle('visible', query.length > 0);
            }

            if (query.length < 2) {
                this.hideAutocomplete();
                if (this.onSearch) this.onSearch('');
                return;
            }

            debounceTimer = setTimeout(() => {
                this.performSearch(query);
            }, 150);
        });

        // Clear button
        if (searchClear) {
            searchClear.addEventListener('click', () => {
                searchInput.value = '';
                searchClear.classList.remove('visible');
                this.hideAutocomplete();
                if (this.onSearch) this.onSearch('');
            });
        }

        // Handle autocomplete selection
        if (autocomplete) {
            autocomplete.addEventListener('click', (e) => {
                const item = e.target.closest('.search-autocomplete__item');
                if (item) {
                    const type = item.dataset.type;
                    const id = item.dataset.id;
                    this.handleSearchSelection(type, id);
                    this.hideAutocomplete();
                    searchInput.value = '';
                    if (searchClear) searchClear.classList.remove('visible');
                }
            });
        }

        // Close autocomplete on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-input')) {
                this.hideAutocomplete();
            }
        });

        // Keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideAutocomplete();
                searchInput.blur();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateAutocomplete(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Enter') {
                const selected = autocomplete?.querySelector('.search-autocomplete__item--selected');
                if (selected) {
                    selected.click();
                }
            }
        });
    }

    initializeFuse() {
        const data = dataService.getData();
        if (!data) return;

        const searchItems = [];

        // Add maps
        (data.maps || []).forEach(map => {
            if (!map.hidden) {
                searchItems.push({
                    type: 'map',
                    id: map.id,
                    name: map.name,
                    keywords: (map.keywords || []).join(' '),
                    provider: (map.provider || []).join(' '),
                    category: map.category || ''
                });
            }
        });

        // Add classes
        (data.classes || []).forEach(cls => {
            searchItems.push({
                type: 'class',
                id: cls.id,
                name: cls.name,
                keywords: '',
                provider: '',
                category: ''
            });
        });

        // Add categories
        (data.categories || []).forEach(cat => {
            searchItems.push({
                type: 'category',
                id: cat.id,
                name: cat.name,
                keywords: '',
                provider: '',
                category: ''
            });
        });

        // Configure Fuse with weighted fields
        this.fuse = new Fuse(searchItems, {
            keys: [
                { name: 'name', weight: 2.0 },
                { name: 'keywords', weight: 1.5 },
                { name: 'provider', weight: 1.0 },
                { name: 'category', weight: 0.5 }
            ],
            threshold: 0.3,
            includeMatches: true,
            minMatchCharLength: 2
        });

        this.searchItems = searchItems;
    }

    performSearch(query) {
        // Check if query looks like an address or postcode
        if (this.isAddressQuery(query)) {
            this.performAddressSearch(query);
            return;
        }

        if (!this.fuse) {
            this.initializeFuse();
            if (!this.fuse) return;
        }

        const results = this.fuse.search(query, { limit: 10 });
        this.renderAutocomplete(results, query);

        // Notify app for filtering
        if (this.onSearch) this.onSearch(query);
    }

    isAddressQuery(query) {
        // Check for postcode pattern (UK format)
        const postcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
        // Check for address-like patterns (contains numbers and common suffixes)
        const addressPattern = /\d+\s+(road|street|avenue|lane|drive|place|close|way|court|gardens|park|terrace|crescent)/i;

        return postcodePattern.test(query) || addressPattern.test(query) || query.includes(',');
    }

    renderAutocomplete(results, query) {
        const autocomplete = document.getElementById('searchAutocomplete');
        if (!autocomplete) return;

        if (results.length === 0) {
            autocomplete.innerHTML = '<div class="search-autocomplete__empty">No maps found</div>';
            autocomplete.classList.remove('hidden');
            return;
        }

        const html = results.map(result => {
            const item = result.item;
            const typeIcon = item.type === 'map' ? '🗺️' : item.type === 'class' ? '📋' : '📂';
            const highlightedName = this.highlightMatches(item.name, result.matches);

            return `<div class="search-autocomplete__item" data-type="${item.type}" data-id="${item.id}">
                <span class="search-autocomplete__icon">${typeIcon}</span>
                <div class="search-autocomplete__content">
                    <span class="search-autocomplete__name">${highlightedName}</span>
                    ${item.category ? `<span class="search-autocomplete__meta">${item.category}</span>` : ''}
                </div>
            </div>`;
        }).join('');

        autocomplete.innerHTML = html;
        autocomplete.classList.remove('hidden');
    }

    highlightMatches(text, matches) {
        if (!matches || matches.length === 0) return this.escapeHtml(text);

        const nameMatch = matches.find(m => m.key === 'name');
        if (!nameMatch) return this.escapeHtml(text);

        let result = '';
        let lastIndex = 0;

        nameMatch.indices.forEach(([start, end]) => {
            result += this.escapeHtml(text.slice(lastIndex, start));
            result += `<mark>${this.escapeHtml(text.slice(start, end + 1))}</mark>`;
            lastIndex = end + 1;
        });
        result += this.escapeHtml(text.slice(lastIndex));

        return result;
    }

    hideAutocomplete() {
        const autocomplete = document.getElementById('searchAutocomplete');
        if (autocomplete) {
            autocomplete.classList.add('hidden');
        }
    }

    navigateAutocomplete(direction) {
        const autocomplete = document.getElementById('searchAutocomplete');
        if (!autocomplete || autocomplete.classList.contains('hidden')) return;

        const items = Array.from(autocomplete.querySelectorAll('.search-autocomplete__item'));
        if (items.length === 0) return;

        const currentIndex = items.findIndex(i => i.classList.contains('search-autocomplete__item--selected'));
        let newIndex;

        if (currentIndex === -1) {
            newIndex = direction === 1 ? 0 : items.length - 1;
        } else {
            items[currentIndex].classList.remove('search-autocomplete__item--selected');
            newIndex = (currentIndex + direction + items.length) % items.length;
        }

        items[newIndex].classList.add('search-autocomplete__item--selected');
        items[newIndex].scrollIntoView({ block: 'nearest' });
    }

    handleSearchSelection(type, id) {
        if (type === 'map') {
            if (this.onMapLoad) this.onMapLoad(id);
        } else if (type === 'class') {
            // Scroll to class card
            const classCard = document.querySelector(`.map-card--class[data-class-id="${id}"]`);
            if (classCard) {
                classCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                classCard.classList.add('highlight');
                setTimeout(() => classCard.classList.remove('highlight'), 2000);
            }
        } else if (type === 'category') {
            // Filter by category
            if (this.onCategoryChange) this.onCategoryChange(id);
        }
    }

    // ============================================
    // Address/Postcode Geocoding (Step 2)
    // ============================================

    async performAddressSearch(query) {
        const autocomplete = document.getElementById('searchAutocomplete');
        const addressResults = document.getElementById('addressResults');

        // Show loading state in autocomplete
        if (autocomplete) {
            autocomplete.innerHTML = '<div class="search-autocomplete__loading">Searching addresses...</div>';
            autocomplete.classList.remove('hidden');
        }

        try {
            // Use Nominatim API (OpenStreetMap)
            const encoded = encodeURIComponent(query + ', Northern Ireland, UK');
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=5&countrycodes=gb`,
                { headers: { 'Accept': 'application/json' } }
            );

            if (!response.ok) throw new Error('Geocoding failed');

            const results = await response.json();

            if (results.length === 0) {
                if (autocomplete) {
                    autocomplete.innerHTML = '<div class="search-autocomplete__empty">No addresses found</div>';
                }
                return;
            }

            this.renderAddressResults(results);

        } catch (error) {
            console.error('[UIController] Address search error:', error);
            if (autocomplete) {
                autocomplete.innerHTML = '<div class="search-autocomplete__empty">Address search unavailable</div>';
            }
        }
    }

    renderAddressResults(results) {
        const autocomplete = document.getElementById('searchAutocomplete');
        if (!autocomplete) return;

        const html = results.map(result => {
            const displayName = result.display_name.split(',').slice(0, 3).join(', ');
            const type = result.type || 'place';

            return `<div class="search-autocomplete__item search-autocomplete__item--address" 
                         data-type="address" 
                         data-lat="${result.lat}" 
                         data-lon="${result.lon}"
                         data-name="${this.escapeHtml(displayName)}">
                <span class="search-autocomplete__icon">📍</span>
                <div class="search-autocomplete__content">
                    <span class="search-autocomplete__name">${this.escapeHtml(displayName)}</span>
                    <span class="search-autocomplete__meta">${type}</span>
                </div>
            </div>`;
        }).join('');

        autocomplete.innerHTML = html;
        autocomplete.classList.remove('hidden');

        // Add click handlers for address results
        autocomplete.querySelectorAll('.search-autocomplete__item--address').forEach(item => {
            item.addEventListener('click', () => {
                const lat = parseFloat(item.dataset.lat);
                const lon = parseFloat(item.dataset.lon);
                const name = item.dataset.name;
                this.handleAddressSelection(lat, lon, name);
                this.hideAutocomplete();
            });
        });
    }

    handleAddressSelection(lat, lon, name) {
        // Notify map controller to zoom to location
        if (this.onAddressSelect) {
            this.onAddressSelect(lat, lon, name);
        }

        // Also check what layers contain this point
        this.checkSpatialIntersection(lat, lon, name);
    }

    async checkSpatialIntersection(lat, lon, name) {
        const addressResults = document.getElementById('addressResults');
        if (!addressResults) return;

        // Show the address results panel
        addressResults.classList.remove('hidden');
        addressResults.innerHTML = `
            <div class="address-results__header">
                <h4>📍 ${this.escapeHtml(name)}</h4>
                <button class="address-results__close" title="Close">×</button>
            </div>
            <div class="address-results__content">
                <p class="text-muted text-sm">Checking loaded boundaries...</p>
            </div>
        `;

        // Close button handler
        addressResults.querySelector('.address-results__close')?.addEventListener('click', () => {
            addressResults.classList.add('hidden');
            this.removeAddressMarker();
        });

        // Request intersection check from map controller
        if (this.onCheckIntersection) {
            const intersections = await this.onCheckIntersection(lat, lon);
            this.renderIntersectionResults(intersections, lat, lon);
        }
    }

    renderIntersectionResults(intersections, lat, lon) {
        const addressResults = document.getElementById('addressResults');
        const contentEl = addressResults?.querySelector('.address-results__content');
        if (!contentEl) return;

        if (!intersections || intersections.length === 0) {
            contentEl.innerHTML = '<p class="text-muted text-sm">No loaded boundaries contain this location. Load some maps to see which areas include this address.</p>';
            return;
        }

        const html = `
            <p class="text-sm mb-2">This location is within:</p>
            <ul class="address-results__list">
                ${intersections.map(item => `
                    <li class="address-results__item">
                        <span class="address-results__color" style="background: ${item.color || '#888'}"></span>
                        <span class="address-results__name">${this.escapeHtml(item.featureName)}</span>
                        <span class="address-results__layer">${this.escapeHtml(item.mapName)}</span>
                    </li>
                `).join('')}
            </ul>
        `;

        contentEl.innerHTML = html;
    }

    removeAddressMarker() {
        if (this.onRemoveAddressMarker) {
            this.onRemoveAddressMarker();
        }
    }

    // ============================================
    // Utilities

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatFileSize(bytes) {
        if (bytes >= 1048576) return `${Math.round(bytes / 1048576)} MB`;
        if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${bytes} B`;
    }

    // ============================================
    // PHASE 7: Explore Tab (Knowledge Graph)
    // ============================================

    initializeExplore() {
        if (this.exploreInitialized) return;
        this.exploreHistory = [];
        this.exploreHistoryIndex = -1;
        this.setupExploreListeners();
        this.renderExploreHierarchy();
        this.exploreInitialized = true;
    }

    setupExploreListeners() {
        const backBtn = document.getElementById('exploreBack');
        const forwardBtn = document.getElementById('exploreForward');
        const historyBtn = document.getElementById('exploreHistory');
        const homeBtn = document.getElementById('exploreHome');
        const searchInput = document.getElementById('exploreSearch');

        if (backBtn) backBtn.addEventListener('click', () => this.exploreGoBack());
        if (forwardBtn) forwardBtn.addEventListener('click', () => this.exploreGoForward());
        if (homeBtn) homeBtn.addEventListener('click', () => this.showExploreHome());

        // History dropdown toggle
        if (historyBtn) {
            historyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleExploreHistoryDropdown();
            });
        }

        if (searchInput) {
            let debounce;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => this.handleExploreSearch(searchInput.value), 200);
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            this.closeExploreHistoryDropdown();
        });
    }

    toggleExploreHistoryDropdown() {
        const existing = document.querySelector('.explore-history-dropdown');
        if (existing) {
            existing.remove();
            return;
        }

        if (this.exploreHistory.length === 0) {
            return; // Nothing to show
        }

        const historyBtn = document.getElementById('exploreHistory');
        if (!historyBtn) return;

        const dropdown = document.createElement('div');
        dropdown.className = 'explore-history-dropdown';
        dropdown.innerHTML = this.exploreHistory.map((entry, idx) => `
            <button class="explore-history-item ${idx === this.exploreHistoryIndex ? 'explore-history-item--current' : ''}" 
                    data-idx="${idx}">
                ${this.getEntityLabel(entry.type, entry.id)}
            </button>
        `).join('');

        // Position near button
        const btnRect = historyBtn.getBoundingClientRect();
        dropdown.style.position = 'absolute';
        dropdown.style.top = (btnRect.bottom + 4) + 'px';
        dropdown.style.left = btnRect.left + 'px';

        document.body.appendChild(dropdown);

        // Add click listeners
        dropdown.querySelectorAll('.explore-history-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(item.dataset.idx, 10);
                this.exploreHistoryIndex = idx;
                const { type, id } = this.exploreHistory[idx];
                this.showEntityInfoWithoutHistory(type, id);
                this.updateExploreNavButtons();
                this.closeExploreHistoryDropdown();
            });
        });
    }

    closeExploreHistoryDropdown() {
        const existing = document.querySelector('.explore-history-dropdown');
        if (existing) existing.remove();
    }

    getEntityLabel(type, id) {
        const data = dataService.getData();
        if (!data) return id;

        if (type === 'category') {
            const cat = (data.categories || []).find(c => c.id === id);
            return cat ? `📁 ${cat.name}` : id;
        } else if (type === 'class') {
            const cls = (data.classes || []).find(c => c.id === id);
            return cls ? `📋 ${cls.name}` : id;
        } else if (type === 'map') {
            const map = (data.maps || []).find(m => m.id === id);
            return map ? `🗺️ ${map.name}` : id;
        } else if (type === 'book') {
            const book = (data.books || []).find(b => b.id === id);
            return book ? `📖 ${book.title || book.name}` : id;
        }
        return id;
    }

    renderExploreHierarchy() {
        const container = document.getElementById('exploreContent');
        if (!container) return;

        const data = dataService.getData();
        if (!data) {
            container.innerHTML = '<p class="text-muted">Loading...</p>';
            return;
        }

        const { categories, classes, maps, books } = data;

        let html = '<div class="explore-hierarchy">';

        // Categories section
        html += '<div class="explore-section"><h3 class="explore-section__title">📂 Categories</h3>';
        (categories || []).forEach(cat => {
            const mapCount = (maps || []).filter(m => m.category === cat.id).length;
            html += `<div class="explore-item explore-item--category" data-type="category" data-id="${cat.id}">
                <span class="explore-item__icon">${cat.icon || '📁'}</span>
                <span class="explore-item__name">${this.escapeHtml(cat.name)}</span>
                <span class="explore-item__count">${mapCount}</span>
            </div>`;
        });
        html += '</div>';

        // Classes section
        html += '<div class="explore-section"><h3 class="explore-section__title">📋 Classes</h3>';
        (classes || []).slice(0, 10).forEach(cls => {
            html += `<div class="explore-item explore-item--class" data-type="class" data-id="${cls.id}">
                <span class="explore-item__icon">📋</span>
                <span class="explore-item__name">${this.escapeHtml(cls.name)}</span>
                <span class="explore-item__count">${(cls.maps || []).length}</span>
            </div>`;
        });
        if ((classes || []).length > 10) {
            html += `<div class="explore-item explore-item--more">...and ${classes.length - 10} more classes</div>`;
        }
        html += '</div>';

        // Recent maps
        html += '<div class="explore-section"><h3 class="explore-section__title">🗺️ Featured Maps</h3>';
        (maps || []).filter(m => m.featured).slice(0, 8).forEach(map => {
            html += `<div class="explore-item explore-item--map" data-type="map" data-id="${map.id}">
                <span class="explore-item__color" style="background: ${map.style?.color || '#888'}"></span>
                <span class="explore-item__name">${this.escapeHtml(map.name)}</span>
            </div>`;
        });
        html += '</div>';

        // Books section
        if ((books || []).length > 0) {
            html += '<div class="explore-section"><h3 class="explore-section__title">📚 Books</h3>';
            books.slice(0, 5).forEach(book => {
                html += `<div class="explore-item explore-item--book" data-type="book" data-id="${book.id}">
                    <span class="explore-item__icon">📖</span>
                    <span class="explore-item__name">${this.escapeHtml(book.title || book.name)}</span>
                </div>`;
            });
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;

        // Add click listeners
        container.querySelectorAll('.explore-item[data-type]').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.type;
                const id = item.dataset.id;
                this.showEntityInfo(type, id);
            });
        });
    }

    showEntityInfo(type, id) {
        const container = document.getElementById('exploreContent');
        if (!container) return;

        // Push to history
        this.exploreHistory = this.exploreHistory.slice(0, this.exploreHistoryIndex + 1);
        this.exploreHistory.push({ type, id });
        this.exploreHistoryIndex = this.exploreHistory.length - 1;
        this.updateExploreNavButtons();

        let html = '<div class="explore-detail">';

        // Back button header
        html += `<div class="explore-detail__header">
            <button class="explore-detail__back" onclick="uiController.showExploreHome()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Back to Explore
            </button>
        </div>`;

        if (type === 'category') {
            const categories = dataService.getMapCategories();
            const cat = categories.find(c => c.id === id);
            if (cat) {
                const maps = dataService.getMapsByCategory(id);
                html += `<div class="explore-detail__hero explore-detail__hero--category">
                    <span class="explore-detail__icon">${cat.icon || '📁'}</span>
                    <h2 class="explore-detail__title">${this.escapeHtml(cat.name)}</h2>
                    <p class="explore-detail__subtitle">${maps.length} map${maps.length !== 1 ? 's' : ''} in this category</p>
                </div>`;

                if (cat.description) {
                    html += `<div class="explore-detail__card">
                        <p class="explore-detail__desc">${this.escapeHtml(cat.description)}</p>
                    </div>`;
                }

                html += `<div class="explore-detail__section">
                    <h3 class="explore-detail__section-title">Maps</h3>
                    <div class="explore-detail__grid">`;
                maps.forEach(map => {
                    html += `<div class="explore-detail__item" data-type="map" data-id="${map.id}">
                        <span class="explore-detail__color" style="background: ${map.style?.color || '#888'}"></span>
                        <span class="explore-detail__item-name">${this.escapeHtml(map.name)}</span>
                        ${map.date ? `<span class="explore-detail__item-date">${this.formatMapDate(map.date)}</span>` : ''}
                    </div>`;
                });
                html += '</div></div>';
            }
        } else if (type === 'class') {
            const classes = dataService.getClasses();
            const cls = classes.find(c => c.id === id);
            if (cls) {
                const clsMaps = (cls.maps || []).map(mid => dataService.getMapById(mid)).filter(Boolean);
                html += `<div class="explore-detail__hero explore-detail__hero--class">
                    <span class="explore-detail__icon">📋</span>
                    <h2 class="explore-detail__title">${this.escapeHtml(cls.name)}</h2>
                    <p class="explore-detail__subtitle">${clsMaps.length} map${clsMaps.length !== 1 ? 's' : ''} in this class</p>
                </div>`;

                if (cls.scope) {
                    html += `<div class="explore-detail__card">
                        <div class="explore-detail__meta-row">
                            <span class="explore-detail__label">Scope</span>
                            <span class="explore-detail__value">${this.escapeHtml(cls.scope)}</span>
                        </div>
                    </div>`;
                }

                html += `<div class="explore-detail__section">
                    <h3 class="explore-detail__section-title">Maps in Class</h3>
                    <div class="explore-detail__grid">`;
                clsMaps.forEach(map => {
                    html += `<div class="explore-detail__item" data-type="map" data-id="${map.id}">
                        <span class="explore-detail__color" style="background: ${map.style?.color || '#888'}"></span>
                        <span class="explore-detail__item-name">${this.escapeHtml(map.name)}</span>
                        ${map.date ? `<span class="explore-detail__item-date">${this.formatMapDate(map.date)}</span>` : ''}
                    </div>`;
                });
                html += '</div></div>';
            }
        } else if (type === 'map') {
            const map = dataService.getMapById(id);
            if (map) {
                html += `<div class="explore-detail__hero explore-detail__hero--map">
                    <span class="explore-detail__color-large" style="background: ${map.style?.color || '#888'}"></span>
                    <h2 class="explore-detail__title">${this.escapeHtml(map.name)}</h2>
                    ${map.date ? `<p class="explore-detail__subtitle">${this.formatMapDate(map.date)}</p>` : ''}
                </div>`;

                // Action button
                html += `<div class="explore-detail__actions">
                    <button class="btn btn--primary btn--lg" onclick="uiController.onMapLoad && uiController.onMapLoad('${map.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                        Load Map
                    </button>
                </div>`;

                // Metadata card
                html += '<div class="explore-detail__card">';
                if (map.provider && map.provider.length > 0) {
                    html += `<div class="explore-detail__meta-row">
                        <span class="explore-detail__label">Provider</span>
                        <span class="explore-detail__value">${this.escapeHtml(map.provider.join(', '))}</span>
                    </div>`;
                }
                if (map.category) {
                    html += `<div class="explore-detail__meta-row">
                        <span class="explore-detail__label">Category</span>
                        <span class="explore-detail__value explore-detail__link" data-type="category" data-id="${map.category}">${this.escapeHtml(map.category)}</span>
                    </div>`;
                }
                if (map.labelProperty) {
                    html += `<div class="explore-detail__meta-row">
                        <span class="explore-detail__label">Label Field</span>
                        <span class="explore-detail__value"><code>${this.escapeHtml(map.labelProperty)}</code></span>
                    </div>`;
                }
                html += '</div>';

                // Keywords
                if (map.keywords && map.keywords.length > 0) {
                    html += `<div class="explore-detail__section">
                        <h3 class="explore-detail__section-title">Keywords</h3>
                        <div class="explore-detail__tags">
                            ${map.keywords.map(k => `<span class="explore-detail__tag">${this.escapeHtml(k)}</span>`).join('')}
                        </div>
                    </div>`;
                }

                // Variants
                if (map.variants && map.variants.length > 0) {
                    html += `<div class="explore-detail__section">
                        <h3 class="explore-detail__section-title">Variants (${map.variants.length})</h3>
                        <div class="explore-detail__grid">`;
                    map.variants.forEach(v => {
                        html += `<div class="explore-detail__item" data-type="map" data-id="${v.id}">
                            <span class="explore-detail__item-name">${this.escapeHtml(v.label || v.id)}</span>
                        </div>`;
                    });
                    html += '</div></div>';
                }
            }
        } else if (type === 'book') {
            const book = dataService.getBookById(id);
            if (book) {
                html += `<div class="explore-detail__hero explore-detail__hero--book">
                    <span class="explore-detail__icon">📖</span>
                    <h2 class="explore-detail__title">${this.escapeHtml(book.title || book.name)}</h2>
                    ${book.year ? `<p class="explore-detail__subtitle">${book.year}</p>` : ''}
                </div>`;

                html += '<div class="explore-detail__card">';
                if (book.authors && book.authors.length > 0) {
                    html += `<div class="explore-detail__meta-row">
                        <span class="explore-detail__label">Authors</span>
                        <span class="explore-detail__value">${this.escapeHtml(book.authors.join(', '))}</span>
                    </div>`;
                }
                if (book.publisher) {
                    html += `<div class="explore-detail__meta-row">
                        <span class="explore-detail__label">Publisher</span>
                        <span class="explore-detail__value">${this.escapeHtml(book.publisher)}</span>
                    </div>`;
                }
                html += '</div>';

                if (book.description) {
                    html += `<div class="explore-detail__section">
                        <p class="explore-detail__desc">${this.escapeHtml(book.description)}</p>
                    </div>`;
                }
            }
        }

        html += '</div>';
        container.innerHTML = html;

        // Add link listeners for all clickable items
        container.querySelectorAll('.explore-detail__item[data-type], .explore-detail__link[data-type]').forEach(link => {
            link.addEventListener('click', () => {
                this.showEntityInfo(link.dataset.type, link.dataset.id);
            });
        });
    }

    exploreGoBack() {
        if (this.exploreHistoryIndex > 0) {
            this.exploreHistoryIndex--;
            const { type, id } = this.exploreHistory[this.exploreHistoryIndex];
            // Don't push to history when navigating back
            const container = document.getElementById('exploreContent');
            if (container) this.showEntityInfoWithoutHistory(type, id);
            this.updateExploreNavButtons();
        } else {
            this.showExploreHome();
        }
    }

    exploreGoForward() {
        if (this.exploreHistoryIndex < this.exploreHistory.length - 1) {
            this.exploreHistoryIndex++;
            const { type, id } = this.exploreHistory[this.exploreHistoryIndex];
            this.showEntityInfoWithoutHistory(type, id);
            this.updateExploreNavButtons();
        }
    }

    showEntityInfoWithoutHistory(type, id) {
        // Same as showEntityInfo but doesn't modify history
        const container = document.getElementById('exploreContent');
        if (!container) return;
        // Simplified - just show the entity
        this.showEntityInfo(type, id);
        // Pop the duplicate entry we just added
        this.exploreHistory.pop();
        this.exploreHistoryIndex--;
    }

    showExploreHome() {
        this.renderExploreHierarchy();
        this.exploreHistory = [];
        this.exploreHistoryIndex = -1;
        this.updateExploreNavButtons();
    }

    updateExploreNavButtons() {
        const backBtn = document.getElementById('exploreBack');
        const forwardBtn = document.getElementById('exploreForward');
        if (backBtn) backBtn.disabled = this.exploreHistoryIndex <= 0;
        if (forwardBtn) forwardBtn.disabled = this.exploreHistoryIndex >= this.exploreHistory.length - 1;
    }

    handleExploreSearch(query) {
        const container = document.getElementById('exploreContent');
        if (!container) return;

        if (!query || query.trim().length < 2) {
            this.renderExploreHierarchy();
            return;
        }

        const q = query.toLowerCase().trim();
        const data = dataService.getData();
        if (!data) return;

        const results = [];

        // Search categories
        (data.categories || []).forEach(cat => {
            if (cat.name.toLowerCase().includes(q) || cat.id.includes(q)) {
                results.push({ type: 'category', item: cat, name: cat.name, icon: cat.icon || '📂' });
            }
        });

        // Search classes
        (data.classes || []).forEach(cls => {
            if (cls.name.toLowerCase().includes(q) || cls.id.includes(q)) {
                results.push({ type: 'class', item: cls, name: cls.name, icon: '📋' });
            }
        });

        // Search maps
        (data.maps || []).forEach(map => {
            const searchText = [map.name, map.id, ...(map.keywords || [])].join(' ').toLowerCase();
            if (searchText.includes(q)) {
                results.push({ type: 'map', item: map, name: map.name, color: map.style?.color });
            }
        });

        // Search books
        (data.books || []).forEach(book => {
            const searchText = [book.title || book.name, book.id, ...(book.keywords || [])].join(' ').toLowerCase();
            if (searchText.includes(q)) {
                results.push({ type: 'book', item: book, name: book.title || book.name, icon: '📖' });
            }
        });

        // Render results
        let html = `<div class="explore-search-results"><h3>Search results for "${this.escapeHtml(query)}" (${results.length})</h3>`;
        if (results.length === 0) {
            html += '<p class="text-muted">No results found.</p>';
        } else {
            results.slice(0, 50).forEach(r => {
                html += `<div class="explore-item explore-item--${r.type}" data-type="${r.type}" data-id="${r.item.id}">
                    ${r.color ? `<span class="explore-item__color" style="background: ${r.color}"></span>` : `<span class="explore-item__icon">${r.icon || ''}</span>`}
                    <span class="explore-item__name">${this.escapeHtml(r.name)}</span>
                    <span class="explore-item__type">${r.type}</span>
                </div>`;
            });
        }
        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.explore-item[data-type]').forEach(item => {
            item.addEventListener('click', () => {
                this.showEntityInfo(item.dataset.type, item.dataset.id);
            });
        });
    }

    // ============================================
    // Advanced Features
    // ============================================

    // Class collapse/expand persistence
    isClassCollapsed(classId) {
        try {
            return localStorage.getItem(`ni-boundaries.class-collapsed.${classId}`) === 'true';
        } catch { return false; }
    }

    setClassCollapsed(classId, collapsed) {
        try {
            localStorage.setItem(`ni-boundaries.class-collapsed.${classId}`, collapsed ? 'true' : 'false');
        } catch { /* ignore */ }
    }

    toggleClassCollapse(classId, cardElement) {
        const membersEl = cardElement.querySelector('.class-card__members');
        const isCollapsed = membersEl?.classList.contains('collapsed');
        if (membersEl) {
            membersEl.classList.toggle('collapsed', !isCollapsed);
            this.setClassCollapsed(classId, !isCollapsed);
        }
    }

    // Variants expansion
    toggleVariants(mapId, parentElement) {
        const variantContainer = parentElement.querySelector(`.variants-container[data-parent-id="${mapId}"]`);
        if (variantContainer) {
            variantContainer.classList.toggle('variants-container--expanded');
            const btn = parentElement.querySelector(`.variants-toggle[data-map-id="${mapId}"]`);
            if (btn) btn.classList.toggle('active');
        }
    }

    renderVariantsDropdown(map, isLoaded) {
        if (!map.variants || map.variants.length === 0) return '';

        let html = `<div class="variants-container" data-parent-id="${map.id}">`;
        map.variants.forEach(variant => {
            const variantLoaded = false; // Would check actual state
            const description = variant.description || '';
            html += `<div class="variant-item" data-map-id="${variant.id}">
                <div class="variant-item__info">
                    <div class="variant-item__name">${this.escapeHtml(variant.label || variant.id)}</div>
                    ${description ? `<div class="variant-item__description">${this.escapeHtml(description)}</div>` : ''}
                </div>
                <div class="variant-item__actions">
                    <button class="btn btn--icon btn--xs load-btn" data-map-id="${variant.id}" title="Load">+</button>
                    <div class="overflow-menu">
                        <button class="overflow-menu__trigger" title="More actions">⋮</button>
                        <div class="overflow-menu__dropdown">
                            <button class="overflow-menu__item visibility-btn" data-map-id="${variant.id}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                Toggle visibility
                            </button>
                            <button class="overflow-menu__item copy-url-btn" data-map-id="${variant.id}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                Copy URL
                            </button>
                            <button class="overflow-menu__item download-fgb-btn" data-map-id="${variant.id}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                Download FGB
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    // URL state helpers
    getMapIdsFromURL() {
        const hash = window.location.hash;
        const layersMatch = hash.match(/layers=([^&]+)/);
        if (layersMatch) {
            return layersMatch[1].split('%2C').map(decodeURIComponent);
        }
        return [];
    }

    // ============================================
    // Global Entity Search - Spatial Index (Step 10)
    // ============================================

    async loadSpatialIndex() {
        if (this.spatialIndex) return this.spatialIndex;

        try {
            const response = await fetch('data/spatial-index.json');
            if (!response.ok) throw new Error('Failed to load spatial index');

            this.spatialIndex = await response.json();
            this.spatialIndexByMap = new Map();

            // Group features by mapId for efficient lookup
            (this.spatialIndex.features || []).forEach(feature => {
                const mapId = feature.mapId;
                if (!this.spatialIndexByMap.has(mapId)) {
                    this.spatialIndexByMap.set(mapId, []);
                }
                this.spatialIndexByMap.get(mapId).push(feature);
            });

            console.log(`[UIController] Loaded spatial index: ${this.spatialIndex.features?.length || 0} features`);
            return this.spatialIndex;
        } catch (e) {
            console.warn('[UIController] Spatial index not available:', e);
            this.spatialIndex = { features: [] };
            return this.spatialIndex;
        }
    }

    async searchFeatures(query) {
        if (!this.spatialIndex) {
            await this.loadSpatialIndex();
        }

        if (!query || query.length < 2) return [];

        const searchTerm = query.toLowerCase().trim();
        const results = [];
        const maxResults = 25;

        for (const feature of this.spatialIndex.features || []) {
            if (results.length >= maxResults) break;

            const name = (feature.name || feature.properties?.Name || feature.properties?.name || '').toLowerCase();

            if (name.includes(searchTerm)) {
                results.push({
                    id: feature.id,
                    name: feature.name || feature.properties?.Name || feature.properties?.name,
                    mapId: feature.mapId,
                    bbox: feature.bbox,
                    centroid: feature.centroid,
                    score: name.startsWith(searchTerm) ? 2 : 1 // Boost prefix matches
                });
            }
        }

        // Sort by score (prefix matches first), then alphabetically
        results.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.name.localeCompare(b.name);
        });

        return results;
    }

    renderFeatureSearchResults(results, query) {
        const autocomplete = document.getElementById('searchAutocomplete');
        if (!autocomplete) return;

        if (results.length === 0) {
            autocomplete.innerHTML = '<div class="search-autocomplete__empty">No features found</div>';
            autocomplete.classList.remove('hidden');
            return;
        }

        const html = results.map(result => {
            const data = dataService.getData();
            const mapConfig = data?.maps?.find(m => m.id === result.mapId);
            const mapName = mapConfig?.name || result.mapId;

            return `<div class="search-autocomplete__item search-autocomplete__item--feature"
                         data-type="feature"
                         data-feature-id="${result.id}"
                         data-map-id="${result.mapId}"
                         data-bbox="${result.bbox?.join(',') || ''}"
                         data-centroid="${result.centroid?.join(',') || ''}">
                <span class="search-autocomplete__icon">📍</span>
                <div class="search-autocomplete__content">
                    <span class="search-autocomplete__name">${this.highlightText(result.name, query)}</span>
                    <span class="search-autocomplete__meta">${this.escapeHtml(mapName)}</span>
                </div>
            </div>`;
        }).join('');

        autocomplete.innerHTML = html;
        autocomplete.classList.remove('hidden');

        // Add click handlers
        autocomplete.querySelectorAll('.search-autocomplete__item--feature').forEach(item => {
            item.addEventListener('click', () => {
                const bboxStr = item.dataset.bbox;
                const mapId = item.dataset.mapId;
                const featureId = item.dataset.featureId;

                if (bboxStr) {
                    const bbox = bboxStr.split(',').map(Number);
                    this.zoomToFeature(bbox, mapId, featureId);
                }

                this.hideAutocomplete();
            });
        });
    }

    zoomToFeature(bbox, mapId, featureId) {
        // First ensure the map is loaded
        if (mapId && this.onMapLoad) {
            const loadedIds = this.getMapIdsFromURL();
            if (!loadedIds.includes(mapId)) {
                this.onMapLoad(mapId);
            }
        }

        // Zoom to bbox
        if (bbox && bbox.length === 4 && this.onZoomToBbox) {
            // bbox format: [minLon, minLat, maxLon, maxLat]
            const [minLon, minLat, maxLon, maxLat] = bbox;
            this.onZoomToBbox([
                [minLat, minLon],
                [maxLat, maxLon]
            ]);
        }

        // Highlight the feature after loading
        if (featureId && this.onHighlightFeature) {
            setTimeout(() => {
                this.onHighlightFeature(mapId, featureId);
            }, 500);
        }

        this.announce(`Zooming to ${featureId}`);
    }

    highlightText(text, query) {
        if (!query || !text) return this.escapeHtml(text);

        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);

        if (index === -1) return this.escapeHtml(text);

        const before = text.slice(0, index);
        const match = text.slice(index, index + query.length);
        const after = text.slice(index + query.length);

        return `${this.escapeHtml(before)}<mark>${this.escapeHtml(match)}</mark>${this.escapeHtml(after)}`;
    }

    async getFeaturesInViewport(bounds, loadedMapIds) {
        if (!this.spatialIndex) {
            await this.loadSpatialIndex();
        }

        const results = [];
        const [southWest, northEast] = bounds;

        for (const mapId of loadedMapIds) {
            const mapFeatures = this.spatialIndexByMap?.get(mapId) || [];

            for (const feature of mapFeatures) {
                if (!feature.centroid) continue;

                const [lon, lat] = feature.centroid;

                // Check if centroid is within viewport
                if (lat >= southWest[0] && lat <= northEast[0] &&
                    lon >= southWest[1] && lon <= northEast[1]) {
                    results.push(feature);
                }
            }
        }

        return results;
    }
}

// Export singleton
const uiController = new UIController();

// Attach to window for onclick handlers in dynamic HTML
if (typeof window !== 'undefined') {
    window.uiController = uiController;
}

// ─── Thumbnail hover preview ───────────────────────────────────
(function initThumbnailPreview() {
    const preview = document.createElement('div');
    preview.className = 'thumbnail-preview';
    preview.innerHTML = '<img>';
    document.body.appendChild(preview);
    const previewImg = preview.querySelector('img');

    const ZONE_SELECTOR = '.thumb-zone';
    const OFFSET_X = 16;
    const OFFSET_Y = 16;

    document.addEventListener('mouseenter', (e) => {
        const zone = e.target.closest(ZONE_SELECTOR);
        if (!zone) return;
        const img = zone.querySelector('img');
        if (!img || img.style.display === 'none') return;
        previewImg.src = img.src;
        preview.style.display = 'block';
    }, true);

    document.addEventListener('mouseleave', (e) => {
        const zone = e.target.closest(ZONE_SELECTOR);
        if (!zone) return;
        // Only hide if we're actually leaving the zone (not entering a child)
        if (!zone.contains(e.relatedTarget)) {
            preview.style.display = 'none';
        }
    }, true);

    document.addEventListener('mousemove', (e) => {
        if (preview.style.display !== 'block') return;
        const pw = 162;
        const ph = 162;
        let x = e.clientX + OFFSET_X;
        let y = e.clientY + OFFSET_Y;
        if (x + pw > window.innerWidth) x = e.clientX - OFFSET_X - pw;
        if (y + ph > window.innerHeight) y = e.clientY - OFFSET_Y - ph;
        preview.style.left = x + 'px';
        preview.style.top = y + 'px';
    });
})();

export default uiController;
