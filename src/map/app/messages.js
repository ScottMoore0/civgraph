/**
 * Messages to the user (the live region, map errors, a map's readable name) and downloads (the map
 * image export, app/src/map-image-export.js).
 *
 * Methods of the map app (Test2App, app/src/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import uiController from '../../ui-controller.js';
import dataService from '../../data-service.js';

export class MessageMethods {
  triggerDownload(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    if (filename) link.download = filename;
    // The `download` attribute is ignored for cross-origin URLs, and our FGBs
    // live on data.civgraph.net / archive.org (a different origin from the app).
    // Without this, a plain click is treated as a top-level navigation and the
    // whole app is replaced by the raw file URL — which reads as "the download
    // button does nothing". Open cross-origin targets in a new tab instead so the
    // app is preserved; the file downloads if the host sends an attachment
    // disposition, otherwise it opens for the user to save.
    let crossOrigin = false;
    try {
      crossOrigin = new URL(url, window.location.href).origin !== window.location.origin;
    } catch (_) { /* relative/blob URL — treat as same-origin */ }
    if (crossOrigin) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /**
   * "Download SVG" / "Download PNG": the map in the current view as a Wikipedia-style locator
   * map (app/src/map-image-export.js), the selected feature red, an election's areas in their
   * party colours. Large layers take a moment, so the trigger shows a busy state and the map
   * says what is happening; a view with too many features is refused with a reason.
   * options: { trigger?: HTMLElement, selection?: { properties, name } }
   */
  async exportMapImage(mapId, format = 'svg', options = {}) {
    if (!mapId) return null;
    if (this._mapImageExport) {
      this.showMapError(new Error('A map image is already being prepared.'), { kind: 'info' });
      return null;
    }
    const trigger = options.trigger || null;
    const label = trigger?.querySelector?.('[data-export-label]') || trigger;
    const original = label?.textContent;
    if (trigger) {
      trigger.setAttribute('aria-busy', 'true');
      trigger.disabled = true;
      if (label) label.textContent = 'Preparing…';
    }
    const progress = (text) => this.showMapError(new Error(text), { kind: 'info' });
    const work = (async () => {
      progress(`Preparing the ${format.toUpperCase()} of ${this.mapLabel(mapId)}…`);
      const { buildMapSvg, svgToPng } = await import('../../../app/src/map-image-export.js');
      const result = await buildMapSvg(this, mapId, { selection: options.selection || null, onProgress: progress });
      if (format === 'png') {
        const png = await svgToPng(result.svg, result.width, result.height, 2);
        uiController.triggerBlobDownload(png, result.filename.replace(/\.svg$/, '.png'));
      } else {
        uiController.triggerBlobDownload(new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' }), result.filename);
      }
      const what = result.selectedName ? ` with ${result.selectedName} highlighted` : '';
      progress(`Downloaded ${result.filename.replace(/\.svg$/, `.${format}`)}: ${result.featureCount.toLocaleString('en-GB')} features${what}.`);
      return result;
    })();
    this._mapImageExport = work;
    try {
      return await work;
    } catch (error) {
      this.showMapError(error);
      return null;
    } finally {
      this._mapImageExport = null;
      if (trigger) {
        trigger.removeAttribute('aria-busy');
        trigger.disabled = false;
        if (label && original !== undefined) label.textContent = original;
      }
    }
  }

  /** Say something to screen readers through the page's live region. Cleared first so the
   * same words twice ("… loaded" for two maps of one name) are still read out. */
  announce(message) {
    const announcer = document.getElementById('announcer');
    if (!announcer || !message) return;
    announcer.textContent = '';
    setTimeout(() => { announcer.textContent = message; }, 30);
  }

  /**
   * A failure the reader can see, dismiss and, where it makes sense, retry (UX review
   * 2026-10-30, #15). It used to be a line of text pinned over the map with no way to close it,
   * and most failures did not reach it at all: a layer whose tiles never came still said "On
   * map", and a bad id in a shared link was dropped from the address without a word.
   *
   * options.retry: called by the Retry button, after the notice closes.
   * options.kind: 'error' (default, role=alert) or 'info' (role=status, for what a link asked
   *   for that does not exist: nothing failed, but the reader should know).
   */
  showMapError(error, options = {}) {
    if (options.kind !== 'info') console.warn('[Test2]', error);
    const message = error?.message || String(error || '') || 'Map layer is not available in MapLibre yet.';
    let status = document.getElementById('test2Status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'test2Status';
      // On the map itself: the election pane covers the foot of .pane--map.
      (document.getElementById('map') || document.querySelector('.pane--map'))?.appendChild(status);
    }
    status.className = `map-error${options.kind === 'info' ? ' map-error--info' : ''}`;
    status.setAttribute('role', 'group');
    status.setAttribute('aria-label', options.kind === 'info' ? 'Message' : 'Error');
    status.hidden = false;
    status.innerHTML = '';
    const shownAt = Date.now();
    status.dataset.shownAt = String(shownAt);
    // A note (not an error) clears itself after a while; an error waits to be dismissed or retried.
    if (options.kind === 'info') {
      setTimeout(() => {
        if (status.dataset.shownAt === String(shownAt)) { status.hidden = true; status.innerHTML = ''; }
      }, 15000);
    }
    const text = document.createElement('span');
    text.className = 'map-error__text';
    text.textContent = message;
    status.appendChild(text);
    const close = () => {
      status.hidden = true;
      status.innerHTML = '';
    };
    if (typeof options.retry === 'function') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'map-error__retry';
      retry.textContent = options.retryLabel || 'Retry';
      retry.addEventListener('click', () => {
        close();
        Promise.resolve().then(options.retry).catch((err) => this.showMapError(err, options));
      });
      status.appendChild(retry);
    }
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'map-error__close';
    dismiss.setAttribute('aria-label', 'Dismiss this message');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', close);
    status.appendChild(dismiss);
    // Said through the page's one live region, as "… loaded" is, so a screen reader hears the
    // failure where it heard the success; the box itself is not a second live region.
    this.announce(message);
  }

  /** Hide the map message if it has been up for a moment: one raised by the step now starting
   * is newer than that, and stays. */
  dismissStaleMapMessage(minAgeMs = 1500) {
    const status = document.getElementById('test2Status');
    if (!status || status.hidden) return;
    const shownAt = Number(status.dataset.shownAt || 0);
    if (Date.now() - shownAt >= minAgeMs) this.hideMapError();
  }

  hideMapError() {
    const status = document.getElementById('test2Status');
    if (status) { status.hidden = true; status.innerHTML = ''; }
  }

  /** A map's name, for a message: its series and edition as the catalogue shows them
   * ("Townlands, Ireland"), else its catalogue name, else its id. */
  mapLabel(mapId) {
    const cat = uiController._catalogueNext;
    const series = cat?.seriesById?.get(cat.seriesOfMap?.get(mapId));
    if (series) {
      const member = [...(series.members || []), ...(series.local || [])].find((m) => m.id === mapId);
      if (member && (series.members.length > 1 || series.local?.some((m) => m.id === mapId))) return `${series.name}, ${member.label}`;
      return series.name;
    }
    const config = dataService.getMapById(mapId);
    return String(config?.name || this.metadataService?.getLayer?.(mapId)?.name || mapId).replace(/\s+/g, ' ').trim();
  }
}
