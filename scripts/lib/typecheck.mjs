#!/usr/bin/env node
/**
 * Type-check JavaScript by JSDoc (REFACTOR-PLAN.md item 2, TS-1/TS-3): one tsconfig, its
 * `include` list the allowlist of files that must check clean.
 *
 *   node scripts/lib/typecheck.mjs tsconfig.records.json
 *
 * The program also holds every file the allowlisted files import, and tsc reports their errors
 * too. Those files belong to other folders (src/, functions/, tests/) and are checked, or not
 * yet, by their own configs, so an error in one of them is listed as a note and does not fail
 * this check: only an error in an allowlisted file does. So each folder can be brought under the
 * check on its own, and an allowlist never has to grow past the folder its owner is typing.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @typedef {object} TypeError
 * @property {string} file      repository-relative, forward slashes ('' for a global error)
 * @property {number} line      1-based (0 for a global error)
 * @property {number} column    1-based
 * @property {number} code      the TS error number
 * @property {string} message   the first line of the message chain
 *
 * @typedef {object} TypecheckResult
 * @property {string[]} files       the allowlisted files (repository-relative)
 * @property {TypeError[]} errors   in allowlisted files: these fail the check
 * @property {TypeError[]} outside  in files the allowlisted ones import
 */

async function loadTypescript() {
  try {
    return (await import('typescript')).default;
  } catch {
    throw new Error('typescript is not installed: run npm install (it is a devDependency)');
  }
}

/**
 * Check one tsconfig. Pure apart from reading the files.
 * @param {string} configFile   repository-relative or absolute
 * @param {{ root?: string }} [options]
 * @returns {Promise<TypecheckResult>}
 */
export async function typecheck(configFile, { root = REPO_ROOT } = {}) {
  const ts = await loadTypescript();
  const abs = path.resolve(root, configFile);
  const read = ts.readConfigFile(abs, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(abs), undefined, abs);
  if (parsed.errors.length) throw new Error(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const relOf = (/** @type {string} */ f) => path.relative(root, f).split(path.sep).join('/');
  const allow = new Set(parsed.fileNames.map((f) => relOf(path.resolve(f))));
  /** @type {TypeError[]} */
  const errors = [];
  /** @type {TypeError[]} */
  const outside = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n').split('\n')[0];
    if (!d.file) {
      errors.push({ file: '', line: 0, column: 0, code: d.code, message });
      continue;
    }
    const file = relOf(path.resolve(d.file.fileName));
    const pos = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    const entry = { file, line: pos.line + 1, column: pos.character + 1, code: d.code, message };
    (allow.has(file) ? errors : outside).push(entry);
  }
  return { files: [...allow].sort(), errors, outside };
}

/** @param {TypeError} e */
export const formatError = (e) => (e.file ? `${e.file}(${e.line},${e.column}): TS${e.code} ${e.message}` : `TS${e.code} ${e.message}`);

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const config = args.find((a) => !a.startsWith('--'));
  if (!config) {
    console.error('usage: node scripts/lib/typecheck.mjs <tsconfig.json>');
    process.exit(2);
  }
  try {
    const result = await typecheck(config);
    if (result.outside.length) {
      const byFile = new Map();
      for (const e of result.outside) byFile.set(e.file, (byFile.get(e.file) || 0) + 1);
      console.log(`note: ${result.outside.length} error(s) in imported files outside ${config} (their own folders' checks own them): ${[...byFile].map(([f, n]) => `${f} ${n}`).join(', ')}`);
    }
    if (result.errors.length) {
      for (const e of result.errors) console.error(formatError(e));
      console.error(`FAIL: ${result.errors.length} type error(s) in the ${result.files.length} files of ${config}`);
      process.exit(1);
    }
    console.log(`OK: ${result.files.length} files of ${config} type-check clean`);
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
