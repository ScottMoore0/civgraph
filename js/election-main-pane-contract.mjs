import {
  buildCandidateSummary,
  buildPartySummary
} from './election-domain.mjs';

/**
 * Engine-neutral election results pane contract.
 *
 * The main site owns the election pane behaviour. Test2 uses this contract so
 * its MapLibre map can supply drawing/selection state without maintaining a
 * separate election-pane wrapper that drifts from the main UI.
 */
export class MainElectionPaneContract {
  constructor(host) {
    this.host = host;
    this.rendererId = host?.paneRendererId || 'test2-main-pane-contract';
  }

  renderTitle(selectedResult = null) {
    if (selectedResult?.constituency) return selectedResult.constituency;
    return this.host.formatPaneElectionTitle();
  }

  renderHeaderRight(selectedResult = null, activeView = 'party') {
    const isCouncilAggregate = Boolean(selectedResult && this.host.isCouncilAggregateResult?.(selectedResult));
    const isSingleSeatFptp = Boolean(selectedResult && !isCouncilAggregate && this.host.isSingleSeatFptpResult?.(selectedResult));
    const isReferendum = Boolean(this.host.isReferendumElection?.(selectedResult));
    const localModeControl = (!selectedResult || isCouncilAggregate) && this.host.isLocalGovernmentElection() ? `
      <div class="test2-election-local-mode" role="group" aria-label="Local government result level">
        <button type="button" class="${this.host.activeLocalMode === 'dea' ? 'is-active' : ''}" data-election-local-mode="dea">DEA</button>
        <button type="button" class="${this.host.activeLocalMode === 'district' ? 'is-active' : ''}" data-election-local-mode="district">District</button>
      </div>
    ` : '';
    const selectedTabs = isReferendum
      ? [
        ['party', 'Full Results']
      ]
      : isSingleSeatFptp
      ? [
        ['results', 'Results']
      ]
      : isCouncilAggregate
      ? [
        ['party', 'By Party'],
        ['candidate', 'By Candidate'],
        ['local-party', 'By Local Party']
      ]
      : [
        ['party', 'By Party'],
        ['counts', this.host.isForumResult(selectedResult) ? 'By Round' : 'By Count']
      ];
    if (!isSingleSeatFptp && !isCouncilAggregate && selectedResult && this.host.resultHasAnimation(selectedResult)) {
      selectedTabs.push(['animation', this.host.isForumResult(selectedResult) ? 'Allocation' : 'Transfers']);
    }
    if (selectedResult && !selectedTabs.some(([id]) => id === 'trends')) {
      selectedTabs.push(['trends', 'Trends']);
    }
    const headerTabs = selectedResult
      ? selectedTabs
      : isReferendum
      ? [
        ['party', 'Full Results'],
        ['constituency', 'By Constituency'],
        ['trends', 'Trends']
      ]
      : [
        ['party', 'By Party'],
        ['candidate', 'By Candidate'],
        ['local-party', 'By Local Party'],
        ['trends', 'Trends']
      ];
    return `
      ${localModeControl}
      ${headerTabs.map(([id, label]) => `<button type="button" class="election-view-tab${id === activeView ? ' election-view-tab--active' : ''}" data-election-view="${escapeHtml(id)}">${escapeHtml(label)}</button>${selectedResult && !isCouncilAggregate && id === 'counts' ? `<button type="button" id="test2ElectionCountDetail" class="election-detail-toggle-btn election-detail-toggle-btn--header" data-role="detail-toggle" aria-pressed="${this.host.countDetailedView ? 'true' : 'false'}">${this.host.countDetailedView ? 'Detailed View: On' : 'Detailed View: Off'}</button>` : ''}`).join('')}
      <button type="button" id="electionCloseBtn" class="election-pane__close" aria-label="Unload election">&#10005;</button>
    `;
  }

  renderPanelContent(selectedResult = null, view = 'party') {
    const content = selectedResult
      ? this.renderConstituencyResults(selectedResult, view)
      : this.renderOverallResults(view);
    return `<div data-election-renderer="${escapeHtml(this.rendererId)}">${content}</div>`;
  }

  renderOverallResults(view = 'party') {
    const results = this.host.currentResults();
    if (view === 'trends') return this.host.renderTrendsPanel?.(null) || '<p class="election-no-data">No trend data is available.</p>';
    if (results.some((result) => result.recallPetition)) return this.host.renderRecallPetitionOverview(results);
    if (this.host.isLocalGovernmentElection() && this.host.activeLocalMode === 'district') {
      return this.host.renderDistrictResults(view);
    }
    const rows = this.host.activeBundle.mainLikePartySummary?.length
      ? this.host.activeBundle.mainLikePartySummary
      : (this.host.activeBundle.partySummary?.length ? this.host.activeBundle.partySummary : buildPartySummary(results));
    const rowsWithDeltas = this.host.withPartyDeltas(rows, { mainLike: Boolean(this.host.activeBundle.mainLikePartySummary?.length) });
    const candidateRows = this.host.activeBundle.mainLikeCandidateSummary?.length
      ? this.host.withCandidateDeltas(this.host.activeBundle.mainLikeCandidateSummary, { mainLike: true })
      : this.host.withCandidateDeltas(buildCandidateSummary(results));
    if (this.host.isReferendumElection?.()) {
      return `
        ${this.host.renderDataCoverageNotice()}
        ${view === 'constituency' ? this.host.renderReferendumConstituencySummaryTable(results) : this.host.renderMainParityPartyTable(rowsWithDeltas, results, { referendum: true })}
        ${this.host.renderMapDisplayControls()}
      `;
    }
    return `
      ${this.host.renderDataCoverageNotice()}
      ${view === 'candidate' ? this.host.renderCandidateSummaryTable(candidateRows) : view === 'local-party' ? this.host.renderLocalPartySummaryTable(results) : this.host.renderMainParityPartyTable(rowsWithDeltas, results)}
      ${this.host.renderMapDisplayControls()}
    `;
  }

  renderConstituencyResults(result, view = 'party') {
    if (view === 'trends') return this.host.renderTrendsPanel?.(result) || '<p class="election-no-data">No trend data is available.</p>';
    if (this.host.isCouncilAggregateResult?.(result)) return this.host.renderCouncilAggregateResults(result, view);
    if (result.recallPetition) return this.host.renderRecallPetitionResult(result);
    const candidates = [...(result.candidates || [])].sort((a, b) => {
      const elected = Number(Boolean(b.elected)) - Number(Boolean(a.elected));
      if (elected) return elected;
      return Number(b.finalVotes ?? b.firstPrefs ?? b.votes ?? 0) - Number(a.finalVotes ?? a.firstPrefs ?? a.votes ?? 0);
    });
    if (this.host.isReferendumElection?.(result)) {
      return this.host.renderReferendumResultTable(candidates, result);
    }
    if (this.host.isSingleSeatFptpResult?.(result)) {
      return this.host.renderSingleSeatFptpResultsTable?.(candidates, result)
        || this.host.renderConstituencyCandidateTable(candidates, result);
    }
    const effectiveView = view === 'animation' && !this.host.resultHasAnimation(result) ? 'counts' : view;
    return `
      ${effectiveView === 'counts' ? this.host.renderCountTable(result, candidates) : effectiveView === 'animation' ? this.host.renderAnimationNotice(result) : effectiveView === 'party' ? this.host.renderConstituencyPartyTable(candidates, result) : this.host.renderConstituencyCandidateTable(candidates, result)}
    `;
  }

  renderEntityPanel(kind, entity) {
    return kind === 'candidate'
      ? this.host.renderCandidateEntity(entity)
      : this.host.renderPartyEntity(entity);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
