/**
 * Module hooks for overlay.mjs: an import that resolves to one of the repository modules named in
 * A1_MODULES loads the fixture's module instead.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @param {string} file */
const keyOf = (file) => {
  const full = path.resolve(file);
  return process.platform === 'win32' ? full.toLowerCase() : full;
};

/** @type {Map<string, string>} */
let modules = new Map();

/** @param {{ modules: Record<string, string> }} data */
export function initialize(data) {
  modules = new Map(Object.entries(data.modules).map(([from, to]) => [keyOf(from), pathToFileURL(to).href]));
}

/**
 * @param {string} specifier
 * @param {object} context
 * @param {(specifier: string, context: object) => Promise<{ url: string }>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (!resolved.url.startsWith('file:')) return resolved;
  const swapped = modules.get(keyOf(fileURLToPath(resolved.url)));
  return swapped ? { ...resolved, url: swapped, shortCircuit: true } : resolved;
}
