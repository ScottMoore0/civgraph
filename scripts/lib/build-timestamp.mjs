/**
 * Deterministic build timestamp.
 *
 * Generators that stamp `generatedAt: new Date().toISOString()` emit a fresh
 * diff on every run even when their inputs never changed. In a repo where the
 * generated trees are measured in gigabytes that is expensive twice over: it
 * inflates git history, and it defeats incremental sync to R2 (every object
 * looks modified, so every object is re-uploaded).
 *
 * Where a generator writes in place, the better fix is
 * lib/stable-generated-json.mjs `preserveVolatileFields`, which keeps the
 * previous timestamp when the payload is byte-equal. Use THIS helper when that
 * is not possible — e.g. build-timeline-transition-runtime-overlays.mjs deletes
 * its outputs before regenerating them, so there is no previous value to read.
 *
 * Resolution order:
 *   1. SOURCE_DATE_EPOCH  — the reproducible-builds convention (seconds)
 *   2. git HEAD commit date — deterministic per commit, still meaningful
 *   3. wall clock — last resort, warns once
 */
import { execFileSync } from 'node:child_process';

let cached = null;
let warned = false;

export function buildTimestamp() {
  if (cached) return cached;

  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) {
    cached = new Date(Number(epoch) * 1000).toISOString();
    return cached;
  }

  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (iso) {
      cached = new Date(iso).toISOString();
      return cached;
    }
  } catch {
    // not a git checkout, or git unavailable — fall through
  }

  if (!warned) {
    warned = true;
    console.warn('build-timestamp: no SOURCE_DATE_EPOCH and no git HEAD; falling back to wall clock (output will not be reproducible).');
  }
  cached = new Date().toISOString();
  return cached;
}
