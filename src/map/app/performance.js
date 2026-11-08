/**
 * Service worker registration and status, and the performance dashboard panel (#performanceDashboard).
 *
 * Methods of the map app (Test2App, app/src/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import { escapeHtml, formatBytes, shortCacheName } from './helpers.mjs';
import { retireLegacyServiceWorkers } from './retire-legacy-workers.mjs';
import { SW_REGISTRATION } from './service-worker-state.mjs';
import { createState, setHidden } from '../state-helpers.mjs';

export class PerformanceMethods {
  registerServiceWorker() {
    // idle, unavailable, registering, ready or failed (service-worker-state.mjs).
    const registrationState = (this.serviceWorkerRegistration = createState(SW_REGISTRATION));
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
      registrationState.to('unavailable');
      this.serviceWorkerStatusPromise = Promise.resolve({ available: false, reason: 'service-worker API unavailable' });
      return;
    }
    // Workers the retired /render/, /test/ and /test2/ apps left installed: their visitors are
    // redirected here, so this is where the kill switch gets its chance (retire-legacy-workers.mjs).
    retireLegacyServiceWorkers(navigator.serviceWorker);
    this.serviceWorkerConfig = this.getServiceWorkerConfig();
    registrationState.to('registering');
    this.serviceWorkerStatusPromise = navigator.serviceWorker.register(this.serviceWorkerConfig.url, { scope: this.serviceWorkerConfig.scope })
      .then(async (registration) => {
        await navigator.serviceWorker.ready.catch(() => registration);
        registrationState.to('ready');
        return this.getServiceWorkerStatus(registration);
      })
      .catch((error) => {
        // A status query that failed after the registration was ready leaves it ready.
        if (registrationState.state() === 'registering') registrationState.to('failed');
        return {
          available: false,
          reason: String(error?.message || error)
        };
      });
  }

  getServiceWorkerConfig() {
  return { url: '/sw.js', scope: '/', route: 'root' };
}

  async getServiceWorkerStatus(registration = null) {
    if (!('serviceWorker' in navigator)) return { available: false, reason: 'service-worker API unavailable' };
    const config = this.serviceWorkerConfig || this.getServiceWorkerConfig();
    const activeRegistration = registration || await navigator.serviceWorker.getRegistration(config.scope);
    const target = navigator.serviceWorker.controller
      || activeRegistration?.active
      || activeRegistration?.waiting
      || activeRegistration?.installing;
    if (!target) return { available: true, controlled: false, reason: 'registered but not yet controlling this page' };
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve({ available: true, controlled: Boolean(navigator.serviceWorker.controller), reason: 'status timeout' }), 900);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve({
          available: true,
          route: config.route,
          controlled: Boolean(navigator.serviceWorker.controller),
          ...(event.data || {})
        });
      };
      target.postMessage({ type: 'TEST2_SW_STATUS' }, [channel.port2]);
    });
  }

  async collectPerformanceStatus() {
    const budget = await this.loadPerformanceBudget();
    const serviceWorker = await this.getServiceWorkerStatus().catch((error) => ({
      available: false,
      reason: String(error?.message || error)
    }));
    const mapMetrics = this.mapController?.getMetrics?.() || this.mapController?.metrics || [];
    const electionOverlay = this.elections?.getSeatCircleOverlayState?.() || null;
    return {
      generatedAt: new Date().toISOString(),
      budget,
      serviceWorker,
      map: {
        runtimeProfile: this.mapController?.runtimeProfile || null,
        loadedLayers: this.mapController?.layers?.size || 0,
        metrics: mapMetrics.slice(-40),
        fallbackCount: mapMetrics.filter((metric) => /fallback/i.test(metric?.event || '')).length
      },
      elections: {
        active: this.elections?.activeEntry?.key || null,
        seatCircleRenderMs: Number(this.elections?.lastSeatCircleRenderMs || 0),
        overlay: electionOverlay
      },
      browser: {
        memory: performance.memory?.usedJSHeapSize || 0,
        deviceMemory: navigator.deviceMemory || null,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        dpr: window.devicePixelRatio || 1
      }
    };
  }

  async loadPerformanceBudget() {
    if (this.performanceBudget) return this.performanceBudget;
    this.performanceBudget = fetch('/app/build/performance-dashboard.json', { cache: 'no-cache' })
      .then((response) => response.ok ? response.json() : null)
      .catch(() => null);
    return this.performanceBudget;
  }

  setupPerformanceDashboard() {
    const dashboard = document.getElementById('performanceDashboard');
    if (dashboard) setHidden(dashboard, true);
    const button = document.getElementById('performanceDashboardRefresh');
    const render = () => this.renderPerformanceDashboard().catch((error) => {
      const target = document.getElementById('performanceDashboardStatus');
      if (target) target.textContent = `Performance status unavailable: ${error?.message || error}`;
    });
    button?.addEventListener('click', render);
  }

  async renderPerformanceDashboard() {
    const target = document.getElementById('performanceDashboardStatus');
    if (!target) return;
    const status = await this.collectPerformanceStatus();
    const budget = status.budget || {};
    const failedBudgets = Number(budget?.totals?.failed || 0);
    const warningBudgets = Number(budget?.totals?.warnings || 0);
    const budgetClass = failedBudgets ? 'danger' : (warningBudgets ? 'warning' : 'ok');
    const serviceWorker = status.serviceWorker || {};
    const storage = serviceWorker.storage || {};
    const cacheSummary = serviceWorker.caches
      ? Object.entries(serviceWorker.caches).map(([name, count]) => `${shortCacheName(name)}: ${count}`).join(', ')
      : 'not controlling this page yet';
    const rows = [
      ['Budgets', `${budget?.summary || 'No budget report'}${failedBudgets ? ` (${failedBudgets} fail)` : ''}`, budgetClass],
      ['Service worker', serviceWorker.available ? (serviceWorker.controlled ? 'controlled' : 'registered') : 'unavailable', serviceWorker.available ? 'ok' : 'warning'],
      ['Cache entries', cacheSummary, 'neutral'],
      ['Storage', storage.quota ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}` : 'unreported', 'neutral'],
      ['Runtime', status.map.runtimeProfile?.deviceClass || 'unknown', 'neutral'],
      ['Loaded layers', String(status.map.loadedLayers || 0), 'neutral'],
      ['Fallbacks', String(status.map.fallbackCount || 0), status.map.fallbackCount ? 'warning' : 'ok'],
      ['Seat circles', status.elections.seatCircleRenderMs ? `${status.elections.seatCircleRenderMs}ms` : 'not active', 'neutral'],
      ['Heap', status.browser.memory ? formatBytes(status.browser.memory) : 'unreported', 'neutral']
    ];
    target.innerHTML = rows.map(([label, value, state]) => `
      <div class="test2-performance-dashboard__row test2-performance-dashboard__row--${state}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join('');
  }
}
