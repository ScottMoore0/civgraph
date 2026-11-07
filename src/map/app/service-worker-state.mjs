// @ts-check
/**
 * The page's side of the service worker (refactor plan section 11; state-machine catalogue
 * MA-14). The worker's own lifecycle (installing, installed, activating, activated, redundant) is
 * the browser's and stays in sw.js; what the map app owns is its registration and the retirement
 * of the workers the old apps left behind.
 *
 * SW_REGISTRATION, the app's registration of /sw.js (performance.js registerServiceWorker, kept
 * as app.serviceWorkerRegistration):
 *
 *   idle -> unavailable    no service-worker API, or a file: page
 *   idle -> registering    register() called
 *   registering -> ready   registered and serviceWorker.ready settled
 *   registering -> failed  register() rejected
 *
 * LEGACY_RETIREMENT, one registration the retired /test/, /render/ or /test2/ apps left
 * (retire-legacy-workers.mjs): pending -> updated (the browser fetched the kill switch, which
 * unregisters itself) or pending -> unregistered (the update failed, so it is removed directly).
 */
import { defineMachine } from '../../../scripts/lib/state-machine.mjs';

/** @typedef {'idle' | 'unavailable' | 'registering' | 'ready' | 'failed'} SwRegistrationState */

export const SW_REGISTRATION = defineMachine({
  name: 'service worker registration',
  initial: /** @type {SwRegistrationState} */ ('idle'),
  transitions: {
    idle: ['unavailable', 'registering'],
    registering: ['ready', 'failed'],
    ready: [],
    failed: [],
    unavailable: []
  }
});

/** @typedef {'pending' | 'updated' | 'unregistered'} LegacyRetirementState */

export const LEGACY_RETIREMENT = defineMachine({
  name: 'legacy service worker retirement',
  initial: /** @type {LegacyRetirementState} */ ('pending'),
  transitions: { pending: ['updated', 'unregistered'], updated: [], unregistered: [] }
});
