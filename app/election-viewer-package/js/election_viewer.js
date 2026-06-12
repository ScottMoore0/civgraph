/**
 * ElectionViewer — Self-contained election results viewer.
 *
 * Public API:
 *   ElectionViewer.init(options)
 *   ElectionViewer.show(body, date, constituency, container)
 *   ElectionViewer.showNIResults(body, date, container)
 *   ElectionViewer.getIndex()
 *
 * Dependencies: stages2.js, animation_preview.js, animation_preview_manager.js
 *               election-viewer.css
 *
 * Data: expects data/ directory with elections_index.json and
 *       elections/{body-slug}/{date}/{constituency-slug}.json
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ElectionViewer = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---- Configuration ----
    let _dataBasePath = 'data';
    let _indexData = null;
    let _indexPromise = null;

    // ---- Helpers ----

    function slugify(text) {
        return String(text).toLowerCase().trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s]+/g, '-')
            .replace(/-+/g, '-');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    function formatNumber(val) {
        if (val === undefined || val === null || isNaN(val)) return '';
        const num = Number(val);
        if (isNaN(num)) return escapeHtml(val);
        return num.toLocaleString('en-GB');
    }

    function formatPercent(val) {
        if (val === undefined || val === null || isNaN(val)) return '';
        return Number(val).toFixed(2) + '%';
    }

    // ---- Data Loading ----

    function loadIndex() {
        if (_indexData) return Promise.resolve(_indexData);
        if (_indexPromise) return _indexPromise;
        _indexPromise = fetch(_dataBasePath + '/elections_index.json')
            .then(function (r) { return r.json(); })
            .then(function (data) { _indexData = data; return data; });
        return _indexPromise;
    }

    function loadElection(body, date, constituency) {
        const bodySlug = slugify(body);
        const constSlug = slugify(constituency);
        const url = _dataBasePath + '/elections/' + bodySlug + '/' + date + '/' + constSlug + '.json';
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('Election not found: ' + r.status);
            return r.json();
        });
    }

    // ---- Rendering ----

    /**
     * Build the candidate results table from the API payload.
     * payload = { Constituency: { countGroup: [...], countInfo: {...} } }
     */
    function buildResultsTable(payload) {
        const cg = payload.Constituency.countGroup;
        const info = payload.Constituency.countInfo;

        // Group by candidate — get first-pref row for each candidate
        const candidateMap = {};
        const candidateOrder = [];
        cg.forEach(function (row) {
            const id = row.Candidate_Id;
            if (!candidateMap[id]) {
                candidateMap[id] = [];
                candidateOrder.push(id);
            }
            candidateMap[id].push(row);
        });

        // Determine final status and first pref votes for each candidate
        const candidates = candidateOrder.map(function (id) {
            const rows = candidateMap[id];
            const first = rows[0];
            const last = rows[rows.length - 1];
            // Find the count where the status changes
            let statusRow = null;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].Status && rows[i].Status !== '') {
                    statusRow = rows[i];
                    break;
                }
            }
            return {
                id: id,
                name: first.candidateName || (first.Firstname + ' ' + first.Surname),
                party: first.Party_Name || '',
                partyColour: first.Party_Colour || '#b0bec5',
                firstPref: parseFloat(first.Candidate_First_Pref_Votes) || 0,
                finalVotes: parseFloat(last.Total_Votes) || 0,
                status: statusRow ? statusRow.Status : '',
                occurredOnCount: first.Occurred_On_Count || '',
                rows: rows,
            };
        });

        // Sort by first pref votes descending
        candidates.sort(function (a, b) { return b.firstPref - a.firstPref; });

        // Compute total valid poll for percentages
        const validPoll = parseFloat(info.Valid_Poll) || 0;

        // Build HTML
        const html = [];
        html.push('<div class="ev-results-container">');

        // Header
        html.push('<h2>' + escapeHtml(info.Constituency_Name || '') + '</h2>');

        // Info row
        html.push('<div class="ev-info-row">');
        if (info.Number_Of_Seats) html.push('<span>Seats: <span class="ev-stat">' + escapeHtml(info.Number_Of_Seats) + '</span></span>');
        if (info.Quota) html.push('<span>Quota: <span class="ev-stat">' + formatNumber(parseInt(info.Quota)) + '</span></span>');
        if (info.Total_Electorate) html.push('<span>Electorate: <span class="ev-stat">' + formatNumber(parseInt(info.Total_Electorate)) + '</span></span>');
        if (info.Total_Poll) html.push('<span>Total Poll: <span class="ev-stat">' + formatNumber(parseInt(info.Total_Poll)) + '</span></span>');
        if (info.Valid_Poll) html.push('<span>Valid Poll: <span class="ev-stat">' + formatNumber(parseInt(info.Valid_Poll)) + '</span></span>');
        if (info.Spoiled) html.push('<span>Spoiled: <span class="ev-stat">' + formatNumber(parseInt(info.Spoiled)) + '</span></span>');
        html.push('</div>');

        // Table
        html.push('<table class="ev-results-table">');
        html.push('<thead><tr>');
        html.push('<th class="ev-rank">Rank</th>');
        html.push('<th>Candidate</th>');
        html.push('<th class="ev-party-cell">Party</th>');
        html.push('<th class="ev-num">First Pref</th>');
        html.push('<th class="ev-num">%</th>');
        html.push('<th class="ev-status">Status</th>');
        html.push('<th class="ev-num">Final Votes</th>');
        html.push('</tr></thead>');
        html.push('<tbody>');

        candidates.forEach(function (c, idx) {
            const pct = validPoll > 0 ? (c.firstPref / validPoll * 100) : 0;
            const statusClass = c.status === 'Elected' ? 'ev-status-elected'
                : c.status === 'Excluded' ? 'ev-status-excluded' : '';
            const statusText = c.status || '—';

            html.push('<tr>');
            html.push('<td class="ev-rank">' + (idx + 1) + '</td>');
            html.push('<td>' + escapeHtml(c.name) + '</td>');
            html.push('<td class="ev-party-cell"><span class="ev-party-swatch" style="background:' + escapeHtml(c.partyColour) + '"></span>' + escapeHtml(c.party) + '</td>');
            html.push('<td class="ev-num">' + formatNumber(c.firstPref) + '</td>');
            html.push('<td class="ev-num">' + formatPercent(pct) + '</td>');
            html.push('<td class="ev-status ' + statusClass + '">' + escapeHtml(statusText) + '</td>');
            html.push('<td class="ev-num">' + formatNumber(c.finalVotes) + '</td>');
            html.push('</tr>');
        });

        html.push('</tbody></table>');
        html.push('</div>');

        return html.join('');
    }

    /**
     * Build the static preview card (first-pref bar chart) from the payload.
     */
    function buildPreviewCard(payload, containerId) {
        // Delegate to the animation_preview.js if available
        if (typeof window.renderAnimationPreview === 'function') {
            const container = document.getElementById(containerId);
            if (container) {
                window.renderAnimationPreview(container, payload);
                return;
            }
        }
        // Fallback: build a simple bar chart
        const cg = payload.Constituency.countGroup;
        const info = payload.Constituency.countInfo;

        // Get first-pref counts per candidate
        const firstPrefs = {};
        const candidateNames = {};
        const partyColours = {};
        cg.forEach(function (row) {
            if (row.Count_Number === '1') {
                const id = row.Candidate_Id;
                firstPrefs[id] = parseFloat(row.Total_Votes) || 0;
                candidateNames[id] = row.candidateName || (row.Firstname + ' ' + row.Surname);
                partyColours[id] = row.Party_Colour || '#b0bec5';
            }
        });

        // Sort by votes descending
        const sorted = Object.keys(firstPrefs).sort(function (a, b) {
            return firstPrefs[b] - firstPrefs[a];
        });

        const maxVotes = sorted.length > 0 ? firstPrefs[sorted[0]] : 1;
        const validPoll = parseFloat(info.Valid_Poll) || 1;
        const quota = parseInt(info.Quota) || 0;

        const barHeight = 25;
        const gap = 5;
        const labelWidth = 200;
        const barAreaWidth = 400;
        const totalHeight = sorted.length * (barHeight + gap);

        const html = [];
        html.push('<div class="transfer-animation-preview">');
        html.push('<div class="preview-stage">');
        html.push('<div class="preview-animation-wrap">');
        html.push('<div class="preview-animation" style="position:relative;width:' + (labelWidth + barAreaWidth + 20) + 'px;height:' + totalHeight + 'px;">');

        sorted.forEach(function (id, i) {
            const top = i * (barHeight + gap);
            const votes = firstPrefs[id];
            const pct = (votes / validPoll * 100);
            const barWidth = Math.max(1, (votes / Math.max(maxVotes, quota || maxVotes)) * barAreaWidth);

            html.push('<div class="candidateLabel" style="top:' + top + 'px;left:0;">' + escapeHtml(candidateNames[id]) + '</div>');
            html.push('<div class="votes" style="top:' + top + 'px;left:' + labelWidth + 'px;width:' + barWidth + 'px;background:' + escapeHtml(partyColours[id]) + ';">' + formatNumber(votes) + ' (' + pct.toFixed(2) + '%)</div>');
        });

        // Quota line
        if (quota > 0) {
            const quotaX = labelWidth + (quota / Math.max(maxVotes, quota)) * barAreaWidth;
            html.push('<div class="thepost" style="left:' + quotaX + 'px;height:' + totalHeight + 'px;"></div>');
        }

        html.push('</div>');
        html.push('</div>');

        // Footer
        html.push('<div class="preview-footer">');
        if (quota > 0) html.push('<span class="preview-quota">Quota ' + formatNumber(quota) + '</span>');
        html.push('<span class="preview-hint">Click to view animation</span>');
        html.push('</div>');

        html.push('</div>');
        html.push('</div>');

        return html.join('');
    }

    /**
     * Start the full STV animation in a container using stages2.js.
     */
    function startAnimation(container, payload) {
        if (typeof animateStages !== 'function') {
            console.warn('ElectionViewer: stages2.js not loaded — animation unavailable');
            return false;
        }
        try {
            // animateStages expects the payload in a specific format
            // Set up the global constituency variable that stages2.js reads
            window._electionViewerPayload = payload;
            animateStages(payload);
            return true;
        } catch (e) {
            console.error('ElectionViewer: animation error', e);
            return false;
        }
    }

    // ---- Build NI-wide summary ----

    function buildNIWideSummary(body, date, constituencies, container) {
        container.innerHTML = '<div class="animation-preview-loading">Loading NI-wide results...</div>';

        // Load all constituency results for this body+date
        const promises = constituencies.map(function (c) {
            return loadElection(body, date, c).catch(function () { return null; });
        });

        Promise.all(promises).then(function (results) {
            // Aggregate first-pref votes by party
            const partyTotals = {};
            const partyColours = {};
            let totalSeats = 0;
            let totalElected = {};
            let totalValid = 0;

            results.forEach(function (payload) {
                if (!payload || !payload.Constituency) return;
                const cg = payload.Constituency.countGroup;
                const info = payload.Constituency.countInfo;
                totalSeats += parseInt(info.Number_Of_Seats) || 0;
                totalValid += parseInt(info.Valid_Poll) || 0;

                // First pref per candidate
                const seen = {};
                cg.forEach(function (row) {
                    if (row.Count_Number === '1') {
                        const party = row.Party_Name || 'Independent';
                        const votes = parseFloat(row.Total_Votes) || 0;
                        if (!partyTotals[party]) partyTotals[party] = { votes: 0, seats: 0 };
                        partyTotals[party].votes += votes;
                        if (!partyColours[party]) partyColours[party] = row.Party_Colour || '#b0bec5';
                        seen[row.Candidate_Id] = party;
                    }
                    // Count seats
                    if (row.Status === 'Elected' && !totalElected[row.Candidate_Id]) {
                        totalElected[row.Candidate_Id] = true;
                        const party = row.Party_Name || 'Independent';
                        if (!partyTotals[party]) partyTotals[party] = { votes: 0, seats: 0 };
                        partyTotals[party].seats++;
                    }
                });
            });

            // Sort parties by votes
            const parties = Object.keys(partyTotals).sort(function (a, b) {
                return partyTotals[b].votes - partyTotals[a].votes;
            });

            // Build summary HTML
            const html = [];
            html.push('<div class="ev-results-container">');
            html.push('<h2>NI-Wide Results</h2>');
            html.push('<div class="ev-info-row">');
            html.push('<span>Total Seats: <span class="ev-stat">' + totalSeats + '</span></span>');
            html.push('<span>Constituencies: <span class="ev-stat">' + constituencies.length + '</span></span>');
            html.push('<span>Total Valid Poll: <span class="ev-stat">' + formatNumber(totalValid) + '</span></span>');
            html.push('</div>');

            html.push('<table class="ev-results-table">');
            html.push('<thead><tr>');
            html.push('<th>Party</th>');
            html.push('<th class="ev-num">First Pref Votes</th>');
            html.push('<th class="ev-num">Vote %</th>');
            html.push('<th class="ev-num">Seats</th>');
            html.push('</tr></thead><tbody>');

            parties.forEach(function (party) {
                const p = partyTotals[party];
                const pct = totalValid > 0 ? (p.votes / totalValid * 100) : 0;
                html.push('<tr>');
                html.push('<td class="ev-party-cell"><span class="ev-party-swatch" style="background:' + escapeHtml(partyColours[party] || '#b0bec5') + '"></span>' + escapeHtml(party) + '</td>');
                html.push('<td class="ev-num">' + formatNumber(Math.round(p.votes)) + '</td>');
                html.push('<td class="ev-num">' + formatPercent(pct) + '</td>');
                html.push('<td class="ev-num">' + p.seats + '</td>');
                html.push('</tr>');
            });

            html.push('</tbody></table></div>');
            container.innerHTML = html.join('');
        });
    }

    // ---- Public API ----

    function init(options) {
        options = options || {};
        if (options.dataBasePath) _dataBasePath = options.dataBasePath;
        return loadIndex();
    }

    /**
     * Show election results for a specific body/date/constituency.
     * @param {string} body - e.g. 'Northern Ireland Assembly'
     * @param {string} date - e.g. '2022-05-05'
     * @param {string} constituency - e.g. 'Belfast East'
     * @param {HTMLElement} container - DOM element to render into
     * @returns {Promise}
     */
    function show(body, date, constituency, container) {
        if (!container) throw new Error('Container element required');
        container.innerHTML = '<div class="animation-preview-loading">Loading election results...</div>';

        return loadElection(body, date, constituency).then(function (payload) {
            // Build results table
            const tableHtml = buildResultsTable(payload);

            // Build preview card
            const previewHtml = buildPreviewCard(payload, null);

            // Animation container
            const animHtml = '<div class="election-animation-wrapper" id="ev-animation-wrapper"></div>';

            container.innerHTML = tableHtml + previewHtml + animHtml;

            // Store payload for animation
            container._electionPayload = payload;
            return payload;
        }).catch(function (err) {
            container.innerHTML = '<div class="animation-preview-unavailable">Election data not available: ' + escapeHtml(err.message) + '</div>';
            throw err;
        });
    }

    /**
     * Show NI-wide aggregated results for a body+date.
     * @param {string} body
     * @param {string} date
     * @param {HTMLElement} container
     * @returns {Promise}
     */
    function showNIResults(body, date, container) {
        if (!container) throw new Error('Container element required');

        return loadIndex().then(function (index) {
            // Find constituencies for this body+date
            const bodyEntry = index.bodies.find(function (b) { return b.name === body; });
            if (!bodyEntry) throw new Error('Body not found: ' + body);
            const dateEntry = bodyEntry.dates.find(function (d) { return d.date === date; });
            if (!dateEntry) throw new Error('Date not found: ' + date);

            buildNIWideSummary(body, date, dateEntry.constituencies, container);
        });
    }

    /**
     * Get the loaded elections index.
     * @returns {Promise<Object>}
     */
    function getIndex() {
        return loadIndex();
    }

    /**
     * Build a selector UI for browsing elections.
     * @param {HTMLElement} container
     * @param {function} onSelect - callback(body, date, constituency)
     */
    function buildSelector(container, onSelect) {
        loadIndex().then(function (index) {
            const html = [];
            html.push('<div class="ev-selector" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">');
            html.push('<select id="ev-sel-body"><option value="">Select Body...</option>');
            index.bodies.forEach(function (b) {
                html.push('<option value="' + escapeHtml(b.name) + '">' + escapeHtml(b.name) + '</option>');
            });
            html.push('</select>');
            html.push('<select id="ev-sel-date" disabled><option value="">Date...</option></select>');
            html.push('<select id="ev-sel-const" disabled><option value="">Constituency...</option></select>');
            html.push('<button id="ev-sel-view" disabled>View</button>');
            html.push('</div>');

            container.innerHTML = html.join('');

            const bodyEl = container.querySelector('#ev-sel-body');
            const dateEl = container.querySelector('#ev-sel-date');
            const constEl = container.querySelector('#ev-sel-const');
            const viewBtn = container.querySelector('#ev-sel-view');

            bodyEl.addEventListener('change', function () {
                const bodyName = bodyEl.value;
                dateEl.innerHTML = '<option value="">Date...</option>';
                constEl.innerHTML = '<option value="">Constituency...</option>';
                dateEl.disabled = true;
                constEl.disabled = true;
                viewBtn.disabled = true;
                if (!bodyName) return;

                const bodyEntry = index.bodies.find(function (b) { return b.name === bodyName; });
                if (!bodyEntry) return;
                bodyEntry.dates.forEach(function (d) {
                    dateEl.innerHTML += '<option value="' + escapeHtml(d.date) + '">' + escapeHtml(d.date) + '</option>';
                });
                dateEl.disabled = false;
            });

            dateEl.addEventListener('change', function () {
                const bodyName = bodyEl.value;
                const dateVal = dateEl.value;
                constEl.innerHTML = '<option value="">Constituency...</option>';
                constEl.disabled = true;
                viewBtn.disabled = true;
                if (!dateVal) return;

                const bodyEntry = index.bodies.find(function (b) { return b.name === bodyName; });
                if (!bodyEntry) return;
                const dateEntry = bodyEntry.dates.find(function (d) { return d.date === dateVal; });
                if (!dateEntry) return;
                dateEntry.constituencies.forEach(function (c) {
                    constEl.innerHTML += '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
                });
                constEl.disabled = false;
            });

            constEl.addEventListener('change', function () {
                viewBtn.disabled = !constEl.value;
            });

            viewBtn.addEventListener('click', function () {
                if (bodyEl.value && dateEl.value && constEl.value) {
                    onSelect(bodyEl.value, dateEl.value, constEl.value);
                }
            });
        });
    }

    return {
        init: init,
        show: show,
        showNIResults: showNIResults,
        getIndex: getIndex,
        buildSelector: buildSelector,
        buildResultsTable: buildResultsTable,
        buildPreviewCard: buildPreviewCard,
        loadElection: loadElection,
        slugify: slugify,
    };
});
