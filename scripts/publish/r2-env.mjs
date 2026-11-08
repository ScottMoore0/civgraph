// @ts-check
/**
 * R2 credentials for the publish scripts that talk to the S3 endpoint, loaded one way.
 *
 * Before this, each script had its own habit: r2-upload-files and r2-orphans called
 * `process.loadEnvFile('.env.local')` (relative to the working directory, throwing when it was
 * absent), r2-copy-keys and r2-upload-manifest expected `node --env-file=.env.local`, and
 * r2-upload-tree and r2-cache-control expected the shell to have sourced it. So `npm run
 * sync:thumbnails` failed unless the caller remembered which kind it was. Now every one of them
 * calls `r2Credentials()`:
 *
 *   - the repository's `.env.local` (scripts/lib/config.mjs REPO_PATHS.envFile, found from the
 *     repository root, not the working directory) is loaded when it exists;
 *   - a variable already in the environment wins over the file (Node's loadEnvFile never
 *     overwrites), so `--env-file`, a sourced shell and CI secrets keep working;
 *   - a missing variable is reported by NAME; no value is ever printed;
 *   - the bucket defaults to boundaries-data, the only one the site serves from.
 *
 * Read-only checks that must skip without credentials (verify-r2-parity) pass `envFile: false`
 * and test `ok` instead of catching.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_PATHS, REPO_ROOT } from '../../packages/config/src/node.mjs';

export const R2_REQUIRED_VARS = Object.freeze(['R2_S3_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
export const DEFAULT_R2_BUCKET = 'boundaries-data';

/**
 * @typedef {object} R2Credentials
 * @property {boolean} ok              every required variable is set
 * @property {string[]} missing        the names of the required variables that are not
 * @property {string} endpoint
 * @property {string} bucket
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 * @property {string | null} envFile   the .env.local that was loaded, or null
 */

/**
 * The credentials in `env`. Pure.
 * @param {Record<string, string | undefined>} env
 * @returns {Omit<R2Credentials, 'envFile'>}
 */
export function resolveR2Env(env) {
  const get = (/** @type {string} */ name) => String(env[name] ?? '').trim();
  const missing = R2_REQUIRED_VARS.filter((name) => !get(name));
  return {
    ok: missing.length === 0,
    missing,
    endpoint: get('R2_S3_ENDPOINT'),
    bucket: get('R2_BUCKET') || DEFAULT_R2_BUCKET,
    accessKeyId: get('R2_ACCESS_KEY_ID'),
    secretAccessKey: get('R2_SECRET_ACCESS_KEY'),
  };
}

/**
 * Load the repository's .env.local into process.env when it exists; variables already set are
 * kept. Returns the file loaded, or null.
 * @param {string} [root]
 */
export function loadEnvLocal(root = REPO_ROOT) {
  const file = path.join(root, REPO_PATHS.envFile);
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}

export class R2CredentialsError extends Error {
  /** @param {string[]} missing @param {string | null} envFile */
  constructor(missing, envFile) {
    super(`Missing R2 credentials: ${missing.join(', ')} (${envFile ? `not in the environment or ${envFile}` : `no ${REPO_PATHS.envFile} at the repository root, and not in the environment`}).`);
    this.name = 'R2CredentialsError';
    this.missing = missing;
  }
}

/**
 * The R2 credentials, loading .env.local first unless `envFile` is false. With `required` (the
 * default) a missing variable throws R2CredentialsError; without it the caller checks `ok`.
 * @param {{ envFile?: boolean, required?: boolean, root?: string }} [options]
 * @returns {R2Credentials}
 */
export function r2Credentials({ envFile = true, required = true, root = REPO_ROOT } = {}) {
  const loaded = envFile ? loadEnvLocal(root) : null;
  const creds = { ...resolveR2Env(process.env), envFile: loaded };
  if (required && !creds.ok) throw new R2CredentialsError(creds.missing, loaded);
  return creds;
}

/**
 * `r2Credentials()` for a CLI: on a missing variable, print the error (names only) and exit with
 * `exitCode` instead of throwing.
 * @param {{ envFile?: boolean, exitCode?: number }} [options]
 * @returns {R2Credentials}
 */
export function r2CredentialsOrExit({ envFile = true, exitCode = 1 } = {}) {
  try {
    return r2Credentials({ envFile });
  } catch (error) {
    if (!(error instanceof R2CredentialsError)) throw error;
    console.error(`FAIL: ${error.message}`);
    process.exit(exitCode);
  }
}

/**
 * The S3 client options for R2 (region auto, the endpoint, the keys), merged with `extra`.
 * @param {Pick<R2Credentials, 'endpoint' | 'accessKeyId' | 'secretAccessKey'>} creds
 * @param {Record<string, unknown>} [extra]
 */
export function s3ClientOptions(creds, extra = {}) {
  return {
    region: 'auto',
    endpoint: creds.endpoint,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    ...extra,
  };
}
