/**
 * NI Boundaries - UI Controller
 * Handles split-pane layout, search, filtering, map catalogue, and UI interactions
 */

import dataService from './data-service.js';
import featureLoader from './feature-loader.js';
import { formatElectionDate, shortBodyName, renderElectionConstituencyFeatureLink } from './election-utils.js';

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
        this.onCheckMapLoaded = null;
        this.onLoadSingleFeature = null;
        this.onHideMap = null;
        this.onVisibilityToggle = null;
        this.onCategoryChange = null;
        this.onProviderCategoryChange = null;
        this.onExpandToFullMap = null;
        this.onPartialFeatureToggle = null;
        this.onPartialFeatureUnload = null;
        this.onCheckFeatureLoaded = null;
        this.onCheckFeatureVisible = null;
        this.onFeatureLoad = null;
        this.onSearch = null;
        this.onMapDetailClick = null;
        this.onOpenElectionEntityDetail = null;
        this.onElectionEntityElectionOpen = null;
        this.onOpenElectionConstituencyFeature = null;
        this.onBuildElectionCatalogueCards = null;   // async () => cards[]
        this.onLoadElection = null;                   // (body, date) => void
        this.onSetupElectionTableControls = null;     // (dataTable) => void
        this._searchAddressAbortController = null;

        // Catalogue navigation state
        this.catalogueHistory = [];
        this.catalogueHistoryIndex = -1;
        this.catalogueView = 'list'; // 'list' or 'detail'
        this._lastMapListOptions = {};
        this._cataloguePane = null;
        this._electionEntityDetailCache = new Map();
        this._catalogueBookView = null;
        this._bookMarkdownCache = new Map();
    }

    init() {
        this.mediaQuery = window.matchMedia('(max-width: 768px)');
        this.isMobile = this.mediaQuery.matches;
        this.mediaQuery.addEventListener('change', (e) => {
            this.isMobile = e.matches;
            if (!e.matches) {
                // Crossed from mobile ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ desktop: restore saved desktop preference
                // If no explicit desktop preference exists, default to balanced
                // so that both panes are visible
                try {
                    const pref = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
                    if (pref.desktop && this.getAllowedStates().some(s => s.id === pref.desktop)) {
                        this.currentStateId = pref.desktop;
                    } else {
                        this.currentStateId = 'balanced';
                    }
                } catch (err) {
                    this.currentStateId = 'balanced';
                }
            } else {
                // Crossed from desktop ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ mobile: default to map-full
                // unless a mobile preference was explicitly saved
                try {
                    const pref = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
                    if (pref.mobile && this.getAllowedStates().some(s => s.id === pref.mobile)) {
                        this.currentStateId = pref.mobile;
                    } else {
                        this.currentStateId = 'map-full';
                    }
                } catch (err) {
                    this.currentStateId = 'map-full';
                }
            }
            this.updateSplitState();
            // Ensure Leaflet map resizes
            setTimeout(() => {
                if (window.mapController?.map) {
                    window.mapController.map.invalidateSize();
                }
            }, 350);
        });
        this.loadPreference();
        this.setupSplitToggle();
        this.setupTabSwitching();
        this.setupCatalogueReturnTop();
        this.setupCatalogueNav();
        this.setupCatalogueViewToggle();
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
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                if (this.isOnMainCataloguePage()) {
                    this.scrollCatalogueToTop();
                } else {
                    this.showCatalogueListView(true);
                }
            });
        }

        if (this.catalogueHistory.length === 0) {
            this._pushCatalogueHistoryEntry({ type: 'list' });
        }
        this.updateCatalogueNavButtons();

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
            this._pushCatalogueHistoryEntry({ type: 'detail', mapId });
        }

        this.catalogueView = 'detail';

        // Get DOM elements
        const nav = document.getElementById('catalogueNav');
        const listView = document.getElementById('catalogueListView');
        const detailView = document.getElementById('catalogueDetailView');

        if (!nav || !listView || !detailView) return;

        // Show nav, hide list, show detail
        listView.classList.add('hidden');
        detailView.classList.remove('hidden');

        // Update nav button states
        this.updateCatalogueNavButtons();

        // Render detail content
        const isLoaded = this.getMapIdsFromURL().includes(map.id);
        const color = map.style?.color || '#888';
        const formattedDate = this.formatMapDate(map.date) || '';

        // Get category name
        const categories = dataService.getMapCategories() || [];
        const category = categories.find(c => c.id === map.category);
        const categoryName = category?.name || map.category || 'Unknown';

        // Build badges HTML
        let badgesHtml = '';
        const badges = [];
        if (map.featured) badges.push('<span class="catalogue-detail__badge catalogue-detail__badge--featured">Featured</span>');
        if (map.isGroup) badges.push('<span class="catalogue-detail__badge catalogue-detail__badge--group">Group</span>');
        if (map.hidden) badges.push('<span class="catalogue-detail__badge catalogue-detail__badge--hidden">Hidden</span>');
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

        // Build references HTML (Wikipedia-style numbered list)
        const referencesHtml = (map.references || []).map((ref, i) => {
            const num = i + 1;
            const label = ref.label ? this.escapeHtml(ref.label) : ref.url;
            const link = ref.url ? `<a href="${this.escapeHtml(ref.url)}" target="_blank" rel="noopener">${label}</a>` : label;
            const note = ref.note ? ` <span class="catalogue-detail__ref-note">${this.escapeHtml(ref.note)}</span>` : '';
            const accessed = ref.accessed ? ` <span class="catalogue-detail__ref-accessed">Accessed ${this.escapeHtml(ref.accessed)}</span>` : '';
            return `<div class="catalogue-detail__ref"><span class="catalogue-detail__ref-num">[${num}]</span> ${link}${note}${accessed}</div>`;
        }).join('');

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
                                    ${variant.provider ? `<span style="color: var(--color-text-muted); font-size: var(--text-xs);"> &middot; ${variant.provider.join(', ')}</span>` : ''}
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
                                    ${member.provider ? `<span style="color: var(--color-text-muted); font-size: var(--text-xs);"> &middot; ${member.provider.join(', ')}</span>` : ''}
                                </div>
                            ` : `<div class="catalogue-detail__variant">${this.escapeHtml(memberId)}</div>`;
            }).join('')}
                    </div>
                </div>`;
        }

        detailView.innerHTML = `
            <button class="catalogue-detail__back" id="catalogueBackLink">Back to Catalogue</button>

            <div class="catalogue-detail__card">
                <div class="catalogue-detail__color" style="background-color: ${color}"></div>
                <div class="catalogue-detail__name">${this.escapeHtml(map.name)}</div>
                ${formattedDate ? `<div class="catalogue-detail__date">${formattedDate}</div>` : ''}
            </div>

            ${badgesHtml}

            ${descriptionHtml}

            ${this.renderMapActionStrip(map, {
            isLoaded,
            isVisible: this.onCheckMapVisible ? this.onCheckMapVisible(map.id) : isLoaded,
            buttonSize: 'sm',
            wrapperClass: 'map-card__actions catalogue-detail__actions'
        })}

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
                    <span class="catalogue-detail__meta-value">${map.style?.color ? `<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${this.escapeHtml(map.style.color)};vertical-align:middle;margin-right:4px;border:1px solid rgba(128,128,128,0.3)"></span>` : ''}${this.escapeHtml(styleStr)}</span>
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

            ${referencesHtml ? `
            <div class="catalogue-detail__section">
                <div class="catalogue-detail__section-title">References</div>
                <div class="catalogue-detail__references">${referencesHtml}</div>
            </div>` : ''}

            ${variantsHtml}
            ${membersHtml}

            <div class="catalogue-detail__attr-table" id="catalogueAttrTable">
                <div class="catalogue-detail__attr-table-header" id="catalogueAttrTableHeader">
                    <span class="catalogue-detail__attr-table-title">Feature Attributes</span>
                    <span class="catalogue-detail__attr-table-toggle">&#9660;</span>
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

        this.bindMapActionStrip(detailView, map, { activeClassTarget: detailView, variantsHost: detailView });

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
                    toggle.innerHTML = attrTableBody.classList.contains('catalogue-detail__attr-table-body--collapsed') ? '&#9654;' : '&#9660;';
                }
            });
        }

        // Load attribute schema asynchronously
        this.loadAttributeSchema(map, filePath);
    }

    _pushCatalogueHistoryEntry(entry) {
        this.catalogueHistory = this.catalogueHistory.slice(0, this.catalogueHistoryIndex + 1);
        this.catalogueHistory.push(entry);
        this.catalogueHistoryIndex = this.catalogueHistory.length - 1;
    }

    _getActivePaneTabId() {
        const activeTab = document.querySelector('.pane-tab.pane-tab--active');
        return activeTab?.dataset?.tab || 'catalogue';
    }

    _pushCatalogueTabHistoryIfNeeded(tabId) {
        if (!tabId || tabId === 'catalogue') return;
        const current = this.catalogueHistory[this.catalogueHistoryIndex];
        if (current?.type === 'tab' && current.tabId === tabId) return;
        this._pushCatalogueHistoryEntry({ type: 'tab', tabId });
    }

    /**
     * Resolve the primary feature name for table/detail interactions.
     */
    resolveFeaturePrimaryName(feature, mapConfig) {
        const props = feature?.properties || {};
        const preferredKeys = [];
        if (mapConfig?.labelProperty) preferredKeys.push(mapConfig.labelProperty);
        if (Array.isArray(mapConfig?.labelPropertyFallbacks)) {
            preferredKeys.push(...mapConfig.labelPropertyFallbacks);
        }
        preferredKeys.push(
            'Name', 'name', 'NAME',
            'FinalR_DEA', 'DEA', 'DEANAME', 'WARDNAME', 'LGDNAME',
            'CONSTITUENCY', 'COUNTY', 'PARISH', 'BARONY'
        );
        const seen = new Set();
        for (const key of preferredKeys) {
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const val = props[key];
            if (typeof val === 'string' && val.trim()) {
                return { key, value: val.trim() };
            }
        }
        const fallback = Object.entries(props).find(([k, v]) =>
            typeof v === 'string' &&
            v.trim() &&
            /(name|title|label|dea|ward|district|constituency|county)/i.test(k)
        );
        if (fallback) return { key: fallback[0], value: fallback[1].trim() };
        return { key: null, value: 'Unnamed Feature' };
    }

    createFeatureDetailId(mapId, featureId, primaryName) {
        return `${mapId || 'feature'}:${featureId ?? primaryName}`;
    }

    createElectionEntityDetailId(kind, key) {
        return `election:${kind}:${key}`;
    }

    cacheElectionEntityDetailEntry(entity) {
        if (!entity?.kind || !entity?.key) return null;
        const detailId = this.createElectionEntityDetailId(entity.kind, entity.key);
        this._electionEntityDetailCache.set(detailId, entity);
        return detailId;
    }

    cacheFeatureDetailEntry(mapConfig, feature, primaryNameOverride = null, featureIdOverride = null, extra = null) {
        const primary = primaryNameOverride
            ? { value: primaryNameOverride }
            : this.resolveFeaturePrimaryName(feature, mapConfig);
        const featureId = featureIdOverride ?? feature?.id;
        const detailId = this.createFeatureDetailId(mapConfig?.id, featureId, primary.value);
        if (!this._featureDetailCache) this._featureDetailCache = new Map();
        this._featureDetailCache.set(detailId, {
            feature: {
                mapId: mapConfig?.id,
                id: featureId ?? primary.value,
                properties: feature?.properties || {},
                geometry: feature?.geometry || null
            },
            mapConfig,
            primaryName: primary.value,
            electoralHistory: extra?.electoralHistory || null
        });
        return detailId;
    }

    slugifyForFilename(value) {
        return String(value || 'feature')
            .normalize('NFKD')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase() || 'feature';
    }

    buildFeatureFileBase(detailId) {
        const entry = this._featureDetailCache?.get(detailId);
        if (!entry) return 'feature';
        const mapSlug = this.slugifyForFilename(entry.mapConfig?.slug || entry.mapConfig?.id || entry.mapConfig?.name || 'map');
        const featureSlug = this.slugifyForFilename(entry.primaryName || entry.feature?.id || 'feature');
        return `${mapSlug}--${featureSlug}`;
    }

    buildFeatureGeoJSON(detailId) {
        const entry = this._featureDetailCache?.get(detailId);
        if (!entry) return null;
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                id: entry.feature?.id ?? undefined,
                properties: entry.feature?.properties || {},
                geometry: entry.feature?.geometry || null
            }]
        };
    }

    buildFeatureShareUrl(detailId) {
        const entry = this._featureDetailCache?.get(detailId);
        if (!entry?.mapConfig?.id) return null;

        const url = new URL(window.location.href);
        const params = new URLSearchParams(url.hash.replace(/^#/, ''));
        const layers = new Set((params.get('layers') || '').split(',').filter(Boolean));
        layers.add(entry.mapConfig.id);
        params.set('layers', Array.from(layers).join(','));
        params.set('featureMap', entry.mapConfig.id);
        params.set('featureId', String(entry.feature?.id ?? ''));
        params.set('featureName', entry.primaryName || 'Feature');
        url.hash = params.toString();
        return url.toString();
    }

    copyFeatureUrl(detailId, buttonEl) {
        const shareUrl = this.buildFeatureShareUrl(detailId);
        if (!shareUrl) return;

        navigator.clipboard.writeText(shareUrl).then(() => {
            const originalTitle = buttonEl?.getAttribute('title');
            if (buttonEl) {
                buttonEl.setAttribute('title', 'Copied!');
                setTimeout(() => {
                    buttonEl.setAttribute('title', originalTitle || 'Copy shareable URL');
                }, 1500);
            }
            this.announce('Feature URL copied to clipboard');
        }).catch(err => {
            console.error('[UIController] Failed to copy feature URL:', err);
        });
    }

    triggerBlobDownload(blob, filename) {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }

    featureToCsv(detailId) {
        const entry = this._featureDetailCache?.get(detailId);
        if (!entry) return null;
        const props = entry.feature?.properties || {};
        const headers = [...Object.keys(props), 'geometry_type'];
        const values = headers.map((header) => {
            if (header === 'geometry_type') return entry.feature?.geometry?.type || '';
            const value = props[header];
            if (value === null || value === undefined) return '';
            if (typeof value === 'object') return JSON.stringify(value);
            return String(value);
        });
        const escapeCsv = (value) => {
            const text = String(value ?? '');
            if (/[",\n]/.test(text)) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };
        return `${headers.map(escapeCsv).join(',')}\n${values.map(escapeCsv).join(',')}\n`;
    }

    downloadFeature(detailId, format) {
        const entry = this._featureDetailCache?.get(detailId);
        if (!entry) return;

        const base = this.buildFeatureFileBase(detailId);
        const featureGeoJSON = this.buildFeatureGeoJSON(detailId);
        if (!featureGeoJSON) return;

        if (format === 'geojson') {
            this.triggerBlobDownload(
                new Blob([JSON.stringify(featureGeoJSON, null, 2)], { type: 'application/geo+json' }),
                `${base}.geojson`
            );
            return;
        }

        if (format === 'json') {
            const payload = {
                mapId: entry.mapConfig?.id || null,
                mapName: entry.mapConfig?.name || null,
                feature: featureGeoJSON.features[0]
            };
            this.triggerBlobDownload(
                new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
                `${base}.json`
            );
            return;
        }

        if (format === 'csv') {
            const csv = this.featureToCsv(detailId);
            if (!csv) return;
            this.triggerBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
            return;
        }

        if (format === 'fgb') {
            try {
                const bytes = flatgeobuf.serialize(featureGeoJSON);
                this.triggerBlobDownload(new Blob([bytes], { type: 'application/octet-stream' }), `${base}.fgb`);
                return;
            } catch (err) {
                console.error('[UIController] Failed to serialize feature FGB:', err);
                this.announce('Failed to export feature as FGB');
            }
        }
    }

    syncFeatureDetailActionButtons(container, detailId) {
        const entry = this._featureDetailCache?.get(detailId);
        if (!container || !entry?.mapConfig?.id) return;
        const mapId = entry.mapConfig.id;
        const featureIndex = entry.feature?.id;
        const isLoaded = this.onCheckFeatureLoaded ? !!this.onCheckFeatureLoaded(mapId, featureIndex) : false;
        const isVisible = this.onCheckFeatureVisible ? !!this.onCheckFeatureVisible(mapId, featureIndex) : false;

        const loadBtn = container.querySelector('.feature-load-btn');
        if (loadBtn) {
            loadBtn.innerHTML = this.getLoadButtonIcon(isLoaded);
            loadBtn.title = isLoaded ? 'Unload feature' : 'Load feature';
            loadBtn.setAttribute('aria-label', isLoaded ? 'Unload feature' : 'Load feature');
        }

        const visibilityBtn = container.querySelector('.feature-visibility-btn');
        if (visibilityBtn) {
            visibilityBtn.innerHTML = this.getVisibilityButtonIcon(isVisible);
            visibilityBtn.title = isVisible ? 'Hide feature' : 'Show feature';
            visibilityBtn.setAttribute('aria-label', isVisible ? 'Hide feature' : 'Show feature');
            visibilityBtn.disabled = !isLoaded;
        }
    }

    getFeatureBBox(geometry) {
        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        const visit = (coords) => {
            if (!Array.isArray(coords)) return;
            if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
                const [x, y] = coords;
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    bounds.minX = Math.min(bounds.minX, x);
                    bounds.minY = Math.min(bounds.minY, y);
                    bounds.maxX = Math.max(bounds.maxX, x);
                    bounds.maxY = Math.max(bounds.maxY, y);
                }
                return;
            }
            coords.forEach(visit);
        };
        visit(geometry?.coordinates);
        if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return null;
        return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
    }

    focusFeatureFromTable(mapConfig, feature, featureIndex, featureName, bbox) {
        if (!mapConfig) return;
        if (mapConfig.id && this.onLoadSingleFeature) {
            this.onLoadSingleFeature(mapConfig.id, featureIndex, featureName || null, bbox || null);
        } else if (mapConfig.id && this.onMapLoad) {
            const loadedIds = this.getMapIdsFromURL();
            if (!loadedIds.includes(mapConfig.id)) this.onMapLoad(mapConfig.id);
        }

        if (bbox && bbox.length === 4 && this.onZoomToBbox) {
            this.onZoomToBbox([
                [bbox[1], bbox[0]],
                [bbox[3], bbox[2]]
            ], { smooth: true });
        }

        if (mapConfig.id && this.onHighlightFeature) {
            setTimeout(() => {
                this.onHighlightFeature(mapConfig.id, feature?.id ?? featureIndex, {
                    bbox,
                    featureName: featureName || null,
                    labelProperty: mapConfig.labelProperty || null,
                    labelPropertyFallbacks: mapConfig.labelPropertyFallbacks || []
                });
            }, 500);
        }
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
            let allFeatures = [];
            let attrKeys = null;

            if (ext === 'fgb') {
                let featureIterator;
                try {
                    const response = await fetch(effectiveFilePath);
                    featureIterator = flatgeobuf.deserialize(response.body)[Symbol.asyncIterator]();
                } catch (err) {
                    featureIterator = flatgeobuf.deserialize(effectiveFilePath)[Symbol.asyncIterator]();
                }
                while (true) {
                    const result = await featureIterator.next();
                    if (result.done) break;
                    allFeatures.push(result.value);
                }
            } else {
                const response = await fetch(effectiveFilePath);
                const data = await response.json();
                allFeatures = data.features || [data];
            }

            if (allFeatures.length > 0 && allFeatures[0].properties) {
                attrKeys = Object.keys(allFeatures[0].properties);
            }

            if (allFeatures.length === 0 || !attrKeys) {
                attrTableBody.innerHTML = '<div class="catalogue-detail__attr-error">No attributes found</div>';
                return;
            }

            const headerCells = attrKeys.map(key =>
                `<th class="catalogue-detail__attr-th">${this.escapeHtml(key)}</th>`
            ).join('');

            attrTableBody.innerHTML = `
                <div class="catalogue-detail__attr-table-scroll" id="attrTableScroll">
                    <table class="catalogue-detail__attr-table-inner">
                        <thead>
                            <tr class="catalogue-detail__attr-tr catalogue-detail__attr-tr--header">${headerCells}</tr>
                        </thead>
                        <tbody id="attrTableTbody"></tbody>
                    </table>
                </div>
                <div class="catalogue-detail__attr-footer" id="attrTableFooter">Loading ${allFeatures.length} features...</div>
            `;

            const renderBatchSize = 100;
            const scrollContainer = document.getElementById('attrTableScroll');
            const tbody = document.getElementById('attrTableTbody');
            const footer = document.getElementById('attrTableFooter');
            const attrTable = attrTableBody.querySelector('.catalogue-detail__attr-table-inner');
            const headers = attrTable ? [...attrTable.querySelectorAll('thead th')] : [];
            if (!scrollContainer || !tbody || !footer || !attrTable || headers.length === 0) return;

            const formatRawValue = (value) => {
                if (value === null || value === undefined) return '';
                if (typeof value === 'object') {
                    try {
                        return JSON.stringify(value);
                    } catch (err) {
                        return String(value);
                    }
                }
                return String(value);
            };
            const renderCellValue = (value) => {
                if (value === null) {
                    return { html: '<em>null</em>', title: 'null' };
                }
                const display = typeof value === 'object'
                    ? formatRawValue(value)
                    : this.formatDisplayValue(value);
                const truncated = display.substring(0, 50) + (display.length > 50 ? '...' : '');
                return {
                    html: this.escapeHtml(truncated),
                    title: this.escapeHtml(display)
                };
            };
            const renderRow = ({ feature, index }) => {
                const primary = this.resolveFeaturePrimaryName(feature, map);
                const detailId = this.cacheFeatureDetailEntry(map, feature, primary.value, feature?.id ?? index);
                const cells = attrKeys.map(key => {
                    const value = feature.properties?.[key];
                    const rendered = renderCellValue(value);
                    if (primary.key && key === primary.key) {
                        return `<td class="catalogue-detail__attr-td" title="${rendered.title}"><button type="button" class="catalogue-detail__attr-link" data-feature-detail-id="${this.escapeHtml(detailId)}">${rendered.html}</button></td>`;
                    }
                    return `<td class="catalogue-detail__attr-td" title="${rendered.title}">${rendered.html}</td>`;
                }).join('');
                const bbox = this.getFeatureBBox(feature?.geometry);
                return `<tr class="catalogue-detail__attr-tr catalogue-detail__attr-tr--interactive"
                    data-feature-index="${index}"
                    data-feature-id="${this.escapeHtml(String(feature?.id ?? index))}"
                    data-feature-name="${this.escapeHtml(primary.value)}"
                    data-feature-bbox="${bbox ? this.escapeHtml(bbox.join(',')) : ''}"
                    data-feature-detail-id="${this.escapeHtml(detailId)}">${cells}</tr>`;
            };
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
            const getFeatureValue = (feature, key) => formatRawValue(feature?.properties?.[key]);
            const inferColumnKind = (key) => {
                const sample = allFeatures.slice(0, 100).map((feature) => getFeatureValue(feature, key)).filter(Boolean);
                const numHits = sample.filter((v) => parseMaybeNumber(v) !== null).length;
                const ordHits = sample.filter((v) => parseMaybeOrdinal(v) !== null).length;
                const headerText = String(key || '').trim().toLowerCase();
                if (headerText.includes('rank')) return 'ordinal';
                if (sample.length > 0 && numHits / sample.length >= 0.8) return 'numeric';
                if (sample.length > 0 && ordHits / sample.length >= 0.8) return 'ordinal';
                return 'text';
            };
            const compareFeatures = (a, b, key, dir, kind) => {
                if (dir === 'default') return 0;
                const av = getFeatureValue(a, key);
                const bv = getFeatureValue(b, key);
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

            const state = {
                allFeatures: allFeatures.map((feature, index) => ({ feature, index })),
                filteredFeatures: [],
                renderedCount: 0,
                sort: { key: null, dir: 'default' },
                filters: new Map(),
                activeMenu: null,
                activeMenuBtn: null,
                documentClickHandler: null
            };

            const closeMenu = () => {
                if (state.activeMenu) state.activeMenu.remove();
                if (state.activeMenuBtn) state.activeMenuBtn.classList.remove('election-th-btn--open');
                if (state.documentClickHandler) {
                    document.removeEventListener('click', state.documentClickHandler);
                    state.documentClickHandler = null;
                }
                state.activeMenu = null;
                state.activeMenuBtn = null;
            };
            const updateFooter = () => {
                const visibleCount = state.filteredFeatures.length;
                const rendered = Math.min(state.renderedCount, visibleCount);
                if (visibleCount === 0) {
                    footer.textContent = `Showing 0 of ${state.allFeatures.length} features`;
                } else if (visibleCount === state.allFeatures.length) {
                    footer.textContent = rendered < visibleCount
                        ? `Showing ${rendered} of ${visibleCount} features (scroll for more)`
                        : `Showing all ${visibleCount} features`;
                } else {
                    footer.textContent = rendered < visibleCount
                        ? `Showing ${rendered} of ${visibleCount} filtered features from ${state.allFeatures.length} total (scroll for more)`
                        : `Showing all ${visibleCount} filtered features from ${state.allFeatures.length} total`;
                }
            };
            const renderVisibleRows = () => {
                const visible = state.filteredFeatures.slice(0, state.renderedCount);
                if (visible.length === 0) {
                    tbody.innerHTML = `<tr class="catalogue-detail__attr-tr"><td class="catalogue-detail__attr-td" colspan="${attrKeys.length}">No matching features</td></tr>`;
                } else {
                    tbody.innerHTML = visible.map((entry) => renderRow(entry)).join('');
                }
                updateFooter();
            };
            const getUniqueValues = (key) => {
                const values = new Map();
                state.allFeatures.forEach(({ feature }) => {
                    const raw = getFeatureValue(feature, key);
                    if (!values.has(raw)) values.set(raw, raw);
                });
                return [...values.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            };
            const applyState = () => {
                let visible = state.allFeatures.filter(({ feature }) => {
                    for (const [key, selected] of state.filters.entries()) {
                        if (!(selected instanceof Set) || selected.size === 0) continue;
                        if (!selected.has(getFeatureValue(feature, key))) return false;
                    }
                    return true;
                });

                if (state.sort.key && state.sort.dir !== 'default') {
                    const kind = inferColumnKind(state.sort.key);
                    visible = [...visible].sort((a, b) => {
                        const cmp = compareFeatures(a.feature, b.feature, state.sort.key, state.sort.dir, kind);
                        return cmp !== 0 ? cmp : (a.index - b.index);
                    });
                } else {
                    visible = [...visible].sort((a, b) => a.index - b.index);
                }

                state.filteredFeatures = visible;
                state.renderedCount = Math.min(renderBatchSize, state.filteredFeatures.length);
                renderVisibleRows();

                headers.forEach((th, idx) => {
                    const btn = th.querySelector('[data-table-filter-sort-btn]');
                    if (!btn) return;
                    const key = attrKeys[idx];
                    const filtered = state.filters.has(key) && (state.filters.get(key)?.size ?? 0) > 0;
                    const sorted = state.sort.key === key && state.sort.dir !== 'default';
                    btn.classList.toggle('election-th-btn--active', filtered || sorted);
                    if (sorted && state.sort.dir === 'asc') btn.innerHTML = '&#8593;';
                    else if (sorted && state.sort.dir === 'desc') btn.innerHTML = '&#8595;';
                    else btn.innerHTML = '&#8645;';
                });
            };
            const openMenuForColumn = (idx, anchorBtn) => {
                closeMenu();
                const key = attrKeys[idx];
                const kind = inferColumnKind(key);
                const options = getUniqueValues(key);
                const current = state.filters.get(key);
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
                state.activeMenu = menu;
                state.activeMenuBtn = anchorBtn;
                anchorBtn.classList.add('election-th-btn--open');

                const rect = anchorBtn.getBoundingClientRect();
                const menuWidth = 248;
                const margin = 8;
                const scrollX = window.scrollX || window.pageXOffset || 0;
                const scrollY = window.scrollY || window.pageYOffset || 0;
                const preferredLeft = scrollX + rect.right - menuWidth;
                const maxLeft = scrollX + window.innerWidth - menuWidth - margin;
                menu.style.left = `${Math.max(scrollX + margin, Math.min(preferredLeft, maxLeft))}px`;

                const menuHeight = menu.offsetHeight || 320;
                const belowTop = scrollY + rect.bottom + 4;
                const aboveTop = scrollY + rect.top - menuHeight - 4;
                const viewportBottom = scrollY + window.innerHeight - margin;
                const viewportTop = scrollY + margin;
                const fitsBelow = belowTop + menuHeight <= viewportBottom;
                const fitsAbove = aboveTop >= viewportTop;
                menu.style.top = `${(fitsBelow || !fitsAbove) ? belowTop : aboveTop}px`;

                const valuesHost = menu.querySelector('[data-role="values"]');
                const renderValues = (needle = '') => {
                    const q = needle.trim().toLowerCase();
                    valuesHost.innerHTML = '';
                    options
                        .filter((v) => !q || v.toLowerCase().includes(q))
                        .forEach((raw) => {
                            const item = document.createElement('label');
                            item.className = 'election-filter-menu__value';
                            item.innerHTML = `<input type="checkbox" ${selected.has(raw) ? 'checked' : ''}><span>${this.escapeHtml(raw || '(Blank)')}</span>`;
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
                        state.sort.key = key;
                        state.sort.dir = 'asc';
                        applyState();
                        closeMenu();
                    } else if (action === 'sort-desc') {
                        state.sort.key = key;
                        state.sort.dir = 'desc';
                        applyState();
                        closeMenu();
                    } else if (action === 'reset-sort') {
                        state.sort.key = null;
                        state.sort.dir = 'default';
                        applyState();
                        closeMenu();
                    } else if (action === 'select-all') {
                        options.forEach((v) => selected.add(v));
                        renderValues(search?.value || '');
                    } else if (action === 'deselect-all') {
                        selected.clear();
                        renderValues(search?.value || '');
                    } else if (action === 'clear-filter') {
                        state.filters.delete(key);
                        applyState();
                        closeMenu();
                    } else if (action === 'apply') {
                        if (selected.size === 0 || selected.size === options.length) state.filters.delete(key);
                        else state.filters.set(key, new Set(selected));
                        applyState();
                        closeMenu();
                    }
                });

                state.documentClickHandler = (event) => {
                    if (!state.activeMenu) return;
                    if (state.activeMenu.contains(event.target)) return;
                    if (state.activeMenuBtn && state.activeMenuBtn.contains(event.target)) return;
                    closeMenu();
                };
                document.addEventListener('click', state.documentClickHandler);
            };

            headers.forEach((th, idx) => {
                const label = th.innerHTML;
                th.innerHTML = '';
                const wrap = document.createElement('div');
                wrap.className = 'election-th-controls';
                const labelSpan = document.createElement('span');
                labelSpan.className = 'election-th-label';
                labelSpan.innerHTML = label;
                wrap.appendChild(labelSpan);

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
                    if (state.activeMenu && state.activeMenuBtn === menuBtn) closeMenu();
                    else openMenuForColumn(idx, menuBtn);
                });
                actions.appendChild(menuBtn);
                wrap.appendChild(actions);
                th.appendChild(wrap);
            });

            scrollContainer.addEventListener('scroll', () => {
                const scrollBottom = scrollContainer.scrollTop + scrollContainer.clientHeight;
                const threshold = scrollContainer.scrollHeight - 50;
                if (scrollBottom < threshold) return;
                if (state.renderedCount >= state.filteredFeatures.length) return;
                state.renderedCount = Math.min(state.renderedCount + renderBatchSize, state.filteredFeatures.length);
                renderVisibleRows();
            }, { passive: true });

            tbody.addEventListener('click', (event) => {
                const link = event.target.closest('.catalogue-detail__attr-link');
                if (link) {
                    event.preventDefault();
                    event.stopPropagation();
                    const detailId = link.dataset.featureDetailId;
                    if (detailId) this.showFeatureDetailInCatalogue(detailId);
                    return;
                }

                const row = event.target.closest('.catalogue-detail__attr-tr--interactive');
                if (!row) return;
                const featureIndex = Number(row.dataset.featureIndex);
                const featureName = row.dataset.featureName || '';
                const bbox = (row.dataset.featureBbox || '').split(',').map(Number).filter(Number.isFinite);
                const featureId = row.dataset.featureId || '';
                const feature = state.allFeatures.find((entry) => entry.index === featureIndex)?.feature;
                this.focusFeatureFromTable(
                    map,
                    feature,
                    Number.isFinite(featureIndex) ? featureIndex : featureId,
                    featureName,
                    bbox.length === 4 ? bbox : null
                );
            });

            applyState();

        } catch (err) {
            console.warn('[UIController] Failed to load attribute schema:', err);
            attrTableBody.innerHTML = `<div class="catalogue-detail__attr-error">Failed to load attributes</div>`;
        }
    }

    showCatalogueListView(addToHistory = false) {
        this.catalogueView = 'list';
        this._catalogueBookView = null;

        const nav = document.getElementById('catalogueNav');
        const listView = document.getElementById('catalogueListView');
        const detailView = document.getElementById('catalogueDetailView');

        if (!nav || !listView || !detailView) return;

        if (addToHistory) {
            const current = this.catalogueHistory[this.catalogueHistoryIndex];
            if (!current || current.type !== 'list') {
                this._pushCatalogueHistoryEntry({ type: 'list' });
            }
        }

        // Show list, hide detail
        listView.classList.remove('hidden');
        detailView.classList.add('hidden');
        this.renderFlatView(this._lastMapListOptions || {});
        this.updateCatalogueNavButtons();
    }

    catalogueGoBack() {
        // Special case: when viewing the Tables tab, "back" returns to the
        // Catalogue tab regardless of the catalogue history stack.
        const tablesContent = document.querySelector('.pane__content[data-tab-content="tables"]');
        if (tablesContent && !tablesContent.classList.contains('pane-tab-content--hidden')) {
            this.showTab('catalogue');
            this.updateCatalogueNavButtons();
            return;
        }
        if (this.catalogueHistoryIndex > 0) {
            this.catalogueHistoryIndex--;
            const entry = this.catalogueHistory[this.catalogueHistoryIndex];
            if (entry.type === 'tab') {
                this.showTab(entry.tabId || 'catalogue');
            } else if (entry.type === 'list') {
                this.showCatalogueListView(false);
            } else if (entry.type === 'book-viewer') {
                this.openCatalogueBookViewer(entry.bookId, entry.format || 'pdf', false);
            } else if (entry.type === 'detail') {
                this.showCatalogueDetailView(entry.mapId, false);
            } else if (entry.type === 'feature-detail') {
                this.showFeatureDetailInCatalogue(entry.detailId, false);
            } else if (entry.type === 'election-entity-detail') {
                this.showElectionEntityDetailInCatalogue(entry.detailId, false);
            }
        }
        this.updateCatalogueNavButtons();
    }

    catalogueGoForward() {
        if (this.catalogueHistoryIndex < this.catalogueHistory.length - 1) {
            this.catalogueHistoryIndex++;
            const entry = this.catalogueHistory[this.catalogueHistoryIndex];
            if (entry.type === 'tab') {
                this.showTab(entry.tabId || 'catalogue');
            } else if (entry.type === 'list') {
                this.showCatalogueListView(false);
            } else if (entry.type === 'book-viewer') {
                this.openCatalogueBookViewer(entry.bookId, entry.format || 'pdf', false);
            } else if (entry.type === 'detail') {
                this.showCatalogueDetailView(entry.mapId, false);
            } else if (entry.type === 'feature-detail') {
                this.showFeatureDetailInCatalogue(entry.detailId, false);
            } else if (entry.type === 'election-entity-detail') {
                this.showElectionEntityDetailInCatalogue(entry.detailId, false);
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

        // When the Tables tab is active, the back button always returns to the
        // Catalogue tab — force-enable it regardless of catalogue history depth.
        const tablesContent = document.querySelector('.pane__content[data-tab-content="tables"]');
        const onTables = tablesContent && !tablesContent.classList.contains('pane-tab-content--hidden');

        if (backBtn) {
            backBtn.disabled = onTables ? false : this.catalogueHistoryIndex <= 0;
        }
        if (forwardBtn) {
            forwardBtn.disabled = this.catalogueHistoryIndex >= this.catalogueHistory.length - 1;
        }
        this.updateCatalogueHomeButton();
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

        // Delegated handler for in-content tab links (e.g. the Tables top-link
        // in the catalogue TOC, which is re-rendered dynamically).
        document.addEventListener('click', (e) => {
            const trigger = e.target.closest('[data-tab-target]');
            if (!trigger) return;
            e.preventDefault();
            this.showTab(trigger.dataset.tabTarget);
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

        // Move the catalogue sticky shell (search + nav buttons) into the active
        // tab when switching to Tables, so it stays visible there. Move it back
        // to the catalogue tab for any other tab.
        this.moveCatalogueShellForTab(tabId);

        // Refresh nav button enabled state — back button is force-enabled on Tables.
        this.updateCatalogueNavButtons();
        this.updateCatalogueHomeButton();

        // Initialize Explore tab on first view
        if (tabId === 'explore') {
            this.initializeExplore();
        }

        // Initialize Tables tab on first view
        if (tabId === 'tables') {
            this.initializeTables();
        }
    }

    moveCatalogueShellForTab(tabId) {
        const shell = document.querySelector('.catalogue-sticky-shell');
        if (!shell) return;
        if (tabId === 'tables') {
            const tablesContent = document.querySelector('.pane__content[data-tab-content="tables"]');
            if (tablesContent && shell.parentElement !== tablesContent) {
                tablesContent.insertBefore(shell, tablesContent.firstChild);
            }
        } else {
            const catalogueContent = document.querySelector('.pane__content[data-tab-content="catalogue"]');
            if (catalogueContent && shell.parentElement !== catalogueContent) {
                // Restore to its original position at the top of the catalogue tab.
                catalogueContent.insertBefore(shell, catalogueContent.firstChild);
            }
        }
    }

    setupCatalogueReturnTop() {
        const pane = document.querySelector('.pane__content[data-tab-content="catalogue"]');
        if (!pane) return;
        this._cataloguePane = pane;
        pane.addEventListener('scroll', () => this.updateCatalogueHomeButton(), { passive: true });
        window.addEventListener('resize', () => this.updateCatalogueHomeButton());
        this.updateCatalogueHomeButton();
    }

    isOnMainCataloguePage() {
        const listView = document.getElementById('catalogueListView');
        const detailView = document.getElementById('catalogueDetailView');
        return !!listView
            && !!detailView
            && !listView.classList.contains('hidden')
            && detailView.classList.contains('hidden')
            && !this._catalogueBookView;
    }

    _applyCatalogueBookViewerChrome(isActive) {
        const statsEl = document.getElementById('filterStats');
        const categoryPillsContainer = document.querySelector('.category-pills-container');
        const providerPillsContainer = document.querySelector('.provider-pills-container');
        if (statsEl) statsEl.classList.toggle('hidden', !!isActive);
        if (categoryPillsContainer) categoryPillsContainer.classList.toggle('hidden', true);
        if (providerPillsContainer) providerPillsContainer.classList.toggle('hidden', true);
    }

    _buildBookCardHtml(book) {
        const category = (this.booksData?.categories || []).find(cat => cat.id === book.category) || null;
        const fallbackLabel = this._getBookThumbnailFallbackLabel(book);
        const pdfViewButton = book.file
            ? `<button type="button" class="btn btn--sm btn--primary book-card__btn" data-book-view="${this.escapeHtml(book.id)}" data-book-format="pdf">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                    View
                </button>`
            : '';
        const markdownViewButton = book.markdownFile
            ? `<button type="button" class="btn btn--sm btn--outline book-card__btn" data-book-view="${this.escapeHtml(book.id)}" data-book-format="markdown">Markdown</button>`
            : '';
        return `
            <div class="thumb-zone">
                <span class="book-card__thumb">
                    <img class="book-card__thumbnail" src="assets/thumbnails/book-${book.id}.png" alt="" loading="lazy" onerror="this.style.display='none'; var fb=this.parentElement && this.parentElement.querySelector('.book-card__thumbnail-fallback'); if(fb){fb.hidden=false;}">
                    <span class="book-card__thumbnail-fallback${book.category ? ` book-card__thumbnail-fallback--${this.escapeHtml(book.category)}` : ''}" hidden>
                        <span class="book-card__thumbnail-icon">${this.escapeHtml(category?.icon || '[book]')}</span>
                        <span class="book-card__thumbnail-label">${this.escapeHtml(fallbackLabel)}</span>
                    </span>
                </span>
            </div>
            <div class="book-card__content">
                <h4 class="book-card__title">${this.escapeHtml(book.title)}</h4>
                <p class="book-card__author">${this.escapeHtml((book.authors || []).join(', '))}</p>
                <p class="book-card__date">${this.escapeHtml(book.dateDisplay || book.date || '')}</p>
                <div class="book-card__actions">
                    ${pdfViewButton}
                    ${markdownViewButton}
                    ${book.archiveUrl ? `<a href="${book.archiveUrl}" target="_blank" rel="noopener" class="btn btn--sm btn--outline book-card__btn">Archive.org</a>` : ''}
                </div>
                ${book.transcriptionNotice ? `<p class="book-card__notice">${this.escapeHtml(book.transcriptionNotice)}</p>` : ''}
            </div>
        `;
    }

    _bookMatchesSearch(book, category, query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return true;
        const haystacks = [
            book?.title || '',
            (book?.authors || []).join(' '),
            (book?.keywords || []).join(' '),
            category?.name || '',
            category?.description || '',
            'books',
            'book',
            'documents',
            'document'
        ];
        return haystacks.some(value => String(value || '').toLowerCase().includes(q));
    }

    _getBookThumbnailFallbackLabel(book) {
        const id = String(book?.id || '');
        if (id.startsWith('ni-acts-')) return 'Acts';
        if (id.startsWith('ni-sro-')) return 'SRO';
        return 'Book';
    }

    async _getBookMarkdownText(book) {
        if (!book?.markdownFile) return '';
        if (this._bookMarkdownCache.has(book.markdownFile)) {
            return this._bookMarkdownCache.get(book.markdownFile);
        }
        const response = await fetch(book.markdownFile);
        if (!response.ok) throw new Error(`Failed to load Markdown (${response.status})`);
        const text = await response.text();
        this._bookMarkdownCache.set(book.markdownFile, text);
        return text;
    }

    _renderCatalogueBookViewer(book, format, markdownText = '') {
        const title = this.escapeHtml(book.title || '');
        const authorLine = this.escapeHtml((book.authors || []).join(', '));
        const dateLine = this.escapeHtml(book.dateDisplay || book.date || '');
        const safeNotice = this.escapeHtml(book.transcriptionNotice || 'Markdown version may contain inaccuracies and errors.');
        const isMarkdown = format === 'markdown';
        const pdfDisabled = !book.file ? ' disabled' : '';
        const mdDisabled = !book.markdownFile ? ' disabled' : '';
        const viewportHtml = isMarkdown
            ? `<div class="catalogue-book-viewer__markdown-viewport"><pre class="catalogue-book-viewer__markdown-text">${this.escapeHtml(markdownText || '')}</pre></div>`
            : `<iframe class="catalogue-book-viewer__frame" src="${this.escapeHtml(book.file || '')}" title="${title} PDF viewer"></iframe>`;

        return `
            <div class="catalogue-book-viewer">
                <div class="catalogue-book-viewer__header">
                    <div class="catalogue-book-viewer__meta">
                        <button type="button" class="btn btn--sm btn--outline catalogue-book-viewer__back" data-book-view-close="1">Back</button>
                        <div class="catalogue-book-viewer__titleblock">
                            <h3 class="catalogue-book-viewer__title">${title}</h3>
                            ${authorLine ? `<div class="catalogue-book-viewer__subtitle">${authorLine}</div>` : ''}
                            ${dateLine ? `<div class="catalogue-book-viewer__subtitle">${dateLine}</div>` : ''}
                        </div>
                    </div>
                    <div class="catalogue-book-viewer__toolbar">
                        <div class="catalogue-book-viewer__format-toggle" role="tablist" aria-label="Book format">
                            <button type="button" class="btn btn--sm ${!isMarkdown ? 'btn--primary' : 'btn--outline'}" data-book-view-format="pdf"${pdfDisabled}>PDF</button>
                            <button type="button" class="btn btn--sm ${isMarkdown ? 'btn--primary' : 'btn--outline'}" data-book-view-format="markdown"${mdDisabled}>Markdown</button>
                        </div>
                        <div class="catalogue-book-viewer__actions">
                            ${book.file ? `<a href="${book.file}" target="_blank" rel="noopener" class="btn btn--sm btn--outline">Open PDF</a>` : ''}
                            ${book.file ? `<a href="${book.file}" download class="btn btn--sm btn--outline">Download PDF</a>` : ''}
                            ${book.markdownFile ? `<a href="${book.markdownFile}" target="_blank" rel="noopener" class="btn btn--sm btn--outline">Open Markdown</a>` : ''}
                            ${book.markdownFile ? `<a href="${book.markdownFile}" download class="btn btn--sm btn--outline">Download Markdown</a>` : ''}
                            ${book.archiveUrl ? `<a href="${book.archiveUrl}" target="_blank" rel="noopener" class="btn btn--sm btn--outline">Archive.org</a>` : ''}
                        </div>
                    </div>
                    ${book.markdownFile ? `<p class="catalogue-book-viewer__notice">${safeNotice}</p>` : ''}
                </div>
                <div class="catalogue-book-viewer__viewport">
                    ${viewportHtml}
                </div>
            </div>
        `;
    }

    async openCatalogueBookViewer(bookId, format = 'pdf', addToHistory = true) {
        const book = dataService.getBookById(bookId);
        if (!book) return;
        const targetFormat = (format === 'markdown' && book.markdownFile) ? 'markdown' : 'pdf';
        this._catalogueBookView = { bookId, format: targetFormat };
        this.catalogueView = 'list';

        const listView = document.getElementById('catalogueListView');
        const detailView = document.getElementById('catalogueDetailView');
        if (listView) listView.classList.remove('hidden');
        if (detailView) detailView.classList.add('hidden');

        if (addToHistory) {
            const current = this.catalogueHistory[this.catalogueHistoryIndex];
            if (!current || current.type !== 'book-viewer' || current.bookId !== bookId || current.format !== targetFormat) {
                this._pushCatalogueHistoryEntry({ type: 'book-viewer', bookId, format: targetFormat });
            }
        }

        await this.renderFlatView(this._lastMapListOptions || {});
        this.updateCatalogueNavButtons();
    }

    scrollCatalogueToTop() {
        const pane = this._cataloguePane || document.querySelector('.pane__content[data-tab-content="catalogue"]');
        if (!pane) return;
        pane.scrollTo({ top: 0, behavior: 'smooth' });
    }

    updateCatalogueHomeButton() {
        const homeBtn = document.getElementById('catalogueHome');
        if (!homeBtn) return;
        const onMain = this.isOnMainCataloguePage();
        homeBtn.classList.toggle('catalogue-home--top', onMain);
        homeBtn.title = onMain ? 'Return to top' : 'Back to main catalogue';
        homeBtn.setAttribute('aria-label', onMain ? 'Return to top' : 'Back to main catalogue');
        homeBtn.innerHTML = onMain
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 17 12 12 17 17"></polyline><polyline points="7 11 12 6 17 11"></polyline></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>`;
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
            // On desktop, only use the explicit desktop preference (don't fall back to pref.last
            // which might be a mobile-only state like info-full or map-full)
            const saved = this.isMobile ? (pref[key] || pref.last) : pref[key];
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
        this._lastMapListOptions = options || {};
        const container = document.getElementById('mapList');
        // Flat-only runtime: always re-render flat catalogue and update stats.
        this.invalidateFlatView();
        if (this._catalogueViewMode === 'flat') {
            this.renderFlatView(this._lastMapListOptions).then(() => {
                this.restoreExpandedVariants();
            });
        }
        this.updateFilterStats(maps.length, options.totalMaps || maps.length);

        // Grouped view has been removed from runtime. Keep legacy code inert.
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
        this.invalidateFlatView();

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
            const bookCategories = this.booksData.categories || [];
            const bookCategoryById = new Map(bookCategories.map(cat => [cat.id, cat]));
            const shouldShowBooks = !this.searchQuery || this.booksData.books.some(book =>
                this._bookMatchesSearch(book, bookCategoryById.get(book.category || 'other'), this.searchQuery)
            );

            if (shouldShowBooks && (this.currentCategory === undefined || this.currentCategory === 'all' || !this.currentCategory)) {
                // Create books group header
                const booksGroupHeader = document.createElement('div');
                booksGroupHeader.className = 'category-group-header';
                booksGroupHeader.innerHTML = `<h3 class="category-group-title">Books & Documents</h3>`;
                container.appendChild(booksGroupHeader);

                // Group books by category
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
                        filteredBooks = catBooks.filter(book => this._bookMatchesSearch(book, cat, this.searchQuery));
                        if (filteredBooks.length === 0) return;
                    }

                    // Create category section
                    const catSection = document.createElement('div');
                    catSection.className = 'category-section';
                    catSection.innerHTML = `
                        <div class="category-section__header">
                            <span class="category-section__icon">${cat.icon || '[book]'}</span>
                            <h3 class="category-section__title">${this.escapeHtml(cat.name)}</h3>
                        </div>
                    `;

                    // Render book cards
                    filteredBooks.forEach(book => {
                        const card = document.createElement('div');
                        card.className = 'map-card book-card';
                        card.innerHTML = this._buildBookCardHtml(book);
                        catSection.appendChild(card);
                    });

                    container.appendChild(catSection);
                });
            }
        }

        container.querySelectorAll('[data-book-view]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.openCatalogueBookViewer(btn.dataset.bookView, btn.dataset.bookFormat || 'pdf');
            });
        });

        this.updateFilterStats(maps.length, options.totalMaps || maps.length);
    }

    updateFilterStats(shown, total) {
        const text = shown === total ? `${total} maps` : `${shown} of ${total} maps`;
        // Cache so renderFlatView (which runs async after this call) can re-apply
        // the value once it has finished building the TOC and the
        // #catalogueTocStats element exists in the DOM.
        this._lastFilterStatsText = text;
        const statsEl = document.getElementById('filterStats');
        if (statsEl) statsEl.textContent = text;
        // Also reflect into the TOC top-row stats slot (always visible at the top
        // of the catalogue alongside the section toplinks).
        const tocStatsEl = document.getElementById('catalogueTocStats');
        if (tocStatsEl) tocStatsEl.textContent = text;
    }

    // ============================================
    // Flat Catalogue View
    // ============================================

    setupCatalogueViewToggle() {
        const toggleContainer = document.getElementById('catalogueViewToggle');
        if (!toggleContainer) return;

        toggleContainer.querySelectorAll('.catalogue-view-toggle__btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                this.setCatalogueViewMode(view);
            });
        });

        // Grouped view remains in code but is hidden/inaccessible in UI.
        toggleContainer.classList.add('hidden');
        this.setCatalogueViewMode('flat');
    }

    setCatalogueViewMode(mode) {
        const flatView = document.getElementById('catalogueFlatView');
        const toggleContainer = document.getElementById('catalogueViewToggle');
        const categoryPillsContainer = document.querySelector('.category-pills-container');
        const providerPillsContainer = document.querySelector('.provider-pills-container');
        if (!flatView || !toggleContainer) return;

        const forcedMode = 'flat';
        const isFlat = true;

        // Update toggle buttons
        toggleContainer.querySelectorAll('.catalogue-view-toggle__btn').forEach(btn => {
            btn.classList.toggle('catalogue-view-toggle__btn--active', btn.dataset.view === forcedMode);
        });

        // Flat-only catalogue view.
        if (isFlat) {
            flatView.classList.remove('hidden');
            if (!flatView.dataset.rendered) this.renderFlatView(this._lastMapListOptions || {});
        }

        // Flat mode: hide top category/provider filters as requested.
        if (categoryPillsContainer) {
            categoryPillsContainer.classList.toggle('hidden', isFlat);
        }
        if (providerPillsContainer) {
            providerPillsContainer.classList.toggle('hidden', isFlat);
        }

        localStorage.setItem('ni-boundaries.catalogue-view', forcedMode);
        this._catalogueViewMode = forcedMode;
        this.updateCatalogueHomeButton();
    }

    async renderFlatView(options = {}) {
        const container = document.getElementById('catalogueFlatView');
        if (!container) return;

        if (this._catalogueBookView) {
            const book = dataService.getBookById(this._catalogueBookView.bookId);
            if (!book) {
                this._catalogueBookView = null;
                this._applyCatalogueBookViewerChrome(false);
            } else {
                let markdownText = '';
                if (this._catalogueBookView.format === 'markdown') {
                    try {
                        markdownText = await this._getBookMarkdownText(book);
                    } catch (err) {
                        console.error('[UIController] Failed to load book markdown:', err);
                        markdownText = 'Failed to load Markdown file.';
                    }
                }

                this._applyCatalogueBookViewerChrome(true);
                container.classList.add('catalogue-flat-view--book-viewer');
                container.innerHTML = this._renderCatalogueBookViewer(book, this._catalogueBookView.format, markdownText);
                container.dataset.rendered = 'true';

                container.querySelector('[data-book-view-close]')?.addEventListener('click', () => {
                    this.showCatalogueListView(true);
                });
                container.querySelectorAll('[data-book-view-format]').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        if (btn.disabled) return;
                        this.openCatalogueBookViewer(book.id, btn.dataset.bookViewFormat || 'pdf');
                    });
                });

                this.updateCatalogueHomeButton();
                return;
            }
        }

        this._applyCatalogueBookViewerChrome(false);
        container.classList.remove('catalogue-flat-view--book-viewer');

        const allClasses = dataService.getAllClasses() || [];
        const classById = new Map(allClasses.map(cls => [cls.id, cls]));
        const mapById = new Map(((dataService.maps?.maps) || []).map(map => [map.id, map]));

        // Flat mode map C1 cards, in the exact order requested.
        const c1Cards = [
            { id: 'flat-townlands', name: 'Townlands', years: '', extent: 'Ireland', mapIds: ['all-ireland-townlands', 'ni-townlands', 'roi-townlands'] },
            { id: 'flat-settlements', name: 'Settlements', years: '2005-2015', extent: 'Northern Ireland', classIds: ['ni-settlements'] },
            { id: 'flat-settlements-roi', name: 'Settlements', years: '2011-2015', extent: 'Republic of Ireland', classIds: ['roi-settlements'] },
            { id: 'flat-roi-legal-towns', name: 'Legal Towns and Cities (Republic of Ireland)', years: '2011', extent: 'Republic of Ireland', classIds: ['roi-legal-towns'] },
            { id: 'flat-place-names', name: 'Place Names (Northern Ireland)', years: '', extent: 'Northern Ireland', mapIds: ['place-names-gazetteer'] },
            { id: 'flat-civil-parishes', name: 'Civil Parishes', years: '', extent: 'Ireland', classIds: ['ni-civil-parishes', 'ireland-civil-parishes'] },
            { id: 'flat-baronies', name: 'Baronies', years: '', extent: 'Northern Ireland', mapIds: ['baronies'] },
            { id: 'flat-counties-1915', name: 'Counties (1915)', years: '1915', extent: 'Ireland', mapIds: ['counties-1915', 'counties-ireland', 'roi-counties-2011'] },
            { id: 'flat-provinces', name: 'Provinces', years: '', extent: 'Ireland', mapIds: ['provinces'] },
            { id: 'flat-wards', name: 'Wards (Northern Ireland) (1973-)', years: '1972-2012', extent: 'Northern Ireland', classIds: ['ni-wards'] },
            { id: 'flat-roi-lea', name: 'Local Electoral Areas (Republic of Ireland)', years: '2008', extent: 'Republic of Ireland', classIds: ['roi-lea'] },
            { id: 'flat-deas', name: 'District Electoral Areas (1973-)', years: '1972-2012', extent: 'Northern Ireland', classIds: ['ni-deas'] },
            { id: 'flat-deds', name: 'District Electoral Divisions (Northern Ireland) (1920-1973)', years: '1921-1969', extent: 'Northern Ireland', classIds: ['ni-deds'] },
            { id: 'flat-county-eds', name: 'County Electoral Divisions (Northern Ireland)', years: '1921-1969', extent: 'Northern Ireland', classIds: ['ni-county-eds'] },
            { id: 'flat-eds-1911', name: 'District Electoral Divisions (Ireland) (1911)', years: '1911', extent: 'Ireland', mapIds: ['eds-1911'] },
            { id: 'flat-roi-deds', name: 'Electoral Divisions', years: '1986-2019', extent: 'Republic of Ireland', mapIds: ['eds-1986', 'eds-1994', 'eds-1997', 'eds-2019'] },
            { id: 'flat-lgds', name: 'Local Government Districts (Northern Ireland) (1973-)', years: '1972-2012', extent: 'Northern Ireland', classIds: ['ni-lgds'] },
            { id: 'flat-admin-areas', name: 'Administrative Areas (Northern Ireland) (1920-1973)', years: '1921-1969', extent: 'Northern Ireland', classIds: ['ni-admin-areas'] },
            { id: 'flat-roi-small-census', name: 'Small Census Units (Republic of Ireland)', years: '2011', extent: 'Republic of Ireland', classIds: ['roi-small-census'] },
            { id: 'flat-roi-garda-areas', name: 'An Garda Síochána Areas (Republic of Ireland)', years: '2011', extent: 'Republic of Ireland', classIds: ['roi-garda-areas'] },
            { id: 'flat-roi-gaeltacht', name: 'Gaeltacht Areas (Republic of Ireland)', years: '2011', extent: 'Republic of Ireland', classIds: ['roi-gaeltacht'] },
            { id: 'flat-roi-local-authorities', name: 'Local Authorities (Republic of Ireland)', years: '2014-2024', extent: 'Republic of Ireland', classIds: ['roi-local-authorities'] },
            { id: 'flat-admin-counties', name: 'Administrative Counties (Northern Ireland) (1915)', years: '1915', extent: 'Northern Ireland', classIds: ['ni-admin-counties'] },
            { id: 'flat-dublin-electoral-counties', name: 'Dublin Electoral Counties (1985)', years: '1985', extent: 'Ireland', classIds: ['roi-dublin-electoral-counties'] },
            { id: 'flat-assembly-areas', name: 'Assembly Areas (1998-)', years: '1995-2023', extent: 'Northern Ireland', classIds: ['ni-assembly'] },
            { id: 'flat-forum', name: 'Forum Constituencies (1996)', years: '1995', extent: 'Northern Ireland', classIds: ['ni-forum'] },
            { id: 'flat-assembly-1982', name: 'Assembly Constituencies (1982)', years: '1982', extent: 'Northern Ireland', classIds: ['ni-assembly-1982'] },
            { id: 'flat-con-conv', name: 'Constitutional Convention Constituencies (1975)', years: '1975', extent: 'Northern Ireland', classIds: ['ni-constitutional-convention'] },
            { id: 'flat-assembly-1973', name: 'Assembly Constituencies (1973)', years: '1970', extent: 'Northern Ireland', classIds: ['ni-assembly-1973'] },
            { id: 'flat-ni-parliament', name: 'Parliament of Northern Ireland Constituencies (1920-1973)', years: '1920-1969', extent: 'Northern Ireland', classIds: ['ni-parliament'] },
            { id: 'flat-cso-eds', name: 'CSO Electoral Divisions (Republic of Ireland) (2006-)', years: '2006-2023', extent: 'Republic of Ireland', mapIds: ['eds-2006', 'eds-2022', 'eds-2023'] },
            { id: 'flat-dail', name: 'Dáil Eireann Constituencies (1923-)', years: '1923-2023', extent: 'Republic of Ireland', classIds: ['roi-dail'] },
            { id: 'flat-uk-parliament', name: 'UK Parliamentary Constituencies (1884-)', years: '1884-2023', extent: 'Ireland / Northern Ireland', classIds: ['pre-1921-pcs', 'ni-pcs'] },
            { id: 'flat-eu-parliament', name: 'European Parliament Constituencies (1979-)', years: '1979-2024', extent: 'Ireland', classIds: ['eu-parliament'] },
            { id: 'flat-referendum', name: 'Referendum Counting Areas (1975-)', years: '1973-2016', extent: 'Northern Ireland', classIds: ['ni-referendum-areas'] },
            { id: 'flat-polities', name: 'Polities', years: '', extent: '', mapIds: ['ni-1921', 'roi-1938'] },
            { id: 'flat-elb', name: 'Education and Library Boards (Northern Ireland)', years: '1984-1993', extent: 'Northern Ireland', classIds: ['ni-elb'] },
            { id: 'flat-hsct', name: 'Health and Social Care Trusts (Northern Ireland) (2007)', years: '2007', extent: 'Northern Ireland', mapIds: ['hsct-2007'] },
            { id: 'flat-small-census', name: 'Small Census Units (Northern Ireland) (2001-present)', years: '2001-2021', extent: 'Northern Ireland', classIds: ['ni-small-census'] },
            { id: 'flat-super-census', name: 'Super Census Units (Northern Ireland) (2001-present)', years: '2001-2021', extent: 'Northern Ireland', classIds: ['ni-super-census'] },
            { id: 'flat-ttwa', name: 'Travel To Work Areas (Northern Ireland) (2007-present)', years: '2007-2011', extent: 'Northern Ireland', classIds: ['ni-ttwa'] },
            { id: 'flat-nra', name: 'Neighbourhood Renewal Areas (Northern Ireland)', years: '', extent: 'Northern Ireland', mapIds: ['nra'] },
            { id: 'flat-nuts2', name: 'NUTS 2 Regions (Ireland)', years: '2011', extent: 'Ireland', mapIds: ['nuts-2-all-ireland', 'nuts-2-roi'] },
            { id: 'flat-nuts3', name: 'NUTS 3 Regions (2003) (Northern Ireland)', years: '2003', extent: 'Northern Ireland', mapIds: ['nuts-3'] },
            { id: 'flat-census-grid', name: 'Census Grid (2021) (Northern Ireland)', years: '2021', extent: 'Northern Ireland', mapIds: ['census-grid-2021'] },
            { id: 'flat-seas', name: 'Seas (2023) (These islands)', years: '2023', extent: 'These islands', mapIds: ['britain-ireland-seas'] },
            { id: 'flat-rivers', name: 'Rivers (2016) (Northern Ireland)', years: '2016', extent: 'Northern Ireland', mapIds: ['rivers-2016'] },
            { id: 'flat-islands', name: 'Islands', years: '', extent: '', mapIds: ['ireland-island'] },
            { id: 'flat-rbd', name: 'River Basin Districts (2016) (Northern Ireland)', years: '2016', extent: 'Northern Ireland', mapIds: ['river-basin-districts'] },
            { id: 'flat-river-basins', name: 'River Basins (2016) (Northern Ireland)', years: '2016', extent: 'Northern Ireland', mapIds: ['river-basins'] },
            { id: 'flat-peacelines', name: 'Peacelines (Northern Ireland)', years: '', extent: 'Northern Ireland', mapIds: ['peacelines'] },
            {
                id: 'flat-historic-sites',
                name: 'Historic Sites',
                years: '',
                extent: 'Ireland',
                mapIds: [
                    'historic-bullaun-stones',
                    'historic-crannog',
                    'historic-ringfort-cashel',
                    'historic-ringfort-rath',
                    'historic-ringfort-unclassified',
                    'historic-rock-scribing',
                    'historic-standing-stones',
                    'historic-wedge-tomb'
                ]
            },
            {
                id: 'flat-catholic-parishes',
                name: 'Catholic Parishes',
                years: '2011',
                extent: 'Dublin',
                mapIds: ['catholic-dublin-parishes']
            },
            {
                id: 'flat-catholic-dioceses',
                name: 'Catholic Dioceses',
                years: '',
                extent: 'Ireland',
                mapIds: ['catholic-dioceses']
            },
            { id: 'flat-railways', name: 'Railways', years: '', extent: 'Northern Ireland', mapIds: ['railways-network'] },
            { id: 'flat-transport-lines', name: 'Transport Lines (Roads and Railways)', years: '', extent: 'Northern Ireland', mapIds: ['transport-lines-road-rail'] },
            {
                id: 'flat-copernicus-dem',
                name: 'Copernicus 30m DEM (Ireland)',
                years: '',
                extent: 'Ireland',
                mapIds: ['copernicus-dem-30m-ireland']
            },
            {
                id: 'flat-secondary',
                name: 'Secondary maps',
                years: '',
                extent: '',
                mapIds: [
                    'highlands-above-199m',
                    'highlands-without-settlements',
                    'west-bann-sperrins',
                    'east-west-bann',
                    'uninhabited-highlands',
                    'major-river-basins'
                ]
            }
        ];

        const decadeDefs = [
            { id: 'flat-elections-2020s', name: '2020s', from: 2020, to: 2029 },
            { id: 'flat-elections-2010s', name: '2010s', from: 2010, to: 2019 },
            { id: 'flat-elections-2000s', name: '2000s', from: 2000, to: 2009 },
            { id: 'flat-elections-1990s', name: '1990s', from: 1990, to: 1999 },
            { id: 'flat-elections-1980s', name: '1980s', from: 1980, to: 1989 },
            { id: 'flat-elections-1970s', name: '1970s', from: 1970, to: 1979 }
        ];

        let electionCatalogueCards = [];
        try {
            electionCatalogueCards = this.onBuildElectionCatalogueCards ? await this.onBuildElectionCatalogueCards() : [];
        } catch (err) {
            console.error('[UI] Failed to build flat-view election cards:', err);
            electionCatalogueCards = [];
        }

        const getElectionAppearance = (body, date, bodyGroup = null) => {
            const year = parseInt(String(date).slice(0, 4), 10) || 0;
            let thumb = 'pc-2008';
            if (bodyGroup === 'local-government') {
                thumb = 'deas-2012';
            } else if (body === 'House of Commons of the United Kingdom') {
                thumb = year >= 2024 ? 'pc-2023' : year >= 2005 ? 'pc-2008' : year >= 1995 ? 'pc-1995' : year >= 1983 ? 'pc-1982' : 'pc-1970';
            } else if (body === 'Northern Ireland Assembly') {
                thumb = year >= 2007 ? 'pc-2008' : year >= 1998 ? 'pc-1995' : 'pc-1970';
            } else if (body === 'Northern Ireland Constitutional Convention') {
                thumb = 'pc-1970';
            } else if (body === 'Northern Ireland Forum for Political Dialogue') {
                thumb = 'pc-1995';
            } else if (body === 'European Parliament') {
                if (year >= 2024) thumb = 'mep-2024';
                else if (year >= 2019) thumb = 'mep-2019';
                else if (year >= 2014) thumb = 'mep-2014';
                else if (year >= 2009) thumb = 'mep-2009';
                else if (year >= 2004) thumb = 'mep-2004';
                else thumb = 'mep-1979';
            }

            const colorMap = {
                'House of Commons of the United Kingdom': '#1e3a8a',
                'Northern Ireland Assembly': '#2563eb',
                'Northern Ireland Constitutional Convention': '#7c3aed',
                'Northern Ireland Forum for Political Dialogue': '#0f766e',
                'European Parliament': '#0ea5e9',
                'local-government': '#b45309'
            };

            return {
                thumb,
                color: colorMap[bodyGroup || body] || '#4b5563'
            };
        };

        const decadeElectionCards = decadeDefs.map(def => {
            const entries = electionCatalogueCards
                .filter(c => {
                    const year = parseInt(String(c.date).slice(0, 4), 10);
                    return Number.isFinite(year) && year >= def.from && year <= def.to;
                })
                .sort((a, b) => String(b.date).localeCompare(String(a.date)));

            return {
                id: def.id,
                name: def.name,
                years: `${def.from}-${def.to}`,
                extent: 'Northern Ireland',
                electionEntries: entries
            };
        });

        const stripBracketParts = (name) => String(name || '').replace(/\s*\([^)]*\)/g, '').trim();
        const collectCardMaps = (def) => {
            const mapEntries = [];
            const seenMapIds = new Set();
            const excludeIds = new Set(def.id === 'flat-settlements' ? ['settlements-2015-craigavon'] : []);

            (def.classIds || []).forEach(classId => {
                const cls = classById.get(classId);
                if (!cls) return;
                (cls.maps || []).forEach(mapId => {
                    if (seenMapIds.has(mapId)) return;
                    if (excludeIds.has(mapId)) return;
                    const map = mapById.get(mapId) || dataService.getMapById(mapId);
                    if (!map) return;
                    seenMapIds.add(mapId);
                    mapEntries.push({ map, classId: def.id });
                });
            });

            (def.mapIds || []).forEach(mapId => {
                if (seenMapIds.has(mapId)) return;
                if (excludeIds.has(mapId)) return;
                const map = mapById.get(mapId) || dataService.getMapById(mapId);
                if (!map) return;
                seenMapIds.add(mapId);
                mapEntries.push({ map, classId: def.id });
            });

            mapEntries.sort((a, b) => (this.parseDateToTimestamp(b.map.date) || 0) - (this.parseDateToTimestamp(a.map.date) || 0));
            return mapEntries;
        };

        // Build TOC HTML (no title, no column labels), with columns for name/years/extent.
        let tocHtml = `
            <div class="catalogue-flat__toc">
                <div class="catalogue-flat__toc-toplinks">
                    <span class="catalogue-flat__toc-toplinks-left">
                        <a href="#flat-section-elections" class="catalogue-flat__toc-toplink">Elections</a>
                        <a href="#flat-section-maps" class="catalogue-flat__toc-toplink">Maps</a>
                        <a href="#flat-section-books" class="catalogue-flat__toc-toplink">Books</a>
                        <button type="button" class="catalogue-flat__toc-toplink catalogue-flat__toc-toplink--tab" data-tab-target="tables">Tables</button>
                    </span>
                    <span class="catalogue-flat__toc-stats" id="catalogueTocStats" aria-hidden="true"></span>
                </div>
                <table class="catalogue-flat__toc-table">
                    <tbody>`;

        // Elections heading with inline "Northern Ireland" subtitle, plus a
        // horizontal row of decade buttons in place of the previous one-row-per-decade list.
        const decadeButtonsHtml = decadeElectionCards.map(def => {
            return `<a href="#flat-card-${def.id}" class="catalogue-flat__toc-decade-btn">${this.escapeHtml(def.name)}</a>`;
        }).join('');
        tocHtml += `
                <tr class="catalogue-flat__toc-heading-row">
                    <td colspan="3">
                        <span class="catalogue-flat__toc-heading">Elections</span>
                        <span class="catalogue-flat__toc-heading-sub">Northern Ireland</span>
                    </td>
                </tr>
                <tr class="catalogue-flat__toc-decade-row">
                    <td colspan="3">
                        <div class="catalogue-flat__toc-decade-buttons">${decadeButtonsHtml}</div>
                    </td>
                </tr>`;

        tocHtml += `
                <tr class="catalogue-flat__toc-heading-row">
                    <td colspan="3"><span class="catalogue-flat__toc-heading">Maps</span></td>
                </tr>`;
        // Merge multiple Settlements cards into one TOC row
        const tocMerges = [
            {
                canonicalName: 'Settlements',
                mergedIds: ['flat-settlements', 'flat-settlements-roi', 'flat-roi-legal-towns'],
                years: '2005-2015',
                extent: 'Ireland'
            }
        ];
        const mergedIdSet = new Set(tocMerges.flatMap(m => m.mergedIds));
        const tocGroups = [
            {
                heading: 'Small Electoral Units',
                members: ['Wards', 'District Electoral Divisions', 'Electoral Divisions']
            },
            {
                heading: 'Large Electoral Units',
                members: ['Local Electoral Areas', 'District Electoral Areas', 'County Electoral Divisions']
            },
            {
                heading: 'Local Authorities',
                members: ['Local Government Districts', 'Local Authorities', 'Administrative Areas']
            },
            {
                heading: 'Census Units',
                members: ['Small Census Units', 'Super Census Units', 'Travel To Work Areas', 'Census Grid']
            },
            {
                heading: 'Regional Authorities',
                members: ['Education and Library Boards', 'Health and Social Care Trusts', 'Administrative Counties']
            },
            {
                heading: 'Devolved Constituencies',
                members: [
                    'Assembly Areas',
                    'Forum Constituencies',
                    'Assembly Constituencies',
                    'Constitutional Convention Constituencies',
                    'Parliament of Northern Ireland Constituencies'
                ]
            }
        ];
        const groupByMemberName = new Map();
        const groupByHeading = new Map();
        tocGroups.forEach(group => {
            groupByHeading.set(group.heading, group);
            group.members.forEach(memberName => groupByMemberName.set(memberName, group.heading));
        });

        const cardsByStrippedName = new Map();
        c1Cards.forEach(card => {
            const strippedName = stripBracketParts(card.name);
            if (!cardsByStrippedName.has(strippedName)) cardsByStrippedName.set(strippedName, []);
            cardsByStrippedName.get(strippedName).push(card);
        });

        const renderedHeadings = new Set();
        const renderedCards = new Set();

        const appendTocRow = (card, indented = false) => {
            const maps = collectCardMaps(card);
            const preview = maps[0]?.map || null;
            const previewThumb = preview ? (preview.cloneOf || preview.id) : '';
            const previewColor = preview?.style?.color || '#888';
            const strippedName = stripBracketParts(card.name);
            const tocName = card.id === 'flat-historic-sites' ? 'Historic Sites' : strippedName;
            tocHtml += `
                <tr class="${indented ? 'catalogue-flat__toc-row--indented' : ''}">
                    <td>
                        <a href="#flat-card-${card.id}" class="catalogue-flat__toc-link">
                            <span class="catalogue-flat__toc-namecell">
                                <span class="catalogue-flat__toc-color" style="background:${this.escapeHtml(previewColor)}"></span>
                                ${previewThumb ? `<span class="catalogue-flat__toc-thumbwrap"><img class="catalogue-flat__toc-thumb" src="assets/thumbnails/${this.escapeHtml(previewThumb)}.png" alt="" loading="lazy" onerror="var w=this.parentElement; if(w){w.classList.add('catalogue-flat__toc-thumbwrap--missing');} this.style.display='none'"><span class="catalogue-flat__toc-thumbzoom" aria-hidden="true"><img src="assets/thumbnails/${this.escapeHtml(previewThumb)}.png" alt="" loading="lazy" onerror="var w=this.closest('.catalogue-flat__toc-thumbwrap'); if(w){w.classList.add('catalogue-flat__toc-thumbwrap--missing');} this.parentElement.style.display='none'"></span></span>` : '<span class="catalogue-flat__toc-thumb catalogue-flat__toc-thumb--fallback"></span>'}
                                <span class="catalogue-flat__toc-name">${this.escapeHtml(tocName)}</span>
                            </span>
                        </a>
                    </td>
                    <td>${this.escapeHtml(card.years || '')}</td>
                    <td>${this.escapeHtml(card.extent || '')}</td>
                </tr>`;
            renderedCards.add(card.id);
        };

        // Build merge lookup: first card id in group → merge definition
        const mergeByFirstId = new Map();
        tocMerges.forEach(merge => { mergeByFirstId.set(merge.mergedIds[0], merge); });

        c1Cards.forEach(card => {
            if (renderedCards.has(card.id)) return;
            // Skip non-first members of a merge group
            if (mergedIdSet.has(card.id) && !mergeByFirstId.has(card.id)) {
                renderedCards.add(card.id);
                return;
            }

            // If this card is the first of a merge group, render a single merged TOC row
            const merge = mergeByFirstId.get(card.id);
            if (merge) {
                const firstCard = c1Cards.find(c => c.id === merge.mergedIds[0]);
                const maps = firstCard ? collectCardMaps(firstCard) : [];
                const preview = maps[0]?.map || null;
                const previewThumb = preview ? (preview.cloneOf || preview.id) : '';
                const previewColor = preview?.style?.color || '#888';
                tocHtml += `
                    <tr>
                        <td>
                            <a href="#flat-card-${merge.mergedIds[0]}" class="catalogue-flat__toc-link">
                                <span class="catalogue-flat__toc-namecell">
                                    <span class="catalogue-flat__toc-color" style="background:${this.escapeHtml(previewColor)}"></span>
                                    ${previewThumb ? `<span class="catalogue-flat__toc-thumbwrap"><img class="catalogue-flat__toc-thumb" src="assets/thumbnails/${this.escapeHtml(previewThumb)}.png" alt="" loading="lazy" onerror="var w=this.parentElement; if(w){w.classList.add('catalogue-flat__toc-thumbwrap--missing');} this.style.display='none'"><span class="catalogue-flat__toc-thumbzoom" aria-hidden="true"><img src="assets/thumbnails/${this.escapeHtml(previewThumb)}.png" alt="" loading="lazy" onerror="var w=this.closest('.catalogue-flat__toc-thumbwrap'); if(w){w.classList.add('catalogue-flat__toc-thumbwrap--missing');} this.parentElement.style.display='none'"></span></span>` : '<span class="catalogue-flat__toc-thumb catalogue-flat__toc-thumb--fallback"></span>'}
                                    <span class="catalogue-flat__toc-name">${this.escapeHtml(merge.canonicalName)}</span>
                                </span>
                            </a>
                        </td>
                        <td>${this.escapeHtml(merge.years || '')}</td>
                        <td>${this.escapeHtml(merge.extent || '')}</td>
                    </tr>`;
                merge.mergedIds.forEach(id => renderedCards.add(id));
                return;
            }

            const strippedName = stripBracketParts(card.name);
            const heading = groupByMemberName.get(strippedName);
            if (!heading) {
                appendTocRow(card, false);
                return;
            }

            if (renderedHeadings.has(heading)) return;

            tocHtml += `
                <tr class="catalogue-flat__toc-subheading-row">
                    <td colspan="3"><span class="catalogue-flat__toc-subheading">${this.escapeHtml(heading)}</span></td>
                </tr>`;
            renderedHeadings.add(heading);

            const group = groupByHeading.get(heading);
            (group?.members || []).forEach(memberName => {
                const memberCards = cardsByStrippedName.get(memberName) || [];
                memberCards.forEach(memberCard => {
                    if (!renderedCards.has(memberCard.id)) appendTocRow(memberCard, true);
                });
            });
        });
        tocHtml += '</tbody></table></div>';

        container.innerHTML = tocHtml + '<div class="catalogue-flat__cards" id="catalogueFlatCards"></div>';
        const cardsContainer = container.querySelector('#catalogueFlatCards');
        const renderOptions = options || {};

        const esc = (value) => this.escapeHtml(value || '');
        const electionsAnchor = document.createElement('div');
        electionsAnchor.id = 'flat-section-elections';
        electionsAnchor.className = 'catalogue-flat__anchor';
        cardsContainer.appendChild(electionsAnchor);
        decadeElectionCards.forEach(def => {
            const anchor = document.createElement('div');
            anchor.id = `flat-card-${def.id}`;
            anchor.className = 'catalogue-flat__anchor';
            cardsContainer.appendChild(anchor);

            const entriesHtml = (def.electionEntries || []).map(entry => {
                const appearance = getElectionAppearance(entry.body, entry.date, entry.bodyGroup || null);
                const dateFormatted = formatElectionDate(entry.date);
                const bodyShort = shortBodyName(entry.body);
                const subtitle = entry.displaySubtitle || (entry.isByElection
                    ? (entry.constituencies || []).join(', ')
                    : ((entry.body === 'European Parliament' && (entry.constituencies || []).filter(c => c !== 'Northern Ireland').length === 0)
                        ? 'Northern Ireland'
                        : `${(entry.constituencies || []).filter(c => c !== 'Northern Ireland').length} constituencies`));
                const providerLabel = entry.displayProvider || bodyShort;
                const placeholderClass = entry.placeholder ? ' class-member--placeholder' : '';
                const nameContent = `${esc(dateFormatted)} <span class="flat-election-body">${esc(providerLabel)}</span>`;
                const dateLabel = entry.placeholder
                    ? `<span class="class-member__name">${nameContent}</span>`
                    : `<a href="#" class="class-member__name class-member__name-link flat-election-link" data-election-body="${esc(entry.body)}" data-election-date="${esc(entry.date)}">${nameContent}</a>`;
                const actionsHtml = entry.placeholder
                    ? ''
                    : `<button class="btn btn--icon btn--xs load-btn election-load-btn" data-election-body="${esc(entry.body)}" data-election-date="${esc(entry.date)}">+</button>`;
                const badgeHtml = entry.placeholder
                    ? '<span class="class-member__placeholder-badge">To Be Added</span>'
                    : '';
                return `
                    <div class="class-member flat-election-entry ${entry.isByElection ? 'flat-election-entry--by' : ''}${placeholderClass}"
                         data-election-body="${esc(entry.body)}"
                         data-election-date="${esc(entry.date)}"
                         data-election-placeholder="${entry.placeholder ? '1' : '0'}"
                         style="--map-color:${esc(appearance.color)};">
                        <div class="thumb-zone"><img class="class-member__thumbnail" src="assets/thumbnails/${esc(appearance.thumb)}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                        <div class="class-member__info">
                            ${dateLabel}
                            <span class="class-member__desc">${esc(subtitle)}</span>
                            ${badgeHtml}
                        </div>
                        <div class="class-member__actions">
                            ${actionsHtml}
                        </div>
                    </div>`;
            }).join('');

            const elPlaceholderCount = (def.electionEntries || []).filter(e => e.placeholder).length;
            const elPlaceholderToggle = elPlaceholderCount > 0
                ? `<button type="button" class="class-card__placeholder-toggle" data-showing="false" title="Show maps to be added">
                       <span class="class-card__placeholder-toggle-label">Show ${elPlaceholderCount} to be added</span>
                   </button>`
                : '';

            const card = document.createElement('div');
            card.className = 'c1-card map-card';
            card.dataset.c1Id = def.id;
            card.innerHTML = `
                <div class="c1-card__header">
                    <div class="c1-card__titleblock">
                        <h3 class="c1-card__title">${esc(def.name)}</h3>
                        <div class="c1-card__subtitle">${esc(def.years)} | ${esc(def.extent)}</div>
                    </div>
                    ${elPlaceholderToggle}
                </div>
                <div class="c1-card__content">
                    <div class="c1-card__section c1-card__section--full">
                        <div class="c1-card__section-members">
                            ${entriesHtml || '<div class="class-member class-member--placeholder"><div class="class-member__info"><span class="class-member__name">No elections in this decade.</span></div></div>'}
                        </div>
                    </div>
                </div>`;
            cardsContainer.appendChild(card);
        });

        const mapsAnchor = document.createElement('div');
        mapsAnchor.id = 'flat-section-maps';
        mapsAnchor.className = 'catalogue-flat__anchor';
        cardsContainer.appendChild(mapsAnchor);

        c1Cards.forEach(def => {
            const anchor = document.createElement('div');
            anchor.id = `flat-card-${def.id}`;
            anchor.className = 'catalogue-flat__anchor';
            cardsContainer.appendChild(anchor);

            const mapEntries = collectCardMaps(def);

            const pseudoClass = { id: `flat-${def.id}`, name: def.name };
            const allMaps = mapEntries.map(entry => ({ map: entry.map, classId: pseudoClass.id, className: def.name }));
            const sectionHtml = this.renderC2Section(pseudoClass, allMaps, { ...renderOptions, ignoreMemberHeight: true, fullWidth: true })
                .replace(/<div class="c1-card__section-header">[\s\S]*?<\/div>/, '');

            const flatPlaceholderCount = allMaps.filter(m => m.map.placeholder || m.map.incomplete).length;
            const flatPlaceholderToggle = flatPlaceholderCount > 0
                ? `<button type="button" class="class-card__placeholder-toggle" data-showing="false" title="Show maps marked to-be-added or incomplete">
                       <span class="class-card__placeholder-toggle-label">Show ${flatPlaceholderCount} to be added</span>
                   </button>`
                : '';

            const card = document.createElement('div');
            card.className = 'c1-card map-card';
            card.dataset.c1Id = def.id;
            const headerMeta = [def.years, def.extent].filter(Boolean).join(' | ');
            card.innerHTML = `
                <div class="c1-card__header">
                    <div class="c1-card__titleblock">
                        <h3 class="c1-card__title">${this.escapeHtml(stripBracketParts(def.name))}</h3>
                        ${headerMeta ? `<div class="c1-card__subtitle">${this.escapeHtml(headerMeta)}</div>` : ''}
                    </div>
                    ${flatPlaceholderToggle}
                </div>
                <div class="c1-card__content">${sectionHtml}</div>`;
            this.addC1CardEventListeners(card, allMaps.filter(m => !m.map.placeholder));
            cardsContainer.appendChild(card);
        });

        const booksAnchor = document.createElement('div');
        booksAnchor.id = 'flat-section-books';
        booksAnchor.className = 'catalogue-flat__anchor';

        cardsContainer.querySelectorAll('.flat-election-link, .election-load-btn, .flat-election-entry').forEach(el => {
            el.addEventListener('click', (e) => {
                const host = e.currentTarget.closest('.flat-election-entry') || e.currentTarget;
                if (host?.dataset?.electionPlaceholder === '1') return;
                if (e.currentTarget.classList.contains('flat-election-entry') &&
                    e.target.closest('.flat-election-link, .election-load-btn')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                const source = e.currentTarget;
                const body = source.dataset.electionBody || source.closest('.flat-election-entry')?.dataset.electionBody;
                const date = source.dataset.electionDate || source.closest('.flat-election-entry')?.dataset.electionDate;
                if (body && date) {
                    this.onLoadElection?.(body, date);
                }
            });
        });

        // Keep books section below unchanged.
        if (this.booksData && this.booksData.books && this.booksData.books.length > 0) {
            cardsContainer.appendChild(booksAnchor);
            const booksGroupHeader = document.createElement('div');
            booksGroupHeader.className = 'category-group-header';
            booksGroupHeader.innerHTML = `<h3 class="category-group-title">Books & Documents</h3>`;
            cardsContainer.appendChild(booksGroupHeader);

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
                const filteredBooks = !this.searchQuery
                    ? catBooks
                    : catBooks.filter(book => this._bookMatchesSearch(book, cat, this.searchQuery));
                if (filteredBooks.length === 0) return;

                const catSection = document.createElement('div');
                catSection.className = 'category-section';
                catSection.innerHTML = `
                    <div class="category-section__header">
                        <span class="category-section__icon">${cat.icon || '[book]'}</span>
                        <h3 class="category-section__title">${this.escapeHtml(cat.name)}</h3>
                    </div>
                `;

                filteredBooks.forEach(book => {
                    const card = document.createElement('div');
                    card.className = 'map-card book-card';
                    card.innerHTML = this._buildBookCardHtml(book);
                    catSection.appendChild(card);
                });

                cardsContainer.appendChild(catSection);
            });
        }

        // Wire smooth-scroll for TOC links
        container.querySelectorAll('.catalogue-flat__toc-link, .catalogue-flat__toc-toplink').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href').substring(1);
                const targetEl = document.getElementById(targetId);
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
        container.querySelectorAll('[data-book-view]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.openCatalogueBookViewer(btn.dataset.bookView, btn.dataset.bookFormat || 'pdf');
            });
        });

        // Placeholder toggle — show/hide "To Be Added" entries per card
        container.addEventListener('click', (e) => {
            const toggle = e.target.closest('.class-card__placeholder-toggle');
            if (!toggle) return;
            e.preventDefault();
            const card = toggle.closest('.c1-card, .class-card, .map-card');
            if (!card) return;
            const showing = toggle.dataset.showing === 'true';
            toggle.dataset.showing = showing ? 'false' : 'true';
            card.classList.toggle('class-card--show-placeholders', !showing);
            const label = toggle.querySelector('.class-card__placeholder-toggle-label');
            if (label) {
                const count = label.textContent.match(/\d+/)?.[0] || '';
                label.textContent = !showing ? `Hide ${count} to be added` : `Show ${count} to be added`;
            }
        });

        // Thumbnail hover zoom — position the popup in fixed viewport coords
        // so it escapes the scrollable pane's overflow clipping.
        container.addEventListener('mouseenter', (e) => {
            const wrap = e.target.closest('.catalogue-flat__toc-thumbwrap');
            if (!wrap || wrap.classList.contains('catalogue-flat__toc-thumbwrap--missing')) return;
            const zoom = wrap.querySelector('.catalogue-flat__toc-thumbzoom');
            if (!zoom) return;
            const rect = wrap.getBoundingClientRect();
            let left = rect.right + 8;
            let top = rect.top + rect.height / 2 - 60;
            // Keep within viewport
            if (left + 128 > window.innerWidth) left = rect.left - 128;
            if (top < 4) top = 4;
            if (top + 128 > window.innerHeight) top = window.innerHeight - 128;
            zoom.style.left = left + 'px';
            zoom.style.top = top + 'px';
            zoom.classList.add('catalogue-flat__toc-thumbzoom--visible');
        }, true);
        container.addEventListener('mouseleave', (e) => {
            const wrap = e.target.closest('.catalogue-flat__toc-thumbwrap');
            if (!wrap) return;
            const zoom = wrap.querySelector('.catalogue-flat__toc-thumbzoom');
            if (zoom) zoom.classList.remove('catalogue-flat__toc-thumbzoom--visible');
        }, true);

        container.dataset.rendered = 'true';
        // Re-apply the cached stats text into the TOC top-row slot now that
        // #catalogueTocStats exists. updateFilterStats may have been called
        // before this render finished and written to a then-missing element.
        if (this._lastFilterStatsText) {
            const tocStatsEl = document.getElementById('catalogueTocStats');
            if (tocStatsEl) tocStatsEl.textContent = this._lastFilterStatsText;
        }
        this.updateCatalogueHomeButton();
    }

    /** Mark flat view as stale so it re-renders on next toggle */
    invalidateFlatView() {
        const flatView = document.getElementById('catalogueFlatView');
        if (flatView) {
            delete flatView.dataset.rendered;
            // If currently showing flat view, re-render immediately
            if (this._catalogueViewMode === 'flat') {
                this.renderFlatView(this._lastMapListOptions || {});
            }
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
        const yearBasedClasses = ['ni-wards', 'ni-deas', 'ni-lgds', 'ni-pcs', 'ni-assembly', 'ni-settlements', 'roi-settlements', 'ni-deds', 'ni-county-eds', 'eu-parliament'];
        const useYearDisplay = yearBasedClasses.includes(cls.id);

        // Timeline slider removed - now using the main timeline slider in map pane
        let timelineHtml = '';

        // Build members HTML
        const membersHtml = memberMaps.map(map => {
            const isLoaded = this.isMapLoadedState(map.id, options);
            const isPlaceholder = map.placeholder;
            const isIncomplete = map.incomplete;
            const displayName = useYearDisplay ? (this.getYear(map.date) || map.name) : map.name;
            const color = map.style?.color || '#3388ff';

            return `
                <div class="class-member ${isLoaded ? 'class-member--loaded' : ''} ${isPlaceholder ? 'class-member--placeholder' : ''} ${isIncomplete ? 'class-member--incomplete' : ''}" data-map-id="${map.id}" style="--map-color: ${color}">
                    <div class="thumb-zone"><img class="class-member__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                    <div class="class-member__info">
                        ${!isPlaceholder ? `<a href="#" class="class-member__name class-member__name-link" data-detail-map-id="${map.id}">${this.escapeHtml(displayName)}</a>` : `<span class="class-member__name">${this.escapeHtml(displayName)}</span>`}
                        ${map.changeNote ? `<span class="class-member__change-note">${this.escapeHtml(map.changeNote)}</span>` : ''}
                        ${!isPlaceholder && map.provider ? `<span class="class-member__provider">${this.escapeHtml(map.provider.join(', '))}</span>` : ''}
                        ${isPlaceholder ? '<span class="class-member__placeholder-badge">To Be Added</span>' : isIncomplete ? '<span class="class-member__incomplete-badge">Incomplete</span>' : ''}
                    </div>
                    ${!isPlaceholder ? `<div class="class-member__actions">\n                        <button class="btn btn--icon btn--xs visibility-btn" data-map-id="${map.id}" title="${isLoaded ? 'Hide' : 'Show'}">\n                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>\n                        </button>\n                        <button class="btn btn--icon btn--xs load-btn" data-map-id="${map.id}" title="${isLoaded ? 'Unload' : 'Load'}">${this.getLoadButtonIcon(isLoaded)}</button>\n                        <button class="btn btn--icon btn--xs copy-url-btn" data-map-id="${map.id}" title="Copy shareable URL">\n                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>\n                        </button>\n                        <button class="btn btn--icon btn--xs download-fgb-btn" data-map-id="${map.id}" title="Download FGB">\n                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>\n                        </button>\n                        <div class="overflow-menu">\n                            <button class="overflow-menu__trigger" title="More actions"></button>
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
                                ${map.files?.geojson ? `<a href="${map.files.geojson}" class="overflow-menu__item" download>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    Download Original
                                </a>` : ''}
                                ${this.renderOsniOverflowItems(map)}
                            </div>
                        </div>
                    </div>` : ''}
                </div>`;
        }).join('');

        const hasPlaceholders = memberMaps.some(m => m.placeholder || m.incomplete);
        const placeholderCount = memberMaps.filter(m => m.placeholder || m.incomplete).length;
        const placeholderToggleHtml = hasPlaceholders
            ? `<button type="button" class="class-card__placeholder-toggle" data-showing="false" title="Show maps marked to-be-added or incomplete">
                   <span class="class-card__placeholder-toggle-label">Show ${placeholderCount} to be added</span>
               </button>`
            : '';

        card.innerHTML = `
            <div class="class-card__header">
                <div class="class-card__title">${this.escapeHtml(cls.name)}</div>
                ${cls.scope ? `<div class="class-card__scope">${this.escapeHtml(cls.scope)}</div>` : ''}
                ${placeholderToggleHtml}
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
                const isLoaded = this.isMapLoadedState(map.id, options);
                const isPlaceholder = map.placeholder;
                const isIncomplete = map.incomplete;
                const displayName = this.getYear(map.date) || map.name;
                membersHtml += `
                    <div class="class-member ${isLoaded ? 'class-member--loaded' : ''} ${isPlaceholder ? 'class-member--placeholder' : ''} ${isIncomplete ? 'class-member--incomplete' : ''}" data-map-id="${map.id}" style="--map-color: ${map.style?.color || '#888'}">
                        <div class="thumb-zone"><img class="class-member__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                        <div class="class-member__info"><span class="class-member__name">${this.escapeHtml(displayName)}</span>
                            ${map.changeNote ? `<span class="class-member__change-note">${this.escapeHtml(map.changeNote)}</span>` : ''}
                            ${!isPlaceholder && map.provider ? `<span class="class-member__provider">${this.escapeHtml(map.provider.join(', '))}</span>` : ''}
                            ${isPlaceholder ? '<span class="class-member__placeholder-badge">To Be Added</span>' : isIncomplete ? '<span class="class-member__incomplete-badge">Incomplete</span>' : ''}
                        </div>
                        ${!isPlaceholder ? `<div class="class-member__actions">
                            <button class="btn btn--icon btn--xs load-btn" data-map-id="${map.id}">${this.getLoadButtonIcon(isLoaded)}</button>
                            <div class="overflow-menu">
                                <button class="overflow-menu__trigger" title="More actions"></button>
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
                                    ${this.renderOsniOverflowItems(map)}
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

        const conjPlaceholderCount = allMaps.filter(m => m.map.placeholder || m.map.incomplete).length;
        const conjPlaceholderToggle = conjPlaceholderCount > 0
            ? `<button type="button" class="class-card__placeholder-toggle" data-showing="false" title="Show maps marked to-be-added or incomplete">
                   <span class="class-card__placeholder-toggle-label">Show ${conjPlaceholderCount} to be added</span>
               </button>`
            : '';

        group.innerHTML = `
            <div class="class-card__header">
                <div class="class-card__title">${this.escapeHtml(targetClass.name)}</div>
                ${targetClass.scope ? `<div class="class-card__scope">${this.escapeHtml(targetClass.scope)}</div>` : ''}
                ${conjPlaceholderToggle}
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
        const c1PlaceholderCount = allMaps.filter(m => m.map.placeholder || m.map.incomplete).length;
        const c1PlaceholderToggle = c1PlaceholderCount > 0
            ? `<button type="button" class="class-card__placeholder-toggle" data-showing="false" title="Show maps marked to-be-added or incomplete">
                   <span class="class-card__placeholder-toggle-label">Show ${c1PlaceholderCount} to be added</span>
               </button>`
            : '';

        card.innerHTML = `
            <div class="c1-card__header"><h3 class="c1-card__title">${this.escapeHtml(c1.name)}</h3>${c1PlaceholderToggle}</div>
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
        const fullDateClassNames = new Set(['District Electoral Divisions', 'County Electoral Divisions', 'Administrative Areas']);
        // Classes that use year as name but show date as subtitle (Wards and DEAs)
        const yearWithSubtitleClasses = ['ni-wards', 'ni-deas'];
        // Classes that use the actual map name (NI constituencies with suffixes like Assembly, Forum, etc)
        const fullNameClasses = ['ni-assembly'];
        const normalizedClassName = String(cls?.name || '').replace(/\s*\([^)]*\)/g, '').trim();

        // When all maps in this section share the same year, showing the year
        // for each entry is useless — fall back to using map names instead.
        const allYears = sorted.map(({ map }) => this.getYear(map.date)).filter(Boolean);
        const allSameYear = allYears.length > 1 && allYears.every(y => y === allYears[0]);

        const membersHtml = sorted.map(({ map }) => {
            const isLoaded = this.isMapLoadedState(map.id, options);
            const isPlaceholder = map.placeholder;
            const isIncomplete = map.incomplete;
            const hasVariants = map.variants && map.variants.length > 0;

            let displayName;
            let dateSubtitle = '';

            if (fullDateClasses.includes(cls.id) || fullDateClassNames.has(normalizedClassName)) {
                // Show full date as the derived name
                displayName = this.formatMapDate(map.date) || map.name;
            } else if (yearWithSubtitleClasses.includes(cls.id)) {
                // Show year as name with date subtitle
                displayName = this.getYear(map.date) || map.name;
                const fullDate = this.formatMapDate(map.date);
                if (fullDate && fullDate !== displayName) {
                    dateSubtitle = `<span class="class-member__date">${fullDate}</span>`;
                }
            } else if (fullNameClasses.includes(cls.id) || allSameYear) {
                // Use the actual map name (e.g., "2023 Assembly", "1995 Forum",
                // or when all maps share the same year like Garda Regions/Divisions/etc.)
                displayName = map.name;
            } else {
                // Default: show year
                displayName = this.getYear(map.date) || map.name;
            }

            // Expand button for maps with variants (isGroup)
            const expandBtn = hasVariants ? `<button class="btn btn--icon btn--xs variants-toggle" data-map-id="${map.id}" title="Show variants">&#9660;</button>` : '';

            // Variants dropdown HTML (for isGroup maps)
            const variantsHtml = hasVariants ? this.renderVariantsDropdown(map, isLoaded) : '';

            const heightStyle = (!options.ignoreMemberHeight && map.style?.height) ? `height: ${map.style.height};` : '';
            return `
                <div class="class-member ${isLoaded ? 'class-member--loaded' : ''} ${isPlaceholder ? 'class-member--placeholder' : ''} ${isIncomplete ? 'class-member--incomplete' : ''} ${hasVariants ? 'class-member--has-variants' : ''}" data-map-id="${map.id}" data-date="${map.date || ''}" style="--map-color: ${map.style?.color || '#888'};${heightStyle}">
                <div class="thumb-zone"><img class="class-member__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>
                <div class="class-member__info">${!isPlaceholder ? `<a href="#" class="class-member__name class-member__name-link" data-detail-map-id="${map.id}">${displayName}</a>` : `<span class="class-member__name">${displayName}</span>`}${dateSubtitle}
                ${map.changeNote ? `<span class="class-member__change-note">${this.escapeHtml(map.changeNote)}</span>` : ''}
                ${!isPlaceholder && map.provider ? `<span class="class-member__provider">${this.escapeHtml(map.provider.join(', '))}</span>` : ''}
                ${isPlaceholder ? '<span class="class-member__placeholder-badge">To Be Added</span>' : isIncomplete ? '<span class="class-member__incomplete-badge">Incomplete</span>' : ''}
            </div>
                ${!isPlaceholder ? `<div class="class-member__actions">${expandBtn}\n                        <button class="btn btn--icon btn--xs visibility-btn" data-map-id="${map.id}" title="${isLoaded ? 'Hide' : 'Show'}">\n                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>\n                        </button>\n                        <button class="btn btn--icon btn--xs load-btn" data-map-id="${map.id}" title="${isLoaded ? 'Unload' : 'Load'}">${this.getLoadButtonIcon(isLoaded)}</button>\n                        <button class="btn btn--icon btn--xs copy-url-btn" data-map-id="${map.id}" title="Copy shareable URL">\n                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>\n                        </button>\n                        <button class="btn btn--icon btn--xs download-fgb-btn" data-map-id="${map.id}" title="Download FGB">\n                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>\n                        </button>\n                        <div class="overflow-menu">\n                            <button class="overflow-menu__trigger" title="More actions"></button>
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
                                ${this.renderOsniOverflowItems(map)}
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
     * - First item in each column ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ row 2 (row 1 is column headers)
     * - Second item in each column ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ row 3, etc.
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
                        isLoaded: this.isMapLoadedState(map.id, options),
                        isPlaceholder: map.placeholder,
                        isIncomplete: map.incomplete
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
                    const incompleteClass = item.isIncomplete ? ' c1-grid-entry--incomplete' : '';
                    const displayYear = this.getYear(item.map.date) || item.map.name;
                    const color = item.map.style?.color || '#888';

                    html += `<div class="c1-grid-cell${placeholderClass}${incompleteClass}" style="grid-column: ${gridCol}; grid-row: ${item.gridRowStart} / ${item.gridRowEnd}; --map-color: ${color};">`;
                    html += `<div class="c1-grid-entry${loadedClass}${placeholderClass}${incompleteClass}" data-map-id="${item.map.id}" data-date="${item.map.date || ''}">`;
                    html += `<div class="thumb-zone"><img class="c1-entry__thumbnail" src="assets/thumbnails/${item.map.cloneOf || item.map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>`;
                    html += '<div class="c1-entry-content">';
                    html += `<span class="c1-entry-year">${displayYear}</span>`;
                    if (!item.isPlaceholder && item.map.provider) {
                        html += `<span class="c1-entry-provider">${this.escapeHtml(item.map.provider.join(', '))}</span>`;
                    }
                    html += '</div>';

                    if (item.isPlaceholder) {
                        html += '<span class="c1-placeholder-badge">To Be Added</span>';
                    } else if (item.isIncomplete) {
                        html += '<span class="c1-incomplete-badge">Incomplete</span>';
                    }

                    if (!item.isPlaceholder) {
                        html += `<button class="btn btn--icon btn--xs visibility-btn" data-map-id="${item.map.id}" title="${item.isLoaded ? 'Hide' : 'Show'}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>`;
                        html += `<button class="c1-load-btn load-btn" data-map-id="${item.map.id}" title="${item.isLoaded ? 'Unload' : 'Load'}">${this.getLoadButtonIcon(item.isLoaded)}</button>`;
                        html += `<button class="btn btn--icon btn--xs copy-url-btn" data-map-id="${item.map.id}" title="Copy shareable URL">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        </button>`;
                        html += `<button class="btn btn--icon btn--xs download-fgb-btn" data-map-id="${item.map.id}" title="Download FGB">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>`;
                        html += `<div class="overflow-menu">
                            <button class="overflow-menu__trigger" title="More actions"></button>
                            <div class="overflow-menu__dropdown">
                                <button class="overflow-menu__item visibility-btn" data-map-id="${item.map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    Toggle visibility
                                </button>
                                <button class="overflow-menu__item copy-url-btn" data-map-id="${item.map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                    Copy URL
                                </button>
                                <button class="overflow-menu__item download-fgb-btn" data-map-id="${item.map.id}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    Download FGB
                                </button>
                                ${this.renderOsniOverflowItems(item.map)}
                            </div>
                        </div>`;
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

                    const isLoaded = this.isMapLoadedState(map.id, options);
                    const isPlaceholder = map.placeholder;
                    const isIncomplete = map.incomplete;
                    const loadedClass = isLoaded ? ' c1-grid-entry--loaded' : '';
                    const placeholderClass = isPlaceholder ? ' c1-grid-entry--placeholder' : '';
                    const incompleteClass = isIncomplete ? ' c1-grid-entry--incomplete' : '';
                    const displayYear = this.getYear(map.date) || map.name;
                    const color = map.style?.color || '#888';

                    html += `<div class="c1-grid-cell${placeholderClass}${incompleteClass}" style="grid-column: ${gridCol}; grid-row: ${gridRowStart} / ${gridRowEnd}; --map-color: ${color};">`;
                    html += `<div class="c1-grid-entry${loadedClass}${placeholderClass}${incompleteClass}" data-map-id="${map.id}" data-date="${map.date || ''}">`;
                    html += `<div class="thumb-zone"><img class="c1-entry__thumbnail" src="assets/thumbnails/${map.cloneOf || map.id}.png" alt="" loading="lazy" onerror="this.style.display='none'"></div>`;
                    html += '<div class="c1-entry-content">';
                    html += `<span class="c1-entry-year">${displayYear}</span>`;
                    if (!isPlaceholder && map.provider) {
                        html += `<span class="c1-entry-provider">${this.escapeHtml(map.provider.join(', '))}</span>`;
                    }
                    html += '</div>';

                    if (isPlaceholder) {
                        html += '<span class="c1-placeholder-badge">To Be Added</span>';
                    } else if (isIncomplete) {
                        html += '<span class="c1-incomplete-badge">Incomplete</span>';
                    }

                    if (!isPlaceholder) {
                        html += `<button class="btn btn--icon btn--xs visibility-btn" data-map-id="${map.id}" title="${isLoaded ? 'Hide' : 'Show'}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>`;
                        html += `<button class="c1-load-btn load-btn" data-map-id="${map.id}" title="${isLoaded ? 'Unload' : 'Load'}">${this.getLoadButtonIcon(isLoaded)}</button>`;
                        html += `<button class="btn btn--icon btn--xs copy-url-btn" data-map-id="${map.id}" title="Copy shareable URL">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        </button>`;
                        html += `<button class="btn btn--icon btn--xs download-fgb-btn" data-map-id="${map.id}" title="Download FGB">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>`;
                        html += `<div class="overflow-menu">
                            <button class="overflow-menu__trigger" title="More actions"></button>
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
                                ${this.renderOsniOverflowItems(map)}
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
                    dropdown.style.top = `${rect.bottom + 2}px`;
                    dropdown.style.right = `${window.innerWidth - rect.right}px`;
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
                // Support old .class-member, new .c1-grid-entry, and variant items
                const memberEl = btn.closest('.class-member, .c1-grid-entry, .variant-item');
                const isLoaded = memberEl?.classList.contains('class-member--loaded') ||
                    memberEl?.classList.contains('c1-grid-entry--loaded') ||
                    memberEl?.classList.contains('variant-item--loaded');
                if (btn.dataset.busy === '1') return;
                btn.dataset.busy = '1';
                btn.disabled = true;
                const applyLoadedState = (loadedNow) => {
                    if (!memberEl) return;
                    memberEl.classList.toggle('class-member--loaded', loadedNow);
                    memberEl.classList.toggle('c1-grid-entry--loaded', loadedNow);
                    memberEl.classList.toggle('variant-item--loaded', loadedNow);
                    btn.innerHTML = this.getLoadButtonIcon(loadedNow);
                    btn.title = loadedNow ? 'Unload' : 'Load';
                };

                (async () => {
                    try {
                        if (isLoaded && this.onMapUnload) await this.onMapUnload(mapId);
                        else if (!isLoaded && this.onMapLoad) await this.onMapLoad(mapId);
                    } finally {
                        const loadedNow = this.onCheckMapLoaded
                            ? !!this.onCheckMapLoaded(mapId)
                            : (!isLoaded);
                        applyLoadedState(loadedNow);
                        btn.dataset.busy = '0';
                        btn.disabled = false;
                    }
                })();
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

    /**
     * Returns the list of source-format downloads for a map, drawing from
     * either the legacy `osniDownloads` field or the newer `sourceDownloads`
     * field. Both have the same shape: [{ label, file }].
     */
    getSourceDownloads(map) {
        if (Array.isArray(map.sourceDownloads) && map.sourceDownloads.length) return map.sourceDownloads;
        if (Array.isArray(map.osniDownloads) && map.osniDownloads.length) return map.osniDownloads;
        return [];
    }

    /**
     * Returns a heading label for the source-format downloads dropdown
     * section. Uses the map's primary provider where possible.
     */
    getSourceDownloadsHeading(map) {
        const provider = Array.isArray(map.provider) ? map.provider[0] : map.provider;
        const pretty = {
            'OSNI': 'OSNI Open Data',
            'OSI': 'Tailte Éireann (OSI)',
            'OSi': 'Tailte Éireann (OSI)',
            'Tailte Éireann': 'Tailte Éireann',
            'Tailte Eireann': 'Tailte Éireann',
            'NISRA': 'NISRA',
            'CSO': 'CSO',
            'DAERA': 'DAERA',
            'NIEA': 'NIEA',
            'Translink': 'Translink',
            'Department for Communities': 'Department for Communities',
            'Eurostat': 'Eurostat',
            'Northern Ireland Office': 'Northern Ireland Office',
            'Electoral Commission': 'Electoral Commission',
            'Parlconst.org': 'parlconst.org',
        };
        if (provider && typeof provider === 'string') {
            return `${pretty[provider] || provider} downloads`;
        }
        return 'Source data downloads';
    }

    /**
     * Generate overflow menu items for source-format downloads.
     * Reads from sourceDownloads (preferred) or legacy osniDownloads.
     * @param {object} map - Map entry from maps.json
     * @returns {string} HTML for download menu items (empty if none)
     */
    renderOsniOverflowItems(map) {
        const downloads = this.getSourceDownloads(map);
        if (downloads.length === 0) return '';
        const downloadSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        return downloads.map(dl =>
            `<a href="${dl.file}" class="overflow-menu__item overflow-menu__item--osni" download>${downloadSvg} ${this.escapeHtml(dl.label)}</a>`
        ).join('');
    }

    getVisibilityButtonIcon(isVisible) {
        return `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${isVisible
                ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/>'
            }
            </svg>
        `;
    }

    renderMapActionStrip(map, options = {}) {
        const isLoaded = !!options.isLoaded;
        const isVisible = options.isVisible !== undefined ? !!options.isVisible : isLoaded;
        const size = options.buttonSize || 'sm';
        const wrapperClass = options.wrapperClass || 'map-card__actions';
        const sourceDownloads = this.getSourceDownloads(map);
        const hasDownload = !!(map.downloads?.fgb || map.files?.fgb || map.files?.geojson || sourceDownloads.length);
        const hasVariants = !!(map.variants && map.variants.length > 0);

        return `
            <div class="${wrapperClass}">
                <button class="btn btn--icon btn--${size} visibility-btn" data-map-id="${map.id}" title="${isVisible ? 'Hide' : 'Show'}">
                    ${this.getVisibilityButtonIcon(isVisible)}
                </button>
                <button class="btn btn--icon btn--${size} load-btn" data-map-id="${map.id}" title="${isLoaded ? 'Unload' : 'Load'}">
                    ${this.getLoadButtonIcon(isLoaded)}
                </button>
                <button class="btn btn--icon btn--${size} copy-url-btn" data-map-id="${map.id}" title="Copy shareable URL">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                </button>
                ${hasDownload ? `
                    <div class="download-btn-group">
                        <button class="btn btn--icon btn--${size} download-btn" data-map-id="${map.id}" title="Download">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                        <div class="download-dropdown hidden">
                            ${(map.downloads?.fgb || map.files?.fgb) ? `<a href="${map.downloads?.fgb || map.files?.fgb}" class="download-dropdown__item" download>FlatGeobuf (.fgb)</a>` : ''}
                            ${map.files?.geojson ? `<a href="${map.files.geojson}" class="download-dropdown__item" download>GeoJSON</a>` : ''}
                            ${sourceDownloads.length > 0 ? `
                                <div class="download-dropdown__divider"></div>
                                <div class="download-dropdown__heading">${this.escapeHtml(this.getSourceDownloadsHeading(map))}</div>
                                ${sourceDownloads.map(dl => `<a href="${dl.file}" class="download-dropdown__item download-dropdown__item--osni" download>${this.escapeHtml(dl.label)}</a>`).join('')}
                            ` : ''}
                        </div>
                    </div>
                ` : '<div class="download-btn-group--placeholder"></div>'}
                ${hasVariants ? `
                    <button class="btn btn--icon btn--${size} variants-btn" data-map-id="${map.id}" title="${map.variants.length} variants">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M6 9l6 6 6-6"/>
                        </svg>
                    </button>
                ` : '<div class="btn--placeholder"></div>'}
            </div>
        `;
    }

    bindMapActionStrip(container, map, options = {}) {
        if (!container || !map) return;
        const activeClassTarget = options.activeClassTarget || null;

        const syncState = () => {
            const loadedNow = this.onCheckMapLoaded ? !!this.onCheckMapLoaded(map.id) : false;
            const visibleNow = this.onCheckMapVisible ? !!this.onCheckMapVisible(map.id) : loadedNow;
            if (activeClassTarget) {
                activeClassTarget.classList.toggle('map-card--active', loadedNow);
            }
            const loadBtn = container.querySelector('.load-btn');
            if (loadBtn) {
                loadBtn.innerHTML = this.getLoadButtonIcon(loadedNow);
                loadBtn.title = loadedNow ? 'Unload' : 'Load';
            }
            const visibilityBtn = container.querySelector('.visibility-btn');
            if (visibilityBtn) {
                visibilityBtn.innerHTML = this.getVisibilityButtonIcon(visibleNow);
                visibilityBtn.title = visibleNow ? 'Hide' : 'Show';
            }
        };

        container.querySelector('.visibility-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentlyLoaded = this.onCheckMapLoaded ? !!this.onCheckMapLoaded(map.id) : false;
            if (currentlyLoaded && this.onHideMap) {
                this.onHideMap(map.id);
            } else if (this.onMapToggle) {
                this.onMapToggle(map.id);
            }
            syncState();
        });

        container.querySelector('.load-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            if (btn?.dataset?.busy === '1') return;
            if (btn) {
                btn.dataset.busy = '1';
                btn.disabled = true;
            }
            const currentlyLoaded = this.onCheckMapLoaded ? !!this.onCheckMapLoaded(map.id) : false;
            try {
                if (currentlyLoaded && this.onMapUnload) {
                    await this.onMapUnload(map.id);
                } else if (!currentlyLoaded && this.onMapLoad) {
                    await this.onMapLoad(map.id);
                }
            } finally {
                syncState();
                if (btn) {
                    btn.disabled = false;
                    btn.dataset.busy = '0';
                }
            }
        });

        container.querySelector('.copy-url-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyMapUrl(map.id, e.currentTarget);
        });

        container.querySelector('.download-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = container.querySelector('.download-dropdown');
            if (dropdown) {
                dropdown.classList.toggle('hidden');
            }
        });

        container.querySelector('.variants-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const host = options.variantsHost || activeClassTarget || container;
            this.toggleVariantsPanel(map, host);
        });

        syncState();
    }

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
        const isLoaded = this.isMapLoadedState(map.id, options);
        const isVisible = options.visibleIds?.includes(map.id);
        card.className = `map-card${isLoaded ? ' map-card--active' : ''}`;
        card.dataset.mapId = map.id;

        const color = map.style?.color || '#3388ff';
        const providers = (map.provider || []).join(', ');
        const dateStr = this.formatMapDate(map.date);
        const hasVariants = map.variants && map.variants.length > 0;
        const hasDownload = map.files?.fgb || map.files?.geojson || this.getSourceDownloads(map).length > 0;

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
            ${this.renderMapActionStrip(map, {
                isLoaded,
                isVisible,
                buttonSize: 'sm',
                wrapperClass: 'map-card__actions'
            })}
        `;

        this.bindMapActionStrip(card, map, { activeClassTarget: card, variantsHost: card });

        // Row click toggles map
        card.addEventListener('click', () => {
            if (this.onMapToggle) this.onMapToggle(map.id);
        });

        return card;
    }

    copyMapUrl(mapId, buttonEl) {
        const url = new URL(window.location.href);
        const params = new URLSearchParams(url.hash.replace(/^#/, ''));
        const layerIds = (params.get('layers') || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);

        if (!layerIds.includes(mapId)) layerIds.push(mapId);

        params.set('layers', layerIds.join(','));
        url.hash = params.toString();

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
            { id: 'all', name: 'All', icon: '[all]' },
            { id: 'communities', name: 'Communities', icon: '[com]' },
            { id: 'history', name: 'History', icon: '[his]' },
            { id: 'elections-and-government', name: 'Elections and Government', icon: '[gov]' },
            { id: 'public-services', name: 'Public Services', icon: '[svc]' },
            { id: 'physical-geography', name: 'Physical Geography', icon: '[geo]' },
            { id: 'built-environment', name: 'Built Environment', icon: '[built]' }
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
                icon: '[all]',
                providers: [] // Empty means all
            },
            {
                id: 'northern-ireland',
                name: 'Northern Ireland',
                icon: '[NI]',
                providers: ['ABC Council', 'DAERA', 'Department for Communities', 'NIEA', 'NISRA', 'OSNI', 'OSNI Open Data', 'PRONI']
            },
            {
                id: 'ireland',
                name: 'Ireland',
                icon: '[IE]',
                providers: ['CSO', 'EPA', 'OSI', 'OSi', 'TÉ']
            },
            {
                id: 'united-kingdom',
                name: 'United Kingdom',
                icon: '[UK]',
                providers: ['Electoral Commission', 'Northern Ireland Office']
            },
            {
                id: 'european-union',
                name: 'European Union',
                icon: '[EU]',
                providers: ['European Commission', 'Eurostat']
            },
            {
                id: 'organizations',
                name: 'Organizations',
                icon: '[org]',
                providers: ['IHO', 'OpenTopography.org', 'OSM']
            },
            {
                id: 'individuals',
                name: 'Individuals',
                icon: '[ind]',
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
            const mapConfig = mapConfigs.find(m => m.id === feature.mapId)
                || dataService.getMapById(feature.mapId)
                || window.mapController?.layerStates?.get(feature.mapId)?.config;
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

            // Resolve primary name using map label config first, then common fallback keys.
            const preferredKeys = [];
            if (mapConfig?.labelProperty) preferredKeys.push(mapConfig.labelProperty);
            if (Array.isArray(mapConfig?.labelPropertyFallbacks)) {
                preferredKeys.push(...mapConfig.labelPropertyFallbacks);
            }
            preferredKeys.push(
                'Name', 'name', 'NAME',
                'FinalR_DEA', 'DEA', 'DEANAME', 'WARDNAME', 'LGDNAME',
                'CONSTITUENCY', 'COUNTY', 'PARISH', 'BARONY'
            );
            const seenNameKeys = new Set();
            let primaryName = '';
            for (const key of preferredKeys) {
                if (!key || seenNameKeys.has(key)) continue;
                seenNameKeys.add(key);
                const val = props[key];
                if (typeof val === 'string' && val.trim()) {
                    primaryName = val.trim();
                    break;
                }
            }
            if (!primaryName) {
                const fallback = Object.entries(props).find(([k, v]) =>
                    typeof v === 'string' &&
                    v.trim() &&
                    /(name|title|label|dea|ward|district|constituency|county)/i.test(k)
                );
                if (fallback) primaryName = fallback[1].trim();
            }
            if (!primaryName) primaryName = 'Unnamed Feature';

            const detailId = this.cacheFeatureDetailEntry(mapConfig, feature, primaryName, feature.id || primaryName);

            if (mapConfig?.id) {
                html += `<button type="button" class="feature-info__primary-name feature-info__primary-name-link" data-feature-detail-id="${this.escapeHtml(detailId)}">${this.escapeHtml(primaryName)}</button>`;
            } else {
                html += `<div class="feature-info__primary-name">${this.escapeHtml(primaryName)}</div>`;
            }

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
            let meanElevM = props.meanElev_m;
            let meanElevFt = props.meanElev_ft;
            if ((meanElevM === undefined || meanElevM === null || isNaN(meanElevM)) &&
                minElevM !== undefined && minElevM !== null && !isNaN(minElevM) &&
                maxElevM !== undefined && maxElevM !== null && !isNaN(maxElevM)) {
                meanElevM = (Number(minElevM) + Number(maxElevM)) / 2;
            }
            if ((meanElevFt === undefined || meanElevFt === null || isNaN(meanElevFt)) &&
                meanElevM !== undefined && meanElevM !== null && !isNaN(meanElevM)) {
                meanElevFt = Math.round(Number(meanElevM) * 3.28084);
            }

            // Format spatial metrics with dual units and toggle precision
            if (area || perimeter || (minElevM !== undefined && maxElevM !== undefined)) {
                html += '<div class="feature-info__metrics">';
                if (area) {
                    let areaKm2 = typeof area === 'number' ? area : parseFloat(area);
                    if (Number.isFinite(areaKm2) && areaKm2 > 100000) {
                        areaKm2 = areaKm2 / 1000000;
                    }
                    if (!isNaN(areaKm2)) {
                        const areaSqMi = areaKm2 * 0.386102;
                        html += `<div class="feature-info__metric feature-info__metric--clickable feature-info__metric--top" data-area-km="${areaKm2}" data-area-mi="${areaSqMi}" data-precision="2">
                            <span class="feature-info__metric-label">Area</span>
                            <span class="feature-info__metric-value feature-info__metric-value--underline">
                                <span class="metric-km">${this.formatNumber(areaKm2, 2)} km<sup>2</sup></span><br>
                                <span class="metric-mi">(${this.formatNumber(areaSqMi, 2)} sq mi)</span>
                            </span>
                        </div>`;
                    }
                }
                if (perimeter) {
                    let perimKm = typeof perimeter === 'number' ? perimeter : parseFloat(perimeter);
                    if (Number.isFinite(perimKm) && perimKm > 100000) {
                        perimKm = perimKm / 1000;
                    }
                    if (!isNaN(perimKm)) {
                        const perimMi = perimKm * 0.621371;
                        html += `<div class="feature-info__metric feature-info__metric--clickable feature-info__metric--top" data-perim-km="${perimKm}" data-perim-mi="${perimMi}" data-precision="2">
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
                if (meanElevM !== undefined && meanElevM !== null && !isNaN(meanElevM)) {
                    html += `<div class="feature-info__metric">
                        <span class="feature-info__metric-label">Mean Elevation</span>
                        <span class="feature-info__metric-value">
                            <span class="metric-km">${this.formatNumber(meanElevM, 1)} m</span><br>
                            <span class="metric-mi">(${meanElevFt || Math.round(meanElevM * 3.28084)} ft)</span>
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
                'minElev_m', 'maxElev_m', 'meanElev_m', 'minElev_ft', 'maxElev_ft', 'meanElev_ft'];
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
                    if (kmSpan) kmSpan.textContent = `${this.formatNumber(areaKm, newPrecision)} km2`;
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

        content.querySelectorAll('.feature-info__primary-name-link').forEach((btn) => {
            btn.addEventListener('click', () => {
                const detailId = btn.dataset.featureDetailId;
                if (detailId) this.showFeatureDetailInCatalogue(detailId);
            });
        });

        panel.classList.remove('hidden');
    }

    showFeatureDetailInCatalogue(detailId, addToHistory = true) {
        const entry = this._featureDetailCache?.get(detailId);
        if (!entry) return;
        const { feature, mapConfig, primaryName } = entry;
        const activeTabId = this._getActivePaneTabId();

        if (addToHistory) {
            const current = this.catalogueHistory[this.catalogueHistoryIndex];
            if (current?.type === 'feature-detail' && current.detailId === detailId) {
                this.updateCatalogueNavButtons();
                this.updateCatalogueHomeButton();
                return;
            }
            this._pushCatalogueTabHistoryIfNeeded(activeTabId);
            this._pushCatalogueHistoryEntry({ type: 'feature-detail', detailId });
        }

        if (activeTabId !== 'catalogue') {
            this.showTab('catalogue');
        }

        const detailView = document.getElementById('catalogueDetailView');
        const listView = document.getElementById('catalogueListView');
        const nav = document.getElementById('catalogueNav');
        if (!detailView || !listView || !nav) return;

        nav.classList.remove('hidden');
        listView.classList.add('hidden');
        detailView.classList.remove('hidden');
        this.catalogueView = 'detail';
        this.updateCatalogueNavButtons();
        this.updateCatalogueHomeButton();

        const props = feature?.properties || {};
        const electoralHistory = entry?.electoralHistory || null;
        const isByElectionRowClass = (row) => row.isByElection ? 'catalogue-detail__entity-row--by-election' : '';
        const renderElectionLink = (row, label) => `
            <a href="#"
                class="catalogue-detail__entity-link catalogue-detail__entity-link--text"
                data-election-body="${this.escapeHtml(row.electionBodyForOpen || row.body || '')}"
                data-election-date="${this.escapeHtml(row.date || '')}">
                ${this.escapeHtml(label)}
            </a>`;
        const renderEntityLink = (kind, key, label) => `
            <a href="#"
                class="catalogue-detail__entity-link catalogue-detail__entity-link--text"
                data-election-entity-detail-kind="${this.escapeHtml(kind)}"
                data-election-entity-detail-key="${this.escapeHtml(key)}">
                ${this.escapeHtml(label)}
            </a>`;
        const renderLeadingParty = (row) => {
            if (!row?.winnerParty) return '—';
            const colour = this.escapeHtml(row.winnerColour || '#b0bec5');
            return `<span class="catalogue-detail__leading-party"><span class="catalogue-detail__leading-party-tab" style="background:${colour}"></span>${renderEntityLink('party', row.winnerParty, row.winnerParty)}</span>`;
        };
        const renderDeaList = (row) => {
            const deas = row?.districtElectoralAreas || [];
            if (!deas.length) return '—';
            const links = deas.map((dea) => renderEntityLink('dea', dea, dea)).join(', ');
            return `
                <details class="catalogue-detail__inline-list">
                    <summary class="catalogue-detail__inline-list-toggle">Show DEAs (${deas.length})</summary>
                    <div class="catalogue-detail__inline-list-body">${links}</div>
                </details>
            `;
        };
        let historyTableId = null;
        let historyColumns = null;
        let historyRows = null;
        if (electoralHistory?.kind === 'dea') {
            historyTableId = 'catalogue-feature-dea-history-table';
            historyRows = electoralHistory.historyRows || [];
            historyColumns = [
                { key: 'electionDisplayName', label: 'Election', kind: 'text', getValue: (row) => row.electionDisplayName, render: (row) => renderElectionLink(row, row.electionDisplayName) },
                { key: 'date', label: 'Date', kind: 'date', getValue: (row) => row.date, render: (row) => this.escapeHtml(formatElectionDate(row.date || '')) },
                { key: 'localGovernmentDistrict', label: 'Local Government District', kind: 'text', getValue: (row) => row.localGovernmentDistrict, render: (row) => renderEntityLink('lgd', row.localGovernmentDistrict, row.localGovernmentDistrict) },
                { key: 'winnerParty', label: 'Leading party', kind: 'text', getValue: (row) => row.winnerParty, render: (row) => renderLeadingParty(row) },
                { key: 'winnerVotes', label: 'Leading party votes', kind: 'numeric', align: 'num', getValue: (row) => row.winnerVotes, render: (row) => this.escapeHtml(this.formatDisplayValue(Math.round(Number(row.winnerVotes || 0)))) },
                { key: 'winnerPct', label: 'Leading party %', kind: 'numeric', align: 'num', getValue: (row) => row.winnerPct, render: (row) => `${Number(row.winnerPct || 0).toFixed(2)}%` },
                { key: 'validVotes', label: 'Valid votes', kind: 'numeric', align: 'num', getValue: (row) => row.validVotes, render: (row) => this.escapeHtml(this.formatDisplayValue(Math.round(Number(row.validVotes || 0)))) },
                { key: 'seats', label: 'Seats', kind: 'numeric', align: 'num', getValue: (row) => row.seats, render: (row) => this.escapeHtml(this.formatDisplayValue(Math.round(Number(row.seats || 0)))) }
            ];
        } else if (electoralHistory?.kind === 'lgd') {
            historyTableId = 'catalogue-feature-lgd-history-table';
            historyRows = electoralHistory.historyRows || [];
            historyColumns = [
                { key: 'electionDisplayName', label: 'Election', kind: 'text', getValue: (row) => row.electionDisplayName, render: (row) => renderElectionLink(row, row.electionDisplayName) },
                { key: 'date', label: 'Date', kind: 'date', getValue: (row) => row.date, render: (row) => this.escapeHtml(formatElectionDate(row.date || '')) },
                { key: 'deaCount', label: 'DEAs', kind: 'numeric', align: 'num', getValue: (row) => row.deaCount, render: (row) => this.escapeHtml(this.formatDisplayValue(Math.round(Number(row.deaCount || 0)))) },
                { key: 'districtElectoralAreas', label: 'District Electoral Areas', kind: 'text', getValue: (row) => (row.districtElectoralAreas || []).join(', '), render: (row) => renderDeaList(row) },
                { key: 'winnerParty', label: 'Leading party', kind: 'text', getValue: (row) => row.winnerParty, render: (row) => renderLeadingParty(row) },
                { key: 'winnerVotes', label: 'Leading party votes', kind: 'numeric', align: 'num', getValue: (row) => row.winnerVotes, render: (row) => this.escapeHtml(this.formatDisplayValue(Math.round(Number(row.winnerVotes || 0)))) },
                { key: 'winnerPct', label: 'Leading party %', kind: 'numeric', align: 'num', getValue: (row) => row.winnerPct, render: (row) => `${Number(row.winnerPct || 0).toFixed(2)}%` },
                { key: 'validVotes', label: 'Valid votes', kind: 'numeric', align: 'num', getValue: (row) => row.validVotes, render: (row) => this.escapeHtml(this.formatDisplayValue(Math.round(Number(row.validVotes || 0)))) },
                { key: 'seats', label: 'Seats', kind: 'numeric', align: 'num', getValue: (row) => row.seats, render: (row) => this.escapeHtml(this.formatDisplayValue(Math.round(Number(row.seats || 0)))) }
            ];
        }
        const rows = Object.entries(props).map(([k, v]) => `
            <div class="catalogue-detail__meta-row">
                <span class="catalogue-detail__meta-label">${this.escapeHtml(k)}</span>
                <span class="catalogue-detail__meta-value">${this.escapeHtml(this.formatDisplayValue(v))}</span>
            </div>`).join('');

        detailView.innerHTML = `
            <div class="catalogue-detail__card">
                <div class="catalogue-detail__color" style="background-color: ${this.escapeHtml(mapConfig?.style?.color || '#888')}"></div>
                <div class="catalogue-detail__name">${this.escapeHtml(primaryName || 'Feature')}</div>
                <div class="catalogue-detail__date">${this.escapeHtml(mapConfig?.name || '')}</div>
            </div>
            <div class="catalogue-detail__feature-actions">
                <button type="button" class="btn btn--icon btn--sm feature-visibility-btn" title="Show feature" aria-label="Show feature">
                    ${this.getVisibilityButtonIcon(false)}
                </button>
                <button type="button" class="btn btn--icon btn--sm feature-load-btn" title="Load feature" aria-label="Load feature">
                    ${this.getLoadButtonIcon(false)}
                </button>
                <button type="button" class="btn btn--icon btn--sm feature-copy-url-btn" title="Copy shareable URL" aria-label="Copy shareable URL">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                </button>
                <div class="download-btn-group">
                    <button type="button" class="btn btn--icon btn--sm feature-download-fgb-btn" title="Download FGB" aria-label="Download FGB">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button type="button" class="btn btn--icon btn--sm download-btn--dropdown feature-download-menu-btn" title="More download formats" aria-label="More download formats">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M6 9l6 6 6-6"/>
                        </svg>
                    </button>
                    <div class="download-dropdown hidden feature-download-dropdown">
                        <button type="button" class="download-dropdown__item feature-download-alt-btn" data-format="geojson">GeoJSON</button>
                        <button type="button" class="download-dropdown__item feature-download-alt-btn" data-format="json">JSON</button>
                        <button type="button" class="download-dropdown__item feature-download-alt-btn" data-format="csv">CSV</button>
                    </div>
                </div>
            </div>
            ${historyColumns && historyRows
                ? `
            <div class="catalogue-detail__section">
                <div class="catalogue-detail__section-title">Electoral History (${historyRows.length})</div>
                ${this._buildEntityTableMarkup(historyTableId, historyColumns)}
            </div>`
                : ''}
            <div class="catalogue-detail__meta">${rows || '<div class="catalogue-detail__meta-row"><span class="catalogue-detail__meta-value">No properties</span></div>'}</div>
        `;

        const featureBbox = this.getFeatureBBox(feature?.geometry);

        detailView.querySelector('.feature-load-btn')?.addEventListener('click', async (event) => {
            const mapId = mapConfig?.id;
            const featureIndex = feature?.id;
            if (!mapId || featureIndex === undefined || featureIndex === null) return;
            const isLoaded = this.onCheckFeatureLoaded ? !!this.onCheckFeatureLoaded(mapId, featureIndex) : false;
            if (isLoaded) {
                this.onPartialFeatureUnload?.(mapId, featureIndex);
            } else if (this.onFeatureLoad) {
                await this.onFeatureLoad(mapId, featureIndex, primaryName, featureBbox);
            }
            this.syncFeatureDetailActionButtons(detailView, detailId);
        });

        detailView.querySelector('.feature-visibility-btn')?.addEventListener('click', () => {
            const mapId = mapConfig?.id;
            const featureIndex = feature?.id;
            if (!mapId || featureIndex === undefined || featureIndex === null) return;
            if (this.onPartialFeatureToggle) {
                this.onPartialFeatureToggle(mapId, featureIndex);
            }
            this.syncFeatureDetailActionButtons(detailView, detailId);
        });

        detailView.querySelector('.feature-copy-url-btn')?.addEventListener('click', (event) => {
            this.copyFeatureUrl(detailId, event.currentTarget);
        });

        detailView.querySelector('.feature-download-fgb-btn')?.addEventListener('click', () => {
            this.downloadFeature(detailId, 'fgb');
        });

        const dropdown = detailView.querySelector('.feature-download-dropdown');
        detailView.querySelector('.feature-download-menu-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            dropdown?.classList.toggle('hidden');
        });

        detailView.querySelectorAll('.feature-download-alt-btn').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.downloadFeature(detailId, btn.dataset.format);
                dropdown?.classList.add('hidden');
            });
        });
        if (historyColumns && historyRows) {
            this._initEntityDataTable(detailView, historyTableId, historyColumns, historyRows, {
                rowClassNameFn: isByElectionRowClass
            });
        }
        if (detailView._featureDetailClickHandler) {
            detailView.removeEventListener('click', detailView._featureDetailClickHandler);
        }
        detailView._featureDetailClickHandler = async (event) => {
            const electionLink = event.target.closest('[data-election-body][data-election-date]');
            if (electionLink) {
                event.preventDefault();
                this.onElectionEntityElectionOpen?.({
                    body: electionLink.dataset.electionBody,
                    date: electionLink.dataset.electionDate,
                    constituency: electionLink.dataset.electionConstituency || null
                });
                return;
            }
            const entityLink = event.target.closest('[data-election-entity-detail-kind][data-election-entity-detail-key]');
            if (entityLink) {
                event.preventDefault();
                this.onOpenElectionEntityDetail?.(
                    entityLink.dataset.electionEntityDetailKind,
                    entityLink.dataset.electionEntityDetailKey
                );
            }
        };
        detailView.addEventListener('click', detailView._featureDetailClickHandler);
        this.syncFeatureDetailActionButtons(detailView, detailId);
        const pane = this._cataloguePane || document.querySelector('.pane__content[data-tab-content="catalogue"]');
        pane?.scrollTo({ top: 0, behavior: 'auto' });
        this.updateCatalogueNavButtons();
    }

    _buildEntityGroupedHeaderMarkup(columns) {
        const headerRows = Array.isArray(columns.headerRows) ? columns.headerRows : [];
        return headerRows.map((row, rowIndex) => `
            <tr class="catalogue-detail__entity-header-row catalogue-detail__entity-header-row--${rowIndex + 1}${rowIndex === headerRows.length - 1 ? ' catalogue-detail__entity-header-row--leaf' : ''}">
                ${row.map((cell) => {
                    const classes = [];
                    if (cell.align === 'num') classes.push('catalogue-detail__entity-num');
                    if (cell.leafIndex !== undefined && cell.leafIndex !== null) classes.push('catalogue-detail__entity-header-leaf');
                    const attrs = [
                        cell.colspan ? `colspan="${Number(cell.colspan)}"` : '',
                        cell.rowspan ? `rowspan="${Number(cell.rowspan)}"` : '',
                        cell.leafIndex !== undefined && cell.leafIndex !== null ? `data-leaf-col-idx="${Number(cell.leafIndex)}"` : '',
                        cell.leafIndex !== undefined && cell.leafIndex !== null ? `data-leaf-label="${this.escapeHtml(cell.label || '')}"` : ''
                    ].filter(Boolean).join(' ');
                    return `<th class="${classes.join(' ')}" ${attrs}>${this.escapeHtml(cell.label || '')}</th>`;
                }).join('')}
            </tr>
        `).join('');
    }

    _buildEntityTableMarkup(tableId, columns) {
        const isHistoryTable = String(tableId || '').includes('history-table');
        const isGroupedHeaderTable = Array.isArray(columns.headerRows) && columns.headerRows.length > 0;
        const headerMarkup = isGroupedHeaderTable
            ? this._buildEntityGroupedHeaderMarkup(columns)
            : `
                        <tr>
                            ${columns.map((column, idx) => `
                                <th class="${column.align === 'num' ? 'catalogue-detail__entity-num' : ''}" data-leaf-col-idx="${idx}">${this.escapeHtml(column.label)}</th>
                            `).join('')}
                        </tr>
                    `;
        return `
            <div class="catalogue-detail__table-wrap${isHistoryTable ? ' catalogue-detail__table-wrap--history' : ''}">
                <table class="catalogue-detail__entity-table${isGroupedHeaderTable ? ' catalogue-detail__entity-table--grouped' : ''}" data-entity-table-id="${this.escapeHtml(tableId)}">
                    <thead>
                        ${headerMarkup}
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        `;
    }

    _renderEntityTableRows(columns, rows, rowClassNameFn = null) {
        if (!rows.length) {
            return `<tr><td colspan="${columns.length}">No rows</td></tr>`;
        }

        return rows.map((row) => {
            const rowClassName = typeof rowClassNameFn === 'function' ? rowClassNameFn(row) : '';
            return `
                <tr class="${this.escapeHtml(rowClassName || '')}">
                    ${columns.map((column) => `
                        <td class="${column.align === 'num' ? 'catalogue-detail__entity-num' : ''}">
                            ${column.render ? column.render(row) : this.escapeHtml(this.formatDisplayValue(column.getValue ? column.getValue(row) : row[column.key]))}
                        </td>
                    `).join('')}
                </tr>
            `;
        }).join('');
    }

    _getEntityTableFilterValue(row, column) {
        const raw = column.filterValue ? column.filterValue(row) : (column.getValue ? column.getValue(row) : row[column.key]);
        if (raw === null || raw === undefined || raw === '') return '';
        return String(raw);
    }

    _compareEntityTableValues(a, b, column, dir) {
        const kind = column.kind || 'text';
        const av = column.getValue ? column.getValue(a) : a[column.key];
        const bv = column.getValue ? column.getValue(b) : b[column.key];
        const asc = dir === 'asc' ? 1 : -1;

        if (kind === 'numeric' || kind === 'ordinal' || kind === 'date') {
            const aNum = kind === 'date' ? Date.parse(av) : Number(av);
            const bNum = kind === 'date' ? Date.parse(bv) : Number(bv);
            const aFinite = Number.isFinite(aNum);
            const bFinite = Number.isFinite(bNum);
            if (aFinite && bFinite) return (aNum - bNum) * asc;
            if (aFinite) return -1;
            if (bFinite) return 1;
        }

        const aText = av === null || av === undefined ? '' : String(av);
        const bText = bv === null || bv === undefined ? '' : String(bv);
        return aText.localeCompare(bText, undefined, { numeric: true, sensitivity: 'base' }) * asc;
    }

    _initEntityDataTable(container, tableId, columns, rows, options = {}) {
        const table = container.querySelector(`[data-entity-table-id="${tableId}"]`);
        if (!table) return;

        const headers = [...table.querySelectorAll('thead th[data-leaf-col-idx]')];
        const tbody = table.querySelector('tbody');
        const state = {
            filters: new Map(),
            sort: { key: null, dir: 'default' },
            activeMenu: null,
            activeMenuBtn: null,
            documentClickHandler: null,
            filteredRows: [...rows]
        };

        const closeMenu = () => {
            if (state.activeMenu) state.activeMenu.remove();
            if (state.activeMenuBtn) state.activeMenuBtn.classList.remove('election-th-btn--open');
            if (state.documentClickHandler) {
                document.removeEventListener('click', state.documentClickHandler);
                state.documentClickHandler = null;
            }
            state.activeMenu = null;
            state.activeMenuBtn = null;
        };

        const renderRows = () => {
            tbody.innerHTML = this._renderEntityTableRows(columns, state.filteredRows, options.rowClassNameFn);
            headers.forEach((th, idx) => {
                const btn = th.querySelector('[data-table-filter-sort-btn]');
                if (!btn) return;
                const column = columns[idx];
                const filtered = state.filters.has(column.key) && (state.filters.get(column.key)?.size ?? 0) > 0;
                const sorted = state.sort.key === column.key && state.sort.dir !== 'default';
                btn.classList.toggle('election-th-btn--active', filtered || sorted);
                if (sorted && state.sort.dir === 'asc') btn.innerHTML = '&#8593;';
                else if (sorted && state.sort.dir === 'desc') btn.innerHTML = '&#8595;';
                else btn.innerHTML = '&#8645;';
            });
        };

        const applyState = () => {
            let visible = rows.filter((row) => {
                for (const [key, selected] of state.filters.entries()) {
                    if (!(selected instanceof Set) || selected.size === 0) continue;
                    const column = columns.find((entry) => entry.key === key);
                    if (!column) continue;
                    if (!selected.has(this._getEntityTableFilterValue(row, column))) return false;
                }
                return true;
            });

            if (state.sort.key && state.sort.dir !== 'default') {
                const column = columns.find((entry) => entry.key === state.sort.key);
                if (column) {
                    visible = [...visible].sort((a, b) => {
                        const cmp = this._compareEntityTableValues(a, b, column, state.sort.dir);
                        return cmp !== 0 ? cmp : rows.indexOf(a) - rows.indexOf(b);
                    });
                }
            }

            state.filteredRows = visible;
            renderRows();
        };

        const openMenuForColumn = (column, anchorBtn) => {
            closeMenu();
            const optionsList = [...new Set(rows.map((row) => this._getEntityTableFilterValue(row, column)))]
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            const current = state.filters.get(column.key);
            const selected = new Set(current instanceof Set ? current : optionsList);
            const kind = column.kind || 'text';
            const sortAscLabel = kind === 'numeric'
                ? 'Sort Smallest to Largest'
                : (kind === 'ordinal' || kind === 'date' ? 'Sort Lowest to Highest' : 'Sort A to Z');
            const sortDescLabel = kind === 'numeric'
                ? 'Sort Largest to Smallest'
                : (kind === 'ordinal' || kind === 'date' ? 'Sort Highest to Lowest' : 'Sort Z to A');

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
            state.activeMenu = menu;
            state.activeMenuBtn = anchorBtn;
            anchorBtn.classList.add('election-th-btn--open');

            const rect = anchorBtn.getBoundingClientRect();
            const menuWidth = 248;
            const margin = 8;
            const scrollX = window.scrollX || window.pageXOffset || 0;
            const scrollY = window.scrollY || window.pageYOffset || 0;
            const preferredLeft = scrollX + rect.right - menuWidth;
            const maxLeft = scrollX + window.innerWidth - menuWidth - margin;
            menu.style.left = `${Math.max(scrollX + margin, Math.min(preferredLeft, maxLeft))}px`;

            const menuHeight = menu.offsetHeight || 320;
            const belowTop = scrollY + rect.bottom + 4;
            const aboveTop = scrollY + rect.top - menuHeight - 4;
            const viewportBottom = scrollY + window.innerHeight - margin;
            const viewportTop = scrollY + margin;
            const fitsBelow = belowTop + menuHeight <= viewportBottom;
            const fitsAbove = aboveTop >= viewportTop;
            menu.style.top = `${(fitsBelow || !fitsAbove) ? belowTop : aboveTop}px`;

            const valuesHost = menu.querySelector('[data-role="values"]');
            const renderValues = (needle = '') => {
                const q = needle.trim().toLowerCase();
                valuesHost.innerHTML = '';
                optionsList
                    .filter((value) => !q || value.toLowerCase().includes(q))
                    .forEach((value) => {
                        const item = document.createElement('label');
                        item.className = 'election-filter-menu__value';
                        item.innerHTML = `<input type="checkbox" ${selected.has(value) ? 'checked' : ''}><span>${this.escapeHtml(value || '(Blank)')}</span>`;
                        const cb = item.querySelector('input');
                        cb.addEventListener('change', () => {
                            if (cb.checked) selected.add(value);
                            else selected.delete(value);
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
                    state.sort.key = column.key;
                    state.sort.dir = 'asc';
                    applyState();
                    closeMenu();
                } else if (action === 'sort-desc') {
                    state.sort.key = column.key;
                    state.sort.dir = 'desc';
                    applyState();
                    closeMenu();
                } else if (action === 'reset-sort') {
                    state.sort.key = null;
                    state.sort.dir = 'default';
                    applyState();
                    closeMenu();
                } else if (action === 'select-all') {
                    optionsList.forEach((value) => selected.add(value));
                    renderValues(search?.value || '');
                } else if (action === 'deselect-all') {
                    selected.clear();
                    renderValues(search?.value || '');
                } else if (action === 'clear-filter') {
                    state.filters.delete(column.key);
                    applyState();
                    closeMenu();
                } else if (action === 'apply') {
                    if (selected.size === 0 || selected.size === optionsList.length) state.filters.delete(column.key);
                    else state.filters.set(column.key, new Set(selected));
                    applyState();
                    closeMenu();
                }
            });

            state.documentClickHandler = (event) => {
                if (!state.activeMenu) return;
                if (state.activeMenu.contains(event.target)) return;
                if (state.activeMenuBtn && state.activeMenuBtn.contains(event.target)) return;
                closeMenu();
            };
            document.addEventListener('click', state.documentClickHandler);
        };

        headers.forEach((th, idx) => {
            const leafIndex = Number(th.dataset.leafColIdx);
            const column = columns[Number.isFinite(leafIndex) ? leafIndex : idx];
            if (!column) return;
            const leafLabel = th.dataset.leafLabel || column.label;
            th.innerHTML = '';
            const wrap = document.createElement('div');
            wrap.className = 'election-th-controls';
            const labelSpan = document.createElement('span');
            labelSpan.className = 'election-th-label';
            labelSpan.textContent = leafLabel;
            wrap.appendChild(labelSpan);

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
                if (state.activeMenu && state.activeMenuBtn === menuBtn) closeMenu();
                else openMenuForColumn(column, menuBtn);
            });
            actions.appendChild(menuBtn);
            wrap.appendChild(actions);
            th.appendChild(wrap);
        });

        applyState();
    }

    _formatEntityDelta(value, precision = 0, suffix = '') {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return '<span class="catalogue-detail__delta catalogue-detail__delta--neutral">-</span>';
        }
        const numeric = Number(value);
        if (numeric === 0) {
            return '<span class="catalogue-detail__delta catalogue-detail__delta--neutral">-</span>';
        }
        const cls = numeric > 0 ? 'catalogue-detail__delta--positive' : 'catalogue-detail__delta--negative';
        const magnitude = Math.abs(numeric).toLocaleString(undefined, {
            minimumFractionDigits: precision,
            maximumFractionDigits: precision
        });
        const sign = numeric > 0 ? '+' : '-';
        return `<span class="catalogue-detail__delta ${cls}">${sign}${magnitude}${suffix}</span>`;
    }

    _formatEntityRankDelta(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value)) || Number(value) === 0) {
            return '<span class="catalogue-detail__rank-delta catalogue-detail__rank-delta--neutral">-</span>';
        }
        const numeric = Number(value);
        const direction = numeric > 0 ? 'up' : 'down';
        const triangle = numeric > 0 ? '&#9650;' : '&#9660;';
        return `<span class="catalogue-detail__rank-delta catalogue-detail__rank-delta--${direction}">${triangle} ${Math.abs(numeric)}</span>`;
    }

    _renderConstituencyEntryList(entries = []) {
        if (!Array.isArray(entries) || entries.length === 0) return '—';
        return entries.map((entry) => {
            const showYear = entry.constituency && entry.constituency !== 'Northern Ireland' && entry.mapLayerYear;
            const label = `${entry.constituency || '—'}${showYear ? ` (${entry.mapLayerYear})` : ''}`;
            const link = `
                <a href="#"
                    class="catalogue-detail__entity-link catalogue-detail__entity-link--text catalogue-detail__entity-link--constituency"
                    data-election-constituency-feature="1"
                    data-election-constituency-level="dea"
                    data-election-constituency-body="${this.escapeHtml(entry.body || '')}"
                    data-election-constituency-date="${this.escapeHtml(entry.date || '')}"
                    data-election-constituency-name="${this.escapeHtml(entry.constituency || '')}">
                    ${this.escapeHtml(label)}
                </a>`;
            return entry.elected ? `<strong>${link}</strong>` : link;
        }).join(', ');
    }

    showElectionEntityDetailInCatalogue(detailOrId, addToHistory = true) {
        const detailId = typeof detailOrId === 'string'
            ? detailOrId
            : this.cacheElectionEntityDetailEntry(detailOrId);
        const entry = this._electionEntityDetailCache?.get(detailId);
        if (!entry || !detailId) return;
        const activeTabId = this._getActivePaneTabId();

        if (addToHistory) {
            const current = this.catalogueHistory[this.catalogueHistoryIndex];
            if (current?.type === 'election-entity-detail' && current.detailId === detailId) {
                this.updateCatalogueNavButtons();
                this.updateCatalogueHomeButton();
                return;
            }
            this._pushCatalogueTabHistoryIfNeeded(activeTabId);
            this._pushCatalogueHistoryEntry({ type: 'election-entity-detail', detailId });
        }

        if (activeTabId !== 'catalogue') {
            this.showTab('catalogue');
        }

        const detailView = document.getElementById('catalogueDetailView');
        const listView = document.getElementById('catalogueListView');
        const nav = document.getElementById('catalogueNav');
        if (!detailView || !listView || !nav) return;

        nav.classList.remove('hidden');
        listView.classList.add('hidden');
        detailView.classList.remove('hidden');
        this.catalogueView = 'detail';
        this.updateCatalogueNavButtons();
        this.updateCatalogueHomeButton();

        const fmt = (value) => this.formatNumber(Math.round(Number(value) || 0), 0);
        const pct = (value) => `${Number(value || 0).toFixed(2)}%`;
        const shortDate = (dateStr) => {
            const d = new Date(`${dateStr}T00:00:00`);
            if (Number.isNaN(d.getTime())) return String(dateStr || '');
            const day = String(d.getDate()).padStart(2, '0');
            const mon = d.toLocaleDateString('en-GB', { month: 'short' });
            const year = d.getFullYear();
            return `${day} ${mon} ${year}`;
        };
        const ord = (n) => {
            const num = Number(n || 0);
            if (!num) return '—';
            if (num % 10 === 1 && num % 100 !== 11) return `${num}st`;
            if (num % 10 === 2 && num % 100 !== 12) return `${num}nd`;
            if (num % 10 === 3 && num % 100 !== 13) return `${num}rd`;
            return `${num}th`;
        };
        const renderElectionLink = (row, label, includeConstituency = false) => `
            <a href="#"
                class="catalogue-detail__entity-link catalogue-detail__entity-link--text"
                data-election-body="${this.escapeHtml(row.electionBodyForOpen || row.body || '')}"
                data-election-date="${this.escapeHtml(row.date || '')}"
                ${includeConstituency && row.constituency ? `data-election-constituency="${this.escapeHtml(row.constituency)}"` : ''}>
                ${this.escapeHtml(label)}
            </a>
        `;
        const renderEntityLink = (kind, key, label) => `
            <a href="#"
                class="catalogue-detail__entity-link catalogue-detail__entity-link--text"
                data-election-entity-detail-kind="${this.escapeHtml(kind)}"
                data-election-entity-detail-key="${this.escapeHtml(key)}">
                ${this.escapeHtml(label)}
            </a>
        `;
        const renderLeadingParty = (row) => {
            if (!row?.winnerParty) return '—';
            const colour = this.escapeHtml(row.winnerColour || '#b0bec5');
            return `<span class="catalogue-detail__leading-party"><span class="catalogue-detail__leading-party-tab" style="background:${colour}"></span>${renderEntityLink('party', row.winnerParty, row.winnerParty)}</span>`;
        };
        const renderDeaList = (row) => {
            const deas = row?.districtElectoralAreas || [];
            if (!deas.length) return '—';
            const links = deas.map((dea) => renderEntityLink('dea', dea, dea)).join(', ');
            return `
                <details class="catalogue-detail__inline-list">
                    <summary class="catalogue-detail__inline-list-toggle">Show DEAs (${deas.length})</summary>
                    <div class="catalogue-detail__inline-list-body">${links}</div>
                </details>
            `;
        };
        const isCandidate = entry.kind === 'candidate';
        const isParty = entry.kind === 'party';
        const isArea = entry.kind === 'dea' || entry.kind === 'lgd';
        const title = isCandidate ? (entry.name || entry.personId) : entry.name;
        const subtitle = isCandidate
            ? `${entry.latestParty || (entry.parties || []).join(', ') || 'Independent'}`
            : (isArea ? (entry.subtitle || '') : (isParty ? 'Political Party' : ''));
        const eyebrow = isCandidate
            ? `Candidate | Person ID ${this.escapeHtml(entry.personId || '')}`
            : (isParty ? 'Political Party' : 'Electoral Geography');

        const metrics = isCandidate
            ? [
                ['Latest party', entry.latestParty || 'Independent'],
                ['1st prefs', fmt(entry.firstPrefs)],
                ['% of all valid votes', pct(entry.shareOfAllValid)],
                ['Election wins', fmt(entry.electedCount)],
                ['Elections contested', fmt((entry.appearances || []).length)],
                ['Constituencies', fmt((entry.constituencies || []).length)]
            ]
            : (isParty
                ? [
                    ['MPs', { value: fmt(entry.latestWestminster?.elected || 0), subtext: entry.latestWestminster?.date ? formatElectionDate(entry.latestWestminster.date) : '' }],
                    ['Last Westminster result', entry.latestWestminster ? pct(entry.latestWestminster.validVotePct) : 'N/A'],
                    ['Last Westminster votes', entry.latestWestminster ? fmt(entry.latestWestminster.firstPrefs) : 'N/A'],
                    ['MLAs', { value: fmt(entry.latestAssembly?.elected || 0), subtext: entry.latestAssembly?.date ? formatElectionDate(entry.latestAssembly.date) : '' }],
                    ['Last Assembly result', entry.latestAssembly ? pct(entry.latestAssembly.validVotePct) : 'N/A'],
                    ['Last Assembly 1st prefs', entry.latestAssembly ? fmt(entry.latestAssembly.firstPrefs) : 'N/A']
                ]
                : [
                    ['Elections', fmt(entry.metrics?.elections || 0)],
                    [entry.kind === 'dea' ? 'Districts' : 'DEAs', fmt(entry.kind === 'dea' ? (entry.metrics?.districts || 0) : (entry.metrics?.deas || 0))],
                    ['Total valid votes', fmt(entry.metrics?.totalValidVotes || 0)],
                    ['Total seats', fmt(entry.metrics?.totalSeats || 0)],
                    ['Latest election', entry.metrics?.latestDate ? this.escapeHtml(formatElectionDate(entry.metrics.latestDate)) : 'N/A'],
                    [entry.kind === 'dea' ? 'Area type' : 'Body type', this.escapeHtml(entry.subtitle || '')]
                ]);

        const metricsHtml = metrics.map(([label, value]) => `
            <div class="catalogue-detail__metric-card">
                <span class="catalogue-detail__metric-label">${this.escapeHtml(label)}</span>
                <strong class="catalogue-detail__metric-value">${typeof value === 'object'
                    ? `${this.escapeHtml(value.value || '')}${value.subtext ? `<span class="catalogue-detail__metric-subtext">${this.escapeHtml(value.subtext)}</span>` : ''}`
                    : this.escapeHtml(value)}</strong>
            </div>
        `).join('');

        const summaryRows = isCandidate
            ? [
                ['Person ID', entry.personId || ''],
                ['Name', entry.name || ''],
                ['Parties', (entry.parties || []).join(', ')],
                ['Dates', (entry.dates || []).join(', ')],
                ['Constituencies', this._renderConstituencyEntryList(entry.constituencyEntries || []), true]
            ]
            : [];

        const summaryHtml = summaryRows.map(([label, value, isHtml]) => `
            <div class="catalogue-detail__meta-row">
                <span class="catalogue-detail__meta-label">${this.escapeHtml(label)}</span>
                <span class="catalogue-detail__meta-value">${isHtml ? (value || '—') : this.escapeHtml(value || '—')}</span>
            </div>
        `).join('');
        const recallOr = (row, rendered) => row?.isRecallPetition ? '—' : rendered;

        const rankedCandidateSummaries = (entry.candidateSummaries || []).map((row, idx) => ({
            ...row,
            candidateRank: idx + 1
        }));

        const partyHistoryColumns = [
            { key: 'electionDisplayName', label: 'Election', kind: 'text', getValue: (row) => row.electionDisplayName, render: (row) => renderElectionLink(row, row.electionDisplayName, false) },
            { key: 'date', label: 'Date', kind: 'date', getValue: (row) => row.date, render: (row) => this.escapeHtml(shortDate(row.date || '')) },
            { key: 'electionType', label: 'Type', kind: 'text', getValue: (row) => row.electionType || '—', render: (row) => this.escapeHtml(row.electionType || '—') },
            { key: 'rank', label: '#', kind: 'ordinal', align: 'num', getValue: (row) => row.rank, render: (row) => recallOr(row, row.contested ? ord(row.rank) : '—') },
            { key: 'rankDelta', label: '+/-', kind: 'ordinal', align: 'num', getValue: (row) => row.rankDelta, render: (row) => recallOr(row, this._formatEntityRankDelta(row.rankDelta)) },
            { key: 'elected', label: 'Seats won', kind: 'numeric', align: 'num', getValue: (row) => row.elected, render: (row) => recallOr(row, row.contested ? fmt(row.elected) : '—') },
            { key: 'electedDelta', label: '+/-', kind: 'numeric', align: 'num', getValue: (row) => row.electedDelta, render: (row) => recallOr(row, this._formatEntityDelta(row.electedDelta)) },
            { key: 'seatPct', label: '% seats won', kind: 'numeric', align: 'num', getValue: (row) => row.seatPct, render: (row) => recallOr(row, row.contested ? pct(row.seatPct) : '—') },
            { key: 'seatPctDelta', label: '+/-', kind: 'numeric', align: 'num', getValue: (row) => row.seatPctDelta, render: (row) => recallOr(row, this._formatEntityDelta(row.seatPctDelta, 2, '%')) },
            { key: 'totalSeats', label: 'Total seats', kind: 'numeric', align: 'num', getValue: (row) => row.totalSeats, render: (row) => recallOr(row, fmt(row.totalSeats)) },
            { key: 'totalSeatsDelta', label: '+/-', kind: 'numeric', align: 'num', getValue: (row) => row.totalSeatsDelta, render: (row) => recallOr(row, row.isByElection ? '—' : this._formatEntityDelta(row.totalSeatsDelta)) },
            { key: 'stood', label: 'Candidates stood', kind: 'numeric', align: 'num', getValue: (row) => row.stood, filterValue: (row) => row.contested ? row.stood : 'N/A', render: (row) => recallOr(row, row.contested ? fmt(row.stood) : 'N/A') },
            { key: 'stoodDelta', label: '+/-', kind: 'numeric', align: 'num', getValue: (row) => row.stoodDelta, render: (row) => recallOr(row, this._formatEntityDelta(row.stoodDelta)) },
            { key: 'constituenciesContested', label: 'Constituencies', kind: 'numeric', align: 'num', getValue: (row) => row.constituenciesContested, render: (row) => recallOr(row, fmt(row.constituenciesContested)) },
            { key: 'constituenciesContestedDelta', label: '+/-', kind: 'numeric', align: 'num', getValue: (row) => row.constituenciesContestedDelta, render: (row) => recallOr(row, this._formatEntityDelta(row.constituenciesContestedDelta)) },
            { key: 'totalConstituencies', label: 'Total constituencies', kind: 'numeric', align: 'num', getValue: (row) => row.totalConstituencies, render: (row) => recallOr(row, fmt(row.totalConstituencies)) },
            { key: 'totalConstituenciesDelta', label: '+/-', kind: 'numeric', align: 'num', getValue: (row) => row.totalConstituenciesDelta, render: (row) => recallOr(row, row.isByElection ? '' : this._formatEntityDelta(row.totalConstituenciesDelta)) },
            { key: 'firstPrefs', label: '1st prefs', kind: 'numeric', align: 'num', getValue: (row) => row.firstPrefs, render: (row) => recallOr(row, row.contested ? fmt(row.firstPrefs) : '—') },
            { key: 'firstPrefsDelta', label: '+/-', kind: 'numeric', align: 'num', getValue: (row) => row.firstPrefsDelta, render: (row) => recallOr(row, this._formatEntityDelta(row.firstPrefsDelta)) },
            { key: 'validVotePct', label: '% 1st prefs', kind: 'numeric', align: 'num', getValue: (row) => row.validVotePct, render: (row) => recallOr(row, row.contested ? pct(row.validVotePct) : '—') },
            { key: 'validVotePctDelta', label: '+/-', kind: 'numeric', align: 'num', getValue: (row) => row.validVotePctDelta, render: (row) => recallOr(row, this._formatEntityDelta(row.validVotePctDelta, 2, '%')) }
        ];
        partyHistoryColumns.headerRows = [
            [
                { label: 'Election', leafIndex: 0, rowspan: 3 },
                { label: 'Date', leafIndex: 1, rowspan: 3 },
                { label: 'Type', leafIndex: 2, rowspan: 3 },
                { label: '#', rowspan: 2, colspan: 2 },
                { label: 'Seats', colspan: 6 },
                { label: 'Candidates', rowspan: 2, colspan: 2 },
                { label: 'Constituencies', colspan: 4 },
                { label: '1st preferences', colspan: 4 }
            ],
            [
                { label: 'Won', colspan: 4 },
                { label: 'Total', colspan: 2 },
                { label: 'Stood in', colspan: 2 },
                { label: 'Total', colspan: 2 },
                { label: 'No.', colspan: 2 },
                { label: '%', colspan: 2 }
            ],
            [
                { label: 'No.', leafIndex: 3, align: 'num' },
                { label: '+/-', leafIndex: 4, align: 'num' },
                { label: 'No.', leafIndex: 5, align: 'num' },
                { label: '+/-', leafIndex: 6, align: 'num' },
                { label: '%', leafIndex: 7, align: 'num' },
                { label: '+/-', leafIndex: 8, align: 'num' },
                { label: 'No.', leafIndex: 9, align: 'num' },
                { label: '+/-', leafIndex: 10, align: 'num' },
                { label: 'No.', leafIndex: 11, align: 'num' },
                { label: '+/-', leafIndex: 12, align: 'num' },
                { label: 'No.', leafIndex: 13, align: 'num' },
                { label: '+/-', leafIndex: 14, align: 'num' },
                { label: 'No.', leafIndex: 15, align: 'num' },
                { label: '+/-', leafIndex: 16, align: 'num' },
                { label: 'No.', leafIndex: 17, align: 'num' },
                { label: '+/-', leafIndex: 18, align: 'num' },
                { label: '%', leafIndex: 19, align: 'num' },
                { label: '+/-', leafIndex: 20, align: 'num' }
            ]
        ];

        const partyCandidateColumns = [
            { key: 'candidateRank', label: '#', kind: 'ordinal', align: 'num', getValue: (row) => row.candidateRank, render: (row) => fmt(row.candidateRank) },
            { key: 'name', label: 'Candidate', kind: 'text', getValue: (row) => row.name, render: (row) => renderEntityLink('candidate', row.personId, row.name) },
            { key: 'totalFirstPrefs', label: 'Total 1st prefs', kind: 'numeric', align: 'num', getValue: (row) => row.totalFirstPrefs, render: (row) => fmt(row.totalFirstPrefs) },
            { key: 'timesStood', label: 'Total', kind: 'numeric', align: 'num', getValue: (row) => row.timesStood, render: (row) => fmt(row.timesStood) },
            { key: 'timesStoodLocal', label: 'Local', kind: 'numeric', align: 'num', getValue: (row) => row.timesStoodLocal, render: (row) => fmt(row.timesStoodLocal) },
            { key: 'timesStoodDevolved', label: 'Devolved', kind: 'numeric', align: 'num', getValue: (row) => row.timesStoodDevolved, render: (row) => fmt(row.timesStoodDevolved) },
            { key: 'timesStoodWestminster', label: 'Westminster', kind: 'numeric', align: 'num', getValue: (row) => row.timesStoodWestminster, render: (row) => fmt(row.timesStoodWestminster) },
            { key: 'timesStoodEuropean', label: 'Europe', kind: 'numeric', align: 'num', getValue: (row) => row.timesStoodEuropean, render: (row) => fmt(row.timesStoodEuropean) },
            { key: 'timesElected', label: 'Total', kind: 'numeric', align: 'num', getValue: (row) => row.timesElected, render: (row) => fmt(row.timesElected) },
            { key: 'timesElectedLocal', label: 'Local', kind: 'numeric', align: 'num', getValue: (row) => row.timesElectedLocal, render: (row) => fmt(row.timesElectedLocal) },
            { key: 'timesElectedDevolved', label: 'Devolved', kind: 'numeric', align: 'num', getValue: (row) => row.timesElectedDevolved, render: (row) => fmt(row.timesElectedDevolved) },
            { key: 'timesElectedWestminster', label: 'Westminster', kind: 'numeric', align: 'num', getValue: (row) => row.timesElectedWestminster, render: (row) => fmt(row.timesElectedWestminster) },
            { key: 'timesElectedEuropean', label: 'Europe', kind: 'numeric', align: 'num', getValue: (row) => row.timesElectedEuropean, render: (row) => fmt(row.timesElectedEuropean) },
            {
                key: 'constituenciesLabel',
                label: 'Stood in',
                kind: 'text',
                getValue: (row) => (row.constituencyEntries || []).map((entry) => {
                    const showYear = entry.constituency && entry.constituency !== 'Northern Ireland' && entry.mapLayerYear;
                    return `${entry.constituency || ''}${showYear ? ` (${entry.mapLayerYear || ''})` : ''}`;
                }).join(', '),
                render: (row) => this._renderConstituencyEntryList(row.constituencyEntries || [])
            }
        ];
        partyCandidateColumns.headerRows = [
            [
                { label: '#', leafIndex: 0, rowspan: 2, align: 'num' },
                { label: 'Candidate', leafIndex: 1, rowspan: 2 },
                { label: 'Total 1st prefs', leafIndex: 2, rowspan: 2, align: 'num' },
                { label: 'Times stood', colspan: 5 },
                { label: 'Times elected', colspan: 5 },
                { label: 'Stood in', leafIndex: 13, rowspan: 2 }
            ],
            [
                { label: 'Total', leafIndex: 3, align: 'num' },
                { label: 'Local', leafIndex: 4, align: 'num' },
                { label: 'Devolved', leafIndex: 5, align: 'num' },
                { label: 'Westminster', leafIndex: 6, align: 'num' },
                { label: 'Europe', leafIndex: 7, align: 'num' },
                { label: 'Total', leafIndex: 8, align: 'num' },
                { label: 'Local', leafIndex: 9, align: 'num' },
                { label: 'Devolved', leafIndex: 10, align: 'num' },
                { label: 'Westminster', leafIndex: 11, align: 'num' },
                { label: 'Europe', leafIndex: 12, align: 'num' }
            ]
        ];

        const candidateHistoryColumns = [
            { key: 'electionDisplayName', label: 'Election', kind: 'text', getValue: (row) => row.electionDisplayName, render: (row) => renderElectionLink(row, row.electionDisplayName, true) },
            { key: 'date', label: 'Date', kind: 'date', getValue: (row) => row.date, render: (row) => this.escapeHtml(formatElectionDate(row.date || '')) },
            { key: 'electionType', label: 'Type', kind: 'text', getValue: (row) => row.electionType || '—', render: (row) => this.escapeHtml(row.electionType || '—') },
            {
                key: 'constituency',
                label: 'Constituency',
                kind: 'text',
                getValue: (row) => row.constituency,
                render: (row) => {
                    const label = row.constituency || '—';
                    if (!row.constituency || !row.body || !row.date) return this.escapeHtml(label);
                    return renderElectionConstituencyFeatureLink(
                        row.body,
                        row.date,
                        row.constituency,
                        row.constituency,
                        'election-cell-wrap',
                        row.electionType === 'Local' ? 'dea' : 'constituency'
                    );
                }
            },
            {
                key: 'bodyLabel',
                label: 'Elected body',
                kind: 'text',
                getValue: (row) => row.bodyLabel || row.body,
                render: (row) => {
                    const label = row.bodyLabel || row.body || '—';
                    if (row.electionType === 'Local' && label !== '—' && row.body && row.date) {
                        return renderElectionConstituencyFeatureLink(
                            row.body,
                            row.date,
                            label,
                            label,
                            'election-cell-wrap election-cell-wrap--full',
                            'council'
                        );
                    }
                    return `<span class="election-cell-wrap election-cell-wrap--full">${this.escapeHtml(label)}</span>`;
                }
            },
            { key: 'status', label: 'Status', kind: 'text', getValue: (row) => row.status, render: (row) => this.escapeHtml(row.status || '—') },
            { key: 'firstPref', label: 'Valid votes', kind: 'numeric', align: 'num', getValue: (row) => row.firstPref, render: (row) => fmt(row.firstPref) },
            { key: 'firstPrefPct', label: 'Valid vote %', kind: 'numeric', align: 'num', getValue: (row) => row.firstPrefPct, render: (row) => pct(row.firstPrefPct) },
            { key: 'overallStandingNumber', label: 'Overall standing', kind: 'ordinal', getValue: (row) => row.overallStandingNumber, render: (row) => `${ord(row.overallStandingNumber)} time standing` },
            { key: 'overallElectedNumber', label: 'Overall elected', kind: 'ordinal', getValue: (row) => row.overallElectedNumber, render: (row) => row.overallElectedNumber ? `${ord(row.overallElectedNumber)} time elected` : '—' },
            { key: 'bodyStandingNumber', label: 'Type standing', kind: 'ordinal', getValue: (row) => row.bodyStandingNumber, render: (row) => `${ord(row.bodyStandingNumber)} ${this.escapeHtml(row.electionType || 'unknown')} election` },
            { key: 'bodyElectedNumber', label: 'Type elected', kind: 'ordinal', getValue: (row) => row.bodyElectedNumber, render: (row) => row.bodyElectedNumber ? `${ord(row.bodyElectedNumber)} ${this.escapeHtml(row.electionType || 'unknown')} win` : '—' }
        ];

        const latestSummaryHtml = entry.kind === 'candidate' && entry.latestAppearance ? `
            <div class="catalogue-detail__section">
                <div class="catalogue-detail__section-title">Last Election Stood In</div>
                <div class="catalogue-detail__meta">
                    <div class="catalogue-detail__meta-row">
                        <span class="catalogue-detail__meta-label">Election</span>
                        <span class="catalogue-detail__meta-value">${renderElectionLink(entry.latestAppearance, entry.latestAppearance.electionDisplayName, true)}</span>
                    </div>
                    <div class="catalogue-detail__meta-row">
                        <span class="catalogue-detail__meta-label">Date</span>
                        <span class="catalogue-detail__meta-value">${this.escapeHtml(formatElectionDate(entry.latestAppearance.date || ''))}</span>
                    </div>
                    <div class="catalogue-detail__meta-row">
                        <span class="catalogue-detail__meta-label">Valid vote</span>
                        <span class="catalogue-detail__meta-value">${fmt(entry.latestAppearance.firstPref)}</span>
                    </div>
                    <div class="catalogue-detail__meta-row">
                        <span class="catalogue-detail__meta-label">Valid vote %</span>
                        <span class="catalogue-detail__meta-value">${pct(entry.latestAppearance.firstPrefPct)}</span>
                    </div>
                    <div class="catalogue-detail__meta-row">
                        <span class="catalogue-detail__meta-label">Constituency</span>
                        <span class="catalogue-detail__meta-value">${this.escapeHtml(entry.latestAppearance.constituency || '—')}</span>
                    </div>
                    <div class="catalogue-detail__meta-row">
                        <span class="catalogue-detail__meta-label">Elected body</span>
                        <span class="catalogue-detail__meta-value">${this.escapeHtml(entry.latestAppearance.bodyLabel || entry.latestAppearance.body || '—')}</span>
                    </div>
                    <div class="catalogue-detail__meta-row">
                        <span class="catalogue-detail__meta-label">Status</span>
                        <span class="catalogue-detail__meta-value">${this.escapeHtml(entry.latestAppearance.status || '—')}</span>
                    </div>
                </div>
            </div>
        ` : '';

        const areaHistoryColumns = entry.kind === 'dea'
            ? [
                { key: 'electionDisplayName', label: 'Election', kind: 'text', getValue: (row) => row.electionDisplayName, render: (row) => renderElectionLink(row, row.electionDisplayName, true) },
                { key: 'date', label: 'Date', kind: 'date', getValue: (row) => row.date, render: (row) => this.escapeHtml(formatElectionDate(row.date || '')) },
                { key: 'localGovernmentDistrict', label: 'Local Government District', kind: 'text', getValue: (row) => row.localGovernmentDistrict, render: (row) => renderEntityLink('lgd', row.localGovernmentDistrict, row.localGovernmentDistrict) },
                { key: 'winnerParty', label: 'Leading party', kind: 'text', getValue: (row) => row.winnerParty, render: (row) => renderLeadingParty(row) },
                { key: 'winnerVotes', label: 'Leading party votes', kind: 'numeric', align: 'num', getValue: (row) => row.winnerVotes, render: (row) => fmt(row.winnerVotes) },
                { key: 'winnerPct', label: 'Leading party %', kind: 'numeric', align: 'num', getValue: (row) => row.winnerPct, render: (row) => pct(row.winnerPct) },
                { key: 'validVotes', label: 'Valid votes', kind: 'numeric', align: 'num', getValue: (row) => row.validVotes, render: (row) => fmt(row.validVotes) },
                { key: 'seats', label: 'Seats', kind: 'numeric', align: 'num', getValue: (row) => row.seats, render: (row) => fmt(row.seats) }
            ]
            : [
                { key: 'electionDisplayName', label: 'Election', kind: 'text', getValue: (row) => row.electionDisplayName, render: (row) => renderElectionLink(row, row.electionDisplayName, false) },
                { key: 'date', label: 'Date', kind: 'date', getValue: (row) => row.date, render: (row) => this.escapeHtml(formatElectionDate(row.date || '')) },
                { key: 'deaCount', label: 'DEAs', kind: 'numeric', align: 'num', getValue: (row) => row.deaCount, render: (row) => fmt(row.deaCount) },
                { key: 'districtElectoralAreas', label: 'District Electoral Areas', kind: 'text', getValue: (row) => (row.districtElectoralAreas || []).join(', '), render: (row) => renderDeaList(row) },
                { key: 'winnerParty', label: 'Leading party', kind: 'text', getValue: (row) => row.winnerParty, render: (row) => renderLeadingParty(row) },
                { key: 'winnerVotes', label: 'Leading party votes', kind: 'numeric', align: 'num', getValue: (row) => row.winnerVotes, render: (row) => fmt(row.winnerVotes) },
                { key: 'winnerPct', label: 'Leading party %', kind: 'numeric', align: 'num', getValue: (row) => row.winnerPct, render: (row) => pct(row.winnerPct) },
                { key: 'validVotes', label: 'Valid votes', kind: 'numeric', align: 'num', getValue: (row) => row.validVotes, render: (row) => fmt(row.validVotes) },
                { key: 'seats', label: 'Seats', kind: 'numeric', align: 'num', getValue: (row) => row.seats, render: (row) => fmt(row.seats) }
            ];

        const historyHtml = isParty
            ? `
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Election History (${(entry.historyRows || []).length})</div>
                    ${this._buildEntityTableMarkup('catalogue-party-history-table', partyHistoryColumns)}
                </div>
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Candidates (${(entry.candidateSummaries || []).length})</div>
                    ${this._buildEntityTableMarkup('catalogue-party-candidates-table', partyCandidateColumns)}
                </div>
            `
            : (isCandidate
                ? `
                ${latestSummaryHtml}
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Election History (${(entry.appearances || []).length})</div>
                    ${this._buildEntityTableMarkup('catalogue-candidate-history-table', candidateHistoryColumns)}
                </div>
            `
                : `
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Election History (${(entry.historyRows || []).length})</div>
                    ${this._buildEntityTableMarkup(`catalogue-${this.escapeHtml(entry.kind)}-history-table`, areaHistoryColumns)}
                </div>
            `);

        detailView.innerHTML = `
            <div class="catalogue-detail__card">
                <div class="catalogue-detail__color" style="background-color: ${this.escapeHtml(entry.colour || '#888')}"></div>
                <div class="catalogue-detail__name">${this.escapeHtml(title)}</div>
                <div class="catalogue-detail__date">${this.escapeHtml(subtitle)}</div>
            </div>
            ${isParty ? '' : `<div class="catalogue-detail__description">${this.escapeHtml(eyebrow)}</div>`}
            <div class="catalogue-detail__metrics-grid">${metricsHtml}</div>
            ${isCandidate ? `<div class="catalogue-detail__meta">${summaryHtml}</div>` : ''}
            ${historyHtml}
        `;

        if (isParty) {
            this._initEntityDataTable(detailView, 'catalogue-party-history-table', partyHistoryColumns, entry.historyRows || [], {
                rowClassNameFn: (row) => row.isByElection ? 'catalogue-detail__entity-row--by-election' : ''
            });
            this._initEntityDataTable(detailView, 'catalogue-party-candidates-table', partyCandidateColumns, rankedCandidateSummaries);
        } else if (isCandidate) {
            this._initEntityDataTable(detailView, 'catalogue-candidate-history-table', candidateHistoryColumns, entry.appearances || [], {
                rowClassNameFn: (row) => row.isByElection ? 'catalogue-detail__entity-row--by-election' : ''
            });
        } else {
            this._initEntityDataTable(
                detailView,
                `catalogue-${entry.kind}-history-table`,
                areaHistoryColumns,
                entry.historyRows || [],
                {
                    rowClassNameFn: (row) => row.isByElection ? 'catalogue-detail__entity-row--by-election' : ''
                }
            );
        }

        if (detailView._entityDetailClickHandler) {
            detailView.removeEventListener('click', detailView._entityDetailClickHandler);
        }
        detailView._entityDetailClickHandler = async (event) => {
            const electionLink = event.target.closest('[data-election-body][data-election-date]');
            if (electionLink) {
                event.preventDefault();
                this.onElectionEntityElectionOpen?.({
                    body: electionLink.dataset.electionBody,
                    date: electionLink.dataset.electionDate,
                    constituency: electionLink.dataset.electionConstituency || null
                });
                return;
            }

            const constituencyLink = event.target.closest('[data-election-constituency-feature="1"]');
            if (constituencyLink) {
                event.preventDefault();
                await this.onOpenElectionConstituencyFeature?.({
                    body: constituencyLink.dataset.electionConstituencyBody,
                    date: constituencyLink.dataset.electionConstituencyDate,
                    constituency: constituencyLink.dataset.electionConstituencyName,
                    level: constituencyLink.dataset.electionConstituencyLevel || 'dea'
                });
                return;
            }

            const entityLink = event.target.closest('[data-election-entity-detail-kind][data-election-entity-detail-key]');
            if (!entityLink) return;
            event.preventDefault();
            if (typeof this.onOpenElectionEntityDetail === 'function') {
                await this.onOpenElectionEntityDetail(
                    entityLink.dataset.electionEntityDetailKind,
                    entityLink.dataset.electionEntityDetailKey
                );
                return;
            }
            const nextDetailId = this.createElectionEntityDetailId(
                entityLink.dataset.electionEntityDetailKind,
                entityLink.dataset.electionEntityDetailKey
            );
            this.showElectionEntityDetailInCatalogue(nextDetailId, true);
        };
        detailView.addEventListener('click', detailView._entityDetailClickHandler);

        const pane = this._cataloguePane || document.querySelector('.pane__content[data-tab-content="catalogue"]');
        pane?.scrollTo({ top: 0, behavior: 'auto' });
        this.updateCatalogueNavButtons();
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

    formatDisplayValue(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            if (Math.abs(value) >= 1000) {
                return value.toLocaleString('en-GB');
            }
            return String(value);
        }
        if (value === null || value === undefined) return '';
        return String(value);
    }

    isMapLoadedState(mapId, options = {}) {
        if (!mapId) return false;

        if (typeof this.onCheckMapLoaded === 'function') {
            try {
                return !!this.onCheckMapLoaded(mapId);
            } catch (err) {
                // Fall through to loadedIds fallback below.
            }
        }

        return !!options.loadedIds?.includes(mapId);
    }

    getLoadButtonIcon(isLoaded) {
        if (isLoaded) {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        }
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
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
            const featureRows = partial?.featureItems?.length
                ? (partial.featureItems || []).map((item) => `
                    <div class="active-layer-item__feature" data-map-id="${map.id}" data-feature-index="${item.index}">
                        <span class="active-layer-item__feature-name" title="${this.escapeHtml(item.name || `Feature ${item.index}`)}">${this.escapeHtml(item.name || `Feature ${item.index}`)}</span>
                        <div class="active-layer-item__feature-actions">
                            <button class="active-layer-item__feature-btn partial-visibility-btn" data-map-id="${map.id}" data-feature-index="${item.index}" title="${item.visible ? 'Hide feature' : 'Show feature'}">${item.visible ? 'Hide' : 'Show'}</button>
                            <button class="active-layer-item__feature-btn partial-unload-btn" data-map-id="${map.id}" data-feature-index="${item.index}" title="Unload feature">Unload</button>
                        </div>
                    </div>
                `).join('')
                : '';

            const isRaster = !!(map.files?.image && !map.files?.fgb);
            const layerState = mapController?.layerStates?.get(map.id);
            const curStrokeOp = Math.round((layerState?._strokeOpacity ?? 1) * 100);
            const curFillOp = Math.round((layerState?._fillOpacity ?? (map.style?.fillOpacity ?? 0)) * 100);
            const curRasterOp = Math.round((layerState?._rasterOpacity ?? (map.opacity ?? 0.8)) * 100);

            const opacityRows = isRaster ? `
                <div class="active-layer-item__opacity">
                    <label class="active-layer-item__opacity-label">Opacity</label>
                    <input type="range" class="active-layer-item__slider raster-opacity-slider" data-map-id="${map.id}" min="0" max="100" value="${curRasterOp}">
                    <div class="active-layer-item__opacity-val"><input type="number" class="active-layer-item__opacity-input raster-opacity-input" data-map-id="${map.id}" min="0" max="100" value="${curRasterOp}"><span>%</span></div>
                </div>` : `
                <div class="active-layer-item__opacity">
                    <label class="active-layer-item__opacity-label">Stroke</label>
                    <input type="range" class="active-layer-item__slider stroke-opacity-slider" data-map-id="${map.id}" min="0" max="100" value="${curStrokeOp}">
                    <div class="active-layer-item__opacity-val"><input type="number" class="active-layer-item__opacity-input stroke-opacity-input" data-map-id="${map.id}" min="0" max="100" value="${curStrokeOp}"><span>%</span></div>
                </div>
                <div class="active-layer-item__opacity">
                    <label class="active-layer-item__opacity-label">Fill</label>
                    <input type="range" class="active-layer-item__slider fill-opacity-slider" data-map-id="${map.id}" min="0" max="100" value="${curFillOp}">
                    <div class="active-layer-item__opacity-val"><input type="number" class="active-layer-item__opacity-input fill-opacity-input" data-map-id="${map.id}" min="0" max="100" value="${curFillOp}"><span>%</span></div>
                </div>`;
            const opacityControls = `<div class="active-layer-item__opacity-panel" data-map-id="${map.id}" style="display:none;">${opacityRows}</div>`;

            return `
                <div class="active-layer-item ${isVisible ? '' : 'active-layer-item--hidden'}${partial?.isPartial ? ' active-layer-item--partial' : ''}" data-map-id="${map.id}">
                    <div class="active-layer-item__color" style="background: ${color}"></div>
                    <div class="active-layer-item__info">
                        <span class="active-layer-item__name">${this.escapeHtml(map.name)}</span>
                        <span class="active-layer-item__meta">
                            ${authors}${authors && date ? ' · ' : ''}${date ? `<em>${date}</em>` : ''}
                            ${partial?.featureItems?.length ? `<span class="active-layer-item__partial-badge">${partial.featureNames?.length || partial.featureItems.length || 1} feature${(partial.featureNames?.length || partial.featureItems.length || 1) > 1 ? 's' : ''}</span>` : ''}
                        </span>
                        ${partial?.featureItems?.length ? `<div class="active-layer-item__feature-list">${featureRows}</div>` : ''}
                    </div>
                    <div class="active-layer-item__actions">
                        <button class="active-layer-item__btn opacity-toggle-btn" data-map-id="${map.id}" title="Transparency">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity="0.3"/><circle cx="12" cy="12" r="6"/></svg>
                        </button>
                        <button class="active-layer-item__btn visibility-btn" data-map-id="${map.id}" title="${isVisible ? 'Hide' : 'Show'}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        ${partial?.isPartial ? `<button class="active-layer-item__btn expand-btn" data-map-id="${map.id}" title="Load full map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>` : ''}
                        <button class="active-layer-item__btn remove-btn" data-map-id="${map.id}" title="Remove">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                    ${opacityControls}
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

        container.querySelectorAll('.partial-visibility-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mapId = btn.dataset.mapId;
                const rawFeatureIndex = btn.dataset.featureIndex;
                const numericFeatureIndex = Number(rawFeatureIndex);
                const featureIndex = Number.isFinite(numericFeatureIndex) && rawFeatureIndex !== '' ? numericFeatureIndex : rawFeatureIndex;
                if (this.onPartialFeatureToggle && featureIndex !== undefined && featureIndex !== null && featureIndex !== '') {
                    this.onPartialFeatureToggle(mapId, featureIndex);
                }
            });
        });

        container.querySelectorAll('.partial-unload-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mapId = btn.dataset.mapId;
                const rawFeatureIndex = btn.dataset.featureIndex;
                const numericFeatureIndex = Number(rawFeatureIndex);
                const featureIndex = Number.isFinite(numericFeatureIndex) && rawFeatureIndex !== '' ? numericFeatureIndex : rawFeatureIndex;
                if (this.onPartialFeatureUnload && featureIndex !== undefined && featureIndex !== null && featureIndex !== '') {
                    this.onPartialFeatureUnload(mapId, featureIndex);
                }
            });
        });

        // Opacity panel toggle
        container.querySelectorAll('.opacity-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mapId = btn.dataset.mapId;
                const panel = container.querySelector(`.active-layer-item__opacity-panel[data-map-id="${mapId}"]`);
                if (panel) {
                    const showing = panel.style.display !== 'none';
                    panel.style.display = showing ? 'none' : 'block';
                    btn.classList.toggle('active', !showing);
                }
            });
        });

        // Opacity sliders and inputs
        const syncOpacity = (mapId, type, value) => {
            value = Math.max(0, Math.min(100, parseInt(value) || 0));
            const frac = value / 100;
            const state = mapController?.layerStates?.get(mapId);
            if (!state) return;

            if (type === 'raster') {
                state._rasterOpacity = frac;
                state.group?.eachLayer(layer => {
                    if (layer.setOpacity) layer.setOpacity(frac);
                });
            } else if (type === 'stroke') {
                state._strokeOpacity = frac;
                state.geoJsonLayers?.forEach(l => l.setStyle({ opacity: frac }));
            } else if (type === 'fill') {
                state._fillOpacity = frac;
                state.geoJsonLayers?.forEach(l => l.setStyle({ fillOpacity: frac }));
            }

            // Sync slider <-> input
            const item = container.querySelector(`.active-layer-item[data-map-id="${mapId}"]`);
            if (item) {
                const slider = item.querySelector(`.${type}-opacity-slider`);
                const input = item.querySelector(`.${type}-opacity-input`);
                if (slider) slider.value = value;
                if (input) input.value = value;
            }
        };

        ['raster', 'stroke', 'fill'].forEach(type => {
            container.querySelectorAll(`.${type}-opacity-slider`).forEach(slider => {
                slider.addEventListener('input', () => syncOpacity(slider.dataset.mapId, type, slider.value));
            });
            container.querySelectorAll(`.${type}-opacity-input`).forEach(input => {
                input.addEventListener('change', () => syncOpacity(input.dataset.mapId, type, input.value));
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
                Showing ${this.formatDisplayValue(start + 1)}-${this.formatDisplayValue(Math.min(start + pageSize, filteredData.length))} of ${this.formatDisplayValue(filteredData.length)} features
                ${allColumns && allColumns.length > 3 ? ` &middot; ${this.formatDisplayValue(columns.length)} of ${this.formatDisplayValue(allColumns.length)} columns` : ''}
            </div>
            <div class="tables-wrapper tables-wrapper--scrollable">
                <table class="data-table data-table--scrollable">
                    <thead>
                        <tr>
                            ${columns.map(col => `
                                <th class="data-table__header" data-sort-key="${col}">
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
                                    <td class="data-table__cell"><span class="data-table__text">${this.escapeHtml(this.formatDisplayValue(row[col]))}</span></td>
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
                    <button class="btn btn--sm tables-pagination__btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>&larr; Prev</button>
                    <span class="tables-pagination__info">Page ${currentPage} of ${totalPages}</span>
                    <button class="btn btn--sm tables-pagination__btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>Next &rarr;</button>
                </div>
            `;
        }

        container.innerHTML = html;

        // Apply Excel-like sort/filter controls to feature attribute tables.
        const dataTable = container.querySelector('.data-table');
        if (dataTable && this.onSetupElectionTableControls) {
            this.onSetupElectionTableControls(dataTable);
        }

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
                if (!item) return;
                const type = item.dataset.type;
                if (type === 'feature') {
                    const bbox = (item.dataset.bbox || '').split(',').map(Number).filter(n => Number.isFinite(n));
                    const mapId = item.dataset.mapId;
                    const featureId = item.dataset.featureId;
                    const featureName = item.dataset.featureName || featureId || '';
                    if (bbox.length === 4) {
                        this.zoomToFeature(bbox, mapId, featureId, featureName);
                    }
                } else if (type === 'address') {
                    const lat = parseFloat(item.dataset.lat);
                    const lon = parseFloat(item.dataset.lon);
                    const name = item.dataset.name || '';
                    if (Number.isFinite(lat) && Number.isFinite(lon)) {
                        this.handleAddressSelection(lat, lon, name);
                    }
                } else {
                    const id = item.dataset.id;
                    this.handleSearchSelection(type, id);
                }
                this.hideAutocomplete();
                searchInput.value = '';
                if (searchClear) searchClear.classList.remove('visible');
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
                e.preventDefault();
                // 1. Arrow-key selected an item — commit it
                const selected = autocomplete?.querySelector('.search-autocomplete__item--selected');
                if (selected) {
                    selected.click();
                    return;
                }
                // 2. Dropdown already has results — commit the top (most relevant) one
                const firstItem = autocomplete?.querySelector('.search-autocomplete__item');
                if (firstItem) {
                    firstItem.click();
                    return;
                }
                // 3. No results yet (debounce hasn't fired) — force an immediate search
                //    and then commit the top result
                const query = searchInput.value.trim();
                if (query.length >= 2) {
                    clearTimeout(debounceTimer);
                    Promise.resolve(this.performSearch(query)).then(() => {
                        const first = autocomplete?.querySelector('.search-autocomplete__item');
                        if (first) first.click();
                    });
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

    async performSearch(query) {
        if (!this.fuse) {
            this.initializeFuse();
            if (!this.fuse) return;
        }

        const shouldLookupAddresses = query.length >= 3;
        const [results, featureResults, addressResults] = await Promise.all([
            Promise.resolve(this.fuse.search(query, { limit: 8 })),
            this.searchFeatures(query).catch(() => []),
            shouldLookupAddresses
                ? this.searchAddressSuggestions(query, 5).catch(() => [])
                : Promise.resolve([])
        ]);
        this.renderCombinedAutocomplete(results, featureResults, addressResults, query);

        // Notify app for filtering
        if (this.onSearch) this.onSearch(query);
    }

    renderCombinedAutocomplete(results, featureResults, addressResults, query) {
        const autocomplete = document.getElementById('searchAutocomplete');
        if (!autocomplete) return;

        const sections = [];
        if (featureResults.length > 0) {
            const featureHtml = featureResults.slice(0, 6).map(result => {
                const data = dataService.getData();
                const mapConfig = data?.maps?.find(m => m.id === result.mapId);
                const mapName = mapConfig?.name || result.mapId;
                return `<div class="search-autocomplete__item search-autocomplete__item--feature"
                         data-type="feature"
                         data-feature-id="${this.escapeHtml(String(result.id))}"
                         data-feature-name="${this.escapeHtml(String(result.name || ''))}"
                         data-map-id="${this.escapeHtml(String(result.mapId || ''))}"
                         data-bbox="${(result.bbox || []).join(',')}">
                    <span class="search-autocomplete__icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
                        </svg>
                    </span>
                    <div class="search-autocomplete__content">
                        <span class="search-autocomplete__name">${this.highlightText(result.name, query)}</span>
                        <span class="search-autocomplete__meta">${this.escapeHtml(mapName)}</span>
                    </div>
                </div>`;
            }).join('');
            sections.push(`<div class="search-autocomplete__section-header">Features</div>${featureHtml}`);
        }

        if (results.length > 0) {
            const mapHtml = results.map(result => {
                const item = result.item;
                const highlightedName = this.highlightMatches(item.name, result.matches);
                return `<div class="search-autocomplete__item" data-type="${item.type}" data-id="${item.id}">
                    <span class="search-autocomplete__icon" aria-hidden="true">${this.getSearchTypeIconSvg(item.type)}</span>
                    <div class="search-autocomplete__content">
                        <span class="search-autocomplete__name">${highlightedName}</span>
                        ${item.category ? `<span class="search-autocomplete__meta">${item.category}</span>` : ''}
                    </div>
                </div>`;
            }).join('');
            sections.push(`<div class="search-autocomplete__section-header">Maps</div>${mapHtml}`);
        }

        if (addressResults.length > 0) {
            const addressHtml = addressResults.map(result => {
                const displayName = this.buildAddressDisplayName(result);
                const placeType = (result.type || '').replace(/_/g, ' ');
                return `<div class="search-autocomplete__item search-autocomplete__item--address"
                         data-type="address"
                         data-lat="${result.lat}"
                         data-lon="${result.lon}"
                         data-name="${this.escapeHtml(displayName)}">
                    <span class="search-autocomplete__icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                        </svg>
                    </span>
                    <div class="search-autocomplete__content">
                        <span class="search-autocomplete__name">${this.highlightText(displayName, query)}</span>
                        ${placeType ? `<span class="search-autocomplete__meta">${this.escapeHtml(placeType)}</span>` : ''}
                    </div>
                </div>`;
            }).join('');
            sections.push(`<div class="search-autocomplete__section-header">Places</div>${addressHtml}`);
        }

        if (sections.length === 0) {
            autocomplete.innerHTML = '<div class="search-autocomplete__empty">No maps, features, or places found</div>';
            autocomplete.classList.remove('hidden');
            return;
        }
        autocomplete.innerHTML = sections.join('');
        autocomplete.classList.remove('hidden');
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
            const highlightedName = this.highlightMatches(item.name, result.matches);

            return `<div class="search-autocomplete__item" data-type="${item.type}" data-id="${item.id}">
                <span class="search-autocomplete__icon">${this.getSearchTypeIconSvg(item.type)}</span>
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
                <span class="search-autocomplete__icon">&#128269;</span>
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
                <h4>&#128269; ${this.escapeHtml(name)}</h4>
                <button class="address-results__close" title="Close">&times;</button>
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
            return cat ? `[cat] ${cat.name}` : id;
        } else if (type === 'class') {
            const cls = (data.classes || []).find(c => c.id === id);
            return cls ? `[class] ${cls.name}` : id;
        } else if (type === 'map') {
            const map = (data.maps || []).find(m => m.id === id);
            return map ? `[map] ${map.name}` : id;
        } else if (type === 'book') {
            const book = (data.books || []).find(b => b.id === id);
            return book ? `[book] ${book.title || book.name}` : id;
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
        html += '<div class="explore-section"><h3 class="explore-section__title">Categories</h3>';
        (categories || []).forEach(cat => {
            const mapCount = (maps || []).filter(m => m.category === cat.id).length;
            html += `<div class="explore-item explore-item--category" data-type="category" data-id="${cat.id}">
                <span class="explore-item__icon">${cat.icon || '[cat]'}</span>
                <span class="explore-item__name">${this.escapeHtml(cat.name)}</span>
                <span class="explore-item__count">${mapCount}</span>
            </div>`;
        });
        html += '</div>';

        // Classes section
        html += '<div class="explore-section"><h3 class="explore-section__title">Classes</h3>';
        (classes || []).slice(0, 10).forEach(cls => {
            html += `<div class="explore-item explore-item--class" data-type="class" data-id="${cls.id}">
                <span class="explore-item__icon">[class]</span>
                <span class="explore-item__name">${this.escapeHtml(cls.name)}</span>
                <span class="explore-item__count">${(cls.maps || []).length}</span>
            </div>`;
        });
        if ((classes || []).length > 10) {
            html += `<div class="explore-item explore-item--more">...and ${classes.length - 10} more classes</div>`;
        }
        html += '</div>';

        // Recent maps
        html += '<div class="explore-section"><h3 class="explore-section__title">Featured Maps</h3>';
        (maps || []).filter(m => m.featured).slice(0, 8).forEach(map => {
            html += `<div class="explore-item explore-item--map" data-type="map" data-id="${map.id}">
                <span class="explore-item__color" style="background: ${map.style?.color || '#888'}"></span>
                <span class="explore-item__name">${this.escapeHtml(map.name)}</span>
            </div>`;
        });
        html += '</div>';

        // Books section
        if ((books || []).length > 0) {
            html += '<div class="explore-section"><h3 class="explore-section__title">Books</h3>';
            books.slice(0, 5).forEach(book => {
                html += `<div class="explore-item explore-item--book" data-type="book" data-id="${book.id}">
                    <span class="explore-item__icon">[book]</span>
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
                    <span class="explore-detail__icon">${cat.icon || '[cat]'}</span>
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
                    <span class="explore-detail__icon">[class]</span>
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
                const mapLoaded = this.getMapIdsFromURL().includes(map.id);
                html += `<div class="explore-detail__actions">
                    <button class="btn btn--primary btn--lg" data-explore-map-toggle="${map.id}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${mapLoaded ? '<path d="M18 6L6 18M6 6l12 12"/>' : '<polygon points="5 3 19 12 5 21 5 3"/>'}
                        </svg>
                        ${mapLoaded ? 'Unload Map' : 'Load Map'}
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
                    <span class="explore-detail__icon">[book]</span>
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
        const exploreMapToggle = container.querySelector('[data-explore-map-toggle]');
        if (exploreMapToggle) {
            exploreMapToggle.addEventListener('click', async () => {
                const mapId = exploreMapToggle.getAttribute('data-explore-map-toggle');
                const loadedIds = this.getMapIdsFromURL();
                if (loadedIds.includes(mapId)) {
                    if (this.onMapUnload) this.onMapUnload(mapId);
                    this.showEntityInfoWithoutHistory('map', mapId);
                    return;
                }
                if (this.onMapLoad) await this.onMapLoad(mapId);
                this.showEntityInfoWithoutHistory('map', mapId);
            });
        }
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
                results.push({ type: 'category', item: cat, name: cat.name, icon: cat.icon || '[cat]' });
            }
        });

        // Search classes
        (data.classes || []).forEach(cls => {
            if (cls.name.toLowerCase().includes(q) || cls.id.includes(q)) {
                results.push({ type: 'class', item: cls, name: cls.name, icon: '[class]' });
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
                results.push({ type: 'book', item: book, name: book.title || book.name, icon: '[book]' });
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

    // Variants expansion — track expanded state so it persists across re-renders
    _expandedVariants = new Set();

    toggleVariants(mapId, parentElement) {
        const variantContainer = parentElement.querySelector(`.variants-container[data-parent-id="${mapId}"]`);
        if (variantContainer) {
            const expanding = !variantContainer.classList.contains('variants-container--expanded');
            variantContainer.classList.toggle('variants-container--expanded', expanding);
            const btn = parentElement.querySelector(`.variants-toggle[data-map-id="${mapId}"]`);
            if (btn) btn.classList.toggle('active', expanding);
            if (expanding) this._expandedVariants.add(mapId);
            else this._expandedVariants.delete(mapId);
        }
    }

    restoreExpandedVariants() {
        for (const mapId of this._expandedVariants) {
            const container = document.querySelector(`.variants-container[data-parent-id="${mapId}"]`);
            if (container) {
                container.classList.add('variants-container--expanded');
                const btn = document.querySelector(`.variants-toggle[data-map-id="${mapId}"]`);
                if (btn) btn.classList.add('active');
            }
        }
    }

    renderVariantsDropdown(map, isLoaded) {
        if (!map.variants || map.variants.length === 0) return '';

        let html = `<div class="variants-container" data-parent-id="${map.id}">`;
        map.variants.forEach(variant => {
            const variantLoaded = this.isMapLoadedState(variant.id, {});
            const description = variant.description || '';
            const hasFgb = !!(variant.files?.fgb || variant.files?.image);
            html += `<div class="variant-item ${variantLoaded ? 'variant-item--loaded' : ''}" data-map-id="${variant.id}">
                <div class="variant-item__thumb">
                    <img src="assets/thumbnails/${this.escapeHtml(variant.id)}.png" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
                    <div class="variant-item__preview">
                        <img src="assets/thumbnails/${this.escapeHtml(variant.id)}.png" alt="">
                    </div>
                </div>
                <div class="variant-item__info">
                    <div class="variant-item__name">${this.escapeHtml(variant.label || variant.id)}</div>
                    ${description ? `<div class="variant-item__description">${this.escapeHtml(description)}</div>` : ''}
                </div>
                <div class="variant-item__actions">
                    ${hasFgb ? `<button class="btn btn--icon btn--xs visibility-btn" data-map-id="${variant.id}" title="${variantLoaded ? 'Hide' : 'Show'}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>` : ''}
                    ${hasFgb ? `<button class="btn btn--icon btn--xs load-btn" data-map-id="${variant.id}" title="${variantLoaded ? 'Unload' : 'Load'}">${this.getLoadButtonIcon(variantLoaded)}</button>` : ''}
                    <button class="btn btn--icon btn--xs copy-url-btn" data-map-id="${variant.id}" title="Copy shareable URL">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    </button>
                    <button class="btn btn--icon btn--xs download-fgb-btn" data-map-id="${variant.id}" title="Download FGB">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <div class="overflow-menu">
                        <button class="overflow-menu__trigger" title="More actions"></button>
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
                            ${variant.files?.geojson ? `<a href="${variant.files.geojson}" class="overflow-menu__item" download>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                Download Original
                            </a>` : ''}
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
        // Delegate to featureLoader — avoids duplicating the 15 MB fetch
        await featureLoader.ensureInitialized();
        return { features: featureLoader.spatialIndex || [] };
    }

    async searchAddressSuggestions(query, limit = 5) {
        if (!query || query.trim().length < 3) return [];

        if (this._searchAddressAbortController) {
            this._searchAddressAbortController.abort();
        }
        this._searchAddressAbortController = new AbortController();

        const encoded = encodeURIComponent(query.trim());
        const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=${limit}&countrycodes=gb,ie`;
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: this._searchAddressAbortController.signal
        });
        if (!response.ok) throw new Error(`Address lookup failed (${response.status})`);
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    }

    buildAddressDisplayName(place) {
        if (!place) return '';
        const addr = place.address || {};
        const parts = [];
        if (addr.house_number && addr.road) parts.push(`${addr.house_number} ${addr.road}`);
        else if (addr.road) parts.push(addr.road);
        else if (addr.name) parts.push(addr.name);
        if (addr.suburb) parts.push(addr.suburb);
        else if (addr.neighbourhood) parts.push(addr.neighbourhood);
        if (addr.city) parts.push(addr.city);
        else if (addr.town) parts.push(addr.town);
        else if (addr.village) parts.push(addr.village);
        if (addr.county) parts.push(addr.county);
        if (parts.length > 0) return parts.join(', ');
        return place.display_name || '';
    }

    getSearchTypeIconSvg(type) {
        if (type === 'map') {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"></path>
                <path d="M8 2v16"></path>
                <path d="M16 6v16"></path>
            </svg>`;
        }
        if (type === 'class') {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
            </svg>`;
        }
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7h18"></path>
            <path d="M3 12h18"></path>
            <path d="M3 17h18"></path>
        </svg>`;
    }

    async searchFeatures(query) {
        if (!query || query.length < 2) return [];

        // Try edge API first (Cloudflare Pages Function)
        const apiResults = await featureLoader.searchViaAPI(query, 25);
        if (apiResults) return apiResults;

        // Fallback: client-side search
        await featureLoader.ensureInitialized();
        if (featureLoader.useChunkedIndex) {
            await featureLoader._ensureFullIndex();
        }

        const searchTerm = query.toLowerCase().trim();
        const results = [];
        const maxResults = 25;

        for (const feature of (featureLoader.spatialIndex || [])) {
            if (results.length >= maxResults) break;

            const name = (feature.name || '').toLowerCase();

            if (name.includes(searchTerm)) {
                results.push({
                    id: feature.id,
                    name: feature.name,
                    mapId: feature.mapId,
                    bbox: feature.bbox,
                    centroid: feature.centroid,
                    score: name.startsWith(searchTerm) ? 2 : 1
                });
            }
        }

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
                <span class="search-autocomplete__icon">&#128269;</span>
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

    zoomToFeature(bbox, mapId, featureId, featureName = null) {
        // Load only the selected feature when supported, otherwise fallback to full layer load.
        if (mapId && featureId && this.onLoadSingleFeature) {
            this.onLoadSingleFeature(mapId, featureId, featureName, bbox);
        } else if (mapId && this.onMapLoad) {
            const loadedIds = this.getMapIdsFromURL();
            if (!loadedIds.includes(mapId)) this.onMapLoad(mapId);
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

        this.announce(`Zooming to ${featureName || featureId}`);
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
        const results = [];
        const [southWest, northEast] = bounds;

        for (const mapId of loadedMapIds) {
            // Use featureLoader's per-map data (loaded by loadMapIndex in app.js loadMap)
            const mapFeatures = featureLoader.spatialIndexByMap.get(mapId) || [];

            for (const feature of mapFeatures) {
                if (!feature.centroid) continue;

                const [lon, lat] = feature.centroid;

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

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Thumbnail hover preview ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
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
        if (!e.target || !e.target.closest) return;
        const zone = e.target.closest(ZONE_SELECTOR);
        if (!zone) return;
        const img = zone.querySelector('img');
        if (!img || img.style.display === 'none') return;
        previewImg.src = img.src;
        preview.style.display = 'block';
    }, true);

    document.addEventListener('mouseleave', (e) => {
        if (!e.target || !e.target.closest) return;
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


