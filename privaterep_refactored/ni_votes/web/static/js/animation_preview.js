(function (window, document) {
  'use strict';

  const SELECTOR = '.election-animation-preview[data-animation-index]';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_ROWS = 6;
  const ROW_HEIGHT = 26;
  const ROW_GAP = 10;
  const PADDING_X = 14;
  const PADDING_Y = 16;
  const LABEL_WIDTH = 160;
  const BAR_WIDTH = 220;
  const VALUE_GUTTER = 16;

  function getResultsCollection(results) {
    if (Array.isArray(results)) {
      return results;
    }
    if (window && window.VIEWER_STATE && Array.isArray(window.VIEWER_STATE.results)) {
      return window.VIEWER_STATE.results;
    }
    return [];
  }

  function parseNumber(value) {
    if (typeof window.parseNumeric === 'function') {
      const parsed = window.parseNumeric(value);
      return parsed !== null && !Number.isNaN(parsed) ? parsed : null;
    }
    if (value === undefined || value === null) {
      return null;
    }
    const num = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(num) ? num : null;
  }

  function formatVotes(value) {
    if (typeof window.formatNumberWithDash === 'function') {
      return window.formatNumberWithDash(value);
    }
    const numeric = parseNumber(value);
    if (numeric === null) {
      return '—';
    }
    return Number(numeric).toLocaleString('en-GB');
  }

  function finalVoteValue(entry) {
    if (!entry || !Array.isArray(entry.votes)) {
      return null;
    }
    for (let i = entry.votes.length - 1; i >= 0; i -= 1) {
      const numeric = parseNumber(entry.votes[i]);
      if (numeric !== null) {
        return numeric;
      }
    }
    return null;
  }

  function buildCandidateLabel(entry) {
    if (!entry) {
      return '';
    }
    const pieces = [];
    if (entry.name) {
      pieces.push(String(entry.name));
    }
    if (entry.party) {
      pieces.push(String(entry.party));
    }
    return pieces.join(' • ');
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function createSvgElement(tag) {
    return document.createElementNS(SVG_NS, tag);
  }

  function renderQuota(svg, config) {
    const quotaValue = parseNumber(config.quota);
    if (quotaValue === null || !Number.isFinite(config.maxVote) || config.maxVote <= 0) {
      return;
    }
    const ratio = clamp(quotaValue / config.maxVote, 0, 1.2);
    const x = config.barX + (config.barWidth * ratio);
    const line = createSvgElement('line');
    line.setAttribute('x1', x.toFixed(2));
    line.setAttribute('x2', x.toFixed(2));
    line.setAttribute('y1', config.barY);
    line.setAttribute('y2', config.barY + config.totalHeight);
    line.setAttribute('stroke', '#084a96');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6 4');
    line.setAttribute('opacity', '0.8');
    svg.appendChild(line);

    const label = createSvgElement('text');
    label.setAttribute('x', x.toFixed(2));
    label.setAttribute('y', (config.barY - 6).toFixed(2));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'preview-quota-label');
    label.textContent = 'Quota';
    svg.appendChild(label);
  }

  function renderPreviewSvg(data) {
    const rows = Array.isArray(data?.candidates) ? data.candidates.slice(0, MAX_ROWS) : [];
    const effectiveRows = rows.length || 1;
    const totalHeight = (effectiveRows * ROW_HEIGHT) + ((effectiveRows - 1) * ROW_GAP);
    const viewWidth = (PADDING_X * 2) + LABEL_WIDTH + BAR_WIDTH + VALUE_GUTTER;
    const viewHeight = (PADDING_Y * 2) + totalHeight;
    const svg = createSvgElement('svg');
    svg.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);
    svg.setAttribute('class', 'preview-graphic');
    svg.setAttribute('role', 'presentation');
    svg.setAttribute('aria-hidden', 'true');

    const background = createSvgElement('rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', viewWidth);
    background.setAttribute('height', viewHeight);
    background.setAttribute('rx', '8');
    background.setAttribute('ry', '8');
    background.setAttribute('fill', '#f5f7fb');
    background.setAttribute('stroke', '#dfe6f3');
    svg.appendChild(background);

    const barX = PADDING_X + LABEL_WIDTH;
    const valueX = PADDING_X + LABEL_WIDTH + BAR_WIDTH;
    const baseY = PADDING_Y;

    rows.forEach((entry, index) => {
      const y = baseY + index * (ROW_HEIGHT + ROW_GAP);
      const barHeight = ROW_HEIGHT - 6;
      const track = createSvgElement('rect');
      track.setAttribute('x', barX);
      track.setAttribute('y', y);
      track.setAttribute('width', BAR_WIDTH);
      track.setAttribute('height', barHeight);
      track.setAttribute('rx', '5');
      track.setAttribute('ry', '5');
      track.setAttribute('fill', '#e8eef9');
      svg.appendChild(track);

      const voteValue = finalVoteValue(entry);
      const proportion = (data.maxVote && data.maxVote > 0 && voteValue !== null)
        ? clamp(voteValue / data.maxVote, 0, 1)
        : 0;
      const barWidth = proportion * BAR_WIDTH;
      const bar = createSvgElement('rect');
      bar.setAttribute('x', barX);
      bar.setAttribute('y', y);
      bar.setAttribute('width', barWidth);
      bar.setAttribute('height', barHeight);
      bar.setAttribute('rx', '5');
      bar.setAttribute('ry', '5');
      bar.setAttribute('fill', entry?.colour || '#9bb7ff');
      bar.setAttribute('opacity', '0.92');
      svg.appendChild(bar);

      const labelText = createSvgElement('text');
      labelText.setAttribute('x', PADDING_X);
      labelText.setAttribute('y', y + (barHeight / 2));
      labelText.setAttribute('dominant-baseline', 'middle');
      labelText.setAttribute('class', 'preview-row-label');
      labelText.textContent = buildCandidateLabel(entry);
      svg.appendChild(labelText);

      const valueText = createSvgElement('text');
      valueText.setAttribute('x', valueX);
      valueText.setAttribute('y', y + (barHeight / 2));
      valueText.setAttribute('dominant-baseline', 'middle');
      valueText.setAttribute('text-anchor', 'end');
      valueText.setAttribute('class', 'preview-row-value');
      valueText.textContent = formatVotes(voteValue);
      svg.appendChild(valueText);
    });

    renderQuota(svg, {
      quota: data?.meta?.quota,
      maxVote: data?.maxVote || 0,
      barX,
      barY: baseY - 2,
      barWidth: BAR_WIDTH,
      totalHeight,
    });

    return svg;
  }

  function setUnavailable(button) {
    button.classList.add('is-disabled');
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.removeAttribute('data-animation-index');
    button.innerHTML = '';
    const message = document.createElement('span');
    message.className = 'preview-empty';
    message.textContent = 'Animation preview unavailable';
    button.appendChild(message);
  }

  function renderPreview(button, election) {
    if (!button) {
      return;
    }
    if (!election) {
      setUnavailable(button);
      return;
    }
    const buildData = typeof window.buildElectionAnimationData === 'function'
      ? window.buildElectionAnimationData
      : null;
    const data = buildData ? buildData(election) : null;
    if (!data || !Array.isArray(data.candidates) || !data.candidates.length) {
      setUnavailable(button);
      return;
    }

    button.classList.remove('is-disabled');
    button.disabled = false;
    button.removeAttribute('aria-disabled');

    const labelPieces = [];
    if (election?.heading) {
      labelPieces.push(String(election.heading));
    }
    const subtitle = election?.date_full || election?.date || '';
    if (subtitle) {
      labelPieces.push(String(subtitle));
    }
    const constituency = election?.constituency_value || election?.constituency || '';
    if (constituency && !labelPieces.includes(constituency)) {
      labelPieces.push(String(constituency));
    }
    const resolvedLabel = labelPieces.filter(Boolean).join(' — ') || 'this election';

    button.dataset.previewLabel = resolvedLabel;
    button.setAttribute('aria-label', `Open interactive count animation for ${resolvedLabel}`);
    button.setAttribute('title', `Open interactive count animation for ${resolvedLabel}`);
    button.setAttribute('aria-pressed', 'false');

    button.innerHTML = '';

    const heading = document.createElement('div');
    heading.className = 'preview-title';
    heading.textContent = 'Count preview';
    button.appendChild(heading);

    const svg = renderPreviewSvg(data);
    button.appendChild(svg);

    const instruction = document.createElement('span');
    instruction.className = 'preview-instruction';
    instruction.dataset.previewAction = 'true';
    instruction.textContent = 'Open animation';
    button.appendChild(instruction);
  }

  function init(root, results) {
    const scope = root || document;
    const collection = getResultsCollection(results);
    const nodes = scope.querySelectorAll(SELECTOR);
    nodes.forEach(button => {
      if (button.dataset.previewInit === '1') {
        return;
      }
      button.dataset.previewInit = '1';
      const index = Number(button.dataset.animationIndex);
      const election = Number.isFinite(index) ? collection[index] : null;
      renderPreview(button, election);
      button.addEventListener('focus', () => button.classList.add('is-focused'));
      button.addEventListener('blur', () => button.classList.remove('is-focused'));
    });
  }

  window.ElectionAnimationPreview = { init };
})(window, document);
