/**
 * Election Controller
 * Integrates the election-viewer-package with the boundaries website.
 * Handles catalogue integration, FGB geography loading, map colouring,
 * split pane results, and seat circle / vote bar overlays.
 */

import mapController from './map-controller.js';
import timeSliderController from './time-slider-controller.js';
import { formatElectionDate, shortBodyName, escapeHtml, renderElectionConstituencyFeatureLink } from './election-utils.js';

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
        this.onOpenEntityDetail = null;
        this.onOpenElectionConstituencyFeature = null;
        this._registeredLayerId = null; // synthetic layer ID in mapController
        this.electionMapConfig = null;  // synthetic map config for active layers
        this._currentResultsView = null;
        this._entityDetailReturnView = null;
        this._entityIndexCache = null;
        this._globalEntityIndex = null;
        this._globalEntityIndexPromise = null;
        this._specialElection = null;
        this.bodyGroup = null;
        this._indexBodyData = null;
        this._allBodyDates = [];
        this._currentGeo = null;
        this._localResultsMode = 'dea';
        this._councilNameByConstituency = new Map();
        this._constituencyAliases = new Map();
        this._councilAliases = new Map();
        this._councilAggregates = null;
        this._previousCouncilAggregates = null;
        this._boundPaneClickHandler = null;
        this._suppressedNonElectionLayerIds = new Set();
        this.onStartLoadFeedback = null;
        this.onFinishLoadFeedback = null;
        this._geometryFeatureCache = new Map();
        this._geometryFeaturePromiseCache = new Map();
        this._resultsPayloadCache = new Map();
        this._resultsPayloadPromiseCache = new Map();
        this._localBundleCache = new Map();
        this._localAggregatesCache = new Map();
        this._loadRequestSerial = 0;
        this._activeLoadRequestId = 0;
        this._previousResultsPromise = null;
        this._currentLodLevel = 2;
        this._currentLodBaseFgb = null;
    }

    static LOCAL_GOVERNMENT_BODIES = [
        'Antrim and Newtownabbey',
        'Ards and North Down',
        'Armagh, Banbridge and Craigavon',
        'Belfast',
        'Causeway Coast and Glens',
        'Derry City and Strabane',
        'Fermanagh and Omagh',
        'Lisburn and Castlereagh',
        'Mid and East Antrim',
        'Mid Ulster',
        'Newry, Mourne and Down'
    ];

    static LOCAL_GOVERNMENT_PLACEHOLDER_ELECTIONS = [
        { date: '2011-05-05', subtitle: '26 councils' },
        { date: '2005-05-05', subtitle: '26 councils' },
        { date: '2001-06-07', subtitle: '26 councils' },
        { date: '1997-05-21', subtitle: '26 councils' },
        { date: '1993-05-19', subtitle: '26 councils' },
        { date: '1989-05-17', subtitle: '26 councils' },
        { date: '1985-05-15', subtitle: '26 councils' },
        { date: '1981-05-20', subtitle: '26 councils' },
        { date: '1977-05-18', subtitle: '26 councils' },
        { date: '1973-05-30', subtitle: '26 councils' }
    ];

    /**
     * Geography Mapping Table
     * Maps body + date range to FGB file and name attribute.
     * Order matters â€” first match wins.
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

        // European Parliament (single NI constituency â€” no useful map, but use PC2008 boundary for fill)
        { body: 'European Parliament', dateFrom: '1979-01-01', fgb: 'data/maps/parliamentary/PC2008.fgb', nameAttr: 'PC_NAME', singleConstituency: true },
        ...ElectionController.LOCAL_GOVERNMENT_BODIES.map((body) => ({
            body,
            dateFrom: '2014-01-01',
            fgb: 'data/maps/local-government/DEAs_2012.fgb',
            nameAttr: 'FinalR_DEA',
            councilFgb: 'data/maps/local-government/LGD_2012.fgb',
            councilNameAttr: 'LGDNAME'
        })),
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
        const requestId = ++this._loadRequestSerial;
        this._activeLoadRequestId = requestId;
        const preserveElectionTimeline = !!this.active;

        // Clear any previous
        this.clear({ preserveElectionTimeline });

        // Get the election index to find constituencies
        const indexData = await this._loadIndex();
        const bodyData = indexData.bodies.find(b => b.name === body);
        if (!bodyData) return;
        const dateData = bodyData.dates.find(d => d.date === date);
        if (!dateData) return;

        const geo = ElectionController.getGeography(body, date);
        if (!geo) {
            console.error('[Election] No geography found for', body, date);
            return;
        }

        const loadName = this._isLocalGovernmentBody(body)
            ? this._localElectionTitle(date)
            : `${this._shortBodyName(body)} ${this._formatDate(date)}`;
        const feedback = this.onStartLoadFeedback ? this.onStartLoadFeedback(loadName) : null;

        try {
            this.body = body;
            this.date = date;
            this.active = true;
            this.bodyGroup = bodyData.bodyGroup || null;
            this._indexBodyData = bodyData;
            this._localResultsMode = 'dea';
            this._currentGeo = geo;

            const groupData = this._getEffectiveElectionScope(indexData, bodyData, date);
            this.constituencies = groupData.constituencies;
            this._allBodyDates = groupData.dates;
            this._councilNameByConstituency = groupData.councilNameByConstituency;
            this._specialElection = this._getSpecialElectionConfig(body, date);
            const previousDateData = this._getPreviousDateData(indexData, bodyData, date, groupData);
            this.previousDate = previousDateData?.date || null;

            const activeGeo = this._getActiveGeography(geo);
            const loadSlug = bodyData.slug || body;
            const geometryPromise = this._loadGeography(activeGeo);
            let currentResultsPromise = Promise.resolve({});
            const isLocalBody = this._isLocalGovernmentBody(body, bodyData.bodyGroup);

            // Load election results for all constituencies
            if (this._specialElection) {
                currentResultsPromise = Promise.resolve(this._specialElection.resultsByConstituency);
            } else {
                currentResultsPromise = this._loadAllResults(loadSlug, date, this.constituencies, {}, true);
            }

            // Critical path: only geometry + current results needed for initial render
            const [, currentResults] = await Promise.all([
                geometryPromise,
                currentResultsPromise
            ]);
            if (requestId !== this._activeLoadRequestId) {
                if (this.onFinishLoadFeedback && feedback) {
                    this.onFinishLoadFeedback(feedback, false, loadName, { cancelled: true });
                }
                return;
            }
            this.resultsByConstituency = currentResults || {};
            this.previousResultsByConstituency = {};
            this._rebuildElectionLookups();

            // Aggregates and previous results load in the background (Changes 3 & 6).
            // They are not needed for the initial map render or NI-wide party table.
            if (!this._specialElection) {
                this._previousResultsPromise = this.previousDate
                    ? this._loadAllResults(loadSlug, this.previousDate, previousDateData.constituencies || [], {}, false)
                    : Promise.resolve({});
                this._previousResultsPromise.then(prev => {
                    if (requestId !== this._activeLoadRequestId) return;
                    this.previousResultsByConstituency = prev || {};
                    // Rebuild aggregates that depend on previous results
                    if (isLocalBody && this._councilAggregates) {
                        this._previousCouncilAggregates = this._buildCouncilAggregateMap(this.previousResultsByConstituency);
                    } else if (!isLocalBody) {
                        this._rebuildCouncilAggregates();
                    }
                    // Re-render NI-wide view to fill in comparison columns
                    if (this._currentResultsView?.type === 'niwide') {
                        this._showNIWideResults();
                    }
                }).catch(err => console.warn('[Election] Background previous results load failed:', err));
            }

            // Colour the map by winning party
            this._colourMap(activeGeo);

            // Hide all other loaded layers while an election is visible.
            this._suppressNonElectionLayers();

            // Suppress labels on layers below the election
            this._suppressLabelsBelow();

            // Add seat circle overlays
            this._addOverlays(activeGeo);

            // Show split pane
            this._showSplitPane();

            // NI-wide results in the pane
            this._showNIWideResults();

            // Sync timeline slider to this body's election dates
            timeSliderController.setElectionDates(this._allBodyDates, date, (newDate) => {
                this.loadElection(this.body, newDate);
            });

            // Notify state change for URL
            if (this.onStateChange) this.onStateChange();
            if (this.onFinishLoadFeedback && feedback) {
                this.onFinishLoadFeedback(feedback, true, loadName);
            }
        } catch (error) {
            if (requestId === this._activeLoadRequestId) {
                this.clear();
            }
            if (this.onFinishLoadFeedback && feedback) {
                this.onFinishLoadFeedback(feedback, false, loadName, {
                    cancelled: requestId !== this._activeLoadRequestId
                });
            }
            throw error;
        }
    }

    /**
     * Clear current election state
     */
    clear(options = {}) {
        const preserveElectionTimeline = !!options.preserveElectionTimeline;
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
        this.bodyGroup = null;
        this.date = null;
        this.constituencies = null;
        this.selectedConstituency = null;
        this.resultsByConstituency = {};
        this.previousResultsByConstituency = {};
        this.previousDate = null;
        this._currentGeo = null;
        this._indexBodyData = null;
        this._allBodyDates = [];
        this._localResultsMode = 'dea';
        this._councilNameByConstituency = new Map();
        this._councilAggregates = null;
        this._previousCouncilAggregates = null;
        this._constituencyAliases = new Map();
        this._councilAliases = new Map();
        this._countDetailedView = false;
        this.partyColours = {};
        this._previousResultsPromise = null;
        this._currentLodLevel = 2;
        this._currentLodBaseFgb = null;
        this._currentResultsView = null;
        this._entityDetailReturnView = null;
        this._entityIndexCache = null;
        this._specialElection = null;
        this._restoreSuppressedNonElectionLayers();
        this._restoreLabels();
        this._hideSplitPane();
        if (!preserveElectionTimeline) {
            timeSliderController.clearElectionDates();
        }
        if (this.onStateChange) this.onStateChange();
    }

    _slugify(text) {
        return String(text || '').toLowerCase().trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s]+/g, '-')
            .replace(/-+/g, '-');
    }

    _normaliseElectionName(text) {
        return String(text || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/&/g, ' and ')
            .replace(/['�]/g, '')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/[^\w\s-]/g, ' ')
            .replace(/\b(\d+)\s+seats?\b/gi, ' ')
            .replace(/\bdea\b/gi, ' ')
            .replace(/\bdistrict electoral area\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    _cleanElectionCandidateText(text) {
        return String(text || '')
            .replace(/[�]+/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    _candidateDisplayName(row, fallback = '') {
        const raw = (row?.candidateName)
            || `${row?.Firstname || ''} ${row?.Surname || ''}`.trim()
            || fallback
            || '';
        const cleaned = this._cleanElectionCandidateText(raw);
        return cleaned || this._cleanElectionCandidateText(fallback);
    }

    _safeValidPoll(info = {}, countGroup = []) {
        const direct = parseFloat(info?.Valid_Poll);
        if (Number.isFinite(direct) && direct > 0) return direct;

        let firstCountSum = 0;
        const seen = new Set();
        (countGroup || []).forEach((row) => {
            if (String(row?.Count_Number || '') !== '1') return;
            const cid = String(row?.Candidate_Id || '').trim();
            if (!cid || cid === 'nontransferable' || seen.has(cid)) return;
            seen.add(cid);
            firstCountSum += parseFloat(row?.Total_Votes) || 0;
        });
        if (firstCountSum > 0) return firstCountSum;

        const totalPoll = parseFloat(info?.Total_Poll);
        const spoiled = parseFloat(info?.Spoiled);
        const fallback = totalPoll - spoiled;
        return (Number.isFinite(fallback) && fallback > 0) ? fallback : 0;
    }

    _isValidCandidateRow(row) {
        const cid = String(row?.Candidate_Id || '').trim();
        if (!cid || cid.toLowerCase() === 'nontransferable') return false;
        const candidateName = this._candidateDisplayName(row, '');
        if (!candidateName) return false;
        if (candidateName.toLowerCase() === 'party') return false;
        return true;
    }

    _cleanConstituencyDisplayName(text) {
        return String(text || '')
            .replace(/\s+[\u2010-\u2015\u2212-]\s*\d+\s+seats?$/i, '')
            .replace(/\s+\(\d+\s+seats?\)$/i, '')
            .replace(/\s+-\s+\d+\s+seats?$/i, '')
            .replace(/\s+[\u2010-\u2015\u2212-]\s*seats?$/i, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    _getCouncilNameForConstituency(name) {
        const raw = String(name || '').trim();
        if (!raw) return '';
        return this._councilNameByConstituency.get(raw)
            || this._councilNameByConstituency.get(this._cleanConstituencyDisplayName(raw))
            || '';
    }

    _canonicalEntityPersonId(personId, candidateName = '', partyName = '') {
        const name = this._cleanElectionCandidateText(candidateName);
        const party = String(partyName || '').trim();
        // Guardrail: current live local-government JSON still carries a stale hash ID
        // for Liz Kimmins, while the canonical cross-election ID is 44021.
        if (String(personId || '') === '1902069794' && name === 'Liz Kimmins' && party === 'Sinn F�in') {
            return '44021';
        }
        const rawId = String(personId || '').trim();
        if (rawId === '2729478781' && (name === 'Laura Misteil' || name === 'Laura Keenan')) {
            return '2701495392';
        }
        if (rawId === '2468861708' && (name === "Sian O'Neill" || name === 'Sian Mulholland')) {
            return '7209';
        }
        if (rawId === '1347931665' && (name === 'Deborah Armstrong' || name === 'Deborah Erskine')) {
            return '22896';
        }
        return rawId;
    }

    _aliasVariants(name) {
        const base = String(name || '').trim();
        const cleanedBase = this._cleanConstituencyDisplayName(base);
        const variants = new Set();
        const push = (value) => {
            if (!value) return;
            variants.add(String(value).trim());
            variants.add(this._normaliseElectionName(value));
            variants.add(this._slugify(value));
        };
        push(base);
        push(cleanedBase);
        push(base.replace(/\s+District Council$/i, ''));
        push(base.replace(/\s+Borough Council$/i, ''));
        push(base.replace(/\s+City Council$/i, ''));
        push(base.replace(/\s+City and District Council$/i, ''));
        push(base.replace(/\bCity\b/gi, ''));
        push(base.replace(/^Derry\b/i, 'Derry City and Strabane'));
        push(base.replace(/^Londonderry\b/i, 'Derry City and Strabane'));
        return [...variants].filter(Boolean);
    }

    _registerAliasMap(map, canonicalName, aliases) {
        aliases.forEach((alias) => {
            if (!alias) return;
            map.set(alias, canonicalName);
        });
    }

    _rebuildElectionLookups() {
        this._constituencyAliases = new Map();
        this._councilAliases = new Map();
        (this.constituencies || []).forEach((constituency) => {
            this._registerAliasMap(this._constituencyAliases, constituency, this._aliasVariants(constituency));
            const cleaned = this._cleanConstituencyDisplayName(constituency);
            const council = this._getCouncilNameForConstituency(constituency);
            if (cleaned && council && !this._councilNameByConstituency.has(cleaned)) {
                this._councilNameByConstituency.set(cleaned, council);
            }
            if (council) {
                this._registerAliasMap(this._councilAliases, council, this._aliasVariants(council));
            }
        });
    }

    _isLocalGovernmentBody(body = this.body, bodyGroup = null) {
        const resolvedGroup = bodyGroup
            ?? ((body === this.body) ? this.bodyGroup : null);
        return resolvedGroup === 'local-government'
            || body === 'Local Government Districts'
            || ElectionController.LOCAL_GOVERNMENT_BODIES.includes(body);
    }

    _isCouncilMode() {
        return this._isLocalGovernmentBody() && this._localResultsMode === 'council';
    }

    _getActiveGeography(baseGeo = this._currentGeo) {
        if (!baseGeo) return null;
        if (this._isCouncilMode()) {
            return {
                ...baseGeo,
                fgb: baseGeo.councilFgb || baseGeo.fgb,
                nameAttr: baseGeo.councilNameAttr || baseGeo.nameAttr
            };
        }
        return baseGeo;
    }

    _getEffectiveElectionScope(indexData, bodyData, date) {
        const councilNameByConstituency = new Map();
        if (!bodyData.bodyGroup) {
            const dateData = bodyData.dates.find(d => d.date === date);
            (dateData?.constituencies || []).forEach((constituency) => {
                councilNameByConstituency.set(constituency, bodyData.name);
            });
            return {
                constituencies: dateData?.constituencies || [],
                dates: bodyData.dates.map(d => d.date).sort(),
                councilNameByConstituency
            };
        }

        const siblings = indexData.bodies.filter((b) => b.bodyGroup === bodyData.bodyGroup);
        const constituencySet = new Set();
        const dateSet = new Set();
        siblings.forEach((sibling) => {
            sibling.dates.forEach((siblingDate) => {
                dateSet.add(siblingDate.date);
                if (siblingDate.date !== date) return;
                (siblingDate.constituencies || []).forEach((constituency) => {
                    constituencySet.add(constituency);
                    councilNameByConstituency.set(constituency, sibling.name);
                });
            });
        });

        return {
            constituencies: [...constituencySet].sort((a, b) => a.localeCompare(b)),
            dates: [...dateSet].sort(),
            councilNameByConstituency
        };
    }

    _isByElectionScope(constituencies = []) {
        const nonNiConstituencies = (constituencies || []).filter((name) => name !== 'Northern Ireland');
        return nonNiConstituencies.length > 0 && nonNiConstituencies.length <= 2;
    }

    _getPreviousDateData(indexData, bodyData, date, groupData) {
        const currentIsByElection = this._isByElectionScope(groupData?.constituencies || []);
        if (!bodyData.bodyGroup) {
            const bodyDatesDesc = [...bodyData.dates].sort((a, b) => String(b.date).localeCompare(String(a.date)));
            const currentIdx = bodyDatesDesc.findIndex(d => d.date === date);
            for (let i = currentIdx + 1; i < bodyDatesDesc.length; i += 1) {
                const candidate = bodyDatesDesc[i];
                const candidateIsByElection = this._isByElectionScope(candidate?.constituencies || []);
                if (currentIsByElection && candidateIsByElection) continue;
                if (!currentIsByElection && candidateIsByElection) continue;
                return candidate || null;
            }
            return null;
        }

        const sortedDates = [...groupData.dates].sort((a, b) => String(b).localeCompare(String(a)));
        const currentIdx = sortedDates.findIndex((d) => d === date);
        for (let i = currentIdx + 1; i < sortedDates.length; i += 1) {
            const candidateDate = sortedDates[i];
            const candidateScope = this._getEffectiveElectionScope(indexData, bodyData, candidateDate);
            const candidateIsByElection = this._isByElectionScope(candidateScope.constituencies || []);
            if (currentIsByElection && candidateIsByElection) continue;
            if (!currentIsByElection && candidateIsByElection) continue;
            return {
                date: candidateDate,
                constituencies: candidateScope.constituencies
            };
        }
        return null;
    }

    _buildCouncilAggregateMap(sourceResults = {}) {
        const councilMap = new Map();
        Object.entries(sourceResults || {}).forEach(([constituency, payload]) => {
            const canonicalConstituency = this._cleanConstituencyDisplayName(constituency);
            const councilName = this._getCouncilNameForConstituency(canonicalConstituency);
            if (!councilName || !payload?.Constituency) return;
            if (!councilMap.has(councilName)) {
                councilMap.set(councilName, {
                    councilName,
                    constituencies: [],
                    validPoll: 0,
                    totalPoll: 0,
                    electorate: 0,
                    spoiled: 0,
                    totalSeats: 0,
                    countRows: [],
                    partyMap: new Map(),
                    candidateMap: new Map(),
                    localPartyMap: new Map(),
                    electedMembers: []
                });
            }
            const aggregate = councilMap.get(councilName);
            const cg = payload.Constituency.countGroup || [];
            const info = payload.Constituency.countInfo || {};
            const constituencyValidPoll = this._safeValidPoll(info, cg);
            const constituencySeatCount = this._getSeatCount(info);
            const constituencyLastCount = Math.max(1, ...cg.map((row) => parseInt(row.Count_Number, 10) || 1));
            aggregate.constituencies.push(canonicalConstituency);
            aggregate.validPoll += constituencyValidPoll;
            aggregate.totalPoll += parseFloat(info.Total_Poll) || 0;
            aggregate.electorate += parseFloat(info.Total_Electorate) || 0;
            aggregate.spoiled += parseFloat(info.Spoiled) || 0;
            aggregate.totalSeats += constituencySeatCount;

            const seenRoundOne = new Set();
            cg.forEach((row) => {
                if (!this._isValidCandidateRow(row)) return;
                const cid = String(row.Candidate_Id || '').trim();
                const countNum = parseInt(row.Count_Number, 10) || 1;
                const candidateName = this._candidateDisplayName(row, cid);
                const party = this._normaliseLivePartyName(row.Party_Name);
                const colour = row.Party_Colour || '#b0bec5';
                const votes = parseFloat(row.Total_Votes) || 0;
                const localKey = `${party}::${canonicalConstituency}`;

                if (!aggregate.candidateMap.has(cid)) {
                    aggregate.candidateMap.set(cid, {
                        personId: cid,
                        name: candidateName,
                        party,
                        colour,
                        constituency: canonicalConstituency,
                        firstPrefs: 0,
                        validPoll: constituencyValidPoll,
                        finalVotes: 0,
                        elected: false,
                        electedAt: null,
                        excluded: false,
                        excludedAt: null,
                        lastCount: constituencyLastCount,
                        resolvedCount: constituencyLastCount,
                        status: 'Not Elected',
                        counts: {}
                    });
                }
                const candidate = aggregate.candidateMap.get(cid);
                candidate.validPoll = constituencyValidPoll;
                candidate.lastCount = constituencyLastCount;
                candidate.counts[countNum] = {
                    total: votes,
                    transfers: parseFloat(row.Transfers) || 0,
                    status: row.Status || ''
                };
                if (countNum === 1 && !seenRoundOne.has(cid)) {
                    seenRoundOne.add(cid);
                    candidate.firstPrefs = votes;
                    if (!aggregate.partyMap.has(party)) {
                        aggregate.partyMap.set(party, { party, colour, stood: 0, firstPrefs: 0, elected: 0 });
                    }
                    const partyRow = aggregate.partyMap.get(party);
                    partyRow.stood += 1;
                    partyRow.firstPrefs += votes;

                    if (!aggregate.localPartyMap.has(localKey)) {
                        aggregate.localPartyMap.set(localKey, {
                            key: localKey,
                            party,
                            constituency: canonicalConstituency,
                            colour,
                            stood: 0,
                            firstPrefs: 0,
                            elected: 0,
                            validPoll: constituencyValidPoll,
                            totalSeats: constituencySeatCount
                        });
                    }
                    const localRow = aggregate.localPartyMap.get(localKey);
                    localRow.stood += 1;
                    localRow.firstPrefs += votes;
                }
                if (votes >= candidate.finalVotes) {
                    candidate.finalVotes = votes;
                }
                if (this._statusKind(row.Status) === 'elected') {
                    candidate.elected = true;
                    candidate.electedAt ||= countNum;
                }
                if (this._statusKind(row.Status) === 'excluded') {
                    candidate.excluded = true;
                    candidate.excludedAt ||= countNum;
                }
            });

            const constituencyCandidates = [...aggregate.candidateMap.values()].filter((candidate) => candidate.constituency === canonicalConstituency);
            constituencyCandidates.forEach((candidate) => {
                const lifecycle = this._inferCandidateLifecycle(candidate, info, constituencyLastCount);
                candidate.electedAt = lifecycle.electedAt || candidate.electedAt;
                candidate.excludedAt = lifecycle.excludedAt || candidate.excludedAt;
                if (candidate.electedAt) candidate.elected = true;
                if (candidate.excludedAt) candidate.excluded = true;
            });
            const explicitElected = constituencyCandidates.filter((candidate) => !!candidate.electedAt).length;
            if (constituencySeatCount > 0 && explicitElected < constituencySeatCount) {
                const needed = constituencySeatCount - explicitElected;
                constituencyCandidates
                    .filter((candidate) => !candidate.electedAt && !candidate.excludedAt)
                    .sort((a, b) => (b.finalVotes || 0) - (a.finalVotes || 0))
                    .slice(0, needed)
                    .forEach((candidate) => {
                        candidate.elected = true;
                        candidate.electedAt ||= constituencyLastCount;
                    });
            }
            constituencyCandidates.forEach((candidate) => {
                candidate.resolvedCount = candidate.electedAt
                    ? (candidate.electedAt || constituencyLastCount)
                    : candidate.excludedAt
                        ? (candidate.excludedAt || constituencyLastCount)
                        : constituencyLastCount;
                candidate.status = candidate.electedAt
                    ? 'Elected'
                    : candidate.excludedAt
                        ? 'Excluded'
                        : 'Not Elected';
            });

            const elected = this._extractElected(payload);
            elected.forEach((member) => {
                aggregate.electedMembers.push(member);
                const partyRow = aggregate.partyMap.get(member.party);
                if (partyRow) partyRow.elected += 1;
                const localRow = aggregate.localPartyMap.get(`${member.party}::${canonicalConstituency}`);
                if (localRow) localRow.elected += 1;
            });
        });

        councilMap.forEach((aggregate) => {
            aggregate.constituencies.sort((a, b) => a.localeCompare(b));
            aggregate.electedMembers.sort((a, b) =>
                this._partyHemicycleRank(a.party) - this._partyHemicycleRank(b.party)
                || String(a.party || '').localeCompare(String(b.party || ''))
                || String(a.name || '').localeCompare(String(b.name || ''))
            );
            aggregate.candidates = [...aggregate.candidateMap.values()].sort((a, b) => {
                const aPct = a.validPoll > 0 ? ((a.firstPrefs || 0) / a.validPoll * 100) : 0;
                const bPct = b.validPoll > 0 ? ((b.firstPrefs || 0) / b.validPoll * 100) : 0;
                return bPct - aPct
                    || (b.firstPrefs || 0) - (a.firstPrefs || 0)
                    || String(a.name || '').localeCompare(String(b.name || ''));
            });
            aggregate.parties = [...aggregate.partyMap.values()].sort((a, b) =>
                b.elected - a.elected || b.firstPrefs - a.firstPrefs || String(a.party || '').localeCompare(String(b.party || ''))
            );
            aggregate.localParties = [...aggregate.localPartyMap.values()].sort((a, b) =>
                b.firstPrefs - a.firstPrefs || String(a.party || '').localeCompare(String(b.party || ''))
            );
        });
        return councilMap;
    }

    _rebuildCouncilAggregates() {
        this._councilAggregates = this._buildCouncilAggregateMap(this.resultsByConstituency);
        this._previousCouncilAggregates = this._buildCouncilAggregateMap(this.previousResultsByConstituency);
    }

    _getSeatCount(info = {}) {
        const direct = parseInt(info.Number_Of_Seats, 10);
        const inferred = this._inferSeatCountFromName(info.Constituency_Name);
        if (Number.isFinite(inferred) && inferred > 0) return inferred;
        return Number.isFinite(direct) && direct > 0 ? direct : 0;
    }

    _inferSeatCountFromName(name) {
        const match = String(name || '').match(/(?:^|\W)(\d+)\s+seats?\b/i);
        const value = match ? parseInt(match[1], 10) : NaN;
        return Number.isFinite(value) && value > 0 ? value : NaN;
    }

    _partyHemicycleRank(party) {
        const normalized = this._normaliseElectionName(party);
        if (normalized.includes('people before profit')) return 0;
        if (normalized.includes('sinn fein')) return 1;
        if (normalized.includes('sdlp') || normalized.includes('social democratic and labour')) return 2;
        if (normalized.includes('green')) return 3;
        if (normalized.includes('independent')) return 4;
        if (normalized.includes('uup') || normalized.includes('ulster unionist')) return 90;
        if (normalized.includes('dup') || normalized.includes('democratic unionist')) return 91;
        if (normalized.includes('ukup') || normalized.includes('united kingdom unionist')) return 92;
        if (normalized.includes('tuv') || normalized.includes('traditional unionist')) return 93;
        return 50;
    }

    _inferCandidateLifecycle(candidate, info, lastCount) {
        const quota = parseFloat(info?.Quota);
        const counts = Object.keys(candidate.counts || {})
            .map(Number)
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        let electedAt = null;
        let excludedAt = null;
        let terminalCount = null;

        counts.forEach((countNum, idx) => {
            const current = candidate.counts[countNum];
            const previous = idx > 0 ? candidate.counts[counts[idx - 1]] : null;
            const total = current?.total ?? 0;
            const transfer = current?.transfers ?? 0;

            if (!electedAt && Number.isFinite(quota) && total >= (quota - 0.01)) {
                electedAt = countNum;
            }
            if (!excludedAt && previous && previous.total > 0.01 && total <= 0.01 && transfer < -0.01) {
                excludedAt = countNum;
                terminalCount = countNum;
            }
            if (!terminalCount && previous && Number.isFinite(quota) && previous.total > (quota + 0.01)
                && Math.abs(total - quota) <= 0.01 && transfer < -0.01) {
                terminalCount = countNum;
            }
        });

        return { electedAt, excludedAt, terminalCount, lastCount };
    }

    _countEventCandidateLabel(candidate, surnameCounts) {
        const surname = String(candidate?.surname || '').trim();
        const fullName = String(candidate?.name || '').trim();
        const normalizedSurname = this._normaliseElectionName(surname);
        if (!surname) return fullName || '';
        if ((surnameCounts.get(normalizedSurname) || 0) > 1) return fullName || surname;
        return surname;
    }

    _inferCountEvents(candidates, info, visibleCounts) {
        const quota = parseFloat(info?.Quota);
        const surnameCounts = new Map();
        Object.values(candidates || {}).forEach((candidate) => {
            const surname = this._normaliseElectionName(candidate?.surname || '');
            if (!surname) return;
            surnameCounts.set(surname, (surnameCounts.get(surname) || 0) + 1);
        });

        const events = new Map();
        visibleCounts.forEach((countNum) => {
            const candidatesWithNegativeTransfer = Object.values(candidates || {})
                .map((candidate) => {
                    const current = candidate.counts?.[countNum];
                    if (!current || !(current.transfers < -0.01)) return null;
                    const previous = candidate.counts?.[countNum - 1] || null;
                    let type = null;
                    if (current.total <= 0.01 && (!previous || previous.total > 0.01)) {
                        type = 'Exclusion';
                    } else if (
                        Number.isFinite(quota)
                        && Math.abs(current.total - quota) <= 0.01
                        && (previous?.total ?? 0) > (quota + 0.01)
                    ) {
                        type = 'Surplus';
                    } else if (this._statusKind(current.status) === 'excluded') {
                        type = 'Exclusion';
                    } else if (this._statusKind(current.status) === 'elected') {
                        type = 'Surplus';
                    }
                    if (!type) return null;
                    return {
                        candidate,
                        type,
                        amount: Math.abs(current.transfers)
                    };
                })
                .filter(Boolean);

            if (!candidatesWithNegativeTransfer.length) return;

            const surplusEvents = candidatesWithNegativeTransfer.filter((event) => event.type === 'Surplus');
            const pool = surplusEvents.length ? surplusEvents : candidatesWithNegativeTransfer;
            pool.sort((a, b) =>
                b.amount - a.amount
                || String(a.candidate?.name || '').localeCompare(String(b.candidate?.name || ''))
            );
            const chosen = pool[0];
            events.set(countNum, {
                type: chosen.type,
                label: this._countEventCandidateLabel(chosen.candidate, surnameCounts)
            });
        });

        return events;
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
     * without clearing state â€” used when hiding/showing via active layers list.
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
            this._suppressNonElectionLayers();
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
            this._restoreSuppressedNonElectionLayers();
        }
    }

    isVisible() {
        if (!this.active || !mapController.map) return false;
        if (this._registeredLayerId) {
            const state = mapController.layerStates.get(this._registeredLayerId);
            return !!state?.visible;
        }
        return !!(this.geojsonLayer && mapController.map.hasLayer(this.geojsonLayer));
    }

    enforceExclusiveVisibility() {
        if (!this.isVisible()) return;
        this._suppressNonElectionLayers();
    }

    // â”€â”€â”€ Data Loading â”€â”€â”€

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
        let pendingConstituencies = [...(constituencies || [])];
        if (bodySlug === 'local-government') {
            const bundle = await this._loadLocalResultsBundle(date);
            if (bundle) {
                pendingConstituencies = this._populateResultsTargetFromBundle(
                    bundle,
                    pendingConstituencies,
                    target,
                    extractPartyColours
                );
            }
            if (!pendingConstituencies.length) return target;
        }
        const constituencySlugVariants = (name) => {
            const base = slugify(name);
            const variants = new Set([base]);
            if (bodySlug === 'local-government' && !/-\d+-seats?$/.test(base)) {
                variants.add(`${base}-5-seats`);
                variants.add(`${base}-6-seats`);
                variants.add(`${base}-7-seats`);
            }
            return [...variants];
        };
        const loadConstituency = async (constituency) => {
            const slugVariants = constituencySlugVariants(constituency);
            for (const slug of slugVariants) {
                const url = `${this.electionDataPath}/elections/${bodySlug}/${date}/${slug}.json`;
                const payload = await this._loadResultsPayload(url);
                if (payload) return payload;
            }
            return null;
        };
        const promises = pendingConstituencies.map((c) => loadConstituency(c));

        const results = await Promise.all(promises);
        pendingConstituencies.forEach((c, i) => {
            if (results[i]) {
                target[c] = results[i];
                this._extractPartyColoursFromPayload(results[i], extractPartyColours);
            }
        });
        return target;
    }

    _getLocalBundleUrl(date) {
        return `${this.electionDataPath}/elections/local-government/${date}/_bundle.json`;
    }

    _getLocalBundleV2Url(date) {
        return `${this.electionDataPath}/elections/local-government/${date}/_bundle_v2.json`;
    }

    _getLocalAggregatesUrl(date) {
        return `${this.electionDataPath}/elections/local-government/${date}/_aggregates.json`;
    }

    /**
     * Expand a compact-v2 bundle back into the original countGroup format.
     */
    _expandCompactBundle(payload) {
        if (payload?.format !== 'compact-v2') return payload;
        const expanded = {
            body: payload.body,
            date: payload.date,
            constituencies: {}
        };
        for (const [name, data] of Object.entries(payload.constituencies || {})) {
            const constData = data?.Constituency;
            if (!constData?.candidates || !constData?.counts) {
                expanded.constituencies[name] = data;
                continue;
            }
            const candidates = constData.candidates;
            const countFields = constData.countFields || [
                'Count_Number', 'Candidate_First_Pref_Votes', 'Transfers',
                'Total_Votes', 'Status', 'Occurred_On_Count'
            ];
            const countGroup = constData.counts.map((row, rowIdx) => {
                const cidx = row[0];
                const candidate = candidates[cidx] || {};
                const entry = { ...candidate };
                for (let i = 0; i < countFields.length; i++) {
                    entry[countFields[i]] = row[i + 1];
                }
                entry.id = rowIdx;
                return entry;
            });
            expanded.constituencies[name] = {
                Constituency: {
                    countInfo: constData.countInfo,
                    countGroup
                }
            };
        }
        return expanded;
    }

    async _loadLocalResultsBundle(date) {
        if (!date) return null;
        if (this._localBundleCache.has(date)) return this._localBundleCache.get(date);

        // Try compact v2 bundle first (much smaller)
        let payload = await this._loadResultsPayload(this._getLocalBundleV2Url(date));
        if (payload?.format === 'compact-v2') {
            payload = this._expandCompactBundle(payload);
        } else {
            // Fall back to original bundle
            payload = await this._loadResultsPayload(this._getLocalBundleUrl(date));
        }

        const bundle = this._isValidLocalResultsBundle(payload) ? payload : null;
        this._localBundleCache.set(date, bundle);
        return bundle;
    }

    async _loadLocalCouncilAggregates(date) {
        if (!date) return null;
        if (this._localAggregatesCache.has(date)) return this._localAggregatesCache.get(date);
        const payload = await this._loadResultsPayload(this._getLocalAggregatesUrl(date));
        const aggregates = this._deserializeCouncilAggregateMap(payload);
        this._localAggregatesCache.set(date, aggregates);
        return aggregates;
    }

    _isValidLocalResultsBundle(payload) {
        return !!(payload && typeof payload === 'object' && payload.constituencies && typeof payload.constituencies === 'object');
    }

    _populateResultsTargetFromBundle(bundle, constituencies, target, extractPartyColours = true) {
        const bundleConstituencies = bundle?.constituencies || {};
        const missing = [];
        (constituencies || []).forEach((constituency) => {
            const payload = bundleConstituencies[constituency];
            if (payload?.Constituency) {
                target[constituency] = payload;
                this._extractPartyColoursFromPayload(payload, extractPartyColours);
            } else {
                missing.push(constituency);
            }
        });
        return missing;
    }

    _extractPartyColoursFromPayload(payload, extractPartyColours = true) {
        if (!extractPartyColours) return;
        const cg = payload?.Constituency?.countGroup;
        if (!cg) return;
        cg.forEach((row) => {
            const party = this._normaliseLivePartyName(row.Party_Name);
            if (row.Party_Colour && !this.partyColours[party]) {
                this.partyColours[party] = row.Party_Colour;
            }
        });
    }

    _deserializeCouncilAggregateMap(payload) {
        const councils = payload?.councils;
        if (!councils || typeof councils !== 'object') return null;
        const councilMap = new Map();
        Object.entries(councils).forEach(([councilName, aggregate]) => {
            if (!aggregate || !Array.isArray(aggregate.constituencies)) return;
            const normalized = {
                councilName: aggregate.councilName || councilName,
                constituencies: [...aggregate.constituencies],
                validPoll: Number(aggregate.validPoll) || 0,
                totalPoll: Number(aggregate.totalPoll) || 0,
                electorate: Number(aggregate.electorate) || 0,
                spoiled: Number(aggregate.spoiled) || 0,
                totalSeats: Number(aggregate.totalSeats) || 0,
                countRows: [],
                candidates: Array.isArray(aggregate.candidates) ? aggregate.candidates.map((candidate) => ({ ...candidate })) : [],
                parties: Array.isArray(aggregate.parties) ? aggregate.parties.map((party) => ({ ...party })) : [],
                localParties: Array.isArray(aggregate.localParties) ? aggregate.localParties.map((localParty) => ({ ...localParty })) : [],
                electedMembers: Array.isArray(aggregate.electedMembers) ? aggregate.electedMembers.map((member) => ({ ...member })) : []
            };
            normalized.candidateMap = new Map(normalized.candidates.map((candidate) => [String(candidate.personId || '').trim(), candidate]));
            normalized.partyMap = new Map(normalized.parties.map((party) => [String(party.party || ''), party]));
            normalized.localPartyMap = new Map(normalized.localParties.map((localParty) => [String(localParty.key || ''), localParty]));
            councilMap.set(normalized.councilName, normalized);
        });
        return councilMap.size ? councilMap : null;
    }

    async _loadResultsPayload(url) {
        if (this._resultsPayloadCache.has(url)) return this._resultsPayloadCache.get(url);
        if (this._resultsPayloadPromiseCache.has(url)) return this._resultsPayloadPromiseCache.get(url);

        const promise = (async () => {
            try {
                const response = await fetch(url);
                if (!response.ok) return null;
                const payload = await response.json();
                this._resultsPayloadCache.set(url, payload);
                return payload;
            } catch (_) {
                return null;
            } finally {
                this._resultsPayloadPromiseCache.delete(url);
            }
        })();

        this._resultsPayloadPromiseCache.set(url, promise);
        return promise;
    }

    _createEmptyEntityIndex() {
        return {
            parties: new Map(),
            candidates: new Map(),
            elections: new Map(),
            electionList: [],
            totalValid: 0
        };
    }

    _getBodyElectionLabel(body) {
        const map = {
            'House of Commons of the United Kingdom': 'Westminster',
            'Northern Ireland Assembly': 'Assembly',
            'Northern Ireland Forum for Political Dialogue': 'Forum',
            'Northern Ireland Constitutional Convention': 'Convention',
            'European Parliament': 'European Parliament'
        };
        return map[body] || this._shortBodyName(body);
    }

    _getComparisonBucket(body) {
        if (this._isLocalGovernmentBody(body)) return 'local';
        if (body === 'House of Commons of the United Kingdom') return 'westminster';
        if (body === 'European Parliament') return 'european';
        if ([
            'Northern Ireland Assembly',
            'Northern Ireland Forum for Political Dialogue',
            'Northern Ireland Constitutional Convention'
        ].includes(body)) {
            return 'devolved';
        }
        return body || 'other';
    }

    _getElectionTypeLabel(body) {
        if (this._isLocalGovernmentBody(body)) return 'Local';
        if (body === 'House of Commons of the United Kingdom') return 'Westminster';
        if (body === 'European Parliament') return 'European';
        if ([
            'Northern Ireland Assembly',
            'Northern Ireland Forum for Political Dialogue',
            'Northern Ireland Constitutional Convention'
        ].includes(body)) {
            return 'Devolved';
        }
        return 'Other';
    }

    _getElectionHistoryPrefix(body) {
        if (this._isLocalGovernmentBody(body)) return 'Local';
        const map = {
            'House of Commons of the United Kingdom': 'Westminster',
            'Northern Ireland Assembly': 'Assembly',
            'Northern Ireland Forum for Political Dialogue': 'Forum',
            'Northern Ireland Constitutional Convention': 'Convention',
            'European Parliament': 'European'
        };
        return map[body] || this._shortBodyName(body);
    }

    _formatElectionHistoryDateToken(dateStr, includeMonth = false) {
        const d = new Date(`${dateStr}T00:00:00`);
        if (Number.isNaN(d.getTime())) return String(dateStr || '');
        if (includeMonth) {
            return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
        }
        return String(d.getFullYear());
    }

    _isRecallPetitionElection(body, date, displayName = '') {
        if (body === 'House of Commons of the United Kingdom' && String(date || '') === '2018-08-29') return true;
        return /recall\s+petition/i.test(String(displayName || ''));
    }

    _getConstituencyMapYear(body, date) {
        const geo = ElectionController.getGeography(body, date);
        const filePath = geo?.fgb || '';
        const yearMatch = String(filePath).match(/(19|20)\d{2}/g);
        if (yearMatch?.length) return yearMatch[yearMatch.length - 1];
        return String(date || '').slice(0, 4) || '';
    }

    _getSpecialElectionConfig(body, date) {
        if (body === 'House of Commons of the United Kingdom' && date === '2018-08-29') {
            const constituency = 'North Antrim';
            const year = String(date || '').slice(0, 4) || '2018';
            return {
                type: 'recall-petition',
                body,
                date,
                constituency,
                displayName: `${year} ${constituency} recall petition`,
                title: 'North Antrim recall petition',
                fillColor: '#c85a5a',
                outlineColor: '#8f2f2f',
                resultsByConstituency: {
                    [constituency]: {
                        Constituency: {
                            countGroup: [],
                            countInfo: {
                                Constituency_Name: constituency,
                                Number_Of_Seats: '1'
                            },
                            recallPetition: {
                                constituency,
                                thresholdPct: 10.0,
                                electorate: 75428,
                                turnout: 7099,
                                spoiled: 14,
                                validSignatures: 7085,
                                requiredSignatures: 7543,
                                signedPct: 9.4,
                                successful: false,
                                incumbentMp: {
                                    name: 'Ian Paisley',
                                    party: 'DUP'
                                },
                                outcome: 'Petition failed. The incumbent MP was not unseated and no by-election was triggered.',
                                notes: [
                                    'A recall petition required 10% of the electorate to sign in order to succeed.',
                                    'The petition reached 9.4%, so it fell short of the threshold.'
                                ]
                            }
                        }
                    }
                }
            };
        }
        return null;
    }

    _buildElectionDisplayName(body, date, duplicateYearCount, duplicateMonthCount, constituencies = []) {
        const special = this._getSpecialElectionConfig(body, date);
        if (special?.displayName) return special.displayName;
        const bodyLabel = this._getBodyElectionLabel(body);
        const d = new Date(`${date}T00:00:00`);
        if (Number.isNaN(d.getTime())) {
            return `${date} ${bodyLabel} election`;
        }
        const nonNiConstituencies = (constituencies || []).filter((name) => name !== 'Northern Ireland');
        const isByElection = this._isByElectionScope(constituencies);

        let prefix = d.getFullYear().toString();
        if ((duplicateYearCount || 0) > 1) {
            prefix = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        }
        if ((duplicateMonthCount || 0) > 1) {
            prefix = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        }
        if (this._isLocalGovernmentBody(body)) {
            if (isByElection) {
                const deaName = nonNiConstituencies[0] || bodyLabel;
                return `${prefix} ${deaName} by-election`;
            }
            return this._localElectionTitle(date);
        }
        return `${prefix} ${bodyLabel} ${isByElection ? 'by-election' : 'election'}`;
    }

    _buildElectionTimeline(indexData) {
        const bodyYearCounts = new Map();
        const bodyMonthCounts = new Map();

        (indexData?.bodies || []).forEach((bodyData) => {
            (bodyData?.dates || []).forEach((dateData) => {
                const year = String(dateData.date || '').slice(0, 4);
                const month = String(dateData.date || '').slice(0, 7);
                const bodyYearKey = `${bodyData.name}::${year}`;
                const bodyMonthKey = `${bodyData.name}::${month}`;
                bodyYearCounts.set(bodyYearKey, (bodyYearCounts.get(bodyYearKey) || 0) + 1);
                bodyMonthCounts.set(bodyMonthKey, (bodyMonthCounts.get(bodyMonthKey) || 0) + 1);
            });
        });

        const elections = [];
        (indexData?.bodies || []).forEach((bodyData) => {
            (bodyData?.dates || []).forEach((dateData) => {
                const date = dateData.date;
                const year = String(date || '').slice(0, 4);
                const month = String(date || '').slice(0, 7);
                const bodyYearKey = `${bodyData.name}::${year}`;
                const bodyMonthKey = `${bodyData.name}::${month}`;
                elections.push({
                    key: `${bodyData.name}::${date}`,
                    body: bodyData.name,
                    bodyLabel: this._getBodyElectionLabel(bodyData.name),
                    date,
                    displayName: this._buildElectionDisplayName(
                        bodyData.name,
                        date,
                        bodyYearCounts.get(bodyYearKey) || 0,
                        bodyMonthCounts.get(bodyMonthKey) || 0,
                        dateData.constituencies || []
                    ),
                    isByElection: this._isByElectionScope(dateData.constituencies || []),
                    constituencies: (dateData.constituencies || []).filter((name) => name !== 'Northern Ireland')
                });
            });
        });

        elections.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.body).localeCompare(String(b.body)));
        return elections;
    }

    _accumulateEntityIndex(index, payload, context = {}) {
        const constName = context.constituency || payload?.Constituency?.countInfo?.Constituency_Name || '';
        const body = context.body || this.body || '';
        const date = context.date || this.date || '';
        const electionKey = `${body}::${date}`;
        const cg = payload?.Constituency?.countGroup || [];
        const info = payload?.Constituency?.countInfo || {};
        const constValid = parseFloat(info.Valid_Poll) || 0;
        const seatCount = parseInt(info.Number_Of_Seats, 10) || 0;
        const mapLayerYear = this._getConstituencyMapYear(body, date);
        if (!Array.isArray(cg) || cg.length === 0) return;

        index.totalValid += constValid;
        const electionEntry = index.elections.get(electionKey);
        if (electionEntry) {
            electionEntry.totalValid += constValid;
            electionEntry.totalSeats += seatCount;
            if (!electionEntry.constituencyStats) electionEntry.constituencyStats = new Map();
            if (constName && !electionEntry.constituencyStats.has(constName)) {
                electionEntry.constituencyStats.set(constName, {
                    name: constName,
                    valid: constValid,
                    seats: seatCount,
                    partyStats: new Map()
                });
            }
        }

        const countNums = [...new Set(cg.map(r => parseInt(r.Count_Number, 10) || 1))].sort((a, b) => a - b);
        const lastCount = countNums[countNums.length - 1] || 1;
        const totalCountCount = countNums.length;
        const byCandidate = new Map();

        cg.forEach((row) => {
            if (!this._isValidCandidateRow(row)) return;
            const cid = String(row.Candidate_Id || '').trim();
            const countNum = parseInt(row.Count_Number, 10) || 1;
            if (!byCandidate.has(cid)) {
                byCandidate.set(cid, {
                    personId: cid,
                    name: this._candidateDisplayName(row, cid),
                    party: this._normaliseLivePartyName(row.Party_Name),
                    colour: row.Party_Colour || '#b0bec5',
                    constituency: constName,
                    body,
                    date,
                    firstPref: 0,
                    finalVotes: 0,
                    elected: false,
                    excluded: false,
                    electedAt: null,
                    excludedAt: null
                });
            }
            const candidate = byCandidate.get(cid);
            const total = parseFloat(row.Total_Votes) || 0;
            if (countNum === 1) {
                candidate.firstPref = parseFloat(row.Candidate_First_Pref_Votes || row.Total_Votes) || 0;
            }
            if (total > candidate.finalVotes) candidate.finalVotes = total;
            if (this._statusKind(row.Status) === 'elected') {
                candidate.elected = true;
                candidate.electedAt ||= countNum;
            }
            if (this._statusKind(row.Status) === 'excluded') {
                candidate.excluded = true;
                candidate.excludedAt ||= countNum;
            }
        });

        const explicitElected = [...byCandidate.values()].filter(c => c.elected).length;
        if (seatCount > 0 && explicitElected < seatCount) {
            const needed = seatCount - explicitElected;
            const deemable = [...byCandidate.values()]
                .filter((candidate) => !candidate.elected && !candidate.excluded)
                .sort((a, b) => b.finalVotes - a.finalVotes)
                .slice(0, needed);
            deemable.forEach((candidate) => {
                candidate.elected = true;
                candidate.electedAt ||= lastCount;
            });
        }

        byCandidate.forEach((candidate) => {
            const resolvedCount = candidate.elected ? (candidate.electedAt || lastCount)
                : candidate.excluded ? (candidate.excludedAt || lastCount)
                    : lastCount;
            const status = candidate.elected
                ? `Elected Count ${resolvedCount}/${totalCountCount}`
                : (candidate.excluded
                    ? `Excluded Count ${resolvedCount}/${totalCountCount}`
                    : `Not Elected Count ${lastCount}/${totalCountCount}`);
            candidate.status = status;
            candidate.firstPrefPct = constValid > 0 ? (candidate.firstPref / constValid * 100) : 0;

            const personId = this._canonicalEntityPersonId(candidate.personId, candidate.name, candidate.party);
            if (!index.candidates.has(personId)) {
                index.candidates.set(personId, {
                    kind: 'candidate',
                    personId,
                    key: personId,
                    name: candidate.name,
                    colours: new Set(candidate.colour ? [candidate.colour] : []),
                    parties: new Set(candidate.party ? [candidate.party] : []),
                    bodies: new Set(body ? [body] : []),
                    dates: new Set(date ? [date] : []),
                    constituencies: new Set(constName ? [constName] : []),
                    firstPrefs: 0,
                    finalVotes: 0,
                    electedCount: 0,
                    appearances: []
                });
            }
            const candidateEntry = index.candidates.get(personId);
            if (candidate.colour) candidateEntry.colours.add(candidate.colour);
            if (candidate.party) candidateEntry.parties.add(candidate.party);
            if (body) candidateEntry.bodies.add(body);
            if (date) candidateEntry.dates.add(date);
            if (constName) candidateEntry.constituencies.add(constName);
            candidateEntry.firstPrefs += candidate.firstPref;
            candidateEntry.finalVotes += candidate.finalVotes;
            if (candidate.elected) candidateEntry.electedCount += 1;
                candidateEntry.appearances.push({
                    body,
                    date,
                    electionKey,
                    constituency: constName,
                    mapLayerYear,
                    party: candidate.party,
                    firstPref: candidate.firstPref,
                    firstPrefPct: candidate.firstPrefPct,
                    finalVotes: candidate.finalVotes,
                    status,
                    resolvedCount,
                    totalCountCount,
                    elected: candidate.elected
                });

            const partyName = this._normaliseLivePartyName(candidate.party);
            if (!index.parties.has(partyName)) {
                index.parties.set(partyName, {
                    kind: 'party',
                    key: partyName,
                    name: partyName,
                    colours: new Set(candidate.colour ? [candidate.colour] : []),
                    bodies: new Set(body ? [body] : []),
                    dates: new Set(date ? [date] : []),
                    constituencies: new Set(constName ? [constName] : []),
                    firstPrefs: 0,
                    finalVotes: 0,
                    stood: 0,
                    elected: 0,
                    candidates: []
                });
            }
            const partyEntry = index.parties.get(partyName);
            if (candidate.colour) partyEntry.colours.add(candidate.colour);
            if (body) partyEntry.bodies.add(body);
            if (date) partyEntry.dates.add(date);
            if (constName) partyEntry.constituencies.add(constName);
            partyEntry.firstPrefs += candidate.firstPref;
            partyEntry.finalVotes += candidate.finalVotes;
            partyEntry.stood += 1;
            if (candidate.elected) partyEntry.elected += 1;
            partyEntry.candidates.push({
                personId,
                name: candidate.name,
                body,
                date,
                electionKey,
                constituency: constName,
                mapLayerYear,
                firstPref: candidate.firstPref,
                firstPrefPct: candidate.firstPrefPct,
                finalVotes: candidate.finalVotes,
                status,
                elected: candidate.elected
            });

            if (electionEntry) {
                if (!electionEntry.partyStats.has(partyName)) {
                    electionEntry.partyStats.set(partyName, {
                        party: partyName,
                        colour: candidate.colour || '#b0bec5',
                        votes: 0,
                        stood: 0,
                        elected: 0,
                        constituencies: new Set()
                    });
                }
                const partyStats = electionEntry.partyStats.get(partyName);
                partyStats.votes += candidate.firstPref;
                partyStats.stood += 1;
                if (candidate.elected) partyStats.elected += 1;
                if (constName) partyStats.constituencies.add(constName);

                const constituencyStats = constName ? electionEntry.constituencyStats?.get(constName) : null;
                if (constituencyStats) {
                    if (!constituencyStats.partyStats.has(partyName)) {
                        constituencyStats.partyStats.set(partyName, {
                            party: partyName,
                            colour: candidate.colour || '#b0bec5',
                            votes: 0,
                            stood: 0,
                            elected: 0
                        });
                    }
                    const constPartyStats = constituencyStats.partyStats.get(partyName);
                    constPartyStats.votes += candidate.firstPref;
                    constPartyStats.stood += 1;
                    if (candidate.elected) constPartyStats.elected += 1;
                }
            }
        });
    }

    _finalizeEntityIndex(index) {
        const sortDateDesc = (a, b) => String(b || '').localeCompare(String(a || ''));
        const sortDateAsc = (a, b) => String(a || '').localeCompare(String(b || ''));
        const buildPartyRowsForElectionSubset = (election, constituencyNames = []) => {
            const selectedNames = [...new Set((constituencyNames || []).filter(Boolean))];
            const useSubset = selectedNames.length > 0;
            const selectedConstituencies = useSubset
                ? selectedNames
                    .map((name) => election?.constituencyStats?.get(name))
                    .filter(Boolean)
                : [...(election?.constituencyStats?.values() || [])];

            const totalValid = selectedConstituencies.reduce((sum, constituency) => sum + (constituency.valid || 0), 0);
            const totalSeats = selectedConstituencies.reduce((sum, constituency) => sum + (constituency.seats || 0), 0);
            const partyStats = new Map();

            selectedConstituencies.forEach((constituency) => {
                constituency.partyStats.forEach((row, partyName) => {
                    if (!partyStats.has(partyName)) {
                        partyStats.set(partyName, {
                            party: partyName,
                            colour: row.colour || '#b0bec5',
                            votes: 0,
                            stood: 0,
                            elected: 0,
                            constituencies: new Set()
                        });
                    }
                    const partyRow = partyStats.get(partyName);
                    partyRow.votes += row.votes || 0;
                    partyRow.stood += row.stood || 0;
                    partyRow.elected += row.elected || 0;
                    if (constituency.name) partyRow.constituencies.add(constituency.name);
                });
            });

            const partyRows = [...partyStats.values()].map((row) => ({
                ...row,
                constituenciesContested: row.constituencies.size,
                validVotePct: totalValid > 0 ? (row.votes / totalValid * 100) : 0,
                seatPct: totalSeats > 0 ? (row.elected / totalSeats * 100) : 0
            })).sort((a, b) =>
                (b.elected - a.elected)
                || (b.votes - a.votes)
                || String(a.party || '').localeCompare(String(b.party || ''))
            );

            partyRows.forEach((row, idx) => {
                row.rank = idx + 1;
            });

            return {
                totalValid,
                totalSeats,
                totalConstituencies: selectedConstituencies.length,
                partyRows,
                partyRowByName: new Map(partyRows.map((row) => [row.party, row]))
            };
        };

        index.electionList = [...index.elections.values()].sort((a, b) =>
            String(b.date || '').localeCompare(String(a.date || '')) || String(a.body || '').localeCompare(String(b.body || ''))
        );

        index.electionList.forEach((election) => {
            const aggregate = buildPartyRowsForElectionSubset(election, []);
            election.partyRows = aggregate.partyRows;
            election.partyRowByName = aggregate.partyRowByName;
        });

        index.candidates.forEach((entry) => {
            entry.colour = [...entry.colours][0] || '#b0bec5';
            entry.parties = [...entry.parties].sort((a, b) => String(a).localeCompare(String(b)));
            entry.bodies = [...entry.bodies].sort((a, b) => String(a).localeCompare(String(b)));
            entry.dates = [...entry.dates].sort(sortDateDesc);
            entry.constituencies = [...entry.constituencies].sort((a, b) => String(a).localeCompare(String(b)));
            entry.shareOfAllValid = index.totalValid > 0 ? (entry.firstPrefs / index.totalValid * 100) : 0;

            const chronological = [...entry.appearances].sort((a, b) =>
                sortDateAsc(a.date, b.date)
                || String(a.body || '').localeCompare(String(b.body || ''))
                || String(a.constituency || '').localeCompare(String(b.constituency || ''))
            );
            let overallStanding = 0;
            let overallElected = 0;
            const bodyStanding = new Map();
            const bodyElected = new Map();
            chronological.forEach((appearance) => {
                overallStanding += 1;
                appearance.overallStandingNumber = overallStanding;
                const bodyCount = (bodyStanding.get(appearance.body) || 0) + 1;
                bodyStanding.set(appearance.body, bodyCount);
                appearance.bodyStandingNumber = bodyCount;
                if (appearance.elected) {
                    overallElected += 1;
                    appearance.overallElectedNumber = overallElected;
                    const bodyElectedCount = (bodyElected.get(appearance.body) || 0) + 1;
                    bodyElected.set(appearance.body, bodyElectedCount);
                    appearance.bodyElectedNumber = bodyElectedCount;
                } else {
                    appearance.overallElectedNumber = null;
                    appearance.bodyElectedNumber = null;
                }
                const electionMeta = index.elections.get(appearance.electionKey);
                appearance.electionDisplayName = electionMeta?.displayName || `${appearance.date} ${appearance.body}`;
                appearance.bodyLabel = electionMeta?.bodyLabel || this._getBodyElectionLabel(appearance.body);
                appearance.isByElection = !!electionMeta?.isByElection;
                appearance.comparisonBucket = this._getComparisonBucket(appearance.body);
                appearance.electionType = this._getElectionTypeLabel(appearance.body);
            });
            entry.appearances = chronological.sort((a, b) =>
                sortDateDesc(a.date, b.date)
                || String(a.body || '').localeCompare(String(b.body || ''))
                || b.firstPref - a.firstPref
            );
            entry.latestAppearance = entry.appearances[0] || null;
            entry.latestParty = entry.latestAppearance?.party || entry.parties[entry.parties.length - 1] || '';
            const candidateConstituencyMap = new Map();
            entry.appearances.forEach((appearance) => {
                const cleanedConstituency = this._cleanConstituencyDisplayName(appearance.constituency || '');
                const key = `${cleanedConstituency}::${appearance.mapLayerYear || ''}`;
                if (!candidateConstituencyMap.has(key)) {
                    candidateConstituencyMap.set(key, {
                        constituency: cleanedConstituency,
                        mapLayerYear: appearance.mapLayerYear || '',
                        elected: false,
                        body: appearance.body,
                        date: appearance.date
                    });
                }
                const constituencyEntry = candidateConstituencyMap.get(key);
                if (appearance.elected) constituencyEntry.elected = true;
                if (String(appearance.date || '') > String(constituencyEntry.date || '')) {
                    constituencyEntry.body = appearance.body;
                    constituencyEntry.date = appearance.date;
                }
            });
            entry.constituencyEntries = [...candidateConstituencyMap.values()].sort((a, b) =>
                Number(b.elected) - Number(a.elected)
                || String(a.constituency || '').localeCompare(String(b.constituency || ''), undefined, { sensitivity: 'base', numeric: true })
                || String(a.mapLayerYear || '').localeCompare(String(b.mapLayerYear || ''))
            );
            delete entry.colours;
        });

        index.parties.forEach((entry) => {
            entry.colour = [...entry.colours][0] || '#b0bec5';
            entry.bodies = [...entry.bodies].sort((a, b) => String(a).localeCompare(String(b)));
            entry.dates = [...entry.dates].sort(sortDateDesc);
            entry.constituencies = [...entry.constituencies].sort((a, b) => String(a).localeCompare(String(b)));
            entry.shareOfAllValid = index.totalValid > 0 ? (entry.firstPrefs / index.totalValid * 100) : 0;
            delete entry.colours;

            // Precompute NI-wide local-government baselines by date so party history can
            // collapse general local elections to one row per date.
            const localTotalsByDate = new Map();
            const localPartyTotalsByDate = new Map();
            const localLoadBodyByDate = new Map();
            index.electionList.forEach((election) => {
                if (!this._isLocalGovernmentBody(election.body) || election.isByElection) return;
                if (!localTotalsByDate.has(election.date)) {
                    localTotalsByDate.set(election.date, { totalValid: 0, totalSeats: 0, totalConstituencies: 0 });
                }
                if (!localLoadBodyByDate.has(election.date)) {
                    // Keep one canonical council body per date so collapsed rows can open the election.
                    localLoadBodyByDate.set(election.date, election.body);
                }
                const totals = localTotalsByDate.get(election.date);
                totals.totalValid += election.totalValid || 0;
                totals.totalSeats += election.totalSeats || 0;
                totals.totalConstituencies += (election.constituencies || []).length;

                if (!localPartyTotalsByDate.has(election.date)) {
                    localPartyTotalsByDate.set(election.date, new Map());
                }
                const partyTotals = localPartyTotalsByDate.get(election.date);
                (election.partyRows || []).forEach((row) => {
                    const key = String(row.party || '');
                    if (!partyTotals.has(key)) {
                        partyTotals.set(key, { elected: 0, votes: 0 });
                    }
                    const pt = partyTotals.get(key);
                    pt.elected += row.elected || 0;
                    pt.votes += row.votes || 0;
                });
            });
            const localPartyRankByDate = new Map();
            localPartyTotalsByDate.forEach((partyTotals, date) => {
                const ranked = [...partyTotals.entries()]
                    .sort((a, b) =>
                        (b[1].elected - a[1].elected)
                        || (b[1].votes - a[1].votes)
                        || String(a[0]).localeCompare(String(b[0]))
                    );
                const rankMap = new Map();
                ranked.forEach(([party], idx) => rankMap.set(party, idx + 1));
                localPartyRankByDate.set(date, rankMap);
            });

            const contestedBodies = new Set(entry.candidates.map((candidate) => candidate.body).filter(Boolean));
            const lastContestedByBody = new Map();
            const firstContestedByBody = new Map();
            entry.candidates.forEach((candidate) => {
                const currentLast = lastContestedByBody.get(candidate.body);
                if (!currentLast || String(candidate.date || '') > String(currentLast)) {
                    lastContestedByBody.set(candidate.body, candidate.date);
                }
                const currentFirst = firstContestedByBody.get(candidate.body);
                if (!currentFirst || String(candidate.date || '') < String(currentFirst)) {
                    firstContestedByBody.set(candidate.body, candidate.date);
                }
            });

            const rawHistoryRows = index.electionList
                .filter((election) => contestedBodies.has(election.body))
                .filter((election) => String(election.date || '') >= String(firstContestedByBody.get(election.body) || ''))
                .filter((election) => String(election.date || '') <= String(lastContestedByBody.get(election.body) || ''))
                .map((election) => {
                    const contested = election.partyRowByName.has(entry.name);
                    const contestedRow = election.partyRowByName.get(entry.name);
                    return {
                        electionKey: election.key,
                        body: election.body,
                        bodyLabel: election.bodyLabel,
                        comparisonBucket: this._getComparisonBucket(election.body),
                        electionType: this._getElectionTypeLabel(election.body),
                        date: election.date,
                        electionDisplayName: election.displayName,
                        isByElection: !!election.isByElection,
                        isRecallPetition: this._isRecallPetitionElection(election.body, election.date, election.displayName),
                        constituencyNames: [...(election.constituencies || [])],
                        contested,
                        stood: contested ? contestedRow.stood : 0,
                        constituenciesContested: contested ? contestedRow.constituenciesContested : 0,
                        totalConstituencies: (election.constituencies || []).length,
                        firstPrefs: contested ? contestedRow.votes : 0,
                        validVotePct: contested ? contestedRow.validVotePct : 0,
                        elected: contested ? contestedRow.elected : 0,
                        totalSeats: election.totalSeats,
                        seatPct: contested ? contestedRow.seatPct : 0,
                        rank: contested ? contestedRow.rank : null,
                        note: contested ? '' : 'N/A'
                    };
                });

            // Collapse general local elections to one row per date.
            // Keep by-elections unchanged (one row per by-election body/date).
            const collapsedLocalByDate = new Map();
            const preservedRows = [];
            rawHistoryRows.forEach((row) => {
                const isLocal = this._isLocalGovernmentBody(row.body);
                if (!isLocal || row.isByElection) {
                    preservedRows.push(row);
                    return;
                }
                if (!collapsedLocalByDate.has(row.date)) {
                    collapsedLocalByDate.set(row.date, {
                        electionKey: `local-government|${row.date}`,
                        body: 'Local Government Districts',
                        bodyLabel: 'Local Government Districts',
                        comparisonBucket: 'local',
                        electionType: 'Local',
                        electionBodyForOpen: localLoadBodyByDate.get(row.date) || ElectionController.LOCAL_GOVERNMENT_BODIES[0],
                        date: row.date,
                        electionDisplayName: this._localElectionTitle(row.date),
                        isByElection: false,
                        isRecallPetition: false,
                        constituencyNames: [],
                        contested: false,
                        stood: 0,
                        constituenciesContested: 0,
                        totalConstituencies: localTotalsByDate.get(row.date)?.totalConstituencies || 0,
                        firstPrefs: 0,
                        validVotePct: 0,
                        elected: 0,
                        totalSeats: localTotalsByDate.get(row.date)?.totalSeats || 0,
                        seatPct: 0,
                        rank: null,
                        note: 'N/A'
                    });
                }
                const grouped = collapsedLocalByDate.get(row.date);
                grouped.contested = grouped.contested || row.contested;
                grouped.stood += row.stood || 0;
                grouped.constituenciesContested += row.constituenciesContested || 0;
                grouped.firstPrefs += row.firstPrefs || 0;
                grouped.elected += row.elected || 0;
                grouped.constituencyNames.push(...(row.constituencyNames || []));
            });

            const collapsedLocalRows = [...collapsedLocalByDate.values()].map((row) => {
                const totals = localTotalsByDate.get(row.date) || { totalValid: 0, totalSeats: 0 };
                row.constituencyNames = [...new Set(row.constituencyNames)].sort((a, b) => String(a).localeCompare(String(b)));
                row.validVotePct = totals.totalValid > 0 ? (row.firstPrefs / totals.totalValid * 100) : 0;
                row.seatPct = totals.totalSeats > 0 ? (row.elected / totals.totalSeats * 100) : 0;
                row.rank = localPartyRankByDate.get(row.date)?.get(entry.name) ?? null;
                row.note = row.contested ? '' : 'N/A';
                return row;
            });

            entry.historyRows = [...preservedRows, ...collapsedLocalRows].sort((a, b) =>
                String(b.date || '').localeCompare(String(a.date || ''))
                || String(a.body || '').localeCompare(String(b.body || ''))
            );

            // Guardrail: non-local rows must keep their canonical election labels.
            // This prevents any local-collapsing labels from leaking into Assembly/Westminster/etc rows.
            entry.historyRows.forEach((row) => {
                if (this._isLocalGovernmentBody(row.body) || row.isByElection) return;
                const canonical = index.elections.get(row.electionKey);
                if (!canonical) return;
                row.body = canonical.body || row.body;
                row.bodyLabel = canonical.bodyLabel || row.bodyLabel;
                row.electionDisplayName = canonical.displayName || row.electionDisplayName;
                row.isByElection = !!canonical.isByElection;
                row.electionType = this._getElectionTypeLabel(row.body);
                row.comparisonBucket = this._getComparisonBucket(row.body);
                row.isRecallPetition = this._isRecallPetitionElection(row.body, row.date, row.electionDisplayName);
            });

            // Normalize election-history display names (non-by-elections):
            // [Westminster/Assembly/European/Forum/Convention/local] [year|Mon YYYY if disambiguation needed]
            const nonBy = entry.historyRows.filter((row) => !row.isByElection);
            const typeYearCounts = new Map();
            nonBy.forEach((row) => {
                const prefix = this._getElectionHistoryPrefix(row.body);
                const year = String(row.date || '').slice(0, 4);
                const key = `${prefix}::${year}`;
                typeYearCounts.set(key, (typeYearCounts.get(key) || 0) + 1);
            });
            nonBy.forEach((row) => {
                const prefix = this._getElectionHistoryPrefix(row.body);
                const year = String(row.date || '').slice(0, 4);
                const key = `${prefix}::${year}`;
                const includeMonth = (typeYearCounts.get(key) || 0) > 1;
                const token = this._formatElectionHistoryDateToken(row.date, includeMonth);
                row.electionDisplayName = `${prefix} ${token}`;
            });

            const byRows = entry.historyRows.filter((row) => row.isByElection && !row.isRecallPetition);
            const byElectionCountsByYearConstituency = new Map();
            byRows.forEach((row) => {
                if ((row.constituencyNames || []).length !== 1) return;
                const year = String(row.date || '').slice(0, 4);
                const constituencyName = row.constituencyNames[0] || '';
                const key = `${row.body}::${constituencyName}::${year}`;
                byElectionCountsByYearConstituency.set(key, (byElectionCountsByYearConstituency.get(key) || 0) + 1);
            });
            byRows.forEach((row) => {
                const prefix = this._getElectionHistoryPrefix(row.body);
                const constituencyNames = row.constituencyNames || [];
                const year = String(row.date || '').slice(0, 4);
                if (constituencyNames.length > 1) {
                    row.electionDisplayName = `${year} ${prefix} by-elections`;
                    return;
                }
                const constituencyName = constituencyNames[0] || '';
                const duplicateKey = `${row.body}::${constituencyName}::${year}`;
                const includeMonth = (byElectionCountsByYearConstituency.get(duplicateKey) || 0) > 1;
                const token = this._formatElectionHistoryDateToken(row.date, includeMonth);
                row.electionDisplayName = constituencyName
                    ? `${token} ${constituencyName} by-election`
                    : `${token} ${prefix} by-election`;
            });

            const previousRowsByBucket = new Map();
            [...entry.historyRows].reverse().forEach((row) => {
                const bucket = row.comparisonBucket || row.body;
                const priorState = previousRowsByBucket.get(bucket) || { allRows: [], generalRows: [] };
                const priorRows = priorState.allRows;
                const priorGeneralRows = priorState.generalRows;
                const previous = priorRows[priorRows.length - 1] || null;
                let baseline = row.isByElection
                    ? previous
                    : (priorGeneralRows[priorGeneralRows.length - 1] || null);

                if (row.isRecallPetition) {
                    row.stoodDelta = null;
                    row.constituenciesContestedDelta = null;
                    row.totalConstituenciesDelta = null;
                    row.firstPrefsDelta = null;
                    row.validVotePctDelta = null;
                    row.electedDelta = null;
                    row.totalSeatsDelta = null;
                    row.seatPctDelta = null;
                    row.rankDelta = null;
                    return;
                }

                if (row.isByElection && priorRows.length > 0) {
                    const matchingPrevious = [...priorRows].reverse().find((candidateRow) =>
                        (row.constituencyNames || []).every((name) => (candidateRow.constituencyNames || []).includes(name))
                    ) || [...priorGeneralRows].reverse().find((candidateRow) =>
                        (row.constituencyNames || []).every((name) => (candidateRow.constituencyNames || []).includes(name))
                    ) || previous;
                    const previousElection = matchingPrevious ? index.elections.get(matchingPrevious.electionKey) : null;
                    const subsetAggregate = buildPartyRowsForElectionSubset(previousElection, row.constituencyNames || []);
                    const subsetPartyRow = subsetAggregate.partyRowByName.get(entry.name);
                    baseline = {
                        stood: subsetPartyRow?.stood || 0,
                        constituenciesContested: subsetPartyRow?.constituenciesContested || 0,
                        totalConstituencies: subsetAggregate.totalConstituencies || 0,
                        firstPrefs: subsetPartyRow?.votes || 0,
                        validVotePct: subsetPartyRow?.validVotePct || 0,
                        elected: subsetPartyRow?.elected || 0,
                        totalSeats: subsetAggregate.totalSeats || 0,
                        seatPct: subsetPartyRow?.seatPct || 0,
                        rank: subsetPartyRow?.rank ?? null
                    };
                }

                row.stoodDelta = baseline ? row.stood - baseline.stood : null;
                row.constituenciesContestedDelta = baseline ? row.constituenciesContested - baseline.constituenciesContested : null;
                row.totalConstituenciesDelta = baseline ? row.totalConstituencies - baseline.totalConstituencies : null;
                row.firstPrefsDelta = baseline ? row.firstPrefs - baseline.firstPrefs : null;
                row.validVotePctDelta = baseline ? row.validVotePct - baseline.validVotePct : null;
                row.electedDelta = baseline ? row.elected - baseline.elected : null;
                row.totalSeatsDelta = baseline ? row.totalSeats - baseline.totalSeats : null;
                row.seatPctDelta = baseline ? row.seatPct - baseline.seatPct : null;
                row.rankDelta = baseline && row.rank !== null && baseline.rank !== null ? baseline.rank - row.rank : null;
                if (row.isByElection) {
                    // Do not show total-seat / total-constituency deltas for by-elections/recall-style contests.
                    row.totalConstituenciesDelta = null;
                    row.totalSeatsDelta = null;
                }
                priorRows.push(row);
                if (!row.isByElection) {
                    priorGeneralRows.push(row);
                }
                previousRowsByBucket.set(bucket, { allRows: priorRows, generalRows: priorGeneralRows });
            });

            const partyCandidateMap = new Map();
            entry.candidates.forEach((appearance) => {
                if (!partyCandidateMap.has(appearance.personId)) {
                    partyCandidateMap.set(appearance.personId, {
                        personId: appearance.personId,
                        name: appearance.name,
                        timesStood: 0,
                        timesStoodLocal: 0,
                        timesStoodWestminster: 0,
                        timesStoodDevolved: 0,
                        timesStoodEuropean: 0,
                        timesElected: 0,
                        timesElectedLocal: 0,
                        timesElectedWestminster: 0,
                        timesElectedDevolved: 0,
                        timesElectedEuropean: 0,
                        totalFirstPrefs: 0,
                        constituencyEntries: new Map()
                    });
                }
                const row = partyCandidateMap.get(appearance.personId);
                row.timesStood += 1;
                row.totalFirstPrefs += appearance.firstPref || 0;
                const isWestminster = appearance.body === 'House of Commons of the United Kingdom';
                const isEuropean = appearance.body === 'European Parliament';
                const isLocal = this._isLocalGovernmentBody(appearance.body);
                const isDevolved = [
                    'Northern Ireland Assembly',
                    'Northern Ireland Forum for Political Dialogue',
                    'Northern Ireland Constitutional Convention'
                ].includes(appearance.body);
                if (isLocal) row.timesStoodLocal = (row.timesStoodLocal || 0) + 1;
                if (isWestminster) row.timesStoodWestminster += 1;
                if (isDevolved) row.timesStoodDevolved += 1;
                if (isEuropean) row.timesStoodEuropean += 1;
                const cleanedConstituency = this._cleanConstituencyDisplayName(appearance.constituency || '');
                const constituencyKey = `${cleanedConstituency}::${appearance.mapLayerYear || ''}`;
                if (!row.constituencyEntries.has(constituencyKey)) {
                    row.constituencyEntries.set(constituencyKey, {
                        constituency: cleanedConstituency,
                        mapLayerYear: appearance.mapLayerYear || '',
                        elected: false,
                        body: appearance.body,
                        date: appearance.date
                    });
                }
                const constituencyEntry = row.constituencyEntries.get(constituencyKey);
                if (appearance.elected) constituencyEntry.elected = true;
                if (String(appearance.date || '') > String(constituencyEntry.date || '')) {
                    constituencyEntry.body = appearance.body;
                    constituencyEntry.date = appearance.date;
                }
                if (String(appearance.status || '').toLowerCase().startsWith('elected')) {
                    row.timesElected += 1;
                    if (isLocal) row.timesElectedLocal = (row.timesElectedLocal || 0) + 1;
                    if (isWestminster) row.timesElectedWestminster += 1;
                    if (isDevolved) row.timesElectedDevolved += 1;
                    if (isEuropean) row.timesElectedEuropean += 1;
                }
            });
            entry.candidateSummaries = [...partyCandidateMap.values()].map((row) => ({
                ...row,
                constituencyEntries: [...row.constituencyEntries.values()].sort((a, b) =>
                    Number(b.elected) - Number(a.elected)
                    || String(a.constituency || '').localeCompare(String(b.constituency || ''), undefined, { sensitivity: 'base', numeric: true })
                    || String(a.mapLayerYear || '').localeCompare(String(b.mapLayerYear || ''))
                )
            })).sort((a, b) =>
                (b.totalFirstPrefs - a.totalFirstPrefs)
                || (b.timesElected - a.timesElected)
                || String(a.name || '').localeCompare(String(b.name || ''))
            );

            const latestByBody = (bodyName) => entry.historyRows.find((row) => row.contested && row.body === bodyName) || null;
            entry.latestWestminster = latestByBody('House of Commons of the United Kingdom');
            entry.latestAssembly = latestByBody('Northern Ireland Assembly');
        });
        return index;
    }

    async _loadGlobalElectionEntityIndex() {
        if (this._globalEntityIndex) return this._globalEntityIndex;
        if (this._globalEntityIndexPromise) return this._globalEntityIndexPromise;

        this._globalEntityIndexPromise = (async () => {
            const indexData = await this._loadIndex();
            const aggregate = this._createEmptyEntityIndex();
            const elections = this._buildElectionTimeline(indexData);
            elections.forEach((election) => {
                aggregate.elections.set(election.key, {
                    ...election,
                    totalValid: 0,
                    totalSeats: 0,
                    partyStats: new Map()
                });
            });
            for (const bodyData of indexData?.bodies || []) {
                for (const dateData of bodyData?.dates || []) {
                    const loadSlug = bodyData.slug || bodyData.name;
                    const results = await this._loadAllResults(loadSlug, dateData.date, dateData.constituencies || [], {}, false);
                    Object.entries(results).forEach(([constName, payload]) => {
                        this._accumulateEntityIndex(aggregate, payload, {
                            constituency: constName,
                            body: bodyData.name,
                            date: dateData.date
                        });
                    });
                }
            }
            this._globalEntityIndex = this._finalizeEntityIndex(aggregate);
            return this._globalEntityIndex;
        })();
        return this._globalEntityIndexPromise;
    }

    async getElectionEntityDetail(kind, key) {
        const index = await this._loadGlobalElectionEntityIndex();
        if (kind === 'candidate') {
            return index.candidates.get(String(key || '').trim()) || null;
        }
        if (kind === 'party') {
            return index.parties.get(String(key || '').trim()) || null;
        }
        if (kind === 'dea' || kind === 'lgd') {
            return this._buildLocalAreaEntityDetail(index, kind, key);
        }
        return null;
    }

    _buildLocalAreaEntityDetail(index, kind, key) {
        const target = String(key || '').trim();
        if (!target) return null;

        const localElectionList = (index?.electionList || []).filter((election) =>
            this._isLocalGovernmentBody(election.body)
        );
        if (!localElectionList.length) return null;

        if (kind === 'dea') {
            const historyRows = [];
            localElectionList.forEach((election) => {
                const electionMeta = index.elections?.get(election.key);
                const constituencyStats = electionMeta?.constituencyStats?.get(target);
                if (!constituencyStats) return;
                const partyRows = [...(constituencyStats.partyStats?.values?.() || [])].sort((a, b) =>
                    (b.elected - a.elected)
                    || (b.votes - a.votes)
                    || String(a.party || '').localeCompare(String(b.party || ''))
                );
                const winner = partyRows[0] || null;
                historyRows.push({
                    electionKey: election.key,
                    body: election.body,
                    date: election.date,
                    electionDisplayName: election.displayName,
                    isByElection: !!election.isByElection,
                    districtElectoralArea: target,
                    localGovernmentDistrict: election.body,
                    validVotes: constituencyStats.valid || 0,
                    seats: constituencyStats.seats || 0,
                    winnerParty: winner?.party || '',
                    winnerColour: winner?.colour || '#b0bec5',
                    winnerVotes: winner?.votes || 0,
                    winnerPct: (constituencyStats.valid || 0) > 0 ? ((winner?.votes || 0) / constituencyStats.valid * 100) : 0
                });
            });

            historyRows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
            if (!historyRows.length) return null;

            const allDistricts = [...new Set(historyRows.map((row) => row.localGovernmentDistrict).filter(Boolean))]
                .sort((a, b) => String(a).localeCompare(String(b)));
            const totalValidVotes = historyRows.reduce((sum, row) => sum + (row.validVotes || 0), 0);
            const totalSeats = historyRows.reduce((sum, row) => sum + (row.seats || 0), 0);
            const latest = historyRows[0] || null;

            return {
                kind: 'dea',
                key: target,
                name: target,
                colour: '#3d6ea8',
                subtitle: 'District Electoral Area',
                metrics: {
                    elections: historyRows.length,
                    districts: allDistricts.length,
                    totalValidVotes,
                    totalSeats,
                    latestDate: latest?.date || ''
                },
                districts: allDistricts,
                historyRows
            };
        }

        if (kind === 'lgd') {
            const historyRows = [];
            localElectionList
                .filter((election) => election.body === target)
                .forEach((election) => {
                    const electionMeta = index.elections?.get(election.key);
                    if (!electionMeta) return;
                    const partyRows = [...(electionMeta.partyRows || [])];
                    const winner = partyRows[0] || null;
                    historyRows.push({
                        electionKey: election.key,
                        body: election.body,
                        date: election.date,
                        electionDisplayName: election.displayName,
                        isByElection: !!election.isByElection,
                        districtElectoralAreas: [...(election.constituencies || [])].sort((a, b) => String(a).localeCompare(String(b))),
                        deaCount: (election.constituencies || []).length,
                        validVotes: electionMeta.totalValid || 0,
                        seats: electionMeta.totalSeats || 0,
                        winnerParty: winner?.party || '',
                        winnerColour: winner?.colour || '#b0bec5',
                        winnerVotes: winner?.votes || 0,
                        winnerPct: (electionMeta.totalValid || 0) > 0 ? ((winner?.votes || 0) / electionMeta.totalValid * 100) : 0
                    });
                });

            historyRows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
            if (!historyRows.length) return null;

            const allDeas = new Set();
            historyRows.forEach((row) => {
                (row.districtElectoralAreas || []).forEach((dea) => allDeas.add(dea));
            });
            const totalValidVotes = historyRows.reduce((sum, row) => sum + (row.validVotes || 0), 0);
            const totalSeats = historyRows.reduce((sum, row) => sum + (row.seats || 0), 0);
            const latest = historyRows[0] || null;

            return {
                kind: 'lgd',
                key: target,
                name: target,
                colour: '#2f6d5a',
                subtitle: 'Local Government District',
                metrics: {
                    elections: historyRows.length,
                    deas: allDeas.size,
                    totalValidVotes,
                    totalSeats,
                    latestDate: latest?.date || ''
                },
                historyRows
            };
        }

        return null;
    }

    // â”€â”€â”€ Geography Loading â”€â”€â”€

    async _loadGeography(geo) {
        try {
            // Start with LOD-1 (medium detail) for faster initial load, upgrade on zoom
            const initialZoom = mapController.map?.getZoom?.() ?? 8;
            const initialFgb = this._getLODPath(geo.fgb, Math.min(initialZoom, 10));
            this._currentLodLevel = mapController.getLODLevel(Math.min(initialZoom, 10));
            this._currentLodBaseFgb = geo.fgb;

            let features;
            try {
                features = await this._getGeometryFeatures(initialFgb);
            } catch (lodErr) {
                // LOD file may not exist — fall back to full resolution
                if (initialFgb !== geo.fgb) {
                    features = await this._getGeometryFeatures(geo.fgb);
                    this._currentLodLevel = 2;
                } else {
                    throw lodErr;
                }
            }

            const geojson = { type: 'FeatureCollection', features };

            // Create Leaflet layer (style extracted to _buildGeoStyle for LOD upgrade reuse)
            this.geojsonLayer = L.geoJSON(geojson, this._buildGeoStyle(geo));

            this.geojsonLayer.addTo(mapController.map);
            mapController.map.fitBounds(this.geojsonLayer.getBounds(), { padding: [20, 20] });

            // LOD upgrade: replace geometry with full-res when user zooms in
            if (this._currentLodLevel < 2) {
                this._onZoomEnd = async () => {
                    const zoom = mapController.map.getZoom();
                    if (zoom >= 12 && this._currentLodLevel < 2 && this._currentLodBaseFgb) {
                        this._currentLodLevel = 2;
                        mapController.map.off('zoomend', this._onZoomEnd);
                        try {
                            const fullFeatures = await this._getGeometryFeatures(this._currentLodBaseFgb);
                            if (!this.geojsonLayer) return; // election was cleared
                            const activeGeo = this._getActiveGeography(this._currentGeo);
                            const bounds = mapController.map.getBounds();
                            mapController.map.removeLayer(this.geojsonLayer);
                            this.geojsonLayer = null;
                            // Rebuild the layer from full-res features (reuses _loadGeography style)
                            const geojson = { type: 'FeatureCollection', features: fullFeatures };
                            this.geojsonLayer = L.geoJSON(geojson, this._buildGeoStyle(activeGeo));
                            // Re-tag feature layers after LOD upgrade rebuild
                            if (this._registeredLayerId) {
                                const regId = this._registeredLayerId;
                                this.geojsonLayer.eachLayer(layer => { layer._mapId = regId; });
                            }
                            this.geojsonLayer.addTo(mapController.map);
                            this._colourMap(activeGeo);
                            mapController.map.fitBounds(bounds); // preserve viewport
                        } catch (err) {
                            console.warn('[Election] LOD upgrade failed:', err);
                        }
                    }
                };
                mapController.map.on('zoomend', this._onZoomEnd);
            }

            // Register as a synthetic layer so it appears in Active Layers
            this._registerActiveLayer();
        } catch (err) {
            console.error('[Election] Failed to load geography:', err);
        }
    }

    /**
     * Resolve LOD file path for a base FGB path.
     */
    _getLODPath(baseFgbPath, zoom) {
        const lod = mapController.getLODLevel(zoom);
        if (lod >= 2) return baseFgbPath;
        return baseFgbPath.replace(/\.fgb$/i, `-lod${lod}.fgb`);
    }

    /**
     * Build the Leaflet GeoJSON style/options object for election geography.
     * Extracted so LOD upgrades can rebuild the layer with the same style.
     */
    _buildGeoStyle(geo) {
        return {
            style: () => ({
                fillColor: '#dfe4ec',
                fillOpacity: 0.42,
                color: '#a1aab8',
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
                    layer.on('mouseover', () => {
                        layer._preHoverStyle = {
                            color: layer.options?.color || '#555',
                            weight: layer.options?.weight || 1.5
                        };
                        if (layer._hoverShadow) {
                            mapController.map.removeLayer(layer._hoverShadow);
                        }
                        layer._hoverShadow = L.geoJSON(layer.feature, {
                            style: { weight: 5, color: '#000', fill: false, opacity: 1 },
                            interactive: false
                        });
                        layer._hoverShadow.addTo(mapController.map);
                        layer.setStyle({ color: '#fff', weight: 3 });
                        layer.bringToFront();
                    });
                    layer.on('mouseout', () => {
                        if (layer._hoverShadow) {
                            mapController.map.removeLayer(layer._hoverShadow);
                            layer._hoverShadow = null;
                        }
                        const prev = layer._preHoverStyle || { color: '#555', weight: 1.5 };
                        layer.setStyle({ color: prev.color, weight: prev.weight });
                    });
                }
            }
        };
    }

    // â”€â”€â”€ Map Colouring â”€â”€â”€


    async _getGeometryFeatures(fgbPath) {
        if (this._geometryFeatureCache.has(fgbPath)) return this._geometryFeatureCache.get(fgbPath);
        if (this._geometryFeaturePromiseCache.has(fgbPath)) return this._geometryFeaturePromiseCache.get(fgbPath);

        const promise = (async () => {
            const features = [];
            let source = null;

            // Try pre-compressed .fgb.gz first (Pako decompression)
            if (typeof pako !== 'undefined' && fgbPath.toLowerCase().endsWith('.fgb')) {
                try {
                    const gzResponse = await fetch(fgbPath + '.gz');
                    if (gzResponse.ok) {
                        const compressed = new Uint8Array(await gzResponse.arrayBuffer());
                        const decompressed = pako.ungzip(compressed);
                        source = decompressed;
                    }
                } catch (gzErr) {
                    // .gz not available or decompression failed — fall back to uncompressed
                }
            }

            if (!source) {
                const response = await fetch(fgbPath);
                source = response.body || new Uint8Array(await response.arrayBuffer());
            }

            for await (const feature of flatgeobuf.deserialize(source)) {
                features.push(feature);
            }
            this._geometryFeatureCache.set(fgbPath, features);
            return features;
        })();

        this._geometryFeaturePromiseCache.set(fgbPath, promise);
        try {
            return await promise;
        } finally {
            this._geometryFeaturePromiseCache.delete(fgbPath);
        }
    }
    _colourMap(geo) {
        if (!this.geojsonLayer) return;

        if (this._specialElection?.type === 'recall-petition') {
            this.geojsonLayer.eachLayer(layer => {
                const featureName = layer.feature?.properties?.[geo.nameAttr];
                if (!featureName) return;

                const constName = this._matchConstituency(featureName);
                if (constName === this._specialElection.constituency) {
                    layer.setStyle({
                        fillColor: this._specialElection.fillColor,
                        fillOpacity: 0.62,
                        color: this._specialElection.outlineColor,
                        weight: 1.5,
                        opacity: 0.9
                    });
                } else {
                    layer.setStyle({
                        fillColor: '#dfe4ec',
                        fillOpacity: 0.42,
                        color: '#aeb6c3',
                        weight: 1.1,
                        opacity: 0.9
                    });
                }
            });
            return;
        }

        this.geojsonLayer.eachLayer(layer => {
            const featureName = layer.feature?.properties?.[geo.nameAttr];
            if (!featureName) return;

            // Find matching constituency (case-insensitive)
            const constName = this._matchConstituency(featureName);
            if (!constName) return;
            const winner = this._isCouncilMode()
                ? (() => {
                    const aggregate = this._councilAggregates?.get(constName);
                    const sorted = [...(aggregate?.parties || [])].sort((a, b) =>
                        b.elected - a.elected || b.firstPrefs - a.firstPrefs || String(a.party || '').localeCompare(String(b.party || ''))
                    );
                    return sorted.length ? { party: sorted[0].party, colour: sorted[0].colour } : null;
                })()
                : this._getWinner(this._getCurrentConstituencyPayload(constName));
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
                const party = this._normaliseLivePartyName(row.Party_Name);
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
        if (!fgbName) return null;
        const aliases = this._isCouncilMode() ? this._councilAliases : this._constituencyAliases;
        for (const variant of this._aliasVariants(fgbName)) {
            const hit = aliases.get(variant);
            if (hit) return hit;
        }
        return null;
    }

    _titleCase(str) {
        return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    // â”€â”€â”€ Overlays (Seat Circles) â”€â”€â”€

    /**
     * Extract all elected members from countGroup, including "deemed elected"
     * (those remaining at the final count who were never excluded).
     * Returns array sorted by election order, capped at numSeats.
     */
    _extractElected(result) {
        const cg = result.Constituency?.countGroup;
        if (!cg) return [];

        const info = result.Constituency?.countInfo || {};
        const numSeats = this._getSeatCount(info) || 5;
        const elected = [];
        const excluded = new Set();
        const seen = new Set();
        const lastCount = Math.max(...cg.map(r => +r.Count_Number || 0));
        const grouped = new Map();

        cg.forEach((row) => {
            const cid = row.Candidate_Id;
            if (!cid || String(cid).toLowerCase() === 'nontransferable') return;
            if (!grouped.has(cid)) {
                grouped.set(cid, {
                    rows: [],
                    name: this._candidateDisplayName(row),
                    party: this._normaliseLivePartyName(row.Party_Name),
                    colour: row.Party_Colour || '#b0bec5'
                });
            }
            grouped.get(cid).rows.push(row);
        });

        // Pass 1: collect explicitly elected candidates and track excluded
        grouped.forEach((entry, cid) => {
            const candidate = { counts: {} };
            entry.rows.forEach((row) => {
                candidate.counts[parseInt(row.Count_Number, 10) || 1] = {
                    total: parseFloat(row.Total_Votes) || 0,
                    transfers: parseFloat(row.Transfers) || 0,
                    status: row.Status || ''
                };
                if (this._statusKind(row.Status) === 'excluded') excluded.add(cid);
            });
            const lifecycle = this._inferCandidateLifecycle(candidate, info, lastCount);
            if (lifecycle.electedAt && !seen.has(cid)) {
                seen.add(cid);
                elected.push({
                    name: entry.name,
                    party: entry.party,
                    colour: entry.colour,
                    count: lifecycle.electedAt
                });
            }
        });

        // Pass 2: add "deemed elected" â€” candidates remaining at final count
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
                        name: this._candidateDisplayName(row),
                        party: this._normaliseLivePartyName(row.Party_Name),
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
        if (this._specialElection?.type === 'recall-petition') {
            this.overlayLayer = L.layerGroup().addTo(mapController.map);
            this.geojsonLayer.eachLayer(layer => {
                const featureName = layer.feature?.properties?.[geo.nameAttr];
                if (!featureName) return;
                const constName = this._matchConstituency(featureName);
                if (constName !== this._specialElection.constituency) return;
                const centroid = layer.getBounds().getCenter();
                const labelWidth = 108;
                const icon = L.divIcon({
                    className: 'map-label',
                    html: `<div style="color:${this._esc(this._specialElection.fillColor)};text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff;font-weight:bold;font-size:13px;text-align:center;width:${labelWidth}px;word-break:keep-all;overflow-wrap:normal;position:absolute;left:50%;transform:translateX(-50%);">Petition not successful</div>`,
                    iconSize: null,
                    iconAnchor: [0, 0]
                });
                const marker = L.marker(centroid, { icon, interactive: false });
                marker.addTo(this.overlayLayer);
            });
            return;
        }
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
            const result = this._isCouncilMode()
                ? this._councilAggregates?.get(constName)
                : this._getCurrentConstituencyPayload(constName);
            if (!result) return;

            const bounds = layer.getBounds();
            const centroid = bounds.getCenter();
            const elected = this._isCouncilMode()
                ? (result.electedMembers || [])
                : this._extractElected(result);
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

        // Rule 3: Absolute minimum â€” if all constituencies together are tiny, hide all.
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
            return; // Too zoomed out â€” hide everything
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
                const minX = Math.min(...group.positions.map(p => p.x));
                const minY = Math.min(...group.positions.map(p => p.y));
                const left = pos.x - minX;
                const top = pos.y - minY;
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
        if (n > 12) {
            const spanRadians = Math.PI;
            const getRowsFromNRows = (nRows) => {
                const rowThicc = 1 / ((4 * nRows) - 2);
                return Array.from({ length: nRows }, (_, r) => {
                    const rowArcRadius = 0.5 + (2 * r * rowThicc);
                    return Math.max(1, Math.floor((spanRadians * rowArcRadius) / (2 * rowThicc)));
                });
            };
            let nRows = 1;
            let capacities = getRowsFromNRows(nRows);
            while (capacities.reduce((sum, value) => sum + value, 0) < n) {
                nRows += 1;
                capacities = getRowsFromNRows(nRows);
            }

            const totalCapacity = capacities.reduce((sum, value) => sum + value, 0);
            const fillRatio = n / totalCapacity;
            const rowCounts = capacities.map((capacity) => Math.max(1, Math.round(capacity * fillRatio)));
            let assigned = rowCounts.reduce((sum, value) => sum + value, 0);
            while (assigned > n) {
                const idx = rowCounts.findLastIndex((count) => count > 1);
                if (idx < 0) break;
                rowCounts[idx] -= 1;
                assigned -= 1;
            }
            while (assigned < n) {
                const target = capacities
                    .map((capacity, idx) => ({ idx, deficit: capacity - rowCounts[idx] }))
                    .filter((item) => item.deficit > 0)
                    .sort((a, b) => b.deficit - a.deficit)[0];
                if (!target) break;
                rowCounts[target.idx] += 1;
                assigned += 1;
            }

            const rowThicc = 1 / ((4 * nRows) - 2);
            const desiredCenterSpacing = spacing * 1.02;
            const scale = desiredCenterSpacing / (2 * rowThicc);
            const positions = [];

            rowCounts.forEach((countOnRow, r) => {
                const rowArcRadius = 0.5 + (2 * r * rowThicc);
                if (countOnRow <= 0) return;
                if (countOnRow === 1) {
                    positions.push({ x: 1 * scale, y: 0 });
                    return;
                }
                const angleMargin = Math.asin(rowThicc / rowArcRadius);
                const angleIncrement = (Math.PI - (2 * angleMargin)) / (countOnRow - 1);
                for (let s = 0; s < countOnRow; s += 1) {
                    const angle = angleMargin + (s * angleIncrement);
                    positions.push({
                        x: ((rowArcRadius * Math.cos(angle)) + 1) * scale,
                        y: (-Math.sin(angle) * rowArcRadius) * scale
                    });
                }
            });

            const minX = Math.min(...positions.map(p => p.x));
            const minY = Math.min(...positions.map(p => p.y));
            positions.forEach((p) => {
                p.x -= minX;
                p.y -= minY;
            });
            positions.sort((a, b) => a.x - b.x || a.y - b.y);
            return positions;
        }

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

    // â”€â”€â”€ Split Pane â”€â”€â”€

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
                <h3 class="election-pane__title" id="electionPaneTitle">${this._esc(this._niWideTitle())}</h3>
                <div class="election-pane__header-right" id="electionPaneHeaderRight">
                    <button type="button" id="electionCloseBtn" data-action="close-election" class="election-pane__close" title="Close election">\u2715</button>
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

        if (!this._boundPaneClickHandler) {
            this._boundPaneClickHandler = (event) => {
                const target = event.target.closest('button[data-action]');
                if (!target) return;
                const action = target.dataset.action;
                if (action === 'close-election') {
                    event.preventDefault();
                    this.clear();
                } else if (action === 'set-results-mode') {
                    event.preventDefault();
                    this._setLocalResultsMode(target.dataset.mode || 'dea');
                }
            };
            this.splitPaneEl.addEventListener('click', this._boundPaneClickHandler);
        }

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

        // Tag feature layers so handleMapClick can identify the election layer
        if (this.geojsonLayer) {
            this.geojsonLayer.eachLayer(layer => { layer._mapId = id; });
        }

        // Create a synthetic map config for the UI
        this.electionMapConfig = {
            id,
            name: this._specialElection?.title
                ? `${this._specialElection.title} ${this._formatDate(this.date)}`
                : this._isLocalGovernmentBody()
                    ? this._localElectionTitle(this.date)
                    : `${this._shortBodyName(this.body)} ${this._formatDate(this.date)}`,
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
            useLOD: true,
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

    _suppressNonElectionLayers() {
        mapController.layerStates.forEach((state, id) => {
            if (!state || state.isElection || !state.loaded || !state.visible) return;
            this._suppressedNonElectionLayerIds.add(id);
            mapController.hideLayer(id);
        });
    }

    _restoreSuppressedNonElectionLayers() {
        if (!this._suppressedNonElectionLayerIds?.size) return;
        [...this._suppressedNonElectionLayerIds].forEach((id) => {
            const state = mapController.layerStates.get(id);
            if (state?.loaded) {
                mapController.showLayer(id);
            }
        });
        this._suppressedNonElectionLayerIds.clear();
    }

    _showNIWideResults() {
        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        if (!content) return;
        if (this._specialElection?.type === 'recall-petition') {
            this._showRecallPetitionOverview(content);
            return;
        }
        this._restoreHeaderTabs();
        this._renderNIWideView('party', content);
    }

    async _setLocalResultsMode(mode) {
        if (!this._isLocalGovernmentBody()) return;
        const nextMode = mode === 'council' ? 'council' : 'dea';
        if (this._localResultsMode === nextMode) return;
        this._localResultsMode = nextMode;
        this.selectedConstituency = null;
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

        // Lazy-load council aggregates on first switch to council mode
        if (nextMode === 'council' && !this._councilAggregates) {
            // Ensure previous results are available for building previous aggregates
            if (this._previousResultsPromise) {
                await this._previousResultsPromise.catch(() => {});
            }
            const [currentAgg, previousAgg] = await Promise.all([
                this._loadLocalCouncilAggregates(this.date),
                this.previousDate ? this._loadLocalCouncilAggregates(this.previousDate) : Promise.resolve(null)
            ]);
            this._councilAggregates = currentAgg instanceof Map && currentAgg.size
                ? currentAgg
                : this._buildCouncilAggregateMap(this.resultsByConstituency);
            this._previousCouncilAggregates = previousAgg instanceof Map && previousAgg.size
                ? previousAgg
                : this._buildCouncilAggregateMap(this.previousResultsByConstituency);
        }

        this._rebuildElectionLookups();
        await this._loadGeography(this._getActiveGeography(this._currentGeo));
        this._colourMap(this._getActiveGeography(this._currentGeo));
        this._addOverlays(this._getActiveGeography(this._currentGeo));
        this._showNIWideResults();
        if (this.onStateChange) this.onStateChange();
    }

    _showRecallPetitionOverview(content) {
        const headerRight = document.getElementById('electionPaneHeaderRight');
        const titleEl = document.getElementById('electionPaneTitle');
        if (titleEl) {
            titleEl.textContent = `${this._specialElection.title} - ${this._formatDate(this.date)}`;
        }
        if (headerRight) {
            const closeBtn = headerRight.querySelector('#electionCloseBtn');
            headerRight.innerHTML = '';
            if (closeBtn) headerRight.appendChild(closeBtn);
        }

        this._hideAnimation();
        this._currentResultsView = { type: 'recall-overview' };
        content.style.overflowY = 'auto';
        content.style.overflowX = 'hidden';
        content.style.display = '';
        content.style.flexDirection = '';

        const recall = this.resultsByConstituency?.[this._specialElection.constituency]?.Constituency?.recallPetition;
        if (!recall) {
            content.innerHTML = '<div class="election-no-data">No recall petition data available.</div>';
            return;
        }

        content.innerHTML = `
            <div class="election-entity-page">
                <div class="election-entity-page__hero">
                    <span class="election-party-dot election-party-dot--hero" style="background:${this._esc(this._specialElection.fillColor)}"></span>
                    <div>
                        <div class="election-entity-page__eyebrow">Recall Petition</div>
                        <h3 class="election-entity-page__title">${this._esc(recall.constituency)}</h3>
                        <p class="election-entity-page__subtitle">${this._esc(this._formatDate(this.date))}</p>
                    </div>
                </div>
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Results</div>
                    ${this._buildRecallResultsTable(recall)}
                </div>
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Incumbent MP</div>
                    ${this._buildRecallIncumbentTable(recall)}
                </div>
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Notes</div>
                    <div class="catalogue-detail__description">
                        ${(recall.notes || []).map((note) => `<p>${this._esc(note)}</p>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    _buildRecallResultsTable(recall) {
        const fmtInt = (value) => Math.round(Number(value) || 0).toLocaleString('en-GB');
        const pct = (value) => `${Number(value || 0).toFixed(2)}%`;
        const rows = [
            { label: 'Signatures', value: recall.validSignatures, pct: recall.electorate > 0 ? (recall.validSignatures / recall.electorate * 100) : 0 },
            { label: 'Required number of signatures', value: recall.requiredSignatures, pct: 10.0 },
            { label: 'Turnout', value: recall.turnout, pct: recall.electorate > 0 ? (recall.turnout / recall.electorate * 100) : 0 },
            { label: 'Spoiled', value: recall.spoiled, pct: recall.turnout > 0 ? (recall.spoiled / recall.turnout * 100) : 0 },
            { label: 'Petition successful', value: recall.successful ? 'Yes' : 'No', pct: '�' },
            { label: 'Electorate', value: recall.electorate, pct: 100.0 }
        ];

        return `
            <div class="election-party-wrapper">
                <table class="election-party-table election-entity-table">
                    <thead>
                        <tr>
                            <th>Measure</th>
                            <th class="election-num">Number</th>
                            <th class="election-num">%</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row) => `
                            <tr>
                                <td><span class="election-cell-wrap">${this._esc(row.label)}</span></td>
                                <td class="election-num">${typeof row.value === 'number' ? fmtInt(row.value) : this._esc(row.value)}</td>
                                <td class="election-num">${typeof row.pct === 'number' ? pct(row.pct) : this._esc(row.pct)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    _buildRecallIncumbentTable(recall) {
        return `
            <div class="election-party-wrapper">
                <table class="election-party-table election-entity-table">
                    <thead>
                        <tr>
                            <th>Incumbent MP</th>
                            <th>Party</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><span class="election-cell-wrap">${this._esc(recall.incumbentMp?.name || '�')}</span></td>
                            <td><span class="election-cell-wrap">${this._esc(recall.incumbentMp?.party || '�')}</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    _setupNIWideTabs(defaultTab = 'party') {
        const headerRight = document.getElementById('electionPaneHeaderRight');
        const titleEl = document.getElementById('electionPaneTitle');
        if (!headerRight || !titleEl) return;
        titleEl.textContent = this._niWideTitle();
        const closeBtn = headerRight.querySelector('#electionCloseBtn');
        headerRight.innerHTML = '';
        if (this._isLocalGovernmentBody()) {
            ['dea', 'council'].forEach((mode) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'election-view-tab' + (this._localResultsMode === mode ? ' election-view-tab--active' : '');
                btn.dataset.action = 'set-results-mode';
                btn.dataset.mode = mode;
                btn.textContent = mode === 'dea' ? 'DEA' : 'District';
                headerRight.appendChild(btn);
            });
        }
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
        this._currentResultsView = { type: 'niwide', tabId };
        container.style.overflowY = 'auto';
        container.style.overflowX = 'hidden';
        container.style.display = '';
        container.style.flexDirection = '';
        container.style.padding = '';
        if (tabId === 'candidate') {
            container.innerHTML = this._buildNIWideCandidateTable();
        } else if (tabId === 'local-party') {
            container.innerHTML = this._buildNIWideLocalPartyTable();
        } else {
            container.innerHTML = this._buildNIWidePartyTable();
        }
        this._setupResultsTableControls(container);
        this._bindElectionEntityLinks(container);
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
        const useSubsetComparison = this._isByElectionScope(this.constituencies || []);
        const comparisonConstituencies = new Set((this.constituencies || []).filter((name) => name !== 'Northern Ireland'));

        for (const [, payload] of Object.entries(this.resultsByConstituency)) {
            if (!payload?.Constituency) continue;
            const cg = payload.Constituency.countGroup;
            const info = payload.Constituency.countInfo;
            if (!info || !cg) continue;
            totalSeats += parseInt(info.Number_Of_Seats) || 0;
            totalValid += this._safeValidPoll(info, cg);
            totalPoll += parseFloat(info.Total_Poll) || 0;
            totalElectorate += parseFloat(info.Total_Electorate) || 0;
            totalSpoiled += parseFloat(info.Spoiled) || 0;

            cg.forEach(row => {
                if (row.Count_Number === '1' && this._isValidCandidateRow(row)) {
                    const party = this._normaliseLivePartyName(row.Party_Name);
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
                const party = this._normaliseLivePartyName(member.party);
                if (!partyTotals[party]) partyTotals[party] = { votes: 0, seats: 0, colour: member.colour || '#b0bec5', stood: 0 };
                partyTotals[party].seats++;
            });
        }

        for (const [, payload] of Object.entries(this.previousResultsByConstituency || {})) {
            if (!payload?.Constituency) continue;
            const cg = payload.Constituency.countGroup;
            const info = payload.Constituency.countInfo;
            if (!info || !cg) continue;
            prevTotalValid += this._safeValidPoll(info, cg);
            prevTotalPoll += parseFloat(info.Total_Poll) || 0;
            prevTotalElectorate += parseFloat(info.Total_Electorate) || 0;
            prevTotalSpoiled += parseFloat(info.Spoiled) || 0;
            const constituencyName = info.Constituency_Name || '';
            if (useSubsetComparison && !comparisonConstituencies.has(constituencyName)) {
                continue;
            }
            const seen = new Set();
            cg.forEach(row => {
                const countNum = parseInt(row.Count_Number, 10) || 1;
                const cid = String(row.Candidate_Id || '');
                const party = this._normaliseLivePartyName(row.Party_Name);
                if (countNum === 1 && this._isValidCandidateRow(row) && !seen.has(cid)) {
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
                const party = this._normaliseLivePartyName(member.party);
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

        const prevTotalSeats = [...prevPartyTotals.values()].reduce((sum, entry) => sum + (entry.seats || 0), 0);
        let html = `
            <div class="election-summary election-summary--niwide">
                <div class="election-party-wrapper election-party-wrapper--pane-sticky">
                <table class="election-party-table election-party-table--grouped">
                    <thead>
                        <tr>
                            <th rowspan="2" data-leaf-col-idx="0">#</th>
                            <th rowspan="2" data-leaf-col-idx="1">Party</th>
                            <th colspan="2">Candidates</th>
                            <th colspan="4">Seats</th>
                            <th colspan="4">1st preferences</th>
                        </tr>
                        <tr>
                            ${this._resultsLeafTh('No.', 2, 'election-num')}
                            ${this._resultsLeafTh('+/-', 3, 'election-num')}
                            ${this._resultsLeafTh('No.', 4, 'election-num')}
                            ${this._resultsLeafTh('+/-', 5, 'election-num')}
                            ${this._resultsLeafTh('%', 6, 'election-num')}
                            ${this._resultsLeafTh('+/-', 7, 'election-num')}
                            ${this._resultsLeafTh('No.', 8, 'election-num')}
                            ${this._resultsLeafTh('+/-', 9, 'election-num')}
                            ${this._resultsLeafTh('%', 10, 'election-num')}
                            ${this._resultsLeafTh('+/-', 11, 'election-num')}
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
            const seatPct = totalSeats > 0 ? pctValue(data.seats, totalSeats) : 0;
            const prevSeatPct = prev ? pctValue(prev.seats, prevTotalSeats) : null;
            const seatPctDelta = typeof prevSeatPct === 'number' ? (seatPct - prevSeatPct) : null;
            const prevPct = typeof prevVotes === 'number' ? pctValue(prevVotes, prevTotalValid) : null;
            const pctDelta = typeof prevPct === 'number' ? (pctValue(data.votes, totalValid) - prevPct) : null;
            html += `
                <tr>
                    <td class="election-rank-col">${rankLabel(idx)}</td>
                    <td><span class="election-party-dot" style="background:${this._esc(data.colour)}"></span>${this._renderElectionEntityLink('party', name, name, 'election-cell-wrap')}</td>
                    <td class="election-num">${data.stood}</td>
                    <td class="election-num">${this._fmtMaybeDelta(stoodDelta)}</td>
                    <td class="election-num">${data.seats}</td>
                    <td class="election-num">${this._fmtMaybeDelta(electedDelta)}</td>
                    <td class="election-num">${seatPct.toFixed(2)}%</td>
                    <td class="election-num">${this._fmtMaybePctDelta(seatPctDelta)}</td>
                    <td class="election-num">${fmt(data.votes)}</td>
                    <td class="election-num">${this._fmtMaybeDelta(votesDelta)}</td>
                    <td class="election-num">${pct(data.votes)}</td>
                    <td class="election-num">${this._fmtMaybePctDelta(pctDelta)}</td>
                </tr>
            `;
        });

        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td><strong>Valid votes</strong></td><td class="election-num">${this.constituencies?.filter(c => c !== 'Northern Ireland').length || 0}</td><td class="election-num">-</td><td class="election-num">${totalSeats}</td><td class="election-num">-</td><td class="election-num election-cell-strong">100.00%</td><td class="election-num">${this._fmtMaybePctDelta(0)}</td><td class="election-num election-cell-strong">${fmt(totalValid)}</td><td class="election-num">${this._fmtMaybeDelta(totalValid - prevTotalValid)}</td><td class="election-num election-cell-strong">${validPct.toFixed(2)}%</td><td class="election-num">${this._fmtMaybePctDelta(validPct - prevValidPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td><strong>Turnout</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(totalPoll)}</td><td class="election-num">${this._fmtMaybeDelta(totalPoll - prevTotalPoll)}</td><td class="election-num election-cell-strong">${turnoutPct.toFixed(2)}%</td><td class="election-num">${this._fmtMaybePctDelta(turnoutPct - prevTurnoutPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td><strong>Spoiled</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(totalSpoiled)}</td><td class="election-num">${this._fmtMaybeDelta(totalSpoiled - prevTotalSpoiled)}</td><td class="election-num election-cell-strong">${spoiledPct.toFixed(2)}%</td><td class="election-num">${this._fmtMaybePctDelta(spoiledPct - prevSpoiledPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td><strong>Did not vote</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(didNotVote)}</td><td class="election-num">${this._fmtMaybeDelta(didNotVote - prevDidNotVote)}</td><td class="election-num election-cell-strong">${dnvPct.toFixed(2)}%</td><td class="election-num">${this._fmtMaybePctDelta(dnvPct - prevDnvPct)}</td></tr>`;
        html += `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td><strong>Electorate</strong></td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num election-cell-strong">${fmt(totalElectorate)}</td><td class="election-num">${this._fmtMaybeDelta(totalElectorate - prevTotalElectorate)}</td><td class="election-num election-cell-strong">100.00%</td><td class="election-num">${this._fmtMaybePctDelta(0)}</td></tr>`;
        html += `</tbody></table></div></div>`;
        return html;
    }

    _buildNIWideCandidateTable() {
        const isLocal = this._isLocalGovernmentBody();
        const rows = [];
        let totalValid = 0;
        const prevByCandidate = new Map();
        let prevTotalValid = 0;
        const useSubsetComparison = this._isByElectionScope(this.constituencies || []);
        const comparisonConstituencies = new Set((this.constituencies || []).filter((name) => name !== 'Northern Ireland'));
        Object.entries(this.resultsByConstituency).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = this._safeValidPoll(info, cg);
            const seatCount = parseInt(info.Number_Of_Seats, 10) || 0;
            const cleanedConstName = this._cleanConstituencyDisplayName(constName);
            totalValid += constValid;
            const byCandidate = new Map();
            const countNums = [...new Set(cg.map(r => parseInt(r.Count_Number, 10) || 1))].sort((a, b) => a - b);
            const lastCount = countNums[countNums.length - 1] || 1;
            const totalCountCount = countNums.length;
            cg.forEach(row => {
                if (!this._isValidCandidateRow(row)) return;
                const cid = String(row.Candidate_Id || '');
                const countNum = parseInt(row.Count_Number, 10) || 1;
                if (!byCandidate.has(cid)) {
                    byCandidate.set(cid, {
                        personId: cid,
                        constituency: constName,
                        name: this._candidateDisplayName(row),
                        party: this._normaliseLivePartyName(row.Party_Name),
                        colour: row.Party_Colour || '#b0bec5',
                        votes: 0,
                        constPct: 0,
                        finalVotes: 0,
                        electedAt: null,
                        excludedAt: null,
                        resolvedCount: null,
                        countDisplay: '',
                        counts: {}
                    });
                }
                const cand = byCandidate.get(cid);
                const total = parseFloat(row.Total_Votes) || 0;
                if (countNum === 1) {
                    cand.votes = parseFloat(row.Total_Votes) || 0;
                    cand.constPct = constValid > 0 ? (cand.votes / constValid * 100) : 0;
                }
                cand.counts[countNum] = {
                    total,
                    transfers: parseFloat(row.Transfers) || 0,
                    status: row.Status || ''
                };
                if (total > cand.finalVotes) cand.finalVotes = total;
            });
            byCandidate.forEach((cand) => {
                const lifecycle = this._inferCandidateLifecycle(cand, info, lastCount);
                cand.electedAt = lifecycle.electedAt;
                cand.excludedAt = lifecycle.excludedAt;
            });
            const explicitElected = [...byCandidate.values()].filter(c => !!c.electedAt).length;
            if (seatCount > 0 && explicitElected < seatCount) {
                const needed = seatCount - explicitElected;
                const deemable = [...byCandidate.values()]
                    .filter((candidate) => !candidate.electedAt && !candidate.excludedAt)
                    .sort((a, b) => b.finalVotes - a.finalVotes)
                    .slice(0, needed);
                deemable.forEach((candidate) => {
                    candidate.electedAt ||= lastCount;
                });
            }
            byCandidate.forEach(cand => {
                cand.resolvedCount = cand.electedAt ? (cand.electedAt || lastCount)
                    : cand.excludedAt ? (cand.excludedAt || lastCount)
                        : lastCount;
                cand.status = cand.electedAt ? 'Elected' : (cand.excludedAt ? 'Excluded' : 'Not Elected');
                cand.countDisplay = `${cand.resolvedCount}/${totalCountCount}`;
                cand.constituency = cleanedConstName;
                cand.lgd = this._getCouncilNameForConstituency(cleanedConstName) || '';
                rows.push(cand);
            });
        });
        Object.entries(this.previousResultsByConstituency || {}).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = this._safeValidPoll(info, cg);
            const seatCount = parseInt(info.Number_Of_Seats, 10) || 0;
            prevTotalValid += constValid;
            if (useSubsetComparison && !comparisonConstituencies.has(constName)) return;
            const seen = new Set();
            cg.forEach(row => {
                const countNum = parseInt(row.Count_Number, 10) || 1;
                const cid = String(row.Candidate_Id || '');
                if (countNum !== 1 || !this._isValidCandidateRow(row) || seen.has(cid)) return;
                seen.add(cid);
                const name = this._candidateDisplayName(row);
                const party = this._normaliseLivePartyName(row.Party_Name);
                const key = this._candidateKey(name, party);
                const prevVotes = parseFloat(row.Total_Votes) || 0;
                prevByCandidate.set(key, {
                    votes: prevVotes,
                    constPct: constValid > 0 ? (prevVotes / constValid * 100) : null
                });
            });
        });
        rows.sort((a, b) => {
            const pctDelta = (b.constPct || 0) - (a.constPct || 0);
            if (Math.abs(pctDelta) > 1e-9) return pctDelta;
            return (b.votes || 0) - (a.votes || 0)
                || String(a.name || '').localeCompare(String(b.name || ''));
        });
        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        const leafHeader = (label, colIdx, extraClass = '', rowspan = 1) => {
            const cls = [extraClass].filter(Boolean).join(' ');
            return `<th${cls ? ` class="${cls}"` : ''} data-leaf-col-idx="${colIdx}"${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}>${label}</th>`;
        };
        const candidateColGroup = this._resultsColGroup(isLocal
            ? ['rank', 'name', 'party', 'district', 'dea', 'outcome', 'status-count', 'votes', 'delta-votes', 'pct-main', 'pct-delta-main', 'pct-small', 'pct-delta-small']
            : ['rank', 'name', 'party', 'constituency', 'outcome', 'status-count', 'votes', 'delta-votes', 'pct-main', 'pct-delta-main', 'pct-small', 'pct-delta-small']);
        let html = `<div class="election-count-wrapper election-count-wrapper--pane-sticky"><table class="election-count-table election-count-table--grouped election-count-table--candidate-sticky3 election-results-table--fixed${isLocal ? ' election-results-table--local' : ' election-results-table--nonlocal'}">${candidateColGroup}<thead>
            <tr>
                ${leafHeader('#', 0, '', 3)}
                ${leafHeader('Name', 1, '', 3)}
                ${leafHeader('Party', 2, '', 3)}
                ${isLocal
                    ? '<th colspan="2">Geography</th>'
                    : leafHeader('Constituency', 3, '', 3)}
                <th colspan="2">Status</th>
                <th colspan="4">1st preferences</th>
                <th colspan="2">% of NI</th>
            </tr>
            <tr>
                ${isLocal
                    ? `${leafHeader('District', 3, '', 2)}${leafHeader('DEA', 4, '', 2)}`
                    : ''}
                ${leafHeader('Outcome', isLocal ? 5 : 4, '', 2)}
                ${leafHeader('Count', isLocal ? 6 : 5, 'election-num election-col-status-count', 2)}
                <th colspan="2">No.</th>
                <th colspan="2">%</th>
                <th colspan="2">%</th>
            </tr>
            <tr>
                ${this._resultsLeafTh('No.', isLocal ? 7 : 6, 'election-num election-col-votes')}
                ${this._resultsLeafTh('+/-', isLocal ? 8 : 7, 'election-num election-col-delta-votes')}
                ${this._resultsLeafTh('%', isLocal ? 9 : 8, 'election-num election-col-pct-main')}
                ${this._resultsLeafTh('+/-', isLocal ? 10 : 9, 'election-num election-col-pct-delta-main')}
                ${this._resultsLeafTh('%', isLocal ? 11 : 10, 'election-num election-col-pct-small')}
                ${this._resultsLeafTh('+/-', isLocal ? 12 : 11, 'election-num election-col-pct-delta-small')}
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
                <td><span class="election-party-dot" style="background:${this._esc(row.colour)}"></span>${this._renderElectionEntityLink('candidate', row.personId, row.name, 'election-cell-wrap')}</td>
                <td>${this._renderElectionEntityLink('party', row.party, row.party, 'election-cell-wrap')}</td>
                ${isLocal ? `<td>${this._renderElectionConstituencyFeatureLink(this.body, this.date, row.lgd || '�', row.lgd || '�', 'election-cell-wrap election-cell-wrap--district', 'council')}</td>` : ''}
                <td>${this._renderElectionConstituencyFeatureLink(this.body, this.date, row.constituency, row.constituency, 'election-cell-wrap', isLocal ? 'dea' : 'constituency')}</td>
                <td><span class="election-cell-wrap">${row.status === 'Elected' ? '<strong>Elected</strong>' : this._esc(row.status)}</span></td>
                <td class="election-num election-col-status-count"><span class="election-cell-wrap">${this._esc(row.countDisplay)}</span></td>
                <td class="election-num election-cell-strong election-col-votes">${fmt(row.votes)}</td>
                <td class="election-num election-col-delta-votes">${this._fmtMaybeDelta(votesDelta)}</td>
                <td class="election-num election-col-pct-main">${row.constPct.toFixed(2)}%</td>
                <td class="election-num election-col-pct-delta-main">${this._fmtMaybePctDeltaOrNA(constPctDelta)}</td>
                <td class="election-num election-col-pct-small">${niPct.toFixed(2)}%</td>
                <td class="election-num election-col-pct-delta-small">${this._fmtMaybePctDeltaOrNA(niPctDelta)}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    _buildNIWideLocalPartyTable() {
        const isLocal = this._isLocalGovernmentBody();
        const rows = [];
        let totalValid = 0;
        const prevByLocalParty = new Map();
        let prevTotalValid = 0;
        const useSubsetComparison = this._isByElectionScope(this.constituencies || []);
        const comparisonConstituencies = new Set((this.constituencies || []).filter((name) => name !== 'Northern Ireland'));

        Object.entries(this.resultsByConstituency).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = this._safeValidPoll(info, cg);
            totalValid += constValid;

            const byCandidate = new Map();
            cg.forEach(row => {
                if (!this._isValidCandidateRow(row)) return;
                const cid = String(row.Candidate_Id || '');
                const countNum = parseInt(row.Count_Number, 10) || 1;
                if (!byCandidate.has(cid)) {
                    byCandidate.set(cid, {
                        party: this._normaliseLivePartyName(row.Party_Name),
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
                const party = this._normaliseLivePartyName(cand.party);
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
                lp.seatPct = seatCount > 0 ? (lp.elected / seatCount * 100) : 0;
                lp.totalSeats = seatCount;
                lp.lgd = this._getCouncilNameForConstituency(constName) || '';
                rows.push(lp);
            });
        });

        Object.entries(this.previousResultsByConstituency || {}).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = this._safeValidPoll(info, cg);
            const seatCount = parseInt(info.Number_Of_Seats, 10) || 0;
            prevTotalValid += constValid;
            if (useSubsetComparison && !comparisonConstituencies.has(constName)) return;

            const constituencyElected = this._extractElected(payload);
            const electedByParty = new Map();
            constituencyElected.forEach((member) => {
                const party = this._normaliseLivePartyName(member.party);
                electedByParty.set(party, (electedByParty.get(party) || 0) + 1);
            });

            const snapshot = new Map();
            const seenCandidates = new Set();
            cg.forEach(row => {
                const countNum = parseInt(row.Count_Number, 10) || 1;
                const cid = String(row.Candidate_Id || '');
                if (countNum !== 1 || !this._isValidCandidateRow(row) || seenCandidates.has(cid)) return;
                seenCandidates.add(cid);
                const party = this._normaliseLivePartyName(row.Party_Name);
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
                    constPct: constValid > 0 ? (entry.votes / constValid * 100) : null,
                    seatPct: seatCount > 0 ? ((electedByParty.get(party) || 0) / seatCount * 100) : null
                });
            });
        });

        rows.sort((a, b) => b.votes - a.votes);
        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        const localPartyColGroup = this._resultsColGroup(isLocal
            ? ['rank', 'party', 'district', 'dea', 'int', 'delta-small', 'int', 'delta-small', 'pct-main', 'pct-delta-main', 'votes', 'delta-votes', 'pct-main', 'pct-delta-main', 'pct-small', 'pct-delta-small']
            : ['rank', 'party', 'constituency', 'int', 'delta-small', 'int', 'delta-small', 'pct-main', 'pct-delta-main', 'votes', 'delta-votes', 'pct-main', 'pct-delta-main', 'pct-small', 'pct-delta-small']);
        let html = `<div class="election-count-wrapper election-count-wrapper--pane-sticky"><table class="election-count-table election-count-table--grouped${isLocal ? ' election-count-table--local-party-sticky4 election-results-table--local' : ' election-count-table--nonlocal-local-party-sticky3 election-results-table--nonlocal'} election-results-table--fixed">${localPartyColGroup}<thead>
            <tr>
                <th rowspan="2" data-leaf-col-idx="0">#</th>
                <th rowspan="2" data-leaf-col-idx="1">Party</th>
                ${isLocal ? '<th colspan="2">Geography</th>' : '<th rowspan="2" data-leaf-col-idx="2">Constituency</th>'}
                <th colspan="2">Candidates</th>
                <th colspan="4">Seats</th>
                <th colspan="4">1st preferences</th>
                <th colspan="2">% of NI</th>
            </tr>
            <tr>
                ${isLocal ? this._resultsLeafTh('District', 2) : ''}
                ${isLocal ? this._resultsLeafTh('DEA', 3) : ''}
                ${this._resultsLeafTh('No.', isLocal ? 4 : 3, 'election-num election-col-int')}
                ${this._resultsLeafTh('+/-', isLocal ? 5 : 4, 'election-num election-col-delta-small')}
                ${this._resultsLeafTh('No.', isLocal ? 6 : 5, 'election-num election-col-int')}
                ${this._resultsLeafTh('+/-', isLocal ? 7 : 6, 'election-num election-col-delta-small')}
                ${this._resultsLeafTh('%', isLocal ? 8 : 7, 'election-num election-col-pct-main')}
                ${this._resultsLeafTh('+/-', isLocal ? 9 : 8, 'election-num election-col-pct-delta-main')}
                ${this._resultsLeafTh('No.', isLocal ? 10 : 9, 'election-num election-col-votes')}
                ${this._resultsLeafTh('+/-', isLocal ? 11 : 10, 'election-num election-col-delta-votes')}
                ${this._resultsLeafTh('%', isLocal ? 12 : 11, 'election-num election-col-pct-main')}
                ${this._resultsLeafTh('+/-', isLocal ? 13 : 12, 'election-num election-col-pct-delta-main')}
                ${this._resultsLeafTh('%', isLocal ? 14 : 13, 'election-num election-col-pct-small')}
                ${this._resultsLeafTh('+/-', isLocal ? 15 : 14, 'election-num election-col-pct-delta-small')}
            </tr></thead><tbody>`;
        const rankLabel = (idx) => {
            const n = idx + 1;
            if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
            if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
            if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
            return `${n}th`;
        };
        rows.forEach((row, idx) => {
            const key = this._localPartyKey(row.constituency, row.party);
            const prev = prevByLocalParty.get(key);
            const prevVotes = prev?.votes;
            const votesDelta = typeof prevVotes === 'number' ? (row.votes - prevVotes) : null;
            const seatPctDelta = typeof prev?.seatPct === 'number' ? (row.seatPct - prev.seatPct) : null;
            const constPctDelta = typeof prev?.constPct === 'number' ? (row.constPct - prev.constPct) : null;
            const niPct = totalValid > 0 ? (row.votes / totalValid * 100) : 0;
            const prevNiPct = (typeof prevVotes === 'number' && prevTotalValid > 0) ? (prevVotes / prevTotalValid * 100) : null;
            const niPctDelta = typeof prevNiPct === 'number' ? (niPct - prevNiPct) : null;
            html += `<tr>
                <td class="election-rank-col">${rankLabel(idx)}</td>
                <td><span class="election-party-dot" style="background:${this._esc(row.colour)}"></span>${this._renderElectionEntityLink('party', row.party, row.party, 'election-cell-wrap')}</td>
                ${isLocal ? `<td>${this._renderElectionConstituencyFeatureLink(this.body, this.date, row.lgd || '�', row.lgd || '�', 'election-cell-wrap election-cell-wrap--district', 'council')}</td>` : ''}
                <td>${this._renderElectionConstituencyFeatureLink(this.body, this.date, row.constituency, row.constituency, 'election-cell-wrap', isLocal ? 'dea' : 'constituency')}</td>
                <td class="election-num election-col-int"><span class="election-cell-wrap">${row.stood}</span></td>
                <td class="election-num election-col-delta-small">${this._fmtMaybeDelta(prev ? (row.stood - prev.stood) : null)}</td>
                <td class="election-num election-col-int"><span class="election-cell-wrap"><strong>${row.elected}</strong></span></td>
                <td class="election-num election-col-delta-small">${this._fmtMaybeDelta(prev ? (row.elected - prev.elected) : null)}</td>
                <td class="election-num election-col-pct-main">${row.seatPct.toFixed(2)}%</td>
                <td class="election-num election-col-pct-delta-main">${this._fmtMaybePctDeltaOrNA(seatPctDelta)}</td>
                <td class="election-num election-cell-strong election-col-votes">${fmt(row.votes)}</td>
                <td class="election-num election-col-delta-votes">${this._fmtMaybeDelta(votesDelta)}</td>
                <td class="election-num election-col-pct-main">${row.constPct.toFixed(2)}%</td>
                <td class="election-num election-col-pct-delta-main">${this._fmtMaybePctDeltaOrNA(constPctDelta)}</td>
                <td class="election-num election-col-pct-small">${niPct.toFixed(2)}%</td>
                <td class="election-num election-col-pct-delta-small">${this._fmtMaybePctDeltaOrNA(niPctDelta)}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    _localPartyKey(constituency, party) {
        return `${String(constituency || '').trim().toLowerCase()}::${String(party || '').trim().toLowerCase()}`;
    }

    _renderElectionEntityLink(kind, key, label, extraClass = '') {
        const safeLabel = this._esc(label || '');
        const safeKey = String(key || '').trim();
        if (!safeKey || safeKey.toLowerCase() === 'nontransferable') {
            return `<span class="election-cell-wrap ${extraClass}">${safeLabel}</span>`;
        }
        const classAttr = ['election-entity-link', extraClass].filter(Boolean).join(' ');
        return `<button type="button" class="${classAttr}" data-election-entity-kind="${this._esc(kind)}" data-election-entity-key="${this._esc(safeKey)}">${safeLabel}</button>`;
    }

    _renderElectionConstituencyFeatureLink(body, date, constituency, label, extraClass = '', level = 'dea') {
        return renderElectionConstituencyFeatureLink(body, date, constituency, label, extraClass, level);
    }

    _bindElectionEntityLinks(container) {
        if (!container || container.dataset.entityLinksReady === '1') return;
        container.dataset.entityLinksReady = '1';
        container.addEventListener('click', (event) => {
            const constituencyTrigger = event.target.closest('[data-election-constituency-feature="1"]');
            if (constituencyTrigger && container.contains(constituencyTrigger)) {
                event.preventDefault();
                this.onOpenElectionConstituencyFeature?.({
                    body: constituencyTrigger.dataset.electionConstituencyBody,
                    date: constituencyTrigger.dataset.electionConstituencyDate,
                    constituency: constituencyTrigger.dataset.electionConstituencyName,
                    level: constituencyTrigger.dataset.electionConstituencyLevel || 'dea'
                });
                return;
            }
            const trigger = event.target.closest('[data-election-entity-kind][data-election-entity-key]');
            if (!trigger || !container.contains(trigger)) return;
            event.preventDefault();
            this._openElectionEntityDetail(
                trigger.dataset.electionEntityKind,
                trigger.dataset.electionEntityKey
            );
        });
    }

    async _openElectionEntityDetail(kind, key) {
        if (typeof this.onOpenEntityDetail === 'function') {
            await this.onOpenEntityDetail(kind, key);
            return;
        }

        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        if (!content) return;
        const entity = await this.getElectionEntityDetail(kind, key);
        if (!entity) {
            content.innerHTML = `<div class="election-no-data">No ${this._esc(kind)} data available.</div>`;
            return;
        }

        this._entityDetailReturnView = this._currentResultsView ? { ...this._currentResultsView } : null;
        this._hideAnimation();
        content.style.display = '';
        content.style.flexDirection = '';
        content.style.overflowY = 'auto';
        content.style.overflowX = 'hidden';
        content.style.padding = '';
        content.innerHTML = kind === 'candidate'
            ? this._buildCandidateEntityDetail(entity, this._globalEntityIndex?.totalValid || 0)
            : this._buildPartyEntityDetail(entity, this._globalEntityIndex?.totalValid || 0);
        this._showElectionEntityHeader(kind, entity);
    }

    _showElectionEntityHeader(kind, entity) {
        const headerRight = document.getElementById('electionPaneHeaderRight');
        const titleEl = document.getElementById('electionPaneTitle');
        if (!headerRight || !titleEl) return;

        titleEl.textContent = kind === 'candidate' ? (entity.name || entity.personId) : entity.name;
        const closeBtn = headerRight.querySelector('#electionCloseBtn');
        headerRight.innerHTML = '';

        const backBtn = document.createElement('button');
        backBtn.className = 'election-pane__back';
        backBtn.innerHTML = "<";
        backBtn.title = 'Back to results';
        backBtn.addEventListener('click', () => this._restoreElectionEntityReturnView());
        headerRight.appendChild(backBtn);

        if (closeBtn) headerRight.appendChild(closeBtn);
    }

    _restoreElectionEntityReturnView() {
        const view = this._entityDetailReturnView || this._currentResultsView;
        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        const titleEl = document.getElementById('electionPaneTitle');
        if (!content || !view) return;

        if (view.type === 'constituency' && view.constName) {
            this._showConstituencyPanel(view.constName, view.tabId || 'party');
            return;
        }

        this.selectedConstituency = null;
        this._hideAnimation();
        content.style.display = '';
        content.style.flexDirection = '';
        if (titleEl) {
            titleEl.textContent = this._niWideTitle();
        }
        this._restoreHeaderTabs(view.tabId || 'party');
        this._renderNIWideView(view.tabId || 'party', content);
        if (this.onStateChange) this.onStateChange();
    }

    isElectionLoaded(body, date) {
        return this.active && this.body === body && this.date === date;
    }

    async ensureElectionLoaded(body, date) {
        if (this.isElectionLoaded(body, date)) return;
        await this.loadElection(body, date);
    }

    showConstituency(constName) {
        if (!this.active || !constName || !this._getCurrentConstituencyPayload(constName)) return;
        this._showConstituencyPanel(constName);
    }

    showSummary() {
        if (!this.active) return;
        this.selectedConstituency = null;
        this._restoreHeaderTabs('party');
        this._showNIWideResults();
        if (this.onStateChange) this.onStateChange();
    }

    _getElectionEntityIndex() {
        if (this._entityIndexCache) return this._entityIndexCache;

        const parties = new Map();
        const candidates = new Map();
        let totalValid = 0;

        Object.entries(this.resultsByConstituency || {}).forEach(([constName, payload]) => {
            const cg = payload?.Constituency?.countGroup || [];
            const info = payload?.Constituency?.countInfo || {};
            const constValid = parseFloat(info.Valid_Poll) || 0;
            const seatCount = parseInt(info.Number_Of_Seats, 10) || 0;
            totalValid += constValid;
            if (cg.length === 0) return;

            const countNums = [...new Set(cg.map(r => parseInt(r.Count_Number, 10) || 1))].sort((a, b) => a - b);
            const lastCount = countNums[countNums.length - 1] || 1;
            const byCandidate = new Map();

            cg.forEach((row) => {
                if (!this._isValidCandidateRow(row)) return;
                const cid = String(row.Candidate_Id || '').trim();
                const countNum = parseInt(row.Count_Number, 10) || 1;
                if (!byCandidate.has(cid)) {
                    byCandidate.set(cid, {
                        personId: cid,
                        name: this._candidateDisplayName(row, cid),
                        party: this._normaliseLivePartyName(row.Party_Name),
                        colour: row.Party_Colour || '#b0bec5',
                        constituency: constName,
                        firstPref: 0,
                        finalVotes: 0,
                        elected: false,
                        excluded: false,
                        electedAt: null,
                        excludedAt: null
                    });
                }
                const candidate = byCandidate.get(cid);
                const total = parseFloat(row.Total_Votes) || 0;
                if (countNum === 1) {
                    candidate.firstPref = parseFloat(row.Candidate_First_Pref_Votes || row.Total_Votes) || 0;
                }
                if (total > candidate.finalVotes) candidate.finalVotes = total;
                if (this._statusKind(row.Status) === 'elected') {
                    candidate.elected = true;
                    candidate.electedAt ||= countNum;
                }
                if (this._statusKind(row.Status) === 'excluded') {
                    candidate.excluded = true;
                    candidate.excludedAt ||= countNum;
                }
            });

            const explicitElected = [...byCandidate.values()].filter(c => c.elected).length;
            if (seatCount > 0 && explicitElected < seatCount) {
                const needed = seatCount - explicitElected;
                const deemable = [...byCandidate.values()]
                    .filter((candidate) => !candidate.elected && !candidate.excluded)
                    .sort((a, b) => b.finalVotes - a.finalVotes)
                    .slice(0, needed);
                deemable.forEach((candidate) => {
                    candidate.elected = true;
                    candidate.electedAt ||= lastCount;
                });
            }

            byCandidate.forEach((candidate) => {
                const status = candidate.elected
                    ? `Elected${candidate.electedAt ? ` at Count ${candidate.electedAt}` : ''}`
                    : (candidate.excluded
                        ? `Excluded${candidate.excludedAt ? ` at Count ${candidate.excludedAt}` : ''}`
                        : 'Not Elected');
                candidate.status = status;
                candidate.firstPrefPct = constValid > 0 ? (candidate.firstPref / constValid * 100) : 0;

                const personId = candidate.personId;
                if (!candidates.has(personId)) {
                    candidates.set(personId, {
                        personId,
                        name: candidate.name,
                        party: candidate.party,
                        colour: candidate.colour,
                        firstPrefs: 0,
                        finalVotes: 0,
                        electedCount: 0,
                        constituencies: new Set(),
                        appearances: []
                    });
                }
                const candidateEntry = candidates.get(personId);
                candidateEntry.firstPrefs += candidate.firstPref;
                candidateEntry.finalVotes += candidate.finalVotes;
                if (candidate.elected) candidateEntry.electedCount += 1;
                candidateEntry.constituencies.add(constName);
                candidateEntry.appearances.push({
                    constituency: constName,
                    firstPref: candidate.firstPref,
                    firstPrefPct: candidate.firstPrefPct,
                    finalVotes: candidate.finalVotes,
                    status
                });

                const partyName = this._normaliseLivePartyName(candidate.party);
                if (!parties.has(partyName)) {
                    parties.set(partyName, {
                        name: partyName,
                        colour: candidate.colour || '#b0bec5',
                        firstPrefs: 0,
                        finalVotes: 0,
                        stood: 0,
                        elected: 0,
                        constituencies: new Set(),
                        candidates: []
                    });
                }
                const partyEntry = parties.get(partyName);
                partyEntry.firstPrefs += candidate.firstPref;
                partyEntry.finalVotes += candidate.finalVotes;
                partyEntry.stood += 1;
                if (candidate.elected) partyEntry.elected += 1;
                partyEntry.constituencies.add(constName);
                partyEntry.candidates.push({
                    personId,
                    name: candidate.name,
                    constituency: constName,
                    firstPref: candidate.firstPref,
                    firstPrefPct: candidate.firstPrefPct,
                    finalVotes: candidate.finalVotes,
                    status
                });
            });
        });

        const sortByName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
        candidates.forEach((entry) => {
            entry.appearances.sort((a, b) => b.firstPref - a.firstPref || String(a.constituency).localeCompare(String(b.constituency)));
            entry.constituencies = [...entry.constituencies].sort((a, b) => String(a).localeCompare(String(b)));
            entry.shareOfNI = totalValid > 0 ? (entry.firstPrefs / totalValid * 100) : 0;
        });
        parties.forEach((entry) => {
            entry.candidates.sort((a, b) => b.firstPref - a.firstPref || String(a.name).localeCompare(String(b.name)));
            entry.constituencies = [...entry.constituencies].sort((a, b) => String(a).localeCompare(String(b)));
            entry.shareOfNI = totalValid > 0 ? (entry.firstPrefs / totalValid * 100) : 0;
        });

        this._entityIndexCache = { parties, candidates, totalValid };
        return this._entityIndexCache;
    }

    _buildPartyEntityDetail(entry, totalValid) {
        const fmt = (value) => Math.round(Number(value) || 0).toLocaleString('en-GB');
        const constituencyCount = entry.constituencies.length;
        return `
            <div class="election-entity-page">
                <div class="election-entity-page__hero">
                    <span class="election-party-dot election-party-dot--hero" style="background:${this._esc(entry.colour)}"></span>
                    <div>
                        <div class="election-entity-page__eyebrow">Party Information</div>
                        <h3 class="election-entity-page__title">${this._esc(entry.name)}</h3>
                        <p class="election-entity-page__subtitle">${this._esc(this._shortBodyName(this.body))} - ${this._esc(this._formatDate(this.date))}</p>
                    </div>
                </div>
                <div class="election-entity-metrics">
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Candidates stood</span><strong>${fmt(entry.stood)}</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Candidates elected</span><strong>${fmt(entry.elected)}</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">1st prefs</span><strong>${fmt(entry.firstPrefs)}</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">% of NI</span><strong>${entry.shareOfNI.toFixed(2)}%</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Final-round votes</span><strong>${fmt(entry.finalVotes)}</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Constituencies</span><strong>${fmt(constituencyCount)}</strong></div>
                </div>
                <div class="election-party-wrapper">
                    <table class="election-party-table election-entity-table">
                        <thead>
                            <tr>
                                <th>Candidate</th>
                                <th>Constituency</th>
                                <th class="election-num">1st prefs</th>
                                <th class="election-num">1st prefs %</th>
                                <th class="election-num">Final votes</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${entry.candidates.map((candidate) => `
                                <tr>
                                    <td><span class="election-cell-wrap">${this._esc(candidate.name)}</span></td>
                                    <td><span class="election-cell-wrap">${this._esc(candidate.constituency)}</span></td>
                                    <td class="election-num">${fmt(candidate.firstPref)}</td>
                                    <td class="election-num">${candidate.firstPrefPct.toFixed(2)}%</td>
                                    <td class="election-num">${fmt(candidate.finalVotes)}</td>
                                    <td><span class="election-cell-wrap">${this._esc(candidate.status)}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    _buildCandidateEntityDetail(entry, totalValid) {
        const fmt = (value) => Math.round(Number(value) || 0).toLocaleString('en-GB');
        return `
            <div class="election-entity-page">
                <div class="election-entity-page__hero">
                    <span class="election-party-dot election-party-dot--hero" style="background:${this._esc(entry.colour)}"></span>
                    <div>
                        <div class="election-entity-page__eyebrow">Candidate Information</div>
                        <h3 class="election-entity-page__title">${this._esc(entry.name)}</h3>
                        <p class="election-entity-page__subtitle">${this._esc(entry.party)} - Person ID ${this._esc(entry.personId)}</p>
                    </div>
                </div>
                <div class="election-entity-metrics">
                    <div class="election-entity-metric"><span class="election-entity-metric__label">1st prefs</span><strong>${fmt(entry.firstPrefs)}</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">% of NI</span><strong>${entry.shareOfNI.toFixed(2)}%</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Final-round votes</span><strong>${fmt(entry.finalVotes)}</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Constituency count</span><strong>${fmt(entry.constituencies.length)}</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Election wins</span><strong>${fmt(entry.electedCount)}</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Total valid poll</span><strong>${fmt(totalValid)}</strong></div>
                </div>
                <div class="election-party-wrapper">
                    <table class="election-party-table election-entity-table">
                        <thead>
                            <tr>
                                <th>Constituency</th>
                                <th class="election-num">1st prefs</th>
                                <th class="election-num">1st prefs %</th>
                                <th class="election-num">Final votes</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${entry.appearances.map((appearance) => `
                                <tr>
                                    <td><span class="election-cell-wrap">${this._esc(appearance.constituency)}</span></td>
                                    <td class="election-num">${fmt(appearance.firstPref)}</td>
                                    <td class="election-num">${appearance.firstPrefPct.toFixed(2)}%</td>
                                    <td class="election-num">${fmt(appearance.finalVotes)}</td>
                                    <td><span class="election-cell-wrap">${this._esc(appearance.status)}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // â”€â”€â”€ Constituency Click â”€â”€â”€

    _onConstituencyClick(fgbName) {
        const constName = this._matchConstituency(fgbName);
        if (!constName) return;
        if (this._isCouncilMode()) {
            this._showCouncilPanel(constName);
            return;
        }
        if (this._specialElection?.type === 'recall-petition' && constName !== this._specialElection.constituency) {
            return;
        }
        this._showConstituencyPanel(constName);
    }

    _showCouncilPanel(councilName, preferredTab = 'party') {
        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        const headerRight = document.getElementById('electionPaneHeaderRight');
        const titleEl = document.getElementById('electionPaneTitle');
        const aggregate = this._councilAggregates?.get(councilName);
        if (!content || !headerRight || !titleEl || !aggregate) return;

        this.selectedConstituency = councilName;
        titleEl.textContent = councilName;
        const closeBtn = headerRight.querySelector('#electionCloseBtn');
        headerRight.innerHTML = '';

        const backBtn = document.createElement('button');
        backBtn.className = 'election-pane__back';
        backBtn.innerHTML = '<';
        backBtn.title = 'Back to summary';
        backBtn.addEventListener('click', () => {
            this.selectedConstituency = null;
            this._showNIWideResults();
            if (this.onStateChange) this.onStateChange();
        });
        headerRight.appendChild(backBtn);

        ['dea', 'council'].forEach((mode) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'election-view-tab' + (this._localResultsMode === mode ? ' election-view-tab--active' : '');
            btn.dataset.action = 'set-results-mode';
            btn.dataset.mode = mode;
            btn.textContent = mode === 'dea' ? 'DEA' : 'District';
            headerRight.appendChild(btn);
        });

        const tabs = [
            { id: 'party', label: 'By Party' },
            { id: 'candidate', label: 'By Candidate' },
            { id: 'local-party', label: 'By Local Party' }
        ];
        tabs.forEach((def) => {
            const btn = document.createElement('button');
            btn.className = 'election-view-tab' + (def.id === preferredTab ? ' election-view-tab--active' : '');
            btn.dataset.tab = def.id;
            btn.textContent = def.label;
            btn.addEventListener('click', () => {
                headerRight.querySelectorAll('.election-view-tab[data-tab]').forEach((b) => b.classList.remove('election-view-tab--active'));
                btn.classList.add('election-view-tab--active');
                this._renderCouncilView(councilName, def.id, content);
            });
            headerRight.appendChild(btn);
        });
        if (closeBtn) headerRight.appendChild(closeBtn);
        this._renderCouncilView(councilName, preferredTab, content);
        if (this.onStateChange) this.onStateChange();
    }

    _renderCouncilView(councilName, tabId, container) {
        const aggregate = this._councilAggregates?.get(councilName);
        if (!aggregate || !container) return;
        const previousAggregate = this._previousCouncilAggregates?.get(councilName) || null;
        this._currentResultsView = { type: 'council', councilName, tabId };
        container.style.overflowY = 'auto';
        container.style.overflowX = 'hidden';
        container.style.display = '';
        container.style.flexDirection = '';
        const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');
        const fmtDelta = (value, suffix = '') => {
            if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="election-delta election-delta--neutral">N/A</span>';
            const numeric = Number(value);
            if (Math.abs(numeric) < 1e-9) return '<span class="election-delta election-delta--neutral">0</span>';
            const sign = numeric > 0 ? '+' : '-';
            const cls = numeric > 0 ? 'election-delta election-delta--pos' : 'election-delta election-delta--neg';
            const abs = Math.abs(numeric);
            const body = suffix === '%'
                ? `${sign}${abs.toFixed(2)}%`
                : `${sign}${Math.round(abs).toLocaleString('en-GB')}`;
            return `<span class="${cls}">${body}</span>`;
        };
        const fmtPctDelta = (value) => {
            if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="election-delta election-delta--neutral">N/A</span>';
            const numeric = Number(value);
            if (Math.abs(numeric) < 1e-9) return '<span class="election-delta election-delta--neutral">0.00%</span>';
            const sign = numeric > 0 ? '+' : '-';
            const cls = numeric > 0 ? 'election-delta election-delta--pos' : 'election-delta election-delta--neg';
            return `<span class="${cls}">${sign}${Math.abs(numeric).toFixed(2)}%</span>`;
        };
        const rankLabel = (idx) => {
            const n = idx + 1;
            if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
            if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
            if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
            return `${n}th`;
        };
        const leafHeader = (label, colIdx, extraClass = '', rowspan = 1) => {
            const cls = ['election-grouped-leaf', extraClass].filter(Boolean).join(' ');
            return `<th rowspan="${rowspan}" data-leaf-col-idx="${colIdx}" class="${cls}">${this._esc(label)}</th>`;
        };
        if (tabId === 'candidate') {
            const rows = aggregate.candidates.map((candidate, idx) => {
                const prevCandidate = previousAggregate?.candidateMap?.get(candidate.personId) || null;
                const votesDelta = typeof prevCandidate?.firstPrefs === 'number'
                    ? candidate.firstPrefs - prevCandidate.firstPrefs
                    : null;
                const constPct = candidate.validPoll > 0 ? ((candidate.firstPrefs / candidate.validPoll) * 100) : 0;
                const prevConstPct = prevCandidate?.validPoll > 0
                    ? ((prevCandidate.firstPrefs / prevCandidate.validPoll) * 100)
                    : null;
                const constPctDelta = prevConstPct !== null ? constPct - prevConstPct : null;
                const districtPct = aggregate.validPoll > 0 ? ((candidate.firstPrefs / aggregate.validPoll) * 100) : 0;
                const prevDistrictPct = previousAggregate?.validPoll > 0 && prevCandidate
                    ? ((prevCandidate.firstPrefs / previousAggregate.validPoll) * 100)
                    : null;
                const districtPctDelta = prevDistrictPct !== null ? districtPct - prevDistrictPct : null;
                const countDisplay = `${candidate.resolvedCount || candidate.lastCount || 1}/${candidate.lastCount || 1}`;
                return `
                <tr>
                    <td>${rankLabel(idx)}</td>
                    <td><span class="election-party-dot" style="background:${this._esc(candidate.colour)}"></span>${this._renderElectionEntityLink('candidate', candidate.personId, candidate.name, 'election-cell-wrap')}</td>
                    <td>${this._renderElectionEntityLink('party', candidate.party, candidate.party, 'election-cell-wrap')}</td>
                    <td>${this._renderElectionConstituencyFeatureLink(this.body, this.date, candidate.constituency, candidate.constituency, 'election-cell-wrap', 'dea')}</td>
                    <td><span class="election-cell-wrap">${candidate.status === 'Elected' ? '<strong>Elected</strong>' : this._esc(candidate.status)}</span></td>
                    <td class="election-num election-col-status-count"><span class="election-cell-wrap">${this._esc(countDisplay)}</span></td>
                    <td class="election-num election-cell-strong election-col-votes">${fmt(candidate.firstPrefs)}</td>
                    <td class="election-num election-col-delta-votes">${this._fmtMaybeDeltaOrNA(votesDelta)}</td>
                    <td class="election-num election-col-pct-main">${constPct.toFixed(2)}%</td>
                    <td class="election-num election-col-pct-delta-main">${this._fmtMaybePctDeltaOrNA(constPctDelta)}</td>
                    <td class="election-num election-col-pct-small">${districtPct.toFixed(2)}%</td>
                    <td class="election-num election-col-pct-delta-small">${this._fmtMaybePctDeltaOrNA(districtPctDelta)}</td>
                </tr>`;
            }).join('');
            const districtCandidateColGroup = this._resultsColGroup(['rank', 'name', 'party', 'dea', 'outcome', 'status-count', 'votes', 'delta-votes', 'pct-main', 'pct-delta-main', 'pct-small', 'pct-delta-small']);
            container.innerHTML = `<div class="election-party-wrapper"><table class="election-party-table election-party-table--grouped election-party-table--candidate-sticky3 election-results-table--fixed election-results-table--district">${districtCandidateColGroup}<thead>
                <tr>
                    ${leafHeader('#', 0, '', 3)}
                    ${leafHeader('Name', 1, '', 3)}
                    ${leafHeader('Party', 2, '', 3)}
                    ${leafHeader('DEA', 3, '', 3)}
                    <th colspan="2">Status</th>
                    <th colspan="4">1st preferences</th>
                    <th colspan="2">% of District</th>
                </tr>
                <tr>
                    ${leafHeader('Outcome', 4, '', 2)}
                    ${leafHeader('Count', 5, 'election-num election-col-status-count', 2)}
                    <th colspan="2">No.</th>
                    <th colspan="2">%</th>
                    <th colspan="2">%</th>
                </tr>
                <tr>
                    ${this._resultsLeafTh('No.', 6, 'election-num election-col-votes')}
                    ${this._resultsLeafTh('+/-', 7, 'election-num election-col-delta-votes')}
                    ${this._resultsLeafTh('%', 8, 'election-num election-col-pct-main')}
                    ${this._resultsLeafTh('+/-', 9, 'election-num election-col-pct-delta-main')}
                    ${this._resultsLeafTh('%', 10, 'election-num election-col-pct-small')}
                    ${this._resultsLeafTh('+/-', 11, 'election-num election-col-pct-delta-small')}
                </tr>
            </thead><tbody>${rows}</tbody></table></div>`;
        } else if (tabId === 'local-party') {
            const rows = aggregate.localParties.map((row, idx) => {
                const prevRowKey = `${row.party}::${this._cleanConstituencyDisplayName(row.constituency)}`;
                const prevRow = previousAggregate?.localPartyMap?.get(prevRowKey) || null;
                const stoodDelta = prevRow ? row.stood - prevRow.stood : null;
                const electedDelta = prevRow ? row.elected - prevRow.elected : null;
                const prevVotes = prevRow?.firstPrefs;
                const votesDelta = typeof prevVotes === 'number' ? row.firstPrefs - prevVotes : null;
                const votePct = row.validPoll > 0 ? ((row.firstPrefs / row.validPoll) * 100) : 0;
                const prevVotePct = prevRow?.validPoll > 0
                    ? ((prevRow.firstPrefs / prevRow.validPoll) * 100)
                    : null;
                const votePctDelta = prevVotePct !== null ? votePct - prevVotePct : null;
                const seatPct = row.totalSeats > 0 ? ((row.elected / row.totalSeats) * 100) : 0;
                const prevSeatPct = prevRow?.totalSeats > 0
                    ? ((prevRow.elected / prevRow.totalSeats) * 100)
                    : null;
                const seatPctDelta = prevSeatPct !== null ? seatPct - prevSeatPct : null;
                const districtPct = aggregate.validPoll > 0 ? ((row.firstPrefs / aggregate.validPoll) * 100) : 0;
                const prevDistrictPct = previousAggregate?.validPoll > 0 && prevRow
                    ? ((prevRow.firstPrefs / previousAggregate.validPoll) * 100)
                    : null;
                const districtPctDelta = prevDistrictPct !== null ? districtPct - prevDistrictPct : null;
                return `
                <tr>
                    <td>${rankLabel(idx)}</td>
                    <td class="election-colour-col"><span class="election-party-dot" style="background:${this._esc(row.colour)}"></span></td>
                    <td>${this._renderElectionEntityLink('party', row.party, row.party, 'election-cell-wrap')}</td>
                    <td>${this._renderElectionConstituencyFeatureLink(this.body, this.date, row.constituency, row.constituency, 'election-cell-wrap', 'dea')}</td>
                    <td class="election-num election-col-int">${fmt(row.stood)}</td>
                    <td class="election-num election-col-delta-small">${this._fmtMaybeDeltaOrNA(stoodDelta)}</td>
                    <td class="election-num election-cell-strong election-col-int">${fmt(row.elected)}</td>
                    <td class="election-num election-col-delta-small">${this._fmtMaybeDeltaOrNA(electedDelta)}</td>
                    <td class="election-num election-col-pct-main">${seatPct.toFixed(2)}%</td>
                    <td class="election-num election-col-pct-delta-main">${this._fmtMaybePctDeltaOrNA(seatPctDelta)}</td>
                    <td class="election-num election-col-votes">${fmt(row.firstPrefs)}</td>
                    <td class="election-num election-col-delta-votes">${this._fmtMaybeDeltaOrNA(votesDelta)}</td>
                    <td class="election-num election-col-pct-main">${votePct.toFixed(2)}%</td>
                    <td class="election-num election-col-pct-delta-main">${this._fmtMaybePctDeltaOrNA(votePctDelta)}</td>
                    <td class="election-num election-col-pct-small">${districtPct.toFixed(2)}%</td>
                    <td class="election-num election-col-pct-delta-small">${this._fmtMaybePctDeltaOrNA(districtPctDelta)}</td>
                </tr>`;
            }).join('');
            const districtLocalPartyColGroup = this._resultsColGroup(['rank', 'dot', 'party', 'dea', 'int', 'delta-small', 'int', 'delta-small', 'pct-main', 'pct-delta-main', 'votes', 'delta-votes', 'pct-main', 'pct-delta-main', 'pct-small', 'pct-delta-small']);
            container.innerHTML = `<div class="election-party-wrapper"><table class="election-party-table election-party-table--grouped election-party-table--district-sticky3 election-party-table--district-local-party-sticky4 election-results-table--fixed election-results-table--district">${districtLocalPartyColGroup}<thead>
                <tr>
                    <th rowspan="2" data-leaf-col-idx="0">#</th>
                    <th rowspan="2" colspan="2" data-leaf-col-idx="1">Party</th>
                    <th rowspan="2">DEA</th>
                    <th colspan="2">Candidates</th>
                    <th colspan="4">Seats</th>
                    <th colspan="4">1st preferences</th>
                    <th colspan="2">% of District</th>
                </tr>
                <tr>
                    ${this._resultsLeafTh('No.', 4, 'election-num election-col-int')}
                    ${this._resultsLeafTh('+/-', 5, 'election-num election-col-delta-small')}
                    ${this._resultsLeafTh('No.', 6, 'election-num election-col-int')}
                    ${this._resultsLeafTh('+/-', 7, 'election-num election-col-delta-small')}
                    ${this._resultsLeafTh('%', 8, 'election-num election-col-pct-main')}
                    ${this._resultsLeafTh('+/-', 9, 'election-num election-col-pct-delta-main')}
                    ${this._resultsLeafTh('No.', 10, 'election-num election-col-votes')}
                    ${this._resultsLeafTh('+/-', 11, 'election-num election-col-delta-votes')}
                    ${this._resultsLeafTh('%', 12, 'election-num election-col-pct-main')}
                    ${this._resultsLeafTh('+/-', 13, 'election-num election-col-pct-delta-main')}
                    ${this._resultsLeafTh('%', 14, 'election-num election-col-pct-small')}
                    ${this._resultsLeafTh('+/-', 15, 'election-num election-col-pct-delta-small')}
                </tr>
            </thead><tbody>${rows}</tbody></table></div>`;
        } else {
            const rows = aggregate.parties.map((row, idx) => {
                const prevRow = previousAggregate?.parties?.find((entry) => entry.party === row.party) || null;
                const stoodDelta = prevRow ? row.stood - prevRow.stood : null;
                const electedDelta = prevRow ? row.elected - prevRow.elected : null;
                const prevVotes = prevRow?.firstPrefs;
                const votesDelta = typeof prevVotes === 'number' ? row.firstPrefs - prevVotes : null;
                const votePct = aggregate.validPoll > 0 ? ((row.firstPrefs / aggregate.validPoll) * 100) : 0;
                const prevVotePct = previousAggregate?.validPoll > 0 && prevRow
                    ? ((prevRow.firstPrefs / previousAggregate.validPoll) * 100)
                    : null;
                const votePctDelta = prevVotePct !== null ? votePct - prevVotePct : null;
                const seatPct = aggregate.totalSeats > 0 ? ((row.elected / aggregate.totalSeats) * 100) : 0;
                const prevSeatPct = previousAggregate?.totalSeats > 0 && prevRow
                    ? ((prevRow.elected / previousAggregate.totalSeats) * 100)
                    : null;
                const seatPctDelta = prevSeatPct !== null ? seatPct - prevSeatPct : null;
                return `
                <tr>
                    <td>${rankLabel(idx)}</td>
                    <td class="election-colour-col"><span class="election-party-dot" style="background:${this._esc(row.colour)}"></span></td>
                    <td>${this._renderElectionEntityLink('party', row.party, row.party, 'election-cell-wrap')}</td>
                    <td class="election-num">${fmt(row.stood)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(stoodDelta)}</td>
                    <td class="election-num election-cell-strong">${fmt(row.elected)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(electedDelta)}</td>
                    <td class="election-num">${seatPct.toFixed(2)}%</td>
                    <td class="election-num">${this._fmtMaybePctDeltaOrNA(seatPctDelta)}</td>
                    <td class="election-num">${fmt(row.firstPrefs)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(votesDelta)}</td>
                    <td class="election-num">${votePct.toFixed(2)}%</td>
                    <td class="election-num">${this._fmtMaybePctDeltaOrNA(votePctDelta)}</td>
                </tr>`;
            }).join('');
            const totalStood = aggregate.parties.reduce((sum, row) => sum + (row.stood || 0), 0);
            const totalElected = aggregate.parties.reduce((sum, row) => sum + (row.elected || 0), 0);
            const totalPoll = aggregate.totalPoll || 0;
            const totalElectorate = aggregate.electorate || 0;
            const totalSpoiled = aggregate.spoiled || 0;
            const totalValid = aggregate.validPoll || 0;
            const didNotVote = Math.max(0, totalElectorate - totalPoll);
            const prevTotalPoll = previousAggregate?.totalPoll ?? null;
            const prevTotalElectorate = previousAggregate?.electorate ?? null;
            const prevTotalSpoiled = previousAggregate?.spoiled ?? null;
            const prevTotalValid = previousAggregate?.validPoll ?? null;
            const prevDidNotVote = (typeof prevTotalElectorate === 'number' && typeof prevTotalPoll === 'number')
                ? Math.max(0, prevTotalElectorate - prevTotalPoll)
                : null;
            const turnoutPct = totalElectorate > 0 ? (totalPoll / totalElectorate * 100) : 0;
            const validPct = totalElectorate > 0 ? (totalValid / totalElectorate * 100) : 0;
            const spoiledPct = totalElectorate > 0 ? (totalSpoiled / totalElectorate * 100) : 0;
            const didNotVotePct = totalElectorate > 0 ? (didNotVote / totalElectorate * 100) : 0;
            const prevTurnoutPct = (typeof prevTotalElectorate === 'number' && prevTotalElectorate > 0 && typeof prevTotalPoll === 'number')
                ? (prevTotalPoll / prevTotalElectorate * 100)
                : null;
            const prevValidPct = (typeof prevTotalElectorate === 'number' && prevTotalElectorate > 0 && typeof prevTotalValid === 'number')
                ? (prevTotalValid / prevTotalElectorate * 100)
                : null;
            const prevSpoiledPct = (typeof prevTotalElectorate === 'number' && prevTotalElectorate > 0 && typeof prevTotalSpoiled === 'number')
                ? (prevTotalSpoiled / prevTotalElectorate * 100)
                : null;
            const prevDidNotVotePct = (typeof prevTotalElectorate === 'number' && prevTotalElectorate > 0 && typeof prevDidNotVote === 'number')
                ? (prevDidNotVote / prevTotalElectorate * 100)
                : null;
            const summaryRows = `
                <tr class="election-table-summary-row">
                    <td class="election-rank-col">-</td>
                    <td></td>
                    <td><strong>Valid votes</strong></td>
                    <td class="election-num">${fmt(totalStood)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(0)}</td>
                    <td class="election-num">${fmt(totalElected)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(0)}</td>
                    <td class="election-num election-cell-strong">100.00%</td>
                    <td class="election-num">${this._fmtMaybePctDeltaOrNA(0)}</td>
                    <td class="election-num election-cell-strong">${fmt(totalValid)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(typeof prevTotalValid === 'number' ? totalValid - prevTotalValid : null)}</td>
                    <td class="election-num election-cell-strong">${validPct.toFixed(2)}%</td>
                    <td class="election-num">${this._fmtMaybePctDeltaOrNA(prevValidPct !== null ? validPct - prevValidPct : null)}</td>
                </tr>
                <tr class="election-table-summary-row">
                    <td class="election-rank-col">-</td>
                    <td></td>
                    <td><strong>Turnout</strong></td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num election-cell-strong">${fmt(totalPoll)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(typeof prevTotalPoll === 'number' ? totalPoll - prevTotalPoll : null)}</td>
                    <td class="election-num election-cell-strong">${turnoutPct.toFixed(2)}%</td>
                    <td class="election-num">${this._fmtMaybePctDeltaOrNA(prevTurnoutPct !== null ? turnoutPct - prevTurnoutPct : null)}</td>
                </tr>
                <tr class="election-table-summary-row">
                    <td class="election-rank-col">-</td>
                    <td></td>
                    <td><strong>Spoiled</strong></td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num election-cell-strong">${fmt(totalSpoiled)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(typeof prevTotalSpoiled === 'number' ? totalSpoiled - prevTotalSpoiled : null)}</td>
                    <td class="election-num election-cell-strong">${spoiledPct.toFixed(2)}%</td>
                    <td class="election-num">${this._fmtMaybePctDeltaOrNA(prevSpoiledPct !== null ? spoiledPct - prevSpoiledPct : null)}</td>
                </tr>
                <tr class="election-table-summary-row">
                    <td class="election-rank-col">-</td>
                    <td></td>
                    <td><strong>Did not vote</strong></td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num election-cell-strong">${fmt(didNotVote)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(typeof prevDidNotVote === 'number' ? didNotVote - prevDidNotVote : null)}</td>
                    <td class="election-num election-cell-strong">${didNotVotePct.toFixed(2)}%</td>
                    <td class="election-num">${this._fmtMaybePctDeltaOrNA(prevDidNotVotePct !== null ? didNotVotePct - prevDidNotVotePct : null)}</td>
                </tr>
                <tr class="election-table-summary-row">
                    <td class="election-rank-col">-</td>
                    <td></td>
                    <td><strong>Electorate</strong></td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num">-</td>
                    <td class="election-num election-cell-strong">${fmt(totalElectorate)}</td>
                    <td class="election-num">${this._fmtMaybeDeltaOrNA(typeof prevTotalElectorate === 'number' ? totalElectorate - prevTotalElectorate : null)}</td>
                    <td class="election-num election-cell-strong">100.00%</td>
                    <td class="election-num">${this._fmtMaybePctDeltaOrNA(0)}</td>
                </tr>`;
            container.innerHTML = `<div class="election-party-wrapper"><table class="election-party-table election-party-table--grouped election-party-table--district-sticky3"><thead>
                <tr>
                    <th rowspan="2" data-leaf-col-idx="0">#</th>
                    <th rowspan="2" colspan="2" data-leaf-col-idx="1">Party</th>
                    <th colspan="2">Candidates</th>
                    <th colspan="4">Seats</th>
                    <th colspan="4">1st preferences</th>
                </tr>
                <tr>
                    ${this._resultsLeafTh('No.', 3, 'election-num')}
                    ${this._resultsLeafTh('+/-', 4, 'election-num')}
                    ${this._resultsLeafTh('No.', 5, 'election-num')}
                    ${this._resultsLeafTh('+/-', 6, 'election-num')}
                    ${this._resultsLeafTh('%', 7, 'election-num')}
                    ${this._resultsLeafTh('+/-', 8, 'election-num')}
                    ${this._resultsLeafTh('No.', 9, 'election-num')}
                    ${this._resultsLeafTh('+/-', 10, 'election-num')}
                    ${this._resultsLeafTh('%', 11, 'election-num')}
                    ${this._resultsLeafTh('+/-', 12, 'election-num')}
                </tr>
            </thead><tbody>${rows}${summaryRows}</tbody></table></div>`;
        }
        this._setupResultsTableControls(container);
        this._bindElectionEntityLinks(container);
    }

    _showConstituencyPanel(constName, preferredTab = null) {
        this.selectedConstituency = constName;
        if (this._specialElection?.type === 'recall-petition') {
            this._showRecallPetitionPanel(constName);
            if (this.onStateChange) this.onStateChange();
            return;
        }
        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        if (!content) return;

        const payload = this._getCurrentConstituencyPayload(constName);
        if (!payload) {
            content.innerHTML = `<div class="election-no-data">No results available for ${this._esc(constName)}</div>`;
            return;
        }

        this._hideAnimation();
        if (this._animScaffold && this._animScaffold.parentNode) {
            this._animScaffold.parentNode.removeChild(this._animScaffold);
        }

        const hasMultipleRounds = payload?.Constituency?.countGroup?.some(r => parseInt(r.Count_Number) > 1);
        const hasAnimation = hasMultipleRounds && typeof animateStages === 'function';

        content.innerHTML = '';
        content.style.display = 'flex';
        content.style.flexDirection = 'column';

        const headerRight = document.getElementById('electionPaneHeaderRight');
        const titleEl = document.getElementById('electionPaneTitle');
        let initialTab = 'party';
        if (headerRight && titleEl) {
            const prevActiveTab = preferredTab
                || this._constituencyActiveTab
                || headerRight.querySelector('.election-view-tab--active')?.dataset.tab
                || 'party';
            titleEl.textContent = constName;

            const closeBtn = headerRight.querySelector('#electionCloseBtn');
            headerRight.innerHTML = '';

            const backBtn = document.createElement('button');
            backBtn.className = 'election-pane__back';
            backBtn.innerHTML = "<";
            backBtn.title = 'Back to summary';
            backBtn.addEventListener('click', () => {
                this.selectedConstituency = null;
                this._hideAnimation();
                content.style.display = '';
                content.style.flexDirection = '';
                titleEl.textContent = this._niWideTitle();
                this._restoreHeaderTabs();
                this._showNIWideResults();
                if (this.onStateChange) this.onStateChange();
            });
            headerRight.appendChild(backBtn);

            const tabDefs = [
                { id: 'party', label: 'By Party' },
                { id: 'counts', label: 'By Count' },
            ];
            if (hasAnimation) {
                tabDefs.push({ id: 'animation', label: 'Transfers' });
            }

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

            if (closeBtn) headerRight.appendChild(closeBtn);
        }

        if (this._animScaffold) {
            this._animScaffold.style.display = 'none';
            content.appendChild(this._animScaffold);
        }

        this._constituencyActiveTab = initialTab;
        this._renderConstituencyView(initialTab, constName, payload, content);

        if (this.onStateChange) this.onStateChange();
    }

    _showRecallPetitionPanel(constName) {
        const content = this.splitPaneEl?.querySelector('#electionPaneContent');
        const headerRight = document.getElementById('electionPaneHeaderRight');
        const titleEl = document.getElementById('electionPaneTitle');
        if (!content || !headerRight || !titleEl) return;

        const recall = this.resultsByConstituency?.[constName]?.Constituency?.recallPetition;
        if (!recall) {
            content.innerHTML = `<div class="election-no-data">No recall petition data available for ${this._esc(constName)}</div>`;
            return;
        }

        this._hideAnimation();
        if (this._animScaffold && this._animScaffold.parentNode) {
            this._animScaffold.parentNode.removeChild(this._animScaffold);
        }

        titleEl.textContent = constName;
        const closeBtn = headerRight.querySelector('#electionCloseBtn');
        headerRight.innerHTML = '';

        const backBtn = document.createElement('button');
        backBtn.className = 'election-pane__back';
        backBtn.innerHTML = "<";
        backBtn.title = 'Back to summary';
        backBtn.addEventListener('click', () => {
            this.selectedConstituency = null;
            this._showRecallPetitionOverview(content);
            if (this.onStateChange) this.onStateChange();
        });
        headerRight.appendChild(backBtn);
        if (closeBtn) headerRight.appendChild(closeBtn);

        content.style.overflowY = 'auto';
        content.style.overflowX = 'hidden';
        content.style.display = '';
        content.style.flexDirection = '';
        this._currentResultsView = { type: 'recall-constituency', constName };

        content.innerHTML = `
            <div class="election-entity-page">
                <div class="election-entity-page__hero">
                    <span class="election-party-dot election-party-dot--hero" style="background:${this._esc(this._specialElection.fillColor)}"></span>
                    <div>
                        <div class="election-entity-page__eyebrow">Recall Petition Result</div>
                        <h3 class="election-entity-page__title">${this._esc(constName)}</h3>
                        <p class="election-entity-page__subtitle">${this._esc(this._formatDate(this.date))}</p>
                    </div>
                </div>
                <div class="election-entity-metrics">
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Threshold to trigger by-election</span><strong>${recall.thresholdPct.toFixed(1)}%</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Signed</span><strong>${recall.signedPct.toFixed(1)}%</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">Shortfall</span><strong>${(recall.thresholdPct - recall.signedPct).toFixed(1)}%</strong></div>
                    <div class="election-entity-metric"><span class="election-entity-metric__label">By-election triggered</span><strong>${recall.successful ? 'Yes' : 'No'}</strong></div>
                </div>
                <div class="catalogue-detail__meta">
                    <div class="catalogue-detail__meta-row">
                        <span class="catalogue-detail__meta-label">Outcome</span>
                        <span class="catalogue-detail__meta-value">${this._esc(recall.outcome)}</span>
                    </div>
                </div>
                <div class="catalogue-detail__section">
                    <div class="catalogue-detail__section-title">Notes</div>
                    <div class="catalogue-detail__description">
                        ${(recall.notes || []).map((note) => `<p>${this._esc(note)}</p>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    _renderConstituencyView(tabId, constName, payload, container) {
        // Always hide animation first when switching away
        if (tabId !== 'animation') {
            this._hideAnimation();
        }
        this._currentResultsView = { type: 'constituency', constName, tabId };

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
                this._bindElectionEntityLinks(container);
                break;
            case 'counts':
                container.innerHTML = this._buildCountTable(constName, payload);
                this._setupResultsTableControls(container);
                this._bindElectionEntityLinks(container);
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
            if (!this._isValidCandidateRow(row)) return;
            const party = this._normaliseLivePartyName(row.Party_Name);
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
            if (!Number.isFinite(Number(n))) return '<span class="election-na"><em>N/A</em></span>';
            const r = Math.round(n);
            const s = r > 0 ? `+${r.toLocaleString('en-GB')}` : r.toLocaleString('en-GB');
            const cls = r > 0 ? 'election-delta election-delta--pos' : r < 0 ? 'election-delta election-delta--neg' : 'election-delta';
            return `<span class="${cls}">${s}</span>`;
        };
        const fmtPctDelta = (n) => {
            if (!Number.isFinite(Number(n))) return '<span class="election-na"><em>N/A</em></span>';
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
            <th data-sort-key="rank">#</th>
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
                <td class="${isSeatWinner ? ' election-party-emphasis' : ''}">${this._renderElectionEntityLink('party', p.name, p.name, 'election-cell-wrap')}</td>
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
        const leafHeaders = [...table.querySelectorAll('thead th[data-leaf-col-idx]')];
        const headers = leafHeaders.length ? leafHeaders : [...table.querySelectorAll('thead th')];
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
            if (!cleaned || cleaned === '-' || cleaned === '�' || cleaned.toLowerCase() === 'n/a') return null;
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
        const headerColumnIndex = (th, fallbackIdx) => {
            const mapped = Number(th?.dataset?.leafColIdx);
            return Number.isFinite(mapped) ? mapped : fallbackIdx;
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
            const colIdx = sortState.col ?? headerColumnIndex(headers[0], 0);
            const sortHeader = headers.find((th, idx) => headerColumnIndex(th, idx) === colIdx) || headers[0];
            const kind = inferColumnKind(colIdx, sortHeader);
            visible = [...visible].sort((a, b) => compareRows(a, b, colIdx, sortState.dir, kind));
            tbody.innerHTML = '';
            visible.forEach(({ row }) => tbody.appendChild(row));
            fixedRows.forEach(({ row }) => tbody.appendChild(row));

            headers.forEach((th, idx) => {
                const btn = th.querySelector('[data-table-filter-sort-btn]');
                if (!btn) return;
                const colIdx = headerColumnIndex(th, idx);
                const filtered = filterState.has(colIdx) && (filterState.get(colIdx)?.size ?? 0) > 0;
                const sorted = sortState.col === colIdx && sortState.dir !== 'default';
                btn.classList.toggle('election-th-btn--active', filtered || sorted);
                if (sorted && sortState.dir === 'asc') btn.innerHTML = '&#8593;';
                else if (sorted && sortState.dir === 'desc') btn.innerHTML = '&#8595;';
                else btn.innerHTML = '&#8645;';
            });
        };

        const openMenuForColumn = (idx, anchorBtn) => {
            closeMenu();
            const th = headers[idx];
            const colIdx = headerColumnIndex(th, idx);
            const kind = inferColumnKind(colIdx, th);
            const options = getUniqueValues(colIdx);
            const current = filterState.get(colIdx);
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
                    sortState.col = colIdx;
                    sortState.dir = 'asc';
                    applyState();
                    closeMenu();
                } else if (action === 'sort-desc') {
                    sortState.col = colIdx;
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
                    filterState.delete(colIdx);
                    applyState();
                    closeMenu();
                } else if (action === 'apply') {
                    if (selected.size === 0 || selected.size === options.length) filterState.delete(colIdx);
                    else filterState.set(colIdx, new Set(selected));
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
            if (th.classList.contains('election-col-compact')
                || th.classList.contains('election-col-int')
                || th.classList.contains('election-col-delta')
                || th.classList.contains('election-col-delta-small')
                || th.classList.contains('election-col-delta-votes')
                || th.classList.contains('election-col-pct')
                || th.classList.contains('election-col-pct-main')
                || th.classList.contains('election-col-pct-small')
                || th.classList.contains('election-col-pct-delta-main')
                || th.classList.contains('election-col-pct-delta-small')
                || th.classList.contains('election-col-count')
                || th.classList.contains('election-col-status-count')
                || th.classList.contains('election-col-votes')) {
                wrap.classList.add('election-th-controls--compact');
            }
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
        window.requestAnimationFrame(() => this._autosizeFixedResultsTable(table));
    }

    _buildCountTable(constName, payload) {
        const cg = payload.Constituency.countGroup;
        const info = payload.Constituency.countInfo;
        const countNums = [...new Set(cg.map(r => parseInt(r.Count_Number, 10)))].sort((a, b) => a - b);
        const numSeats = this._getSeatCount(info);
        const lastCount = countNums[countNums.length - 1] || 1;

        const candidates = {};
        const nonTransferable = {};
        cg.forEach(row => {
            const id = row.Candidate_Id;
            if (String(id).toLowerCase() === 'nontransferable') {
                const countNum = parseInt(row.Count_Number, 10) || 1;
                nonTransferable[countNum] = {
                    total: parseFloat(row.Total_Votes) || 0,
                    transfers: parseFloat(row.Transfers) || 0
                };
                return;
            }
            if (!candidates[id]) {
                candidates[id] = {
                    personId: row.id || id,
                    name: this._candidateDisplayName(row),
                    firstname: this._cleanElectionCandidateText(row.Firstname || ''),
                    surname: this._cleanElectionCandidateText(row.Surname || ''),
                    party: this._normaliseLivePartyName(row.Party_Name),
                    colour: row.Party_Colour || '#b0bec5',
                    counts: {},
                    finalVotes: 0,
                    firstPref: 0,
                    electedAt: null,
                    excludedAt: null,
                    terminalCount: null
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
            if (total > candidates[id].finalVotes) candidates[id].finalVotes = total;
        });

        Object.values(candidates).forEach((candidate) => {
            const lifecycle = this._inferCandidateLifecycle(candidate, info, lastCount);
            candidate.electedAt = lifecycle.electedAt;
            candidate.excludedAt = lifecycle.excludedAt;
            candidate.terminalCount = lifecycle.terminalCount;
        });
        const rawVisibleCounts = countNums.filter(n => n > 1);
        const countEvents = this._inferCountEvents(candidates, info, rawVisibleCounts);
        const visibleCounts = rawVisibleCounts.filter((n) => {
            const hasEvent = countEvents.has(n);
            if (hasEvent) return true;
            const hasCandidateTransfer = Object.values(candidates).some((candidate) => {
                const transfer = parseFloat(candidate.counts[n]?.transfers) || 0;
                return Math.abs(transfer) > 0.0001;
            });
            if (hasCandidateTransfer) return true;
            const ntTransfer = parseFloat(nonTransferable[n]?.transfers) || 0;
            return Math.abs(ntTransfer) > 0.0001;
        });
        const totalCountCount = visibleCounts.length + 1;
        const visibleLastCount = visibleCounts.length ? visibleCounts[visibleCounts.length - 1] : 1;
        const displayCountForRaw = (rawCount) => {
            const raw = parseInt(rawCount, 10) || 1;
            if (raw <= 1) return 1;
            const visibleUpToRaw = visibleCounts.filter((n) => n <= raw).length;
            return 1 + visibleUpToRaw;
        };
        const countTransferTotals = new Map();
        visibleCounts.forEach((n) => {
            let negAbs = 0;
            let pos = 0;
            Object.values(candidates).forEach((candidate) => {
                const t = parseFloat(candidate.counts[n]?.transfers) || 0;
                if (t < -0.0001) negAbs += Math.abs(t);
                else if (t > 0.0001) pos += t;
            });
            const ntTransfer = parseFloat(nonTransferable[n]?.transfers) || 0;
            if (ntTransfer > 0.0001) pos += ntTransfer;
            countTransferTotals.set(n, { negAbs, pos });
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

        const electedTieBreakVotes = (candidate) => {
            const redistributionCount = countNums.find((n) => {
                const cnt = candidate.counts[n];
                return cnt && Number.isFinite(cnt.transfers) && cnt.transfers < -0.0001;
            });
            if (redistributionCount && redistributionCount > 1) {
                const prior = candidate.counts[redistributionCount - 1];
                if (prior && Number.isFinite(prior.total)) return prior.total;
            }
            const finalCountEntry = candidate.counts[lastCount];
            if (finalCountEntry && Number.isFinite(finalCountEntry.total)) return finalCountEntry.total;
            const observed = Object.values(candidate.counts)
                .map((c) => c?.total)
                .filter((v) => Number.isFinite(v));
            return observed.length ? observed[observed.length - 1] : 0;
        };

        const sortedCandidates = Object.entries(candidates).sort((a, b) => {
            if (a[1].electedAt && !b[1].electedAt) return -1;
            if (!a[1].electedAt && b[1].electedAt) return 1;
            if (a[1].electedAt && b[1].electedAt) {
                if (a[1].electedAt !== b[1].electedAt) return a[1].electedAt - b[1].electedAt;
                const aTieVotes = electedTieBreakVotes(a[1]);
                const bTieVotes = electedTieBreakVotes(b[1]);
                if (Math.abs(aTieVotes - bTieVotes) > 0.0001) return bTieVotes - aTieVotes;
                if (Math.abs((b[1].firstPref || 0) - (a[1].firstPref || 0)) > 0.0001) return (b[1].firstPref || 0) - (a[1].firstPref || 0);
                return String(a[1].name || '').localeCompare(String(b[1].name || ''));
            }
            return b[1].finalVotes - a[1].finalVotes;
        });

        const validPoll = parseFloat(info.Valid_Poll) || 0;
        const totalPoll = parseFloat(info.Total_Poll) || 0;
        const electorate = parseFloat(info.Total_Electorate) || 0;
        const spoiled = parseFloat(info.Spoiled) || 0;
        const didNotVote = Math.max(0, electorate - totalPoll);

        const fmt = (n) => Math.round(n).toLocaleString('en-GB');
        const fmtDelta = (n) => {
            if (!Number.isFinite(Number(n))) return '<span class="election-na"><em>N/A</em></span>';
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
            if (c.electedAt) return `Elected<br>Count ${displayCountForRaw(c.electedAt)}/${totalCountCount}`;
            if (c.excludedAt) return `Excluded<br>Count ${displayCountForRaw(c.excludedAt)}/${totalCountCount}`;
            return `Not Elected<br>Count ${displayCountForRaw(visibleLastCount)}/${totalCountCount}`;
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
        html += `<div class="election-count-wrapper election-count-wrapper--pane-sticky">`;
        html += `<table class="election-count-table"><thead><tr>`;
        html += `<th>#</th>`;
        html += `<th class="election-colour-col"></th>`;
        html += `<th class="election-col-name">Name</th>`;
        html += `<th class="election-col-party">Party</th>`;
        html += `<th class="election-col-status">Status</th>`;
        html += `<th class="election-num">${this._thTwoLine('1st', 'pref +/-')}</th>`;
        html += `<th class="election-num">${this._thTwoLine('1st', 'pref %')}</th>`;
        if (this._countDetailedView) {
            html += `<th class="election-num">${this._thTwoLine('1st', 'pref +/- %')}</th>`;
        }
        html += `<th class="election-num">${this._thTwoLine('1st', 'pref')}</th>`;
        visibleCounts.forEach(n => {
            const event = countEvents.get(n);
            const headerTop = this._countDetailedView ? `Count ${n}` : 'Count';
            const headerBottom = this._countDetailedView && event ? `${event.type} of ${event.label}` : String(n);
            html += `<th class="election-num">${this._thTwoLine(headerTop, headerBottom)}</th>`;
            if (this._countDetailedView) {
                html += `<th class="election-num">${this._thTwoLine(`Count ${n}`, '%')}</th>`;
                html += `<th class="election-num">${this._thTwoLine(`Count ${n}`, '+/- %')}</th>`;
                html += `<th class="election-num">${this._thTwoLine(`Count ${n}`, '+/-')}</th>`;
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
            html += `<td class="election-col-name">${this._renderElectionEntityLink('candidate', c.personId, c.name, 'election-cell-wrap election-cell-wrap--count-name')}</td>`;
            html += `<td class="election-col-party">${this._renderElectionEntityLink('party', c.party, c.party, 'election-cell-wrap election-cell-wrap--count-party')}</td>`;
            html += `<td class="election-col-status"><span class="election-cell-wrap election-cell-wrap--count-status">${rowStatus(c)}</span></td>`;
            html += `<td class="election-num">${this._fmtMaybeDeltaOrNA(firstPrefDelta)}</td>`;
            html += `<td class="election-num">${pct(c.firstPref).toFixed(2)}%</td>`;
            if (this._countDetailedView) {
                html += `<td class="election-num">${this._fmtMaybePctDeltaOrNA(firstPrefPctDelta)}</td>`;
            }
            html += `<td class="election-num">${fmt(c.firstPref)}</td>`;

            visibleCounts.forEach(n => {
                if (c.terminalCount && n > c.terminalCount) {
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
                    html += `<td class="election-num election-count-col">&nbsp;</td>`;
                    if (this._countDetailedView) {
                        html += `<td class="election-num election-count-col">&mdash;</td>`;
                        html += `<td class="election-num election-count-col">&mdash;</td>`;
                        html += `<td class="election-num election-count-col">&mdash;</td>`;
                    }
                } else {
                    let cls = '';
                    if (this._statusKind(cnt.status) === 'elected') cls = ' count-elected';
                    if (this._statusKind(cnt.status) === 'excluded') cls = ' count-excluded';
                    const cell = fmt(cnt.total);
                    const transferTotals = countTransferTotals.get(n) || { negAbs: 0, pos: 0 };
                    let transferPct = NaN;
                    if (cnt.transfers < -0.0001 && transferTotals.negAbs > 0) {
                        transferPct = (cnt.transfers / transferTotals.negAbs) * 100;
                    } else if (cnt.transfers > 0.0001 && transferTotals.pos > 0) {
                        transferPct = (cnt.transfers / transferTotals.pos) * 100;
                    } else if (Math.abs(cnt.transfers) <= 0.0001) {
                        transferPct = 0;
                    }
                    const votePct = validPoll > 0 ? (cnt.total / validPoll * 100) : 0;
                    html += `<td class="election-num election-count-col ${cls}">${cell}</td>`;
                    if (this._countDetailedView) {
                        html += `<td class="election-num election-count-col">${votePct.toFixed(2)}%</td>`;
                        html += `<td class="election-num election-count-col">${Number.isFinite(transferPct) ? this._fmtPctDeltaSigned(transferPct) : '&mdash;'}</td>`;
                        const deltaText = cnt.transfers !== 0 ? this._fmtDeltaSigned(cnt.transfers) : '\u2014';
                        html += `<td class="election-num election-count-col">${deltaText}</td>`;
                    }
                }
            });
            html += `</tr>`;
        });

        if (Object.keys(nonTransferable).length) {
            html += `<tr class="election-table-summary-row">`;
            html += `<td class="election-rank-col">-</td>`;
            html += `<td></td>`;
            html += `<td><strong>Non-transferable</strong></td>`;
            html += `<td>-</td>`;
            html += `<td>-</td>`;
            html += `<td class="election-num">-</td>`;
            html += `<td class="election-num">-</td>`;
            if (this._countDetailedView) {
                html += `<td class="election-num">-</td>`;
            }
            html += `<td class="election-num">-</td>`;
            visibleCounts.forEach((n) => {
                const cnt = nonTransferable[n];
                html += `<td class="election-num election-count-col">${cnt ? fmt(cnt.total) : '&nbsp;'}</td>`;
                if (this._countDetailedView) {
                    html += `<td class="election-num election-count-col">${cnt && validPoll > 0 ? ((cnt.total / validPoll) * 100).toFixed(2) + '%' : '&mdash;'}</td>`;
                    const transferTotals = countTransferTotals.get(n) || { negAbs: 0, pos: 0 };
                    const ntTransfer = parseFloat(cnt?.transfers) || 0;
                    let ntTransferPct = NaN;
                    if (ntTransfer > 0.0001 && transferTotals.pos > 0) {
                        ntTransferPct = (ntTransfer / transferTotals.pos) * 100;
                    } else if (Math.abs(ntTransfer) <= 0.0001) {
                        ntTransferPct = 0;
                    }
                    html += `<td class="election-num election-count-col">${Number.isFinite(ntTransferPct) ? this._fmtPctDeltaSigned(ntTransferPct) : '&mdash;'}</td>`;
                    html += `<td class="election-num election-count-col">${cnt && cnt.transfers !== 0 ? this._fmtDeltaSigned(cnt.transfers) : '&mdash;'}</td>`;
                }
            });
            html += `</tr>`;
        }

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
        const maxWidth = paneContent ? paneContent.clientWidth - 16 : 0; // 16 = container padding (8Ã—2)

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

        // â”€â”€ Apply fit-to-pane scaling â”€â”€
        // Delay to let the browser complete layout of the animation content
        setTimeout(() => this._applyAnimationScale(), 200);

        // â”€â”€ Re-scale on window resize / split pane drag â”€â”€
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
                    personId: row.Candidate_Id,
                    name: this._candidateDisplayName(row),
                    party: this._normaliseLivePartyName(row.Party_Name),
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
                <td><span class="election-party-dot" style="background:${this._esc(c.colour)}"></span>${this._renderElectionEntityLink('candidate', c.personId, c.name)} <small class="election-party-label">(${this._esc(c.party)})</small></td>
                <td class="election-num">${fmt(c.votes)}</td>
                <td class="election-num">${pct(c.votes)}</td>
                <td class="${statCls}">${this._esc(c.status || '-')}</td>
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
        const direct = this.previousResultsByConstituency?.[constName] || null;
        if (direct) return direct;
        const cleanedName = this._cleanConstituencyDisplayName(constName);
        for (const [key, payload] of Object.entries(this.previousResultsByConstituency || {})) {
            if (this._cleanConstituencyDisplayName(key) === cleanedName) return payload;
        }
        return null;
    }

    _getCurrentConstituencyPayload(constName) {
        if (!constName) return null;
        const direct = this.resultsByConstituency?.[constName] || null;
        if (direct) return direct;
        const cleanedName = this._cleanConstituencyDisplayName(constName);
        for (const [key, payload] of Object.entries(this.resultsByConstituency || {})) {
            if (this._cleanConstituencyDisplayName(key) === cleanedName) return payload;
        }
        return null;
    }

    _getPreviousFirstPrefsByCandidate(constName) {
        const payload = this._getPreviousConstituencyPayload(constName);
        const map = new Map();
        const cg = payload?.Constituency?.countGroup || [];
        const seen = new Set();
        cg.forEach(row => {
            const countNum = parseInt(row.Count_Number, 10) || 1;
            const cid = String(row.Candidate_Id || '');
            if (countNum !== 1 || !this._isValidCandidateRow(row) || seen.has(cid)) return;
            seen.add(cid);
            const name = this._candidateDisplayName(row);
            const party = this._normaliseLivePartyName(row.Party_Name);
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
            if (countNum !== 1 || !this._isValidCandidateRow(row) || seen.has(cid)) return;
            seen.add(cid);
            const party = this._normaliseLivePartyName(row.Party_Name);
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
            const party = this._normaliseLivePartyName(row.Party_Name);
            const countNum = parseInt(row.Count_Number, 10) || 1;
            const cid = String(row.Candidate_Id || '');
            if (!stats.has(party)) {
                stats.set(party, { stood: 0, seats: 0, firstPrefs: 0 });
            }
            const partyStats = stats.get(party);
            if (countNum === 1 && this._isValidCandidateRow(row) && !seen.has(cid)) {
                seen.add(cid);
                partyStats.stood += 1;
                partyStats.firstPrefs += parseFloat(row.Total_Votes) || 0;
            }
            if (this._isValidCandidateRow(row) && this._statusKind(row.Status) === 'elected' && !electedSeen.has(cid)) {
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

    _normaliseLivePartyName(party) {
        const raw = String(party || '').trim();
        if (!raw) return 'Independent';
        if (raw === "Workers' Party (Ireland)") return 'Workers Party / Republican Clubs';
        return raw;
    }

    _thTwoLine(top, bottom) {
        const topEsc = this._esc(top || '');
        const bottomEsc = this._esc(bottom || '');
        return `<span class="election-th-two-line"><span class="election-th-two-line__top">${topEsc}</span><span class="election-th-two-line__bottom">${bottomEsc || '&nbsp;'}</span></span>`;
    }

    _resultsLeafTh(label, colIdx, extraClass = '') {
        const cls = [extraClass].filter(Boolean).join(' ');
        return `<th${cls ? ` class="${cls}"` : ''} data-leaf-col-idx="${colIdx}">${label}</th>`;
    }

    _resultsColGroup(roles = []) {
        return `<colgroup>${(roles || []).map((role) =>
            `<col class="election-col-track election-col-track--${String(role || '').trim()}">`
        ).join('')}</colgroup>`;
    }

    _isAutoSizedFixedResultsRole(role = '') {
        return [
            'name',
            'party',
            'constituency',
            'district',
            'dea',
            'outcome',
            'status-count',
            'int',
            'delta-small',
            'votes',
            'delta-votes',
            'pct-main',
            'pct-delta-main',
            'pct-small',
            'pct-delta-small'
        ].includes(String(role || '').trim());
    }

    _isWrappedFixedResultsRole(role = '') {
        return [
            'name',
            'party',
            'constituency',
            'district',
            'dea',
            'outcome'
        ].includes(String(role || '').trim());
    }

    _measureFixedResultsTextWidth(text, sourceEl, canvasCtx) {
        const sample = String(text || '').replace(/\s+/g, ' ').trim();
        if (!sample || !sourceEl || !canvasCtx || !window.getComputedStyle) return 0;
        const style = window.getComputedStyle(sourceEl);
        canvasCtx.font = style.font || [
            style.fontStyle,
            style.fontVariant,
            style.fontWeight,
            style.fontStretch,
            style.fontSize,
            '/',
            style.lineHeight,
            style.fontFamily
        ].filter(Boolean).join(' ');
        return Math.ceil(canvasCtx.measureText(sample).width);
    }

    _measureWrappedFixedResultsWidth(text, sourceEl, maxLines = 2) {
        const sample = String(text || '').replace(/\s+/g, ' ').trim();
        if (!sample || !sourceEl || !window.getComputedStyle || !document?.body) return 0;

        const probeCanvas = document.createElement('canvas');
        const probeCtx = probeCanvas.getContext('2d');
        if (!probeCtx) return 0;

        const style = window.getComputedStyle(sourceEl);
        const fontSize = parseFloat(style.fontSize || '') || 16;
        const lineHeight = parseFloat(style.lineHeight || '') || Math.ceil(fontSize * 1.2);
        const singleLineWidth = Math.max(1, this._measureFixedResultsTextWidth(sample, sourceEl, probeCtx));

        const probe = document.createElement('span');
        probe.textContent = sample;
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.left = '-99999px';
        probe.style.top = '0';
        probe.style.display = 'block';
        probe.style.whiteSpace = 'normal';
        probe.style.wordBreak = style.wordBreak || 'normal';
        probe.style.overflowWrap = style.overflowWrap || 'normal';
        probe.style.hyphens = style.hyphens || 'auto';
        probe.style.font = style.font || [
            style.fontStyle,
            style.fontVariant,
            style.fontWeight,
            style.fontStretch,
            style.fontSize,
            '/',
            style.lineHeight,
            style.fontFamily
        ].filter(Boolean).join(' ');
        probe.style.lineHeight = style.lineHeight || '';
        document.body.appendChild(probe);

        try {
            let low = Math.max(48, Math.ceil(singleLineWidth / maxLines));
            let high = Math.max(low, singleLineWidth);
            let best = high;
            const maxHeight = Math.ceil(lineHeight * maxLines) + 1;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                probe.style.width = `${mid}px`;
                const height = Math.ceil(probe.getBoundingClientRect().height);
                if (height <= maxHeight) {
                    best = mid;
                    high = mid - 1;
                } else {
                    low = mid + 1;
                }
            }

            return Math.ceil(best);
        } finally {
            probe.remove();
        }
    }

    _autosizeFixedResultsTable(table) {
        if (!table || !table.classList.contains('election-results-table--fixed')) return;

        const cols = [...table.querySelectorAll('colgroup col')];
        if (!cols.length) return;

        const rows = [...table.querySelectorAll('tbody tr')];
        const leafHeaders = [...table.querySelectorAll('thead th[data-leaf-col-idx]')];
        const leafHeaderByIdx = new Map();
        leafHeaders.forEach((th) => {
            const idx = Number(th.dataset.leafColIdx);
            if (Number.isFinite(idx)) leafHeaderByIdx.set(idx, th);
        });
        const canvas = document.createElement('canvas');
        const canvasCtx = canvas.getContext('2d');
        if (!canvasCtx) return;

        cols.forEach((col, colIdx) => {
            const roleMatch = String(col.className || '').match(/election-col-track--([a-z-]+)/);
            const role = roleMatch ? roleMatch[1] : '';
            if (!this._isAutoSizedFixedResultsRole(role)) return;
            const computedColWidth = window.getComputedStyle ? (parseFloat(window.getComputedStyle(col).width || '') || 0) : 0;

            const header = leafHeaderByIdx.get(colIdx) || null;
            let maxWidth = 0;
            if (header) {
                const labelEl = header.querySelector('.election-th-label') || header;
                const buttonEl = header.querySelector('.election-th-btn');
                const headerStyle = window.getComputedStyle ? window.getComputedStyle(header) : null;
                const labelWidth = this._measureFixedResultsTextWidth(labelEl.textContent || '', labelEl, canvasCtx);
                const buttonWidth = buttonEl ? Math.ceil(buttonEl.getBoundingClientRect().width || 0) : 0;
                const gapWidth = buttonEl ? 6 : 0;
                const horizontalPadding = headerStyle
                    ? Math.ceil((parseFloat(headerStyle.paddingLeft) || 0) + (parseFloat(headerStyle.paddingRight) || 0))
                    : 0;
                maxWidth = labelWidth + buttonWidth + gapWidth + horizontalPadding;
            }

            rows.forEach((row) => {
                const cell = row.children[colIdx];
                if (!cell) return;
                const cellStyle = window.getComputedStyle ? window.getComputedStyle(cell) : null;
                const cellContent = cell.firstElementChild || cell;
                const contentWidth = role === 'district'
                    ? this._measureWrappedFixedResultsWidth(cell.textContent || '', cellContent, 2)
                    : this._measureFixedResultsTextWidth(cell.textContent || '', cellContent, canvasCtx);
                const horizontalPadding = cellStyle
                    ? Math.ceil((parseFloat(cellStyle.paddingLeft) || 0) + (parseFloat(cellStyle.paddingRight) || 0))
                    : 0;
                const measuredWidth = contentWidth + horizontalPadding;
                if (!measuredWidth) return;
                maxWidth = Math.max(maxWidth, measuredWidth + 8);
            });

            if (role === 'district') {
                maxWidth = Math.max(maxWidth, computedColWidth || 0);
            } else if (this._isWrappedFixedResultsRole(role) && computedColWidth > 0) {
                maxWidth = Math.min(maxWidth || computedColWidth, computedColWidth);
            }

            const finalWidth = `${Math.ceil(maxWidth)}px`;
            col.style.width = finalWidth;
            col.style.minWidth = finalWidth;
            col.style.maxWidth = finalWidth;

            const headerCell = leafHeaderByIdx.get(colIdx);
            if (headerCell) {
                headerCell.style.width = finalWidth;
                headerCell.style.minWidth = finalWidth;
                headerCell.style.maxWidth = finalWidth;
            }

            rows.forEach((row) => {
                const cell = row.children[colIdx];
                if (!cell) return;
                cell.style.width = finalWidth;
                cell.style.minWidth = finalWidth;
                cell.style.maxWidth = finalWidth;
            });
        });

        const computedStyles = window.getComputedStyle ? cols.map((col) => window.getComputedStyle(col)) : [];
        const resolvedWidths = cols.map((col, idx) =>
            Math.ceil(Math.max(
                parseFloat(col.style.width) || 0,
                parseFloat(computedStyles[idx]?.width || '') || 0,
                col.getBoundingClientRect().width || 0
            ))
        );
        const totalWidth = resolvedWidths.reduce((sum, width) => sum + width, 0);
        if (table.classList.contains('election-count-table--local-party-sticky4')) {
            table.style.setProperty('--results-sticky-col-1-width', `${resolvedWidths[0] || 0}px`);
            table.style.setProperty('--results-sticky-local-party-width', `${resolvedWidths[1] || 0}px`);
            table.style.setProperty('--results-sticky-local-district-width', `${resolvedWidths[2] || 0}px`);
            table.style.setProperty('--results-sticky-local-dea-width', `${resolvedWidths[3] || 0}px`);
        }
        if (table.classList.contains('election-count-table--nonlocal-local-party-sticky3')) {
            table.style.setProperty('--results-sticky-col-1-width', `${resolvedWidths[0] || 0}px`);
            table.style.setProperty('--results-sticky-nonlocal-party-width', `${resolvedWidths[1] || 0}px`);
            table.style.setProperty('--results-sticky-nonlocal-constituency-width', `${resolvedWidths[2] || 0}px`);
        }
        if (table.classList.contains('election-count-table--candidate-sticky3')) {
            table.style.setProperty('--results-sticky-col-1-width', `${resolvedWidths[0] || 0}px`);
            table.style.setProperty('--results-sticky-name-width', `${resolvedWidths[1] || 0}px`);
            table.style.setProperty('--results-sticky-party-width', `${resolvedWidths[2] || 0}px`);
        }
        if (table.classList.contains('election-party-table--candidate-sticky3')) {
            table.style.setProperty('--results-sticky-col-1-width', `${resolvedWidths[0] || 0}px`);
            table.style.setProperty('--results-sticky-name-width', `${resolvedWidths[1] || 0}px`);
            table.style.setProperty('--results-sticky-party-width', `${resolvedWidths[2] || 0}px`);
        }
        if (table.classList.contains('election-party-table--district-local-party-sticky4')) {
            table.style.setProperty('--results-sticky-col-1-width', `${resolvedWidths[0] || 0}px`);
            table.style.setProperty('--results-sticky-col-2-width', `${resolvedWidths[1] || 0}px`);
            table.style.setProperty('--results-sticky-district-party-name-width', `${resolvedWidths[2] || 0}px`);
            table.style.setProperty('--results-sticky-district-dea-width', `${resolvedWidths[3] || 0}px`);
        }
        if (totalWidth > 0) {
            const tableWidth = `${totalWidth}px`;
            table.style.width = tableWidth;
            table.style.minWidth = tableWidth;
            table.style.maxWidth = tableWidth;
        }
    }

    _statusKind(status) {
        const s = String(status || '').toLowerCase();
        if (!s) return 'unknown';
        if (s.includes('not elected')) return 'not_elected';
        if (s.includes('excluded')) return 'excluded';
        if (s.includes('elected')) return 'elected';
        return 'unknown';
    }

    // â”€â”€â”€ Catalogue Cards â”€â”€â”€

    /**
     * Build election catalogue cards for the sidebar.
     * Returns an array of { body, date, constituencies, isByElection, html }.
     */
    async buildCatalogueCards() {
        const index = await this._loadIndex();
        const cards = [];
        const groupedLocal = new Set();
        const existingLocalDates = new Set();

        index.bodies.forEach(bodyData => {
            bodyData.dates.forEach(dateData => {
                if (bodyData.bodyGroup === 'local-government') {
                    existingLocalDates.add(dateData.date);
                    const groupKey = `${bodyData.bodyGroup}|${dateData.date}`;
                    if (groupedLocal.has(groupKey)) return;
                    groupedLocal.add(groupKey);

                    const scope = this._getEffectiveElectionScope(index, bodyData, dateData.date);
                    const isByElection = scope.constituencies.length <= 2 &&
                        !['Northern Ireland'].includes(scope.constituencies[0]);
                    const subtitle = isByElection
                        ? this._formatByElectionSubtitle(scope.constituencies[0], bodyData.name, bodyData.bodyGroup)
                        : `${scope.constituencies.length} DEAs`;

                    const cardHtml = `
                        <div class="election-card ${isByElection ? 'election-card--by-election' : ''}"
                             data-body="${this._esc(bodyData.name)}"
                             data-date="${this._esc(dateData.date)}">
                            <div class="election-card__body-badge">Local Government Districts</div>
                            <div class="election-card__info">
                                <span class="election-card__date">${this._formatDate(dateData.date)}</span>
                                <span class="election-card__subtitle">${subtitle}</span>
                            </div>
                        </div>
                    `;

                    cards.push({
                        body: bodyData.name,
                        bodyGroup: bodyData.bodyGroup || null,
                        date: dateData.date,
                        constituencies: scope.constituencies,
                        isByElection,
                        displayProvider: 'Local Government Districts',
                        displaySubtitle: subtitle,
                        html: cardHtml
                    });
                    return;
                }
                const special = this._getSpecialElectionConfig(bodyData.name, dateData.date);
                const isByElection = dateData.constituencies.length <= 2 &&
                    !['Northern Ireland'].includes(dateData.constituencies[0]);

                const bodyShort = this._shortBodyName(bodyData.name);
                const dateFormatted = this._formatDate(dateData.date);
                const constCount = dateData.constituencies.filter(c => c !== 'Northern Ireland').length;

                let subtitle = '';
                if (special?.type === 'recall-petition') {
                    subtitle = special.constituency;
                } else if (isByElection) {
                    subtitle = this._formatByElectionSubtitle(dateData.constituencies[0], bodyData.name, bodyData.bodyGroup || null);
                } else {
                    subtitle = (bodyData.name === 'European Parliament' && constCount === 0)
                        ? 'Northern Ireland'
                        : `${constCount} constituencies`;
                }

                const cardHtml = `
                    <div class="election-card ${isByElection && !special ? 'election-card--by-election' : ''}"
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
                    bodyGroup: bodyData.bodyGroup || null,
                    date: dateData.date,
                    constituencies: dateData.constituencies,
                    isByElection,
                    displayProvider: bodyShort,
                    displaySubtitle: subtitle,
                    html: cardHtml
                });
            });
        });

        ElectionController.LOCAL_GOVERNMENT_PLACEHOLDER_ELECTIONS.forEach((entry) => {
            if (existingLocalDates.has(entry.date)) return;
            const dateFormatted = this._formatDate(entry.date);
            const subtitle = entry.subtitle || 'To Be Added';
            cards.push({
                body: 'Local Government Districts',
                bodyGroup: 'local-government',
                date: entry.date,
                constituencies: [],
                isByElection: false,
                placeholder: true,
                displayProvider: 'Local Government Districts',
                displaySubtitle: subtitle,
                html: `
                    <div class="election-card election-card--placeholder"
                         data-election-placeholder="1"
                         data-body="${this._esc('Local Government Districts')}"
                         data-date="${this._esc(entry.date)}">
                        <div class="election-card__body-badge">Local Government Districts</div>
                        <div class="election-card__info">
                            <span class="election-card__date">${dateFormatted}</span>
                            <span class="election-card__subtitle">${this._esc(subtitle)}</span>
                            <span class="class-member__placeholder-badge">To Be Added</span>
                        </div>
                    </div>
                `
            });
        });

        // Sort by date descending
        cards.sort((a, b) => b.date.localeCompare(a.date));
        return cards;
    }

    _shortBodyName(name) {
        return shortBodyName(name);
    }

    _niWideTitle() {
        if (this._isLocalGovernmentBody()) {
            return this._localElectionTitle(this.date);
        }
        return `${this._shortBodyName(this.body)} - ${this._formatDate(this.date)}`;
    }

    _localElectionTitle(date) {
        const year = String(date || '').slice(0, 4);
        return year ? `${year} Northern Ireland local election` : `Northern Ireland local election`;
    }

    _formatByElectionSubtitle(constituency, body, bodyGroup = null) {
        const name = String(constituency || '').trim();
        if (!name) return 'By-election';
        if (bodyGroup === 'local-government') return `${name} local council by-election`;
        const map = {
            'House of Commons of the United Kingdom': 'Westminster',
            'Northern Ireland Assembly': 'Assembly',
            'Northern Ireland Constitutional Convention': 'Convention',
            'Northern Ireland Forum for Political Dialogue': 'Forum'
        };
        const label = map[body] || this._shortBodyName(body);
        return `${name} ${label} by-election`;
    }

    // â”€â”€â”€ URL State â”€â”€â”€

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
    _restoreHeaderTabs(defaultTab = 'party') {
        const headerRight = document.getElementById('electionPaneHeaderRight');
        if (!headerRight) return;
        const closeBtn = headerRight.querySelector('#electionCloseBtn');
        if (!closeBtn) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'electionCloseBtn';
            btn.dataset.action = 'close-election';
            btn.className = 'election-pane__close';
            btn.title = 'Close election';
            btn.textContent = '\u2715';
            headerRight.appendChild(btn);
        }
        this._setupNIWideTabs(defaultTab);
    }

    // â”€â”€â”€ Helpers â”€â”€â”€

    _formatDate(dateStr) {
        return formatElectionDate(dateStr);
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














