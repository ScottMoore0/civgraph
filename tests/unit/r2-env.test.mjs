// R2 credentials are loaded one way by every S3 publish script (scripts/publish/r2-env.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_R2_BUCKET, R2CredentialsError, R2_REQUIRED_VARS, r2Credentials, resolveR2Env, s3ClientOptions,
} from '../../scripts/publish/r2-env.mjs';

const NAMES = [...R2_REQUIRED_VARS, 'R2_BUCKET'];

/** Run `fn` with the R2 variables set to `values` (others removed), restoring them afterwards. */
function withEnv(values, fn) {
  const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const n of NAMES) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
  }
}

function tempRoot(envText) {
  const root = mkdtempSync(path.join(tmpdir(), 'r2-env-'));
  if (envText != null) writeFileSync(path.join(root, '.env.local'), envText);
  return root;
}

test('resolveR2Env names what is missing and defaults the bucket', () => {
  const none = resolveR2Env({});
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['R2_S3_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
  assert.equal(none.bucket, DEFAULT_R2_BUCKET);
  const all = resolveR2Env({ R2_S3_ENDPOINT: 'https://e', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: ' b ' });
  assert.deepEqual({ ok: all.ok, missing: all.missing, bucket: all.bucket }, { ok: true, missing: [], bucket: 'b' });
});

test('.env.local at the given root is loaded, and a variable already set wins', () => {
  const root = tempRoot('R2_S3_ENDPOINT=https://file\nR2_ACCESS_KEY_ID=file-key\nR2_SECRET_ACCESS_KEY=file-secret\n');
  try {
    withEnv({ R2_ACCESS_KEY_ID: 'shell-key' }, () => {
      const creds = r2Credentials({ root });
      assert.equal(creds.ok, true);
      assert.equal(creds.endpoint, 'https://file');
      assert.equal(creds.accessKeyId, 'shell-key');
      assert.equal(creds.envFile, path.join(root, '.env.local'));
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing .env.local is not an error by itself; missing variables are, by name only', () => {
  const root = tempRoot(null);
  try {
    withEnv({ R2_ACCESS_KEY_ID: 'value-that-must-not-be-printed' }, () => {
      assert.throws(() => r2Credentials({ root }), (error) => {
        assert.ok(error instanceof R2CredentialsError);
        assert.deepEqual(error.missing, ['R2_S3_ENDPOINT', 'R2_SECRET_ACCESS_KEY']);
        assert.doesNotMatch(error.message, /value-that-must-not-be-printed/);
        return true;
      });
      const soft = r2Credentials({ root, required: false });
      assert.equal(soft.ok, false);
      assert.equal(soft.envFile, null);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('envFile: false never reads the file (the parity check stays a skip without credentials)', () => {
  const root = tempRoot('R2_S3_ENDPOINT=https://file\nR2_ACCESS_KEY_ID=k\nR2_SECRET_ACCESS_KEY=s\n');
  try {
    withEnv({}, () => {
      const creds = r2Credentials({ root, envFile: false, required: false });
      assert.equal(creds.ok, false);
      assert.equal(process.env.R2_S3_ENDPOINT, undefined);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('s3ClientOptions builds the R2 client options and keeps the extras', () => {
  const opts = s3ClientOptions({ endpoint: 'https://e', accessKeyId: 'k', secretAccessKey: 's' }, { maxAttempts: 5 });
  assert.deepEqual(opts, { region: 'auto', endpoint: 'https://e', credentials: { accessKeyId: 'k', secretAccessKey: 's' }, maxAttempts: 5 });
});

test('no S3 publish script reads R2 credentials on its own any more', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'publish');
  for (const name of ['r2-upload-manifest', 'r2-upload-files', 'r2-orphans', 'r2-upload-tree', 'r2-cache-control', 'r2-copy-keys', 'verify-r2-parity']) {
    const src = readFileSync(path.join(dir, `${name}.mjs`), 'utf8');
    assert.match(src, /from '\.\/r2-env\.mjs'/, `${name} imports r2-env.mjs`);
    assert.doesNotMatch(src, /process\.env\.R2_|loadEnvFile\(/, `${name} reads no R2_* variable itself`);
  }
});
