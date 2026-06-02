import {
  buildCandidateSummary,
  buildPartySummary,
  normalizeName,
  numberOrZero,
  partyColour
} from './election-domain.mjs';
import {
  averageNumbers,
  buildCouncilSummary,
  buildElectionViewModelFromTest2Manager,
  buildLocalPartySummary,
  sumNumbers
} from './election-view-model.mjs';

export function createElectionRenderer(host) {
  return new SharedElectionRenderer(host);
}

export function renderElectionSummaryFromViewModel(model) {
  const host = {
    activeEntry: model.entry,
    activeBundle: model.bundle,
    previousBundle: { results: model.previousResults || [] },
    activePanelView: model.view,
    activeMode: model.mode,
    overlayMode: model.overlayMode,
    activeLocalMode: model.localMode,
    countDetailedView: model.countDetailedView,
    currentResults: () => model.results || [],
    isLocalGovernmentElection: () => Boolean(model.localGovernment),
    localBodyCount: () => Number(model.bundle?.localBodies?.length || 0)
  };
  const renderer = new SharedElectionRenderer(host);
  return model.selectedResult
    ? renderer.renderConstituencyResults(model.selectedResult, model.view)
    : renderer.renderOverallResults(model.view);
}

export function numericColour(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '#9ca3af';
  const t = Math.max(0, Math.min(1, (number - min) / (max - min || 1)));
  if (t < 0.2) return '#fef3c7';
  if (t < 0.4) return '#fde68a';
  if (t < 0.6) return '#f59e0b';
  if (t < 0.8) return '#d97706';
  return '#92400e';
}

export class SharedElectionRenderer {
  constructor(host) {
    this.host = host;
  }

  viewModel(selectedResult = null, view = null) {
    return buildElectionViewModelFromTest2Manager(this.host, selectedResult, view);
  }

  renderOverallResults(view = 'party') {
    if (typeof this.host.renderMainCompatibleOverallResults === 'function') {
      return this.host.renderMainCompatibleOverallResults(view);
    }
    const model = this.viewModel(null, view);
    const results = model.results;
    if (model.recallPetition) return this.renderRecallPetitionOverview(results);
    if (model.localGovernment && model.localMode === 'district') return this.renderDistrictResults(view);

    const rows = model.bundle?.partySummary?.length ? model.bundle.partySummary : buildPartySummary(results);
    const rowsWithDeltas = this.withPartyDeltas(rows);
    const candidates = buildCandidateSummary(results);
    return `
      <section class="test2-election-panel shared-election-renderer" data-election-renderer="shared" aria-label="Election results summary">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['candidate', 'By Candidate'],
          ['constituency', model.localGovernment ? 'By DEA' : 'By Constituency'],
          ...(model.localGovernment ? [['local-party', 'By Local Party']] : [])
        ], view)}
        <div class="test2-election-panel__summary">
          <dl class="test2-election-panel__stats">
            <div><dt>${model.localGovernment ? 'DEAs' : 'Constituencies'}</dt><dd>${formatNumber(results.length)}</dd></div>
            <div><dt>Matched</dt><dd>${formatNumber(model.coverage.matched)}</dd></div>
            <div><dt>Unmatched</dt><dd>${formatNumber(model.coverage.unmatched)}</dd></div>
            ${model.totals.totalSeats ? `<div><dt>Seats</dt><dd>${formatNumber(model.totals.totalSeats)}</dd></div>` : ''}
            ${model.totals.validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(model.totals.validPoll)}</dd></div>` : ''}
            ${model.totals.turnoutPct ? `<div><dt>Turnout</dt><dd>${formatPercent(model.totals.turnoutPct)}</dd></div>` : ''}
          </dl>
          <div id="test2ElectionLegend" class="test2-election-panel__legend"></div>
        </div>
        ${this.renderDataCoverageNotice()}
        ${view === 'candidate' ? this.renderCandidateSummaryTable(candidates)
          : view === 'constituency' ? this.renderConstituencySummaryTable(results)
          : view === 'local-party' ? this.renderLocalPartySummaryTable(results)
          : this.renderPartySummaryTable(rowsWithDeltas)}
      </section>
    `;
  }

  renderConstituencyResults(result, view = 'party') {
    if (typeof this.host.renderMainCompatibleConstituencyResults === 'function') {
      return this.host.renderMainCompatibleConstituencyResults(result, view);
    }
    if (result.recallPetition) return this.renderRecallPetitionResult(result);
    const candidates = [...(result.candidates || [])].sort((a, b) =>
      Number(Boolean(b.elected)) - Number(Boolean(a.elected))
      || Number(b.finalVotes ?? b.firstPrefs ?? b.votes ?? 0) - Number(a.finalVotes ?? a.firstPrefs ?? a.votes ?? 0)
    );
    const areaLabel = this.host.isLocalGovernmentElection() ? 'DEA' : 'Constituency';
    return `
      <section class="test2-election-panel shared-election-renderer" data-election-renderer="shared" aria-label="${escapeHtml(result.constituency)} results">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['counts', 'By Count'],
          ['animation', 'Transfers']
        ], view)}
        <dl class="test2-election-panel__stats">
          <div><dt>${areaLabel}</dt><dd>${escapeHtml(result.constituency || '')}</dd></div>
          ${this.host.isLocalGovernmentElection() && result.localBody ? `<div><dt>Council</dt><dd>${escapeHtml(result.localBody)}</dd></div>` : ''}
          ${result.seatsTotal ? `<div><dt>Seats</dt><dd>${formatNumber(result.seatsTotal)}</dd></div>` : ''}
          ${result.validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(result.validPoll)}</dd></div>` : ''}
          ${result.turnoutPct ? `<div><dt>Turnout</dt><dd>${formatPercent(result.turnoutPct)}</dd></div>` : ''}
          ${result.quota ? `<div><dt>Quota</dt><dd>${formatNumber(result.quota)}</dd></div>` : ''}
          ${result.previous ? `<div><dt>Previous winner</dt><dd>${escapeHtml(result.previous.winnerParty || result.previous.leadingParty || '')}</dd></div>` : ''}
          ${result.deltas?.turnoutPct !== null && result.deltas?.turnoutPct !== undefined ? `<div><dt>Turnout change</dt><dd>${formatSignedPercent(result.deltas.turnoutPct)}</dd></div>` : ''}
        </dl>
        ${view === 'counts' ? this.renderCountTable(result, candidates)
          : view === 'animation' ? this.renderAnimationNotice(result)
          : candidates.length ? this.renderCandidateResultTable(candidates) : '<p class="election-no-data">No candidate-level result table is available for this entry.</p>'}
      </section>
    `;
  }

  renderDistrictResults(view = 'party') {
    if (this.host.localBodyCount() > 1) return this.renderCouncilResults(view);
    const results = this.host.currentResults();
    const rows = this.withPartyDeltas(buildPartySummary(results));
    const totalSeats = rows.reduce((sum, row) => sum + numberOrZero(row.seats), 0);
    return `
      <section class="test2-election-panel shared-election-renderer" data-election-renderer="shared" aria-label="${escapeHtml(this.host.activeBundle.body)} district results">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['candidate', 'By Candidate'],
          ['local-party', 'By Local Party'],
          ['constituency', 'By DEA']
        ], view)}
        <div class="test2-election-panel__summary">
          <dl class="test2-election-panel__stats">
            <div><dt>District</dt><dd>${escapeHtml(this.host.activeBundle.displayTitle || this.host.activeBundle.body)}</dd></div>
            <div><dt>DEAs</dt><dd>${formatNumber(results.length)}</dd></div>
            ${totalSeats ? `<div><dt>Seats</dt><dd>${formatNumber(totalSeats)}</dd></div>` : ''}
            ${sumNumbers(results, 'validPoll') ? `<div><dt>Valid poll</dt><dd>${formatNumber(sumNumbers(results, 'validPoll'))}</dd></div>` : ''}
          </dl>
          <div id="test2ElectionLegend" class="test2-election-panel__legend"></div>
        </div>
        ${this.renderDataCoverageNotice()}
        ${view === 'candidate' ? this.renderCandidateSummaryTable(buildCandidateSummary(results))
          : view === 'local-party' ? this.renderLocalPartySummaryTable(results)
          : view === 'constituency' ? this.renderConstituencySummaryTable(results)
          : this.renderDistrictPartyTable(rows)}
      </section>
    `;
  }

  renderCouncilResults(view = 'party') {
    const results = this.host.currentResults();
    const councilRows = this.withCouncilDeltas(buildCouncilSummary(results));
    const rows = this.withPartyDeltas(buildPartySummary(results));
    return `
      <section class="test2-election-panel shared-election-renderer" data-election-renderer="shared" aria-label="${escapeHtml(this.host.activeBundle.displayTitle || this.host.activeBundle.body)} council results">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['council', 'By Council'],
          ['candidate', 'By Candidate'],
          ['local-party', 'By Local Party'],
          ['constituency', 'By DEA']
        ], view)}
        <div class="test2-election-panel__summary">
          <dl class="test2-election-panel__stats">
            <div><dt>Councils</dt><dd>${formatNumber(councilRows.length)}</dd></div>
            <div><dt>DEAs</dt><dd>${formatNumber(results.length)}</dd></div>
            ${rows.reduce((sum, row) => sum + numberOrZero(row.seats), 0) ? `<div><dt>Seats</dt><dd>${formatNumber(rows.reduce((sum, row) => sum + numberOrZero(row.seats), 0))}</dd></div>` : ''}
            ${sumNumbers(results, 'validPoll') ? `<div><dt>Valid poll</dt><dd>${formatNumber(sumNumbers(results, 'validPoll'))}</dd></div>` : ''}
          </dl>
          <div id="test2ElectionLegend" class="test2-election-panel__legend"></div>
        </div>
        ${this.renderDataCoverageNotice()}
        ${view === 'council' ? this.renderCouncilSummaryTable(councilRows)
          : view === 'candidate' ? this.renderCandidateSummaryTable(buildCandidateSummary(results))
          : view === 'local-party' ? this.renderLocalPartySummaryTable(results)
          : view === 'constituency' ? this.renderConstituencySummaryTable(results)
          : this.renderDistrictPartyTable(rows)}
      </section>
    `;
  }

  renderPartySummaryTable(rows = []) {
    return rows.length ? `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table election-party-table">
          <thead><tr><th>Party</th><th>Stood</th><th>Seats</th><th>Votes</th><th>Share</th><th>Change</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td><button type="button" class="test2-election-link election-entity-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(row.party))}"><span class="test2-party-swatch election-party-dot" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.party)}</button></td>
              <td>${formatNumber(row.stood)}</td><td>${formatNumber(row.seats)}</td><td>${formatNumber(row.votes)}</td><td>${formatPercent(row.share)}</td><td>${formatDeltaPair(row.deltas?.seats, row.deltas?.votes)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>` : '';
  }

  renderCandidateResultTable(candidates = []) {
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table election-party-table">
          <thead><tr><th>Candidate</th><th>Party</th><th>First prefs</th><th>Change</th><th>Final votes</th><th>Status</th></tr></thead>
          <tbody>${candidates.map((candidate) => `
            <tr class="${candidate.elected ? 'test2-election-table__elected' : ''}">
              <td><button type="button" class="test2-election-link election-entity-link" data-election-entity="candidate" data-election-entity-key="${escapeHtml(candidate.id || `${candidate.name}|${candidate.party}`)}">${escapeHtml(candidate.name || candidate.candidate || '')}</button></td>
              <td><button type="button" class="test2-election-link election-entity-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(candidate.party))}"><span class="test2-party-swatch election-party-dot" style="background:${escapeHtml(partyColour(candidate.party) || candidate.colour || '#6b7280')}"></span>${escapeHtml(candidate.party || '')}</button></td>
              <td>${formatNumber(candidate.firstPrefs ?? candidate.votes ?? '')}</td><td>${candidate.deltas ? formatSigned(candidate.deltas.firstPrefs) : ''}</td><td>${formatNumber(candidate.finalVotes ?? candidate.firstPrefs ?? candidate.votes ?? '')}</td><td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  renderCandidateSummaryTable(candidates = []) {
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table election-count-table">
          <thead><tr><th>Candidate</th><th>Party</th><th>Constituency/DEA</th><th>First prefs</th><th>%</th><th>Change</th><th>Status</th></tr></thead>
          <tbody>${candidates.map((candidate) => `
            <tr class="${candidate.elected ? 'test2-election-table__elected' : ''}">
              <td><button type="button" class="test2-election-link election-entity-link" data-election-entity="candidate" data-election-entity-key="${escapeHtml(candidate.id || `${candidate.name}|${candidate.party}`)}">${escapeHtml(candidate.name || '')}</button></td>
              <td><button type="button" class="test2-election-link election-entity-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(candidate.party))}"><span class="test2-party-swatch election-party-dot" style="background:${escapeHtml(candidate.colour || partyColour(candidate.party))}"></span>${escapeHtml(candidate.party || '')}</button></td>
              <td>${escapeHtml(candidate.constituency || '')}</td><td>${formatNumber(candidate.firstPrefs)}</td><td>${formatPercent(candidate.firstPrefPct)}</td><td>${candidate.deltas ? formatSigned(candidate.deltas.firstPrefs) : ''}</td><td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  renderConstituencySummaryTable(results = []) {
    return `
      <div class="test2-election-table-wrap test2-election-table-wrap--constituencies">
        <table class="test2-election-table catalogue-detail__entity-table election-party-table">
          <thead><tr><th>Constituency/DEA</th><th>Winner/lead</th><th>Party</th><th>Seats</th><th>Change</th><th>Turnout</th><th>Majority</th></tr></thead>
          <tbody>${results.map((result) => `
            <tr>
              <td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(normalizeName(result.matchName || result.constituency || ''))}">${escapeHtml(result.constituency || result.matchName || '')}</button></td>
              <td>${escapeHtml(result.winnerName || result.leadingName || '')}</td><td><span class="test2-party-swatch election-party-dot" style="background:${escapeHtml(partyColour(result.winnerParty || result.leadingParty))}"></span>${escapeHtml(result.winnerParty || result.leadingParty || '')}</td><td>${formatNumber(result.seatsWon ?? result.seatsTotal ?? '')}</td><td>${result.deltas ? formatSigned(result.deltas.seatsWon) : ''}</td><td>${formatPercent(result.turnoutPct)}</td><td>${formatNumber(result.majority)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  renderLocalPartySummaryTable(results = []) {
    const rows = this.withLocalPartyDeltas(buildLocalPartySummary(results));
    if (!rows.length) return '<p class="election-no-data">No local-party summary is available for this election.</p>';
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table election-count-table">
          <thead><tr><th>Party</th><th>DEA</th><th>Stood</th><th>Seats</th><th>Seat change</th><th>First prefs</th><th>Vote change</th><th>DEA share</th><th>Share change</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr>
              <td><button type="button" class="test2-election-link election-entity-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(row.party))}"><span class="test2-party-swatch election-party-dot" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.party)}</button></td>
              <td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(row.resultKey)}">${escapeHtml(row.constituency)}</button></td><td>${formatNumber(row.stood)}</td><td>${formatNumber(row.seats)}</td><td>${row.deltas ? formatSigned(row.deltas.seats) : ''}</td><td>${formatNumber(row.firstPrefs)}</td><td>${row.deltas ? formatSigned(row.deltas.firstPrefs) : ''}</td><td>${formatPercent(row.share)}</td><td>${row.deltas?.share !== null && row.deltas?.share !== undefined ? formatSignedPercent(row.deltas.share) : ''}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  renderCouncilSummaryTable(rows = []) {
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table election-party-table">
          <thead><tr><th>Council</th><th>DEAs</th><th>Leading party</th><th>Seats</th><th>Seat change</th><th>Valid votes</th><th>Vote change</th><th>Turnout</th><th>Turnout change</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr><td>${escapeHtml(row.council)}</td><td>${formatNumber(row.deas)}</td><td><span class="test2-party-swatch election-party-dot" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.leadingParty || '')}</td><td>${formatNumber(row.seats)}</td><td>${row.deltas ? formatSigned(row.deltas.seats) : ''}</td><td>${formatNumber(row.validPoll)}</td><td>${row.deltas ? formatSigned(row.deltas.validPoll) : ''}</td><td>${formatPercent(row.turnoutPct)}</td><td>${row.deltas?.turnoutPct !== null && row.deltas?.turnoutPct !== undefined ? formatSignedPercent(row.deltas.turnoutPct) : ''}</td></tr>
          `).join('')}</tbody>
        </table>
      </div>`;
  }

  renderDistrictPartyTable(rows = []) {
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table election-party-table">
          <thead><tr><th>Party</th><th>Candidates</th><th>Seats</th><th>Seat change</th><th>First prefs</th><th>Vote share</th><th>Vote change</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr><td><button type="button" class="test2-election-link election-entity-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(row.party))}"><span class="test2-party-swatch election-party-dot" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.party)}</button></td><td>${formatNumber(row.stood)}</td><td>${formatNumber(row.seats)}</td><td>${row.deltas ? formatSigned(row.deltas.seats) : ''}</td><td>${formatNumber(row.votes)}</td><td>${formatPercent(row.share)}</td><td>${row.deltas ? `${formatSigned(row.deltas.votes)}${row.deltas.share !== null ? ` (${formatSignedPercent(row.deltas.share)})` : ''}` : ''}</td></tr>
          `).join('')}</tbody>
        </table>
      </div>`;
  }

  renderRecallPetitionOverview(results = []) {
    return `
      <section class="test2-election-panel shared-election-renderer" data-election-renderer="shared" aria-label="Recall petition overview">
        <div class="test2-election-panel__summary"><dl class="test2-election-panel__stats"><div><dt>Petitions</dt><dd>${formatNumber(results.length)}</dd></div><div><dt>Triggered</dt><dd>${formatNumber(results.filter((result) => recallTriggered(result)).length)}</dd></div><div><dt>Not triggered</dt><dd>${formatNumber(results.filter((result) => result.recallPetition && !recallTriggered(result)).length)}</dd></div></dl></div>
        <div class="test2-election-table-wrap"><table class="test2-election-table catalogue-detail__entity-table election-party-table"><thead><tr><th>Constituency</th><th>Signed</th><th>Threshold</th><th>Shortfall/Surplus</th><th>Outcome</th></tr></thead><tbody>${results.map((result) => {
          const petition = result.recallPetition || {};
          const signed = petition.signed ?? petition.signatures ?? result.leadingVotes ?? null;
          const threshold = petition.threshold ?? petition.required ?? null;
          const shortfall = Number.isFinite(Number(signed)) && Number.isFinite(Number(threshold)) ? Number(signed) - Number(threshold) : null;
          return `<tr><td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(normalizeName(result.matchName || result.constituency || ''))}">${escapeHtml(result.constituency || '')}</button></td><td>${formatNumber(signed)}</td><td>${formatNumber(threshold)}</td><td>${shortfall === null ? '' : formatSigned(shortfall)}</td><td>${escapeHtml(petition.outcome || (recallTriggered(result) ? 'By-election triggered' : 'Petition not successful'))}</td></tr>`;
        }).join('')}</tbody></table></div>
      </section>`;
  }

  renderCountTable(result, candidates = []) {
    const countNumbers = result.countNumbers?.length
      ? result.countNumbers
      : [...new Set(candidates.flatMap((candidate) => (candidate.counts || []).map((count) => count.count)))].sort((a, b) => a - b);
    if (!countNumbers.length) return '<p class="election-no-data">No count-by-count data is available for this entry.</p>';
    const countEvents = inferCountEvents(candidates, countNumbers);
    const nonTransferable = new Map((result.nonTransferable || []).map((row) => [Number(row.count), row]));
    return `
      <div class="test2-election-count-toolbar"><button type="button" id="test2ElectionCountDetail" class="btn btn-secondary btn-sm" aria-pressed="${this.host.countDetailedView ? 'true' : 'false'}">${this.host.countDetailedView ? 'Hide detailed count values' : 'Show detailed count values'}</button></div>
      <div class="test2-election-table-wrap"><table class="test2-election-table catalogue-detail__entity-table election-count-table"><thead><tr><th>Candidate</th><th>Party</th>${countNumbers.map((count) => `<th>Count ${formatNumber(count)}</th>`).join('')}<th>Status</th></tr>${countEvents.length ? `<tr class="test2-election-table__event-row"><th colspan="2">Count event</th>${countNumbers.map((count) => `<th>${escapeHtml(countEvents.find((event) => event.count === count)?.label || '')}</th>`).join('')}<th></th></tr>` : ''}</thead><tbody>
        ${candidates.map((candidate) => this.renderCountCandidateRow(candidate, countNumbers, result)).join('')}
        ${nonTransferable.size ? this.renderNonTransferableRow(nonTransferable, countNumbers) : ''}
      </tbody></table></div>`;
  }

  renderCountCandidateRow(candidate, countNumbers, result) {
    const counts = new Map((candidate.counts || []).map((count) => [Number(count.count), count]));
    return `<tr class="${candidate.elected ? 'test2-election-table__elected' : ''}"><td>${escapeHtml(candidate.name || '')}</td><td><span class="test2-party-swatch election-party-dot" style="background:${escapeHtml(candidate.colour || partyColour(candidate.party))}"></span>${escapeHtml(candidate.party || '')}</td>${countNumbers.map((count) => {
      const row = counts.get(Number(count));
      if (!row) return '<td></td>';
      const value = row.total ?? row.firstPrefs;
      const transfer = Number(row.transfers);
      const detail = this.host.countDetailedView ? [
        result.validPoll && Number.isFinite(Number(value)) ? `<small>${formatPercent(Number(value) / Number(result.validPoll) * 100)} of valid poll</small>` : '',
        Number.isFinite(transfer) && transfer ? `<small>${formatSigned(transfer)} transfer</small>` : '',
        row.status ? `<small>${escapeHtml(row.status)}</small>` : ''
      ].filter(Boolean).join('') : '';
      return `<td><span>${formatNumber(value)}${!this.host.countDetailedView && transfer ? ` (${formatSigned(transfer)})` : ''}</span>${detail ? `<div class="test2-election-count-detail">${detail}</div>` : ''}</td>`;
    }).join('')}<td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}${candidate.previous ? `<div class="test2-election-count-detail">Previous: ${escapeHtml(candidate.previous.status || '')}</div>` : ''}</td></tr>`;
  }

  renderNonTransferableRow(nonTransferable, countNumbers) {
    return `<tr class="test2-election-table__summary"><th>Non-transferable</th><td></td>${countNumbers.map((count) => {
      const row = nonTransferable.get(Number(count));
      if (!row) return '<td></td>';
      return `<td><span>${formatNumber(row.total)}</span>${this.host.countDetailedView && Number.isFinite(Number(row.transfers)) ? `<div class="test2-election-count-detail"><small>${formatSigned(row.transfers)} transfer</small></div>` : ''}</td>`;
    }).join('')}<td></td></tr>`;
  }

  renderRecallPetitionResult(result) {
    const petition = result.recallPetition || {};
    const signed = petition.signed ?? petition.signatures ?? result.leadingVotes ?? null;
    const threshold = petition.threshold ?? petition.required ?? null;
    const electorate = petition.electorate ?? result.electorate ?? null;
    const triggered = petition.triggered ?? (Number.isFinite(Number(signed)) && Number.isFinite(Number(threshold)) ? Number(signed) >= Number(threshold) : null);
    const shortfall = Number.isFinite(Number(signed)) && Number.isFinite(Number(threshold)) ? Number(threshold) - Number(signed) : null;
    return `<section class="test2-election-panel shared-election-renderer" data-election-renderer="shared" aria-label="${escapeHtml(result.constituency)} recall petition result"><dl class="test2-election-panel__stats"><div><dt>Constituency</dt><dd>${escapeHtml(result.constituency || '')}</dd></div>${electorate ? `<div><dt>Electorate</dt><dd>${formatNumber(electorate)}</dd></div>` : ''}${threshold ? `<div><dt>Threshold</dt><dd>${formatNumber(threshold)}</dd></div>` : ''}${signed ? `<div><dt>Signed</dt><dd>${formatNumber(signed)}</dd></div>` : ''}${shortfall !== null ? `<div><dt>${shortfall <= 0 ? 'Above threshold' : 'Shortfall'}</dt><dd>${formatNumber(Math.abs(shortfall))}</dd></div>` : ''}${triggered !== null ? `<div><dt>By-election triggered</dt><dd>${triggered ? 'Yes' : 'No'}</dd></div>` : ''}${petition.incumbent ? `<div><dt>Incumbent</dt><dd>${escapeHtml(petition.incumbent)}</dd></div>` : ''}${petition.incumbentParty ? `<div><dt>Incumbent party</dt><dd>${escapeHtml(petition.incumbentParty)}</dd></div>` : ''}</dl></section>`;
  }

  renderAnimationNotice(result) {
    if (result.hasCountDetail && result.animationPayload) {
      const key = normalizeName(result.matchName || result.constituency || '');
      return `<div class="test2-election-animation-ready"><div class="election-animation-actions"><button type="button" class="btn btn-primary" data-election-animation="${escapeHtml(key)}">Run transfer animation</button></div><div id="test2ElectionAnimationStatus" class="election-no-data" aria-live="polite"></div><div id="electionAnimationContainer" class="election-animation-container" style="display:none;"><div id="menuBar"><div id="controls"><a href="#" id="again" title="Restart"><i class="fa fa-backward"></i></a><a href="#" id="pause-replay" class="fa fa-pause" title="Play/Pause"></a><a href="#" id="step" title="Step"><i class="fa fa-forward"></i></a></div><div id="stageNumbers"></div><div id="quota"></div><div style="clear:both;"></div><div style="float:right; font-size:14px; color:#888;">Seats: <span id="seats-span"></span></div></div><div id="animation"></div><div id="count_matrix"></div><div id="transfers"></div><div id="transfers_constituency"></div></div></div>`;
    }
    return '<p class="election-no-data">No transfer animation data is available for this entry.</p>';
  }

  renderPartyEntity(entity) {
    return `<section class="election-entity-page shared-election-renderer" data-election-renderer="shared"><div class="election-entity-page__hero"><span class="election-party-dot election-party-dot--hero" style="background:${escapeHtml(entity.colour || partyColour(entity.name))}"></span><div><div class="election-entity-page__eyebrow">Party Information</div><h3 class="election-entity-page__title">${escapeHtml(entity.name || '')}</h3><p class="election-entity-page__subtitle">${escapeHtml(this.host.activeBundle.displayTitle || this.host.activeBundle.body)} - ${escapeHtml(this.host.activeBundle.date)}</p></div></div><div class="election-entity-metrics"><div class="election-entity-metric"><span class="election-entity-metric__label">Candidates stood</span><strong>${formatNumber(entity.stood)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">Candidates elected</span><strong>${formatNumber(entity.elected)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">First prefs</span><strong>${formatNumber(entity.firstPrefs)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">Final votes</span><strong>${formatNumber(entity.finalVotes)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">Constituencies/DEAs</span><strong>${formatNumber(entity.constituencies?.length || 0)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">Share</span><strong>${formatPercent(entity.shareOfTotal)}</strong></div></div>${this.renderCandidateSummaryTable((entity.candidates || []).map((candidate) => ({ ...candidate, party: entity.name, colour: entity.colour, firstPrefs: candidate.firstPref })))}</section>`;
  }

  renderCandidateEntity(entity) {
    return `<section class="election-entity-page shared-election-renderer" data-election-renderer="shared"><div class="election-entity-page__hero"><span class="election-party-dot election-party-dot--hero" style="background:${escapeHtml(entity.colour || partyColour(entity.party))}"></span><div><div class="election-entity-page__eyebrow">Candidate Information</div><h3 class="election-entity-page__title">${escapeHtml(entity.name || '')}</h3><p class="election-entity-page__subtitle">${escapeHtml(entity.party || '')}</p></div></div><div class="election-entity-metrics"><div class="election-entity-metric"><span class="election-entity-metric__label">Appearances</span><strong>${formatNumber(entity.appearances?.length || 0)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">Elected</span><strong>${formatNumber(entity.electedCount)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">First prefs</span><strong>${formatNumber(entity.firstPrefs)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">Final votes</span><strong>${formatNumber(entity.finalVotes)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">Constituencies/DEAs</span><strong>${formatNumber(entity.constituencies?.length || 0)}</strong></div><div class="election-entity-metric"><span class="election-entity-metric__label">Share</span><strong>${formatPercent(entity.shareOfTotal)}</strong></div></div><div class="test2-election-table-wrap"><table class="test2-election-table catalogue-detail__entity-table election-party-table"><thead><tr><th>Constituency/DEA</th><th>First prefs</th><th>Final votes</th><th>Status</th></tr></thead><tbody>${(entity.appearances || []).map((row) => `<tr><td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(normalizeName(row.constituency || ''))}">${escapeHtml(row.constituency)}</button></td><td>${formatNumber(row.firstPref)}</td><td>${formatNumber(row.finalVotes)}</td><td>${escapeHtml(row.status || '')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  renderViewTabs(tabs, active) {
    return `<div class="election-view-tabs test2-election-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === active ? 'true' : 'false'}" class="election-view-tab${id === active ? ' election-view-tab--active' : ''}" data-election-view="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}</div>`;
  }

  renderDataCoverageNotice() {
    const unmatched = Number(this.host.activeBundle?.unmatchedCount || 0);
    if (!unmatched) return '';
    return `<div class="test2-election-coverage-notice" role="note">${formatNumber(unmatched)} result ${unmatched === 1 ? 'row is' : 'rows are'} not styled on the map because no exact converted geography match is available yet.</div>`;
  }

  withPartyDeltas(rows = []) {
    const previousRows = this.host.previousBundle?.results?.length ? buildPartySummary(this.host.previousBundle.results) : [];
    const previousByParty = new Map(previousRows.map((row) => [normalizeName(row.party), row]));
    return rows.map((row) => {
      const previous = previousByParty.get(normalizeName(row.party));
      return {
        ...row,
        previous,
        deltas: previous ? {
          seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
          votes: numberOrZero(row.votes) - numberOrZero(previous.votes),
          share: row.share !== null && previous.share !== null ? row.share - previous.share : null
        } : null
      };
    });
  }

  withCouncilDeltas(rows = []) {
    const previousRows = this.host.previousBundle?.results?.length ? buildCouncilSummary(this.host.previousBundle.results) : [];
    const previousByCouncil = new Map(previousRows.map((row) => [normalizeName(row.council), row]));
    return rows.map((row) => {
      const previous = previousByCouncil.get(normalizeName(row.council));
      return {
        ...row,
        previous,
        deltas: previous ? {
          seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
          validPoll: numberOrZero(row.validPoll) - numberOrZero(previous.validPoll),
          turnoutPct: row.turnoutPct !== null && previous.turnoutPct !== null ? row.turnoutPct - previous.turnoutPct : null
        } : null
      };
    });
  }

  withLocalPartyDeltas(rows = []) {
    const previousRows = this.host.previousBundle?.results?.length ? buildLocalPartySummary(this.host.previousBundle.results) : [];
    const previousByPartyAndArea = new Map(previousRows.map((row) => [`${normalizeName(row.party)}|${normalizeName(row.constituency)}`, row]));
    return rows.map((row) => {
      const previous = previousByPartyAndArea.get(`${normalizeName(row.party)}|${normalizeName(row.constituency)}`);
      return {
        ...row,
        previous,
        deltas: previous ? {
          seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
          firstPrefs: numberOrZero(row.firstPrefs) - numberOrZero(previous.firstPrefs),
          share: row.share !== null && previous.share !== null ? row.share - previous.share : null
        } : null
      };
    });
  }
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2).replace(/\.00$/, '')}%` : String(value);
}

function formatSigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number > 0 ? '+' : ''}${number.toLocaleString()}`;
}

function formatSignedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number > 0 ? '+' : ''}${number.toFixed(2).replace(/\.00$/, '')}%`;
}

function formatDeltaPair(primary, secondary) {
  return [formatSigned(primary), formatSigned(secondary)].filter(Boolean).join(' / ');
}

function inferCountEvents(candidates = [], countNumbers = []) {
  const events = [];
  for (const count of countNumbers) {
    const elected = [];
    const excluded = [];
    for (const candidate of candidates) {
      const row = (candidate.counts || []).find((item) => Number(item.count) === Number(count));
      const status = normalizeName(row?.status || '');
      if (/not elected/.test(status)) continue;
      if (/elected|quota/.test(status) && Number(candidate.electedAt) === Number(count)) elected.push(candidate.name);
      if (/excluded|eliminated/.test(status) && Number(candidate.excludedAt) === Number(count)) excluded.push(candidate.name);
    }
    const labels = [];
    if (elected.length) labels.push(`${elected.length === 1 ? elected[0] : `${elected.length} candidates`} elected`);
    if (excluded.length) labels.push(`${excluded.length === 1 ? excluded[0] : `${excluded.length} candidates`} excluded`);
    if (labels.length) events.push({ count: Number(count), label: labels.join('; ') });
  }
  return events;
}

function recallTriggered(result = {}) {
  const petition = result.recallPetition || {};
  if (typeof petition.triggered === 'boolean') return petition.triggered;
  const signed = Number(petition.signed ?? petition.signatures ?? result.leadingVotes);
  const threshold = Number(petition.threshold ?? petition.required);
  return Number.isFinite(signed) && Number.isFinite(threshold) ? signed >= threshold : false;
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
