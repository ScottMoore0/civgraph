/**
 * Phone layout: the catalogue toggle and pane toggle, the peek messages, the first-visit hint and the
 * catalogue performance profile.
 *
 * Methods of the map app (Test2App, app/src/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import uiController from '../../ui-controller.js';
import { readStored, writeStored } from '../../storage-keys.mjs';

export class MobileLayoutMethods {
  relocateMobileCatalogueToggle() {
    const toggle = document.getElementById('mobileToggle');
    const stack = document.querySelector('#map .test2-main-control-stack');
    const zoomControl = stack?.querySelector('.test2-main-zoom-control');
    if (!toggle || !stack || !zoomControl) return;
    toggle.classList.remove('mobile-toggle--navbar');
    toggle.classList.add('mobile-toggle--map-stack');
    toggle.removeAttribute('style');
    // T3-09 (#104): this set a THIRD wording, "Show or hide catalogue", which then got
    // replaced by updateMobilePaneToggleState()'s state-dependent "Show map" /
    // "Show catalogue". Two sources for one label, briefly disagreeing. The
    // state-dependent one wins because it says what pressing the button will DO.
    this.updateMobilePaneToggleState();
    if (toggle.parentElement !== stack || toggle.nextElementSibling !== zoomControl) {
      stack.insertBefore(toggle, zoomControl);
    }
  }

  installMobilePaneToggle() {
    if (this._mobilePaneToggleInstalled) {
      this.updateMobilePaneToggleState();
      return;
    }
    const header = document.querySelector('.app-header');
    if (!header) return;

    let toggle = document.getElementById('mobilePaneToggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'mobilePaneToggle';
      toggle.type = 'button';
      toggle.className = 'mobile-pane-toggle';
      toggle.innerHTML = '<span aria-hidden="true">☰</span>';
      const menuButton = header.querySelector(':scope > .mobile-menu-toggle') || document.getElementById('mobileMenuBtn');
      if (menuButton?.parentElement === header) {
        header.insertBefore(toggle, menuButton);
      } else {
        header.appendChild(toggle);
      }
    }

    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      const nextState = uiController.currentStateId === 'info-full' ? 'map-full' : 'info-full';
      uiController.setSplitState(nextState);
      setTimeout(() => this.mapController?.invalidateSize?.(), 250);
      this.updateMobilePaneToggleState();
    });

    const previousSplitHandler = uiController.onSplitChange;
    uiController.onSplitChange = (stateId) => {
      if (typeof previousSplitHandler === 'function') previousSplitHandler(stateId);
      this.updateMobilePaneToggleState();
    };

    window.matchMedia?.('(max-width: 768px)')?.addEventListener?.('change', () => {
      this.updateMobilePaneToggleState();
    });

    this._mobilePaneToggleInstalled = true;
    this.mobilePaneToggle = toggle;
    this.updateMobilePaneToggleState();
  }

  /**
   * T3-09 (#105): on mobile the catalogue covers the map, so loading a layer left the
   * user looking at the list they had just used rather than the thing they had asked
   * for. They had to find the toggle and switch across manually, every time.
   *
   * Only on a mobile-like layout, and only when the catalogue is the full-screen pane --
   * on a split or desktop layout both are visible and there is nothing to dismiss.
   */
  dismissMobileCatalogueAfterLoad(label = '') {
    if (!this.isPhoneLayout()) return;
    if (uiController.currentStateId !== 'info-full') return;
    uiController.setSplitState('map-full');
    this.updateMobilePaneToggleState();
    setTimeout(() => this.mapController?.invalidateSize?.(), 250);
    // No "<map> is on the map" note (owner, 1 Nov 2026): the map itself shows what changed, and
    // the catalogue button in the header goes straight back.
  }

  /** On a phone the catalogue and the map are separate views: a page opened from the map (a
   * results table, a feature's name) or from a shared link is shown, not left behind the map. */
  revealCatalogueOnPhone() {
    if (!this.isPhoneLayout() || uiController.currentStateId !== 'map-full') return;
    uiController.setSplitState('info-full');
    this.updateMobilePaneToggleState();
  }

  isPhoneLayout() {
    return Boolean(uiController.isMobile || window.matchMedia?.('(max-width: 768px), (pointer: coarse)')?.matches);
  }

  /**
   * A small bar across the top of the map on phones: what just happened, and a button to the
   * catalogue. It goes by itself after a while, or when the catalogue opens; the header's
   * catalogue button stays the one permanent way across, so the map has no second toggle.
   */
  showMobilePeek(message, { action = 'Open the catalogue', timeoutMs = 9000, onDismiss = null } = {}) {
    const host = document.querySelector('.pane--map') || document.getElementById('map')?.parentElement;
    if (!host) return null;
    let peek = document.getElementById('mobileCataloguePeek');
    if (!peek) {
      peek = document.createElement('div');
      peek.id = 'mobileCataloguePeek';
      peek.className = 'mobile-catalogue-peek';
      peek.setAttribute('role', 'status');
      host.appendChild(peek);
    }
    clearTimeout(this._mobilePeekTimer);
    peek.innerHTML = '';
    const text = document.createElement('span');
    text.className = 'mobile-catalogue-peek__text';
    text.textContent = message;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mobile-catalogue-peek__open';
    open.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>';
    open.append(action);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mobile-catalogue-peek__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    const hide = () => {
      clearTimeout(this._mobilePeekTimer);
      peek.hidden = true;
      onDismiss?.();
    };
    open.addEventListener('click', () => {
      hide();
      uiController.setSplitState('info-full');
      this.updateMobilePaneToggleState();
    });
    close.addEventListener('click', hide);
    peek.append(text, open, close);
    peek.hidden = false;
    this.hideMobilePeek = hide;
    if (timeoutMs) this._mobilePeekTimer = setTimeout(hide, timeoutMs);
    return peek;
  }

  /**
   * First visit on a phone: the page opens on a bare map, and nothing said where the maps
   * are. One hint, once; the flag lives in localStorage (readStored/writeStored swallow a
   * blocked or full store, so a private window just sees the hint again).
   */
  showFirstVisitHint() {
    if (!this.isPhoneLayout() || uiController.currentStateId !== 'map-full') return;
    if (readStored('mapHintSeen')) return;
    if (this.getLoadedLayerIds().length || this.elections?.activeEntry) return;
    this.showMobilePeek('Choose a map or an election from the catalogue to draw it here.', {
      action: 'Open the catalogue',
      timeoutMs: 0,
      onDismiss: () => writeStored('mapHintSeen', '1'),
    });
  }

  updateMobilePaneToggleState() {
    const toggle = document.getElementById('mobilePaneToggle');
    if (!toggle) return;
    const showingCatalogue = uiController.currentStateId === 'info-full';
    // The bar over the map is about the map; it has nothing to say once the catalogue is up.
    if (showingCatalogue && document.getElementById('mobileCataloguePeek')?.hidden === false) this.hideMobilePeek?.();
    const label = showingCatalogue ? 'Show map' : 'Show catalogue';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
    const target = showingCatalogue ? 'map' : 'catalogue';
    // It showed a bare ☰ beside the site menu's own ☰, so the header had two identical
    // buttons doing different things. It now shows where it goes: a map, or a list.
    if (toggle.dataset.target !== target || !toggle.querySelector('svg')) {
      toggle.innerHTML = target === 'map'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>';
    }
    toggle.dataset.target = target;
  }

  configureCataloguePerformanceProfile() {
    const mobileQuery = window.matchMedia?.('(max-width: 768px), (pointer: coarse)');
    const apply = () => {
      const isMobileLike = Boolean(uiController.isMobile || mobileQuery?.matches);
      uiController.showAllMaps = !isMobileLike;
      uiController.includeMobileElectionCatalogue = true;
      uiController.singleSectionFlatCatalogue = true;
      uiController._mobileInitialMapCardLimit = isMobileLike ? 12 : 24;
      uiController._mobileInitialElectionCardLimit = isMobileLike ? 2 : 15;
      if (!isMobileLike) uiController._mobileCatalogueExpanded = false;
    };
    apply();
    mobileQuery?.addEventListener?.('change', () => {
      apply();
      uiController.requestFlatViewRender?.(uiController._lastMapListOptions || {}, { defer: true });
    });
  }
}
