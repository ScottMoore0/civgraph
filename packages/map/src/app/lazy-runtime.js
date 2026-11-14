/**
 * Code and data fetched only when needed: the books list, classic scripts such as FlatGeobuf, idle
 * tasks, and the bridges that load catalogue data and runtime helpers on first use.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import uiController from '../ui-controller.js';
import dataService from '../data-service.js';

/** @typedef {import('./map-app').MapApp & LazyRuntimeMethods} LazyRuntimeApp */
/** The controller, with the flags that say a bridge below is installed on it. @typedef {typeof uiController & { __test2LazyCatalogueDataBridgeInstalled?: boolean, __test2LazyRuntimeHelpersBridgeInstalled?: boolean }} BridgedController */

export class LazyRuntimeMethods {
  /** @this {LazyRuntimeApp} */
  async loadBooks() {
    try {
      uiController.booksData = await dataService.ensureBooksLoaded();
    } catch (error) {
      console.warn('[Test2] Could not load books data', error);
    }
  }

  /** @this {LazyRuntimeApp} @param {() => void} callback @param {{ timeout?: number }} [options] */
  scheduleIdleTask(callback, { timeout = 2000 } = {}) {
    if (typeof callback !== 'function') return;
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout });
    } else {
      setTimeout(callback, Math.min(timeout, 1000));
    }
  }

  /** @this {LazyRuntimeApp} @param {string} src @param {string} [globalName] the global the script defines @returns {Promise<unknown>} */
  loadClassicScript(src, globalName) {
    // The page's globals, by the name a classic script gives its own.
    const globals = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
    if (globalName && globals[globalName]) return Promise.resolve(globals[globalName]);
    if (this.classicScriptPromises.has(src)) return /** @type {Promise<unknown>} */ (this.classicScriptPromises.get(src));
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(globalName ? globals[globalName] : true), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve(globalName ? globals[globalName] : true);
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
    this.classicScriptPromises.set(src, promise);
    return promise;
  }

  /** @this {LazyRuntimeApp} */
  async ensureFlatgeobufRuntime() {
    return this.loadClassicScript('/app/js/libs/flatgeobuf-geojson.min.js', 'flatgeobuf');
  }

  /** @this {LazyRuntimeApp} */
  installLazyCatalogueDataBridge() {
    if (/** @type {BridgedController} */ (uiController).__test2LazyCatalogueDataBridgeInstalled) return;
    /** @type {BridgedController} */ (uiController).__test2LazyCatalogueDataBridgeInstalled = true;
    const ensureTarget = uiController.ensureCatalogueTargetRendered?.bind(uiController);
    if (ensureTarget) {
      uiController.ensureCatalogueTargetRendered = async (targetId, sectionKey = null) => {
        const resolvedSection = sectionKey || uiController._flatTargetToSection?.get?.(targetId);
        if (resolvedSection === 'books') await this.loadBooks();
        return ensureTarget(targetId, sectionKey);
      };
    }
    const openBookViewer = uiController.openCatalogueBookViewer?.bind(uiController);
    if (openBookViewer) {
      uiController.openCatalogueBookViewer = async (...args) => {
        await this.loadBooks();
        return openBookViewer(...args);
      };
    }
  }

  /** @this {LazyRuntimeApp} */
  installLazyRuntimeHelpersBridge() {
    if (/** @type {BridgedController} */ (uiController).__test2LazyRuntimeHelpersBridgeInstalled) return;
    /** @type {BridgedController} */ (uiController).__test2LazyRuntimeHelpersBridgeInstalled = true;

    const downloadFeature = uiController.downloadFeature?.bind(uiController);
    if (downloadFeature) {
      uiController.downloadFeature = async (detailId, format) => {
        if (format === 'fgb') await this.ensureFlatgeobufRuntime();
        return downloadFeature(detailId, format);
      };
    }

    const loadAttributeSchema = uiController.loadAttributeSchema?.bind(uiController);
    if (loadAttributeSchema) {
      uiController.loadAttributeSchema = async (...args) => {
        await this.ensureFlatgeobufRuntime();
        return loadAttributeSchema(...args);
      };
    }
  }
}
