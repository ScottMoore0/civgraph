/**
 * Map controls: the controls and Active layers panels, Escape handling, clearing a highlight on a click
 * outside the map, and the base map (and following the theme).
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import uiController from '../../../../src/ui-controller.js';
import { readStored, writeStored } from '../../../../src/storage-keys.mjs';
import { resolveBaseMapId } from '../renderer/basemap.mjs';

export class MapControlMethods {
  /**
   * T1-09: Escape closes the map overlays.
   *
   * #supportModal already handled Escape; these three did not, so a keyboard user
   * could open the map controls, the active-layers panel or a feature popup with no
   * way to dismiss it except by finding the close button.
   *
   * One press closes one thing, topmost first, so Escape does not clear the whole
   * screen at once. Ignored while a text field has focus, where Escape usually means
   * "revert what I am typing", and while the support modal is open, since it owns
   * Escape itself.
   */
  setupOverlayEscape() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const modal = document.getElementById('supportModal');
      if (modal && !modal.classList.contains('hidden')) return;

      const featureInfo = document.getElementById('featureInfo');
      if (featureInfo && !featureInfo.classList.contains('hidden')) {
        uiController.hideFeatureInfo?.();
        return;
      }
      if (document.getElementById('activeLayersToggle')?.getAttribute('aria-expanded') === 'true') {
        this.setActiveLayersPanelOpen(false);
        document.getElementById('activeLayersToggle')?.focus({ preventScroll: true });
        return;
      }
      if (document.getElementById('mapControlsToggle')?.getAttribute('aria-expanded') === 'true') {
        this.setMapControlsOpen(false);
        document.getElementById('mapControlsToggle')?.focus({ preventScroll: true });
      }
    }, { signal: this.lifecycle.signal });
  }

  setupMapControls() {
    const mapControlsToggle = document.getElementById('mapControlsToggle');
    const mapControlsClose = document.getElementById('mapControlsClose');
    const activeLayersToggle = document.getElementById('activeLayersToggle');
    const activeLayersClose = document.getElementById('activeLayersClose');
    const featureInfoClose = document.getElementById('featureInfoClose');

    mapControlsToggle?.addEventListener('click', () => {
      this.setMapControlsOpen(mapControlsToggle.getAttribute('aria-expanded') !== 'true', { focus: true });
    });
    mapControlsClose?.addEventListener('click', () => this.setMapControlsOpen(false, { focus: true }));

    document.getElementById('baseMapSelect')?.addEventListener('change', async (event) => {
      await this.applyBaseMap(event.target.value || 'osm-standard', { userChoice: true });
      this.updateURLState();
    });

    const outlineSlider = document.getElementById('transparencySlider');
    const outlineValue = document.getElementById('transparencyValue');
    outlineSlider?.addEventListener('input', () => {
      const value = Number(outlineSlider.value);
      this.mapController.setTransparency(value);
      if (outlineValue) outlineValue.textContent = `${value}%`;
      this.updateURLState();
    });

    const fillSlider = document.getElementById('fillTransparencySlider');
    const fillValue = document.getElementById('fillTransparencyValue');
    fillSlider?.addEventListener('input', () => {
      const value = Number(fillSlider.value);
      this.mapController.setFillTransparency(value);
      if (fillValue) fillValue.textContent = `${value}%`;
      this.updateURLState();
    });

    document.getElementById('labelsToggle')?.addEventListener('change', (event) => {
      this.mapController.setLabelsEnabled(event.target.checked);
      this.updateURLState();
    });

    let textScale = Number(readStored('textScale') || '100');
    const textSteps = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
    const textValue = document.getElementById('textSizeValue');
    const applyTextScale = () => {
      if (textValue) textValue.textContent = `${textScale}%`;
      this.mapController.setTextScale(textScale);
      writeStored('textScale', textScale);
      this.updateURLState();
    };
    document.getElementById('textSizeDecrease')?.addEventListener('click', () => {
      const index = textSteps.indexOf(textScale);
      textScale = textSteps[Math.max(0, index - 1)] || 100;
      applyTextScale();
    });
    document.getElementById('textSizeIncrease')?.addEventListener('click', () => {
      const index = textSteps.indexOf(textScale);
      textScale = textSteps[Math.min(textSteps.length - 1, index + 1)] || 100;
      applyTextScale();
    });
    applyTextScale();

    activeLayersToggle?.addEventListener('click', () => {
      this.setActiveLayersPanelOpen(activeLayersToggle.getAttribute('aria-expanded') !== 'true', { focus: true });
    });
    activeLayersClose?.addEventListener('click', () => this.setActiveLayersPanelOpen(false, { focus: true }));
    featureInfoClose?.addEventListener('click', () => uiController.hideFeatureInfo());

    document.getElementById('conditionalStylingBtn')?.addEventListener('click', () => {
      this.showMapError(new Error('Conditional styling controls use MapLibre expressions; this route currently supports base opacity, labels, and text scale.'));
    });

    this.mapController.map?.on('moveend', () => this.updateURLState());
  }

  installOutsideMapHighlightClear() {
    if (this._outsideMapHighlightClearInstalled) return;
    this._outsideMapHighlightClearInstalled = true;
    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (target?.closest?.('#map, .maplibregl-map, .maplibre-dom-label')) return;
      // Kept for "Download SVG": a feature whose details are still showing counts as selected,
      // though reaching the download (in the catalogue or the details box) clears its highlight.
      const selected = this.mapController?.renderer?.selected;
      if (selected) this._lastClearedSelection = selected;
      this.mapController?.clearTransientHighlight?.();
    }, { capture: true, signal: this.lifecycle.signal });
  }

  /**
   * options.focus: the reader opened or closed it (not a restored link), so focus goes with
   * it: into the panel on open, back to its button on close. It used to drop to <body>, leaving
   * a keyboard or screen-reader user at the top of the page (UX-TRIAGE T3-06).
   */
  setMapControlsOpen(open, options = {}) {
    const mapControlsToggle = document.getElementById('mapControlsToggle');
    const mapControlPanel = document.getElementById('mapControlPanel');
    mapControlsToggle?.setAttribute('aria-expanded', String(Boolean(open)));
    mapControlPanel?.classList.toggle('map-control-panel--collapsed', !open);
    mapControlPanel?.classList.toggle('map-control-panel--expanded', Boolean(open));
    if (options.focus) this.movePanelFocus(mapControlPanel, mapControlsToggle, open);
    this.updateURLState();
  }

  setActiveLayersPanelOpen(open, options = {}) {
    const activeLayersToggle = document.getElementById('activeLayersToggle');
    const activeLayers = document.getElementById('activeLayers');
    activeLayersToggle?.setAttribute('aria-expanded', String(Boolean(open)));
    activeLayers?.classList.toggle('hidden', !open);
    if (options.focus) this.movePanelFocus(activeLayers, activeLayersToggle, open);
    this.updateURLState();
  }

  movePanelFocus(panel, toggle, open) {
    if (!panel) return;
    if (!open) {
      // Only when focus was inside, or would otherwise be lost: a click on the map that
      // closed it should not pull focus back to the button.
      const active = document.activeElement;
      if (!active || active === document.body || panel.contains(active)) toggle?.focus({ preventScroll: true });
      return;
    }
    // After the panel is shown: a hidden element cannot take focus.
    requestAnimationFrame(() => {
      const target = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .find((el) => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      if (target) target.focus({ preventScroll: true });
      else {
        if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
        panel.focus({ preventScroll: true });
      }
    });
  }

  /**
   * T1-06: apply a basemap, recording whether the user chose it deliberately.
   *
   * `userChoice` matters because the theme toggle also wants to change the
   * basemap, and must never override a deliberate pick. Both the basemap select
   * and a `?base=` URL parameter count as deliberate — a shared link carrying a
   * basemap is someone's choice, even if the person opening it is not the one who
   * made it.
   *
   * An id that is not a base map any more (the Esri, CARTO and Stamen ones, removed 11 Nov 2026,
   * in an address saved before) is the default instead (resolveBaseMapId), and is not counted as a choice.
   */
  async applyBaseMap(baseMapId, { userChoice = false } = {}) {
    this.baseMapId = resolveBaseMapId(baseMapId);
    if (userChoice && this.baseMapId === baseMapId) {
      this.userPickedBasemap = true;
      try { localStorage.setItem('basemapUserChoice', '1'); } catch { /* private mode */ }
    }
    const map = this.mapController?.map;
    if (!map) return;
    // Not map.once('load'): that fires once, on the first frame drawn, so a wait begun after
    // it (a tile still loading makes isStyleLoaded() false) never ended.
    await this.whenStyleLoaded();
    this.mapController.setBaseMap(this.baseMapId);
  }

  /**
   * Keep the basemap on OpenStreetMap.
   *
   * T1-06 originally made this follow the theme, switching to `cartodb-dark` in dark
   * mode so a white landmass did not sit beside a black panel. That is no longer
   * possible: CARTO's basemaps now require an API key, and rather than failing they
   * serve tiles with "API KEY REQUIRED — carto.com/basemaps/apikey" printed across
   * every one. Measured 2026-08-26: those requests return HTTP 200, so nothing in the
   * app could detect it -- the map simply rendered the watermark, and looked broken to
   * every visitor in dark mode.
   *
   * OSM has no dark variant, so dark mode now keeps the standard basemap. That gives up
   * T1-06's benefit and it is the right trade: a light basemap is a cosmetic mismatch,
   * a watermarked one is a broken map. Restoring a dark basemap means either a keyed
   * provider or a self-hosted style, which is a deliberate choice rather than a default.
   *
   * Kept as a method (rather than deleted) because callers and tests use its return
   * value, and because this is where a future dark basemap would be reinstated.
   */
  async syncBasemapToTheme() {
    if (this.userPickedBasemap) return null;
    const wanted = 'osm-standard';
    if (this.baseMapId === wanted) return null;
    await this.applyBaseMap(wanted);
    // Keep the Map Settings control honest about what is actually displayed.
    const select = document.getElementById('baseMapSelect');
    if (select) select.value = wanted;
    return wanted;
  }
}
