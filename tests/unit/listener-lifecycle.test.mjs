/**
 * Listeners on long-lived targets go away with their owner (docs/ARCHITECTURE-RULES.md R8,
 * check C7; rf8-frontend, 12 Nov 2026). A fake document and window count the listeners that are
 * live, honouring removeEventListener and an aborted { signal } as a browser does; each owner is
 * set up, set up again where the code allows it, and disposed, and the count must come back to
 * where it started. tests/browser/listener-lifecycle.spec.cjs does the same in Chromium while
 * moving between views of Browse and the map.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

/** An EventTarget that knows how many listeners are live on it. */
class CountingTarget extends EventTarget {
  constructor() {
    super();
    /** @type {Set<string>} */
    this.live = new Set();
    this.ids = new WeakMap();
    this.nextId = 0;
  }

  /** @param {unknown} listener */
  key(type, listener, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    if (!this.ids.has(listener)) this.ids.set(listener, ++this.nextId);
    return `${type}|${this.ids.get(listener)}|${capture}`;
  }

  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    const signal = typeof options === 'object' ? options?.signal : undefined;
    if (signal?.aborted) return;
    const key = this.key(type, listener, options);
    this.live.add(key);
    signal?.addEventListener('abort', () => this.live.delete(key), { once: true });
  }

  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.live.delete(this.key(type, listener, options));
  }

  get count() { return this.live.size; }
}

/** A document just big enough for the modules below. */
function fakeDocument() {
  const doc = new CountingTarget();
  const attributes = new Map();
  Object.assign(doc, {
    documentElement: {
      dataset: {},
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      hasAttribute: (name) => attributes.has(name),
    },
    body: { classList: { contains: () => false } },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
  });
  return doc;
}

/** Runs fn with globalThis.document (and window, when given) replaced, restoring them after. */
async function withGlobals(globals, fn) {
  const saved = Object.fromEntries(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
}

test('CountingTarget counts as a browser does: remove, abort and a pre-aborted signal', () => {
  const t = new CountingTarget();
  const a = () => {};
  const controller = new AbortController();
  t.addEventListener('click', a);
  t.addEventListener('click', a); // the same listener twice is one listener
  t.addEventListener('click', a, true); // capture is a different one
  t.addEventListener('keydown', () => {}, { signal: controller.signal });
  assert.equal(t.count, 3);
  t.removeEventListener('click', a);
  assert.equal(t.count, 2);
  controller.abort();
  assert.equal(t.count, 1);
  t.addEventListener('scroll', () => {}, { signal: controller.signal });
  assert.equal(t.count, 1);
});

test('the printed-labels toggle listens once however often it starts, and stops on dispose', async () => {
  const document = fakeDocument();
  await withGlobals({ document, localStorage: undefined }, async () => {
    const { disposePrintedLabels, initPrintedLabels } = await import('../../src/printed-labels.mjs');
    initPrintedLabels();
    initPrintedLabels(); // the map app and an election view both call it
    assert.equal(document.count, 1);
    disposePrintedLabels();
    assert.equal(document.count, 0);
    initPrintedLabels();
    assert.equal(document.count, 1);
    disposePrintedLabels();
    assert.equal(document.count, 0);
  });
});

test("the catalogue split's document listeners and observer go with dispose()", async () => {
  const document = fakeDocument();
  const media = new CountingTarget();
  let observing = 0;
  class MutationObserver {
    observe() { observing += 1; }
    disconnect() { observing = 0; }
  }
  const window = { matchMedia: () => media };
  const element = () => Object.assign(new CountingTarget(), {
    dataset: {},
    style: { setProperty() {}, getPropertyValue: () => '' },
    setAttribute() {},
  });
  document.querySelectorAll = () => [element()];
  await withGlobals({ document, window, MutationObserver, requestAnimationFrame: () => 0, localStorage: undefined }, async () => {
    const { installSplit } = await import('../../src/catalogue/split.js');
    const split = installSplit({ isMobile: true }, { host: element(), splitDrag: element() });
    assert.equal(document.count, 3, 'mouseup and touchend for a drag, mouseup for the keyboard value');
    assert.equal(media.count, 1);
    assert.equal(observing, 1);
    split.dispose();
    assert.equal(document.count, 0);
    assert.equal(media.count, 0);
    assert.equal(observing, 0);
  });
});

test("the map app's theme listener (site chrome) goes with the app's lifecycle signal", async () => {
  const document = fakeDocument();
  document.querySelector = (selector) => (selector === '.app-header[data-site-chrome]' ? {} : null);
  await withGlobals({ document }, async () => {
    const { SiteChromeMethods } = await import('../../packages/map/src/app/site-chrome.js');
    let synced = 0;
    const app = { lifecycle: new AbortController(), syncBasemapToTheme: async () => { synced += 1; } };
    SiteChromeMethods.prototype.setupThemeToggle.call(app);
    assert.equal(document.count, 1);
    document.dispatchEvent(new Event('civgraph:themechange'));
    assert.equal(synced, 2, 'once at setup, once for the event');
    app.lifecycle.abort();
    assert.equal(document.count, 0);
    document.dispatchEvent(new Event('civgraph:themechange'));
    assert.equal(synced, 2, 'nothing after dispose');
  });
});
