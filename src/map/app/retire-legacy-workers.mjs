/**
 * Retire the legacy map apps' service workers from the map app itself.
 *
 * /test/ (until August 2026), /render/ and /test2/ registered workers scoped to their own paths.
 * Their pages now answer 301 to /maps/, and the worker addresses serve a kill switch
 * (render/sw.js) that unregisters the old worker and clears its caches once a browser checks it
 * for an update. But a browser only checks a registration whose scope it navigates into, and a
 * visitor following an old link is redirected out of that scope before the check happens, so the
 * old worker (and up to 270 MB of cached tiles) could stay installed for good. This page is where
 * those visitors land: it asks the browser to check each legacy registration, which installs the
 * kill switch; if the check fails it unregisters the worker directly (its caches then wait for
 * the next successful check).
 *
 * Pure apart from the container it is given (navigator.serviceWorker): tested in
 * tests/unit/retire-legacy-workers.test.mjs and, in Chromium, by
 * tests/browser/retired-service-worker.spec.js.
 */
import { LEGACY_RETIREMENT } from './service-worker-state.mjs';
import { createState } from '../state-helpers.mjs';

/** Scopes the retired apps registered workers under. */
export const RETIRED_WORKER_SCOPES = ['/test/', '/render/', '/test2/'];

/**
 * Ask the browser to update every legacy registration (installing the kill switch), and
 * unregister any whose update fails. Resolves with the scopes it acted on; never rejects.
 */
export async function retireLegacyServiceWorkers(container) {
  if (!container?.getRegistrations) return [];
  let registrations;
  try {
    registrations = await container.getRegistrations();
  } catch {
    return [];
  }
  const retired = [];
  await Promise.all(registrations.map(async (registration) => {
    let scope;
    try {
      scope = new URL(registration.scope).pathname;
    } catch {
      return;
    }
    if (!RETIRED_WORKER_SCOPES.includes(scope)) return;
    retired.push(scope);
    const retirement = createState(LEGACY_RETIREMENT);
    try {
      await registration.update();
      retirement.to('updated');
    } catch {
      retirement.to('unregistered');
      await registration.unregister().catch(() => false);
    }
  }));
  return retired.sort();
}
