/**
 * localStorage keys, and a one-time migration off the old prefix.
 *
 * UX plan T3-02, finding #110: keys were still written under `ni-boundaries.*`, a name
 * the project no longer uses anywhere else. Renaming them naively would silently discard
 * every returning visitor's preferences -- split position, catalogue view, collapsed
 * classes, text scale -- because the new key simply would not exist.
 *
 * So this READS THROUGH: ask for the new key, fall back to the old one, and copy it
 * across on first read. Nobody loses a setting, and the old key is removed once its value
 * is safely under the new name.
 *
 * The old prefix is kept in the fallback deliberately and should stay for at least a year
 * -- a visitor who last used the site six months ago must not be reset by an upgrade they
 * did not ask for.
 */

const NEW_PREFIX = 'civgraph.';
const OLD_PREFIX = 'ni-boundaries.';

/** @param {string} key */
const safeGet = (key) => {
  try { return window.localStorage?.getItem(key) ?? null; } catch { return null; }
};
/**
 * @param {string} key
 * @param {string} value
 */
const safeSet = (key, value) => {
  try { window.localStorage?.setItem(key, value); } catch { /* private mode, quota */ }
};
/** @param {string} key */
const safeRemove = (key) => {
  try { window.localStorage?.removeItem(key); } catch { /* ignore */ }
};

/**
 * `readStored('textScale')` looks at civgraph.textScale, then ni-boundaries.textScale.
 * @param {string} name
 * @param {string | null} [fallback]
 */
export function readStored(name, fallback = null) {
  const current = safeGet(NEW_PREFIX + name);
  if (current !== null) return current;
  const legacy = safeGet(OLD_PREFIX + name);
  if (legacy === null) return fallback;
  // Migrate on first read, then drop the old key so this only ever happens once.
  safeSet(NEW_PREFIX + name, legacy);
  safeRemove(OLD_PREFIX + name);
  return legacy;
}

/**
 * @param {string} name
 * @param {unknown} value
 */
export function writeStored(name, value) {
  safeSet(NEW_PREFIX + name, String(value));
}

/** @param {string} name */
export function removeStored(name) {
  safeRemove(NEW_PREFIX + name);
  safeRemove(OLD_PREFIX + name);
}
