/**
 * A view's lifetime (the Elections app's view contract, 11 Nov 2026 arch audit P1). Pure (no DOM
 * beyond AbortController and EventTarget, both in Node): tests/unit/elections-app-lifecycle.test.mjs.
 *
 * app.js opens a scope for each view it renders and disposes the previous one first. A view
 * renders into the shared root with `render(root, route, ctx)`, where ctx carries:
 *
 *   signal      aborted when the view is left. Every listener the view adds passes
 *               `{ signal: ctx.signal }` (an ESLint rule holds the views to it), so leaving the
 *               view removes them, whatever element they are on;
 *   stale()     signal.aborted: an await that resumes after the view was left draws nothing;
 *   onDispose   a cleanup to run when the view is left (a MapLibre map's remove(), an off-screen
 *               holder), or at once when it already has been;
 *   navigate    the app router (no page load).
 *
 * dispose() aborts the signal, then runs the cleanups newest first, once. A cleanup that throws
 * is reported and the rest still run.
 */

/**
 * @typedef {object} ViewScope
 * @property {AbortSignal} signal
 * @property {() => boolean} stale
 * @property {(cleanup: () => void) => void} onDispose
 * @property {() => void} dispose
 */

/**
 * @param {(error: unknown) => void} [report]  where a failing cleanup is reported (console.error)
 * @returns {ViewScope}
 */
export function createViewScope(report = (error) => console.error(error)) {
  const controller = new AbortController();
  /** @type {Array<() => void>} */
  const cleanups = [];
  const run = (/** @type {() => void} */ cleanup) => {
    try { cleanup(); } catch (error) { report(error); }
  };
  return {
    signal: controller.signal,
    stale: () => controller.signal.aborted,
    onDispose(cleanup) {
      if (controller.signal.aborted) run(cleanup);
      else cleanups.push(cleanup);
    },
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      while (cleanups.length) run(/** @type {() => void} */ (cleanups.pop()));
    },
  };
}

/**
 * The latest of a series of runs (a pivot query, a redraw): each start() supersedes the ones
 * before it, so an answer that arrives after a newer run started is dropped, not drawn.
 *
 *   const runs = latestRun();
 *   const token = runs.start();
 *   const data = await slowQuery();
 *   if (!runs.isLatest(token)) return;   // a newer run started meanwhile
 */
export function latestRun() {
  let latest = 0;
  return {
    start: () => ++latest,
    isLatest: (/** @type {number} */ token) => token === latest,
  };
}

/**
 * One at a time: each task given to the returned function starts when the one before it has
 * settled (resolved or rejected), so two tasks never interleave their awaits. lib/duck.js runs
 * "bind these bodies, then query" as one task, so no other view can rebind between the two.
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function serial() {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  return (task) => {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
}
